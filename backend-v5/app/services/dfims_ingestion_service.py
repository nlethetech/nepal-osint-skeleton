"""DFIMS ingestion service — imports development finance organizations into political_entities.

Ingests DFIMS organizations (donors, GoN ministries, NGOs) into the existing
political_entities table using extra_data JSONB for DFIMS-specific metadata.
Optionally links DFIMS orgs to registered companies via fuzzy name matching.

Zero new tables — all data fits into existing schema.
"""
import logging
import re
from typing import Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.political_entity import PoliticalEntity, EntityType, EntityTrend
from app.models.company import CompanyRegistration
from app.services.dfims_client import fetch_organizations
from app.services.entity_linker import _fuzzy_name_score

logger = logging.getLogger(__name__)

def _slugify(name: str) -> str:
    """Create a URL-safe slug from an organization name."""
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "_", slug)
    slug = slug.strip("_")
    return slug[:80]


def _classify_entity_type(org: dict[str, Any]) -> EntityType:
    """Determine entity_type based on DFIMS partner architecture.

    Multilateral Partners, Bilateral Partners, NGOs → ORGANIZATION
    GoN ministries and line agencies → INSTITUTION
    """
    arch_name = (org.get("development_cooperation_group__architecture__name") or "").lower()
    if "government of nepal" in arch_name:
        return EntityType.INSTITUTION
    return EntityType.ORGANIZATION


def _build_extra_data(org: dict[str, Any]) -> dict[str, Any]:
    """Build the extra_data JSONB payload for a DFIMS organization."""
    return {
        "source": "dfims",
        "dfims_id": org["id"],
        "dfims_code": org.get("code"),
        "abbreviation": org.get("abbreviation"),
        "iati_identifier": org.get("iati_identifier"),
        "partner_architecture": {
            "id": org.get("development_cooperation_group__architecture__id"),
            "name": org.get("development_cooperation_group__architecture__name"),
        },
        "development_cooperation_group": {
            "id": org.get("development_cooperation_group__id"),
            "name": org.get("development_cooperation_group__name"),
        },
    }


async def ingest_organizations(session: AsyncSession) -> dict[str, int]:
    """Fetch all DFIMS organizations and upsert into political_entities.

    Returns stats dict with created/updated/skipped counts.
    """
    logger.info("Starting DFIMS organization ingestion")
    stats = {"created": 0, "updated": 0, "skipped": 0, "total_fetched": 0}

    orgs = await fetch_organizations()
    stats["total_fetched"] = len(orgs)

    for org in orgs:
        dfims_id = org["id"]
        name = (org.get("name") or "").strip()
        if not name:
            stats["skipped"] += 1
            continue

        canonical_id = f"dfims_{_slugify(name)}_{dfims_id}"
        # Truncate canonical_id to 50 chars (DB constraint)
        if len(canonical_id) > 50:
            canonical_id = f"dfims_{dfims_id}"

        entity_type = _classify_entity_type(org)
        extra_data = _build_extra_data(org)
        arch_name = org.get("development_cooperation_group__architecture__name") or ""
        abbreviation = org.get("abbreviation")
        aliases = [abbreviation] if abbreviation else []

        # Check if entity exists by canonical_id
        result = await session.execute(
            select(PoliticalEntity).where(PoliticalEntity.canonical_id == canonical_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update extra_data if changed
            existing.extra_data = extra_data
            existing.aliases = aliases or existing.aliases
            stats["updated"] += 1
        else:
            entity = PoliticalEntity(
                canonical_id=canonical_id,
                name_en=name,
                name_ne=org.get("name_ne"),
                entity_type=entity_type,
                role=arch_name,
                aliases=aliases,
                extra_data=extra_data,
                trend=EntityTrend.STABLE,
                is_active=True,
            )
            session.add(entity)
            stats["created"] += 1

        # Flush every 100 records to avoid memory pressure
        if (stats["created"] + stats["updated"]) % 100 == 0:
            await session.flush()

    await session.commit()
    logger.info("DFIMS ingestion complete: %s", stats)
    return stats


async def link_to_companies(
    session: AsyncSession,
    threshold: float = 0.80,
) -> dict[str, Any]:
    """Fuzzy-match DFIMS organizations to registered companies.

    Loads all DFIMS entities and candidate companies, runs _fuzzy_name_score()
    against company name_english, and creates FUNDS graph edges for matches.

    This does NOT create entity_relationships (since companies aren't political_entities).
    Instead, it returns match results for the graph ingestion step to consume.

    Returns stats with match details.
    """
    logger.info("Linking DFIMS organizations to companies (threshold=%.2f)", threshold)
    stats: dict[str, Any] = {"dfims_count": 0, "company_candidates": 0, "matches": []}

    # Load DFIMS entities
    dfims_result = await session.execute(
        select(PoliticalEntity).where(
            PoliticalEntity.extra_data["source"].astext == "dfims"
        )
    )
    dfims_entities = dfims_result.scalars().all()
    stats["dfims_count"] = len(dfims_entities)

    if not dfims_entities:
        logger.warning("No DFIMS entities found — run ingest_organizations() first")
        return stats

    # Load candidate companies
    company_result = await session.execute(
        select(CompanyRegistration.id, CompanyRegistration.name_english, CompanyRegistration.external_id)
        .where(CompanyRegistration.name_english.isnot(None))
        .order_by(CompanyRegistration.id)
    )
    companies = company_result.all()
    company_names = [(c.id, c.name_english, c.external_id) for c in companies if c.name_english]
    stats["company_candidates"] = len(company_names)

    # Build inverted token index for O(1) candidate lookup instead of O(N*M)
    STOP_WORDS = {
        "pvt", "ltd", "private", "limited", "nepal", "the", "of", "and", "for",
        "in", "co", "company", "inc", "international", "national", "foundation",
        "center", "centre", "institute", "development", "association", "organization",
        "organisation", "society", "service", "services", "group", "council",
    }
    token_to_companies: dict[str, list[int]] = {}
    for idx, (_, comp_name, _) in enumerate(company_names):
        tokens = set(comp_name.lower().split()) - STOP_WORDS
        for token in tokens:
            if len(token) >= 3:
                token_to_companies.setdefault(token, []).append(idx)

    for entity in dfims_entities:
        entity_name = entity.name_en
        if not entity_name:
            continue

        # Pre-filter: only compare companies sharing at least one significant token
        entity_tokens = set(entity_name.lower().split()) - STOP_WORDS
        candidate_indices: set[int] = set()
        for token in entity_tokens:
            if len(token) >= 3:
                candidate_indices.update(token_to_companies.get(token, []))

        best_score = 0.0
        best_match = None

        for idx in candidate_indices:
            comp_id, comp_name, comp_ext_id = company_names[idx]
            score = _fuzzy_name_score(entity_name, comp_name)
            if score > best_score:
                best_score = score
                best_match = (comp_id, comp_name, comp_ext_id)

        if best_score >= threshold and best_match:
            stats["matches"].append({
                "dfims_entity": entity.canonical_id,
                "dfims_name": entity_name,
                "company_name": best_match[1],
                "company_external_id": best_match[2],
                "score": round(best_score, 4),
            })
            logger.info(
                "Match: %s <-> %s (score=%.3f)",
                entity_name, best_match[1], best_score,
            )

    logger.info(
        "DFIMS-company linking complete: %d DFIMS orgs, %d companies, %d matches",
        stats["dfims_count"], stats["company_candidates"], len(stats["matches"]),
    )
    return stats
