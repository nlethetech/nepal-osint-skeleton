"""
Entity Linker Service - Links satellite records to PoliticalEntity hub.

Resolution strategy (in order):
1. Exact canonical_id match → confidence 1.0
2. Exact name_ne match → confidence 0.98
3. Exact normalized name_en match → confidence 0.95
4. Fuzzy match (Jaccard on name tokens + party + constituency) → threshold 0.85

Reuses name matching logic from parliament_linker.py (Jaccard similarity,
PARTY_ALIASES, HONORIFICS stripping).
"""
import logging
import re
from typing import Optional, List, Tuple, Dict, Any
from uuid import UUID

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.political_entity import PoliticalEntity, EntityType, EntityTrend
from app.models.election import Candidate, Constituency, Election
from app.models.parliament import MPPerformance
from app.models.ministerial_position import MinisterialPosition
from app.models.company import CompanyDirector
from app.services.parliament_linker import PARTY_ALIASES, HONORIFICS

logger = logging.getLogger(__name__)


def _normalize_name(name: str) -> str:
    """Normalize name for matching: lowercase, strip honorifics, collapse whitespace."""
    if not name:
        return ""
    name_lower = name.lower().strip()
    for honorific in HONORIFICS:
        if name_lower.startswith(honorific.lower()):
            name_lower = name_lower[len(honorific):].strip()
    return " ".join(name_lower.split())


def _is_nepali(text: str) -> bool:
    """Check if text contains Devanagari characters."""
    return any('\u0900' <= c <= '\u097F' for c in (text or ""))


def _jaccard_tokens(a: str, b: str) -> float:
    """Token-level Jaccard similarity."""
    tokens_a = set(a.split())
    tokens_b = set(b.split())
    if not tokens_a or not tokens_b:
        return 0.0
    intersection = tokens_a & tokens_b
    union = tokens_a | tokens_b
    return len(intersection) / len(union)


def _fuzzy_name_score(name1: str, name2: str) -> float:
    """Combined Jaccard + character similarity."""
    n1 = _normalize_name(name1)
    n2 = _normalize_name(name2)
    if n1 == n2:
        return 1.0
    jaccard = _jaccard_tokens(n1, n2)
    chars1 = set(n1.replace(" ", ""))
    chars2 = set(n2.replace(" ", ""))
    char_union = chars1 | chars2
    char_sim = len(chars1 & chars2) / len(char_union) if char_union else 0
    return 0.6 * jaccard + 0.4 * char_sim


def _nepali_similarity(text1: str, text2: str) -> float:
    """Robust Nepali name similarity handling compound word variations."""
    n1 = _nepali_normalized(text1)
    n2 = _nepali_normalized(text2)
    if n1 == n2:
        return 1.0
    # Spaceless comparison handles compound splits (शेरबहादुर vs शेर बहादुर)
    if n1.replace(" ", "") == n2.replace(" ", ""):
        return 0.95
    jaccard = _jaccard_tokens(n1, n2)
    # Also compute character overlap for partial matches
    chars1 = set(n1.replace(" ", ""))
    chars2 = set(n2.replace(" ", ""))
    char_union = chars1 | chars2
    char_sim = len(chars1 & chars2) / len(char_union) if char_union else 0
    return max(jaccard, 0.5 * jaccard + 0.5 * char_sim)


def _nepali_normalized(s: str) -> str:
    """Normalize Nepali string for matching."""
    s = s.replace('(', ' ').replace(')', ' ')
    s = s.replace('.', ' ').replace('।', ' ')
    return ' '.join(s.split()).strip()


def _get_canonical_party(party: str) -> Optional[str]:
    """Get canonical party name from aliases."""
    party_lower = party.lower()
    for canonical, aliases in PARTY_ALIASES.items():
        if party_lower in [a.lower() for a in aliases]:
            return canonical
        if canonical.lower() in party_lower:
            return canonical
    return None


def _parties_match(party1: str, party2: str) -> bool:
    """Check if two party names refer to the same party."""
    if not party1 or not party2:
        return False
    p1, p2 = party1.lower().strip(), party2.lower().strip()
    if p1 == p2:
        return True
    c1, c2 = _get_canonical_party(p1), _get_canonical_party(p2)
    return bool(c1 and c2 and c1 == c2)


