"""Graph ingestion service for populating the NARADA unified graph from source tables.

Supports idempotent bulk ingestion of:
  - Districts and provinces (geography backbone)
  - Companies (~140K) from company_registrations
  - Political entities and candidates
  - Stories and story-entity links
  - Disaster incidents and alerts
  - Trade network (commodities, countries, customs offices)
  - Phone hash clusters from IRD enrichments

All ingestion methods use ``INSERT ... ON CONFLICT (canonical_key) DO UPDATE``
for idempotent re-runs.  Large tables are processed in configurable batch sizes
to avoid memory exhaustion.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import select, func, text, insert, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.graph import (
    District,
    GraphNode,
    GraphEdge,
    GraphIngestionRun,
    GraphIngestionRunStep,
    NodeType,
    EdgePredicate,
)
from app.models.company import CompanyRegistration, CompanyDirector, IRDEnrichment
from app.models.political_entity import PoliticalEntity, EntityType
from app.models.election import Candidate, Constituency, Election
from app.models.story import Story
from app.models.story_entity_link import StoryEntityLink
from app.models.disaster import DisasterIncident, DisasterAlert
from app.models.damage_assessment import DamageZone, DamageAssessment
from app.models.connected_analyst import TradeFact, TradeDirection
from app.data.nepal_districts import (
    NEPAL_DISTRICTS as _CANONICAL_DISTRICTS,
    NEPAL_PROVINCES as _CANONICAL_PROVINCES,
    normalize_district_name,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Nepal districts reference data — derived from canonical source of truth
# in app.data.nepal_districts to avoid data duplication (CRITICAL-3 fix).
# ---------------------------------------------------------------------------

NEPAL_DISTRICTS_DATA: list[dict[str, Any]] = [
    {
        "name_en": d["name_en"],
        "province_id": d["province_id"],
        "province_name": d["province_name"],
        "latitude": d.get("latitude"),
        "longitude": d.get("longitude"),
        "aliases": d.get("aliases", []),
    }
    for d in _CANONICAL_DISTRICTS
]

# Province centroids
NEPAL_PROVINCES_DATA: list[dict[str, Any]] = [
    {
        "name_en": p["name_en"],
        "province_id": p["id"],
        "latitude": None,  # Provinces don't have centroids in canonical data
        "longitude": None,
    }
    for p in _CANONICAL_PROVINCES
]

# Approximate province centroids (computed from district averages)
_PROVINCE_CENTROIDS: dict[int, tuple[float, float]] = {}
for _d in NEPAL_DISTRICTS_DATA:
    _pid = _d["province_id"]
    if _d.get("latitude") and _d.get("longitude"):
        if _pid not in _PROVINCE_CENTROIDS:
            _PROVINCE_CENTROIDS[_pid] = (0.0, 0.0)
        _lat_sum, _lng_sum = _PROVINCE_CENTROIDS[_pid]
        # Will be averaged below
for _p in NEPAL_PROVINCES_DATA:
    _pid = _p["province_id"]
    districts_in_province = [d for d in NEPAL_DISTRICTS_DATA if d["province_id"] == _pid and d.get("latitude")]
    if districts_in_province:
        _p["latitude"] = round(sum(d["latitude"] for d in districts_in_province) / len(districts_in_province), 2)
        _p["longitude"] = round(sum(d["longitude"] for d in districts_in_province) / len(districts_in_province), 2)


class GraphIngestionService:
    """Async service for bulk ingestion of domain data into the unified graph."""

    _PHASE_TO_METHOD: dict[str, str] = {
        "districts": "ingest_districts",
        "companies": "ingest_companies",
        "company_directorships": "ingest_company_directorships",
        "company_address_clusters": "ingest_company_address_clusters",
        "building_zones": "ingest_building_zones",
        "political_entities": "ingest_political_entities",
        "candidates": "ingest_candidates",
        "stories": "ingest_stories",
        "disasters": "ingest_disasters",
        "trade_network": "ingest_trade_network",
        "phone_clusters": "ingest_phone_clusters",
        "dfims_organizations": "ingest_dfims_organizations",
    }

    _PHASE_ALIASES: dict[str, list[str]] = {
        "entities": ["political_entities", "candidates"],
        "trade": ["trade_network"],
        "phones": ["phone_clusters"],
        "dfims": ["dfims_organizations"],
        "all_companies": ["companies", "company_directorships", "company_address_clusters"],
    }

    _CUSTOMS_OFFICE_DISTRICT_HINTS: dict[str, str] = {
        "birgunj": "Parsa",
        "biratnagar": "Morang",
        "bhairahawa": "Rupandehi",
        "nepalgunj": "Banke",
        "bhimdatta": "Kanchanpur",
        "tribhuvan airport": "Kathmandu",
        "rasuwagadhi": "Rasuwa",
        "dry port": "Morang",
    }

    def __init__(self, session: AsyncSession):
        self.session = session
        self._district_cache: dict[str, str] | None = None

    @classmethod
    def available_phases(cls) -> list[str]:
        """List supported canonical ingestion phases."""
        return list(cls._PHASE_TO_METHOD.keys())

    def _expand_requested_phases(self, phases: list[str] | None) -> list[str]:
        """Normalize and expand phase aliases into canonical phase names."""
        if not phases:
            return self.available_phases()

        normalized: list[str] = []
        for raw_phase in phases:
            phase = raw_phase.strip().lower()
            if not phase:
                continue
            if phase == "all":
                return self.available_phases()
            expanded = self._PHASE_ALIASES.get(phase, [phase])
            for item in expanded:
                if item not in self._PHASE_TO_METHOD:
                    raise ValueError(
                        f"Unknown ingestion phase '{raw_phase}'. "
                        f"Valid phases: {', '.join(self.available_phases())}"
                    )
                if item not in normalized:
                    normalized.append(item)
        return normalized

    @staticmethod
    def _estimate_rows_processed(payload: Any) -> int:
        """Estimate rows processed from a mixed stats payload."""
        if payload is None:
            return 0
        if isinstance(payload, bool):
            return 1 if payload else 0
        if isinstance(payload, int):
            return max(payload, 0)
        if isinstance(payload, float):
            return int(max(payload, 0.0))
        if isinstance(payload, list):
            return sum(GraphIngestionService._estimate_rows_processed(item) for item in payload)
        if isinstance(payload, dict):
            return sum(GraphIngestionService._estimate_rows_processed(value) for value in payload.values())
        return 0

    async def _infer_customs_district(self, office_name: str | None) -> str | None:
        """Infer district from customs office label using canonical aliases."""
        if not office_name:
            return None

        normalized = await self._normalize_district(office_name)
        if normalized:
            return normalized

        lowered = office_name.lower().strip()
        for hint, district in self._CUSTOMS_OFFICE_DISTRICT_HINTS.items():
            if hint in lowered:
                return district

        # Fallback: partial token match against canonical district names.
        district_cache = await self._build_district_cache()
        tokens = [token for token in re.split(r"[^a-z0-9]+", lowered) if token]
        for token in tokens:
            if token in district_cache:
                return district_cache[token]
        return None

    @staticmethod
    def _normalize_address_signature(raw: str | None) -> str | None:
        """Normalize company address into a stable clustering signature."""
        if not raw:
            return None
        cleaned = raw.lower().strip()
        cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
        cleaned = re.sub(r"\b(nepal|municipality|ward|ward no|district|province)\b", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        if len(cleaned) < 6:
            return None
        return cleaned

    # ------------------------------------------------------------------
    # District normalization
    # ------------------------------------------------------------------

    async def _build_district_cache(self) -> dict[str, str]:
        """Build in-memory alias-to-canonical-name dict for O(1) district lookups.

        Uses the canonical normalize_district_name() from app.data.nepal_districts
        as the primary source, augmented with database aliases if the districts
        table is populated.
        """
        if self._district_cache is not None:
            return self._district_cache

        cache: dict[str, str] = {}

        # From canonical reference data (single source of truth)
        for d in NEPAL_DISTRICTS_DATA:
            name = d["name_en"]
            cache[name.lower()] = name
            cache[name.lower().replace(" ", "")] = name
            for alias in d.get("aliases", []):
                cache[alias.lower()] = name

        # From database (if districts table is populated)
        try:
            stmt = select(District)
            result = await self.session.execute(stmt)
            for district in result.scalars().all():
                cache[district.name_en.lower()] = district.name_en
                if district.aliases:
                    for alias in district.aliases:
                        cache[str(alias).lower()] = district.name_en
        except Exception:
            pass  # Table may not exist yet

        self._district_cache = cache
        return cache

    async def _normalize_district(self, raw_district: str | None) -> str | None:
        """Normalize a raw district name to canonical form.

        First tries the canonical normalize_district_name() from app.data.nepal_districts,
        then falls back to the ingestion-specific cache for additional aliases.
        Returns None if no match found.
        """
        if not raw_district:
            return None

        # Try canonical normalization first (covers all 77 districts + aliases)
        canonical = normalize_district_name(raw_district)
        if canonical:
            return canonical

        # Fallback to ingestion cache (includes database aliases)
        cache = await self._build_district_cache()
        raw = raw_district.strip()

        lowered = raw.lower()
        if lowered in cache:
            return cache[lowered]

        # Strip "district" suffix
        cleaned = lowered.replace(" district", "").replace("district", "").strip()
        if cleaned in cache:
            return cache[cleaned]

        return None

    # ------------------------------------------------------------------
    # Helper: upsert nodes and edges
    # ------------------------------------------------------------------

    async def _upsert_node(self, values: dict[str, Any]) -> UUID:
        """Insert a graph node or update if canonical_key already exists.

        Returns the node ID.
        """
        node_id = values.get("id") or uuid4()
        values["id"] = node_id
        now = datetime.now(timezone.utc)
        values.setdefault("confidence", 0.0)
        values.setdefault("source_count", 1)
        values.setdefault("is_canonical", True)

        stmt = pg_insert(GraphNode).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["canonical_key"],
            set_={
                "title": stmt.excluded.title,
                "district": stmt.excluded.district,
                "province": stmt.excluded.province,
                "latitude": stmt.excluded.latitude,
                "longitude": stmt.excluded.longitude,
                "properties": stmt.excluded.properties,
                "confidence": stmt.excluded.confidence,
                "source_count": stmt.excluded.source_count,
                "last_seen_at": now,
                "updated_at": now,
            },
        )
        result = await self.session.execute(stmt)
        # Get the actual ID (may differ if row existed)
        existing = await self.session.execute(
            select(GraphNode.id).where(GraphNode.canonical_key == values["canonical_key"])
        )
        return existing.scalar() or node_id

    async def _upsert_edge(self, values: dict[str, Any]) -> UUID:
        """Insert a graph edge or update if duplicate exists.

        Uses (source_node_id, target_node_id, predicate, valid_from) uniqueness.
        Returns the edge ID.
        """
        edge_id = values.get("id") or uuid4()
        values["id"] = edge_id
        now = datetime.now(timezone.utc)
        values.setdefault("weight", 1.0)
        values.setdefault("confidence", 0.0)
        values.setdefault("is_current", True)
        values.setdefault("source_count", 1)

        stmt = pg_insert(GraphEdge).values(**values)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_ge_source_target_predicate_valid_from",
            set_={
                "weight": stmt.excluded.weight,
                "confidence": stmt.excluded.confidence,
                "properties": stmt.excluded.properties,
                "source_count": stmt.excluded.source_count,
                "last_seen_at": now,
                "updated_at": now,
            },
        )
        await self.session.execute(stmt)
        return edge_id

    # ------------------------------------------------------------------
    # 1. Districts & Provinces
    # ------------------------------------------------------------------

    async def ingest_districts(self) -> dict:
        """Ingest all 77 districts + 7 provinces as graph_nodes (type=place).

        Also populates the ``districts`` reference table and creates ``parent_of``
        edges from provinces to their districts.
        """
        logger.info("Ingesting districts and provinces")
        stats = {
            "country_created": 0,
            "districts_created": 0,
            "provinces_created": 0,
            "edges_created": 0,
        }

        nepal_node_id = await self._upsert_node({
            "node_type": NodeType.PLACE.value,
            "canonical_key": "country:nepal",
            "title": "Nepal",
            "subtype": "country",
            "source_table": "countries",
            "source_id": "nepal",
            "confidence": 1.0,
        })
        stats["country_created"] += 1

        # Province nodes
        province_node_ids: dict[int, UUID] = {}
        for p in NEPAL_PROVINCES_DATA:
            node_id = await self._upsert_node({
                "node_type": NodeType.PLACE.value,
                "canonical_key": f"province:{p['province_id']}",
                "title": p["name_en"],
                "province": p["name_en"],
                "latitude": p["latitude"],
                "longitude": p["longitude"],
                "subtype": "province",
                "source_table": "provinces",
                "source_id": str(p["province_id"]),
                "confidence": 1.0,
            })
            province_node_ids[p["province_id"]] = node_id
            stats["provinces_created"] += 1

            await self._upsert_edge({
                "source_node_id": nepal_node_id,
                "target_node_id": node_id,
                "predicate": EdgePredicate.PARENT_OF.value,
                "confidence": 1.0,
                "source_table": "provinces",
                "source_id": str(p["province_id"]),
            })
            stats["edges_created"] += 1

        # District nodes + reference table
        for d in NEPAL_DISTRICTS_DATA:
            node_id = await self._upsert_node({
                "node_type": NodeType.PLACE.value,
                "canonical_key": f"district:{d['name_en'].lower().replace(' ', '_')}",
                "title": d["name_en"],
                "district": d["name_en"],
                "province": d["province_name"],
                "latitude": d["latitude"],
                "longitude": d["longitude"],
                "subtype": "district",
                "source_table": "districts",
                "source_id": d["name_en"],
                "confidence": 1.0,
            })
            stats["districts_created"] += 1

            # Upsert into districts reference table
            dist_stmt = pg_insert(District).values(
                name_en=d["name_en"],
                province_id=d["province_id"],
                province_name=d["province_name"],
                latitude=d["latitude"],
                longitude=d["longitude"],
                aliases=d.get("aliases", []),
                graph_node_id=node_id,
            )
            dist_stmt = dist_stmt.on_conflict_do_update(
                index_elements=["name_en"],
                set_={
                    "province_id": dist_stmt.excluded.province_id,
                    "province_name": dist_stmt.excluded.province_name,
                    "latitude": dist_stmt.excluded.latitude,
                    "longitude": dist_stmt.excluded.longitude,
                    "aliases": dist_stmt.excluded.aliases,
                    "graph_node_id": node_id,
                },
            )
            await self.session.execute(dist_stmt)

            # parent_of edge: province -> district
            province_node_id = province_node_ids.get(d["province_id"])
            if province_node_id:
                await self._upsert_edge({
                    "source_node_id": province_node_id,
                    "target_node_id": node_id,
                    "predicate": EdgePredicate.PARENT_OF.value,
                    "confidence": 1.0,
                    "source_table": "districts",
                    "source_id": d["name_en"],
                })
                stats["edges_created"] += 1

        await self.session.flush()
        self._district_cache = None  # Invalidate cache
        logger.info("Districts ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 2. Companies
    # ------------------------------------------------------------------

    async def ingest_companies(self, batch_size: int = 1000) -> dict:
        """Batch ingest companies from company_registrations.

        Creates graph_nodes (type=organization) and 'located_in' edges
        to district nodes via fuzzy district matching.
        """
        logger.info("Ingesting companies (batch_size=%d)", batch_size)
        stats = {"nodes_created": 0, "edges_created": 0, "unmatched_districts": set()}

        # Pre-build district node lookup
        district_node_ids = await self._get_district_node_ids()
        await self._build_district_cache()

        offset = 0
        while True:
            stmt = (
                select(CompanyRegistration)
                .order_by(CompanyRegistration.id)
                .offset(offset)
                .limit(batch_size)
            )
            result = await self.session.execute(stmt)
            companies = result.scalars().all()

            if not companies:
                break

            for company in companies:
                try:
                    properties: dict[str, Any] = {}
                    if company.pan:
                        properties["pan"] = company.pan
                    if company.company_type_category:
                        properties["company_type_category"] = company.company_type_category
                    if company.registration_number:
                        properties["registration_number"] = company.registration_number

                    # Normalize district
                    norm_district = await self._normalize_district(company.district)

                    node_id = await self._upsert_node({
                        "node_type": NodeType.ORGANIZATION.value,
                        "canonical_key": f"company:{company.external_id}",
                        "title": company.name_english,
                        "title_ne": company.name_nepali,
                        "district": norm_district,
                        "province": company.province,
                        "subtype": company.company_type_category or "company",
                        "properties": properties,
                        "source_table": "company_registrations",
                        "source_id": str(company.id),
                        "confidence": 0.9,
                        "first_seen_at": company.created_at,
                    })
                    stats["nodes_created"] += 1

                    # located_in edge to district
                    if norm_district and norm_district in district_node_ids:
                        await self._upsert_edge({
                            "source_node_id": node_id,
                            "target_node_id": district_node_ids[norm_district],
                            "predicate": EdgePredicate.LOCATED_IN.value,
                            "confidence": 0.9,
                            "source_table": "company_registrations",
                            "source_id": str(company.id),
                        })
                        stats["edges_created"] += 1
                    elif company.district:
                        stats["unmatched_districts"].add(company.district)

                except Exception as e:
                    logger.warning("Error ingesting company %s: %s", company.id, e)

            await self.session.flush()
            offset += batch_size
            logger.info("Companies ingested: %d nodes, %d edges (offset=%d)", stats["nodes_created"], stats["edges_created"], offset)

        stats["unmatched_districts"] = list(stats["unmatched_districts"])
        logger.info("Companies ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 3. Company directorships
    # ------------------------------------------------------------------

    async def ingest_company_directorships(self) -> dict:
        """Ingest company director relationships into unified graph."""
        logger.info("Ingesting company directorship edges")
        stats = {"director_nodes_created": 0, "edges_created": 0, "unresolved_companies": 0}

        company_rows = await self.session.execute(
            select(GraphNode.source_id, GraphNode.id).where(
                GraphNode.source_table == "company_registrations",
                GraphNode.is_canonical.is_(True),
            )
        )
        company_node_map = {row[0]: row[1] for row in company_rows.all()}

        political_rows = await self.session.execute(
            select(GraphNode.source_id, GraphNode.id).where(
                GraphNode.source_table == "political_entities",
                GraphNode.is_canonical.is_(True),
            )
        )
        political_node_map = {row[0]: row[1] for row in political_rows.all()}

        directors = (await self.session.execute(select(CompanyDirector))).scalars().all()
        for director in directors:
            if not director.company_id:
                continue
            company_node_id = company_node_map.get(str(director.company_id))
            if not company_node_id:
                stats["unresolved_companies"] += 1
                continue

            if director.linked_entity_id and str(director.linked_entity_id) in political_node_map:
                director_node_id = political_node_map[str(director.linked_entity_id)]
            else:
                identity_basis = (
                    director.pan
                    or director.citizenship_no
                    or director.name_en.lower().strip().replace(" ", "_")
                )
                director_node_id = await self._upsert_node({
                    "node_type": NodeType.PERSON.value,
                    "canonical_key": f"director:{identity_basis}",
                    "title": director.name_en,
                    "title_ne": director.name_np,
                    "subtitle": director.role,
                    "subtype": "company_director",
                    "properties": {
                        "role": director.role,
                        "source": director.source,
                        "company_name_hint": director.company_name_hint,
                    },
                    "source_table": "company_directors",
                    "source_id": str(director.id),
                    "confidence": float(director.confidence or 0.85),
                })
                stats["director_nodes_created"] += 1

            await self._upsert_edge({
                "source_node_id": director_node_id,
                "target_node_id": company_node_id,
                "predicate": EdgePredicate.DIRECTOR_OF.value,
                "confidence": float(director.entity_link_confidence or director.confidence or 0.85),
                "properties": {
                    "role": director.role,
                    "appointed_date": director.appointed_date.isoformat() if director.appointed_date else None,
                    "resigned_date": director.resigned_date.isoformat() if director.resigned_date else None,
                },
                "source_table": "company_directors",
                "source_id": str(director.id),
            })
            stats["edges_created"] += 1

        await self.session.flush()
        logger.info("Company directorship ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 4. Company address clusters
    # ------------------------------------------------------------------

    async def ingest_company_address_clusters(self) -> dict:
        """Create address-level company connectivity and building signal nodes."""
        logger.info("Ingesting company address clusters")
        stats = {
            "clusters_found": 0,
            "building_signal_nodes": 0,
            "shares_address_edges": 0,
            "located_in_edges": 0,
        }

        companies = (await self.session.execute(select(CompanyRegistration))).scalars().all()
        company_graph_rows = await self.session.execute(
            select(GraphNode.source_id, GraphNode.id, GraphNode.district).where(
                GraphNode.source_table == "company_registrations",
                GraphNode.is_canonical.is_(True),
            )
        )
        company_graph_map = {
            row[0]: {"id": row[1], "district": row[2]}
            for row in company_graph_rows.all()
        }

        signature_clusters: dict[str, list[dict[str, Any]]] = {}
        for company in companies:
            signature = self._normalize_address_signature(company.company_address)
            if not signature:
                continue
            graph_info = company_graph_map.get(str(company.id))
            if not graph_info:
                continue
            signature_clusters.setdefault(signature, []).append({
                "company_id": company.id,
                "graph_node_id": graph_info["id"],
                "district": graph_info["district"] or company.district,
            })

        for signature, members in signature_clusters.items():
            if len(members) < 2 or len(members) > 50:
                continue
            stats["clusters_found"] += 1
            district = next((m["district"] for m in members if m["district"]), None)

            building_node_id = await self._upsert_node({
                "node_type": NodeType.PLACE.value,
                "canonical_key": f"address_cluster:{signature[:140]}",
                "title": f"Address Cluster ({len(members)} companies)",
                "district": district,
                "subtype": "building_signal",
                "properties": {
                    "address_signature": signature,
                    "company_count": len(members),
                },
                "source_table": "company_registrations",
                "source_id": f"address_cluster:{signature[:120]}",
                "confidence": 0.6,
            })
            stats["building_signal_nodes"] += 1

            for member in members:
                await self._upsert_edge({
                    "source_node_id": member["graph_node_id"],
                    "target_node_id": building_node_id,
                    "predicate": EdgePredicate.LOCATED_IN.value,
                    "confidence": 0.65,
                    "properties": {"address_cluster_signature": signature},
                    "source_table": "company_registrations",
                    "source_id": str(member["company_id"]),
                })
                stats["located_in_edges"] += 1

            node_ids = [m["graph_node_id"] for m in members]
            for left_id, right_id in combinations(node_ids, 2):
                await self._upsert_edge({
                    "source_node_id": left_id,
                    "target_node_id": right_id,
                    "predicate": EdgePredicate.SHARES_ADDRESS_WITH.value,
                    "confidence": 0.75,
                    "properties": {"address_cluster_signature": signature},
                    "source_table": "company_registrations",
                    "source_id": f"address_cluster:{signature[:120]}",
                })
                stats["shares_address_edges"] += 1

        await self.session.flush()
        logger.info("Company address cluster ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 5. Building nodes from damage zones
    # ------------------------------------------------------------------

    async def ingest_building_zones(self) -> dict:
        """Ingest building/damage nodes and inferred local links."""
        logger.info("Ingesting building nodes from damage zones")
        stats = {"nodes_created": 0, "edges_created": 0, "inferred_entity_links": 0}
        district_node_ids = await self._get_district_node_ids()

        zone_rows = await self.session.execute(
            select(DamageZone, DamageAssessment)
            .join(DamageAssessment, DamageZone.assessment_id == DamageAssessment.id)
            .where(DamageZone.zone_type.in_(["building", "infrastructure", "area"]))
        )

        for zone, assessment in zone_rows.all():
            try:
                districts = assessment.districts or []
                zone_district = await self._normalize_district(districts[0]) if districts else None
                zone_conf = float(zone.confidence or 0.5)

                node_id = await self._upsert_node({
                    "node_type": NodeType.PLACE.value,
                    "canonical_key": f"damage_zone:{zone.id}",
                    "title": zone.zone_name or f"Damage Zone {str(zone.id)[:8]}",
                    "district": zone_district,
                    "latitude": zone.centroid_lat,
                    "longitude": zone.centroid_lng,
                    "subtype": "building" if zone.zone_type in {"building", "infrastructure"} else zone.zone_type,
                    "properties": {
                        "zone_type": zone.zone_type,
                        "severity": zone.severity,
                        "damage_percentage": zone.damage_percentage,
                        "building_type": zone.building_type,
                        "assessment_id": str(assessment.id),
                        "event_name": assessment.event_name,
                        "zone_confidence": zone_conf,
                    },
                    "source_table": "damage_zones",
                    "source_id": str(zone.id),
                    "confidence": zone_conf,
                })
                stats["nodes_created"] += 1

                if zone_district and zone_district in district_node_ids:
                    await self._upsert_edge({
                        "source_node_id": node_id,
                        "target_node_id": district_node_ids[zone_district],
                        "predicate": EdgePredicate.DAMAGED_AREA_IN.value,
                        "confidence": max(zone_conf, 0.5),
                        "source_table": "damage_zones",
                        "source_id": str(zone.id),
                    })
                    stats["edges_created"] += 1

                    nearby_entities = await self.session.execute(
                        select(GraphNode.id)
                        .where(
                            GraphNode.is_canonical.is_(True),
                            GraphNode.district == zone_district,
                            GraphNode.source_table.in_(["company_registrations", "political_entities"]),
                        )
                        .limit(5)
                    )
                    for (entity_node_id,) in nearby_entities.all():
                        await self._upsert_edge({
                            "source_node_id": node_id,
                            "target_node_id": entity_node_id,
                            "predicate": EdgePredicate.AFFECTED_BY.value,
                            "confidence": max(0.3, min(0.85, zone_conf * 0.7)),
                            "properties": {"inferred": True, "method": "district_overlap"},
                            "source_table": "damage_zones",
                            "source_id": str(zone.id),
                        })
                        stats["edges_created"] += 1
                        stats["inferred_entity_links"] += 1
            except Exception as e:
                logger.warning("Error ingesting damage zone %s: %s", zone.id, e)

        await self.session.flush()
        logger.info("Building zone ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 6. Political entities
    # ------------------------------------------------------------------

    async def ingest_political_entities(self) -> dict:
        """Ingest political_entities as graph_nodes (type=person/organization).

        Creates ``member_of`` edges to party organization nodes.
        """
        logger.info("Ingesting political entities")
        stats = {"nodes_created": 0, "edges_created": 0}

        stmt = select(PoliticalEntity)
        result = await self.session.execute(stmt)
        entities = result.scalars().all()

        # Party nodes cache
        party_node_ids: dict[str, UUID] = {}

        for entity in entities:
            try:
                node_type = NodeType.PERSON.value
                if entity.entity_type in (EntityType.PARTY, EntityType.ORGANIZATION, EntityType.INSTITUTION):
                    node_type = NodeType.ORGANIZATION.value

                properties: dict[str, Any] = {}
                if entity.party:
                    properties["party"] = entity.party
                if entity.role:
                    properties["role"] = entity.role
                if entity.aliases:
                    properties["aliases"] = entity.aliases
                if entity.gender:
                    properties["gender"] = entity.gender
                if entity.age:
                    properties["age"] = entity.age

                node_id = await self._upsert_node({
                    "node_type": node_type,
                    "canonical_key": f"political_entity:{entity.canonical_id}",
                    "title": entity.name_en,
                    "title_ne": entity.name_ne,
                    "subtitle": entity.current_position or entity.role,
                    "description": entity.biography,
                    "image_url": entity.image_url,
                    "subtype": entity.entity_type.value,
                    "properties": properties,
                    "source_table": "political_entities",
                    "source_id": str(entity.id),
                    "confidence": 0.95,
                })
                stats["nodes_created"] += 1

                # member_of edge to party
                if entity.party and entity.entity_type == EntityType.PERSON:
                    party_key = entity.party.strip()
                    if party_key not in party_node_ids:
                        party_id = await self._upsert_node({
                            "node_type": NodeType.ORGANIZATION.value,
                            "canonical_key": f"party:{party_key.lower().replace(' ', '_')}",
                            "title": party_key,
                            "subtype": "party",
                            "source_table": "political_entities",
                            "source_id": f"party_{party_key}",
                            "confidence": 0.95,
                        })
                        party_node_ids[party_key] = party_id

                    await self._upsert_edge({
                        "source_node_id": node_id,
                        "target_node_id": party_node_ids[party_key],
                        "predicate": EdgePredicate.MEMBER_OF.value,
                        "confidence": 0.9,
                        "source_table": "political_entities",
                        "source_id": str(entity.id),
                    })
                    stats["edges_created"] += 1

            except Exception as e:
                logger.warning("Error ingesting political entity %s: %s", entity.id, e)

        await self.session.flush()
        logger.info("Political entities ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 4. Candidates
    # ------------------------------------------------------------------

    async def ingest_candidates(self) -> dict:
        """Ingest candidate dual model: canonical person + election candidacy nodes."""
        logger.info("Ingesting candidates")
        stats = {"nodes_created": 0, "edges_created": 0, "identity_bridges": 0}

        # Pre-load elections and constituencies
        election_node_ids: dict[UUID, UUID] = {}
        constituency_node_ids: dict[UUID, UUID] = {}
        constituency_districts: dict[UUID, str] = {}
        political_entity_node_ids: dict[UUID, UUID] = {}

        # Pre-load political entity graph nodes for linked candidate identities
        pe_rows = await self.session.execute(
            select(GraphNode.source_id, GraphNode.id).where(
                GraphNode.source_table == "political_entities",
                GraphNode.is_canonical.is_(True),
            )
        )
        for source_id, node_id in pe_rows.all():
            try:
                political_entity_node_ids[UUID(str(source_id))] = node_id
            except Exception:
                continue

        # Create election nodes
        elections = (await self.session.execute(select(Election))).scalars().all()
        for election in elections:
            eid = await self._upsert_node({
                "node_type": NodeType.EVENT.value,
                "canonical_key": f"election:{election.year_bs}",
                "title": f"Election {election.year_bs} ({election.year_ad})",
                "subtype": election.election_type,
                "properties": {
                    "year_bs": election.year_bs,
                    "year_ad": election.year_ad,
                    "status": election.status,
                },
                "source_table": "elections",
                "source_id": str(election.id),
                "confidence": 1.0,
            })
            election_node_ids[election.id] = eid

        # Create constituency nodes
        district_node_ids = await self._get_district_node_ids()
        constituencies = (await self.session.execute(select(Constituency))).scalars().all()
        for const in constituencies:
            cid = await self._upsert_node({
                "node_type": NodeType.PLACE.value,
                "canonical_key": f"constituency:{const.constituency_code}:{const.election_id}",
                "title": const.name_en,
                "title_ne": const.name_ne,
                "district": const.district,
                "province": const.province,
                "subtype": "constituency",
                "source_table": "constituencies",
                "source_id": str(const.id),
                "confidence": 1.0,
            })
            constituency_node_ids[const.id] = cid
            constituency_districts[const.id] = const.district

            # Standardized hierarchy edge: district -> constituency
            norm_dist = await self._normalize_district(const.district)
            if norm_dist and norm_dist in district_node_ids:
                await self._upsert_edge({
                    "source_node_id": district_node_ids[norm_dist],
                    "target_node_id": cid,
                    "predicate": EdgePredicate.PARENT_OF.value,
                    "confidence": 1.0,
                    "source_table": "constituencies",
                    "source_id": str(const.id),
                })

        # Ingest candidates
        offset = 0
        batch_size = 1000
        while True:
            stmt = select(Candidate).order_by(Candidate.id).offset(offset).limit(batch_size)
            result = await self.session.execute(stmt)
            candidates = result.scalars().all()
            if not candidates:
                break

            for cand in candidates:
                try:
                    candidacy_properties: dict[str, Any] = {
                        "party": cand.party,
                        "votes": cand.votes,
                        "vote_pct": cand.vote_pct,
                        "rank": cand.rank,
                        "is_winner": cand.is_winner,
                        "candidate_external_id": cand.external_id,
                    }
                    if cand.age:
                        candidacy_properties["age"] = cand.age
                    if cand.gender:
                        candidacy_properties["gender"] = cand.gender

                    # 1) Election-specific candidacy node (preserves historical runs)
                    candidacy_node_id = await self._upsert_node({
                        "node_type": NodeType.PERSON.value,
                        "canonical_key": f"candidate:{cand.external_id}:{cand.election_id}",
                        "title": cand.name_en,
                        "title_ne": cand.name_ne,
                        "subtitle": cand.party,
                        "image_url": cand.photo_url,
                        "subtype": "candidacy",
                        "properties": candidacy_properties,
                        "source_table": "candidates",
                        "source_id": str(cand.id),
                        "confidence": 0.95,
                    })
                    stats["nodes_created"] += 1

                    # 2) Canonical identity node (political_entity when linked; otherwise person seed)
                    canonical_person_node_id: UUID
                    if cand.linked_entity_id and cand.linked_entity_id in political_entity_node_ids:
                        canonical_person_node_id = political_entity_node_ids[cand.linked_entity_id]
                    else:
                        canonical_person_node_id = await self._upsert_node({
                            "node_type": NodeType.PERSON.value,
                            "canonical_key": f"candidate_person:{cand.external_id}",
                            "title": cand.name_en,
                            "title_ne": cand.name_ne,
                            "subtitle": cand.party,
                            "image_url": cand.photo_url,
                            "subtype": "candidate_identity",
                            "district": constituency_districts.get(cand.constituency_id),
                            "properties": {
                                "candidate_external_id": cand.external_id,
                                "party": cand.party,
                                "age": cand.age,
                                "gender": cand.gender,
                            },
                            "source_table": "candidates",
                            "source_id": str(cand.id),
                            "confidence": 0.9,
                        })
                        stats["nodes_created"] += 1

                    # 3) Bridge candidacy to canonical person for dual representation.
                    await self._upsert_edge({
                        "source_node_id": canonical_person_node_id,
                        "target_node_id": candidacy_node_id,
                        "predicate": EdgePredicate.IDENTITY_OF_CANDIDACY.value,
                        "confidence": 1.0,
                        "source_table": "candidates",
                        "source_id": str(cand.id),
                    })
                    stats["edges_created"] += 1
                    stats["identity_bridges"] += 1

                    # elected_from edge to constituency (from candidacy node)
                    if cand.constituency_id in constituency_node_ids:
                        await self._upsert_edge({
                            "source_node_id": candidacy_node_id,
                            "target_node_id": constituency_node_ids[cand.constituency_id],
                            "predicate": EdgePredicate.ELECTED_FROM.value,
                            "confidence": 1.0 if cand.is_winner else 0.8,
                            "source_table": "candidates",
                            "source_id": str(cand.id),
                        })
                        stats["edges_created"] += 1

                    # candidate_in edge to election (from candidacy node)
                    if cand.election_id in election_node_ids:
                        await self._upsert_edge({
                            "source_node_id": candidacy_node_id,
                            "target_node_id": election_node_ids[cand.election_id],
                            "predicate": EdgePredicate.CANDIDATE_IN.value,
                            "confidence": 1.0,
                            "source_table": "candidates",
                            "source_id": str(cand.id),
                        })
                        stats["edges_created"] += 1

                except Exception as e:
                    logger.warning("Error ingesting candidate %s: %s", cand.id, e)

            await self.session.flush()
            offset += batch_size

        logger.info("Candidates ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 5. Stories
    # ------------------------------------------------------------------

    async def ingest_stories(self, batch_size: int = 500) -> dict:
        """Ingest stories as graph_nodes (type=story).

        Creates ``mentioned_in`` edges from entity graph nodes to story nodes
        (via story_entity_links).  Creates ``story_in`` edges to district nodes
        from the story's district classification.
        """
        logger.info("Ingesting stories (batch_size=%d)", batch_size)
        stats = {"nodes_created": 0, "edges_created": 0}

        district_node_ids = await self._get_district_node_ids()

        # Pre-load entity graph node ID map to avoid N+1 SELECTs (HIGH-5).
        # Without this, each story-entity link triggers an individual SELECT,
        # generating ~50K queries for ~10K stories. The map reduces it to 1.
        entity_map_result = await self.session.execute(
            select(GraphNode.source_id, GraphNode.id).where(
                GraphNode.source_table == "political_entities",
                GraphNode.is_canonical.is_(True),
            )
        )
        entity_node_map: dict[str, UUID] = {
            row[0]: row[1] for row in entity_map_result.all()
        }

        offset = 0

        while True:
            stmt = (
                select(Story)
                .order_by(Story.id)
                .offset(offset)
                .limit(batch_size)
            )
            result = await self.session.execute(stmt)
            stories = result.scalars().all()
            if not stories:
                break

            story_ids = [s.id for s in stories]

            # Bulk fetch story_entity_links for this batch
            sel_links = (
                select(StoryEntityLink)
                .where(StoryEntityLink.story_id.in_(story_ids))
            )
            link_result = await self.session.execute(sel_links)
            all_links = link_result.scalars().all()
            links_by_story: dict[UUID, list[StoryEntityLink]] = {}
            for link in all_links:
                links_by_story.setdefault(link.story_id, []).append(link)

            for story in stories:
                try:
                    properties: dict[str, Any] = {}
                    if story.category:
                        properties["category"] = story.category
                    if story.severity:
                        properties["severity"] = story.severity
                    if story.source_name:
                        properties["source_name"] = story.source_name

                    # Determine primary district from story.districts
                    primary_district = None
                    if story.districts and len(story.districts) > 0:
                        primary_district = await self._normalize_district(story.districts[0])

                    node_id = await self._upsert_node({
                        "node_type": NodeType.STORY.value,
                        "canonical_key": f"story:{story.external_id}",
                        "title": story.title[:500],
                        "district": primary_district,
                        "subtype": story.category or "news",
                        "properties": properties,
                        "source_table": "stories",
                        "source_id": str(story.id),
                        "confidence": 0.8,
                        "first_seen_at": story.published_at or story.created_at,
                    })
                    stats["nodes_created"] += 1

                    # story -> district edge
                    if primary_district and primary_district in district_node_ids:
                        await self._upsert_edge({
                            "source_node_id": node_id,
                            "target_node_id": district_node_ids[primary_district],
                            "predicate": EdgePredicate.OCCURRED_IN.value,
                            "confidence": 0.7,
                            "source_table": "stories",
                            "source_id": str(story.id),
                        })
                        stats["edges_created"] += 1

                    # mentioned_in edges from entities to story
                    # Uses pre-loaded entity_node_map instead of per-link SELECT (HIGH-5)
                    for link in links_by_story.get(story.id, []):
                        entity_graph_id = entity_node_map.get(str(link.entity_id))
                        if entity_graph_id:
                            await self._upsert_edge({
                                "source_node_id": entity_graph_id,
                                "target_node_id": node_id,
                                "predicate": EdgePredicate.MENTIONED_IN.value,
                                "confidence": link.confidence or 0.8,
                                "properties": {
                                    "mention_count": link.mention_count,
                                    "is_title_mention": link.is_title_mention,
                                },
                                "source_table": "story_entity_links",
                                "source_id": str(link.id),
                            })
                            stats["edges_created"] += 1

                except Exception as e:
                    logger.warning("Error ingesting story %s: %s", story.id, e)

            await self.session.flush()
            offset += batch_size
            logger.info("Stories ingested: %d nodes, %d edges (offset=%d)", stats["nodes_created"], stats["edges_created"], offset)

        logger.info("Stories ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 6. Disasters
    # ------------------------------------------------------------------

    async def ingest_disasters(self) -> dict:
        """Ingest disaster_incidents + disaster_alerts as graph_nodes (type=event).

        Creates ``occurred_in`` edges to district nodes.
        """
        logger.info("Ingesting disasters")
        stats = {"nodes_created": 0, "edges_created": 0}
        district_node_ids = await self._get_district_node_ids()

        # Incidents
        result = await self.session.execute(select(DisasterIncident))
        incidents = result.scalars().all()

        for inc in incidents:
            try:
                norm_district = await self._normalize_district(inc.district)
                properties: dict[str, Any] = {
                    "hazard_type": inc.hazard_type,
                    "deaths": inc.deaths,
                    "injured": inc.injured,
                    "missing": inc.missing,
                    "affected_families": inc.affected_families,
                    "estimated_loss": inc.estimated_loss,
                    "severity": inc.severity,
                }

                node_id = await self._upsert_node({
                    "node_type": NodeType.EVENT.value,
                    "canonical_key": f"disaster_incident:{inc.bipad_id}",
                    "title": inc.title[:500],
                    "title_ne": inc.title_ne[:500] if inc.title_ne else None,
                    "district": norm_district,
                    "province": str(inc.province) if inc.province else None,
                    "latitude": inc.latitude,
                    "longitude": inc.longitude,
                    "subtype": inc.hazard_type,
                    "properties": properties,
                    "source_table": "disaster_incidents",
                    "source_id": str(inc.id),
                    "confidence": 0.9 if inc.verified else 0.7,
                    "first_seen_at": inc.incident_on,
                })
                stats["nodes_created"] += 1

                if norm_district and norm_district in district_node_ids:
                    await self._upsert_edge({
                        "source_node_id": node_id,
                        "target_node_id": district_node_ids[norm_district],
                        "predicate": EdgePredicate.OCCURRED_IN.value,
                        "confidence": 0.9,
                        "source_table": "disaster_incidents",
                        "source_id": str(inc.id),
                    })
                    stats["edges_created"] += 1

            except Exception as e:
                logger.warning("Error ingesting disaster incident %s: %s", inc.id, e)

        # Alerts
        result = await self.session.execute(select(DisasterAlert))
        alerts = result.scalars().all()

        for alert in alerts:
            try:
                norm_district = await self._normalize_district(alert.district)
                properties = {
                    "alert_type": alert.alert_type,
                    "alert_level": alert.alert_level,
                    "magnitude": alert.magnitude,
                    "depth_km": alert.depth_km,
                    "is_active": alert.is_active,
                }

                node_id = await self._upsert_node({
                    "node_type": NodeType.EVENT.value,
                    "canonical_key": f"disaster_alert:{alert.bipad_id}",
                    "title": alert.title[:500],
                    "district": norm_district,
                    "latitude": alert.latitude,
                    "longitude": alert.longitude,
                    "subtype": alert.alert_type,
                    "properties": properties,
                    "source_table": "disaster_alerts",
                    "source_id": str(alert.id),
                    "confidence": 0.85,
                    "first_seen_at": alert.issued_at,
                })
                stats["nodes_created"] += 1

                if norm_district and norm_district in district_node_ids:
                    await self._upsert_edge({
                        "source_node_id": node_id,
                        "target_node_id": district_node_ids[norm_district],
                        "predicate": EdgePredicate.OCCURRED_IN.value,
                        "confidence": 0.85,
                        "source_table": "disaster_alerts",
                        "source_id": str(alert.id),
                    })
                    stats["edges_created"] += 1

            except Exception as e:
                logger.warning("Error ingesting disaster alert %s: %s", alert.id, e)

        await self.session.flush()
        logger.info("Disasters ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 7. Trade network
    # ------------------------------------------------------------------

    async def ingest_trade_network(self) -> dict:
        """Create commodity, country, and customs office nodes from trade_facts.

        Aggregates trade facts into weighted edges:
          - country -> commodity (imports_from / exports_to)
          - commodity -> customs_office (trades_through)

        Edge weight = sum of value_npr_thousands.
        """
        logger.info("Ingesting trade network")
        stats = {"commodity_nodes": 0, "country_nodes": 0, "customs_nodes": 0, "edges_created": 0}

        # Distinct HS codes
        hs_stmt = (
            select(TradeFact.hs_code, func.max(TradeFact.commodity_description))
            .where(TradeFact.hs_code.isnot(None))
            .group_by(TradeFact.hs_code)
        )
        hs_result = await self.session.execute(hs_stmt)
        hs_node_ids: dict[str, UUID] = {}
        for row in hs_result.all():
            hs_code, desc = row
            if not hs_code:
                continue
            nid = await self._upsert_node({
                "node_type": NodeType.COMMODITY.value,
                "canonical_key": f"hs_code:{hs_code}",
                "title": f"{hs_code}: {desc or 'Unknown'}",
                "subtype": "hs_code",
                "properties": {"hs_code": hs_code, "description": desc},
                "source_table": "trade_facts",
                "source_id": f"hs_{hs_code}",
                "confidence": 1.0,
            })
            hs_node_ids[hs_code] = nid
            stats["commodity_nodes"] += 1

        # Distinct countries
        country_stmt = (
            select(func.distinct(TradeFact.partner_country))
            .where(TradeFact.partner_country.isnot(None))
        )
        country_result = await self.session.execute(country_stmt)
        country_node_ids: dict[str, UUID] = {}
        for (country,) in country_result.all():
            if not country:
                continue
            nid = await self._upsert_node({
                "node_type": NodeType.COUNTRY.value,
                "canonical_key": f"country:{country.lower().strip()}",
                "title": country.strip(),
                "subtype": "country",
                "source_table": "trade_facts",
                "source_id": f"country_{country}",
                "confidence": 1.0,
            })
            country_node_ids[country] = nid
            stats["country_nodes"] += 1

        # Distinct customs offices
        customs_stmt = (
            select(func.distinct(TradeFact.customs_office))
            .where(TradeFact.customs_office.isnot(None))
        )
        customs_result = await self.session.execute(customs_stmt)
        customs_node_ids: dict[str, UUID] = {}
        for (office,) in customs_result.all():
            if not office:
                continue
            nid = await self._upsert_node({
                "node_type": NodeType.PLACE.value,
                "canonical_key": f"customs_office:{office.lower().strip()}",
                "title": office.strip(),
                "subtype": "customs_office",
                "source_table": "trade_facts",
                "source_id": f"customs_{office}",
                "confidence": 1.0,
            })
            customs_node_ids[office] = nid
            stats["customs_nodes"] += 1

        # Anchor customs offices to districts in unified graph.
        district_node_ids = await self._get_district_node_ids()
        for office, customs_node_id in customs_node_ids.items():
            district_name = await self._infer_customs_district(office)
            if not district_name:
                continue
            district_node_id = district_node_ids.get(district_name)
            if not district_node_id:
                continue
            await self._upsert_edge({
                "source_node_id": customs_node_id,
                "target_node_id": district_node_id,
                "predicate": EdgePredicate.LOCATED_IN.value,
                "confidence": 0.65,
                "properties": {
                    "inferred": True,
                    "method": "customs_office_name_to_district",
                },
                "source_table": "trade_facts",
                "source_id": f"customs_district:{office[:80]}",
            })
            stats["edges_created"] += 1

        await self.session.flush()

        # Aggregate trade edges: group by (direction, partner_country, hs_code)
        agg_stmt = text("""
            SELECT
                direction,
                partner_country,
                hs_code,
                customs_office,
                SUM(value_npr_thousands) AS total_value,
                COUNT(*) AS fact_count
            FROM trade_facts
            WHERE partner_country IS NOT NULL
              AND hs_code IS NOT NULL
            GROUP BY direction, partner_country, hs_code, customs_office
            HAVING SUM(value_npr_thousands) > 0
        """)
        agg_result = await self.session.execute(agg_stmt)

        for row in agg_result.all():
            try:
                direction, country, hs_code, customs_office, total_value, fact_count = row

                country_nid = country_node_ids.get(country)
                hs_nid = hs_node_ids.get(hs_code)
                customs_nid = customs_node_ids.get(customs_office) if customs_office else None

                if not country_nid or not hs_nid:
                    continue

                # country <-> commodity edge
                if direction == TradeDirection.IMPORT.value:
                    await self._upsert_edge({
                        "source_node_id": country_nid,
                        "target_node_id": hs_nid,
                        "predicate": EdgePredicate.IMPORTS_FROM.value,
                        "weight": float(total_value),
                        "confidence": 0.95,
                        "properties": {
                            "total_value_npr_thousands": float(total_value),
                            "fact_count": fact_count,
                        },
                        "source_table": "trade_facts",
                        "source_id": f"agg_{direction}_{country}_{hs_code}",
                    })
                    stats["edges_created"] += 1
                elif direction == TradeDirection.EXPORT.value:
                    await self._upsert_edge({
                        "source_node_id": hs_nid,
                        "target_node_id": country_nid,
                        "predicate": EdgePredicate.EXPORTS_TO.value,
                        "weight": float(total_value),
                        "confidence": 0.95,
                        "properties": {
                            "total_value_npr_thousands": float(total_value),
                            "fact_count": fact_count,
                        },
                        "source_table": "trade_facts",
                        "source_id": f"agg_{direction}_{country}_{hs_code}",
                    })
                    stats["edges_created"] += 1

                # commodity -> customs_office edge
                if customs_nid:
                    await self._upsert_edge({
                        "source_node_id": hs_nid,
                        "target_node_id": customs_nid,
                        "predicate": EdgePredicate.TRADES_THROUGH.value,
                        "weight": float(total_value),
                        "confidence": 0.95,
                        "properties": {
                            "direction": direction,
                            "total_value_npr_thousands": float(total_value),
                        },
                        "source_table": "trade_facts",
                        "source_id": f"agg_{direction}_{hs_code}_{customs_office}",
                    })
                    stats["edges_created"] += 1

            except Exception as e:
                logger.warning("Error creating trade edge: %s", e)

        await self.session.flush()
        logger.info("Trade network ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 8. Phone hash clusters
    # ------------------------------------------------------------------

    # Allowlist of valid hash columns for phone cluster queries (defense-in-depth)
    _VALID_HASH_FIELDS = frozenset({"phone_hash", "mobile_hash"})

    # Pre-built SQL templates for each allowed hash field (avoids f-string interpolation)
    _PHONE_CLUSTER_QUERIES = {
        "phone_hash": text("""
            SELECT phone_hash, array_agg(company_id) AS company_ids
            FROM ird_enrichments
            WHERE phone_hash IS NOT NULL
              AND company_id IS NOT NULL
            GROUP BY phone_hash
            HAVING COUNT(*) > 1 AND COUNT(*) <= 50
        """),
        "mobile_hash": text("""
            SELECT mobile_hash, array_agg(company_id) AS company_ids
            FROM ird_enrichments
            WHERE mobile_hash IS NOT NULL
              AND company_id IS NOT NULL
            GROUP BY mobile_hash
            HAVING COUNT(*) > 1 AND COUNT(*) <= 50
        """),
    }

    async def ingest_phone_clusters(self) -> dict:
        """Find companies sharing the same phone_hash or mobile_hash from ird_enrichments.

        Creates ``shares_phone_with`` edges between company graph_nodes.
        Confidence: 0.95.
        """
        logger.info("Ingesting phone hash clusters")
        stats = {"edges_created": 0, "clusters_found": 0}

        for hash_field in ["phone_hash", "mobile_hash"]:
            # Validate against allowlist (defense-in-depth against future refactoring)
            if hash_field not in self._VALID_HASH_FIELDS:
                raise ValueError(f"Invalid hash field: {hash_field}")

            # Use pre-built SQL template instead of f-string interpolation
            cluster_sql = self._PHONE_CLUSTER_QUERIES[hash_field]
            result = await self.session.execute(cluster_sql)
            clusters = result.all()

            for row in clusters:
                hash_val, company_ids = row
                if not company_ids or len(company_ids) < 2:
                    continue

                stats["clusters_found"] += 1

                # Look up graph node IDs for these companies
                node_ids_stmt = (
                    select(GraphNode.id, GraphNode.source_id)
                    .where(
                        GraphNode.source_table == "company_registrations",
                        GraphNode.source_id.in_([str(cid) for cid in company_ids if cid]),
                        GraphNode.is_canonical.is_(True),
                    )
                )
                node_result = await self.session.execute(node_ids_stmt)
                graph_nodes = node_result.all()

                if len(graph_nodes) < 2:
                    continue

                # Create edges between all pairs in the cluster
                graph_node_ids = [row[0] for row in graph_nodes]
                for i in range(len(graph_node_ids)):
                    for j in range(i + 1, len(graph_node_ids)):
                        try:
                            await self._upsert_edge({
                                "source_node_id": graph_node_ids[i],
                                "target_node_id": graph_node_ids[j],
                                "predicate": EdgePredicate.SHARES_PHONE_WITH.value,
                                "weight": 1.0,
                                "confidence": 0.95,
                                "properties": {"hash_type": hash_field},
                                "source_table": "ird_enrichments",
                                "source_id": f"{hash_field}:{hash_val[:16]}",
                            })
                            stats["edges_created"] += 1
                        except Exception as e:
                            logger.warning("Error creating phone cluster edge: %s", e)

            await self.session.flush()

        logger.info("Phone clusters ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 9. DFIMS development finance organizations
    # ------------------------------------------------------------------

    async def ingest_dfims_organizations(self) -> dict:
        """Ingest DFIMS organizations from political_entities into the graph.

        Creates graph_nodes (type=organization) for DFIMS entities and FUNDS
        edges to matched company graph_nodes via fuzzy name matching.
        """
        logger.info("Ingesting DFIMS organizations into graph")
        stats = {"nodes_created": 0, "edges_created": 0, "matches_found": 0}

        # Load DFIMS political entities
        stmt = select(PoliticalEntity).where(
            PoliticalEntity.extra_data["source"].astext == "dfims"
        )
        result = await self.session.execute(stmt)
        dfims_entities = result.scalars().all()

        if not dfims_entities:
            logger.info("No DFIMS entities found in political_entities — skipping")
            return stats

        for entity in dfims_entities:
            try:
                dfims_data = entity.extra_data or {}
                properties: dict[str, Any] = {}
                if entity.role:
                    properties["role"] = entity.role
                if entity.aliases:
                    properties["aliases"] = entity.aliases
                if dfims_data.get("abbreviation"):
                    properties["abbreviation"] = dfims_data["abbreviation"]
                if dfims_data.get("partner_architecture"):
                    properties["partner_architecture"] = dfims_data["partner_architecture"]
                if dfims_data.get("development_cooperation_group"):
                    properties["development_cooperation_group"] = dfims_data["development_cooperation_group"]

                node_id = await self._upsert_node({
                    "node_type": NodeType.ORGANIZATION.value,
                    "canonical_key": f"dfims_org:{dfims_data.get('dfims_id', entity.canonical_id)}",
                    "title": entity.name_en,
                    "title_ne": entity.name_ne,
                    "subtitle": dfims_data.get("abbreviation") or entity.role,
                    "subtype": "development_partner",
                    "properties": properties,
                    "source_table": "political_entities",
                    "source_id": str(entity.id),
                    "confidence": 0.9,
                })
                stats["nodes_created"] += 1

            except Exception as e:
                logger.warning("Error ingesting DFIMS entity %s: %s", entity.canonical_id, e)

        # Fuzzy match DFIMS nodes against existing company nodes
        from app.services.entity_linker import _fuzzy_name_score

        dfims_nodes_result = await self.session.execute(
            select(GraphNode.id, GraphNode.title).where(
                GraphNode.subtype == "development_partner",
                GraphNode.is_canonical.is_(True),
            )
        )
        dfims_nodes = dfims_nodes_result.all()

        company_nodes_result = await self.session.execute(
            select(GraphNode.id, GraphNode.title).where(
                GraphNode.source_table == "company_registrations",
                GraphNode.is_canonical.is_(True),
            )
        )
        company_nodes = company_nodes_result.all()

        if dfims_nodes and company_nodes:
            # Build inverted token index for fast candidate lookup
            STOP_WORDS = {
                "pvt", "ltd", "private", "limited", "nepal", "the", "of", "and",
                "for", "in", "co", "company", "inc", "international", "national",
                "foundation", "center", "centre", "institute", "development",
                "association", "organization", "organisation", "society", "service",
                "services", "group", "council",
            }
            token_to_companies: dict[str, list[int]] = {}
            for idx, (_, comp_title) in enumerate(company_nodes):
                tokens = set(comp_title.lower().split()) - STOP_WORDS
                for token in tokens:
                    if len(token) >= 3:
                        token_to_companies.setdefault(token, []).append(idx)

            for dfims_id, dfims_title in dfims_nodes:
                # Pre-filter: only compare companies sharing significant tokens
                entity_tokens = set(dfims_title.lower().split()) - STOP_WORDS
                candidate_indices: set[int] = set()
                for token in entity_tokens:
                    if len(token) >= 3:
                        candidate_indices.update(token_to_companies.get(token, []))

                best_score = 0.0
                best_company_id = None

                for idx in candidate_indices:
                    comp_id, comp_title = company_nodes[idx]
                    score = _fuzzy_name_score(dfims_title, comp_title)
                    if score > best_score:
                        best_score = score
                        best_company_id = comp_id

                if best_score >= 0.80 and best_company_id:
                    await self._upsert_edge({
                        "source_node_id": dfims_id,
                        "target_node_id": best_company_id,
                        "predicate": EdgePredicate.FUNDS.value,
                        "weight": best_score,
                        "confidence": best_score,
                        "properties": {
                            "match_score": round(best_score, 4),
                            "inferred": True,
                            "method": "fuzzy_name_match",
                        },
                        "source_table": "dfims",
                        "source_id": f"fm:{str(dfims_id)[:16]}:{str(best_company_id)[:16]}",
                    })
                    stats["edges_created"] += 1
                    stats["matches_found"] += 1

        await self.session.flush()
        logger.info("DFIMS graph ingestion complete: %s", stats)
        return stats

    # ------------------------------------------------------------------
    # 10. Ingestion orchestrator (full + selective phases with checkpoints)
    # ------------------------------------------------------------------

    async def run_full_ingestion(self) -> dict:
        """Run every ingestion phase in canonical order."""
        return await self.run_ingestion(phases=None)

    async def run_ingestion(self, phases: list[str] | None = None) -> dict:
        """Run selected phases with resumable run+step checkpoints."""
        expanded_phases = self._expand_requested_phases(phases)
        logger.info("Starting graph ingestion phases=%s", expanded_phases)

        run = GraphIngestionRun(
            status="running",
            phases=expanded_phases,
            rows_processed=0,
            errors=[],
            started_at=datetime.now(timezone.utc),
        )
        self.session.add(run)
        await self.session.flush()

        combined: dict[str, Any] = {}
        total_rows_processed = 0
        run_errors: list[dict[str, Any]] = []

        for phase in expanded_phases:
            method_name = self._PHASE_TO_METHOD[phase]
            method = getattr(self, method_name)
            step = GraphIngestionRunStep(
                run_id=run.id,
                phase=phase,
                status="running",
                started_at=datetime.now(timezone.utc),
            )
            self.session.add(step)
            await self.session.flush()
            try:
                logger.info("Running ingestion step: %s", phase)
                result = await method()
                rows_processed = self._estimate_rows_processed(result)
                step.status = "completed"
                step.rows_processed = rows_processed
                step.finished_at = datetime.now(timezone.utc)
                combined[phase] = result
                total_rows_processed += rows_processed
            except Exception as e:
                logger.error("Error in ingestion step %s: %s", phase, e, exc_info=True)
                step.status = "failed"
                step.errors = [{"error": str(e)}]
                step.finished_at = datetime.now(timezone.utc)
                combined[phase] = {"error": str(e)}
                run_errors.append({"phase": phase, "error": str(e)})

        run.status = "completed" if not run_errors else "completed_with_errors"
        run.rows_processed = total_rows_processed
        run.errors = run_errors
        run.finished_at = datetime.now(timezone.utc)

        await self.session.commit()
        await self._refresh_domain_connectivity_mv()
        logger.info(
            "Graph ingestion finished run_id=%s status=%s phases=%d",
            run.id, run.status, len(expanded_phases),
        )
        return {
            "run_id": str(run.id),
            "status": run.status,
            "phases_executed": expanded_phases,
            "rows_processed": total_rows_processed,
            "steps": combined,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_district_node_ids(self) -> dict[str, UUID]:
        """Get a mapping of district name -> graph node ID."""
        stmt = (
            select(GraphNode.title, GraphNode.id)
            .where(
                GraphNode.node_type == NodeType.PLACE.value,
                GraphNode.source_table == "districts",
                GraphNode.is_canonical.is_(True),
            )
        )
        result = await self.session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}

    async def _refresh_domain_connectivity_mv(self) -> None:
        """Refresh materialized view used by graph health checks."""
        try:
            await self.session.execute(text("REFRESH MATERIALIZED VIEW graph_domain_connectivity_mv"))
            await self.session.commit()
        except Exception:
            await self.session.rollback()
