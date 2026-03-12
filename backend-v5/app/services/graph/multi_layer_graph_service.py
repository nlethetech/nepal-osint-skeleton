"""Multi-layer graph service for Palantir-grade Cytoscape visualizations.

Produces Cytoscape-format graph elements across five analytical layers:
  - Trade: Nepal customs/trade flows by country, HS chapter, customs office
  - Geographic: Province/district/constituency hierarchy
  - Political: Entities, parties, relationships, ministerial positions
  - News: Story co-mention networks with entity connections
  - Disaster: Incident geography with cross-domain entity links

Each layer returns stable node/edge IDs suitable for incremental expansion,
and all layers can be merged via ``get_combined_graph``.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select, func, case, or_, and_, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connected_analyst import TradeFact, TradeReport, TradeDirection
from app.models.company import CompanyRegistration
from app.models.political_entity import PoliticalEntity, EntityType
from app.models.entity_relationship import EntityRelationship, RelationshipType
from app.models.election import Election, Constituency, Candidate
from app.models.parliament import MPPerformance
from app.models.ministerial_position import MinisterialPosition
from app.models.story import Story
from app.models.story_entity_link import StoryEntityLink
from app.models.disaster import DisasterIncident
from app.models.procurement import GovtContract
from app.models.procurement_company_link import ProcurementCompanyLink

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Party name normalization
# ---------------------------------------------------------------------------

# Map variant party name (lowercased) → canonical display name
_PARTY_CANONICAL: dict[str, str] = {
    "cpn-uml": "CPN-UML",
    "cpn (uml)": "CPN-UML",
    "cpn(uml)": "CPN-UML",
    "communist party of nepal (unified marxist-leninist)": "CPN-UML",
    "communist party of nepal uml": "CPN-UML",
    "nepali congress": "Nepali Congress",
    "nc": "Nepali Congress",
    "cpn maoist centre": "CPN Maoist Centre",
    "cpn-maoist centre": "CPN Maoist Centre",
    "cpn (maoist centre)": "CPN Maoist Centre",
    "cpn-mc": "CPN Maoist Centre",
    "cpn (maoist center)": "CPN Maoist Centre",
    "maoist centre": "CPN Maoist Centre",
    "rastriya swatantra party": "Rastriya Swatantra Party",
    "rsp": "Rastriya Swatantra Party",
    "janata samajbadi party": "Janata Samajbadi Party",
    "janata samajwadi party": "Janata Samajbadi Party",
    "jsp": "Janata Samajbadi Party",
    "cpn (unified socialist)": "CPN (Unified Socialist)",
    "cpn-unified socialist": "CPN (Unified Socialist)",
    "cpn unified socialist": "CPN (Unified Socialist)",
    "independent": "Independent",
    "rpp": "RPP",
    "rpp nepal": "RPP Nepal",
    "loktantrik samajbadi party": "Loktantrik Samajbadi Party",
    "nagarik unmukti party": "Nagarik Unmukti Party",
    "janamat party": "Janamat Party",
    "nepali communist party": "Nepali Communist Party",
    "nepal workers peasants party": "Nepal Workers Peasants Party",
}


def _normalize_party(name: str | None) -> str:
    """Normalize a party name string to its canonical form."""
    if not name:
        return ""
    stripped = name.strip()
    return _PARTY_CANONICAL.get(stripped.lower(), stripped)

# ---------------------------------------------------------------------------
# Hardcoded reference data
# ---------------------------------------------------------------------------

HS_CHAPTER_DESCRIPTIONS: dict[str, str] = {
    "01": "Animals", "02": "Meat", "03": "Fish", "04": "Dairy",
    "07": "Vegetables", "09": "Coffee/Tea", "10": "Cereals",
    "15": "Fats/Oils", "17": "Sugar", "22": "Beverages",
    "25": "Salt/Cement", "27": "Mineral fuels", "28": "Chemicals",
    "30": "Pharma", "39": "Plastics", "40": "Rubber",
    "44": "Wood", "48": "Paper", "52": "Cotton",
    "54": "Man-made fibers", "61": "Knitted apparel",
    "62": "Woven apparel", "63": "Made-up textiles",
    "71": "Precious metals", "72": "Iron/Steel",
    "73": "Iron/steel articles", "76": "Aluminium",
    "84": "Machinery", "85": "Electrical machinery",
    "87": "Vehicles", "97": "Works of art",
}

CUSTOMS_DISTRICT_MAP: dict[str, str] = {
    "BIRGUNJ": "Parsa", "BIRATNAGAR": "Morang", "BHAIRAHAWA": "Rupandehi",
    "TATOPANI": "Sindhupalchok", "RASUWA": "Rasuwa", "MECHI": "Jhapa",
    "TI_AIRPORT": "Kathmandu", "KAILALI": "Kailali", "NEPALGUNJ": "Banke",
    "MAHENDRANAGAR": "Kanchanpur", "JANAKPUR": "Dhanusha", "JALESHWAR": "Mahottari",
    "KRISHNANAGAR": "Kapilvastu", "BHAJANI": "Kailali", "TRIBHUVAN_AIRPORT": "Kathmandu",
    "KODARI": "Sindhupalchok", "KAKARBHITTA": "Jhapa", "GAUR": "Rautahat",
    "DARCHULA": "Darchula", "GADDACHAUKI": "Kanchanpur", "BHADRAPUR": "Jhapa",
    "PASHUPATINAGAR": "Ilam", "RANI": "Morang", "SIDDHARTHANAGAR": "Rupandehi",
    "DHANGADHI": "Kailali", "MATATIRTHA": "Kathmandu", "TIMURE": "Rasuwa",
    "HILSA": "Humla", "OLANGCHUNGGOLA": "Taplejung", "KIMATHANKA": "Sankhuwasabha",
    "YARI": "Humla", "NECHUNG": "Mustang", "LOMANTHANG": "Mustang",
    "KORALA": "Mustang", "MUGU": "Mugu", "TINKER": "Bajhang",
    "RASUWAGADHI": "Rasuwa", "DRY_PORT_BIRGUNJ": "Parsa",
}

# Reverse lookup: district -> list of customs offices
_DISTRICT_CUSTOMS_MAP: dict[str, list[str]] = {}
for _office, _district in CUSTOMS_DISTRICT_MAP.items():
    _DISTRICT_CUSTOMS_MAP.setdefault(_district, []).append(_office)

# Window shorthand to timedelta
_WINDOW_MAP: dict[str, timedelta] = {
    "1d": timedelta(days=1),
    "3d": timedelta(days=3),
    "7d": timedelta(days=7),
    "14d": timedelta(days=14),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90),
}


# ---------------------------------------------------------------------------
# Helper builders
# ---------------------------------------------------------------------------

def _node(node_id: str, label: str, node_type: str, layer: str, **extra: Any) -> dict:
    """Build a single Cytoscape node element."""
    data: dict[str, Any] = {
        "id": node_id,
        "label": label,
        "type": node_type,
        "layer": layer,
    }
    data.update(extra)
    return {"data": data}


def _edge(source: str, target: str, edge_type: str, layer: str, *, _suffix: str = "", **extra: Any) -> dict:
    """Build a single Cytoscape edge element.

    ``_suffix`` is appended to the auto-generated edge ID to disambiguate
    multiple edges with the same (source, target, type) triple — e.g.
    multiple PM terms for the same person.
    """
    edge_id = f"{source}-{edge_type}-{target}"
    if _suffix:
        edge_id = f"{edge_id}:{_suffix}"
    data: dict[str, Any] = {
        "id": edge_id,
        "source": source,
        "target": target,
        "edgeType": edge_type,
        "layer": layer,
    }
    data.update(extra)
    return {"data": data}


def _cyto_response(
    nodes: list[dict],
    edges: list[dict],
    layers: list[str],
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Wrap nodes/edges into the standard Cytoscape response envelope."""
    return {
        "elements": {"nodes": nodes, "edges": edges},
        "stats": {
            "nodeCount": len(nodes),
            "edgeCount": len(edges),
            "layers": layers,
        },
        "metadata": metadata or {},
    }


