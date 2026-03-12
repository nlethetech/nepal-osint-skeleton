"""Contractor-to-company linkage for procurement analysis.

Builds and stores one best OCR match per distinct procurement contractor name.
"""
from __future__ import annotations

import logging
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import delete, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import CompanyRegistration
from app.models.procurement import GovtContract
from app.models.procurement_company_link import ProcurementCompanyLink
from app.services.graph.entity_resolution_service import jaro_winkler_similarity

logger = logging.getLogger(__name__)

WORD_RE = re.compile(r"[A-Z0-9]+")
SPACE_RE = re.compile(r"\s+")

LEGAL_SUFFIX_TOKENS = {
    "PVT", "PRIVATE", "LTD", "LIMITED", "CO", "COMPANY", "INC", "INCORPORATED", "THE",
    "PVT", "PLC", "LLP", "JV", "JOINT", "VENTURE",
}

GENERIC_BUSINESS_TOKENS = {
    "NIRMAN", "SEWA", "TRADERS", "TRADING", "SUPPLIERS", "SUPPLIER", "CONSTRUCTION", "BUILDERS",
    "BUILDER", "ENTERPRISE", "ENTERPRISES", "SERVICES", "SERVICE", "INDUSTRIES", "INDUSTRY", "GROUP",
    "WORKS", "MULTIPURPOSE", "GENERAL", "INFRA", "INFRASTRUCTURE", "PROJECTS", "PROJECT",
    "ASSOCIATES", "ASSOCIATE", "AGRO", "HEALTH", "HOTELS", "HOTEL", "POWER", "REALTY",
}

TOKEN_NORMALIZATION = {
    "SEWAA": "SEWA",
    "SEW": "SEWA",
    "NIRMANSEWA": "NIRMAN SEWA",
    "CONSTRUCTIONS": "CONSTRUCTION",
    "CONSTRACTION": "CONSTRUCTION",
    "SUPLY": "SUPPLY",
    "SUPPLYERS": "SUPPLIERS",
    "NRIMAN": "NIRMAN",
    "P": "",
    "L": "",
}


@dataclass(slots=True)
class IndexedCompany:
    id: UUID
    name_english: str
    registration_number: int | None
    district: str | None
    company_type_category: str | None
    company_address: str | None
    normalized: str
    compact: str
    tokens: set[str]
    informative_tokens: set[str]
    trigrams: set[str]
    acronym: str


@dataclass(slots=True)
class CandidateScore:
    company_idx: int
    score: float
    margin_inputs: tuple[float, float, float, float]


@dataclass(slots=True)
class ContractorMatch:
    contractor_name: str
    normalized: str
    compact: str
    status: str
    match_type: str | None
    company_idx: int | None
    confidence: float
    score: float | None
    score_margin: float | None
    candidate_count: int
    details: dict


