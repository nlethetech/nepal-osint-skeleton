"""Corporate Analytics service -- advanced cross-table analytics for NARADA v6."""
import logging
from typing import Optional, List, Dict, Any
from datetime import date, timedelta

from sqlalchemy import select, func, and_, or_, desc, asc, extract, cast, Date, literal_column, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.company import CompanyRegistration, CompanyDirector, IRDEnrichment

logger = logging.getLogger(__name__)


class CorporateAnalyticsService:
    """
    Advanced analytical service providing beneficial ownership discovery,
    shell company scoring, tax compliance dashboards, network stats,
    and registration pattern analysis.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # 1. Beneficial Ownership Discovery
    # ------------------------------------------------------------------

    async def find_beneficial_owners(
        self,
        min_companies: int = 3,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """
        Find persons who are directors of N+ companies (potential beneficial owners).
        Groups by citizenship_no when available, else by name_en.
        Returns person name, citizenship_no, list of companies, total companies count.
        """
        # Sub-query: count distinct companies per director identity
        # Prefer citizenship_no grouping when available for accuracy
        # First: directors with citizenship_no
        cit_subq = (
            select(
                CompanyDirector.citizenship_no,
                func.min(CompanyDirector.name_en).label("name_en"),
                func.count(func.distinct(CompanyDirector.company_id)).label("company_count"),
            )
            .where(
                and_(
                    CompanyDirector.citizenship_no.isnot(None),
                    CompanyDirector.citizenship_no != "",
                    CompanyDirector.company_id.isnot(None),
                )
            )
            .group_by(CompanyDirector.citizenship_no)
            .having(func.count(func.distinct(CompanyDirector.company_id)) >= min_companies)
            .order_by(desc("company_count"))
            .offset(offset)
            .limit(limit)
            .subquery()
        )

        cit_result = await self.db.execute(
            select(cit_subq.c.citizenship_no, cit_subq.c.name_en, cit_subq.c.company_count)
        )
        cit_rows = cit_result.all()

        # Also find by name_en for directors without citizenship_no
        name_subq = (
            select(
                CompanyDirector.name_en,
                func.count(func.distinct(CompanyDirector.company_id)).label("company_count"),
            )
            .where(
                and_(
                    or_(
                        CompanyDirector.citizenship_no.is_(None),
                        CompanyDirector.citizenship_no == "",
                    ),
                    CompanyDirector.company_id.isnot(None),
                )
            )
            .group_by(CompanyDirector.name_en)
            .having(func.count(func.distinct(CompanyDirector.company_id)) >= min_companies)
            .order_by(desc("company_count"))
            .offset(offset)
            .limit(limit)
            .subquery()
        )

        name_result = await self.db.execute(
            select(name_subq.c.name_en, name_subq.c.company_count)
        )
        name_rows = name_result.all()

        # Build beneficial owner records
        owners = []

        # Process citizenship-based matches
        for row in cit_rows:
            cit_no = row[0]
            name = row[1]
            count = row[2]

            # Get company details for this director
            comp_stmt = (
                select(
                    CompanyRegistration.id,
                    CompanyRegistration.name_english,
                    CompanyRegistration.pan,
                    CompanyRegistration.district,
                    CompanyDirector.role,
                )
                .join(CompanyDirector, CompanyDirector.company_id == CompanyRegistration.id)
                .where(CompanyDirector.citizenship_no == cit_no)
                .distinct()
                .limit(20)
            )
            comp_result = await self.db.execute(comp_stmt)
            companies = [
                {
                    "id": str(r[0]),
                    "name_english": r[1],
                    "pan": r[2],
                    "district": r[3],
                    "role": r[4],
                }
                for r in comp_result.all()
            ]

            owners.append({
                "name": name,
                "citizenship_no": cit_no,
                "total_companies": count,
                "companies": companies,
                "match_type": "citizenship_no",
            })

        # Process name-based matches (no citizenship_no)
        for row in name_rows:
            name = row[0]
            count = row[1]

            comp_stmt = (
                select(
                    CompanyRegistration.id,
                    CompanyRegistration.name_english,
                    CompanyRegistration.pan,
                    CompanyRegistration.district,
                    CompanyDirector.role,
                )
                .join(CompanyDirector, CompanyDirector.company_id == CompanyRegistration.id)
                .where(
                    and_(
                        CompanyDirector.name_en == name,
                        or_(
                            CompanyDirector.citizenship_no.is_(None),
                            CompanyDirector.citizenship_no == "",
                        ),
                    )
                )
                .distinct()
                .limit(20)
            )
            comp_result = await self.db.execute(comp_stmt)
            companies = [
                {
                    "id": str(r[0]),
                    "name_english": r[1],
                    "pan": r[2],
                    "district": r[3],
                    "role": r[4],
                }
                for r in comp_result.all()
            ]

            owners.append({
                "name": name,
                "citizenship_no": None,
                "total_companies": count,
                "companies": companies,
                "match_type": "name_en",
            })

        # Sort combined results by company count desc
        owners.sort(key=lambda x: x["total_companies"], reverse=True)

        # Count totals for pagination
        total_cit_stmt = (
            select(func.count()).select_from(
                select(CompanyDirector.citizenship_no)
                .where(
                    and_(
                        CompanyDirector.citizenship_no.isnot(None),
                        CompanyDirector.citizenship_no != "",
                        CompanyDirector.company_id.isnot(None),
                    )
                )
                .group_by(CompanyDirector.citizenship_no)
                .having(func.count(func.distinct(CompanyDirector.company_id)) >= min_companies)
                .subquery()
            )
        )
        total_cit_result = await self.db.execute(total_cit_stmt)
        total_cit = total_cit_result.scalar() or 0

        total_name_stmt = (
            select(func.count()).select_from(
                select(CompanyDirector.name_en)
                .where(
                    and_(
                        or_(
                            CompanyDirector.citizenship_no.is_(None),
                            CompanyDirector.citizenship_no == "",
                        ),
                        CompanyDirector.company_id.isnot(None),
                    )
                )
                .group_by(CompanyDirector.name_en)
                .having(func.count(func.distinct(CompanyDirector.company_id)) >= min_companies)
                .subquery()
            )
        )
        total_name_result = await self.db.execute(total_name_stmt)
        total_name = total_name_result.scalar() or 0

        return {
            "owners": owners[:limit],
            "total": total_cit + total_name,
        }

    # ------------------------------------------------------------------
    # 2. Shell Company Scoring
    # ------------------------------------------------------------------

    async def score_shell_companies(self, limit: int = 100) -> dict:
        """
        Score companies based on risk signals:
        - +30: Multiple companies at same address (>= 5)
        - +25: Non-filer IRD status
        - +20: Registered same day as 3+ other companies at same address
        - +15: Director resigned in last 90 days (proxy for director changes)
        - +10: No directors on record
        Returns top N companies sorted by score.
        """
        scored: Dict[str, Dict[str, Any]] = {}

        # --- Signal 1: Address clustering (>=5 companies at same address) → +30 ---
        addr_cluster_stmt = (
            select(
                CompanyRegistration.company_address,
                func.count(CompanyRegistration.id).label("cnt"),
            )
            .where(
                and_(
                    CompanyRegistration.company_address.isnot(None),
                    CompanyRegistration.company_address != "",
                )
            )
            .group_by(CompanyRegistration.company_address)
            .having(func.count(CompanyRegistration.id) >= 5)
        )
        addr_result = await self.db.execute(addr_cluster_stmt)
        clustered_addresses = {row[0]: row[1] for row in addr_result.all()}

        if clustered_addresses:
            # Get companies at these addresses
            companies_at_clusters = await self.db.execute(
                select(
                    CompanyRegistration.id,
                    CompanyRegistration.name_english,
                    CompanyRegistration.pan,
                    CompanyRegistration.company_address,
                    CompanyRegistration.district,
                    CompanyRegistration.registration_date_ad,
                )
                .where(CompanyRegistration.company_address.in_(list(clustered_addresses.keys())))
            )
            for row in companies_at_clusters.all():
                cid = str(row[0])
                if cid not in scored:
                    scored[cid] = {
                        "id": cid,
                        "name_english": row[1],
                        "pan": row[2],
                        "company_address": row[3],
                        "district": row[4],
                        "registration_date_ad": row[5].isoformat() if row[5] else None,
                        "score": 0,
                        "factors": [],
                    }
                addr_count = clustered_addresses.get(row[3], 0)
                scored[cid]["score"] += 30
                scored[cid]["factors"].append(
                    f"Address shared by {addr_count} companies"
                )

        # --- Signal 2: Non-filer IRD status → +25 ---
        nonfiler_stmt = (
            select(
                CompanyRegistration.id,
                CompanyRegistration.name_english,
                CompanyRegistration.pan,
                CompanyRegistration.company_address,
                CompanyRegistration.district,
                CompanyRegistration.registration_date_ad,
                IRDEnrichment.account_status,
            )
            .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(IRDEnrichment.account_status.ilike("non-filer%"))
        )
        nonfiler_result = await self.db.execute(nonfiler_stmt)
        for row in nonfiler_result.all():
            cid = str(row[0])
            if cid not in scored:
                scored[cid] = {
                    "id": cid,
                    "name_english": row[1],
                    "pan": row[2],
                    "company_address": row[3],
                    "district": row[4],
                    "registration_date_ad": row[5].isoformat() if row[5] else None,
                    "score": 0,
                    "factors": [],
                }
            scored[cid]["score"] += 25
            scored[cid]["factors"].append(f"Non-filer: {row[6]}")

        # --- Signal 3: Same-day registration at same address (3+) → +20 ---
        sameday_stmt = (
            select(
                CompanyRegistration.company_address,
                CompanyRegistration.registration_date_ad,
                func.count(CompanyRegistration.id).label("cnt"),
            )
            .where(
                and_(
                    CompanyRegistration.company_address.isnot(None),
                    CompanyRegistration.company_address != "",
                    CompanyRegistration.registration_date_ad.isnot(None),
                )
            )
            .group_by(
                CompanyRegistration.company_address,
                CompanyRegistration.registration_date_ad,
            )
            .having(func.count(CompanyRegistration.id) >= 3)
        )
        sameday_result = await self.db.execute(sameday_stmt)
        sameday_clusters = [(row[0], row[1], row[2]) for row in sameday_result.all()]

        for addr, reg_date, cnt in sameday_clusters:
            comp_stmt = (
                select(
                    CompanyRegistration.id,
                    CompanyRegistration.name_english,
                    CompanyRegistration.pan,
                    CompanyRegistration.company_address,
                    CompanyRegistration.district,
                    CompanyRegistration.registration_date_ad,
                )
                .where(
                    and_(
                        CompanyRegistration.company_address == addr,
                        CompanyRegistration.registration_date_ad == reg_date,
                    )
                )
            )
            comp_result = await self.db.execute(comp_stmt)
            for row in comp_result.all():
                cid = str(row[0])
                if cid not in scored:
                    scored[cid] = {
                        "id": cid,
                        "name_english": row[1],
                        "pan": row[2],
                        "company_address": row[3],
                        "district": row[4],
                        "registration_date_ad": row[5].isoformat() if row[5] else None,
                        "score": 0,
                        "factors": [],
                    }
                factor = f"Same-day registration cluster ({cnt} companies)"
                if factor not in scored[cid]["factors"]:
                    scored[cid]["score"] += 20
                    scored[cid]["factors"].append(factor)

        # --- Signal 4: Director resigned in last 90 days → +15 ---
        cutoff = date.today() - timedelta(days=90)
        dir_change_stmt = (
            select(
                CompanyDirector.company_id,
            )
            .where(
                and_(
                    CompanyDirector.resigned_date.isnot(None),
                    CompanyDirector.resigned_date >= cutoff,
                    CompanyDirector.company_id.isnot(None),
                )
            )
            .distinct()
        )
        dir_change_result = await self.db.execute(dir_change_stmt)
        changed_company_ids = [str(row[0]) for row in dir_change_result.all()]

        if changed_company_ids:
            # Fetch company info for those with director changes
            from sqlalchemy.dialects.postgresql import UUID as PGUUID
            import uuid

            uuids = [uuid.UUID(cid) for cid in changed_company_ids]
            comp_stmt = (
                select(
                    CompanyRegistration.id,
                    CompanyRegistration.name_english,
                    CompanyRegistration.pan,
                    CompanyRegistration.company_address,
                    CompanyRegistration.district,
                    CompanyRegistration.registration_date_ad,
                )
                .where(CompanyRegistration.id.in_(uuids))
            )
            comp_result = await self.db.execute(comp_stmt)
            for row in comp_result.all():
                cid = str(row[0])
                if cid not in scored:
                    scored[cid] = {
                        "id": cid,
                        "name_english": row[1],
                        "pan": row[2],
                        "company_address": row[3],
                        "district": row[4],
                        "registration_date_ad": row[5].isoformat() if row[5] else None,
                        "score": 0,
                        "factors": [],
                    }
                scored[cid]["score"] += 15
                scored[cid]["factors"].append("Director change in last 90 days")

        # --- Signal 5: No directors on record → +10 ---
        # Companies that have no rows in company_directors
        no_dir_stmt = (
            select(
                CompanyRegistration.id,
                CompanyRegistration.name_english,
                CompanyRegistration.pan,
                CompanyRegistration.company_address,
                CompanyRegistration.district,
                CompanyRegistration.registration_date_ad,
            )
            .outerjoin(CompanyDirector, CompanyDirector.company_id == CompanyRegistration.id)
            .where(CompanyDirector.id.is_(None))
            .limit(5000)  # cap for performance
        )
        no_dir_result = await self.db.execute(no_dir_stmt)
        for row in no_dir_result.all():
            cid = str(row[0])
            if cid not in scored:
                scored[cid] = {
                    "id": cid,
                    "name_english": row[1],
                    "pan": row[2],
                    "company_address": row[3],
                    "district": row[4],
                    "registration_date_ad": row[5].isoformat() if row[5] else None,
                    "score": 0,
                    "factors": [],
                }
            scored[cid]["score"] += 10
            scored[cid]["factors"].append("No directors on record")

        # Sort by score descending, take top N
        sorted_scored = sorted(scored.values(), key=lambda x: x["score"], reverse=True)
        top_n = sorted_scored[:limit]

        return {
            "companies": top_n,
            "total_scored": len(scored),
        }

    # ------------------------------------------------------------------
    # 3. Tax Compliance Dashboard
    # ------------------------------------------------------------------

    async def get_tax_compliance_stats(self) -> dict:
        """
        Aggregate tax compliance statistics:
        - Total PANs, active filers, non-filers, cancelled, unknown
        - Breakdown by district, by company_type_category
        """
        # Total PANs (unique PANs in IRD enrichments)
        total_pan_stmt = select(func.count(IRDEnrichment.id))
        total_pan_result = await self.db.execute(total_pan_stmt)
        total_pans = total_pan_result.scalar() or 0

        # Status breakdown
        status_stmt = (
            select(
                IRDEnrichment.account_status,
                func.count(IRDEnrichment.id).label("cnt"),
            )
            .group_by(IRDEnrichment.account_status)
            .order_by(desc("cnt"))
        )
        status_result = await self.db.execute(status_stmt)
        raw_status = {(row[0] or "Unknown"): row[1] for row in status_result.all()}

        # Categorize into buckets
        active_count = 0
        nonfiler_count = 0
        cancelled_count = 0
        unknown_count = 0

        for status_str, cnt in raw_status.items():
            lower = status_str.lower()
            if lower.startswith("non-filer") or lower.startswith("nonfiler"):
                nonfiler_count += cnt
            elif lower in ("active", "active filer"):
                active_count += cnt
            elif "cancel" in lower:
                cancelled_count += cnt
            else:
                # Check for other active-like statuses
                if "active" in lower or "filer" in lower:
                    active_count += cnt
                else:
                    unknown_count += cnt

        # Breakdown by district (join IRD enrichments with companies)
        district_stmt = (
            select(
                CompanyRegistration.district,
                func.sum(
                    func.cast(
                        func.coalesce(
                            func.nullif(
                                func.lower(IRDEnrichment.account_status).op("LIKE")("non-filer%"),
                                False,
                            ),
                            False,
                        ),
                        type_=None,
                    )
                ),
            )
        )
        # Simpler approach: just count by district
        by_district_stmt = (
            select(
                CompanyRegistration.district,
                func.count(IRDEnrichment.id).label("total"),
                func.count(
                    func.nullif(
                        IRDEnrichment.account_status.ilike("non-filer%"),
                        False,
                    )
                ).label("nonfiler_count"),
            )
            .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(CompanyRegistration.district.isnot(None))
            .group_by(CompanyRegistration.district)
            .order_by(desc("total"))
            .limit(20)
        )
        district_result = await self.db.execute(by_district_stmt)
        by_district = [
            {
                "district": row[0],
                "total": row[1],
                "nonfiler_count": row[2],
            }
            for row in district_result.all()
        ]

        # Breakdown by company_type_category
        by_type_stmt = (
            select(
                CompanyRegistration.company_type_category,
                func.count(IRDEnrichment.id).label("total"),
                func.count(
                    func.nullif(
                        IRDEnrichment.account_status.ilike("non-filer%"),
                        False,
                    )
                ).label("nonfiler_count"),
            )
            .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .group_by(CompanyRegistration.company_type_category)
            .order_by(desc("total"))
        )
        type_result = await self.db.execute(by_type_stmt)
        by_type = [
            {
                "category": row[0] or "Unknown",
                "total": row[1],
                "nonfiler_count": row[2],
            }
            for row in type_result.all()
        ]

        return {
            "total_pans": total_pans,
            "active_filers": active_count,
            "non_filers": nonfiler_count,
            "cancelled": cancelled_count,
            "unknown": unknown_count,
            "status_breakdown": raw_status,
            "by_district": by_district,
            "by_company_type": by_type,
        }

    # ------------------------------------------------------------------
    # 4. Corporate Network Stats
    # ------------------------------------------------------------------

    async def get_network_stats(self) -> dict:
        """
        Network statistics:
        - Most connected directors (serve on most boards)
        - Most connected addresses (most companies)
        - PAN sharing groups
        """
        # Most connected directors (top 20)
        top_directors_stmt = (
            select(
                CompanyDirector.name_en,
                CompanyDirector.citizenship_no,
                func.count(func.distinct(CompanyDirector.company_id)).label("company_count"),
            )
            .where(CompanyDirector.company_id.isnot(None))
            .group_by(CompanyDirector.name_en, CompanyDirector.citizenship_no)
            .order_by(desc("company_count"))
            .limit(20)
        )
        dir_result = await self.db.execute(top_directors_stmt)
        top_directors = [
            {
                "name": row[0],
                "citizenship_no": row[1],
                "company_count": row[2],
            }
            for row in dir_result.all()
        ]

        # Most connected addresses (top 20)
        top_addresses_stmt = (
            select(
                CompanyRegistration.company_address,
                CompanyRegistration.district,
                func.count(CompanyRegistration.id).label("company_count"),
            )
            .where(
                and_(
                    CompanyRegistration.company_address.isnot(None),
                    CompanyRegistration.company_address != "",
                )
            )
            .group_by(CompanyRegistration.company_address, CompanyRegistration.district)
            .order_by(desc("company_count"))
            .limit(20)
        )
        addr_result = await self.db.execute(top_addresses_stmt)
        top_addresses = [
            {
                "address": row[0],
                "district": row[1],
                "company_count": row[2],
            }
            for row in addr_result.all()
        ]

        # PAN sharing groups (PANs used by >1 company, top 20)
        pan_sharing_stmt = (
            select(
                CompanyRegistration.pan,
                func.count(CompanyRegistration.id).label("company_count"),
                func.string_agg(CompanyRegistration.name_english, literal_column("', '")).label("company_names"),
            )
            .where(
                and_(
                    CompanyRegistration.pan.isnot(None),
                    CompanyRegistration.pan != "",
                )
            )
            .group_by(CompanyRegistration.pan)
            .having(func.count(CompanyRegistration.id) > 1)
            .order_by(desc("company_count"))
            .limit(20)
        )
        pan_result = await self.db.execute(pan_sharing_stmt)
        pan_groups = [
            {
                "pan": row[0],
                "company_count": row[1],
                "company_names": row[2],
            }
            for row in pan_result.all()
        ]

        # Summary counts
        total_directors_stmt = select(func.count(func.distinct(CompanyDirector.name_en))).where(
            CompanyDirector.company_id.isnot(None)
        )
        total_dir_result = await self.db.execute(total_directors_stmt)
        total_unique_directors = total_dir_result.scalar() or 0

        multi_board_stmt = (
            select(func.count()).select_from(
                select(CompanyDirector.name_en)
                .where(CompanyDirector.company_id.isnot(None))
                .group_by(CompanyDirector.name_en)
                .having(func.count(func.distinct(CompanyDirector.company_id)) >= 2)
                .subquery()
            )
        )
        multi_result = await self.db.execute(multi_board_stmt)
        multi_board_directors = multi_result.scalar() or 0

        return {
            "top_directors": top_directors,
            "top_addresses": top_addresses,
            "pan_sharing_groups": pan_groups,
            "summary": {
                "total_unique_directors": total_unique_directors,
                "multi_board_directors": multi_board_directors,
                "total_pan_sharing_groups": len(pan_groups),
            },
        }

    # ------------------------------------------------------------------
    # 5. Registration Pattern Analysis
    # ------------------------------------------------------------------

    async def get_registration_patterns(self) -> dict:
        """
        Registration pattern analysis:
        - Companies registered per month/year (time series)
        - Peak registration dates
        - Same-day registration clusters
        """
        # Registrations per year
        yearly_stmt = (
            select(
                extract("year", CompanyRegistration.registration_date_ad).label("year"),
                func.count(CompanyRegistration.id).label("count"),
            )
            .where(CompanyRegistration.registration_date_ad.isnot(None))
            .group_by("year")
            .order_by("year")
        )
        yearly_result = await self.db.execute(yearly_stmt)
        yearly = [
            {"year": int(row[0]), "count": row[1]}
            for row in yearly_result.all()
            if row[0] is not None
        ]

        # Registrations per month (last 5 years)
        five_years_ago = date.today().year - 5
        monthly_stmt = (
            select(
                extract("year", CompanyRegistration.registration_date_ad).label("year"),
                extract("month", CompanyRegistration.registration_date_ad).label("month"),
                func.count(CompanyRegistration.id).label("count"),
            )
            .where(
                and_(
                    CompanyRegistration.registration_date_ad.isnot(None),
                    extract("year", CompanyRegistration.registration_date_ad) >= five_years_ago,
                )
            )
            .group_by("year", "month")
            .order_by("year", "month")
        )
        monthly_result = await self.db.execute(monthly_stmt)
        monthly = [
            {
                "year": int(row[0]),
                "month": int(row[1]),
                "count": row[2],
            }
            for row in monthly_result.all()
            if row[0] is not None and row[1] is not None
        ]

        # Peak registration dates (top 20 dates by count)
        peak_stmt = (
            select(
                CompanyRegistration.registration_date_ad,
                func.count(CompanyRegistration.id).label("count"),
            )
            .where(CompanyRegistration.registration_date_ad.isnot(None))
            .group_by(CompanyRegistration.registration_date_ad)
            .order_by(desc("count"))
            .limit(20)
        )
        peak_result = await self.db.execute(peak_stmt)
        peak_dates = [
            {
                "date": row[0].isoformat() if row[0] else None,
                "count": row[1],
            }
            for row in peak_result.all()
        ]

        # Same-day registration clusters (address + date combos with 3+ companies)
        cluster_stmt = (
            select(
                CompanyRegistration.company_address,
                CompanyRegistration.registration_date_ad,
                func.count(CompanyRegistration.id).label("count"),
            )
            .where(
                and_(
                    CompanyRegistration.company_address.isnot(None),
                    CompanyRegistration.company_address != "",
                    CompanyRegistration.registration_date_ad.isnot(None),
                )
            )
            .group_by(
                CompanyRegistration.company_address,
                CompanyRegistration.registration_date_ad,
            )
            .having(func.count(CompanyRegistration.id) >= 3)
            .order_by(desc("count"))
            .limit(20)
        )
        cluster_result = await self.db.execute(cluster_stmt)
        clusters = [
            {
                "address": row[0],
                "date": row[1].isoformat() if row[1] else None,
                "count": row[2],
            }
            for row in cluster_result.all()
        ]

        # Compute anomaly threshold (mean + 2*std for yearly)
        if yearly:
            counts = [y["count"] for y in yearly]
            mean_count = sum(counts) / len(counts)
            variance = sum((c - mean_count) ** 2 for c in counts) / len(counts)
            std_dev = variance ** 0.5
            anomaly_threshold = mean_count + 2 * std_dev
        else:
            anomaly_threshold = 0

        return {
            "yearly": yearly,
            "monthly": monthly,
            "peak_dates": peak_dates,
            "same_day_clusters": clusters,
            "anomaly_threshold": round(anomaly_threshold, 1),
        }