class EntityLinker:
    """Links satellite table records to PoliticalEntity hub."""

    def __init__(self, db: AsyncSession, confidence_threshold: float = 0.80):
        self.db = db
        self.threshold = confidence_threshold
        self._entity_cache: Optional[List[PoliticalEntity]] = None

    async def _load_entities(self) -> List[PoliticalEntity]:
        """Load all PoliticalEntity records (cached)."""
        if self._entity_cache is not None:
            return self._entity_cache
        result = await self.db.execute(
            select(PoliticalEntity).where(PoliticalEntity.entity_type == EntityType.PERSON)
        )
        self._entity_cache = list(result.scalars().all())
        return self._entity_cache

    def _find_entity(
        self,
        entities: List[PoliticalEntity],
        name_en: Optional[str] = None,
        name_ne: Optional[str] = None,
        party: Optional[str] = None,
        canonical_id: Optional[str] = None,
        candidate_aliases: Optional[List[str]] = None,
    ) -> Optional[Tuple[PoliticalEntity, float]]:
        """
        Find best matching PoliticalEntity.

        Resolution order:
        1. Exact canonical_id → 1.0
        2. Exact name_ne → 0.98
        3. Exact normalized name_en → 0.95
        4. Fuzzy match → threshold
        """
        # 1. Exact canonical_id
        if canonical_id:
            for entity in entities:
                if entity.canonical_id == canonical_id:
                    return entity, 1.0

        # 2. Exact name_ne match (with spaceless fallback for compound words)
        if name_ne and _is_nepali(name_ne):
            ne_norm = _nepali_normalized(name_ne)
            ne_spaceless = ne_norm.replace(" ", "")
            for entity in entities:
                if entity.name_ne:
                    entity_ne_norm = _nepali_normalized(entity.name_ne)
                    if entity_ne_norm == ne_norm:
                        return entity, 0.98
                    # Handle compound word splits: शेरबहादुर vs शेर बहादुर
                    if entity_ne_norm.replace(" ", "") == ne_spaceless:
                        return entity, 0.96
                # Check aliases
                if entity.aliases:
                    for alias in entity.aliases:
                        if _is_nepali(alias):
                            alias_norm = _nepali_normalized(alias)
                            if alias_norm == ne_norm:
                                return entity, 0.96
                            if alias_norm.replace(" ", "") == ne_spaceless:
                                return entity, 0.94

        # 3. Exact normalized name_en match
        if name_en:
            en_norm = _normalize_name(name_en)
            for entity in entities:
                if _normalize_name(entity.name_en) == en_norm:
                    return entity, 0.95
                if entity.aliases:
                    for alias in entity.aliases:
                        if not _is_nepali(alias) and _normalize_name(alias) == en_norm:
                            return entity, 0.93
                # Check candidate aliases against entity name/aliases
                if candidate_aliases:
                    for alias in candidate_aliases:
                        if alias and not _is_nepali(alias) and _normalize_name(alias) == _normalize_name(entity.name_en):
                            return entity, 0.93
                        if alias and entity.aliases:
                            for ent_alias in entity.aliases:
                                if not _is_nepali(alias) and not _is_nepali(ent_alias) and _normalize_name(alias) == _normalize_name(ent_alias):
                                    return entity, 0.91

        # 4. Fuzzy match
        best_entity = None
        best_score = 0.0
        for entity in entities:
            # Name score - compare against entity name and aliases
            name_score = 0.0
            if name_en:
                name_score = max(name_score, _fuzzy_name_score(name_en, entity.name_en))
            if name_ne and entity.name_ne:
                name_score = max(name_score, _nepali_similarity(name_ne, entity.name_ne))
            # Check entity aliases
            if entity.aliases:
                for alias in entity.aliases:
                    if name_en and not _is_nepali(alias):
                        name_score = max(name_score, _fuzzy_name_score(name_en, alias))
                    if name_ne and _is_nepali(alias):
                        name_score = max(name_score, _nepali_similarity(name_ne, alias))
            # Check candidate aliases against entity name
            if candidate_aliases:
                for alias in candidate_aliases:
                    if alias and not _is_nepali(alias):
                        name_score = max(name_score, _fuzzy_name_score(alias, entity.name_en))

            # Require minimum name similarity - party alone must never produce a match
            if name_score < 0.4:
                continue

            # Fixed scoring: always use both weights so party can't inflate a zero-name match
            party_score = 0.0
            if party and entity.party:
                party_score = 1.0 if _parties_match(party, entity.party) else 0.0

            final = name_score * 0.7 + party_score * 0.3
            if final > best_score:
                best_score = final
                best_entity = entity

        if best_entity and best_score >= self.threshold:
            return best_entity, best_score

        return None

    # ---------------------------------------------------------------
    # Link methods
    # ---------------------------------------------------------------

    async def link_candidates_to_entities(self) -> Dict[str, int]:
        """Link all unlinked Candidates to PoliticalEntity."""
        entities = await self._load_entities()
        result = await self.db.execute(
            select(Candidate)
            .where(Candidate.linked_entity_id.is_(None))
            .options(selectinload(Candidate.constituency))
        )
        candidates = list(result.scalars().all())
        stats = {"linked": 0, "created": 0, "skipped": 0}

        for cand in candidates:
            match = self._find_entity(
                entities,
                name_en=cand.name_en_roman or cand.name_en,
                name_ne=cand.name_ne or cand.name_en,
                party=cand.party,
                candidate_aliases=cand.aliases,
            )
            if match:
                entity, confidence = match
                cand.linked_entity_id = entity.id
                cand.entity_link_confidence = confidence
                stats["linked"] += 1
            elif cand.is_winner:
                # Create new PoliticalEntity for notable winners
                en_name = cand.name_en_roman or cand.name_en
                slug = re.sub(r'[^\w\s-]', '', en_name.lower().strip())
                slug = re.sub(r'[\s_-]+', '_', slug)[:50]
                # Avoid duplicate canonical_ids
                existing = await self.db.execute(
                    select(PoliticalEntity).where(PoliticalEntity.canonical_id == slug)
                )
                if existing.scalar_one_or_none():
                    slug = f"{slug}_{cand.external_id[:6]}"

                new_entity = PoliticalEntity(
                    canonical_id=slug,
                    name_en=en_name,
                    name_ne=cand.name_ne or cand.name_en,
                    entity_type=EntityType.PERSON,
                    party=cand.party,
                    image_url=cand.photo_url,
                    aliases=cand.aliases,
                )
                self.db.add(new_entity)
                await self.db.flush()
                cand.linked_entity_id = new_entity.id
                cand.entity_link_confidence = 1.0
                entities.append(new_entity)
                stats["created"] += 1
            else:
                stats["skipped"] += 1

        await self.db.flush()
        logger.info(
            f"Candidate linking: {stats['linked']} linked, "
            f"{stats['created']} created, {stats['skipped']} skipped"
        )
        return stats

    async def link_mps_to_entities(self) -> Dict[str, int]:
        """Link MPPerformance to PoliticalEntity via candidate chain or name match."""
        entities = await self._load_entities()
        result = await self.db.execute(
            select(MPPerformance).where(MPPerformance.linked_entity_id.is_(None))
        )
        mps = list(result.scalars().all())
        stats = {"linked_via_candidate": 0, "linked_direct": 0, "skipped": 0}

        for mp in mps:
            # Try via candidate chain first
            if mp.linked_candidate_id:
                cand_result = await self.db.execute(
                    select(Candidate).where(Candidate.id == mp.linked_candidate_id)
                )
                cand = cand_result.scalar_one_or_none()
                if cand and cand.linked_entity_id:
                    mp.linked_entity_id = cand.linked_entity_id
                    mp.entity_link_confidence = min(mp.link_confidence or 0.9, cand.entity_link_confidence or 0.9)
                    stats["linked_via_candidate"] += 1
                    continue

            # Direct name match
            match = self._find_entity(
                entities,
                name_en=mp.name_en,
                name_ne=mp.name_ne,
                party=mp.party,
            )
            if match:
                entity, confidence = match
                mp.linked_entity_id = entity.id
                mp.entity_link_confidence = confidence
                stats["linked_direct"] += 1
            else:
                stats["skipped"] += 1

        await self.db.flush()
        logger.info(
            f"MP linking: {stats['linked_via_candidate']} via candidate, "
            f"{stats['linked_direct']} direct, {stats['skipped']} skipped"
        )
        return stats

    async def link_ministers_to_entities(self) -> Dict[str, int]:
        """Link MinisterialPosition to PoliticalEntity via chains or name match."""
        entities = await self._load_entities()
        result = await self.db.execute(
            select(MinisterialPosition).where(MinisterialPosition.linked_entity_id.is_(None))
        )
        ministers = list(result.scalars().all())
        stats = {"linked_via_chain": 0, "linked_direct": 0, "skipped": 0}

        for minister in ministers:
            # Try via candidate chain
            if minister.linked_candidate_id:
                cand_result = await self.db.execute(
                    select(Candidate).where(Candidate.id == minister.linked_candidate_id)
                )
                cand = cand_result.scalar_one_or_none()
                if cand and cand.linked_entity_id:
                    minister.linked_entity_id = cand.linked_entity_id
                    minister.entity_link_confidence = 0.95
                    stats["linked_via_chain"] += 1
                    continue

            # Try via MP chain
            if minister.linked_mp_id:
                mp_result = await self.db.execute(
                    select(MPPerformance).where(MPPerformance.id == minister.linked_mp_id)
                )
                mp = mp_result.scalar_one_or_none()
                if mp and mp.linked_entity_id:
                    minister.linked_entity_id = mp.linked_entity_id
                    minister.entity_link_confidence = 0.93
                    stats["linked_via_chain"] += 1
                    continue

            # Direct name match
            match = self._find_entity(
                entities,
                name_en=minister.person_name_en,
                name_ne=minister.person_name_ne,
                party=minister.party_at_appointment,
            )
            if match:
                entity, confidence = match
                minister.linked_entity_id = entity.id
                minister.entity_link_confidence = confidence
                stats["linked_direct"] += 1
            else:
                stats["skipped"] += 1

        await self.db.flush()
        logger.info(
            f"Minister linking: {stats['linked_via_chain']} via chain, "
            f"{stats['linked_direct']} direct, {stats['skipped']} skipped"
        )
        return stats

    async def link_directors_to_entities(self) -> Dict[str, int]:
        """Link CompanyDirector to PoliticalEntity via name/alias match (threshold 0.80)."""
        entities = await self._load_entities()
        result = await self.db.execute(
            select(CompanyDirector).where(CompanyDirector.linked_entity_id.is_(None))
        )
        directors = list(result.scalars().all())
        stats = {"linked": 0, "skipped": 0}

        for director in directors:
            match = self._find_entity(
                entities,
                name_en=director.name_en,
                name_ne=director.name_np,
            )
            # Lower threshold for directors (0.80)
            if match and match[1] >= 0.80:
                entity, confidence = match
                director.linked_entity_id = entity.id
                director.entity_link_confidence = confidence
                stats["linked"] += 1
            else:
                stats["skipped"] += 1

        await self.db.flush()
        logger.info(f"Director linking: {stats['linked']} linked, {stats['skipped']} skipped")
        return stats

    # ---------------------------------------------------------------
    # Enrichment absorption
    # ---------------------------------------------------------------

    async def absorb_enrichments(self) -> Dict[str, int]:
        """Copy biography/education/photo/position data from linked satellites into PoliticalEntity."""
        stats = {"enriched": 0}

        # Get entities with linked candidates
        result = await self.db.execute(
            select(PoliticalEntity)
            .where(PoliticalEntity.entity_type == EntityType.PERSON)
        )
        entities = list(result.scalars().all())

        for entity in entities:
            updated = False

            # Absorb from best linked candidate (highest confidence, min 0.90)
            cand_result = await self.db.execute(
                select(Candidate)
                .where(
                    Candidate.linked_entity_id == entity.id,
                    Candidate.entity_link_confidence >= 0.90,
                )
                .order_by(Candidate.entity_link_confidence.desc())
                .limit(1)
            )
            best_cand = cand_result.scalar_one_or_none()
            if best_cand:
                if best_cand.biography and not entity.biography:
                    entity.biography = best_cand.biography
                    entity.biography_source = best_cand.biography_source
                    updated = True
                if best_cand.education and not entity.education:
                    entity.education = best_cand.education
                    entity.education_institution = best_cand.education_institution
                    updated = True
                if best_cand.age and not entity.age:
                    entity.age = best_cand.age
                    updated = True
                if best_cand.gender and not entity.gender:
                    entity.gender = best_cand.gender
                    updated = True
                if best_cand.photo_url and not entity.image_url:
                    entity.image_url = best_cand.photo_url
                    updated = True

            # Build position history from ministerial records
            position_history = await self._build_position_history(entity.id)
            if position_history and not entity.position_history:
                entity.position_history = position_history
                updated = True

            # Build current position
            current = await self._get_current_position(entity.id)
            if current and not entity.current_position:
                entity.current_position = current
                updated = True

            # Build former parties
            former_parties = await self._build_party_history(entity.id)
            if former_parties and not entity.former_parties:
                entity.former_parties = former_parties
                updated = True

            if updated:
                stats["enriched"] += 1

        await self.db.flush()
        logger.info(f"Enrichment absorption: {stats['enriched']} entities enriched")
        return stats

    async def _build_position_history(self, entity_id: UUID) -> Optional[List[Dict[str, Any]]]:
        """Build position_history JSONB from MinisterialPosition records."""
        result = await self.db.execute(
            select(MinisterialPosition)
            .where(MinisterialPosition.linked_entity_id == entity_id)
            .order_by(MinisterialPosition.start_date.desc())
        )
        positions = result.scalars().all()
        if not positions:
            return None

        history = []
        for pos in positions:
            history.append({
                "title": pos.formatted_position,
                "ministry": pos.ministry,
                "from": pos.start_date.isoformat() if pos.start_date else None,
                "to": pos.end_date.isoformat() if pos.end_date else None,
                "government": pos.government_name,
            })
        return history

    async def _get_current_position(self, entity_id: UUID) -> Optional[str]:
        """Get current position string from linked records."""
        # Check current ministerial position
        result = await self.db.execute(
            select(MinisterialPosition)
            .where(
                MinisterialPosition.linked_entity_id == entity_id,
                MinisterialPosition.is_current.is_(True),
            )
            .limit(1)
        )
        current_minister = result.scalar_one_or_none()
        if current_minister:
            return current_minister.formatted_position

        # Check current MP
        result = await self.db.execute(
            select(MPPerformance)
            .where(
                MPPerformance.linked_entity_id == entity_id,
                MPPerformance.is_current_member.is_(True),
            )
            .limit(1)
        )
        current_mp = result.scalar_one_or_none()
        if current_mp:
            return f"MP, {current_mp.constituency}" if current_mp.constituency else "MP"

        return None

    async def _build_party_history(self, entity_id: UUID) -> Optional[List[Dict[str, Any]]]:
        """Build former_parties JSONB from MinisterialPosition.party_at_appointment history."""
        result = await self.db.execute(
            select(MinisterialPosition)
            .where(MinisterialPosition.linked_entity_id == entity_id)
            .order_by(MinisterialPosition.start_date)
        )
        positions = result.scalars().all()
        if not positions:
            return None

        # Get entity's current party
        entity_result = await self.db.execute(
            select(PoliticalEntity.party).where(PoliticalEntity.id == entity_id)
        )
        current_party = entity_result.scalar_one_or_none()

        parties_seen = []
        last_party = None
        for pos in positions:
            p = pos.party_at_appointment
            if p and p != last_party:
                if last_party is not None and last_party != current_party:
                    parties_seen.append({
                        "party": last_party,
                        "from": pos.start_date.isoformat() if pos.start_date else None,
                    })
                last_party = p

        # Only return if there are actual former parties different from current
        former = [p for p in parties_seen if p["party"] != current_party]
        return former if former else None


# ---------------------------------------------------------------
# Service-level convenience functions
# ---------------------------------------------------------------

async def link_all_entities(db: AsyncSession) -> Dict[str, Any]:
    """Run full entity linking pipeline."""
    linker = EntityLinker(db)
    results = {}
    results["candidates"] = await linker.link_candidates_to_entities()
    results["mps"] = await linker.link_mps_to_entities()
    results["ministers"] = await linker.link_ministers_to_entities()
    results["directors"] = await linker.link_directors_to_entities()
    results["enrichment"] = await linker.absorb_enrichments()
    await db.commit()
    return results