def _safe_str(value: Any) -> str:
    """Coerce a value to a non-None string, stripping whitespace."""
    if value is None:
        return ""
    return str(value).strip()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class MultiLayerGraphService:
    """Builds multi-layer Cytoscape graph payloads from Nepal OSINT v5 data."""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # ------------------------------------------------------------------
    # 1. Trade graph
    # ------------------------------------------------------------------

    async def get_trade_graph(
        self,
        fiscal_year_bs: Optional[str] = None,
        direction: Optional[str] = None,
        top_countries: int = 20,
        top_hs_chapters: int = 15,
        min_value_npr_thousands: float = 0,
        expand_country: Optional[str] = None,
        expand_hs_chapter: Optional[str] = None,
        include_customs: bool = True,
        top_customs: int = 20,
    ) -> dict[str, Any]:
        try:
            # Resolve fiscal year
            available_fy = await self.get_available_fiscal_years()
            if not fiscal_year_bs:
                if available_fy:
                    fiscal_year_bs = available_fy[0]
                else:
                    return _cyto_response([], [], ["trade"], {"availableFiscalYears": []})

            # Base filter: join facts to reports for the fiscal year
            report_ids_sq = (
                select(TradeReport.id)
                .where(TradeReport.fiscal_year_bs == fiscal_year_bs)
                .scalar_subquery()
            )

            value_expr = func.coalesce(
                TradeFact.delta_value_npr_thousands,
                TradeFact.value_npr_thousands,
                0,
            )

            direction_filter = []
            if direction:
                direction_filter.append(TradeFact.direction == direction)

            nodes: list[dict] = []
            edges: list[dict] = []

            # Central Nepal node
            nodes.append(_node("nepal", "Nepal", "nepal", "trade", isCenter=True))

            # ---- Country aggregation ----
            import_val = func.sum(
                case(
                    (TradeFact.direction == "import", value_expr),
                    else_=literal_column("0"),
                )
            ).label("import_val")
            export_val = func.sum(
                case(
                    (TradeFact.direction == "export", value_expr),
                    else_=literal_column("0"),
                )
            ).label("export_val")
            total_val = func.sum(value_expr).label("total_val")

            country_stmt = (
                select(
                    TradeFact.partner_country,
                    import_val,
                    export_val,
                    total_val,
                )
                .where(
                    TradeFact.report_id.in_(report_ids_sq),
                    TradeFact.partner_country.isnot(None),
                    *direction_filter,
                )
                .group_by(TradeFact.partner_country)
                .having(total_val > min_value_npr_thousands)
                .order_by(total_val.desc())
                .limit(top_countries)
            )

            country_rows = (await self.db.execute(country_stmt)).all()
            for row in country_rows:
                country_name = _safe_str(row.partner_country)
                if not country_name:
                    continue
                cid = f"country:{country_name}"
                nodes.append(
                    _node(
                        cid, country_name, "partner_country", "trade",
                        importValue=float(row.import_val or 0),
                        exportValue=float(row.export_val or 0),
                        tradeValue=float(row.total_val or 0),
                    )
                )
                if float(row.import_val or 0) > 0:
                    edges.append(
                        _edge(
                            cid, "nepal", "IMPORTS_FROM", "trade",
                            value=float(row.import_val or 0),
                            weight=float(row.import_val or 0),
                        )
                    )
                if float(row.export_val or 0) > 0:
                    edges.append(
                        _edge(
                            "nepal", cid, "EXPORTS_TO", "trade",
                            value=float(row.export_val or 0),
                            weight=float(row.export_val or 0),
                        )
                    )

            # ---- HS chapter aggregation ----
            hs_chapter_col = func.substr(TradeFact.hs_code, 1, 2).label("hs_chapter")
            hs_stmt = (
                select(
                    hs_chapter_col,
                    import_val,
                    export_val,
                    total_val,
                )
                .where(
                    TradeFact.report_id.in_(report_ids_sq),
                    TradeFact.hs_code.isnot(None),
                    *direction_filter,
                )
                .group_by(hs_chapter_col)
                .having(total_val > min_value_npr_thousands)
                .order_by(total_val.desc())
                .limit(top_hs_chapters)
            )

            hs_rows = (await self.db.execute(hs_stmt)).all()
            for row in hs_rows:
                ch = _safe_str(row.hs_chapter)
                if not ch:
                    continue
                ch_padded = ch.zfill(2)
                desc = HS_CHAPTER_DESCRIPTIONS.get(ch_padded, f"Chapter {ch_padded}")
                hid = f"hs:{ch_padded}"
                nodes.append(
                    _node(
                        hid, f"HS {ch_padded}: {desc}", "hs_chapter", "trade",
                        hsChapter=ch_padded,
                        description=desc,
                        importValue=float(row.import_val or 0),
                        exportValue=float(row.export_val or 0),
                        tradeValue=float(row.total_val or 0),
                    )
                )
                edges.append(
                    _edge("nepal", hid, "TRADES_COMMODITY", "trade", value=float(row.total_val or 0))
                )

            # ---- Expand country: HS breakdown for specific country ----
            if expand_country:
                ec_stmt = (
                    select(
                        hs_chapter_col,
                        import_val,
                        export_val,
                        total_val,
                    )
                    .where(
                        TradeFact.report_id.in_(report_ids_sq),
                        TradeFact.partner_country == expand_country,
                        TradeFact.hs_code.isnot(None),
                        *direction_filter,
                    )
                    .group_by(hs_chapter_col)
                    .having(total_val > 0)
                    .order_by(total_val.desc())
                    .limit(top_hs_chapters)
                )
                ec_rows = (await self.db.execute(ec_stmt)).all()
                parent_cid = f"country:{expand_country}"
                for row in ec_rows:
                    ch = _safe_str(row.hs_chapter).zfill(2)
                    if not ch:
                        continue
                    desc = HS_CHAPTER_DESCRIPTIONS.get(ch, f"Chapter {ch}")
                    hid = f"hs:{ch}"
                    # Ensure node exists (dedup handled at combined level)
                    existing_ids = {n["data"]["id"] for n in nodes}
                    if hid not in existing_ids:
                        nodes.append(
                            _node(
                                hid, f"HS {ch}: {desc}", "hs_chapter", "trade",
                                hsChapter=ch, description=desc,
                                tradeValue=float(row.total_val or 0),
                            )
                        )
                    edges.append(
                        _edge(
                            parent_cid, hid, "TRADES_COMMODITY", "trade",
                            value=float(row.total_val or 0),
                        )
                    )

            # ---- Expand HS chapter: country breakdown for specific chapter ----
            if expand_hs_chapter:
                ch_padded = expand_hs_chapter.zfill(2)
                eh_stmt = (
                    select(
                        TradeFact.partner_country,
                        import_val,
                        export_val,
                        total_val,
                    )
                    .where(
                        TradeFact.report_id.in_(report_ids_sq),
                        func.substr(TradeFact.hs_code, 1, 2) == ch_padded,
                        TradeFact.partner_country.isnot(None),
                        *direction_filter,
                    )
                    .group_by(TradeFact.partner_country)
                    .having(total_val > 0)
                    .order_by(total_val.desc())
                    .limit(top_countries)
                )
                eh_rows = (await self.db.execute(eh_stmt)).all()
                parent_hid = f"hs:{ch_padded}"
                existing_ids = {n["data"]["id"] for n in nodes}
                if parent_hid not in existing_ids:
                    desc = HS_CHAPTER_DESCRIPTIONS.get(ch_padded, f"Chapter {ch_padded}")
                    nodes.append(
                        _node(parent_hid, f"HS {ch_padded}: {desc}", "hs_chapter", "trade",
                              hsChapter=ch_padded, description=desc)
                    )
                for row in eh_rows:
                    country_name = _safe_str(row.partner_country)
                    if not country_name:
                        continue
                    cid = f"country:{country_name}"
                    if cid not in existing_ids:
                        nodes.append(
                            _node(cid, country_name, "partner_country", "trade",
                                  totalValue=float(row.total_val or 0))
                        )
                        existing_ids.add(cid)
                    edges.append(
                        _edge(
                            parent_hid, cid, "TRADES_COMMODITY", "trade",
                            value=float(row.total_val or 0),
                        )
                    )

            # ---- Customs office aggregation ----
            if include_customs:
                customs_stmt = (
                    select(
                        TradeFact.customs_office,
                        import_val,
                        export_val,
                        total_val,
                    )
                    .where(
                        TradeFact.report_id.in_(report_ids_sq),
                        TradeFact.customs_office.isnot(None),
                        *direction_filter,
                    )
                    .group_by(TradeFact.customs_office)
                    .having(total_val > min_value_npr_thousands)
                    .order_by(total_val.desc())
                    .limit(top_customs)
                )
                customs_rows = (await self.db.execute(customs_stmt)).all()
                for row in customs_rows:
                    office = _safe_str(row.customs_office)
                    if not office:
                        continue
                    cuid = f"customs:{office}"
                    district = CUSTOMS_DISTRICT_MAP.get(office.upper())
                    nodes.append(
                        _node(
                            cuid, office, "customs_office", "trade",
                            district=district,
                            importValue=float(row.import_val or 0),
                            exportValue=float(row.export_val or 0),
                            tradeValue=float(row.total_val or 0),
                        )
                    )
                    edges.append(
                        _edge("nepal", cuid, "HAS_CUSTOMS", "trade",
                              value=float(row.total_val or 0))
                    )

                # Customs detail: top import/export partners per customs office
                existing_customs = [
                    n["data"]["id"] for n in nodes if n["data"].get("type") == "customs_office"
                ]
                for customs_nid in existing_customs:
                    office_name = customs_nid.replace("customs:", "")
                    for direction_label, edge_type in [("import", "CUSTOMS_IMPORTS"), ("export", "CUSTOMS_EXPORTS")]:
                        detail_stmt = (
                            select(
                                TradeFact.partner_country,
                                func.sum(value_expr).label("val"),
                            )
                            .where(
                                TradeFact.report_id.in_(report_ids_sq),
                                TradeFact.customs_office == office_name,
                                TradeFact.direction == direction_label,
                                TradeFact.partner_country.isnot(None),
                            )
                            .group_by(TradeFact.partner_country)
                            .having(func.sum(value_expr) > 0)
                            .order_by(func.sum(value_expr).desc())
                            .limit(5)
                        )
                        detail_rows = (await self.db.execute(detail_stmt)).all()
                        existing_ids = {n["data"]["id"] for n in nodes}
                        for drow in detail_rows:
                            country = _safe_str(drow.partner_country)
                            if not country:
                                continue
                            cid = f"country:{country}"
                            if cid not in existing_ids:
                                nodes.append(
                                    _node(cid, country, "partner_country", "trade",
                                          tradeValue=float(drow.val or 0))
                                )
                                existing_ids.add(cid)
                            edges.append(
                                _edge(customs_nid, cid, edge_type, "trade",
                                      value=float(drow.val or 0))
                            )

            return _cyto_response(nodes, edges, ["trade"], {
                "fiscalYear": fiscal_year_bs,
                "availableFiscalYears": available_fy,
                "direction": direction,
            })
        except Exception:
            logger.exception("get_trade_graph failed")
            return _cyto_response([], [], ["trade"], {"error": "trade layer failed"})

    # ------------------------------------------------------------------
    # 2. Geographic graph
    # ------------------------------------------------------------------

    async def get_geographic_graph(
        self,
        expand_province_id: Optional[int] = None,
        expand_district: Optional[str] = None,
    ) -> dict[str, Any]:
        try:
            nodes: list[dict] = []
            edges: list[dict] = []

            # Central Nepal node
            nodes.append(_node("nepal", "Nepal", "nepal", "geographic", isCenter=True))

            # Province nodes from constituencies table
            prov_stmt = (
                select(
                    Constituency.province,
                    Constituency.province_id,
                )
                .distinct()
                .order_by(Constituency.province_id)
            )
            prov_rows = (await self.db.execute(prov_stmt)).all()

            for row in prov_rows:
                pid = f"province:{row.province_id}"
                nodes.append(
                    _node(pid, _safe_str(row.province) or f"Province {row.province_id}",
                          "province", "geographic", provinceId=row.province_id)
                )
                edges.append(_edge("nepal", pid, "HAS_PROVINCE", "geographic"))

            # Expand province -> districts
            if expand_province_id is not None:
                dist_stmt = (
                    select(Constituency.district)
                    .where(Constituency.province_id == expand_province_id)
                    .distinct()
                    .order_by(Constituency.district)
                )
                dist_rows = (await self.db.execute(dist_stmt)).scalars().all()
                parent_pid = f"province:{expand_province_id}"
                for district_name in dist_rows:
                    dn = _safe_str(district_name)
                    if not dn:
                        continue
                    did = f"district:{dn}"
                    nodes.append(_node(did, dn, "district", "geographic",
                                       provinceId=expand_province_id))
                    edges.append(_edge(parent_pid, did, "HAS_DISTRICT", "geographic"))

                    # Customs offices in this district
                    offices = _DISTRICT_CUSTOMS_MAP.get(dn, [])
                    for office in offices:
                        cuid = f"customs:{office}"
                        existing_ids = {n["data"]["id"] for n in nodes}
                        if cuid not in existing_ids:
                            nodes.append(_node(cuid, office, "customs_office", "geographic",
                                               district=dn))
                        edges.append(_edge(did, cuid, "CUSTOMS_IN_DISTRICT", "geographic"))

            # Expand district -> constituencies
            if expand_district:
                const_stmt = (
                    select(Constituency)
                    .where(Constituency.district == expand_district)
                    .order_by(Constituency.constituency_code)
                )
                const_rows = (await self.db.execute(const_stmt)).scalars().all()
                parent_did = f"district:{expand_district}"

                # Ensure district node exists
                existing_ids = {n["data"]["id"] for n in nodes}
                if parent_did not in existing_ids:
                    nodes.append(_node(parent_did, expand_district, "district", "geographic"))

                for c in const_rows:
                    ccode = _safe_str(c.constituency_code)
                    cid = f"constituency:{ccode}"
                    nodes.append(
                        _node(cid, c.name_en or ccode, "constituency", "geographic",
                              code=ccode, district=expand_district,
                              registeredVoters=c.total_registered_voters,
                              turnout=c.turnout_pct,
                              winnerParty=c.winner_party)
                    )
                    edges.append(_edge(parent_did, cid, "HAS_CONSTITUENCY", "geographic"))

            return _cyto_response(nodes, edges, ["geographic"])
        except Exception:
            logger.exception("get_geographic_graph failed")
            return _cyto_response([], [], ["geographic"], {"error": "geographic layer failed"})

    # ------------------------------------------------------------------
    # 3. Entity / political graph
    # ------------------------------------------------------------------

    async def get_entity_political_graph(
        self,
        window: str = "7d",
        min_strength: float = 0.1,
        limit_nodes: int = 100,
        include_parties: bool = True,
        include_constituencies: bool = True,
        include_ministerial: bool = True,
        include_opponents: bool = False,
        include_geographic: bool = True,
        election_year_bs: Optional[int] = None,
    ) -> dict[str, Any]:
        try:
            nodes: list[dict] = []
            edges: list[dict] = []
            seen_entity_ids: set[str] = set()

            # Resolve time window
            delta = _WINDOW_MAP.get(window, timedelta(days=7))
            cutoff = datetime.now(timezone.utc) - delta

            # Fetch entity relationships above strength threshold
            rel_stmt = (
                select(EntityRelationship)
                .where(
                    or_(
                        EntityRelationship.strength_score >= min_strength,
                        EntityRelationship.strength_score.is_(None),
                    )
                )
                .order_by(EntityRelationship.strength_score.desc().nullslast())
                .limit(limit_nodes * 3)
            )
            rel_rows = (await self.db.execute(rel_stmt)).scalars().all()

            # Collect entity UUIDs
            entity_uuids: set = set()
            for rel in rel_rows:
                entity_uuids.add(rel.source_entity_id)
                entity_uuids.add(rel.target_entity_id)

            if not entity_uuids:
                return _cyto_response([], [], ["entity"])

            # Load entities
            ent_stmt = select(PoliticalEntity).where(PoliticalEntity.id.in_(list(entity_uuids)))
            entities_by_id: dict = {
                e.id: e for e in (await self.db.execute(ent_stmt)).scalars().all()
            }

            # Build entity nodes (capped)
            sorted_entities = sorted(
                entities_by_id.values(),
                key=lambda e: e.total_mentions or 0,
                reverse=True,
            )[:limit_nodes]

            allowed_ids = {e.id for e in sorted_entities}
            max_mentions = max((e.total_mentions or 0 for e in sorted_entities), default=1) or 1
            for ent in sorted_entities:
                nid = f"entity:{ent.id}"
                seen_entity_ids.add(nid)
                entity_type_val = ent.entity_type.value if hasattr(ent.entity_type, "value") else str(ent.entity_type)
                raw_mentions = ent.total_mentions or 0
                nodes.append(
                    _node(
                        nid, ent.name_en, entity_type_val, "entity",
                        entityType=entity_type_val,
                        party=ent.party,
                        mentions=raw_mentions,
                        pagerank=round(raw_mentions / max_mentions, 4),
                        trend=ent.trend.value if hasattr(ent.trend, "value") else str(ent.trend),
                    )
                )

            # Build relationship edges (deduplicate by edge signature)
            seen_edge_sigs: set[str] = set()
            for rel in rel_rows:
                if rel.source_entity_id not in allowed_ids or rel.target_entity_id not in allowed_ids:
                    continue
                src = f"entity:{rel.source_entity_id}"
                tgt = f"entity:{rel.target_entity_id}"
                rel_type_str = (
                    rel.relationship_type.value
                    if hasattr(rel.relationship_type, "value")
                    else str(rel.relationship_type)
                )
                # Map DB relationship types to frontend edge types
                edge_type = rel_type_str.upper()
                if edge_type == "PARTY_AFFILIATION":
                    edge_type = "PARTY_MEMBER"
                edge_sig = f"{src}-{edge_type}-{tgt}"
                if edge_sig in seen_edge_sigs:
                    continue
                seen_edge_sigs.add(edge_sig)
                edges.append(
                    _edge(
                        src, tgt, edge_type, "entity",
                        strength=rel.strength_score,
                        coMentions=rel.co_mention_count,
                        confidence=rel.confidence,
                    )
                )

            # ---- Party nodes (deduplicated) ----
            if include_parties:
                # 1. Index PARTY-type entity nodes already in the graph
                #    normalized_name → node_id  (these are the canonical ones)
                party_node_map: dict[str, str] = {}
                for ent in sorted_entities:
                    if ent.entity_type == EntityType.PARTY:
                        canon = _normalize_party(ent.name_en)
                        party_node_map[canon] = f"entity:{ent.id}"

                # 2. For person entities, collect unique normalized party names
                #    and create party nodes ONLY if no PARTY entity covers them.
                for ent in sorted_entities:
                    if ent.party and ent.entity_type != EntityType.PARTY:
                        canon = _normalize_party(ent.party)
                        if canon and canon not in party_node_map:
                            pid = f"party:{canon}"
                            nodes.append(_node(pid, canon, "party", "entity"))
                            party_node_map[canon] = pid

                # 3. Emit PARTY_MEMBER edges (person → canonical party node)
                for ent in sorted_entities:
                    if ent.party and ent.entity_type != EntityType.PARTY:
                        canon = _normalize_party(ent.party)
                        target = party_node_map.get(canon)
                        if target:
                            edges.append(
                                _edge(f"entity:{ent.id}", target,
                                      "PARTY_MEMBER", "entity")
                            )

                # 4. Detect party switches from election data.
                #    If entity ran in 2+ elections under different parties,
                #    emit FORMER_PARTY_MEMBER edges to prior parties.
                if election_year_bs or True:  # always attempt
                    await self._add_party_switch_edges(
                        sorted_entities, party_node_map, nodes, edges
                    )

            # ---- Ministerial positions ----
            if include_ministerial:
                min_stmt = select(MinisterialPosition).order_by(
                    MinisterialPosition.start_date.desc()
                )
                minister_rows = (await self.db.execute(min_stmt)).scalars().all()

                gov_node_added = False
                for mp in minister_rows:
                    # Find matching entity
                    matched_entity: Optional[PoliticalEntity] = None
                    for ent in sorted_entities:
                        if (
                            ent.name_en
                            and mp.person_name_en
                            and ent.name_en.lower() == mp.person_name_en.lower()
                        ):
                            matched_entity = ent
                            break

                    if not matched_entity:
                        continue

                    if not gov_node_added:
                        nodes.append(
                            _node("government:federal", "Federal Government",
                                  "government", "entity")
                        )
                        gov_node_added = True

                    eid = f"entity:{matched_entity.id}"
                    date_suffix = mp.start_date.isoformat() if mp.start_date else str(mp.id)
                    if mp.position_type == "prime_minister":
                        edges.append(
                            _edge(
                                eid, "government:federal", "WAS_PM", "entity",
                                _suffix=date_suffix,
                                startDate=mp.start_date.isoformat() if mp.start_date else None,
                                endDate=mp.end_date.isoformat() if mp.end_date else None,
                                isCurrent=mp.is_current,
                            )
                        )
                    else:
                        ministry_label = mp.ministry or "Government"
                        edges.append(
                            _edge(
                                eid, "government:federal", "WAS_MINISTER_OF", "entity",
                                _suffix=date_suffix,
                                ministry=ministry_label,
                                positionType=mp.position_type,
                                startDate=mp.start_date.isoformat() if mp.start_date else None,
                                endDate=mp.end_date.isoformat() if mp.end_date else None,
                                isCurrent=mp.is_current,
                            )
                        )

            # ---- Constituencies ----
            if include_constituencies:
                # Resolve election year — prefer latest election with declared winners
                if not election_year_bs:
                    ey_stmt = (
                        select(Election.year_bs)
                        .where(
                            Election.id.in_(
                                select(Candidate.election_id)
                                .where(Candidate.is_winner == True)
                                .distinct()
                            )
                        )
                        .order_by(Election.year_bs.desc())
                        .limit(1)
                    )
                    election_year_bs = (await self.db.execute(ey_stmt)).scalar()

                if election_year_bs:
                    election_stmt = (
                        select(Election).where(Election.year_bs == election_year_bs)
                    )
                    election_obj = (await self.db.execute(election_stmt)).scalar()

                    if election_obj:
                        # Build entity name maps for matching candidates to entities
                        entity_ne_map: dict[str, PoliticalEntity] = {}
                        entity_en_map: dict[str, PoliticalEntity] = {}
                        for ent in sorted_entities:
                            if ent.name_ne:
                                entity_ne_map[ent.name_ne.strip()] = ent
                            if ent.name_en:
                                entity_en_map[ent.name_en.strip().lower()] = ent

                        # Get winning candidates for this election
                        win_stmt = (
                            select(Candidate, Constituency)
                            .join(Constituency, Constituency.id == Candidate.constituency_id)
                            .where(
                                Candidate.election_id == election_obj.id,
                                Candidate.is_winner == True,
                            )
                        )
                        win_rows = (await self.db.execute(win_stmt)).all()

                        for cand, const in win_rows:
                            # Match candidate to a political entity by Nepali or English name
                            matched_ent = None
                            if cand.name_ne:
                                matched_ent = entity_ne_map.get(cand.name_ne.strip())
                            if not matched_ent and cand.name_en:
                                matched_ent = entity_en_map.get(cand.name_en.strip().lower())
                            if not matched_ent:
                                continue

                            ccode = _safe_str(const.constituency_code)
                            const_nid = f"constituency:{ccode}"
                            existing_ids = {n["data"]["id"] for n in nodes}
                            if const_nid not in existing_ids:
                                nodes.append(
                                    _node(
                                        const_nid, const.name_en or ccode,
                                        "constituency", "entity",
                                        code=ccode, district=const.district,
                                        province=const.province,
                                        winnerParty=const.winner_party,
                                    )
                                )
                            # Winners get IS_MP
                            edges.append(
                                _edge(
                                    f"entity:{matched_ent.id}", const_nid,
                                    "IS_MP", "entity",
                                    isWinner=True,
                                    votes=cand.votes,
                                    party=cand.party,
                                )
                            )

                            # ---- Opponents in same constituency ----
                            if include_opponents:
                                opp_stmt = (
                                    select(Candidate)
                                    .where(
                                        Candidate.constituency_id == const.id,
                                        Candidate.election_id == election_obj.id,
                                        Candidate.id != cand.id,
                                    )
                                    .order_by(Candidate.votes.desc())
                                    .limit(3)
                                )
                                opp_rows = (await self.db.execute(opp_stmt)).scalars().all()
                                for opp in opp_rows:
                                    opp_nid = f"candidate:{opp.id}"
                                    existing_ids = {n["data"]["id"] for n in nodes}
                                    if opp_nid not in existing_ids:
                                        nodes.append(
                                            _node(
                                                opp_nid, opp.name_en or opp.name_ne or "Unknown",
                                                "person", "entity",
                                                party=opp.party,
                                                votes=opp.votes,
                                                isWinner=opp.is_winner,
                                            )
                                        )
                                    edges.append(
                                        _edge(opp_nid, const_nid, "OPPONENT", "entity",
                                              isWinner=opp.is_winner, votes=opp.votes)
                                    )

                            # ---- Geographic links for constituencies ----
                            if include_geographic and const.district:
                                did = f"district:{const.district}"
                                prov_nid = f"province:{const.province_id}"
                                existing_ids = {n["data"]["id"] for n in nodes}
                                if did not in existing_ids:
                                    nodes.append(
                                        _node(did, const.district, "district", "entity",
                                              provinceId=const.province_id)
                                    )
                                if prov_nid not in existing_ids:
                                    nodes.append(
                                        _node(prov_nid,
                                              _safe_str(const.province) or f"Province {const.province_id}",
                                              "province", "entity",
                                              provinceId=const.province_id)
                                    )
                                edges.append(_edge(const_nid, did, "HAS_DISTRICT", "entity"))
                                edges.append(_edge(did, prov_nid, "HAS_PROVINCE", "entity"))

            # ---- Procurement sub-graph (top contractors & procuring entities) ----
            try:
                contract_stmt = (
                    select(
                        GovtContract.contractor_name,
                        GovtContract.procuring_entity,
                        ProcurementCompanyLink.company_id.label("company_id"),
                        CompanyRegistration.name_english.label("linked_company_name"),
                        func.sum(GovtContract.contract_amount_npr).label("total_amount"),
                        func.count(GovtContract.id).label("contract_count"),
                    )
                    .select_from(GovtContract)
                    .outerjoin(
                        ProcurementCompanyLink,
                        ProcurementCompanyLink.contractor_name == GovtContract.contractor_name,
                    )
                    .outerjoin(
                        CompanyRegistration,
                        CompanyRegistration.id == ProcurementCompanyLink.company_id,
                    )
                    .where(GovtContract.contract_amount_npr.isnot(None))
                    .group_by(
                        GovtContract.contractor_name,
                        GovtContract.procuring_entity,
                        ProcurementCompanyLink.company_id,
                        CompanyRegistration.name_english,
                    )
                    .having(func.sum(GovtContract.contract_amount_npr) > 0)
                    .order_by(func.sum(GovtContract.contract_amount_npr).desc())
                    .limit(50)
                )
                contract_rows = (await self.db.execute(contract_stmt)).all()
                existing_ids = {n["data"]["id"] for n in nodes}
                procurement_contractors: set[str] = set()
                procurement_entities: set[str] = set()
                awarded_contract_edges: dict[tuple[str, str], dict[str, float | int]] = {}

                for row in contract_rows:
                    contractor = _safe_str(row.contractor_name)
                    procuring = _safe_str(row.procuring_entity)
                    if not contractor or not procuring:
                        continue
                    amount = float(row.total_amount or 0)
                    count = int(row.contract_count or 0)

                    # Contractor node
                    linked_company_name = _safe_str(row.linked_company_name)
                    if row.company_id:
                        comp_nid = f"company:ocr:{row.company_id}"
                        comp_label = linked_company_name or contractor[:60]
                    else:
                        comp_nid = f"company:{contractor[:60]}"
                        comp_label = contractor[:60]

                    if comp_nid not in existing_ids:
                        nodes.append(
                            _node(comp_nid, comp_label, "organization", "entity",
                                  entityType="organization",
                                  contractorName=contractor[:160],
                                  totalContractAmount=amount,
                                  contractCount=count)
                        )
                        existing_ids.add(comp_nid)
                        procurement_contractors.add(comp_nid)

                    # Procuring entity node
                    gov_nid = f"govtentity:{procuring[:60]}"
                    if gov_nid not in existing_ids:
                        nodes.append(
                            _node(gov_nid, procuring[:60], "government", "entity",
                                  entityType="government")
                        )
                        existing_ids.add(gov_nid)
                        procurement_entities.add(gov_nid)

                    # AWARDED_CONTRACT edge
                    edge_key = (gov_nid, comp_nid)
                    if edge_key not in awarded_contract_edges:
                        awarded_contract_edges[edge_key] = {"amount": 0.0, "contractCount": 0}
                    awarded_contract_edges[edge_key]["amount"] += amount
                    awarded_contract_edges[edge_key]["contractCount"] += count

                for (gov_nid, comp_nid), payload in awarded_contract_edges.items():
                    edges.append(
                        _edge(
                            gov_nid,
                            comp_nid,
                            "AWARDED_CONTRACT",
                            "entity",
                            amount=float(payload["amount"]),
                            contractCount=int(payload["contractCount"]),
                        )
                    )

                # Cross-link: connect procurement to geographic graph via district
                if procurement_contractors or procurement_entities:
                    district_contracts_stmt = (
                        select(
                            GovtContract.district,
                            GovtContract.contractor_name,
                            ProcurementCompanyLink.company_id.label("company_id"),
                            func.count(GovtContract.id).label("cnt"),
                        )
                        .select_from(GovtContract)
                        .outerjoin(
                            ProcurementCompanyLink,
                            ProcurementCompanyLink.contractor_name == GovtContract.contractor_name,
                        )
                        .where(
                            GovtContract.district.isnot(None),
                            GovtContract.contract_amount_npr.isnot(None),
                        )
                        .group_by(
                            GovtContract.district,
                            GovtContract.contractor_name,
                            ProcurementCompanyLink.company_id,
                        )
                        .having(func.count(GovtContract.id) >= 2)
                        .limit(30)
                    )
                    dc_rows = (await self.db.execute(district_contracts_stmt)).all()
                    district_edges: dict[tuple[str, str], int] = {}
                    for dcr in dc_rows:
                        dn = _safe_str(dcr.district)
                        cn = _safe_str(dcr.contractor_name)[:60]
                        if not dn or not cn:
                            continue
                        did = f"district:{dn}"
                        comp_nid = f"company:ocr:{dcr.company_id}" if dcr.company_id else f"company:{cn}"
                        if did not in existing_ids:
                            nodes.append(_node(did, dn, "district", "entity"))
                            existing_ids.add(did)
                        if comp_nid in existing_ids:
                            edge_key = (comp_nid, did)
                            district_edges[edge_key] = district_edges.get(edge_key, 0) + int(dcr.cnt or 0)
                    for (comp_nid, did), cnt in district_edges.items():
                        edges.append(
                            _edge(comp_nid, did, "OPERATES_IN", "entity", contractCount=cnt)
                        )
            except Exception:
                logger.debug("Procurement sub-graph skipped (table may be empty)")

            return _cyto_response(nodes, edges, ["entity"], {
                "window": window,
                "minStrength": min_strength,
                "entityCount": len(sorted_entities) if 'sorted_entities' in dir() else 0,
            })
        except Exception:
            logger.exception("get_entity_political_graph failed")
            return _cyto_response([], [], ["entity"], {"error": "political layer failed"})

    # ------------------------------------------------------------------
    # Party-switch detection helper
    # ------------------------------------------------------------------

    async def _add_party_switch_edges(
        self,
        entities: list[PoliticalEntity],
        party_node_map: dict[str, str],
        nodes: list[dict],
        edges: list[dict],
    ) -> None:
        """Detect party switches from election data and add FORMER_PARTY_MEMBER edges.

        Compares entity.party (current) against their candidacies in past
        elections.  If they ran under a different party previously, a
        FORMER_PARTY_MEMBER edge is emitted to that earlier party.
        """
        # Build name → entity mapping for fast lookup
        entity_name_map: dict[str, PoliticalEntity] = {}
        for ent in entities:
            if ent.entity_type != EntityType.PERSON:
                continue
            if ent.name_en:
                entity_name_map[ent.name_en.lower()] = ent
            if ent.aliases:
                for alias in ent.aliases:
                    if isinstance(alias, str) and len(alias) > 2:
                        entity_name_map[alias.lower()] = ent

        if not entity_name_map:
            return

        # Load candidates for entities across all elections
        cand_stmt = (
            select(Candidate)
            .join(Election, Candidate.election_id == Election.id)
            .where(Candidate.is_winner == True)  # noqa: E712
            .order_by(Election.year_bs.asc())
        )
        candidates = (await self.db.execute(cand_stmt)).scalars().all()

        # Group candidate records by normalized name
        name_history: dict[str, list[tuple[int, str]]] = {}  # name → [(year, party)]
        for cand in candidates:
            # Try to match candidate to an entity
            cand_name = (cand.name_en_roman or cand.name_en or "").lower()
            matched_ent = entity_name_map.get(cand_name)
            if not matched_ent and cand.aliases:
                for alias in (cand.aliases if isinstance(cand.aliases, list) else []):
                    if isinstance(alias, str):
                        matched_ent = entity_name_map.get(alias.lower())
                        if matched_ent:
                            break
            if not matched_ent:
                continue

            key = matched_ent.name_en.lower()
            # Get election year
            election_stmt = select(Election.year_bs).where(Election.id == cand.election_id)
            year_row = (await self.db.execute(election_stmt)).scalar()
            if year_row:
                name_history.setdefault(key, []).append(
                    (year_row, _normalize_party(cand.party))
                )

        # Emit FORMER_PARTY_MEMBER edges for party switches
        for name_lower, history in name_history.items():
            if len(history) < 2:
                continue
            ent = entity_name_map.get(name_lower)
            if not ent:
                continue

            current_canon = _normalize_party(ent.party)
            seen_former: set[str] = set()
            for year_bs, cand_party in history:
                if cand_party and cand_party != current_canon and cand_party not in seen_former:
                    # Ensure party node exists
                    if cand_party not in party_node_map:
                        pid = f"party:{cand_party}"
                        nodes.append(_node(pid, cand_party, "party", "entity"))
                        party_node_map[cand_party] = pid
                    edges.append(
                        _edge(
                            f"entity:{ent.id}",
                            party_node_map[cand_party],
                            "FORMER_PARTY_MEMBER", "entity",
                            electionYear=year_bs,
                        )
                    )
                    seen_former.add(cand_party)

    # ------------------------------------------------------------------
    # 4. News graph
    # ------------------------------------------------------------------

    async def get_news_graph(
        self,
        hours: int = 168,
        min_co_mentions: int = 2,
        limit_entities: int = 50,
        include_story_nodes: bool = True,
        category: Optional[str] = None,
        include_districts: bool = True,
        include_entity_connections: bool = True,
    ) -> dict[str, Any]:
        try:
            nodes: list[dict] = []
            edges: list[dict] = []
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

            # Base story filter
            story_filter = [Story.published_at >= cutoff]
            if category:
                story_filter.append(Story.category == category)

            # Get story-entity links for recent stories
            sel_links = (
                select(
                    StoryEntityLink.story_id,
                    StoryEntityLink.entity_id,
                    StoryEntityLink.mention_count,
                    StoryEntityLink.is_title_mention,
                )
                .join(Story, Story.id == StoryEntityLink.story_id)
                .where(*story_filter)
            )
            link_rows = (await self.db.execute(sel_links)).all()

            if not link_rows:
                return _cyto_response([], [], ["news"], {"hours": hours, "category": category})

            # Build story->entities mapping and entity->stories mapping
            story_entities: dict[str, set[str]] = {}
            entity_stories: dict[str, set[str]] = {}
            for row in link_rows:
                sid = str(row.story_id)
                eid = str(row.entity_id)
                story_entities.setdefault(sid, set()).add(eid)
                entity_stories.setdefault(eid, set()).add(sid)

            # Co-mention pairs
            co_mentions: dict[tuple[str, str], int] = {}
            for sid, ent_set in story_entities.items():
                ent_list = sorted(ent_set)
                for i in range(len(ent_list)):
                    for j in range(i + 1, len(ent_list)):
                        pair = (ent_list[i], ent_list[j])
                        co_mentions[pair] = co_mentions.get(pair, 0) + 1

            # Filter by min_co_mentions
            significant_pairs = {
                pair: count for pair, count in co_mentions.items()
                if count >= min_co_mentions
            }

            # Collect entity IDs that appear in significant pairs
            significant_entity_ids: set[str] = set()
            for (e1, e2) in significant_pairs:
                significant_entity_ids.add(e1)
                significant_entity_ids.add(e2)

            # Also include top entities by story count
            entity_story_counts = sorted(
                entity_stories.items(), key=lambda x: len(x[1]), reverse=True
            )[:limit_entities]
            for eid, _ in entity_story_counts:
                significant_entity_ids.add(eid)

            # Load entity details
            if significant_entity_ids:
                from uuid import UUID as _UUID
                ent_uuids = []
                for eid in significant_entity_ids:
                    try:
                        ent_uuids.append(_UUID(eid))
                    except ValueError:
                        continue

                ent_stmt = select(PoliticalEntity).where(PoliticalEntity.id.in_(ent_uuids))
                entities_map: dict[str, PoliticalEntity] = {
                    str(e.id): e for e in (await self.db.execute(ent_stmt)).scalars().all()
                }
            else:
                entities_map = {}

            # Build entity nodes
            for eid, ent in entities_map.items():
                nid = f"entity:{eid}"
                story_count = len(entity_stories.get(eid, set()))
                news_entity_type = ent.entity_type.value if hasattr(ent.entity_type, "value") else str(ent.entity_type)
                nodes.append(
                    _node(
                        nid, ent.name_en, news_entity_type, "news",
                        entityType=news_entity_type,
                        party=ent.party,
                        storyCount=story_count,
                        mentions=ent.total_mentions,
                    )
                )

            # Build co-mention edges (normalize weight to 0-1 range for CSS mapData)
            max_co = max(significant_pairs.values(), default=1) or 1
            for (e1, e2), count in significant_pairs.items():
                if e1 in entities_map and e2 in entities_map:
                    edges.append(
                        _edge(
                            f"entity:{e1}", f"entity:{e2}",
                            "CO_MENTION", "news",
                            weight=round(count / max_co, 4),
                            coMentionCount=count,
                        )
                    )

            # ---- Story nodes ----
            if include_story_nodes:
                # Limit to top stories by entity mention count
                story_mention_counts = sorted(
                    story_entities.items(), key=lambda x: len(x[1]), reverse=True
                )[:50]

                story_ids_to_load = [sid for sid, _ in story_mention_counts]
                if story_ids_to_load:
                    from uuid import UUID as _UUID
                    story_uuids = []
                    for sid in story_ids_to_load:
                        try:
                            story_uuids.append(_UUID(sid))
                        except ValueError:
                            continue

                    story_stmt = select(Story).where(Story.id.in_(story_uuids))
                    stories_map: dict[str, Story] = {
                        str(s.id): s for s in (await self.db.execute(story_stmt)).scalars().all()
                    }

                    for sid, story in stories_map.items():
                        snid = f"story:{sid}"
                        nodes.append(
                            _node(
                                snid,
                                (story.title[:80] + "...") if len(story.title) > 80 else story.title,
                                "story", "news",
                                category=story.category,
                                severity=story.severity,
                                publishedAt=story.published_at.isoformat() if story.published_at else None,
                                sourceName=story.source_name,
                                url=story.url,
                            )
                        )
                        # Link story to its entities
                        for eid in story_entities.get(sid, set()):
                            if eid in entities_map:
                                edges.append(
                                    _edge(snid, f"entity:{eid}", "MENTIONED_IN", "news")
                                )

                        # ---- District nodes from stories ----
                        if include_districts and story.districts:
                            for district_name in story.districts:
                                dn = _safe_str(district_name)
                                if not dn:
                                    continue
                                did = f"district:{dn}"
                                existing_ids = {n["data"]["id"] for n in nodes}
                                if did not in existing_ids:
                                    nodes.append(_node(did, dn, "district", "news"))
                                edges.append(_edge(snid, did, "STORY_IN_DISTRICT", "news"))

            # ---- Entity connections (party/constituency) ----
            if include_entity_connections:
                news_party_map: dict[str, str] = {}  # normalized → node_id
                for eid, ent in entities_map.items():
                    if ent.party:
                        canon = _normalize_party(ent.party)
                        if canon and canon not in news_party_map:
                            pid = f"party:{canon}"
                            existing_ids = {n["data"]["id"] for n in nodes}
                            if pid not in existing_ids:
                                nodes.append(_node(pid, canon, "party", "news"))
                            news_party_map[canon] = pid
                for eid, ent in entities_map.items():
                    if ent.party:
                        canon = _normalize_party(ent.party)
                        target = news_party_map.get(canon)
                        if target:
                            edges.append(
                                _edge(f"entity:{eid}", target,
                                      "PARTY_MEMBER", "news")
                            )

            return _cyto_response(nodes, edges, ["news"], {
                "hours": hours,
                "category": category,
                "coMentionPairs": len(significant_pairs),
            })
        except Exception:
            logger.exception("get_news_graph failed")
            return _cyto_response([], [], ["news"], {"error": "news layer failed"})

    # ------------------------------------------------------------------
    # 5. Disaster graph
    # ------------------------------------------------------------------

    async def get_disaster_graph(
        self,
        days: int = 90,
        min_severity: Optional[str] = None,
        hazard_type: Optional[str] = None,
        limit_incidents: int = 50,
    ) -> dict[str, Any]:
        try:
            nodes: list[dict] = []
            edges: list[dict] = []
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)

            filters = [DisasterIncident.incident_on >= cutoff]
            if min_severity:
                severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
                allowed = [
                    sev for sev, rank in severity_order.items()
                    if rank <= severity_order.get(min_severity, 3)
                ]
                filters.append(DisasterIncident.severity.in_(allowed))
            if hazard_type:
                filters.append(DisasterIncident.hazard_type == hazard_type)

            inc_stmt = (
                select(DisasterIncident)
                .where(*filters)
                .order_by(DisasterIncident.deaths.desc(), DisasterIncident.incident_on.desc())
                .limit(limit_incidents)
            )
            incidents = (await self.db.execute(inc_stmt)).scalars().all()

            # Build a set of known district names from constituency data
            # for validating incident district fields
            known_districts_stmt = select(Constituency.district).distinct()
            known_district_rows = (await self.db.execute(known_districts_stmt)).scalars().all()
            known_districts = {_safe_str(d) for d in known_district_rows if d}

            districts_seen: set[str] = set()
            provinces_seen: set[int] = set()
            hazard_counts: dict[str, int] = {}

            for inc in incidents:
                iid = f"disaster:{inc.id}"
                impact_score = (inc.deaths or 0) + (inc.injured or 0) * 0.5 + (inc.missing or 0) * 0.7
                nodes.append(
                    _node(
                        iid,
                        (inc.title[:80] + "...") if len(inc.title) > 80 else inc.title,
                        "disaster_incident", "disaster",
                        hazardType=inc.hazard_type,
                        severity=inc.severity,
                        deaths=inc.deaths,
                        injured=inc.injured,
                        missing=inc.missing,
                        affectedFamilies=inc.affected_families,
                        estimatedLoss=inc.estimated_loss,
                        impactScore=impact_score,
                        latitude=inc.latitude,
                        longitude=inc.longitude,
                        incidentOn=inc.incident_on.isoformat() if inc.incident_on else None,
                        verified=inc.verified,
                    )
                )

                # Track hazard type counts for hub nodes
                ht = _safe_str(inc.hazard_type) or "other"
                hazard_counts[ht] = hazard_counts.get(ht, 0) + 1

                # Link to district — only if it's a known district name
                district_name = _safe_str(inc.district)
                linked_to_district = False
                if district_name and district_name in known_districts:
                    did = f"district:{district_name}"
                    if district_name not in districts_seen:
                        nodes.append(
                            _node(did, district_name, "district", "disaster",
                                  province=inc.province)
                        )
                        districts_seen.add(district_name)
                    edges.append(
                        _edge(iid, did, "DISASTER_IN", "disaster",
                              deaths=inc.deaths, severity=inc.severity)
                    )
                    linked_to_district = True

                # Province fallback: if district didn't match, link to province
                if not linked_to_district and inc.province:
                    prov_id = int(inc.province)
                    prov_nid = f"province:{prov_id}"
                    if prov_id not in provinces_seen:
                        nodes.append(
                            _node(prov_nid, f"Province {prov_id}",
                                  "province", "disaster",
                                  provinceId=prov_id)
                        )
                        provinces_seen.add(prov_id)
                    edges.append(
                        _edge(iid, prov_nid, "DISASTER_IN_PROVINCE", "disaster",
                              deaths=inc.deaths, severity=inc.severity)
                    )

            # Hazard type hub nodes — one per hazard type, sized by count
            max_hazard_count = max(hazard_counts.values(), default=1) or 1
            for ht, count in hazard_counts.items():
                hub_nid = f"hazard:{ht}"
                nodes.append(
                    _node(hub_nid, ht.replace("_", " ").title(),
                          "hazard_type", "disaster",
                          hazardType=ht,
                          incidentCount=count,
                          hubWeight=round(count / max_hazard_count, 4))
                )

            # Connect every incident to its hazard type hub
            for inc in incidents:
                iid = f"disaster:{inc.id}"
                ht = _safe_str(inc.hazard_type) or "other"
                hub_nid = f"hazard:{ht}"
                edges.append(
                    _edge(iid, hub_nid, "IS_HAZARD_TYPE", "disaster")
                )

            # Cross-link: find candidates/entities representing affected districts
            if districts_seen:
                # Find constituencies in affected districts
                const_stmt = (
                    select(Constituency)
                    .where(Constituency.district.in_(list(districts_seen)))
                )
                const_rows = (await self.db.execute(const_stmt)).scalars().all()

                for const in const_rows:
                    did = f"district:{const.district}"
                    ccode = _safe_str(const.constituency_code)
                    const_nid = f"constituency:{ccode}"
                    existing_ids = {n["data"]["id"] for n in nodes}
                    if const_nid not in existing_ids:
                        nodes.append(
                            _node(const_nid, const.name_en or ccode, "constituency", "disaster",
                                  code=ccode, district=const.district,
                                  winnerParty=const.winner_party)
                        )
                    edges.append(_edge(did, const_nid, "HAS_CONSTITUENCY", "disaster"))

                    # Find winning candidate for this constituency
                    if const.winner_candidate_id:
                        cand_stmt = (
                            select(Candidate).where(Candidate.id == const.winner_candidate_id)
                        )
                        cand = (await self.db.execute(cand_stmt)).scalar()
                        if cand:
                            cand_nid = f"candidate:{cand.id}"
                            if cand_nid not in existing_ids:
                                nodes.append(
                                    _node(cand_nid, cand.name_en or "Unknown", "person", "disaster",
                                          party=cand.party, isWinner=True)
                                )
                            edges.append(
                                _edge(cand_nid, const_nid, "REPRESENTS", "disaster")
                            )

            return _cyto_response(nodes, edges, ["disaster"], {
                "days": days,
                "hazardType": hazard_type,
                "minSeverity": min_severity,
                "incidentCount": len(incidents),
            })
        except Exception:
            logger.exception("get_disaster_graph failed")
            return _cyto_response([], [], ["disaster"], {"error": "disaster layer failed"})

    # ------------------------------------------------------------------
    # 6. Combined multi-layer graph
    # ------------------------------------------------------------------

    async def get_combined_graph(
        self,
        layers: list[str],
        **per_layer_configs: Any,
    ) -> dict[str, Any]:
        all_nodes: list[dict] = []
        all_edges: list[dict] = []
        active_layers: list[str] = []
        combined_metadata: dict[str, Any] = {}

        layer_methods: dict[str, Any] = {
            "trade": self.get_trade_graph,
            "geographic": self.get_geographic_graph,
            "entity": self.get_entity_political_graph,
            "news": self.get_news_graph,
            "disaster": self.get_disaster_graph,
        }

        for layer_name in layers:
            method = layer_methods.get(layer_name)
            if not method:
                logger.warning("Unknown graph layer requested: %s", layer_name)
                continue

            # Extract per-layer config
            layer_config = per_layer_configs.get(layer_name, {})
            if not isinstance(layer_config, dict):
                layer_config = {}

            try:
                result = await method(**layer_config)
                layer_nodes = result.get("elements", {}).get("nodes", [])
                layer_edges = result.get("elements", {}).get("edges", [])
                layer_meta = result.get("metadata", {})

                all_nodes.extend(layer_nodes)
                all_edges.extend(layer_edges)
                active_layers.append(layer_name)
                combined_metadata[layer_name] = layer_meta
            except Exception:
                logger.exception("Combined graph: layer %s failed", layer_name)
                combined_metadata[layer_name] = {"error": f"{layer_name} layer failed"}

        # Deduplicate nodes by id, merging layer info
        deduped_nodes: dict[str, dict] = {}
        for node in all_nodes:
            nid = node["data"]["id"]
            if nid in deduped_nodes:
                existing_layer = deduped_nodes[nid]["data"].get("layer", "")
                new_layer = node["data"].get("layer", "")
                if new_layer and new_layer not in existing_layer:
                    deduped_nodes[nid]["data"]["layer"] = f"{existing_layer},{new_layer}"
            else:
                deduped_nodes[nid] = node

        # Deduplicate edges by id
        deduped_edges: dict[str, dict] = {}
        for edge in all_edges:
            eid = edge["data"]["id"]
            if eid not in deduped_edges:
                deduped_edges[eid] = edge

        # Cross-link: customs offices → geographic district nodes
        if "trade" in layers and "geographic" in layers:
            for nid, node in deduped_nodes.items():
                if node["data"].get("type") == "customs_office":
                    district = node["data"].get("district")
                    if district:
                        did = f"district:{district}"
                        if did in deduped_nodes:
                            cross_eid = f"{nid}-CUSTOMS_IN_DISTRICT-{did}"
                            if cross_eid not in deduped_edges:
                                deduped_edges[cross_eid] = _edge(
                                    nid, did, "CUSTOMS_IN_DISTRICT", "trade,geographic"
                                )

        final_nodes = list(deduped_nodes.values())
        final_edges = list(deduped_edges.values())

        return {
            "elements": {"nodes": final_nodes, "edges": final_edges},
            "stats": {
                "nodeCount": len(final_nodes),
                "edgeCount": len(final_edges),
                "layers": active_layers,
            },
            "metadata": combined_metadata,
        }

    # ------------------------------------------------------------------
    # 7. Available fiscal years
    # ------------------------------------------------------------------

    async def get_available_fiscal_years(self) -> list[str]:
        stmt = (
            select(TradeReport.fiscal_year_bs)
            .distinct()
            .order_by(TradeReport.fiscal_year_bs.desc())
        )
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)

    # ------------------------------------------------------------------
    # 8. Available election years
    # ------------------------------------------------------------------

    async def get_available_election_years(self) -> list[int]:
        stmt = select(Election.year_bs).order_by(Election.year_bs.desc())
        rows = (await self.db.execute(stmt)).scalars().all()
        return list(rows)
