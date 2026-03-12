"""Trade ingestion and anomaly detection service for connected analyst workflows."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path
from statistics import mean, pstdev
from typing import Any

from sqlalchemy import select, delete, func, case, desc, asc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connected_analyst import (
    TradeReport,
    TradeFact,
    TradeAnomaly,
    TradeDirection,
    KBObject,
    KBLink,
    KBEvidenceRef,
    ProvenanceOwnerType,
)
from app.models.analyst_enums import SourceClassification


_MONTH_ORDINAL = {
    "shrawan": 1,
    "bhadra": 2,
    "asoj": 3,
    "kartik": 4,
    "mangsir": 5,
    "poush": 6,
    "magh": 7,
    "falgun": 8,
    "chaitra": 9,
    "baishakh": 10,
    "jestha": 11,
    "ashadh": 12,
    "annual": 12,
}


class TradeIngestionService:
    """Ingest Nepal FTS workbooks and emit graph-backed trade intelligence objects."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def run_ingestion(self, data_root: str | Path) -> dict[str, Any]:
        files = sorted(Path(data_root).glob("**/*.xlsx"))
        processed_files = 0
        reports_upserted = 0
        facts_upserted = 0

        object_cache: dict[str, KBObject] = {}
        link_cache: dict[tuple[str, str, str], KBLink] = {}

        for file_path in files:
            parsed = self._parse_trade_workbook(file_path)
            if not parsed:
                continue

            report_meta, fact_rows = parsed
            report = await self._upsert_report(report_meta)
            reports_upserted += 1

            await self.db.execute(delete(TradeFact).where(TradeFact.report_id == report.id))

            report_facts: list[TradeFact] = []
            for row in fact_rows:
                fact = TradeFact(
                    report_id=report.id,
                    table_name=row["table_name"],
                    direction=row["direction"],
                    hs_code=row.get("hs_code"),
                    commodity_description=row.get("commodity_description"),
                    partner_country=row.get("partner_country"),
                    customs_office=row.get("customs_office"),
                    unit=row.get("unit"),
                    quantity=row.get("quantity"),
                    value_npr_thousands=row.get("value_npr_thousands") or 0.0,
                    revenue_npr_thousands=row.get("revenue_npr_thousands"),
                    cumulative_value_npr_thousands=row.get("cumulative_value_npr_thousands"),
                    delta_value_npr_thousands=row.get("delta_value_npr_thousands"),
                    record_key=row["record_key"],
                    fact_metadata=row.get("metadata") or {},
                )
                self.db.add(fact)
                report_facts.append(fact)

            await self.db.flush()
            facts_upserted += len(report_facts)

            await self._emit_graph_objects(report, report_facts, object_cache, link_cache)

            processed_files += 1

        delta_updates = await self._recompute_monthly_deltas()
        anomaly_count = await self._recompute_anomalies()
        await self.db.commit()

        return {
            "processed_files": processed_files,
            "reports_upserted": reports_upserted,
            "facts_upserted": facts_upserted,
            "delta_rows_updated": delta_updates,
            "anomalies_upserted": anomaly_count,
        }

    async def list_flows(
        self,
        hs_code: str | None = None,
        partner_country: str | None = None,
        customs_office: str | None = None,
        fiscal_year_bs: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        stmt = select(TradeFact, TradeReport).join(TradeReport, TradeFact.report_id == TradeReport.id)

        if hs_code:
            stmt = stmt.where(TradeFact.hs_code == hs_code)
        if partner_country:
            stmt = stmt.where(TradeFact.partner_country == partner_country)
        if customs_office:
            stmt = stmt.where(TradeFact.customs_office == customs_office)
        if fiscal_year_bs:
            stmt = stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)

        count_stmt = select(func.count()).select_from(TradeFact).join(
            TradeReport, TradeFact.report_id == TradeReport.id
        )
        if hs_code:
            count_stmt = count_stmt.where(TradeFact.hs_code == hs_code)
        if partner_country:
            count_stmt = count_stmt.where(TradeFact.partner_country == partner_country)
        if customs_office:
            count_stmt = count_stmt.where(TradeFact.customs_office == customs_office)
        if fiscal_year_bs:
            count_stmt = count_stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)

        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        rows = await self.db.execute(
            stmt.order_by(TradeReport.fiscal_year_bs.desc(), TradeReport.month_ordinal.desc())
            .offset(offset)
            .limit(limit)
        )

        items = []
        for fact, report in rows.all():
            items.append(
                {
                    "id": str(fact.id),
                    "fiscal_year_bs": report.fiscal_year_bs,
                    "upto_month": report.upto_month,
                    "month_ordinal": report.month_ordinal,
                    "table_name": fact.table_name,
                    "direction": fact.direction.value,
                    "hs_code": fact.hs_code,
                    "commodity_description": fact.commodity_description,
                    "partner_country": fact.partner_country,
                    "customs_office": fact.customs_office,
                    "quantity": fact.quantity,
                    "unit": fact.unit,
                    "value_npr_thousands": fact.value_npr_thousands,
                    "delta_value_npr_thousands": fact.delta_value_npr_thousands,
                    "revenue_npr_thousands": fact.revenue_npr_thousands,
                }
            )

        return {"items": items, "total": total, "limit": limit, "offset": offset}

    async def list_anomalies(
        self,
        dimension: str | None = None,
        dimension_key: str | None = None,
        fiscal_year_bs: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        stmt = select(TradeAnomaly)

        if dimension:
            stmt = stmt.where(TradeAnomaly.dimension == dimension)
        if dimension_key:
            stmt = stmt.where(TradeAnomaly.dimension_key == dimension_key)
        if fiscal_year_bs:
            stmt = stmt.where(TradeAnomaly.fiscal_year_bs == fiscal_year_bs)

        count_stmt = select(func.count()).select_from(TradeAnomaly)
        if dimension:
            count_stmt = count_stmt.where(TradeAnomaly.dimension == dimension)
        if dimension_key:
            count_stmt = count_stmt.where(TradeAnomaly.dimension_key == dimension_key)
        if fiscal_year_bs:
            count_stmt = count_stmt.where(TradeAnomaly.fiscal_year_bs == fiscal_year_bs)

        total = int((await self.db.execute(count_stmt)).scalar() or 0)

        rows = await self.db.execute(
            stmt.order_by(TradeAnomaly.fiscal_year_bs.desc(), TradeAnomaly.month_ordinal.desc(), TradeAnomaly.anomaly_score.desc())
            .offset(offset)
            .limit(limit)
        )

        items = []
        for anomaly in rows.scalars().all():
            items.append(
                {
                    "id": str(anomaly.id),
                    "dimension": anomaly.dimension,
                    "dimension_key": anomaly.dimension_key,
                    "fiscal_year_bs": anomaly.fiscal_year_bs,
                    "month_ordinal": anomaly.month_ordinal,
                    "anomaly_score": anomaly.anomaly_score,
                    "observed_value": anomaly.observed_value,
                    "expected_value": anomaly.expected_value,
                    "deviation_pct": anomaly.deviation_pct,
                    "severity": anomaly.severity,
                    "verification_status": anomaly.verification_status.value,
                    "source_count": 1,
                    "confidence": min(1.0, anomaly.anomaly_score / 5.0),
                }
            )

        return {"items": items, "total": total, "limit": limit, "offset": offset}

    async def customs_impact(self, customs_id: str) -> dict[str, Any]:
        normalized = customs_id.replace("_", " ").strip().lower()

        rows = await self.db.execute(
            select(TradeFact, TradeReport)
            .join(TradeReport, TradeFact.report_id == TradeReport.id)
            .where(TradeFact.customs_office.is_not(None))
            .order_by(TradeReport.fiscal_year_bs.desc(), TradeReport.month_ordinal.desc())
        )

        matches = [
            (fact, report)
            for fact, report in rows.all()
            if fact.customs_office and fact.customs_office.strip().lower() == normalized
        ]

        if not matches:
            return {
                "customs_id": customs_id,
                "summary": None,
                "anomalies": [],
                "message": "No data found for customs office",
            }

        latest_report = max(matches, key=lambda item: (item[1].fiscal_year_bs, item[1].month_ordinal))[1]
        latest = [pair for pair in matches if pair[1].id == latest_report.id]

        imports_value = sum(
            fact.value_npr_thousands
            for fact, _ in latest
            if fact.direction == TradeDirection.IMPORT
        )
        exports_value = sum(
            fact.value_npr_thousands
            for fact, _ in latest
            if fact.direction == TradeDirection.EXPORT
        )

        anomaly_rows = await self.db.execute(
            select(TradeAnomaly)
            .where(TradeAnomaly.dimension == "customs_office")
            .where(TradeAnomaly.dimension_key == normalized)
            .order_by(TradeAnomaly.fiscal_year_bs.desc(), TradeAnomaly.month_ordinal.desc())
            .limit(20)
        )

        anomalies = [
            {
                "id": str(item.id),
                "month_ordinal": item.month_ordinal,
                "fiscal_year_bs": item.fiscal_year_bs,
                "anomaly_score": item.anomaly_score,
                "severity": item.severity,
                "confidence": min(1.0, item.anomaly_score / 5.0),
                "source_count": 1,
                "verification_status": item.verification_status.value,
            }
            for item in anomaly_rows.scalars().all()
        ]

        return {
            "customs_id": customs_id,
            "summary": {
                "customs_office": latest[0][0].customs_office,
                "fiscal_year_bs": latest_report.fiscal_year_bs,
                "month_ordinal": latest_report.month_ordinal,
                "imports_value_npr_thousands": imports_value,
                "exports_value_npr_thousands": exports_value,
            },
            "anomalies": anomalies,
        }

    async def recompute(
        self,
        fiscal_year_bs: str | None = None,
    ) -> dict[str, Any]:
        delta_updates = await self._recompute_monthly_deltas(fiscal_year_bs=fiscal_year_bs)
        anomaly_count = await self._recompute_anomalies(fiscal_year_bs=fiscal_year_bs)
        await self.db.commit()
        return {
            "status": "ok",
            "fiscal_year_bs": fiscal_year_bs,
            "delta_rows_updated": delta_updates,
            "anomalies_upserted": anomaly_count,
        }

    async def workbench_summary(
        self,
        fiscal_year_bs: str | None = None,
        month_ordinal: int | None = None,
    ) -> dict[str, Any]:
        report_stmt = select(TradeReport)
        if fiscal_year_bs:
            report_stmt = report_stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)
        if month_ordinal:
            report_stmt = report_stmt.where(TradeReport.month_ordinal == month_ordinal)
        report_stmt = report_stmt.order_by(TradeReport.fiscal_year_bs.desc(), TradeReport.month_ordinal.desc())

        latest_report = (await self.db.execute(report_stmt.limit(1))).scalar_one_or_none()
        if not latest_report:
            return {"summary": None, "top_customs": [], "top_partners": [], "top_hs_codes": []}

        rows = await self.db.execute(
            select(TradeFact)
            .where(TradeFact.report_id == latest_report.id)
        )
        facts = list(rows.scalars().all())

        imports_total = sum(
            item.value_npr_thousands
            for item in facts
            if item.direction == TradeDirection.IMPORT
        )
        exports_total = sum(
            item.value_npr_thousands
            for item in facts
            if item.direction == TradeDirection.EXPORT
        )

        def top_by_key(items: list[TradeFact], key_name: str, limit: int = 10) -> list[dict[str, Any]]:
            bucket: dict[str, float] = {}
            for fact in items:
                key = getattr(fact, key_name) or ""
                if not key:
                    continue
                bucket[key] = bucket.get(key, 0.0) + float(fact.value_npr_thousands or 0.0)
            ranked = sorted(bucket.items(), key=lambda pair: pair[1], reverse=True)[:limit]
            return [{"key": key, "value_npr_thousands": value} for key, value in ranked]

        anomaly_count = int(
            (
                await self.db.execute(
                    select(func.count()).select_from(TradeAnomaly).where(
                        TradeAnomaly.fiscal_year_bs == latest_report.fiscal_year_bs,
                    )
                )
            ).scalar()
            or 0
        )

        return {
            "summary": {
                "fiscal_year_bs": latest_report.fiscal_year_bs,
                "upto_month": latest_report.upto_month,
                "month_ordinal": latest_report.month_ordinal,
                "imports_total_npr_thousands": imports_total,
                "exports_total_npr_thousands": exports_total,
                "trade_balance_npr_thousands": exports_total - imports_total,
                "anomaly_count": anomaly_count,
            },
            "top_customs": top_by_key(facts, "customs_office"),
            "top_partners": top_by_key(facts, "partner_country"),
            "top_hs_codes": top_by_key(facts, "hs_code"),
        }

    async def workbench_drilldown(
        self,
        fiscal_year_bs: str | None = None,
        direction: str | None = None,
        hs_code: str | None = None,
        partner_country: str | None = None,
        customs_office: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        stmt = select(TradeFact, TradeReport).join(TradeReport, TradeFact.report_id == TradeReport.id)
        if fiscal_year_bs:
            stmt = stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)
        if direction:
            normalized = direction.strip().lower()
            if normalized in {item.value for item in TradeDirection}:
                stmt = stmt.where(TradeFact.direction == TradeDirection(normalized))
        if hs_code:
            stmt = stmt.where(TradeFact.hs_code == hs_code)
        if partner_country:
            stmt = stmt.where(TradeFact.partner_country == partner_country)
        if customs_office:
            stmt = stmt.where(TradeFact.customs_office == customs_office)

        total = int(
            (
                await self.db.execute(
                    select(func.count()).select_from(stmt.subquery())
                )
            ).scalar()
            or 0
        )

        rows = await self.db.execute(
            stmt.order_by(TradeReport.fiscal_year_bs.desc(), TradeReport.month_ordinal.desc(), TradeFact.value_npr_thousands.desc())
            .offset(offset)
            .limit(limit)
        )

        items: list[dict[str, Any]] = []
        for fact, report in rows.all():
            items.append(
                {
                    "id": str(fact.id),
                    "report_id": str(report.id),
                    "fiscal_year_bs": report.fiscal_year_bs,
                    "upto_month": report.upto_month,
                    "month_ordinal": report.month_ordinal,
                    "table_name": fact.table_name,
                    "direction": fact.direction.value,
                    "hs_code": fact.hs_code,
                    "commodity_description": fact.commodity_description,
                    "partner_country": fact.partner_country,
                    "customs_office": fact.customs_office,
                    "value_npr_thousands": fact.value_npr_thousands,
                    "cumulative_value_npr_thousands": fact.cumulative_value_npr_thousands,
                    "delta_value_npr_thousands": fact.delta_value_npr_thousands,
                }
            )

        return {"items": items, "total": total, "limit": limit, "offset": offset}

    async def workbench_hs_aggregation(
        self,
        fiscal_year_bs: str | None = None,
        direction: str | None = None,
        partner_country: str | None = None,
        customs_office: str | None = None,
        hs_prefix: str | None = None,
        sort_by: str = "total_value_npr_thousands",
        sort_direction: str = "desc",
        limit: int = 200,
        offset: int = 0,
    ) -> dict[str, Any]:
        direction_enum: TradeDirection | None = None
        if direction:
            normalized = direction.strip().lower()
            if normalized in {item.value for item in TradeDirection}:
                direction_enum = TradeDirection(normalized)

        value_expr = func.coalesce(
            TradeFact.delta_value_npr_thousands,
            TradeFact.value_npr_thousands,
            0.0,
        )

        import_value_expr = func.sum(
            case(
                (TradeFact.direction == TradeDirection.IMPORT, value_expr),
                else_=0.0,
            )
        ).label("imports_npr_thousands")
        export_value_expr = func.sum(
            case(
                (TradeFact.direction == TradeDirection.EXPORT, value_expr),
                else_=0.0,
            )
        ).label("exports_npr_thousands")
        total_value_expr = func.sum(value_expr).label("total_value_npr_thousands")
        fact_count_expr = func.count(TradeFact.id).label("fact_count")
        commodity_description_expr = func.max(
            case(
                (
                    func.length(func.trim(func.coalesce(TradeFact.commodity_description, ""))) > 0,
                    TradeFact.commodity_description,
                ),
                else_=None,
            )
        ).label("commodity_description")

        aggregate_stmt = (
            select(
                TradeFact.hs_code.label("hs_code"),
                commodity_description_expr,
                import_value_expr,
                export_value_expr,
                total_value_expr,
                fact_count_expr,
            )
            .select_from(TradeFact)
            .join(TradeReport, TradeFact.report_id == TradeReport.id)
            .where(TradeFact.hs_code.is_not(None))
            .where(func.length(func.trim(TradeFact.hs_code)) > 0)
        )
        aggregate_stmt = self._apply_trade_filters_to_statement(
            aggregate_stmt,
            fiscal_year_bs=fiscal_year_bs,
            direction=direction_enum,
            partner_country=partner_country,
            customs_office=customs_office,
            hs_prefix=hs_prefix,
        )
        aggregate_stmt = aggregate_stmt.group_by(TradeFact.hs_code)

        sort_column_map = {
            "hs_code": "hs_code",
            "imports_npr_thousands": "imports_npr_thousands",
            "exports_npr_thousands": "exports_npr_thousands",
            "total_value_npr_thousands": "total_value_npr_thousands",
            "fact_count": "fact_count",
        }
        normalized_sort = sort_column_map.get(sort_by, "total_value_npr_thousands")
        sort_expr = aggregate_stmt.selected_columns[normalized_sort]
        order_clause = asc(sort_expr) if sort_direction.lower() == "asc" else desc(sort_expr)

        paged_stmt = aggregate_stmt.order_by(order_clause).offset(offset).limit(limit)
        rows = await self.db.execute(paged_stmt)

        grouped_rows_subquery = aggregate_stmt.subquery()
        total_groups = int(
            (
                await self.db.execute(
                    select(func.count()).select_from(grouped_rows_subquery)
                )
            ).scalar()
            or 0
        )

        rows_scanned_stmt = (
            select(func.count())
            .select_from(TradeFact)
            .join(TradeReport, TradeFact.report_id == TradeReport.id)
            .where(TradeFact.hs_code.is_not(None))
            .where(func.length(func.trim(TradeFact.hs_code)) > 0)
        )
        rows_scanned_stmt = self._apply_trade_filters_to_statement(
            rows_scanned_stmt,
            fiscal_year_bs=fiscal_year_bs,
            direction=direction_enum,
            partner_country=partner_country,
            customs_office=customs_office,
            hs_prefix=hs_prefix,
        )
        rows_scanned = int((await self.db.execute(rows_scanned_stmt)).scalar() or 0)

        items: list[dict[str, Any]] = []
        missing_description_codes: list[str] = []
        for row in rows:
            commodity_description = row.commodity_description.strip() if row.commodity_description else None
            if not commodity_description:
                missing_description_codes.append(row.hs_code)
            items.append(
                {
                    "hs_code": row.hs_code,
                    "commodity_description": commodity_description,
                    "imports_npr_thousands": float(row.imports_npr_thousands or 0.0),
                    "exports_npr_thousands": float(row.exports_npr_thousands or 0.0),
                    "total_value_npr_thousands": float(row.total_value_npr_thousands or 0.0),
                    "fact_count": int(row.fact_count or 0),
                }
            )

        if missing_description_codes:
            fallback_descriptions = await self._lookup_hs_descriptions(missing_description_codes)
            for item in items:
                if not item.get("commodity_description"):
                    item["commodity_description"] = fallback_descriptions.get(item["hs_code"])

        return {
            "items": items,
            "total": total_groups,
            "limit": limit,
            "offset": offset,
            "coverage": {
                "rows_scanned": rows_scanned,
                "hs_codes_total": total_groups,
                "has_more": offset + len(items) < total_groups,
            },
        }

    async def _lookup_hs_descriptions(self, hs_codes: list[str]) -> dict[str, str]:
        normalized_codes = sorted({code.strip() for code in hs_codes if code and code.strip()})
        if not normalized_codes:
            return {}

        stmt = (
            select(TradeFact.hs_code, TradeFact.commodity_description)
            .where(TradeFact.hs_code.in_(normalized_codes))
            .where(TradeFact.commodity_description.is_not(None))
            .where(func.length(func.trim(TradeFact.commodity_description)) > 0)
            .order_by(
                func.length(func.trim(TradeFact.commodity_description)).desc(),
                TradeFact.commodity_description.asc(),
            )
        )
        rows = await self.db.execute(stmt)

        descriptions: dict[str, str] = {}
        for hs_code, commodity_description in rows.all():
            if not hs_code or not commodity_description:
                continue
            hs_code_value = hs_code.strip()
            desc_value = commodity_description.strip()
            if not hs_code_value or not desc_value or hs_code_value in descriptions:
                continue
            descriptions[hs_code_value] = desc_value

        return descriptions

    async def workbench_series(
        self,
        dimension: str,
        dimension_key: str,
        direction: str | None = None,
        fiscal_year_bs: str | None = None,
    ) -> dict[str, Any]:
        allowed_dimension = {"hs_code", "partner_country", "customs_office"}
        if dimension not in allowed_dimension:
            return {"dimension": dimension, "dimension_key": dimension_key, "items": []}

        stmt = select(TradeFact, TradeReport).join(TradeReport, TradeFact.report_id == TradeReport.id)
        stmt = stmt.where(getattr(TradeFact, dimension) == dimension_key)
        if fiscal_year_bs:
            stmt = stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)
        if direction:
            normalized = direction.strip().lower()
            if normalized in {item.value for item in TradeDirection}:
                stmt = stmt.where(TradeFact.direction == TradeDirection(normalized))

        rows = await self.db.execute(stmt)
        points = sorted(
            rows.all(),
            key=lambda item: (self._fy_sort_key(item[1].fiscal_year_bs), item[1].month_ordinal),
        )

        series = []
        for fact, report in points:
            series.append(
                {
                    "fiscal_year_bs": report.fiscal_year_bs,
                    "month_ordinal": report.month_ordinal,
                    "upto_month": report.upto_month,
                    "direction": fact.direction.value,
                    "value_npr_thousands": fact.value_npr_thousands,
                    "delta_value_npr_thousands": fact.delta_value_npr_thousands,
                }
            )

        anomaly_rows = await self.db.execute(
            select(TradeAnomaly)
            .where(TradeAnomaly.dimension == dimension)
            .where(TradeAnomaly.dimension_key == dimension_key)
            .order_by(TradeAnomaly.fiscal_year_bs.desc(), TradeAnomaly.month_ordinal.desc())
            .limit(100)
        )
        anomalies = [
            {
                "id": str(item.id),
                "fiscal_year_bs": item.fiscal_year_bs,
                "month_ordinal": item.month_ordinal,
                "anomaly_score": item.anomaly_score,
                "severity": item.severity,
                "observed_value": item.observed_value,
                "expected_value": item.expected_value,
                "deviation_pct": item.deviation_pct,
            }
            for item in anomaly_rows.scalars().all()
        ]

        return {
            "dimension": dimension,
            "dimension_key": dimension_key,
            "items": series,
            "anomalies": anomalies,
        }

    async def _upsert_report(self, meta: dict[str, Any]) -> TradeReport:
        source_hash = meta.get("source_hash")
        if source_hash:
            by_hash = await self.db.scalar(
                select(TradeReport)
                .where(TradeReport.source_hash == source_hash)
                .limit(1)
            )
            if by_hash:
                by_hash.fiscal_year_bs = meta["fiscal_year_bs"]
                by_hash.upto_month = meta["upto_month"]
                by_hash.month_ordinal = meta["month_ordinal"]
                by_hash.report_title = meta.get("report_title")
                by_hash.file_path = meta["file_path"]
                by_hash.coverage_text = meta.get("coverage_text")
                by_hash.coverage_start_ad = meta.get("coverage_start_ad")
                by_hash.coverage_end_ad = meta.get("coverage_end_ad")
                return by_hash

        existing = await self.db.scalar(
            select(TradeReport)
            .where(TradeReport.fiscal_year_bs == meta["fiscal_year_bs"])
            .where(TradeReport.month_ordinal == meta["month_ordinal"])
            .where(TradeReport.file_path == meta["file_path"])
        )

        if existing:
            existing.upto_month = meta["upto_month"]
            existing.report_title = meta.get("report_title")
            existing.coverage_text = meta.get("coverage_text")
            existing.coverage_start_ad = meta.get("coverage_start_ad")
            existing.coverage_end_ad = meta.get("coverage_end_ad")
            existing.source_hash = meta.get("source_hash")
            return existing

        report = TradeReport(
            fiscal_year_bs=meta["fiscal_year_bs"],
            upto_month=meta["upto_month"],
            month_ordinal=meta["month_ordinal"],
            report_title=meta.get("report_title"),
            file_path=meta["file_path"],
            coverage_text=meta.get("coverage_text"),
            coverage_start_ad=meta.get("coverage_start_ad"),
            coverage_end_ad=meta.get("coverage_end_ad"),
            source_hash=meta.get("source_hash"),
        )
        self.db.add(report)
        await self.db.flush()
        return report

    async def _emit_graph_objects(
        self,
        report: TradeReport,
        facts: list[TradeFact],
        object_cache: dict[str, KBObject],
        link_cache: dict[tuple[str, str, str], KBLink],
    ) -> None:
        for fact in facts:
            hs_obj = None
            partner_obj = None
            customs_obj = None

            if fact.hs_code:
                hs_key = f"hs:{fact.hs_code.strip()}"
                hs_obj = await self._get_or_create_object(
                    canonical_key=hs_key,
                    object_type="hs_code",
                    title=fact.hs_code.strip(),
                    description=fact.commodity_description,
                    attributes={"hs_code": fact.hs_code, "description": fact.commodity_description},
                    object_cache=object_cache,
                )
                await self._add_trade_provenance(ProvenanceOwnerType.OBJECT, str(hs_obj.id), report)

            if fact.partner_country:
                country_norm = self._slugify(fact.partner_country)
                partner_key = f"country:{country_norm}"
                partner_obj = await self._get_or_create_object(
                    canonical_key=partner_key,
                    object_type="partner_country",
                    title=fact.partner_country,
                    description=None,
                    attributes={"country": fact.partner_country},
                    object_cache=object_cache,
                )
                await self._add_trade_provenance(ProvenanceOwnerType.OBJECT, str(partner_obj.id), report)

            if fact.customs_office:
                customs_norm = self._slugify(fact.customs_office)
                customs_key = f"customs:{customs_norm}"
                customs_obj = await self._get_or_create_object(
                    canonical_key=customs_key,
                    object_type="customs_office",
                    title=fact.customs_office,
                    description=None,
                    attributes={"customs_office": fact.customs_office},
                    object_cache=object_cache,
                )
                await self._add_trade_provenance(ProvenanceOwnerType.OBJECT, str(customs_obj.id), report)

            if hs_obj and partner_obj:
                link = await self._get_or_create_link(hs_obj, partner_obj, "TRADE_WITH", link_cache)
                await self._add_trade_provenance(ProvenanceOwnerType.LINK, str(link.id), report)

            if hs_obj and customs_obj:
                link = await self._get_or_create_link(hs_obj, customs_obj, "TRADE_THROUGH", link_cache)
                await self._add_trade_provenance(ProvenanceOwnerType.LINK, str(link.id), report)

            if customs_obj and partner_obj:
                link = await self._get_or_create_link(customs_obj, partner_obj, "CUSTOMS_TRADES_WITH", link_cache)
                await self._add_trade_provenance(ProvenanceOwnerType.LINK, str(link.id), report)

    async def _get_or_create_object(
        self,
        canonical_key: str,
        object_type: str,
        title: str,
        description: str | None,
        attributes: dict[str, Any],
        object_cache: dict[str, KBObject],
    ) -> KBObject:
        cached = object_cache.get(canonical_key)
        if cached:
            cached.source_count += 1
            cached.confidence = min(1.0, 0.4 + (cached.source_count * 0.02))
            return cached

        existing = await self.db.scalar(select(KBObject).where(KBObject.canonical_key == canonical_key))
        if existing:
            existing.source_count += 1
            existing.confidence = min(1.0, 0.4 + (existing.source_count * 0.02))
            if description and not existing.description:
                existing.description = description
            merged = {**(existing.attributes or {}), **attributes}
            existing.attributes = merged
            object_cache[canonical_key] = existing
            return existing

        obj = KBObject(
            object_type=object_type,
            canonical_key=canonical_key,
            title=title,
            description=description,
            attributes=attributes,
            confidence=0.45,
            source_count=1,
        )
        self.db.add(obj)
        await self.db.flush()
        object_cache[canonical_key] = obj
        return obj

    async def _get_or_create_link(
        self,
        source: KBObject,
        target: KBObject,
        predicate: str,
        link_cache: dict[tuple[str, str, str], KBLink],
    ) -> KBLink:
        key = (str(source.id), str(target.id), predicate)
        cached = link_cache.get(key)
        if cached:
            cached.source_count += 1
            cached.confidence = min(1.0, 0.35 + (cached.source_count * 0.03))
            cached.last_seen_at = cached.updated_at
            return cached

        existing = await self.db.scalar(
            select(KBLink)
            .where(KBLink.source_object_id == source.id)
            .where(KBLink.target_object_id == target.id)
            .where(KBLink.predicate == predicate)
        )
        if existing:
            existing.source_count += 1
            existing.confidence = min(1.0, 0.35 + (existing.source_count * 0.03))
            existing.last_seen_at = existing.updated_at
            link_cache[key] = existing
            return existing

        link = KBLink(
            source_object_id=source.id,
            target_object_id=target.id,
            predicate=predicate,
            source_count=1,
            confidence=0.4,
        )
        self.db.add(link)
        await self.db.flush()
        link_cache[key] = link
        return link

    async def _add_trade_provenance(self, owner_type: ProvenanceOwnerType, owner_id: str, report: TradeReport) -> None:
        source_key = f"trade_report:{report.fiscal_year_bs}:{report.month_ordinal}"
        evidence = KBEvidenceRef(
            owner_type=owner_type,
            owner_id=owner_id,
            evidence_type="trade_report",
            evidence_id=str(report.id),
            source_url=None,
            source_key=source_key,
            source_name="Nepal Foreign Trade Statistics",
            source_classification=SourceClassification.OFFICIAL,
            confidence=0.85,
            excerpt=report.coverage_text,
            evidence_metadata={
                "file_path": report.file_path,
                "fiscal_year_bs": report.fiscal_year_bs,
                "upto_month": report.upto_month,
            },
        )
        self.db.add(evidence)

    async def _recompute_anomalies(self, fiscal_year_bs: str | None = None) -> int:
        if fiscal_year_bs:
            await self.db.execute(delete(TradeAnomaly).where(TradeAnomaly.fiscal_year_bs == fiscal_year_bs))
        else:
            await self.db.execute(delete(TradeAnomaly))

        stmt = select(TradeFact, TradeReport).join(TradeReport, TradeFact.report_id == TradeReport.id)
        if fiscal_year_bs:
            stmt = stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)
        rows = await self.db.execute(
            stmt
        )

        grouped: dict[tuple[str, str], list[tuple[TradeFact, TradeReport, float]]] = {}
        for fact, report in rows.all():
            value = fact.delta_value_npr_thousands
            if value is None:
                value = fact.value_npr_thousands or 0.0

            if fact.hs_code:
                grouped.setdefault(("hs_code", fact.hs_code.strip()), []).append((fact, report, value))
            if fact.partner_country:
                grouped.setdefault(("partner_country", fact.partner_country.strip().lower()), []).append((fact, report, value))
            if fact.customs_office:
                grouped.setdefault(("customs_office", fact.customs_office.strip().lower()), []).append((fact, report, value))

        created = 0
        for (dimension, key), points in grouped.items():
            ordered = sorted(
                points,
                key=lambda item: (self._fy_sort_key(item[1].fiscal_year_bs), item[1].month_ordinal),
            )

            values = [item[2] for item in ordered]
            if len(values) < 3:
                continue

            for idx in range(2, len(ordered)):
                baseline = values[:idx]
                observed = values[idx]
                baseline_mean = mean(baseline)
                baseline_std = pstdev(baseline)

                if baseline_std <= 0:
                    continue

                score = abs(observed - baseline_mean) / baseline_std
                if score < 2.0:
                    continue

                severity = "medium"
                if score >= 4.0:
                    severity = "critical"
                elif score >= 3.0:
                    severity = "high"

                fact, report, _ = ordered[idx]
                expected = baseline_mean
                deviation_pct = ((observed - expected) / expected * 100.0) if expected else None

                anomaly = TradeAnomaly(
                    trade_fact_id=fact.id,
                    dimension=dimension,
                    dimension_key=key,
                    fiscal_year_bs=report.fiscal_year_bs,
                    month_ordinal=report.month_ordinal,
                    anomaly_score=score,
                    observed_value=observed,
                    expected_value=expected,
                    baseline_mean=baseline_mean,
                    baseline_std=baseline_std,
                    deviation_pct=deviation_pct,
                    severity=severity,
                    rationale=f"score={score:.2f}, baseline_mean={baseline_mean:.2f}, baseline_std={baseline_std:.2f}",
                )
                self.db.add(anomaly)
                created += 1

        await self.db.flush()
        return created

    async def _recompute_monthly_deltas(self, fiscal_year_bs: str | None = None) -> int:
        stmt = select(TradeFact, TradeReport).join(TradeReport, TradeFact.report_id == TradeReport.id)
        if fiscal_year_bs:
            stmt = stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)
        rows = await self.db.execute(stmt)

        grouped: dict[tuple[str, str, str, str], list[tuple[TradeFact, TradeReport]]] = {}
        for fact, report in rows.all():
            direction = fact.direction.value if hasattr(fact.direction, "value") else str(fact.direction)
            key = (
                report.fiscal_year_bs,
                fact.table_name,
                direction,
                fact.record_key,
            )
            grouped.setdefault(key, []).append((fact, report))

        updated = 0
        for _, points in grouped.items():
            points.sort(key=lambda item: item[1].month_ordinal)
            prev_cumulative: float | None = None

            for fact, _ in points:
                cumulative = (
                    fact.cumulative_value_npr_thousands
                    if fact.cumulative_value_npr_thousands is not None
                    else fact.value_npr_thousands
                )
                if cumulative is None:
                    cumulative = 0.0

                if prev_cumulative is None:
                    delta = cumulative
                else:
                    delta = cumulative - prev_cumulative

                fact.delta_value_npr_thousands = delta
                prev_cumulative = cumulative
                updated += 1

        await self.db.flush()
        return updated

    def _parse_trade_workbook(self, file_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
        try:
            import pandas as pd  # lazy import to keep API module import-safe
        except Exception as exc:  # pragma: no cover - runtime dependency guard
            raise RuntimeError("Trade ingestion requires pandas and openpyxl installed") from exc

        file_name = file_path.name
        if file_name.startswith("~$"):
            return None
        fy_match = re.search(r"_(\d{4}-\d{2})\.xlsx$", file_name)
        if not fy_match:
            return None
        fiscal_year_bs = fy_match.group(1)

        month_label = "annual"
        month_match = re.search(r"FTS(?:_upto)?_([A-Za-z]+)_\d{4}-\d{2}\.xlsx$", file_name)
        if month_match:
            month_label = month_match.group(1)
        elif "Annual" in file_name:
            month_label = "annual"

        month_ordinal = _MONTH_ORDINAL.get(month_label.lower())
        if month_ordinal is None:
            return None

        xls = pd.ExcelFile(file_path)
        coverage_text = None
        report_title = None
        if xls.sheet_names:
            try:
                report_title = xls.sheet_names[0]
                first = xls.parse(xls.sheet_names[0], nrows=0)
                if len(first.columns) > 0:
                    coverage_text = str(first.columns[-1])
            except Exception:
                coverage_text = None

        report_meta = {
            "fiscal_year_bs": fiscal_year_bs,
            "upto_month": month_label,
            "month_ordinal": month_ordinal,
            "report_title": report_title,
            "file_path": str(file_path),
            "coverage_text": coverage_text,
            "coverage_start_ad": None,
            "coverage_end_ad": None,
            "source_hash": self._sha256_file(file_path),
        }

        facts: list[dict[str, Any]] = []

        sheet_4 = next((name for name in xls.sheet_names if name.startswith("4_")), None)
        if sheet_4:
            frame = self._load_trade_frame(
                file_path=file_path,
                sheet_name=sheet_4,
                required_tokens=["hscode", "description", "partner", "import", "value"],
            )
            for _, row in frame.iterrows():
                hs_code = self._normalize_hs_code(
                    self._row_get(
                        row=row,
                        keys=["hscode", "hs_code", "hs", "hs_cd"],
                        contains_all=["hs"],
                    )
                )
                partner_country = self._normalize_partner_country(
                    self._row_get(
                        row=row,
                        keys=["partner_countries", "partner_country", "partner"],
                        contains_all=["partner"],
                    )
                )
                if not hs_code or not partner_country:
                    continue

                value = self._to_float(
                    self._row_get(
                        row=row,
                        keys=["imports_value", "import_value", "importsvalue"],
                        contains_all=["import", "value"],
                        contains_none=["share"],
                    )
                )
                revenue = self._to_float(
                    self._row_get(
                        row=row,
                        keys=["imports_revenue", "import_revenue", "revenue"],
                        contains_all=["revenue"],
                    )
                )
                quantity = self._to_float(
                    self._row_get(row=row, keys=["quantity", "qty"], contains_all=["quantity"])
                )
                unit = self._to_str(
                    self._row_get(row=row, keys=["unit", "uom"], contains_all=["unit"])
                )
                description = self._to_str(
                    self._row_get(
                        row=row,
                        keys=["description", "commodity_description", "commodity"],
                        contains_all=["description"],
                    )
                )

                record_key = f"{hs_code}|{partner_country}|{unit or ''}"
                facts.append(
                    {
                        "table_name": "imports_by_commodity_partner",
                        "direction": TradeDirection.IMPORT,
                        "hs_code": hs_code,
                        "commodity_description": description,
                        "partner_country": partner_country,
                        "customs_office": None,
                        "unit": unit,
                        "quantity": quantity,
                        "value_npr_thousands": value or 0.0,
                        "revenue_npr_thousands": revenue,
                        "cumulative_value_npr_thousands": value,
                        "delta_value_npr_thousands": None,
                        "record_key": record_key,
                        "metadata": {"sheet": sheet_4, "parser_version": "v2"},
                    }
                )

        sheet_6 = next((name for name in xls.sheet_names if name.startswith("6_")), None)
        if sheet_6:
            frame = self._load_trade_frame(
                file_path=file_path,
                sheet_name=sheet_6,
                required_tokens=["hscode", "description", "partner", "export", "value"],
            )
            for _, row in frame.iterrows():
                hs_code = self._normalize_hs_code(
                    self._row_get(
                        row=row,
                        keys=["hscode", "hs_code", "hs", "hs_cd"],
                        contains_all=["hs"],
                    )
                )
                partner_country = self._normalize_partner_country(
                    self._row_get(
                        row=row,
                        keys=["partner_countries", "partner_country", "partner"],
                        contains_all=["partner"],
                    )
                )
                if not hs_code or not partner_country:
                    continue

                value = self._to_float(
                    self._row_get(
                        row=row,
                        keys=["exports_value", "export_value", "exportsvalue"],
                        contains_all=["export", "value"],
                        contains_none=["share"],
                    )
                )
                quantity = self._to_float(
                    self._row_get(row=row, keys=["quantity", "qty"], contains_all=["quantity"])
                )
                unit = self._to_str(
                    self._row_get(row=row, keys=["unit", "uom"], contains_all=["unit"])
                )
                description = self._to_str(
                    self._row_get(
                        row=row,
                        keys=["description", "commodity_description", "commodity"],
                        contains_all=["description"],
                    )
                )

                record_key = f"{hs_code}|{partner_country}|{unit or ''}"
                facts.append(
                    {
                        "table_name": "exports_by_commodity_partner",
                        "direction": TradeDirection.EXPORT,
                        "hs_code": hs_code,
                        "commodity_description": description,
                        "partner_country": partner_country,
                        "customs_office": None,
                        "unit": unit,
                        "quantity": quantity,
                        "value_npr_thousands": value or 0.0,
                        "revenue_npr_thousands": None,
                        "cumulative_value_npr_thousands": value,
                        "delta_value_npr_thousands": None,
                        "record_key": record_key,
                        "metadata": {"sheet": sheet_6, "parser_version": "v2"},
                    }
                )

        sheet_9 = next((name for name in xls.sheet_names if name.startswith("9_")), None)
        if sheet_9:
            frame = self._load_trade_frame(
                file_path=file_path,
                sheet_name=sheet_9,
                required_tokens=["customs", "import", "value", "export"],
            )
            for _, row in frame.iterrows():
                customs = self._normalize_customs_office(
                    self._row_get(
                        row=row,
                        keys=["customs", "customs_office", "office", "custom_office"],
                        contains_all=["custom"],
                    )
                )
                if not customs:
                    continue

                imports_value = self._to_float(
                    self._row_get(
                        row=row,
                        keys=["imports_value", "import_value", "importsvalue"],
                        contains_all=["import", "value"],
                        contains_none=["share"],
                    )
                )
                exports_value = self._to_float(
                    self._row_get(
                        row=row,
                        keys=["exports_value", "export_value", "exportsvalue"],
                        contains_all=["export", "value"],
                        contains_none=["share"],
                    )
                )

                if imports_value is not None:
                    facts.append(
                        {
                            "table_name": "customswise_trade",
                            "direction": TradeDirection.IMPORT,
                            "hs_code": None,
                            "commodity_description": None,
                            "partner_country": None,
                            "customs_office": customs,
                            "unit": None,
                            "quantity": None,
                            "value_npr_thousands": imports_value,
                            "revenue_npr_thousands": None,
                            "cumulative_value_npr_thousands": imports_value,
                            "delta_value_npr_thousands": None,
                            "record_key": f"{customs}|import",
                            "metadata": {"sheet": sheet_9, "parser_version": "v2"},
                        }
                    )

                if exports_value is not None:
                    facts.append(
                        {
                            "table_name": "customswise_trade",
                            "direction": TradeDirection.EXPORT,
                            "hs_code": None,
                            "commodity_description": None,
                            "partner_country": None,
                            "customs_office": customs,
                            "unit": None,
                            "quantity": None,
                            "value_npr_thousands": exports_value,
                            "revenue_npr_thousands": None,
                            "cumulative_value_npr_thousands": exports_value,
                            "delta_value_npr_thousands": None,
                            "record_key": f"{customs}|export",
                            "metadata": {"sheet": sheet_9, "parser_version": "v2"},
                        }
                    )

        return report_meta, facts

    def _load_trade_frame(
        self,
        *,
        file_path: Path,
        sheet_name: str,
        required_tokens: list[str],
    ):
        import pandas as pd  # local import to keep module import-safe

        best_score = -1
        best_frame = None

        for header_row in (2, 1, 3, 4):
            frame = pd.read_excel(file_path, sheet_name=sheet_name, header=header_row)
            normalized = [self._normalize_col(str(col)) for col in frame.columns]
            frame.columns = normalized
            score = 0
            for token in required_tokens:
                if any(token in col for col in normalized):
                    score += 1

            if score > best_score:
                best_score = score
                best_frame = frame

            if score >= max(3, len(required_tokens) - 1):
                break

        if best_frame is None:
            return pd.DataFrame()
        return best_frame

    @staticmethod
    def _row_get(
        *,
        row,
        keys: list[str],
        contains_all: list[str] | None = None,
        contains_none: list[str] | None = None,
    ) -> Any:
        for key in keys:
            if key in row.index:
                value = row[key]
                if TradeIngestionService._to_str(value) is not None:
                    return value

        if contains_all:
            for col in row.index:
                label = str(col).lower()
                if not all(token in label for token in contains_all):
                    continue
                if contains_none and any(token in label for token in contains_none):
                    continue
                value = row[col]
                if TradeIngestionService._to_str(value) is not None:
                    return value
        return None

    @staticmethod
    def _normalize_col(column: str) -> str:
        col = column.strip().lower()
        col = re.sub(r"[^a-z0-9]+", "_", col)
        return col.strip("_")

    @staticmethod
    def _to_float(value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        text = str(value).strip().replace(",", "")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None

    @staticmethod
    def _to_str(value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text or text.lower() == "nan":
            return None
        return text

    @staticmethod
    def _normalize_hs_code(value: Any) -> str | None:
        text = TradeIngestionService._to_str(value)
        if text is None:
            return None

        cleaned = text.replace(",", "")
        if re.fullmatch(r"\d+(\.0+)?", cleaned):
            digits = cleaned.split(".", 1)[0]
        else:
            digits = "".join(ch for ch in cleaned if ch.isdigit())

        if not digits:
            return None

        if len(digits) < 8:
            digits = digits.zfill(8)
        return digits

    @staticmethod
    def _normalize_partner_country(value: Any) -> str | None:
        text = TradeIngestionService._to_str(value)
        if text is None:
            return None
        normalized = re.sub(r"\s+", " ", text).strip(" -")
        lowered = normalized.lower()
        if lowered in {"total", "grand total", "sub total", "subtotal"}:
            return None
        return normalized

    @staticmethod
    def _normalize_customs_office(value: Any) -> str | None:
        text = TradeIngestionService._to_str(value)
        if text is None:
            return None
        normalized = re.sub(r"\s+", " ", text).strip(" -")
        lowered = normalized.lower()
        if "total" in lowered:
            return None
        return normalized

    @staticmethod
    def _apply_trade_filters_to_statement(
        stmt,
        *,
        fiscal_year_bs: str | None = None,
        direction: TradeDirection | None = None,
        partner_country: str | None = None,
        customs_office: str | None = None,
        hs_prefix: str | None = None,
    ):
        if fiscal_year_bs:
            stmt = stmt.where(TradeReport.fiscal_year_bs == fiscal_year_bs)
        if direction:
            stmt = stmt.where(TradeFact.direction == direction)
        if partner_country:
            stmt = stmt.where(func.lower(TradeFact.partner_country) == partner_country.strip().lower())
        if customs_office:
            stmt = stmt.where(func.lower(TradeFact.customs_office) == customs_office.strip().lower())
        if hs_prefix:
            stmt = stmt.where(TradeFact.hs_code.like(f"{hs_prefix.strip()}%"))
        return stmt

    @staticmethod
    def _slugify(text: str) -> str:
        value = text.strip().lower()
        value = re.sub(r"[^a-z0-9]+", "_", value)
        return value.strip("_")

    @staticmethod
    def _fy_sort_key(fiscal_year_bs: str) -> int:
        try:
            return int(fiscal_year_bs.split("-")[0])
        except Exception:
            return 0

    @staticmethod
    def _sha256_file(file_path: Path) -> str:
        hasher = hashlib.sha256()
        with file_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        return hasher.hexdigest()
