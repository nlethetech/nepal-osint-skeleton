"""Corporate Intelligence service -- cross-table analytics over company, director, and IRD data."""
import hashlib
import logging
from typing import Optional, List
from uuid import UUID, uuid4

from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.models.company import (
    CompanyRegistration,
    CompanyDirector,
    IRDEnrichment,
    AnalystPhoneClusterGroup,
)
from app.models.procurement import GovtContract
from app.models.procurement_company_link import ProcurementCompanyLink

logger = logging.getLogger(__name__)


class CorporateIntelService:
    """
    Analytical service that joins company_registrations, company_directors,
    and ird_enrichments to power the Corporate Intelligence dashboard.
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _company_to_dict(company: CompanyRegistration) -> dict:
        """Convert a CompanyRegistration ORM instance to a plain dict."""
        return {
            "id": str(company.id),
            "external_id": company.external_id,
            "registration_number": company.registration_number,
            "name_nepali": company.name_nepali,
            "name_english": company.name_english,
            "registration_date_bs": company.registration_date_bs,
            "registration_date_ad": company.registration_date_ad.isoformat() if company.registration_date_ad else None,
            "company_type": company.company_type,
            "company_type_category": company.company_type_category,
            "company_address": company.company_address,
            "district": company.district,
            "province": company.province,
            "last_communication_bs": company.last_communication_bs,
            "pan": company.pan,
            "camis_company_id": company.camis_company_id,
            "cro_company_id": company.cro_company_id,
            "camis_enriched": company.camis_enriched,
            "camis_enriched_at": company.camis_enriched_at.isoformat() if company.camis_enriched_at else None,
            "ird_enriched": company.ird_enriched,
            "ird_enriched_at": company.ird_enriched_at.isoformat() if company.ird_enriched_at else None,
            "fetched_at": company.fetched_at.isoformat() if company.fetched_at else None,
            "created_at": company.created_at.isoformat() if company.created_at else None,
            "updated_at": company.updated_at.isoformat() if company.updated_at else None,
        }

    @staticmethod
    def _ird_to_dict(ird: IRDEnrichment) -> dict:
        """Convert an IRDEnrichment ORM instance to a plain dict."""
        return {
            "pan": ird.pan,
            "taxpayer_name_en": ird.taxpayer_name_en,
            "taxpayer_name_np": ird.taxpayer_name_np,
            "account_type": ird.account_type,
            "account_status": ird.account_status,
            "registration_date_bs": ird.registration_date_bs,
            "tax_office": ird.tax_office,
            "is_personal": ird.is_personal,
            "ward_no": ird.ward_no,
            "vdc_municipality": ird.vdc_municipality,
            "phone_hash": ird.phone_hash,
            "mobile_hash": ird.mobile_hash,
            "latest_tax_clearance_fy": ird.latest_tax_clearance_fy,
            "tax_clearance_verified": ird.tax_clearance_verified,
            "fetched_at": ird.fetched_at.isoformat() if ird.fetched_at else None,
        }

    @staticmethod
    def _director_to_dict(d: CompanyDirector) -> dict:
        return {
            "id": str(d.id),
            "company_id": str(d.company_id) if d.company_id else None,
            "name_en": d.name_en,
            "name_np": d.name_np,
            "role": d.role,
            "company_name_hint": d.company_name_hint,
            "source": d.source,
            "confidence": d.confidence,
            "pan": d.pan,
            "citizenship_no": d.citizenship_no,
            "appointed_date": d.appointed_date.isoformat() if d.appointed_date else None,
            "resigned_date": d.resigned_date.isoformat() if d.resigned_date else None,
        }

    def _build_company_with_ird(self, company: CompanyRegistration, ird: Optional[IRDEnrichment]) -> dict:
        """Merge a company dict with optional IRD enrichment."""
        result = self._company_to_dict(company)
        result["ird_enrichment"] = self._ird_to_dict(ird) if ird else None
        # Convenience fields for list views
        result["ird_status"] = ird.account_status if ird else None
        result["ird_taxpayer_name"] = ird.taxpayer_name_en if ird else None
        # Metric defaults (populated by paginated/list detail enrichers where available)
        result["director_count"] = 0
        result["linked_company_count"] = 0
        result["govt_contract_count"] = 0
        result["govt_contract_total_npr"] = None
        return result

    @staticmethod
    def _normalized_text_expr(column):
        """Normalize text for exact matching with whitespace/case canonicalization."""
        return func.upper(func.regexp_replace(func.trim(column), r"\s+", " ", "g"))

    async def _compute_director_counts(self, company_ids: List[UUID]) -> dict:
        """Count directors per company for a bounded list of company IDs."""
        if not company_ids:
            return {}

        stmt = (
            select(
                CompanyDirector.company_id,
                func.count(CompanyDirector.id).label("director_count"),
            )
            .where(CompanyDirector.company_id.in_(company_ids))
            .group_by(CompanyDirector.company_id)
        )
        result = await self.db.execute(stmt)
        return {row[0]: int(row[1]) for row in result.all() if row[0] is not None}

    async def _compute_linked_company_counts(self, company_ids: List[UUID]) -> dict:
        """
        Compute linked company counts as deduplicated union of:
        1) shared phone/mobile hashes
        2) shared director names
        """
        if not company_ids:
            return {}

        linked_map: dict = {company_id: set() for company_id in company_ids}

        # Shared phone hash links
        source_phone_hashes = (
            select(
                CompanyRegistration.id.label("source_company_id"),
                IRDEnrichment.phone_hash.label("shared_hash"),
            )
            .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(
                CompanyRegistration.id.in_(company_ids),
                IRDEnrichment.phone_hash.isnot(None),
                IRDEnrichment.phone_hash != "",
            )
            .subquery()
        )
        phone_links_stmt = (
            select(
                source_phone_hashes.c.source_company_id,
                CompanyRegistration.id.label("linked_company_id"),
            )
            .select_from(source_phone_hashes)
            .join(IRDEnrichment, IRDEnrichment.phone_hash == source_phone_hashes.c.shared_hash)
            .join(CompanyRegistration, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(CompanyRegistration.id != source_phone_hashes.c.source_company_id)
        )
        phone_result = await self.db.execute(phone_links_stmt)
        for row in phone_result.all():
            source_id, linked_id = row[0], row[1]
            if source_id in linked_map and linked_id:
                linked_map[source_id].add(linked_id)

        # Shared mobile hash links
        source_mobile_hashes = (
            select(
                CompanyRegistration.id.label("source_company_id"),
                IRDEnrichment.mobile_hash.label("shared_hash"),
            )
            .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(
                CompanyRegistration.id.in_(company_ids),
                IRDEnrichment.mobile_hash.isnot(None),
                IRDEnrichment.mobile_hash != "",
            )
            .subquery()
        )
        mobile_links_stmt = (
            select(
                source_mobile_hashes.c.source_company_id,
                CompanyRegistration.id.label("linked_company_id"),
            )
            .select_from(source_mobile_hashes)
            .join(IRDEnrichment, IRDEnrichment.mobile_hash == source_mobile_hashes.c.shared_hash)
            .join(CompanyRegistration, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(CompanyRegistration.id != source_mobile_hashes.c.source_company_id)
        )
        mobile_result = await self.db.execute(mobile_links_stmt)
        for row in mobile_result.all():
            source_id, linked_id = row[0], row[1]
            if source_id in linked_map and linked_id:
                linked_map[source_id].add(linked_id)

        # Shared director links
        source_directors = (
            select(
                CompanyDirector.company_id.label("source_company_id"),
                self._normalized_text_expr(CompanyDirector.name_en).label("director_name_norm"),
            )
            .where(
                CompanyDirector.company_id.in_(company_ids),
                CompanyDirector.company_id.isnot(None),
                CompanyDirector.name_en.isnot(None),
                func.trim(CompanyDirector.name_en) != "",
            )
            .subquery()
        )
        matched_directors = aliased(CompanyDirector)
        director_links_stmt = (
            select(
                source_directors.c.source_company_id,
                matched_directors.company_id.label("linked_company_id"),
            )
            .select_from(source_directors)
            .join(
                matched_directors,
                self._normalized_text_expr(matched_directors.name_en) == source_directors.c.director_name_norm,
            )
            .where(
                matched_directors.company_id.isnot(None),
                matched_directors.company_id != source_directors.c.source_company_id,
            )
        )
        director_result = await self.db.execute(director_links_stmt)
        for row in director_result.all():
            source_id, linked_id = row[0], row[1]
            if source_id in linked_map and linked_id:
                linked_map[source_id].add(linked_id)

        return {company_id: len(linked_ids) for company_id, linked_ids in linked_map.items()}

    async def _compute_procurement_metrics(self, company_ids: List[UUID]) -> dict:
        """
        Compute government contract metrics using persisted contractor->OCR links.
        """
        if not company_ids:
            return {}

        source_companies = (
            select(
                CompanyRegistration.id.label("company_id"),
            )
            .where(CompanyRegistration.id.in_(company_ids))
            .subquery()
        )

        stmt = (
            select(
                source_companies.c.company_id,
                func.count(GovtContract.id).label("govt_contract_count"),
                func.sum(GovtContract.contract_amount_npr).label("govt_contract_total_npr"),
            )
            .select_from(source_companies)
            .outerjoin(
                ProcurementCompanyLink,
                and_(
                    ProcurementCompanyLink.company_id == source_companies.c.company_id,
                    ProcurementCompanyLink.match_status == "matched",
                ),
            )
            .outerjoin(
                GovtContract,
                and_(
                    GovtContract.contractor_name == ProcurementCompanyLink.contractor_name,
                ),
            )
            .group_by(source_companies.c.company_id)
        )
        result = await self.db.execute(stmt)

        metrics = {}
        for row in result.all():
            company_id, contract_count, total_npr = row[0], int(row[1]), row[2]
            metrics[company_id] = {
                "govt_contract_count": contract_count,
                "govt_contract_total_npr": float(total_npr) if total_npr is not None else None,
            }
        return metrics

    async def _get_company_procurement_summary(self, company_id: UUID, contract_limit: int = 20) -> dict:
        """Get procuring-entity breakdown + recent contracts for one company."""
        contractor_rows = (
            await self.db.execute(
                select(ProcurementCompanyLink.contractor_name)
                .where(
                    ProcurementCompanyLink.company_id == company_id,
                    ProcurementCompanyLink.match_status == "matched",
                )
                .order_by(ProcurementCompanyLink.contractor_name)
            )
        ).all()
        contractor_names = [row.contractor_name for row in contractor_rows if row.contractor_name]
        if not contractor_names:
            return {
                "linked_contractor_names": [],
                "procuring_entities": [],
                "contracts": [],
            }

        entity_rows = (
            await self.db.execute(
                select(
                    GovtContract.procuring_entity,
                    func.count(GovtContract.id).label("contract_count"),
                    func.coalesce(func.sum(GovtContract.contract_amount_npr), 0).label("total_value_npr"),
                )
                .where(GovtContract.contractor_name.in_(contractor_names))
                .group_by(GovtContract.procuring_entity)
                .order_by(desc(func.sum(GovtContract.contract_amount_npr)), desc(func.count(GovtContract.id)))
                .limit(15)
            )
        ).all()

        contract_rows = (
            await self.db.execute(
                select(
                    GovtContract.id,
                    GovtContract.contractor_name,
                    GovtContract.procuring_entity,
                    GovtContract.ifb_number,
                    GovtContract.project_name,
                    GovtContract.procurement_type,
                    GovtContract.contract_award_date,
                    GovtContract.contract_amount_npr,
                    GovtContract.fiscal_year_bs,
                    GovtContract.district,
                    GovtContract.source_url,
                )
                .where(GovtContract.contractor_name.in_(contractor_names))
                .order_by(
                    desc(GovtContract.contract_award_date),
                    desc(GovtContract.contract_amount_npr),
                )
                .limit(contract_limit)
            )
        ).all()

        return {
            "linked_contractor_names": contractor_names,
            "procuring_entities": [
                {
                    "name": row.procuring_entity,
                    "contract_count": int(row.contract_count or 0),
                    "total_value_npr": float(row.total_value_npr or 0),
                }
                for row in entity_rows
            ],
            "contracts": [
                {
                    "id": str(row.id),
                    "contractor_name": row.contractor_name,
                    "procuring_entity": row.procuring_entity,
                    "ifb_number": row.ifb_number,
                    "project_name": row.project_name,
                    "procurement_type": row.procurement_type,
                    "contract_award_date": row.contract_award_date.isoformat() if row.contract_award_date else None,
                    "contract_amount_npr": float(row.contract_amount_npr) if row.contract_amount_npr is not None else None,
                    "fiscal_year_bs": row.fiscal_year_bs,
                    "district": row.district,
                    "source_url": row.source_url,
                }
                for row in contract_rows
            ],
        }

    def _compute_risk_flags_for_company(
        self,
        company: CompanyRegistration,
        ird: Optional[IRDEnrichment] = None,
        address_company_count: Optional[int] = None,
        pan_company_count: Optional[int] = None,
    ) -> list:
        """Compute risk flags for a single company."""
        flags = []

        # 1. Non-filer flag from IRD
        if ird and ird.account_status and ird.account_status.lower().startswith("non-filer"):
            flags.append({
                "severity": "HIGH",
                "category": "tax_compliance",
                "description": f"IRD status: {ird.account_status}",
                "details": {"pan": ird.pan, "account_status": ird.account_status},
            })

        # 2. Address clustering (shell company signal)
        if address_company_count is not None and address_company_count >= 5:
            severity = "HIGH" if address_company_count >= 20 else "MEDIUM"
            flags.append({
                "severity": severity,
                "category": "address_clustering",
                "description": f"Registered at an address shared by {address_company_count} companies",
                "details": {"address": company.company_address, "company_count": address_company_count},
            })

        # 3. Multiple companies sharing same PAN
        if pan_company_count is not None and pan_company_count > 1:
            flags.append({
                "severity": "HIGH",
                "category": "pan_sharing",
                "description": f"PAN {company.pan} is shared by {pan_company_count} companies",
                "details": {"pan": company.pan, "company_count": pan_company_count},
            })

        # 4. No recent communication with OCR (dormant company)
        if not company.last_communication_bs:
            flags.append({
                "severity": "LOW",
                "category": "dormant",
                "description": "No recorded communication with OCR",
                "details": None,
            })

        # 5. Has PAN but no IRD enrichment data
        if company.pan and not ird:
            flags.append({
                "severity": "LOW",
                "category": "missing_ird",
                "description": "Company has PAN but IRD data not yet fetched",
                "details": {"pan": company.pan},
            })

        return flags

    # ------------------------------------------------------------------
    # PAN Investigation
    # ------------------------------------------------------------------

    async def investigate_pan(self, pan: str) -> dict:
        """
        Full PAN investigation: find all companies registered under this PAN,
        fetch IRD enrichment data, and compute risk flags.
        """
        # 1. Find all companies with this PAN
        companies_stmt = (
            select(CompanyRegistration)
            .where(CompanyRegistration.pan == pan)
            .order_by(CompanyRegistration.registration_number)
        )
        companies_result = await self.db.execute(companies_stmt)
        companies = list(companies_result.scalars().all())

        # 2. Find IRD enrichment for this PAN
        ird_stmt = select(IRDEnrichment).where(IRDEnrichment.pan == pan)
        ird_result = await self.db.execute(ird_stmt)
        ird = ird_result.scalar_one_or_none()

        # 3. Get address company counts for risk flagging
        address_counts = {}
        addresses = [c.company_address for c in companies if c.company_address]
        if addresses:
            addr_stmt = (
                select(
                    CompanyRegistration.company_address,
                    func.count(CompanyRegistration.id).label("cnt"),
                )
                .where(CompanyRegistration.company_address.in_(addresses))
                .group_by(CompanyRegistration.company_address)
            )
            addr_result = await self.db.execute(addr_stmt)
            address_counts = {row[0]: row[1] for row in addr_result.all()}

        pan_company_count = len(companies)
        company_ids = [c.id for c in companies]
        director_counts = {}
        linked_company_counts = {}
        procurement_metrics = {}
        try:
            director_counts = await self._compute_director_counts(company_ids)
            linked_company_counts = await self._compute_linked_company_counts(company_ids)
            procurement_metrics = await self._compute_procurement_metrics(company_ids)
        except Exception:
            logger.exception("Failed to compute corporate metrics for PAN investigation. Continuing with defaults.")

        # 4. Build enriched company list + risk flags
        enriched_companies = []
        all_risk_flags = []
        for c in companies:
            company_data = self._build_company_with_ird(c, ird)
            company_data["director_count"] = director_counts.get(c.id, 0)
            company_data["linked_company_count"] = linked_company_counts.get(c.id, 0)
            company_data["govt_contract_count"] = procurement_metrics.get(c.id, {}).get("govt_contract_count", 0)
            company_data["govt_contract_total_npr"] = procurement_metrics.get(c.id, {}).get("govt_contract_total_npr")
            enriched_companies.append(company_data)
            flags = self._compute_risk_flags_for_company(
                c,
                ird=ird,
                address_company_count=address_counts.get(c.company_address),
                pan_company_count=pan_company_count,
            )
            all_risk_flags.extend(flags)

        # De-duplicate risk flags (same category + description)
        seen = set()
        unique_flags = []
        for f in all_risk_flags:
            key = (f["category"], f["description"])
            if key not in seen:
                seen.add(key)
                unique_flags.append(f)

        return {
            "pan": pan,
            "companies": enriched_companies,
            "ird": self._ird_to_dict(ird) if ird else None,
            "risk_flags": unique_flags,
        }

    # ------------------------------------------------------------------
    # Company Search (with IRD join)
    # ------------------------------------------------------------------

    async def search_companies(
        self,
        query: Optional[str] = None,
        district: Optional[str] = None,
        company_type: Optional[str] = None,
        has_pan: Optional[bool] = None,
        ird_status: Optional[str] = None,
        has_cluster: Optional[bool] = None,
        sort: str = "name",
        page: int = 1,
        limit: int = 50,
    ) -> dict:
        """Paginated company search with filters and LEFT JOIN to IRD enrichments."""

        # Build base conditions on company_registrations
        conditions = []
        if query:
            conditions.append(
                or_(
                    CompanyRegistration.name_english.ilike(f"%{query}%"),
                    CompanyRegistration.name_nepali.ilike(f"%{query}%"),
                    CompanyRegistration.pan == query,  # exact PAN match
                )
            )
        if district:
            conditions.append(CompanyRegistration.district.ilike(f"%{district}%"))
        if company_type:
            conditions.append(CompanyRegistration.company_type_category == company_type)
        if has_pan is True:
            conditions.append(CompanyRegistration.pan.isnot(None))
            conditions.append(CompanyRegistration.pan != "")
        elif has_pan is False:
            conditions.append(
                or_(CompanyRegistration.pan.is_(None), CompanyRegistration.pan == "")
            )

        # IRD status filter requires joining ird_enrichments
        if ird_status:
            conditions.append(IRDEnrichment.account_status.ilike(f"%{ird_status}%"))

        # Cluster filter: only show companies that share phone/mobile with others
        if has_cluster is True:
            # Company must have IRD enrichment with phone_hash or mobile_hash
            # that appears in more than one company
            phone_clusters_subq = (
                select(IRDEnrichment.phone_hash)
                .where(
                    and_(
                        IRDEnrichment.phone_hash.isnot(None),
                        IRDEnrichment.phone_hash != "",
                    )
                )
                .group_by(IRDEnrichment.phone_hash)
                .having(func.count(IRDEnrichment.id) > 1)
            )
            mobile_clusters_subq = (
                select(IRDEnrichment.mobile_hash)
                .where(
                    and_(
                        IRDEnrichment.mobile_hash.isnot(None),
                        IRDEnrichment.mobile_hash != "",
                    )
                )
                .group_by(IRDEnrichment.mobile_hash)
                .having(func.count(IRDEnrichment.id) > 1)
            )
            conditions.append(
                or_(
                    IRDEnrichment.phone_hash.in_(phone_clusters_subq),
                    IRDEnrichment.mobile_hash.in_(mobile_clusters_subq),
                )
            )
        elif has_cluster is False:
            # Opposite: companies that DON'T share numbers (or have no IRD data)
            phone_clusters_subq = (
                select(IRDEnrichment.phone_hash)
                .where(
                    and_(
                        IRDEnrichment.phone_hash.isnot(None),
                        IRDEnrichment.phone_hash != "",
                    )
                )
                .group_by(IRDEnrichment.phone_hash)
                .having(func.count(IRDEnrichment.id) > 1)
            )
            mobile_clusters_subq = (
                select(IRDEnrichment.mobile_hash)
                .where(
                    and_(
                        IRDEnrichment.mobile_hash.isnot(None),
                        IRDEnrichment.mobile_hash != "",
                    )
                )
                .group_by(IRDEnrichment.mobile_hash)
                .having(func.count(IRDEnrichment.id) > 1)
            )
            conditions.append(
                and_(
                    or_(
                        IRDEnrichment.phone_hash.is_(None),
                        IRDEnrichment.phone_hash == "",
                        IRDEnrichment.phone_hash.notin_(phone_clusters_subq),
                    ),
                    or_(
                        IRDEnrichment.mobile_hash.is_(None),
                        IRDEnrichment.mobile_hash == "",
                        IRDEnrichment.mobile_hash.notin_(mobile_clusters_subq),
                    ),
                )
            )

        # Build the joined query
        data_stmt = (
            select(CompanyRegistration, IRDEnrichment)
            .outerjoin(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
        )
        count_stmt = (
            select(func.count(CompanyRegistration.id))
            .outerjoin(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
        )

        if conditions:
            data_stmt = data_stmt.where(and_(*conditions))
            count_stmt = count_stmt.where(and_(*conditions))

        # Sorting
        sort_map = {
            "name": CompanyRegistration.name_english.asc(),
            "name_desc": CompanyRegistration.name_english.desc(),
            "registration_number": CompanyRegistration.registration_number.asc(),
            "registration_number_desc": CompanyRegistration.registration_number.desc(),
            "newest": CompanyRegistration.created_at.desc(),
            "oldest": CompanyRegistration.created_at.asc(),
        }
        data_stmt = data_stmt.order_by(sort_map.get(sort, CompanyRegistration.name_english.asc()))

        # Pagination
        offset = (page - 1) * limit
        data_stmt = data_stmt.offset(offset).limit(limit)

        # Execute
        data_result = await self.db.execute(data_stmt)
        rows = data_result.all()

        count_result = await self.db.execute(count_stmt)
        total = count_result.scalar() or 0

        company_ids = [row[0].id for row in rows]
        director_counts = {}
        linked_company_counts = {}
        procurement_metrics = {}
        try:
            director_counts = await self._compute_director_counts(company_ids)
            linked_company_counts = await self._compute_linked_company_counts(company_ids)
            procurement_metrics = await self._compute_procurement_metrics(company_ids)
        except Exception:
            logger.exception("Failed to compute corporate list metrics. Continuing with defaults.")

        items = []
        for row in rows:
            company = row[0]
            ird = row[1]
            company_data = self._build_company_with_ird(company, ird)
            company_data["director_count"] = director_counts.get(company.id, 0)
            company_data["linked_company_count"] = linked_company_counts.get(company.id, 0)
            company_data["govt_contract_count"] = procurement_metrics.get(company.id, {}).get("govt_contract_count", 0)
            company_data["govt_contract_total_npr"] = procurement_metrics.get(company.id, {}).get("govt_contract_total_npr")
            items.append(company_data)

        return {
            "items": items,
            "total": total,
            "page": page,
            "limit": limit,
            "has_more": (page * limit) < total,
        }

    # ------------------------------------------------------------------
    # Company Detail
    # ------------------------------------------------------------------

    async def get_company_detail(self, company_id: UUID) -> Optional[dict]:
        """Full company profile with directors, IRD data, and risk flags."""

        # Fetch company
        stmt = select(CompanyRegistration).where(CompanyRegistration.id == company_id)
        result = await self.db.execute(stmt)
        company = result.scalar_one_or_none()
        if not company:
            return None

        # Fetch IRD enrichment (if PAN exists)
        ird = None
        if company.pan:
            ird_stmt = select(IRDEnrichment).where(IRDEnrichment.pan == company.pan)
            ird_result = await self.db.execute(ird_stmt)
            ird = ird_result.scalar_one_or_none()

        # Fetch directors
        dir_stmt = (
            select(CompanyDirector)
            .where(CompanyDirector.company_id == company_id)
            .order_by(CompanyDirector.confidence.desc(), CompanyDirector.name_en)
        )
        dir_result = await self.db.execute(dir_stmt)
        directors = list(dir_result.scalars().all())

        # Address company count for risk flags
        address_count = None
        if company.company_address:
            addr_stmt = select(func.count(CompanyRegistration.id)).where(
                CompanyRegistration.company_address == company.company_address
            )
            addr_result = await self.db.execute(addr_stmt)
            address_count = addr_result.scalar() or 0

        # PAN sharing count
        pan_count = None
        if company.pan:
            pan_stmt = select(func.count(CompanyRegistration.id)).where(
                CompanyRegistration.pan == company.pan
            )
            pan_result = await self.db.execute(pan_stmt)
            pan_count = pan_result.scalar() or 0

        risk_flags = self._compute_risk_flags_for_company(
            company,
            ird=ird,
            address_company_count=address_count,
            pan_company_count=pan_count,
        )

        # Flatten: company fields at top level + directors/ird/risk_flags
        detail = self._build_company_with_ird(company, ird)
        detail["director_count"] = len(directors)
        linked_company_counts = {}
        procurement_metrics = {}
        procurement_summary = {
            "linked_contractor_names": [],
            "procuring_entities": [],
            "contracts": [],
        }
        try:
            linked_company_counts = await self._compute_linked_company_counts([company.id])
            procurement_metrics = await self._compute_procurement_metrics([company.id])
            procurement_summary = await self._get_company_procurement_summary(company.id, contract_limit=20)
        except Exception:
            logger.exception("Failed to compute company detail metrics. Continuing with defaults.")
        detail["linked_company_count"] = linked_company_counts.get(company.id, 0)
        detail["govt_contract_count"] = procurement_metrics.get(company.id, {}).get("govt_contract_count", 0)
        detail["govt_contract_total_npr"] = procurement_metrics.get(company.id, {}).get("govt_contract_total_npr")
        detail["govt_procurement_summary"] = procurement_summary
        detail["directors"] = [self._director_to_dict(d) for d in directors]
        detail["ird"] = self._ird_to_dict(ird) if ird else None
        detail["risk_flags"] = risk_flags
        return detail

    # ------------------------------------------------------------------
    # Phone-Linked Companies
    # ------------------------------------------------------------------

    async def get_phone_linked_companies(self, company_id: UUID) -> Optional[dict]:
        """Find companies sharing phone/mobile numbers with the given company.

        Uses privacy-preserving HMAC-SHA256 hashes — no raw numbers stored.
        Same hash = same phone = likely same controller/owner.
        """
        # Get the company's IRD enrichment to find its phone/mobile hashes
        stmt = (
            select(CompanyRegistration, IRDEnrichment)
            .outerjoin(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(CompanyRegistration.id == company_id)
        )
        result = await self.db.execute(stmt)
        row = result.first()
        if not row:
            return None

        company, ird = row[0], row[1]
        if not ird:
            return {"company_id": str(company_id), "company_name": company.name_english, "links": []}

        phone_hash = ird.phone_hash
        mobile_hash = ird.mobile_hash

        if not phone_hash and not mobile_hash:
            return {"company_id": str(company_id), "company_name": company.name_english, "links": []}

        # Find other companies with matching phone or mobile hashes
        conditions = []
        if phone_hash:
            conditions.append(IRDEnrichment.phone_hash == phone_hash)
        if mobile_hash:
            conditions.append(IRDEnrichment.mobile_hash == mobile_hash)

        linked_stmt = (
            select(CompanyRegistration, IRDEnrichment)
            .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
            .where(
                or_(*conditions),
                CompanyRegistration.id != company_id,
            )
            .order_by(CompanyRegistration.name_english)
        )
        linked_result = await self.db.execute(linked_stmt)
        linked_rows = linked_result.all()

        links = []
        for lr in linked_rows:
            linked_company, linked_ird = lr[0], lr[1]
            match_type = []
            if phone_hash and linked_ird.phone_hash == phone_hash:
                match_type.append("phone")
            if mobile_hash and linked_ird.mobile_hash == mobile_hash:
                match_type.append("mobile")

            links.append({
                "company_id": str(linked_company.id),
                "company_name": linked_company.name_english,
                "pan": linked_company.pan,
                "district": linked_company.district,
                "company_address": linked_company.company_address,
                "ird_status": linked_ird.account_status,
                "match_type": ", ".join(match_type),
            })

        return {
            "company_id": str(company_id),
            "company_name": company.name_english,
            "links": links,
        }

    # ------------------------------------------------------------------
    # Phone Clusters (Global View)
    # ------------------------------------------------------------------

    async def get_phone_clusters(
        self,
        limit: int = 200,
        min_companies: int = 2,
        max_members_per_cluster: int = 200,
    ) -> dict:
        """Get phone/mobile hash clusters with bounded payload size."""
        # Keep per-hash candidate list bounded for speed.
        per_hash_limit = max(limit * 2, limit)

        # 1) Top phone hashes by cluster size.
        phone_hashes_stmt = (
            select(
                IRDEnrichment.phone_hash,
                func.count(IRDEnrichment.id).label("cnt"),
            )
            .where(
                and_(
                    IRDEnrichment.phone_hash.isnot(None),
                    IRDEnrichment.phone_hash != "",
                )
            )
            .group_by(IRDEnrichment.phone_hash)
            .having(func.count(IRDEnrichment.id) >= min_companies)
            .order_by(desc("cnt"))
            .limit(per_hash_limit)
        )
        phone_hashes_result = await self.db.execute(phone_hashes_stmt)
        phone_hash_counts = {
            row[0]: int(row[1]) for row in phone_hashes_result.all() if row[0]
        }
        phone_hashes = list(phone_hash_counts.keys())

        # 2) Top mobile hashes by cluster size.
        mobile_hashes_stmt = (
            select(
                IRDEnrichment.mobile_hash,
                func.count(IRDEnrichment.id).label("cnt"),
            )
            .where(
                and_(
                    IRDEnrichment.mobile_hash.isnot(None),
                    IRDEnrichment.mobile_hash != "",
                )
            )
            .group_by(IRDEnrichment.mobile_hash)
            .having(func.count(IRDEnrichment.id) >= min_companies)
            .order_by(desc("cnt"))
            .limit(per_hash_limit)
        )
        mobile_hashes_result = await self.db.execute(mobile_hashes_stmt)
        mobile_hash_counts = {
            row[0]: int(row[1]) for row in mobile_hashes_result.all() if row[0]
        }
        mobile_hashes = list(mobile_hash_counts.keys())

        # Fetch only a bounded member sample per hash using ROW_NUMBER windowing.
        phone_groups: dict[str, list[dict]] = {}
        if phone_hashes:
            phone_members_subq = (
                select(
                    IRDEnrichment.phone_hash.label("hash_key"),
                    CompanyRegistration.id.label("company_id"),
                    CompanyRegistration.name_english.label("company_name"),
                    CompanyRegistration.pan.label("pan"),
                    CompanyRegistration.registration_number.label("registration_number"),
                    CompanyRegistration.district.label("district"),
                    CompanyRegistration.company_address.label("company_address"),
                    IRDEnrichment.account_status.label("ird_status"),
                    func.row_number().over(
                        partition_by=IRDEnrichment.phone_hash,
                        order_by=(
                            CompanyRegistration.registration_number.asc(),
                            CompanyRegistration.name_english.asc(),
                        ),
                    ).label("rn"),
                )
                .select_from(CompanyRegistration)
                .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
                .where(IRDEnrichment.phone_hash.in_(phone_hashes))
                .subquery()
            )
            phone_members_stmt = (
                select(phone_members_subq)
                .where(phone_members_subq.c.rn <= max_members_per_cluster)
                .order_by(phone_members_subq.c.hash_key, phone_members_subq.c.rn)
            )
            phone_members_result = await self.db.execute(phone_members_stmt)
            for row in phone_members_result.all():
                if not row.hash_key:
                    continue
                phone_groups.setdefault(row.hash_key, []).append({
                    "company_id": str(row.company_id),
                    "company_name": row.company_name,
                    "pan": row.pan,
                    "registration_number": row.registration_number,
                    "district": row.district,
                    "company_address": row.company_address,
                    "ird_status": row.ird_status,
                })

        mobile_groups: dict[str, list[dict]] = {}
        if mobile_hashes:
            mobile_members_subq = (
                select(
                    IRDEnrichment.mobile_hash.label("hash_key"),
                    CompanyRegistration.id.label("company_id"),
                    CompanyRegistration.name_english.label("company_name"),
                    CompanyRegistration.pan.label("pan"),
                    CompanyRegistration.registration_number.label("registration_number"),
                    CompanyRegistration.district.label("district"),
                    CompanyRegistration.company_address.label("company_address"),
                    IRDEnrichment.account_status.label("ird_status"),
                    func.row_number().over(
                        partition_by=IRDEnrichment.mobile_hash,
                        order_by=(
                            CompanyRegistration.registration_number.asc(),
                            CompanyRegistration.name_english.asc(),
                        ),
                    ).label("rn"),
                )
                .select_from(CompanyRegistration)
                .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
                .where(IRDEnrichment.mobile_hash.in_(mobile_hashes))
                .subquery()
            )
            mobile_members_stmt = (
                select(mobile_members_subq)
                .where(mobile_members_subq.c.rn <= max_members_per_cluster)
                .order_by(mobile_members_subq.c.hash_key, mobile_members_subq.c.rn)
            )
            mobile_members_result = await self.db.execute(mobile_members_stmt)
            for row in mobile_members_result.all():
                if not row.hash_key:
                    continue
                mobile_groups.setdefault(row.hash_key, []).append({
                    "company_id": str(row.company_id),
                    "company_name": row.company_name,
                    "pan": row.pan,
                    "registration_number": row.registration_number,
                    "district": row.district,
                    "company_address": row.company_address,
                    "ird_status": row.ird_status,
                })

        # 3) Merge equivalent phone/mobile groups by signature.
        cluster_map: dict[tuple[int, str, frozenset[str]], dict] = {}

        def _upsert_cluster(hash_type: str, hash_key: str, members: list[dict], total_count: int) -> None:
            if not members:
                return
            first_registered = members[0]
            signature = (
                total_count,
                first_registered["company_id"],
                frozenset(m["company_id"] for m in members),
            )
            existing = cluster_map.get(signature)
            if existing:
                if hash_type == "phone":
                    existing["phone_hashes"].add(hash_key)
                else:
                    existing["mobile_hashes"].add(hash_key)

                if existing["hash_type"] != hash_type:
                    existing["hash_type"] = "both"
                return
            cluster_map[signature] = {
                "hash_type": hash_type,
                "company_count": total_count,
                "first_registered": first_registered,
                "companies": members,
                "phone_hashes": {hash_key} if hash_type == "phone" else set(),
                "mobile_hashes": {hash_key} if hash_type == "mobile" else set(),
            }

        for hash_key, members in phone_groups.items():
            _upsert_cluster("phone", hash_key, members, phone_hash_counts.get(hash_key, len(members)))
        for hash_key, members in mobile_groups.items():
            _upsert_cluster("mobile", hash_key, members, mobile_hash_counts.get(hash_key, len(members)))

        all_clusters: list[dict] = []
        for cluster in cluster_map.values():
            phone_hashes = sorted(cluster.get("phone_hashes", set()))
            mobile_hashes = sorted(cluster.get("mobile_hashes", set()))
            cluster_id_seed = "|".join([
                cluster["first_registered"]["company_id"],
                str(cluster["company_count"]),
                f"phone:{','.join(phone_hashes)}",
                f"mobile:{','.join(mobile_hashes)}",
            ])
            cluster_id = f"phc_{hashlib.sha1(cluster_id_seed.encode('utf-8')).hexdigest()[:20]}"
            all_clusters.append({
                "cluster_id": cluster_id,
                "hash_type": cluster["hash_type"],
                "company_count": cluster["company_count"],
                "first_registered": cluster["first_registered"],
                "companies": cluster["companies"],
            })

        all_clusters.sort(key=lambda c: c["company_count"], reverse=True)
        selected_clusters = all_clusters[:limit]

        linked_company_ids: set[str] = set()
        for cluster in selected_clusters:
            linked_company_ids.update(member["company_id"] for member in cluster.get("companies", []))

        return {
            "clusters": selected_clusters,
            "total_clusters": len(all_clusters),
            "total_linked_companies": len(linked_company_ids),
        }

    # ------------------------------------------------------------------
    # Analyst Cluster Groups (manual graphing over phone clusters)
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_cluster_nodes(nodes: list[dict]) -> list[dict]:
        """Validate and normalize saved cluster nodes payload."""
        normalized: list[dict] = []
        seen_ids: set[str] = set()

        for raw in nodes or []:
            if not isinstance(raw, dict):
                raise ValueError("Each cluster node must be an object")
            cluster_id = str(raw.get("cluster_id") or "").strip()
            if not cluster_id:
                raise ValueError("Each cluster node must include cluster_id")
            if cluster_id in seen_ids:
                continue

            label = str(raw.get("label") or "").strip() or cluster_id

            hash_type_raw = raw.get("hash_type")
            hash_type = str(hash_type_raw).strip() if hash_type_raw not in (None, "") else None

            company_count = raw.get("company_count")
            if company_count is not None:
                try:
                    company_count = int(company_count)
                except (TypeError, ValueError) as exc:
                    raise ValueError("company_count must be an integer when provided") from exc
                if company_count < 0:
                    raise ValueError("company_count cannot be negative")

            first_registered_company_id = raw.get("first_registered_company_id")
            if first_registered_company_id is not None:
                first_registered_company_id = str(first_registered_company_id).strip() or None

            first_registered_company_name = raw.get("first_registered_company_name")
            if first_registered_company_name is not None:
                first_registered_company_name = str(first_registered_company_name).strip() or None

            normalized.append({
                "cluster_id": cluster_id,
                "label": label,
                "hash_type": hash_type,
                "company_count": company_count,
                "first_registered_company_id": first_registered_company_id,
                "first_registered_company_name": first_registered_company_name,
            })
            seen_ids.add(cluster_id)

        return normalized

    @staticmethod
    def _normalize_cluster_edges(edges: list[dict], cluster_ids: set[str]) -> list[dict]:
        """Validate and normalize saved cluster edges payload."""
        normalized: list[dict] = []
        seen_edge_ids: set[str] = set()

        for raw in edges or []:
            if not isinstance(raw, dict):
                raise ValueError("Each edge must be an object")
            source_cluster_id = str(raw.get("source_cluster_id") or "").strip()
            target_cluster_id = str(raw.get("target_cluster_id") or "").strip()
            label = str(raw.get("label") or "").strip()

            if not source_cluster_id or not target_cluster_id:
                raise ValueError("Each edge must include source_cluster_id and target_cluster_id")
            if source_cluster_id == target_cluster_id:
                raise ValueError("Edge source and target must be different clusters")
            if source_cluster_id not in cluster_ids or target_cluster_id not in cluster_ids:
                raise ValueError("Edge source/target must exist in clusters list")
            if not label:
                raise ValueError("Each edge must include a non-empty label")

            bidirectional = bool(raw.get("bidirectional", False))
            edge_id = str(raw.get("id") or "").strip() or f"edge_{uuid4().hex[:12]}"
            if edge_id in seen_edge_ids:
                edge_id = f"edge_{uuid4().hex[:12]}"
            seen_edge_ids.add(edge_id)

            normalized.append({
                "id": edge_id,
                "source_cluster_id": source_cluster_id,
                "target_cluster_id": target_cluster_id,
                "label": label,
                "bidirectional": bidirectional,
            })

        return normalized

    @staticmethod
    def _display_name_for_user(user) -> Optional[str]:
        if not user:
            return None
        return user.full_name or user.username or user.email

    def _cluster_group_to_dict(self, group: AnalystPhoneClusterGroup) -> dict:
        """Serialize AnalystPhoneClusterGroup for API responses."""
        return {
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "main_cluster_id": group.main_cluster_id,
            "clusters": list(group.clusters or []),
            "edges": list(group.edges or []),
            "created_by_id": str(group.created_by_id) if group.created_by_id else None,
            "created_by_name": self._display_name_for_user(group.created_by),
            "updated_by_id": str(group.updated_by_id) if group.updated_by_id else None,
            "updated_by_name": self._display_name_for_user(group.updated_by),
            "created_at": group.created_at.isoformat() if group.created_at else None,
            "updated_at": group.updated_at.isoformat() if group.updated_at else None,
        }

    async def list_cluster_groups(
        self,
        created_by_id: Optional[UUID] = None,
        limit: int = 100,
    ) -> list[dict]:
        """List analyst-saved cluster groups ordered by most recently updated."""
        stmt = (
            select(AnalystPhoneClusterGroup)
            .options(
                selectinload(AnalystPhoneClusterGroup.created_by),
                selectinload(AnalystPhoneClusterGroup.updated_by),
            )
            .order_by(desc(AnalystPhoneClusterGroup.updated_at))
            .limit(limit)
        )
        if created_by_id:
            stmt = stmt.where(AnalystPhoneClusterGroup.created_by_id == created_by_id)

        result = await self.db.execute(stmt)
        groups = list(result.scalars().all())
        return [self._cluster_group_to_dict(group) for group in groups]

    async def get_cluster_group(self, group_id: UUID) -> Optional[dict]:
        """Get one analyst-saved cluster group."""
        stmt = (
            select(AnalystPhoneClusterGroup)
            .options(
                selectinload(AnalystPhoneClusterGroup.created_by),
                selectinload(AnalystPhoneClusterGroup.updated_by),
            )
            .where(AnalystPhoneClusterGroup.id == group_id)
        )
        result = await self.db.execute(stmt)
        group = result.scalar_one_or_none()
        if not group:
            return None
        return self._cluster_group_to_dict(group)

    async def create_cluster_group(
        self,
        *,
        name: str,
        description: Optional[str],
        main_cluster_id: Optional[str],
        clusters: list[dict],
        edges: list[dict],
        created_by_id: UUID,
    ) -> dict:
        """Create an analyst-saved cluster group graph."""
        cleaned_name = (name or "").strip()
        if not cleaned_name:
            raise ValueError("name is required")

        normalized_clusters = self._normalize_cluster_nodes(clusters)
        cluster_ids = {node["cluster_id"] for node in normalized_clusters}

        normalized_main_cluster_id = str(main_cluster_id).strip() if main_cluster_id else None
        if normalized_main_cluster_id and normalized_main_cluster_id not in cluster_ids:
            raise ValueError("main_cluster_id must exist in clusters list")
        if not normalized_main_cluster_id and normalized_clusters:
            normalized_main_cluster_id = normalized_clusters[0]["cluster_id"]

        normalized_edges = self._normalize_cluster_edges(edges, cluster_ids)

        group = AnalystPhoneClusterGroup(
            name=cleaned_name,
            description=(description or "").strip() or None,
            main_cluster_id=normalized_main_cluster_id,
            clusters=normalized_clusters,
            edges=normalized_edges,
            created_by_id=created_by_id,
            updated_by_id=created_by_id,
        )
        self.db.add(group)
        await self.db.commit()
        created = await self.get_cluster_group(group.id)
        if not created:
            raise RuntimeError("Failed to load newly created cluster group")
        return created

    async def update_cluster_group(
        self,
        group_id: UUID,
        updated_by_id: UUID,
        update_data: dict,
    ) -> Optional[dict]:
        """Patch an analyst-saved cluster group graph."""
        stmt = (
            select(AnalystPhoneClusterGroup)
            .where(AnalystPhoneClusterGroup.id == group_id)
        )
        result = await self.db.execute(stmt)
        group = result.scalar_one_or_none()
        if not group:
            return None

        if "name" in update_data:
            cleaned_name = str(update_data.get("name") or "").strip()
            if not cleaned_name:
                raise ValueError("name cannot be empty")
            group.name = cleaned_name

        if "description" in update_data:
            raw_description = update_data.get("description")
            group.description = str(raw_description).strip() if raw_description is not None else None
            if group.description == "":
                group.description = None

        if "clusters" in update_data:
            normalized_clusters = self._normalize_cluster_nodes(update_data.get("clusters") or [])
        else:
            normalized_clusters = list(group.clusters or [])
        cluster_ids = {node["cluster_id"] for node in normalized_clusters}

        if "edges" in update_data:
            normalized_edges = self._normalize_cluster_edges(update_data.get("edges") or [], cluster_ids)
        elif "clusters" in update_data:
            existing_edges = [
                edge for edge in (group.edges or [])
                if str(edge.get("source_cluster_id") or "") in cluster_ids
                and str(edge.get("target_cluster_id") or "") in cluster_ids
            ]
            normalized_edges = self._normalize_cluster_edges(existing_edges, cluster_ids)
        else:
            normalized_edges = list(group.edges or [])

        if "main_cluster_id" in update_data:
            raw_main_cluster_id = update_data.get("main_cluster_id")
            normalized_main_cluster_id = str(raw_main_cluster_id).strip() if raw_main_cluster_id else None
        else:
            normalized_main_cluster_id = group.main_cluster_id

        if normalized_main_cluster_id and normalized_main_cluster_id not in cluster_ids:
            raise ValueError("main_cluster_id must exist in clusters list")
        if normalized_main_cluster_id is None and "clusters" in update_data and cluster_ids:
            normalized_main_cluster_id = normalized_clusters[0]["cluster_id"]

        group.clusters = normalized_clusters
        group.edges = normalized_edges
        group.main_cluster_id = normalized_main_cluster_id
        group.updated_by_id = updated_by_id

        await self.db.commit()
        return await self.get_cluster_group(group_id)

    async def delete_cluster_group(self, group_id: UUID) -> bool:
        """Delete an analyst-saved cluster group graph."""
        result = await self.db.execute(
            select(AnalystPhoneClusterGroup).where(AnalystPhoneClusterGroup.id == group_id)
        )
        group = result.scalar_one_or_none()
        if not group:
            return False
        await self.db.delete(group)
        await self.db.commit()
        return True

    # ------------------------------------------------------------------
    # Dashboard Stats
    # ------------------------------------------------------------------

    async def get_corporate_stats(self) -> dict:
        """Dashboard stats: total companies, PAN coverage, IRD enrichment progress."""

        # Total companies
        total_result = await self.db.execute(
            select(func.count(CompanyRegistration.id))
        )
        total_companies = total_result.scalar() or 0

        # Companies with PAN
        pan_result = await self.db.execute(
            select(func.count(CompanyRegistration.id)).where(
                and_(
                    CompanyRegistration.pan.isnot(None),
                    CompanyRegistration.pan != "",
                )
            )
        )
        companies_with_pan = pan_result.scalar() or 0

        # CAMIS enriched count
        camis_result = await self.db.execute(
            select(func.count(CompanyRegistration.id)).where(
                CompanyRegistration.camis_enriched == True  # noqa: E712
            )
        )
        camis_enriched_count = camis_result.scalar() or 0

        # IRD enriched count
        ird_result = await self.db.execute(
            select(func.count(CompanyRegistration.id)).where(
                CompanyRegistration.ird_enriched == True  # noqa: E712
            )
        )
        ird_enriched_count = ird_result.scalar() or 0

        # Total directors
        dir_result = await self.db.execute(
            select(func.count(CompanyDirector.id))
        )
        total_directors = dir_result.scalar() or 0

        # By type category
        type_query = (
            select(
                CompanyRegistration.company_type_category,
                func.count(CompanyRegistration.id),
            )
            .group_by(CompanyRegistration.company_type_category)
            .order_by(desc(func.count(CompanyRegistration.id)))
        )
        type_result = await self.db.execute(type_query)
        companies_by_type = {(row[0] or "Unknown"): row[1] for row in type_result.all()}

        # By province
        prov_query = (
            select(
                CompanyRegistration.province,
                func.count(CompanyRegistration.id),
            )
            .where(CompanyRegistration.province.isnot(None))
            .group_by(CompanyRegistration.province)
            .order_by(desc(func.count(CompanyRegistration.id)))
        )
        prov_result = await self.db.execute(prov_query)
        companies_by_province = {row[0]: row[1] for row in prov_result.all()}

        # Top districts
        dist_query = (
            select(
                CompanyRegistration.district,
                func.count(CompanyRegistration.id),
            )
            .where(CompanyRegistration.district.isnot(None))
            .group_by(CompanyRegistration.district)
            .order_by(desc(func.count(CompanyRegistration.id)))
            .limit(20)
        )
        dist_result = await self.db.execute(dist_query)
        top_districts = {row[0]: row[1] for row in dist_result.all()}

        # Risk summary: count companies with non-filer status
        nonfiler_result = await self.db.execute(
            select(func.count(IRDEnrichment.id)).where(
                IRDEnrichment.account_status.ilike("non-filer%")
            )
        )
        nonfiler_count = nonfiler_result.scalar() or 0

        # Address clusters with >= 5 companies
        cluster_result = await self.db.execute(
            select(func.count()).select_from(
                select(CompanyRegistration.company_address)
                .where(CompanyRegistration.company_address.isnot(None))
                .group_by(CompanyRegistration.company_address)
                .having(func.count(CompanyRegistration.id) >= 5)
                .subquery()
            )
        )
        cluster_count = cluster_result.scalar() or 0

        # Shared PANs (PAN used by > 1 company)
        shared_pan_result = await self.db.execute(
            select(func.count()).select_from(
                select(CompanyRegistration.pan)
                .where(
                    and_(
                        CompanyRegistration.pan.isnot(None),
                        CompanyRegistration.pan != "",
                    )
                )
                .group_by(CompanyRegistration.pan)
                .having(func.count(CompanyRegistration.id) > 1)
                .subquery()
            )
        )
        shared_pan_count = shared_pan_result.scalar() or 0

        pan_coverage_pct = round((companies_with_pan / total_companies * 100), 2) if total_companies > 0 else 0.0
        ird_enrichment_pct = round((ird_enriched_count / companies_with_pan * 100), 2) if companies_with_pan > 0 else 0.0

        return {
            "total_companies": total_companies,
            "companies_with_pan": companies_with_pan,
            "pan_coverage_pct": pan_coverage_pct,
            "camis_enriched_count": camis_enriched_count,
            "ird_enriched_count": ird_enriched_count,
            "ird_enrichment_pct": ird_enrichment_pct,
            "total_directors": total_directors,
            "companies_by_type": companies_by_type,
            "companies_by_province": companies_by_province,
            "top_districts": top_districts,
            "risk_summary": {
                "non_filer_companies": nonfiler_count,
                "suspicious_address_clusters": cluster_count,
                "shared_pan_groups": shared_pan_count,
            },
        }

    # ------------------------------------------------------------------
    # Shared Directors (Network Analysis)
    # ------------------------------------------------------------------

    async def find_shared_directors(self, company_id: UUID) -> dict:
        """
        Find companies that share directors with the given company.
        Returns the target company info + a list of shared director links.
        """

        # 1. Get the target company
        comp_stmt = select(CompanyRegistration).where(CompanyRegistration.id == company_id)
        comp_result = await self.db.execute(comp_stmt)
        company = comp_result.scalar_one_or_none()
        if not company:
            return None

        # 2. Get all directors of this company
        dir_stmt = (
            select(CompanyDirector)
            .where(CompanyDirector.company_id == company_id)
        )
        dir_result = await self.db.execute(dir_stmt)
        directors = list(dir_result.scalars().all())

        if not directors:
            return {
                "company_id": str(company_id),
                "company_name": company.name_english,
                "shared_links": [],
                "unique_linked_companies": 0,
            }

        # 3. For each director name, find other companies they direct
        director_names = [d.name_en for d in directors]

        # Use aliased models for the self-referencing query
        OtherDirector = aliased(CompanyDirector)
        OtherCompany = aliased(CompanyRegistration)

        linked_stmt = (
            select(OtherDirector, OtherCompany)
            .join(OtherCompany, OtherDirector.company_id == OtherCompany.id)
            .where(
                and_(
                    OtherDirector.name_en.in_(director_names),
                    OtherDirector.company_id != company_id,
                    OtherDirector.company_id.isnot(None),
                )
            )
            .order_by(OtherDirector.name_en)
        )
        linked_result = await self.db.execute(linked_stmt)
        linked_rows = linked_result.all()

        shared_links = []
        seen_companies = set()
        for row in linked_rows:
            other_director = row[0]
            other_company = row[1]
            shared_links.append({
                "director_name": other_director.name_en,
                "director_role": other_director.role,
                "source": other_director.source,
                "linked_company_id": str(other_company.id),
                "linked_company_name": other_company.name_english,
                "linked_company_pan": other_company.pan,
            })
            seen_companies.add(str(other_company.id))

        return {
            "company_id": str(company_id),
            "company_name": company.name_english,
            "shared_links": shared_links,
            "unique_linked_companies": len(seen_companies),
        }

    # ------------------------------------------------------------------
    # Address Clusters (Shell Company Detection)
    # ------------------------------------------------------------------

    async def get_address_clusters(self, min_companies: int = 5, page: int = 1, limit: int = 20) -> dict:
        """
        Find addresses with many registered companies.
        High density at a single address is a classic shell company signal.
        """

        # Count clusters
        count_subq = (
            select(CompanyRegistration.company_address)
            .where(
                and_(
                    CompanyRegistration.company_address.isnot(None),
                    CompanyRegistration.company_address != "",
                )
            )
            .group_by(CompanyRegistration.company_address)
            .having(func.count(CompanyRegistration.id) >= min_companies)
            .subquery()
        )
        total_result = await self.db.execute(select(func.count()).select_from(count_subq))
        total_clusters = total_result.scalar() or 0

        # Get the clustered addresses, paginated
        offset = (page - 1) * limit
        cluster_stmt = (
            select(
                CompanyRegistration.company_address,
                func.count(CompanyRegistration.id).label("cnt"),
                func.min(CompanyRegistration.district).label("district"),
                func.min(CompanyRegistration.province).label("province"),
            )
            .where(
                and_(
                    CompanyRegistration.company_address.isnot(None),
                    CompanyRegistration.company_address != "",
                )
            )
            .group_by(CompanyRegistration.company_address)
            .having(func.count(CompanyRegistration.id) >= min_companies)
            .order_by(desc("cnt"))
            .offset(offset)
            .limit(limit)
        )
        cluster_result = await self.db.execute(cluster_stmt)
        cluster_rows = cluster_result.all()

        clusters = []
        for row in cluster_rows:
            address = row[0]
            count = row[1]
            district = row[2]
            province = row[3]

            # Fetch a sample of companies at this address (top 10)
            sample_stmt = (
                select(CompanyRegistration)
                .where(CompanyRegistration.company_address == address)
                .order_by(CompanyRegistration.registration_number.desc())
                .limit(10)
            )
            sample_result = await self.db.execute(sample_stmt)
            sample_companies = list(sample_result.scalars().all())

            clusters.append({
                "address": address,
                "company_count": count,
                "companies": [self._company_to_dict(c) for c in sample_companies],
                "district": district,
                "province": province,
            })

        return {
            "clusters": clusters,
            "total_clusters": total_clusters,
        }

    # ------------------------------------------------------------------
    # Risk Flags (Aggregated)
    # ------------------------------------------------------------------

    async def get_risk_flags(
        self,
        min_severity: str = "MEDIUM",
        page: int = 1,
        limit: int = 50,
    ) -> dict:
        """
        Get companies with risk flags, filtered by minimum severity.
        Severity levels: HIGH > MEDIUM > LOW
        """
        severity_levels = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
        min_level = severity_levels.get(min_severity.upper(), 1)

        flagged_entries = []

        # ---- 1. Non-filer companies (HIGH) ----
        if min_level <= 2:
            nonfiler_stmt = (
                select(CompanyRegistration, IRDEnrichment)
                .join(IRDEnrichment, CompanyRegistration.pan == IRDEnrichment.pan)
                .where(IRDEnrichment.account_status.ilike("non-filer%"))
                .order_by(CompanyRegistration.name_english)
            )
            nonfiler_result = await self.db.execute(nonfiler_stmt)
            for row in nonfiler_result.all():
                company, ird = row[0], row[1]
                flagged_entries.append({
                    "company": self._build_company_with_ird(company, ird),
                    "risk_flags": [{
                        "severity": "HIGH",
                        "category": "tax_compliance",
                        "description": f"IRD status: {ird.account_status}",
                        "details": {"pan": ird.pan, "account_status": ird.account_status},
                    }],
                })

        # ---- 2. Shared PAN (HIGH) ----
        if min_level <= 2:
            shared_pan_subq = (
                select(CompanyRegistration.pan)
                .where(
                    and_(
                        CompanyRegistration.pan.isnot(None),
                        CompanyRegistration.pan != "",
                    )
                )
                .group_by(CompanyRegistration.pan)
                .having(func.count(CompanyRegistration.id) > 1)
                .subquery()
            )
            shared_pan_stmt = (
                select(CompanyRegistration)
                .where(CompanyRegistration.pan.in_(select(shared_pan_subq.c.pan)))
                .order_by(CompanyRegistration.pan, CompanyRegistration.name_english)
            )
            shared_result = await self.db.execute(shared_pan_stmt)
            shared_companies = list(shared_result.scalars().all())

            # Group by PAN to get counts
            pan_groups = {}
            for c in shared_companies:
                pan_groups.setdefault(c.pan, []).append(c)

            for pan_val, group in pan_groups.items():
                for c in group:
                    flagged_entries.append({
                        "company": self._company_to_dict(c),
                        "risk_flags": [{
                            "severity": "HIGH",
                            "category": "pan_sharing",
                            "description": f"PAN {pan_val} is shared by {len(group)} companies",
                            "details": {"pan": pan_val, "company_count": len(group)},
                        }],
                    })

        # ---- 3. Address clustering (MEDIUM/HIGH) ----
        if min_level <= 1:
            cluster_stmt = (
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
                .order_by(desc("cnt"))
                .limit(100)  # top 100 clusters
            )
            cluster_result = await self.db.execute(cluster_stmt)
            cluster_rows = cluster_result.all()

            for addr, cnt in cluster_rows:
                severity = "HIGH" if cnt >= 20 else "MEDIUM"
                if severity_levels[severity] >= min_level:
                    # Get a representative company from this address
                    rep_stmt = (
                        select(CompanyRegistration)
                        .where(CompanyRegistration.company_address == addr)
                        .limit(1)
                    )
                    rep_result = await self.db.execute(rep_stmt)
                    rep_company = rep_result.scalar_one_or_none()
                    if rep_company:
                        flagged_entries.append({
                            "company": self._company_to_dict(rep_company),
                            "risk_flags": [{
                                "severity": severity,
                                "category": "address_clustering",
                                "description": f"Address has {cnt} registered companies",
                                "details": {"address": addr, "company_count": cnt},
                            }],
                        })

        # De-duplicate by company ID (a company can appear in multiple risk categories)
        # Merge risk flags for the same company
        company_map = {}
        for entry in flagged_entries:
            cid = entry["company"]["id"]
            if cid in company_map:
                company_map[cid]["risk_flags"].extend(entry["risk_flags"])
            else:
                company_map[cid] = entry

        # Sort by highest severity flag, then by name
        def sort_key(entry):
            max_sev = max(severity_levels.get(f["severity"], 0) for f in entry["risk_flags"])
            return (-max_sev, entry["company"]["name_english"])

        merged = sorted(company_map.values(), key=sort_key)
        total = len(merged)

        # Paginate
        offset = (page - 1) * limit
        paginated = merged[offset:offset + limit]

        return {
            "items": paginated,
            "total": total,
            "page": page,
            "limit": limit,
        }

    # ------------------------------------------------------------------
    # Registration Timeline
    # ------------------------------------------------------------------

    async def get_registration_timeline(
        self,
        group_by: str = "month",
        district: Optional[str] = None,
        company_type: Optional[str] = None,
    ) -> dict:
        """Return company registration counts grouped by year or month."""
        CR = CompanyRegistration

        if group_by == "year":
            period_expr = func.extract("year", CR.registration_date_ad).label("period")
        else:
            period_expr = func.to_char(CR.registration_date_ad, "YYYY-MM").label("period")

        stmt = (
            select(period_expr, func.count().label("count"))
            .where(CR.registration_date_ad.isnot(None))
        )

        if district:
            stmt = stmt.where(CR.district.ilike(f"%{district}%"))
        if company_type:
            stmt = stmt.where(CR.company_type_category.ilike(f"%{company_type}%"))

        stmt = stmt.group_by("period").order_by("period")

        result = await self.db.execute(stmt)
        rows = result.all()

        items = []
        for row in rows:
            period_val = row.period
            if period_val is not None:
                items.append({
                    "period": str(int(period_val)) if group_by == "year" else str(period_val),
                    "count": row.count,
                })

        return {"items": items, "group_by": group_by}

    async def get_registration_events(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        district: Optional[str] = None,
        limit: int = 500,
    ) -> list:
        """Return individual company registrations as timeline events."""
        CR = CompanyRegistration

        stmt = (
            select(
                CR.id,
                CR.name_english,
                CR.name_nepali,
                CR.registration_date_ad,
                CR.company_type_category,
                CR.district,
                CR.pan,
            )
            .where(CR.registration_date_ad.isnot(None))
            .order_by(CR.registration_date_ad.desc())
            .limit(limit)
        )

        if start_date:
            stmt = stmt.where(CR.registration_date_ad >= start_date)
        if end_date:
            stmt = stmt.where(CR.registration_date_ad <= end_date)
        if district:
            stmt = stmt.where(CR.district.ilike(f"%{district}%"))

        result = await self.db.execute(stmt)
        rows = result.all()

        return [
            {
                "id": str(row.id),
                "content": row.name_english or row.name_nepali or "Unknown",
                "start": row.registration_date_ad.isoformat(),
                "group": row.district or "Unknown",
                "type": row.company_type_category or "Unknown",
                "pan": row.pan,
            }
            for row in rows
        ]
