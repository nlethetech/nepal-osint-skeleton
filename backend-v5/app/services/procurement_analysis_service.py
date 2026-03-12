"""Procurement analysis service — risk scoring, cross-referencing, and case integration."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import select, func, and_, or_, desc, cast, String, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.procurement import GovtContract
from app.models.case import Case, CaseEvidence, CaseStatus, CasePriority, CaseVisibility, EvidenceType
from app.models.connected_analyst import CaseHypothesis, HypothesisStatus
from app.models.verification import VerificationRequest, VerifiableType, VerificationStatus
from app.models.watchlist import WatchlistItem, WatchableType
from app.services.procurement_company_linkage_service import ProcurementCompanyLinkageService


# Risk scoring weights
W_SINGLE_SOURCE = 0.35
W_REPEAT_AWARDS = 0.25
W_SAME_DAY = 0.20
W_OCR_MISMATCH = 0.20


class ProcurementAnalysisService:
    """Investigation-grade procurement analysis over govt_contracts + company_registrations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Discovery ──────────────────────────────────────────────

    async def get_summary(self) -> dict:
        """Dashboard KPIs."""
        total_q = select(func.count()).select_from(GovtContract)
        value_q = select(func.coalesce(func.sum(GovtContract.contract_amount_npr), 0))
        entities_q = select(func.count(func.distinct(GovtContract.procuring_entity)))
        contractors_q = select(func.count(func.distinct(GovtContract.contractor_name)))
        date_range_q = select(
            func.min(GovtContract.contract_award_date),
            func.max(GovtContract.contract_award_date),
        )

        (
            total,
            total_value,
            unique_entities,
            unique_contractors,
            (earliest, latest),
        ) = await self._fetch_all(total_q, value_q, entities_q, contractors_q, date_range_q)

        linkage_stats = await ProcurementCompanyLinkageService(self.db).ensure_links(target_coverage=0.90)
        ocr_match_count = int(linkage_stats.get("matched_count", 0))
        ocr_match_rate = round(float(linkage_stats.get("match_rate", 0.0)), 1)

        # Flagged pairs: entity-contractor pairs with >= 3 contracts
        flagged_q = (
            select(func.count())
            .select_from(
                select(
                    GovtContract.procuring_entity,
                    GovtContract.contractor_name,
                )
                .group_by(GovtContract.procuring_entity, GovtContract.contractor_name)
                .having(func.count() >= 3)
                .subquery()
            )
        )
        flagged_pairs = (await self.db.execute(flagged_q)).scalar() or 0

        return {
            "total_contracts": total,
            "total_value_npr": float(total_value),
            "unique_entities": unique_entities,
            "unique_contractors": unique_contractors,
            "ocr_match_count": ocr_match_count,
            "ocr_match_rate": ocr_match_rate,
            "date_range": {
                "earliest": earliest.isoformat() if earliest else None,
                "latest": latest.isoformat() if latest else None,
            },
            "flagged_pairs_count": flagged_pairs,
        }

    async def get_risk_scored_flags(
        self,
        min_contracts: int = 3,
        min_budget_pct: float = 30.0,
        sort_by: str = "risk_score",
        limit: int = 50,
    ) -> list[dict]:
        """Composite risk scoring for entity-contractor pairs."""

        # Step 1: Get entity-contractor pair stats
        pair_q = (
            select(
                GovtContract.procuring_entity,
                GovtContract.contractor_name,
                func.count().label("contract_count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("total_value"),
            )
            .group_by(GovtContract.procuring_entity, GovtContract.contractor_name)
            .having(func.count() >= min_contracts)
        )
        pair_rows = (await self.db.execute(pair_q)).all()

        if not pair_rows:
            return []

        # Step 2: Get entity totals for budget % calculation
        entity_totals_q = (
            select(
                GovtContract.procuring_entity,
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("entity_total"),
            )
            .group_by(GovtContract.procuring_entity)
        )
        entity_totals = {
            row.procuring_entity: float(row.entity_total)
            for row in (await self.db.execute(entity_totals_q)).all()
        }

        linkage_service = ProcurementCompanyLinkageService(self.db)
        await linkage_service.ensure_links(target_coverage=0.90)
        matched_contractors = await linkage_service.get_matched_contractor_names()

        # Step 4: Get same-day award counts per entity-contractor pair
        same_day_q = (
            select(
                GovtContract.procuring_entity,
                GovtContract.contractor_name,
                func.count().label("same_day_entries"),
            )
            .where(GovtContract.contract_award_date.isnot(None))
            .group_by(
                GovtContract.procuring_entity,
                GovtContract.contractor_name,
                GovtContract.contract_award_date,
            )
            .having(func.count() >= 2)
        )
        same_day_sub = same_day_q.subquery()
        same_day_agg_q = (
            select(
                same_day_sub.c.procuring_entity,
                same_day_sub.c.contractor_name,
                func.sum(same_day_sub.c.same_day_entries).label("same_day_total"),
            )
            .group_by(same_day_sub.c.procuring_entity, same_day_sub.c.contractor_name)
        )
        same_day_map: dict[tuple[str, str], int] = {}
        for row in (await self.db.execute(same_day_agg_q)).all():
            same_day_map[(row.procuring_entity, row.contractor_name)] = int(row.same_day_total)

        # Step 5: Score each pair
        results = []
        for row in pair_rows:
            entity = row.procuring_entity
            contractor = row.contractor_name
            count = row.contract_count
            total_val = float(row.total_value)
            entity_total = entity_totals.get(entity, 1.0)
            budget_pct = round(total_val / entity_total * 100, 1) if entity_total > 0 else 0

            if budget_pct < min_budget_pct:
                continue

            flags: list[str] = []

            # Single-source dominance
            ssd_score = 0.0
            if budget_pct > 50:
                ssd_score = min((budget_pct - 50) / 50, 1.0)
                flags.append("single_source")

            # Repeat awards
            repeat_score = 0.0
            if count > 5:
                repeat_score = min((count - 5) / 10, 1.0)
                flags.append("repeat_awards")

            # Same-day clustering
            same_day_count = same_day_map.get((entity, contractor), 0)
            same_day_score = 0.0
            if same_day_count >= 2:
                same_day_score = min(same_day_count / 6, 1.0)
                flags.append("same_day")

            # OCR mismatch
            ocr_score = 0.0
            if contractor not in matched_contractors:
                ocr_score = 1.0
                flags.append("no_ocr_match")

            risk_score = round(
                (
                    W_SINGLE_SOURCE * ssd_score
                    + W_REPEAT_AWARDS * repeat_score
                    + W_SAME_DAY * same_day_score
                    + W_OCR_MISMATCH * ocr_score
                )
                * 100,
                1,
            )

            if risk_score < 1:
                continue

            risk_level = (
                "critical" if risk_score >= 80 else
                "high" if risk_score >= 60 else
                "medium" if risk_score >= 40 else
                "low"
            )

            # Get individual contracts for this pair
            contracts_q = (
                select(GovtContract)
                .where(
                    GovtContract.procuring_entity == entity,
                    GovtContract.contractor_name == contractor,
                )
                .order_by(desc(GovtContract.contract_award_date))
                .limit(20)
            )
            contracts_rows = (await self.db.execute(contracts_q)).scalars().all()
            contracts = [
                {
                    "id": str(c.id),
                    "project_name": c.project_name,
                    "amount": c.contract_amount_npr,
                    "date": c.contract_award_date.isoformat() if c.contract_award_date else None,
                    "procurement_type": c.procurement_type,
                }
                for c in contracts_rows
            ]

            results.append({
                "procuring_entity": entity,
                "contractor_name": contractor,
                "risk_score": risk_score,
                "risk_level": risk_level,
                "contract_count": count,
                "total_value": total_val,
                "budget_pct": budget_pct,
                "flags": flags,
                "contracts": contracts,
            })

        # Sort
        if sort_by == "budget_pct":
            results.sort(key=lambda x: x["budget_pct"], reverse=True)
        elif sort_by == "contract_count":
            results.sort(key=lambda x: x["contract_count"], reverse=True)
        elif sort_by == "total_value":
            results.sort(key=lambda x: x["total_value"], reverse=True)
        else:
            results.sort(key=lambda x: x["risk_score"], reverse=True)

        return results[:limit]

    async def get_same_day_awards(self, min_same_day: int = 2) -> list[dict]:
        """Entities awarding 2+ contracts on same day."""
        q = (
            select(
                GovtContract.procuring_entity,
                GovtContract.contract_award_date,
                func.count().label("contract_count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("total_value"),
            )
            .where(GovtContract.contract_award_date.isnot(None))
            .group_by(GovtContract.procuring_entity, GovtContract.contract_award_date)
            .having(func.count() >= min_same_day)
            .order_by(desc(func.count()))
            .limit(100)
        )
        rows = (await self.db.execute(q)).all()
        results = []
        for row in rows:
            # Get contractor details for this entity+date
            detail_q = (
                select(GovtContract)
                .where(
                    GovtContract.procuring_entity == row.procuring_entity,
                    GovtContract.contract_award_date == row.contract_award_date,
                )
                .order_by(desc(GovtContract.contract_amount_npr))
            )
            detail_rows = (await self.db.execute(detail_q)).scalars().all()
            contractors = [
                {
                    "name": c.contractor_name,
                    "amount": c.contract_amount_npr,
                    "project": c.project_name,
                }
                for c in detail_rows
            ]
            results.append({
                "procuring_entity": row.procuring_entity,
                "award_date": row.contract_award_date.isoformat() if row.contract_award_date else None,
                "contract_count": row.contract_count,
                "total_value": float(row.total_value),
                "contractors": contractors,
            })
        return results

    async def get_entity_contractor_matrix(
        self, limit_entities: int = 25, limit_contractors: int = 25
    ) -> dict:
        """Top entities x top contractors heatmap data."""
        # Top entities by total value
        top_entities_q = (
            select(GovtContract.procuring_entity)
            .group_by(GovtContract.procuring_entity)
            .order_by(desc(func.sum(GovtContract.contract_amount_npr)))
            .limit(limit_entities)
        )
        entities = [r[0] for r in (await self.db.execute(top_entities_q)).all()]

        # Top contractors by total value
        top_contractors_q = (
            select(GovtContract.contractor_name)
            .group_by(GovtContract.contractor_name)
            .order_by(desc(func.sum(GovtContract.contract_amount_npr)))
            .limit(limit_contractors)
        )
        contractors = [r[0] for r in (await self.db.execute(top_contractors_q)).all()]

        if not entities or not contractors:
            return {"entities": [], "contractors": [], "cells": []}

        # Get pair values
        matrix_q = (
            select(
                GovtContract.procuring_entity,
                GovtContract.contractor_name,
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("value"),
                func.count().label("count"),
            )
            .where(
                GovtContract.procuring_entity.in_(entities),
                GovtContract.contractor_name.in_(contractors),
            )
            .group_by(GovtContract.procuring_entity, GovtContract.contractor_name)
        )
        matrix_rows = (await self.db.execute(matrix_q)).all()

        entity_idx = {e: i for i, e in enumerate(entities)}
        contractor_idx = {c: i for i, c in enumerate(contractors)}
        cells = []
        for row in matrix_rows:
            cells.append({
                "entity_idx": entity_idx[row.procuring_entity],
                "contractor_idx": contractor_idx[row.contractor_name],
                "value": float(row.value),
                "count": row.count,
            })

        return {"entities": entities, "contractors": contractors, "cells": cells}

    # ── Cross-Reference ────────────────────────────────────────

    async def get_ocr_cross_reference(self, limit: int = 50, refresh: bool = False) -> list[dict]:
        """Match contractors to company_registrations via name matching."""
        # Get distinct contractors with their contract counts
        contractors_q = (
            select(
                GovtContract.contractor_name,
                func.count().label("contract_count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("total_value"),
            )
            .group_by(GovtContract.contractor_name)
            .order_by(desc(func.sum(GovtContract.contract_amount_npr)))
            .limit(limit)
        )
        contractor_rows = (await self.db.execute(contractors_q)).all()

        linkage_service = ProcurementCompanyLinkageService(self.db)
        await linkage_service.ensure_links(target_coverage=0.90, force_refresh=refresh)
        links = await linkage_service.get_links_map([row.contractor_name for row in contractor_rows])

        results = []
        for row in contractor_rows:
            contractor_name = row.contractor_name
            link = links.get(contractor_name)
            company = link.get("company") if link else None
            internal_match_type = link.get("match_type") if link else None
            confidence = float(link.get("confidence") or 0.0) if link else 0.0

            if company:
                top_level_match_type = (
                    "exact"
                    if internal_match_type in {"exact_normalized", "exact_compact", "acronym"}
                    else "fuzzy"
                )
                reg_age = None
                registration_date_ad = company.get("registration_date_ad")
                if registration_date_ad:
                    reg_age = round(
                        (datetime.now(timezone.utc).date() - registration_date_ad).days / 365.25, 1
                    )
                results.append({
                    "contractor_name": contractor_name,
                    "match_type": top_level_match_type,
                    "match_method": internal_match_type,
                    "match_confidence": round(confidence, 4),
                    "company": {
                        "name_english": company.get("name_english"),
                        "registration_number": company.get("registration_number"),
                        "registration_date_bs": company.get("registration_date_bs"),
                        "district": company.get("district"),
                        "company_type_category": company.get("company_type_category"),
                        "address": company.get("address"),
                    },
                    "contract_count": row.contract_count,
                    "total_value": float(row.total_value),
                    "registration_age_years": reg_age,
                })
            else:
                results.append({
                    "contractor_name": contractor_name,
                    "match_type": "none",
                    "match_method": internal_match_type or "unmatched",
                    "match_confidence": round(confidence, 4),
                    "company": None,
                    "contract_count": row.contract_count,
                    "total_value": float(row.total_value),
                    "registration_age_years": None,
                })

        return results

    # ── Entity Drilldown ───────────────────────────────────────

    async def get_entity_drilldown(self, entity_name: str) -> dict:
        """Full procurement profile for one government entity."""
        base = select(GovtContract).where(GovtContract.procuring_entity == entity_name)

        # Total stats
        stats_q = select(
            func.count().label("total_contracts"),
            func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("total_value"),
        ).where(GovtContract.procuring_entity == entity_name)
        stats = (await self.db.execute(stats_q)).one()

        total_value = float(stats.total_value)

        # Contractor breakdown
        contractors_q = (
            select(
                GovtContract.contractor_name,
                func.count().label("count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("value"),
            )
            .where(GovtContract.procuring_entity == entity_name)
            .group_by(GovtContract.contractor_name)
            .order_by(desc(func.sum(GovtContract.contract_amount_npr)))
        )
        contractor_rows = (await self.db.execute(contractors_q)).all()

        linkage_service = ProcurementCompanyLinkageService(self.db)
        await linkage_service.ensure_links(target_coverage=0.90)
        link_map = await linkage_service.get_links_map([row.contractor_name for row in contractor_rows])

        contractors = []
        for row in contractor_rows:
            val = float(row.value)
            pct = round(val / total_value * 100, 1) if total_value > 0 else 0
            link = link_map.get(row.contractor_name) or {}
            ocr_match = link.get("company")
            contractors.append({
                "name": row.contractor_name,
                "count": row.count,
                "value": val,
                "pct": pct,
                "ocr_match": ocr_match,
            })

        # By fiscal year
        by_year_q = (
            select(
                GovtContract.fiscal_year_bs,
                func.count().label("count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("value"),
            )
            .where(GovtContract.procuring_entity == entity_name)
            .group_by(GovtContract.fiscal_year_bs)
            .order_by(GovtContract.fiscal_year_bs)
        )
        by_year = [
            {"fiscal_year": r.fiscal_year_bs, "count": r.count, "value": float(r.value)}
            for r in (await self.db.execute(by_year_q)).all()
        ]

        # Timeline
        timeline_q = (
            select(GovtContract)
            .where(GovtContract.procuring_entity == entity_name)
            .order_by(desc(GovtContract.contract_award_date))
            .limit(50)
        )
        timeline = [
            {
                "date": c.contract_award_date.isoformat() if c.contract_award_date else None,
                "contractor": c.contractor_name,
                "amount": c.contract_amount_npr,
                "project": c.project_name,
            }
            for c in (await self.db.execute(timeline_q)).scalars().all()
        ]

        # Generate flags
        flags = []
        for c in contractors:
            if c["pct"] > 50:
                flags.append({
                    "type": "single_source",
                    "detail": f"{c['name']} holds {c['pct']}% of total budget",
                    "severity": "critical" if c["pct"] > 80 else "high",
                })
            if not c["ocr_match"]:
                flags.append({
                    "type": "no_ocr_match",
                    "detail": f"{c['name']} not found in OCR registry",
                    "severity": "medium",
                })

        # Check same-day awards
        same_day_q = (
            select(
                GovtContract.contract_award_date,
                func.count().label("n"),
            )
            .where(
                GovtContract.procuring_entity == entity_name,
                GovtContract.contract_award_date.isnot(None),
            )
            .group_by(GovtContract.contract_award_date)
            .having(func.count() >= 2)
        )
        for row in (await self.db.execute(same_day_q)).all():
            flags.append({
                "type": "same_day",
                "detail": f"{row.n} contracts awarded on {row.contract_award_date.isoformat()}",
                "severity": "high" if row.n >= 3 else "medium",
            })

        # Existing cases mentioning this entity
        existing_cases_q = (
            select(Case.id, Case.title, Case.status)
            .where(
                or_(
                    Case.title.ilike(f"%{entity_name[:30]}%"),
                    Case.description.ilike(f"%{entity_name[:30]}%"),
                )
            )
            .limit(10)
        )
        existing_cases = [
            {"id": str(r.id), "title": r.title, "status": r.status.value}
            for r in (await self.db.execute(existing_cases_q)).all()
        ]

        return {
            "entity": entity_name,
            "total_contracts": stats.total_contracts,
            "total_value": total_value,
            "contractors": contractors,
            "by_year": by_year,
            "timeline": timeline,
            "flags": flags,
            "existing_cases": existing_cases,
        }

    async def get_contractor_profile(self, contractor_name: str) -> dict:
        """Full profile for one contractor across all entities."""
        stats_q = select(
            func.count().label("total_contracts"),
            func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("total_value"),
        ).where(GovtContract.contractor_name == contractor_name)
        stats = (await self.db.execute(stats_q)).one()

        # Entities breakdown
        entities_q = (
            select(
                GovtContract.procuring_entity,
                func.count().label("count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("value"),
            )
            .where(GovtContract.contractor_name == contractor_name)
            .group_by(GovtContract.procuring_entity)
            .order_by(desc(func.sum(GovtContract.contract_amount_npr)))
        )
        total_value = float(stats.total_value)
        entities = [
            {
                "name": r.procuring_entity,
                "count": r.count,
                "value": float(r.value),
                "pct": round(float(r.value) / total_value * 100, 1) if total_value > 0 else 0,
            }
            for r in (await self.db.execute(entities_q)).all()
        ]

        linkage_service = ProcurementCompanyLinkageService(self.db)
        await linkage_service.ensure_links(target_coverage=0.90)
        linked = await linkage_service.get_linked_company_for_contractor(contractor_name)
        ocr_match = linked.get("company") if linked else None

        # By fiscal year
        by_year_q = (
            select(
                GovtContract.fiscal_year_bs,
                func.count().label("count"),
                func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("value"),
            )
            .where(GovtContract.contractor_name == contractor_name)
            .group_by(GovtContract.fiscal_year_bs)
            .order_by(GovtContract.fiscal_year_bs)
        )
        by_year = [
            {"fiscal_year": r.fiscal_year_bs, "count": r.count, "value": float(r.value)}
            for r in (await self.db.execute(by_year_q)).all()
        ]

        # Timeline
        timeline_q = (
            select(GovtContract)
            .where(GovtContract.contractor_name == contractor_name)
            .order_by(desc(GovtContract.contract_award_date))
            .limit(50)
        )
        timeline = [
            {
                "date": c.contract_award_date.isoformat() if c.contract_award_date else None,
                "entity": c.procuring_entity,
                "amount": c.contract_amount_npr,
                "project": c.project_name,
            }
            for c in (await self.db.execute(timeline_q)).scalars().all()
        ]

        return {
            "contractor": contractor_name,
            "total_contracts": stats.total_contracts,
            "total_value": total_value,
            "entities": entities,
            "ocr_match": ocr_match,
            "by_year": by_year,
            "timeline": timeline,
        }

    # ── Case Integration ───────────────────────────────────────

    async def create_investigation_case(
        self,
        flag_data: dict,
        analyst_id: UUID,
        hypothesis_text: str | None = None,
    ) -> dict:
        """Create a Case pre-populated with procurement evidence."""
        entity = flag_data.get("procuring_entity", "Unknown Entity")
        contractor = flag_data.get("contractor_name", "Unknown Contractor")
        risk_score = flag_data.get("risk_score", 0)
        flags = flag_data.get("flags", [])
        contracts = flag_data.get("contracts", [])
        budget_pct = flag_data.get("budget_pct", 0)
        total_value = flag_data.get("total_value", 0)

        # 1. Create Case
        priority = CasePriority.HIGH if risk_score > 70 else CasePriority.MEDIUM
        description = (
            f"Automated procurement investigation flag.\n\n"
            f"Risk Score: {risk_score}/100\n"
            f"Flags: {', '.join(flags)}\n"
            f"Contracts: {len(contracts)}\n"
            f"Total Value: NPR {total_value:,.0f}\n"
            f"Budget Concentration: {budget_pct}%\n"
        )

        case = Case(
            id=uuid4(),
            title=f"Procurement: {entity[:80]} \u2194 {contractor[:80]}",
            description=description,
            status=CaseStatus.ACTIVE,
            priority=priority,
            visibility=CaseVisibility.PUBLIC,
            category="economic",
            tags=["procurement", "automated-flag"] + flags,
            created_by_id=analyst_id,
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(case)
        await self.db.flush()

        # 2. Create CaseEvidence for each contract
        evidence_count = 0
        for i, contract in enumerate(contracts[:20]):
            evidence = CaseEvidence(
                id=uuid4(),
                case_id=case.id,
                evidence_type=EvidenceType.LINK,
                title=contract.get("project_name", f"Contract #{i+1}"),
                summary=f"NPR {contract.get('amount', 0):,.0f} awarded {contract.get('date', 'N/A')} via {contract.get('procurement_type', 'N/A')}",
                relevance_notes=f"Part of {entity} \u2194 {contractor} pattern ({', '.join(flags)})",
                is_key_evidence=(i == 0),
                confidence="likely",
                added_by_id=analyst_id,
                reference_id=contract.get("id"),
            )
            self.db.add(evidence)
            evidence_count += 1

        # 3. OCR cross-ref evidence
        linkage_service = ProcurementCompanyLinkageService(self.db)
        await linkage_service.ensure_links(target_coverage=0.90)
        linked = await linkage_service.get_linked_company_for_contractor(contractor)
        ocr_match = linked.get("company") if linked else None
        if ocr_match:
            ocr_evidence = CaseEvidence(
                id=uuid4(),
                case_id=case.id,
                evidence_type=EvidenceType.DOCUMENT,
                title=f"OCR Registry: {ocr_match.get('name_english')}",
                summary=f"Reg#{ocr_match.get('registration_number')}, {ocr_match.get('district')}, {ocr_match.get('company_type_category')}",
                relevance_notes="Company registration cross-reference",
                confidence="confirmed",
                added_by_id=analyst_id,
                reference_id=ocr_match.get("id"),
            )
            self.db.add(ocr_evidence)
            evidence_count += 1

        # 4. Hypothesis
        hypothesis_id = None
        if hypothesis_text is None:
            hypothesis_text = (
                f"Single-source corruption: {entity} consistently awards contracts "
                f"to {contractor} ({budget_pct}% of total budget, {len(contracts)} contracts)"
            )

        hyp = CaseHypothesis(
            case_id=case.id,
            statement=hypothesis_text,
            status=HypothesisStatus.OPEN,
            confidence=min(risk_score / 100.0, 1.0),
            created_by_id=analyst_id,
            updated_by_id=analyst_id,
        )
        self.db.add(hyp)
        await self.db.flush()
        hypothesis_id = str(hyp.id)

        await self.db.commit()

        return {
            "case_id": str(case.id),
            "title": case.title,
            "evidence_count": evidence_count,
            "hypothesis_id": hypothesis_id,
        }

    async def create_verification_request(
        self,
        flag_data: dict,
        analyst_id: UUID,
    ) -> dict:
        """Create VerificationRequest for a procurement flag."""
        entity = flag_data.get("procuring_entity", "Unknown")
        contractor = flag_data.get("contractor_name", "Unknown")
        risk_score = flag_data.get("risk_score", 0)
        flags = flag_data.get("flags", [])
        budget_pct = flag_data.get("budget_pct", 0)
        contract_count = flag_data.get("contract_count", 0)

        claim = (
            f"{entity} shows suspicious procurement patterns with {contractor}: "
            f"{contract_count} contracts, {budget_pct}% budget concentration. "
            f"Flags: {', '.join(flags)}. Risk score: {risk_score}/100."
        )

        evidence_data = {
            "risk_score": risk_score,
            "flags": flags,
            "budget_pct": budget_pct,
            "contract_count": contract_count,
            "total_value": flag_data.get("total_value", 0),
        }

        vr = VerificationRequest(
            id=uuid4(),
            item_type=VerifiableType.ENTITY,
            item_id=f"procurement:{entity}:{contractor}",
            claim=claim,
            context=f"Automated procurement analysis flag. Review entity-contractor relationship for potential irregularities.",
            evidence=evidence_data,
            status=VerificationStatus.PENDING,
            priority="urgent" if risk_score > 70 else "normal",
            requested_by_id=analyst_id,
        )
        self.db.add(vr)
        await self.db.commit()

        return {
            "request_id": str(vr.id),
            "claim": vr.claim,
            "status": vr.status.value,
        }

    async def add_to_watchlist(
        self,
        watchlist_id: UUID,
        item_type: str,
        value: str,
        analyst_id: UUID,
    ) -> dict:
        """Add entity or contractor to an existing watchlist."""
        watchable = WatchableType.ORGANIZATION if item_type == "ORGANIZATION" else WatchableType.PERSON

        item = WatchlistItem(
            id=uuid4(),
            watchlist_id=watchlist_id,
            item_type=watchable,
            value=value,
            notes=f"Added from procurement analysis workbench",
        )
        self.db.add(item)
        await self.db.commit()

        return {
            "item_id": str(item.id),
            "watchlist_id": str(watchlist_id),
        }

    # ── Helpers ─────────────────────────────────────────────────

    async def _fetch_all(self, *queries):
        """Execute multiple scalar queries and return results as tuple."""
        results = []
        for q in queries:
            result = await self.db.execute(q)
            row = result.one_or_none()
            if row is None:
                results.append(0)
            elif hasattr(row, "_mapping"):
                values = list(row._mapping.values())
                results.append(values[0] if len(values) == 1 else row)
            elif isinstance(row, (tuple, list)):
                results.append(row[0] if len(row) == 1 else row)
            else:
                results.append(row)
        return tuple(results)