class ProcurementCompanyLinkageService:
    """Builds and queries persistent contractor OCR-linkage rows."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def ensure_links(self, target_coverage: float = 0.90, force_refresh: bool = False) -> dict:
        """Ensure linkage table is populated for current contractor universe."""
        total_contractors = (
            await self.db.execute(
                select(func.count(func.distinct(GovtContract.contractor_name))).where(
                    GovtContract.contractor_name.isnot(None),
                    func.btrim(GovtContract.contractor_name) != "",
                )
            )
        ).scalar() or 0

        if total_contractors == 0:
            return {
                "total_contractors": 0,
                "matched_count": 0,
                "match_rate": 0.0,
                "ambiguous_count": 0,
                "unmatched_count": 0,
            }

        existing = (
            await self.db.execute(select(func.count()).select_from(ProcurementCompanyLink))
        ).scalar() or 0

        if force_refresh or existing != total_contractors:
            return await self.refresh_links(target_coverage=target_coverage)

        stats = await self.get_stats()
        if (stats.get("match_rate", 0.0) / 100.0) < target_coverage:
            return await self.refresh_links(target_coverage=target_coverage)
        return stats

    async def get_stats(self) -> dict:
        total_contractors = (
            await self.db.execute(
                select(func.count(func.distinct(GovtContract.contractor_name))).where(
                    GovtContract.contractor_name.isnot(None),
                    func.btrim(GovtContract.contractor_name) != "",
                )
            )
        ).scalar() or 0

        rows = (
            await self.db.execute(
                select(ProcurementCompanyLink.match_status, func.count())
                .group_by(ProcurementCompanyLink.match_status)
            )
        ).all()

        by_status = {status: count for status, count in rows}
        matched = int(by_status.get("matched", 0))
        ambiguous = int(by_status.get("ambiguous", 0))
        unmatched = int(by_status.get("unmatched", 0))

        return {
            "total_contractors": int(total_contractors),
            "matched_count": matched,
            "ambiguous_count": ambiguous,
            "unmatched_count": unmatched,
            "match_rate": round((matched / total_contractors) * 100, 2) if total_contractors else 0.0,
        }

    async def get_matched_contractor_names(self) -> set[str]:
        rows = (
            await self.db.execute(
                select(ProcurementCompanyLink.contractor_name)
                .where(ProcurementCompanyLink.match_status == "matched")
            )
        ).all()
        return {row.contractor_name for row in rows}

    async def get_linked_company_for_contractor(self, contractor_name: str) -> dict | None:
        stmt = (
            select(
                ProcurementCompanyLink.contractor_name,
                ProcurementCompanyLink.match_status,
                ProcurementCompanyLink.match_type,
                ProcurementCompanyLink.confidence,
                ProcurementCompanyLink.score,
                CompanyRegistration.id.label("company_id"),
                CompanyRegistration.name_english,
                CompanyRegistration.registration_number,
                CompanyRegistration.registration_date_ad,
                CompanyRegistration.registration_date_bs,
                CompanyRegistration.district,
                CompanyRegistration.company_type_category,
                CompanyRegistration.company_address,
            )
            .select_from(ProcurementCompanyLink)
            .outerjoin(CompanyRegistration, ProcurementCompanyLink.company_id == CompanyRegistration.id)
            .where(ProcurementCompanyLink.contractor_name == contractor_name)
            .limit(1)
        )
        row = (await self.db.execute(stmt)).one_or_none()
        if not row:
            return None

        if row.match_status != "matched" or not row.company_id:
            return {
                "match_status": row.match_status,
                "match_type": row.match_type,
                "confidence": float(row.confidence or 0.0),
                "score": float(row.score) if row.score is not None else None,
                "company": None,
            }

        return {
            "match_status": row.match_status,
            "match_type": row.match_type,
            "confidence": float(row.confidence or 0.0),
            "score": float(row.score) if row.score is not None else None,
                "company": {
                    "id": str(row.company_id),
                    "name_english": row.name_english,
                    "registration_number": row.registration_number,
                    "registration_date_ad": row.registration_date_ad,
                    "registration_date_bs": row.registration_date_bs,
                    "district": row.district,
                    "company_type_category": row.company_type_category,
                    "address": row.company_address,
                },
        }

    async def get_links_map(self, contractor_names: list[str]) -> dict[str, dict]:
        if not contractor_names:
            return {}

        stmt = (
            select(
                ProcurementCompanyLink.contractor_name,
                ProcurementCompanyLink.match_status,
                ProcurementCompanyLink.match_type,
                ProcurementCompanyLink.confidence,
                ProcurementCompanyLink.score,
                ProcurementCompanyLink.score_margin,
                ProcurementCompanyLink.candidate_count,
                CompanyRegistration.id.label("company_id"),
                CompanyRegistration.name_english,
                CompanyRegistration.registration_number,
                CompanyRegistration.registration_date_ad,
                CompanyRegistration.registration_date_bs,
                CompanyRegistration.district,
                CompanyRegistration.company_type_category,
                CompanyRegistration.company_address,
            )
            .select_from(ProcurementCompanyLink)
            .outerjoin(CompanyRegistration, ProcurementCompanyLink.company_id == CompanyRegistration.id)
            .where(ProcurementCompanyLink.contractor_name.in_(contractor_names))
        )
        rows = (await self.db.execute(stmt)).all()

        result: dict[str, dict] = {}
        for row in rows:
            result[row.contractor_name] = {
                "match_status": row.match_status,
                "match_type": row.match_type,
                "confidence": float(row.confidence or 0.0),
                "score": float(row.score) if row.score is not None else None,
                "score_margin": float(row.score_margin) if row.score_margin is not None else None,
                "candidate_count": int(row.candidate_count or 0),
                "company": None if not row.company_id else {
                    "id": str(row.company_id),
                    "name_english": row.name_english,
                    "registration_number": row.registration_number,
                    "registration_date_ad": row.registration_date_ad,
                    "registration_date_bs": row.registration_date_bs,
                    "district": row.district,
                    "company_type_category": row.company_type_category,
                    "address": row.company_address,
                },
            }

        return result

    async def refresh_links(self, target_coverage: float = 0.90) -> dict:
        """Recompute all contractor links and persist them."""
        contractors = await self._load_contractors()
        companies, index = await self._build_company_index()

        matches: list[ContractorMatch] = []
        for contractor_name in contractors:
            match = self._match_contractor(contractor_name, companies, index)
            matches.append(match)

        # If coverage still below target, accept low-confidence but non-random fuzzy matches.
        if matches:
            coverage = self._coverage(matches)
            if coverage < target_coverage:
                self._promote_low_confidence_matches(matches, target_coverage)

        await self.db.execute(delete(ProcurementCompanyLink))
        now = datetime.now(timezone.utc)

        for match in matches:
            company_id = (
                companies[match.company_idx].id
                if match.status == "matched" and match.company_idx is not None
                else None
            )
            self.db.add(
                ProcurementCompanyLink(
                    contractor_name=match.contractor_name,
                    contractor_name_normalized=match.normalized,
                    contractor_name_compact=match.compact,
                    company_id=company_id,
                    match_status=match.status,
                    match_type=match.match_type,
                    confidence=match.confidence,
                    score=match.score,
                    score_margin=match.score_margin,
                    candidate_count=match.candidate_count,
                    details=match.details,
                    last_refreshed_at=now,
                )
            )

        await self.db.commit()
        stats = await self.get_stats()
        logger.info(
            "Procurement OCR link refresh complete: %s/%s matched (%.2f%%)",
            stats["matched_count"],
            stats["total_contractors"],
            stats["match_rate"],
        )
        return stats

    async def _load_contractors(self) -> list[str]:
        rows = (
            await self.db.execute(
                select(GovtContract.contractor_name)
                .where(GovtContract.contractor_name.isnot(None), func.btrim(GovtContract.contractor_name) != "")
                .group_by(GovtContract.contractor_name)
                .order_by(desc(func.sum(func.coalesce(GovtContract.contract_amount_npr, 0))))
            )
        ).all()
        return [row.contractor_name for row in rows if row.contractor_name]

    async def _build_company_index(self) -> tuple[list[IndexedCompany], dict]:
        rows = (
            await self.db.execute(
                select(
                    CompanyRegistration.id,
                    CompanyRegistration.name_english,
                    CompanyRegistration.registration_number,
                    CompanyRegistration.district,
                    CompanyRegistration.company_type_category,
                    CompanyRegistration.company_address,
                ).where(CompanyRegistration.name_english.isnot(None), func.btrim(CompanyRegistration.name_english) != "")
            )
        ).all()

        companies: list[IndexedCompany] = []
        norm_index: dict[str, list[int]] = defaultdict(list)
        compact_index: dict[str, list[int]] = defaultdict(list)
        acronym_index: dict[str, list[int]] = defaultdict(list)
        token_index: dict[str, set[int]] = defaultdict(set)
        prefix_index: dict[str, set[int]] = defaultdict(set)

        for row in rows:
            normalized = normalize_company_name(row.name_english)
            if not normalized:
                continue
            compact = normalized.replace(" ", "")
            tokens = set(tokenize(normalized))
            informative = informative_tokens(tokens)
            acronym = "".join(tok[0] for tok in normalized.split() if tok)

            company = IndexedCompany(
                id=row.id,
                name_english=row.name_english,
                registration_number=row.registration_number,
                district=row.district,
                company_type_category=row.company_type_category,
                company_address=row.company_address,
                normalized=normalized,
                compact=compact,
                tokens=tokens,
                informative_tokens=informative,
                trigrams=char_trigrams(compact),
                acronym=acronym,
            )
            idx = len(companies)
            companies.append(company)

            norm_index[normalized].append(idx)
            compact_index[compact].append(idx)
            if acronym and len(acronym) >= 3:
                acronym_index[acronym].append(idx)
            for tok in informative:
                token_index[tok].add(idx)
            if compact:
                prefix_index[compact[:4]].add(idx)

        token_frequency = {token: len(ids) for token, ids in token_index.items()}

        return companies, {
            "norm": norm_index,
            "compact": compact_index,
            "acronym": acronym_index,
            "token": token_index,
            "prefix": prefix_index,
            "token_frequency": token_frequency,
        }

    def _match_contractor(self, contractor_name: str, companies: list[IndexedCompany], index: dict) -> ContractorMatch:
        normalized = normalize_company_name(contractor_name)
        compact = normalized.replace(" ", "")
        tokens = set(tokenize(normalized))
        informative = informative_tokens(tokens)

        details: dict = {
            "normalized": normalized,
            "informative_tokens": sorted(informative),
        }

        if not normalized:
            return ContractorMatch(
                contractor_name=contractor_name,
                normalized="",
                compact="",
                status="unmatched",
                match_type="empty_after_normalization",
                company_idx=None,
                confidence=0.0,
                score=None,
                score_margin=None,
                candidate_count=0,
                details=details,
            )

        # Deterministic normalized exact.
        exact_ids = index["norm"].get(normalized, [])
        if exact_ids:
            best_idx = self._pick_best_by_overlap(exact_ids, informative, companies)
            return ContractorMatch(
                contractor_name=contractor_name,
                normalized=normalized,
                compact=compact,
                status="matched",
                match_type="exact_normalized",
                company_idx=best_idx,
                confidence=0.99,
                score=1.0,
                score_margin=1.0,
                candidate_count=len(exact_ids),
                details={**details, "strategy": "exact_normalized"},
            )

        # Deterministic compact exact catches space/punctuation variations.
        compact_ids = index["compact"].get(compact, [])
        if compact_ids:
            best_idx = self._pick_best_by_overlap(compact_ids, informative, companies)
            return ContractorMatch(
                contractor_name=contractor_name,
                normalized=normalized,
                compact=compact,
                status="matched",
                match_type="exact_compact",
                company_idx=best_idx,
                confidence=0.97,
                score=0.98,
                score_margin=0.5,
                candidate_count=len(compact_ids),
                details={**details, "strategy": "exact_compact"},
            )

        if compact and compact.isalnum() and 3 <= len(compact) <= 12:
            acronym_ids = index["acronym"].get(compact, [])
            if acronym_ids:
                best_idx = self._pick_best_by_overlap(acronym_ids, informative, companies)
                return ContractorMatch(
                    contractor_name=contractor_name,
                    normalized=normalized,
                    compact=compact,
                    status="matched",
                    match_type="acronym",
                    company_idx=best_idx,
                    confidence=0.9,
                    score=0.9,
                    score_margin=0.2,
                    candidate_count=len(acronym_ids),
                    details={**details, "strategy": "acronym"},
                )

        candidate_ids = self._candidate_ids(informative, compact, index)
        if not candidate_ids:
            return ContractorMatch(
                contractor_name=contractor_name,
                normalized=normalized,
                compact=compact,
                status="unmatched",
                match_type="no_candidate",
                company_idx=None,
                confidence=0.0,
                score=None,
                score_margin=None,
                candidate_count=0,
                details={**details, "strategy": "fuzzy", "reason": "no_candidates"},
            )

        scored = self._score_candidates(normalized, compact, informative, candidate_ids, companies)
        if not scored:
            return ContractorMatch(
                contractor_name=contractor_name,
                normalized=normalized,
                compact=compact,
                status="unmatched",
                match_type="no_score",
                company_idx=None,
                confidence=0.0,
                score=None,
                score_margin=None,
                candidate_count=len(candidate_ids),
                details={**details, "strategy": "fuzzy", "reason": "no_ranked_candidates"},
            )

        best = scored[0]
        second = scored[1] if len(scored) > 1 else None
        margin = best.score - (second.score if second else 0.0)

        token_containment = best.margin_inputs[1]
        first_token_same = best.margin_inputs[3] > 0

        # Confidence tiers: strict -> medium -> relaxed.
        if best.score >= 0.90 and margin >= 0.03:
            status = "matched"
            match_type = "fuzzy_strict"
            confidence = min(0.96, best.score)
        elif best.score >= 0.82 and (margin >= 0.04 or token_containment >= 0.8):
            status = "matched"
            match_type = "fuzzy_medium"
            confidence = min(0.9, best.score)
        elif best.score >= 0.74 and token_containment >= 0.45 and (margin >= 0.03 or first_token_same):
            status = "matched"
            match_type = "fuzzy_relaxed"
            confidence = min(0.82, best.score)
        elif best.score >= 0.66 and token_containment >= 0.34 and first_token_same:
            status = "matched"
            match_type = "fuzzy_low"
            confidence = min(0.75, best.score)
        else:
            status = "unmatched"
            match_type = "fuzzy_below_threshold"
            confidence = max(0.0, min(0.5, best.score))

        return ContractorMatch(
            contractor_name=contractor_name,
            normalized=normalized,
            compact=compact,
            status=status,
            match_type=match_type,
            company_idx=best.company_idx,
            confidence=confidence,
            score=best.score,
            score_margin=margin,
            candidate_count=len(candidate_ids),
            details={
                **details,
                "strategy": "fuzzy",
                "top_score": round(best.score, 5),
                "top_margin": round(margin, 5),
                "top_components": {
                    "jw": round(best.margin_inputs[0], 5),
                    "containment": round(best.margin_inputs[1], 5),
                    "token_jaccard": round(best.margin_inputs[2], 5),
                    "first_token_same": bool(best.margin_inputs[3] > 0),
                },
                "top_candidates": [
                    {
                        "company_name": companies[s.company_idx].name_english,
                        "score": round(s.score, 5),
                    }
                    for s in scored[:3]
                ],
            },
        )

    def _candidate_ids(self, informative: set[str], compact: str, index: dict) -> set[int]:
        token_index: dict[str, set[int]] = index["token"]
        token_frequency: dict[str, int] = index["token_frequency"]
        prefix_index: dict[str, set[int]] = index["prefix"]

        ordered_tokens = sorted(
            informative,
            key=lambda token: (token_frequency.get(token, 10**9), -len(token), token),
        )

        candidate_ids: set[int] = set()

        for pos, token in enumerate(ordered_tokens[:4]):
            ids = token_index.get(token)
            if not ids:
                continue
            if pos == 0:
                candidate_ids = set(ids)
                continue

            intersected = candidate_ids & ids
            if intersected:
                candidate_ids = intersected
            else:
                candidate_ids |= ids

            if len(candidate_ids) > 3000:
                break

        if not candidate_ids and compact:
            prefix = compact[:4]
            if prefix:
                candidate_ids = set(prefix_index.get(prefix, set()))

        if len(candidate_ids) > 6000:
            # Keep candidate search bounded.
            candidate_ids = set(sorted(candidate_ids)[:6000])

        return candidate_ids

    def _score_candidates(
        self,
        normalized: str,
        compact: str,
        informative: set[str],
        candidate_ids: set[int],
        companies: list[IndexedCompany],
    ) -> list[CandidateScore]:
        c_trigrams = char_trigrams(compact)
        c_first_token = normalized.split()[0] if normalized else ""

        scored: list[CandidateScore] = []
        for idx in candidate_ids:
            candidate = companies[idx]

            jw = jaro_winkler_similarity(compact, candidate.compact)
            token_j = jaccard_similarity(informative, candidate.informative_tokens)
            containment = containment_similarity(informative, candidate.informative_tokens)
            trigram = jaccard_similarity(c_trigrams, candidate.trigrams)
            first_token_same = 1.0 if c_first_token and candidate.normalized.startswith(c_first_token) else 0.0
            contains_bonus = 1.0 if compact and (compact in candidate.compact or candidate.compact in compact) else 0.0

            score = (
                0.46 * jw
                + 0.24 * containment
                + 0.18 * token_j
                + 0.08 * trigram
                + 0.03 * first_token_same
                + 0.01 * contains_bonus
            )

            scored.append(
                CandidateScore(
                    company_idx=idx,
                    score=min(1.0, score),
                    margin_inputs=(jw, containment, token_j, first_token_same),
                )
            )

        scored.sort(key=lambda item: item.score, reverse=True)
        return scored[:20]

    def _pick_best_by_overlap(self, candidate_ids: list[int], informative: set[str], companies: list[IndexedCompany]) -> int:
        if len(candidate_ids) == 1:
            return candidate_ids[0]
        ranked = sorted(
            candidate_ids,
            key=lambda idx: (
                containment_similarity(informative, companies[idx].informative_tokens),
                jaccard_similarity(informative, companies[idx].informative_tokens),
                len(companies[idx].name_english),
            ),
            reverse=True,
        )
        return ranked[0]

    def _coverage(self, matches: list[ContractorMatch]) -> float:
        if not matches:
            return 0.0
        matched = sum(1 for match in matches if match.status == "matched")
        return matched / len(matches)

    def _promote_low_confidence_matches(self, matches: list[ContractorMatch], target_coverage: float) -> None:
        """Promote only the strongest unresolved fuzzy candidates when target is not met."""
        # Collect promotable unmatched rows with a non-trivial fuzzy score.
        promotable = [
            match for match in matches
            if match.status != "matched"
            and match.score is not None
            and match.company_idx is not None
            and match.details.get("strategy") == "fuzzy"
            and match.score >= 0.58
            and (
                bool((match.details.get("top_components") or {}).get("first_token_same"))
                or float((match.details.get("top_components") or {}).get("containment", 0.0)) >= 0.40
            )
        ]

        promotable.sort(key=lambda match: (match.score or 0.0, match.score_margin or 0.0), reverse=True)

        current_coverage = self._coverage(matches)
        idx = 0
        while current_coverage < target_coverage and idx < len(promotable):
            row = promotable[idx]
            top_candidates = row.details.get("top_candidates") or []
            if top_candidates:
                row.status = "matched"
                row.match_type = "fuzzy_promoted"
                row.confidence = min(0.7, max(row.confidence, (row.score or 0.0)))
                promoted_name = top_candidates[0].get("company_name")
                row.details["promoted"] = True
                row.details["promoted_company_name"] = promoted_name
            idx += 1
            current_coverage = self._coverage(matches)


def normalize_company_name(name: str | None) -> str:
    """Normalize company names to a canonical uppercase comparable form."""
    if not name:
        return ""

    text = name.upper()
    text = text.replace("&", " AND ")
    text = text.replace("/", " ")
    text = text.replace("_", " ")

    raw_tokens = WORD_RE.findall(text)
    normalized_tokens: list[str] = []

    for token in raw_tokens:
        replacement = TOKEN_NORMALIZATION.get(token, token)
        if not replacement:
            continue

        for part in replacement.split():
            if not part:
                continue
            if part in LEGAL_SUFFIX_TOKENS:
                continue
            normalized_tokens.append(part)

    return SPACE_RE.sub(" ", " ".join(normalized_tokens)).strip()


def tokenize(normalized_name: str) -> list[str]:
    if not normalized_name:
        return []
    return [token for token in normalized_name.split(" ") if token]


def informative_tokens(tokens: set[str]) -> set[str]:
    return {
        token for token in tokens
        if len(token) >= 3
        and token not in LEGAL_SUFFIX_TOKENS
        and token not in GENERIC_BUSINESS_TOKENS
        and not token.isdigit()
    }


def char_trigrams(text: str) -> set[str]:
    if not text:
        return set()
    if len(text) < 3:
        return {text}
    return {text[i:i + 3] for i in range(len(text) - 2)}


def jaccard_similarity(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    intersection = len(left & right)
    union = len(left | right)
    return intersection / union if union else 0.0


def containment_similarity(source: set[str], target: set[str]) -> float:
    if not source:
        return 0.0
    return len(source & target) / len(source)
