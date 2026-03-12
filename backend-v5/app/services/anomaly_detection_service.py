"""Anomaly Detection service -- cross-domain anomaly detection across corporate, director, and IRD data."""
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import select, func, and_, or_, case, text, literal_column
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import CompanyRegistration, CompanyDirector, IRDEnrichment
from app.schemas.anomaly import (
    AnomalySeverity,
    AnomalyType,
    SameDayCluster,
    SameDayCompany,
    RapidDirectorChange,
    NonFilerCluster,
    NonFilerClusterCompany,
    PANAnomaly,
    PANAnomalyCompany,
    AnomalySummary,
    AnomalyScanResult,
)

logger = logging.getLogger(__name__)


class AnomalyDetectionService:
    """
    Cross-domain anomaly detection engine.

    Runs analytical queries across company_registrations, company_directors,
    and ird_enrichments to surface suspicious patterns:
    - Same-day registration clusters at the same address
    - Rapid director appointment + resignation cycles
    - Addresses dominated by IRD non-filers
    - PANs linked to an unusual number of companies
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # 1. Same-Day Registration Clusters
    # ------------------------------------------------------------------

    async def detect_same_day_registration_clusters(
        self,
        min_count: int = 3,
        limit: int = 100,
    ) -> List[SameDayCluster]:
        """
        Find dates where min_count+ companies registered at the same address
        on the same day. This is a strong indicator of coordinated shell company
        creation.
        """
        CR = CompanyRegistration

        # Subquery: group by (date, address), count companies
        cluster_sq = (
            select(
                CR.registration_date_ad,
                CR.company_address,
                func.count(CR.id).label("company_count"),
            )
            .where(
                and_(
                    CR.registration_date_ad.isnot(None),
                    CR.company_address.isnot(None),
                    CR.company_address != "",
                )
            )
            .group_by(CR.registration_date_ad, CR.company_address)
            .having(func.count(CR.id) >= min_count)
            .order_by(func.count(CR.id).desc())
            .limit(limit)
            .subquery()
        )

        # Fetch the clusters
        cluster_rows = await self.db.execute(
            select(
                cluster_sq.c.registration_date_ad,
                cluster_sq.c.company_address,
                cluster_sq.c.company_count,
            )
        )
        clusters_raw = cluster_rows.all()

        results: List[SameDayCluster] = []
        for row in clusters_raw:
            reg_date = row.registration_date_ad
            address = row.company_address
            count = row.company_count

            # Fetch the actual companies for this cluster
            companies_q = await self.db.execute(
                select(CR)
                .where(
                    and_(
                        CR.registration_date_ad == reg_date,
                        CR.company_address == address,
                    )
                )
                .order_by(CR.registration_number)
            )
            companies_orm = companies_q.scalars().all()

            company_list = [
                SameDayCompany(
                    id=str(c.id),
                    name_english=c.name_english,
                    registration_number=c.registration_number,
                    pan=c.pan,
                    company_type_category=c.company_type_category,
                )
                for c in companies_orm
            ]

            severity = AnomalySeverity.CRITICAL if count >= 10 else (
                AnomalySeverity.HIGH if count >= 5 else AnomalySeverity.MEDIUM
            )

            results.append(SameDayCluster(
                severity=severity,
                title=f"{count} companies at same address on {reg_date}",
                description=(
                    f"{count} companies registered at '{address}' on {reg_date}. "
                    "This pattern may indicate coordinated shell company creation."
                ),
                entities=[str(c.id) for c in companies_orm],
                registration_date=str(reg_date) if reg_date else "",
                address=address or "",
                company_count=count,
                companies=company_list,
            ))

        return results

    # ------------------------------------------------------------------
    # 2. Rapid Director Changes
    # ------------------------------------------------------------------

    async def detect_rapid_director_changes(
        self,
        max_days: int = 90,
        limit: int = 200,
    ) -> List[RapidDirectorChange]:
        """
        Find directors who were appointed AND resigned within max_days days.
        Rapid turnover is a red flag for nominee directors in shell companies.
        """
        CD = CompanyDirector
        CR = CompanyRegistration

        stmt = (
            select(
                CD.id,
                CD.name_en,
                CD.role,
                CD.appointed_date,
                CD.resigned_date,
                CD.company_id,
                CR.name_english.label("company_name"),
            )
            .join(CR, CD.company_id == CR.id)
            .where(
                and_(
                    CD.appointed_date.isnot(None),
                    CD.resigned_date.isnot(None),
                    CD.company_id.isnot(None),
                    # resigned_date - appointed_date <= max_days and >= 0
                    (CD.resigned_date - CD.appointed_date) >= timedelta(days=0),
                    (CD.resigned_date - CD.appointed_date) <= timedelta(days=max_days),
                )
            )
            .order_by((CD.resigned_date - CD.appointed_date).asc())
            .limit(limit)
        )

        result = await self.db.execute(stmt)
        rows = result.all()

        changes: List[RapidDirectorChange] = []
        for row in rows:
            duration = (row.resigned_date - row.appointed_date).days

            severity = AnomalySeverity.CRITICAL if duration <= 7 else (
                AnomalySeverity.HIGH if duration <= 30 else (
                    AnomalySeverity.MEDIUM if duration <= 60 else AnomalySeverity.LOW
                )
            )

            changes.append(RapidDirectorChange(
                severity=severity,
                title=f"Director '{row.name_en}' served only {duration} days",
                description=(
                    f"Director '{row.name_en}' at '{row.company_name}' was appointed on "
                    f"{row.appointed_date} and resigned on {row.resigned_date} "
                    f"({duration} days). Rapid turnover may indicate nominee directorship."
                ),
                entities=[str(row.company_id)],
                company_id=str(row.company_id),
                company_name=row.company_name or "",
                director_name=row.name_en,
                director_role=row.role,
                appointed_date=str(row.appointed_date) if row.appointed_date else None,
                resigned_date=str(row.resigned_date) if row.resigned_date else None,
                duration_days=duration,
            ))

        return changes

    # ------------------------------------------------------------------
    # 3. Non-Filer Clusters
    # ------------------------------------------------------------------

    async def detect_non_filer_clusters(
        self,
        min_pct: float = 60.0,
        min_companies_at_address: int = 3,
        limit: int = 100,
    ) -> List[NonFilerCluster]:
        """
        Find addresses where the majority (>min_pct%) of companies are IRD non-filers.
        Requires joining company_registrations with ird_enrichments.
        """
        CR = CompanyRegistration
        IRD = IRDEnrichment

        # Count total companies and non-filers per address
        non_filer_case = case(
            (IRD.account_status.ilike("%Non-filer%"), 1),
            else_=0,
        )

        cluster_stmt = (
            select(
                CR.company_address,
                func.count(CR.id).label("total_companies"),
                func.sum(non_filer_case).label("non_filer_count"),
            )
            .join(IRD, CR.id == IRD.company_id)
            .where(
                and_(
                    CR.company_address.isnot(None),
                    CR.company_address != "",
                    IRD.account_status.isnot(None),
                )
            )
            .group_by(CR.company_address)
            .having(
                and_(
                    func.count(CR.id) >= min_companies_at_address,
                    (func.sum(non_filer_case) * 100.0 / func.count(CR.id)) >= min_pct,
                )
            )
            .order_by((func.sum(non_filer_case) * 100.0 / func.count(CR.id)).desc())
            .limit(limit)
        )

        result = await self.db.execute(cluster_stmt)
        rows = result.all()

        clusters: List[NonFilerCluster] = []
        for row in rows:
            address = row.company_address
            total = row.total_companies
            non_filers = int(row.non_filer_count or 0)
            pct = (non_filers / total * 100) if total > 0 else 0

            # Fetch companies at this address with their filer status
            company_stmt = (
                select(
                    CR.id,
                    CR.name_english,
                    CR.pan,
                    IRD.account_status,
                )
                .outerjoin(IRD, CR.id == IRD.company_id)
                .where(CR.company_address == address)
                .order_by(CR.name_english)
                .limit(20)  # Cap company list per cluster
            )
            comp_result = await self.db.execute(company_stmt)
            comp_rows = comp_result.all()

            company_list = [
                NonFilerClusterCompany(
                    id=str(cr.id),
                    name_english=cr.name_english,
                    pan=cr.pan,
                    is_non_filer=(
                        cr.account_status is not None
                        and "Non-filer" in (cr.account_status or "")
                    ),
                )
                for cr in comp_rows
            ]

            severity = AnomalySeverity.CRITICAL if pct >= 90 else (
                AnomalySeverity.HIGH if pct >= 75 else AnomalySeverity.MEDIUM
            )

            clusters.append(NonFilerCluster(
                severity=severity,
                title=f"{non_filers}/{total} non-filers at address ({pct:.0f}%)",
                description=(
                    f"At '{address}', {non_filers} out of {total} companies ({pct:.1f}%) "
                    "are IRD non-filers. High non-filer concentration suggests potential "
                    "tax avoidance cluster."
                ),
                entities=[str(cr.id) for cr in comp_rows],
                address=address or "",
                total_companies=total,
                non_filer_count=non_filers,
                non_filer_pct=round(pct, 2),
                companies=company_list,
            ))

        return clusters

    # ------------------------------------------------------------------
    # 4. PAN Anomalies
    # ------------------------------------------------------------------

    async def detect_pan_anomalies(
        self,
        min_companies: int = 5,
        limit: int = 100,
    ) -> List[PANAnomaly]:
        """
        Find PANs linked to min_companies+ companies.
        A single PAN controlling many companies is unusual and warrants investigation.
        """
        CR = CompanyRegistration

        pan_stmt = (
            select(
                CR.pan,
                func.count(CR.id).label("company_count"),
            )
            .where(
                and_(
                    CR.pan.isnot(None),
                    CR.pan != "",
                )
            )
            .group_by(CR.pan)
            .having(func.count(CR.id) >= min_companies)
            .order_by(func.count(CR.id).desc())
            .limit(limit)
        )

        result = await self.db.execute(pan_stmt)
        rows = result.all()

        anomalies: List[PANAnomaly] = []
        for row in rows:
            pan_val = row.pan
            count = row.company_count

            # Fetch companies under this PAN
            companies_q = await self.db.execute(
                select(CR)
                .where(CR.pan == pan_val)
                .order_by(CR.registration_number)
                .limit(50)  # Cap per PAN
            )
            companies_orm = companies_q.scalars().all()

            company_list = [
                PANAnomalyCompany(
                    id=str(c.id),
                    name_english=c.name_english,
                    registration_number=c.registration_number,
                    company_address=c.company_address,
                )
                for c in companies_orm
            ]

            severity = AnomalySeverity.CRITICAL if count >= 20 else (
                AnomalySeverity.HIGH if count >= 10 else AnomalySeverity.MEDIUM
            )

            anomalies.append(PANAnomaly(
                severity=severity,
                title=f"PAN {pan_val} linked to {count} companies",
                description=(
                    f"PAN '{pan_val}' is associated with {count} companies. "
                    "A single PAN controlling many entities is unusual and "
                    "may indicate a corporate network requiring investigation."
                ),
                entities=[str(c.id) for c in companies_orm],
                pan=pan_val or "",
                company_count=count,
                companies=company_list,
            ))

        return anomalies

    # ------------------------------------------------------------------
    # 5. Summary (counts only, fast)
    # ------------------------------------------------------------------

    async def get_anomaly_summary(self) -> AnomalySummary:
        """
        Fast aggregate counts of each anomaly type.
        Uses count-only queries (no detail fetching) for dashboard widgets.
        """
        CR = CompanyRegistration
        CD = CompanyDirector
        IRD = IRDEnrichment

        # 1. Same-day cluster count
        same_day_sq = (
            select(func.count().label("cnt"))
            .select_from(
                select(
                    CR.registration_date_ad,
                    CR.company_address,
                )
                .where(
                    and_(
                        CR.registration_date_ad.isnot(None),
                        CR.company_address.isnot(None),
                        CR.company_address != "",
                    )
                )
                .group_by(CR.registration_date_ad, CR.company_address)
                .having(func.count(CR.id) >= 3)
                .subquery()
            )
        )
        same_day_result = await self.db.execute(same_day_sq)
        same_day_count = same_day_result.scalar() or 0

        # 2. Rapid director changes count
        rapid_stmt = (
            select(func.count(CD.id))
            .where(
                and_(
                    CD.appointed_date.isnot(None),
                    CD.resigned_date.isnot(None),
                    CD.company_id.isnot(None),
                    (CD.resigned_date - CD.appointed_date) >= timedelta(days=0),
                    (CD.resigned_date - CD.appointed_date) <= timedelta(days=90),
                )
            )
        )
        rapid_result = await self.db.execute(rapid_stmt)
        rapid_count = rapid_result.scalar() or 0

        # 3. Non-filer cluster count
        non_filer_case = case(
            (IRD.account_status.ilike("%Non-filer%"), 1),
            else_=0,
        )
        nf_sq = (
            select(func.count().label("cnt"))
            .select_from(
                select(
                    CR.company_address,
                )
                .join(IRD, CR.id == IRD.company_id)
                .where(
                    and_(
                        CR.company_address.isnot(None),
                        CR.company_address != "",
                        IRD.account_status.isnot(None),
                    )
                )
                .group_by(CR.company_address)
                .having(
                    and_(
                        func.count(CR.id) >= 3,
                        (func.sum(non_filer_case) * 100.0 / func.count(CR.id)) >= 60,
                    )
                )
                .subquery()
            )
        )
        nf_result = await self.db.execute(nf_sq)
        nf_count = nf_result.scalar() or 0

        # 4. PAN anomaly count
        pan_sq = (
            select(func.count().label("cnt"))
            .select_from(
                select(CR.pan)
                .where(
                    and_(
                        CR.pan.isnot(None),
                        CR.pan != "",
                    )
                )
                .group_by(CR.pan)
                .having(func.count(CR.id) >= 5)
                .subquery()
            )
        )
        pan_result = await self.db.execute(pan_sq)
        pan_count = pan_result.scalar() or 0

        total = same_day_count + rapid_count + nf_count + pan_count

        return AnomalySummary(
            same_day_clusters=same_day_count,
            rapid_director_changes=rapid_count,
            non_filer_clusters=nf_count,
            pan_anomalies=pan_count,
            total=total,
        )

    # ------------------------------------------------------------------
    # 6. Full Scan
    # ------------------------------------------------------------------

    async def run_full_scan(self) -> AnomalyScanResult:
        """
        Run all anomaly detectors and return combined results.
        """
        same_day = await self.detect_same_day_registration_clusters()
        rapid = await self.detect_rapid_director_changes()
        non_filer = await self.detect_non_filer_clusters()
        pan = await self.detect_pan_anomalies()

        summary = AnomalySummary(
            same_day_clusters=len(same_day),
            rapid_director_changes=len(rapid),
            non_filer_clusters=len(non_filer),
            pan_anomalies=len(pan),
            total=len(same_day) + len(rapid) + len(non_filer) + len(pan),
        )

        return AnomalyScanResult(
            summary=summary,
            same_day_clusters=same_day,
            rapid_director_changes=rapid,
            non_filer_clusters=non_filer,
            pan_anomalies=pan,
            scanned_at=datetime.utcnow(),
        )
