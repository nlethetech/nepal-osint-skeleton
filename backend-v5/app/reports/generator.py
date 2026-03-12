"""
NARADA Corporate Intelligence PDF Report Generator.

Uses fpdf2 for pure-Python PDF generation. Produces classified-style
dossier reports with NARADA branding, structured data sections,
risk severity coloring, and TLP markings.
"""
import io
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fpdf import FPDF
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.corporate_intel_service import CorporateIntelService

logger = logging.getLogger(__name__)


# ── Color palette (Palantir-dark report theme) ───────────────────

class Colors:
    """RGB color tuples for report styling."""
    HEADER_BG = (15, 15, 20)        # Near-black header
    HEADER_TEXT = (232, 232, 234)    # Off-white
    SECTION_BG = (25, 25, 32)       # Dark section header
    SECTION_TEXT = (180, 180, 190)   # Light gray
    BODY_TEXT = (50, 50, 55)         # Dark body text for readability
    LABEL = (100, 100, 110)         # Muted labels
    RISK_HIGH = (200, 50, 50)       # Red
    RISK_MEDIUM = (200, 160, 20)    # Amber
    RISK_LOW = (80, 130, 200)       # Blue
    TABLE_HEADER_BG = (35, 35, 45)  # Dark table header
    TABLE_HEADER_TEXT = (200, 200, 210)
    TABLE_ROW_EVEN = (245, 245, 248)
    TABLE_ROW_ODD = (255, 255, 255)
    BORDER = (180, 180, 190)
    TLP_GREEN = (30, 130, 76)
    CLASSIFIED = (200, 50, 50)


class NaradaPDF(FPDF):
    """Custom FPDF subclass with NARADA branding."""

    def __init__(self, report_title: str = "Intelligence Report", tlp: str = "TLP:GREEN"):
        super().__init__()
        self.report_title = report_title
        self.tlp = tlp
        self._setup_fonts()
        self.set_auto_page_break(auto=True, margin=25)

    def _setup_fonts(self):
        """Configure built-in fonts (Helvetica family)."""
        # fpdf2 has Helvetica built-in; no need to add external fonts
        pass

    def header(self):
        """Render NARADA header on every page."""
        # Dark header bar
        self.set_fill_color(*Colors.HEADER_BG)
        self.rect(0, 0, 210, 22, "F")

        # NARADA branding
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(*Colors.HEADER_TEXT)
        self.set_xy(10, 4)
        self.cell(0, 7, "NARADA", new_x="LMARGIN")

        # Report title
        self.set_font("Helvetica", "", 9)
        self.set_text_color(150, 150, 160)
        self.set_xy(10, 12)
        self.cell(0, 6, self.report_title, new_x="LMARGIN")

        # Classification marking (right side)
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(*Colors.CLASSIFIED)
        self.set_xy(130, 4)
        self.cell(70, 7, "CLASSIFIED - INTERNAL USE ONLY", align="R", new_x="LMARGIN")

        # TLP marking
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*Colors.TLP_GREEN)
        self.set_xy(130, 12)
        self.cell(70, 6, self.tlp, align="R", new_x="LMARGIN")

        self.ln(24)

    def footer(self):
        """Render page footer."""
        self.set_y(-18)

        # Separator line
        self.set_draw_color(*Colors.BORDER)
        self.line(10, self.get_y(), 200, self.get_y())

        # Footer text
        self.set_font("Helvetica", "", 7)
        self.set_text_color(*Colors.LABEL)
        self.set_y(-15)
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        self.cell(0, 8, f"Generated: {now_str}", new_x="LMARGIN")
        self.set_y(-15)
        self.cell(0, 8, f"Page {self.page_no()}/{{nb}}", align="C", new_x="LMARGIN")
        self.set_y(-15)
        self.cell(0, 8, "NARADA Intelligence Platform", align="R", new_x="LMARGIN")

    def section_header(self, title: str):
        """Render a dark section header bar."""
        self.ln(4)
        self.set_fill_color(*Colors.SECTION_BG)
        self.set_text_color(*Colors.SECTION_TEXT)
        self.set_font("Helvetica", "B", 11)
        self.cell(0, 9, f"  {title}", fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(3)

    def key_value(self, key: str, value: str, key_width: float = 55):
        """Render a label: value pair."""
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*Colors.LABEL)
        x = self.get_x()
        y = self.get_y()
        self.cell(key_width, 6, key, new_x="END")
        self.set_font("Helvetica", "", 9)
        self.set_text_color(*Colors.BODY_TEXT)
        # Truncate long values to avoid overflow
        max_chars = 90
        display_val = value if len(value) <= max_chars else value[:max_chars] + "..."
        self.cell(0, 6, display_val, new_x="LMARGIN", new_y="NEXT")

    def risk_tag(self, severity: str, description: str):
        """Render a colored risk flag tag."""
        color_map = {
            "HIGH": Colors.RISK_HIGH,
            "MEDIUM": Colors.RISK_MEDIUM,
            "LOW": Colors.RISK_LOW,
        }
        color = color_map.get(severity.upper(), Colors.RISK_LOW)

        # Severity badge
        self.set_fill_color(*color)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 8)
        badge_w = 18
        self.cell(badge_w, 6, severity.upper(), fill=True, align="C", new_x="END")
        self.cell(3, 6, "", new_x="END")  # spacer

        # Description
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*Colors.BODY_TEXT)
        # Truncate
        desc = description if len(description) <= 100 else description[:100] + "..."
        self.cell(0, 6, desc, new_x="LMARGIN", new_y="NEXT")
        self.ln(1)

    def data_table(self, headers: list[str], rows: list[list[str]], col_widths: Optional[list[float]] = None):
        """Render a data table with alternating row colors."""
        if not col_widths:
            available = 190
            col_widths = [available / len(headers)] * len(headers)

        # Header row
        self.set_fill_color(*Colors.TABLE_HEADER_BG)
        self.set_text_color(*Colors.TABLE_HEADER_TEXT)
        self.set_font("Helvetica", "B", 8)
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 7, h, border=1, fill=True, new_x="END")
        self.ln()

        # Data rows
        self.set_font("Helvetica", "", 8)
        for row_idx, row in enumerate(rows):
            if row_idx % 2 == 0:
                self.set_fill_color(*Colors.TABLE_ROW_EVEN)
            else:
                self.set_fill_color(*Colors.TABLE_ROW_ODD)
            self.set_text_color(*Colors.BODY_TEXT)

            # Check for page break
            if self.get_y() > 260:
                self.add_page()

            for i, cell_val in enumerate(row):
                # Truncate to fit column
                max_chars = int(col_widths[i] / 2.2)
                display = cell_val if len(cell_val) <= max_chars else cell_val[:max_chars] + ".."
                self.cell(col_widths[i], 6, display, border=1, fill=True, new_x="END")
            self.ln()


class ReportGenerator:
    """
    Generates PDF intelligence reports using corporate data from the database.

    Reports are generated synchronously (PDF bytes returned) and should be
    called from async endpoints via the service layer.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.service = CorporateIntelService(db)

    # ── Entity Dossier ────────────────────────────────────────────

    async def generate_entity_dossier(self, company_id: UUID) -> Optional[bytes]:
        """
        Generate a comprehensive entity dossier PDF for a single company.

        Includes: company profile, PAN info, IRD tax status, directors,
        risk flags, shared director network.

        Returns PDF bytes or None if company not found.
        """
        detail = await self.service.get_company_detail(company_id)
        if not detail:
            return None

        company = detail["company"]
        directors = detail["directors"]
        ird = detail.get("ird_enrichment")
        risk_flags = detail.get("risk_flags", [])

        # Also fetch shared directors
        shared = await self.service.find_shared_directors(company_id)

        company_name = company.get("name_english", "Unknown Entity")
        pdf = NaradaPDF(report_title=f"Entity Dossier: {company_name}")
        pdf.alias_nb_pages()
        pdf.add_page()

        # ── Title block ──
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(*Colors.BODY_TEXT)
        pdf.cell(0, 10, "ENTITY DOSSIER", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*Colors.LABEL)
        pdf.cell(0, 6, f"Subject: {company_name}", new_x="LMARGIN", new_y="NEXT")
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 6, f"Generated: {now_str}", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

        # ── Company Profile ──
        pdf.section_header("COMPANY PROFILE")
        pdf.key_value("Name (English):", company.get("name_english", "N/A"))
        pdf.key_value("Name (Nepali):", company.get("name_nepali") or "N/A")
        pdf.key_value("Reg. Number:", str(company.get("registration_number", "N/A")))
        pdf.key_value("Reg. Date (BS):", company.get("registration_date_bs") or "N/A")
        pdf.key_value("Reg. Date (AD):", company.get("registration_date_ad") or "N/A")
        pdf.key_value("Type:", company.get("company_type") or "N/A")
        pdf.key_value("Category:", company.get("company_type_category") or "N/A")
        pdf.key_value("Address:", company.get("company_address") or "N/A")
        pdf.key_value("District:", company.get("district") or "N/A")
        pdf.key_value("Province:", company.get("province") or "N/A")
        pdf.key_value("PAN:", company.get("pan") or "Not available")
        pdf.key_value("Last OCR Comm.:", company.get("last_communication_bs") or "None recorded")
        pdf.key_value("CAMIS Enriched:", "Yes" if company.get("camis_enriched") else "No")
        pdf.key_value("IRD Enriched:", "Yes" if company.get("ird_enriched") else "No")

        # ── IRD Tax Status ──
        if ird:
            pdf.section_header("IRD TAX STATUS")
            pdf.key_value("PAN:", ird.get("pan", "N/A"))
            pdf.key_value("Taxpayer (EN):", ird.get("taxpayer_name_en") or "N/A")
            pdf.key_value("Taxpayer (NP):", ird.get("taxpayer_name_np") or "N/A")
            pdf.key_value("Account Type:", ird.get("account_type") or "N/A")
            pdf.key_value("Account Status:", ird.get("account_status") or "N/A")
            pdf.key_value("Reg. Date (BS):", ird.get("registration_date_bs") or "N/A")
            pdf.key_value("Tax Office:", ird.get("tax_office") or "N/A")
            pdf.key_value("Ward No.:", ird.get("ward_no") or "N/A")
            pdf.key_value("VDC/Municipality:", ird.get("vdc_municipality") or "N/A")
            pdf.key_value("Tax Clearance FY:", ird.get("latest_tax_clearance_fy") or "N/A")
            clearance = ird.get("tax_clearance_verified")
            clearance_str = "Yes" if clearance is True else ("No" if clearance is False else "N/A")
            pdf.key_value("Clearance Verified:", clearance_str)

        # ── Directors ──
        if directors:
            pdf.section_header(f"DIRECTORS ({len(directors)})")
            headers = ["Name", "Role", "Source", "Confidence", "PAN", "Citizenship"]
            rows = []
            for d in directors:
                rows.append([
                    d.get("name_en", "N/A"),
                    d.get("role") or "N/A",
                    d.get("source", "N/A"),
                    f"{d.get('confidence', 0):.1f}",
                    d.get("pan") or "-",
                    d.get("citizenship_no") or "-",
                ])
            pdf.data_table(headers, rows, col_widths=[50, 25, 22, 22, 35, 36])

        # ── Shared Director Network ──
        if shared and shared.get("shared_links"):
            links = shared["shared_links"]
            pdf.section_header(f"SHARED DIRECTOR NETWORK ({shared.get('unique_linked_companies', 0)} linked companies)")
            headers = ["Director", "Role", "Linked Company", "Linked PAN"]
            rows = []
            for link in links:
                rows.append([
                    link.get("director_name", "N/A"),
                    link.get("director_role") or "N/A",
                    link.get("linked_company_name", "N/A"),
                    link.get("linked_company_pan") or "-",
                ])
            pdf.data_table(headers, rows, col_widths=[50, 25, 75, 40])

        # ── Risk Assessment ──
        pdf.section_header("RISK ASSESSMENT")
        if risk_flags:
            for flag in risk_flags:
                pdf.risk_tag(flag.get("severity", "LOW"), flag.get("description", ""))
        else:
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(*Colors.LABEL)
            pdf.cell(0, 6, "No risk flags detected.", new_x="LMARGIN", new_y="NEXT")

        # Output
        buf = io.BytesIO()
        pdf.output(buf)
        buf.seek(0)
        return buf.getvalue()

    # ── PAN Investigation Report ──────────────────────────────────

    async def generate_pan_report(self, pan: str) -> Optional[bytes]:
        """
        Generate a PAN investigation report.

        Includes: all companies under the PAN, IRD data, directors,
        risk analysis, cross-company indicators.

        Returns PDF bytes or None if no companies found for the PAN.
        """
        result = await self.service.investigate_pan(pan)
        companies = result.get("companies", [])
        if not companies:
            return None

        ird = result.get("ird")
        risk_flags = result.get("risk_flags", [])

        pdf = NaradaPDF(report_title=f"PAN Investigation: {pan}")
        pdf.alias_nb_pages()
        pdf.add_page()

        # ── Title block ──
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(*Colors.BODY_TEXT)
        pdf.cell(0, 10, "PAN INVESTIGATION REPORT", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*Colors.LABEL)
        pdf.cell(0, 6, f"Subject PAN: {pan}", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 6, f"Companies Found: {len(companies)}", new_x="LMARGIN", new_y="NEXT")
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 6, f"Generated: {now_str}", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

        # ── IRD Details ──
        if ird:
            pdf.section_header("IRD TAXPAYER DETAILS")
            pdf.key_value("PAN:", ird.get("pan", "N/A"))
            pdf.key_value("Taxpayer (EN):", ird.get("taxpayer_name_en") or "N/A")
            pdf.key_value("Taxpayer (NP):", ird.get("taxpayer_name_np") or "N/A")
            pdf.key_value("Account Type:", ird.get("account_type") or "N/A")
            pdf.key_value("Account Status:", ird.get("account_status") or "N/A")
            pdf.key_value("Reg. Date (BS):", ird.get("registration_date_bs") or "N/A")
            pdf.key_value("Tax Office:", ird.get("tax_office") or "N/A")
            pdf.key_value("Ward No.:", ird.get("ward_no") or "N/A")
            pdf.key_value("VDC/Municipality:", ird.get("vdc_municipality") or "N/A")
            pdf.key_value("Tax Clearance FY:", ird.get("latest_tax_clearance_fy") or "N/A")
            clearance = ird.get("tax_clearance_verified")
            clearance_str = "Yes" if clearance is True else ("No" if clearance is False else "N/A")
            pdf.key_value("Clearance Verified:", clearance_str)

        # ── Registered Companies ──
        pdf.section_header(f"REGISTERED COMPANIES ({len(companies)})")
        headers = ["Reg. No.", "Name (English)", "Type", "District", "Address"]
        rows = []
        for c in companies:
            rows.append([
                str(c.get("registration_number", "N/A")),
                c.get("name_english", "N/A"),
                c.get("company_type_category") or "N/A",
                c.get("district") or "N/A",
                c.get("company_address") or "N/A",
            ])
        pdf.data_table(headers, rows, col_widths=[22, 60, 28, 30, 50])

        # ── Directors across all companies ──
        # Collect directors from each company detail
        all_directors: list[dict] = []
        seen_director_names: set[str] = set()
        for c in companies:
            company_id = c.get("id")
            if company_id:
                try:
                    detail = await self.service.get_company_detail(UUID(company_id))
                    if detail and detail.get("directors"):
                        for d in detail["directors"]:
                            name = d.get("name_en", "")
                            if name not in seen_director_names:
                                seen_director_names.add(name)
                                d["_company_name"] = c.get("name_english", "N/A")
                                all_directors.append(d)
                except Exception:
                    pass

        if all_directors:
            pdf.section_header(f"DIRECTORS ACROSS COMPANIES ({len(all_directors)})")
            headers = ["Name", "Role", "Company", "Source", "PAN"]
            rows = []
            for d in all_directors:
                rows.append([
                    d.get("name_en", "N/A"),
                    d.get("role") or "N/A",
                    d.get("_company_name", "N/A"),
                    d.get("source", "N/A"),
                    d.get("pan") or "-",
                ])
            pdf.data_table(headers, rows, col_widths=[45, 25, 55, 25, 40])

        # ── Risk Assessment ──
        pdf.section_header("RISK ASSESSMENT")
        if risk_flags:
            for flag in risk_flags:
                pdf.risk_tag(flag.get("severity", "LOW"), flag.get("description", ""))
        else:
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(*Colors.LABEL)
            pdf.cell(0, 6, "No risk flags detected.", new_x="LMARGIN", new_y="NEXT")

        # ── Analysis Summary ──
        pdf.section_header("ANALYSIS SUMMARY")
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(*Colors.BODY_TEXT)

        high_count = sum(1 for f in risk_flags if f.get("severity") == "HIGH")
        medium_count = sum(1 for f in risk_flags if f.get("severity") == "MEDIUM")
        low_count = sum(1 for f in risk_flags if f.get("severity") == "LOW")

        pdf.key_value("Total Companies:", str(len(companies)))
        pdf.key_value("Total Directors:", str(len(all_directors)))
        pdf.key_value("HIGH Risk Flags:", str(high_count))
        pdf.key_value("MEDIUM Risk Flags:", str(medium_count))
        pdf.key_value("LOW Risk Flags:", str(low_count))

        if len(companies) > 1:
            pdf.ln(3)
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*Colors.RISK_HIGH)
            pdf.cell(0, 6,
                     f"WARNING: Multiple companies ({len(companies)}) registered under the same PAN.",
                     new_x="LMARGIN", new_y="NEXT")

        # Output
        buf = io.BytesIO()
        pdf.output(buf)
        buf.seek(0)
        return buf.getvalue()

    # ── Risk Summary Report ───────────────────────────────────────

    async def generate_risk_report(self) -> bytes:
        """
        Generate a comprehensive risk summary report across all companies.

        Includes: all risk flags sorted by severity, statistics by category,
        top offenders.

        Always returns PDF bytes (may be a report with zero flags).
        """
        # Fetch risk flags at all severity levels
        result = await self.service.get_risk_flags(
            min_severity="LOW",
            page=1,
            limit=200,  # top 200 flagged companies
        )
        items = result.get("items", [])
        total = result.get("total", 0)

        # Also get dashboard stats for context
        stats = await self.service.get_corporate_stats()

        pdf = NaradaPDF(report_title="Corporate Risk Summary")
        pdf.alias_nb_pages()
        pdf.add_page()

        # ── Title block ──
        pdf.set_font("Helvetica", "B", 16)
        pdf.set_text_color(*Colors.BODY_TEXT)
        pdf.cell(0, 10, "CORPORATE RISK SUMMARY", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*Colors.LABEL)
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        pdf.cell(0, 6, f"Generated: {now_str}", new_x="LMARGIN", new_y="NEXT")
        pdf.cell(0, 6, f"Total Flagged Companies: {total}", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(4)

        # ── Corporate Landscape ──
        pdf.section_header("CORPORATE LANDSCAPE")
        pdf.key_value("Total Companies:", f"{stats.get('total_companies', 0):,}")
        pdf.key_value("Companies with PAN:", f"{stats.get('companies_with_pan', 0):,}")
        pdf.key_value("PAN Coverage:", f"{stats.get('pan_coverage_pct', 0):.1f}%")
        pdf.key_value("IRD Enriched:", f"{stats.get('ird_enriched_count', 0):,}")
        pdf.key_value("IRD Coverage:", f"{stats.get('ird_enrichment_pct', 0):.1f}%")
        pdf.key_value("Total Directors:", f"{stats.get('total_directors', 0):,}")

        # Risk summary stats
        risk_summary = stats.get("risk_summary", {})
        pdf.ln(2)
        pdf.key_value("Non-Filer Companies:", str(risk_summary.get("non_filer_companies", 0)))
        pdf.key_value("Suspicious Address Clusters:", str(risk_summary.get("suspicious_address_clusters", 0)))
        pdf.key_value("Shared PAN Groups:", str(risk_summary.get("shared_pan_groups", 0)))

        # ── Risk Statistics ──
        pdf.section_header("RISK FLAG STATISTICS")
        all_flags: list[dict] = []
        for item in items:
            for flag in item.get("risk_flags", []):
                all_flags.append(flag)

        # Count by severity
        severity_counts = {"HIGH": 0, "MEDIUM": 0, "LOW": 0}
        category_counts: dict[str, int] = {}
        for f in all_flags:
            sev = f.get("severity", "LOW")
            severity_counts[sev] = severity_counts.get(sev, 0) + 1
            cat = f.get("category", "unknown")
            category_counts[cat] = category_counts.get(cat, 0) + 1

        pdf.key_value("HIGH Severity Flags:", str(severity_counts.get("HIGH", 0)))
        pdf.key_value("MEDIUM Severity Flags:", str(severity_counts.get("MEDIUM", 0)))
        pdf.key_value("LOW Severity Flags:", str(severity_counts.get("LOW", 0)))
        pdf.ln(2)

        if category_counts:
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_text_color(*Colors.LABEL)
            pdf.cell(0, 6, "By Category:", new_x="LMARGIN", new_y="NEXT")
            for cat, cnt in sorted(category_counts.items(), key=lambda x: -x[1]):
                pdf.key_value(f"  {cat}:", str(cnt))

        # ── Flagged Companies Table ──
        if items:
            # HIGH severity first
            high_items = [i for i in items if any(f.get("severity") == "HIGH" for f in i.get("risk_flags", []))]
            medium_items = [i for i in items if
                           any(f.get("severity") == "MEDIUM" for f in i.get("risk_flags", []))
                           and i not in high_items]
            low_items = [i for i in items if i not in high_items and i not in medium_items]

            for label, group in [("HIGH SEVERITY", high_items), ("MEDIUM SEVERITY", medium_items), ("LOW SEVERITY", low_items)]:
                if not group:
                    continue

                pdf.section_header(f"{label} FLAGS ({len(group)} companies)")
                headers = ["Company", "PAN", "District", "Risk Flags"]
                rows = []
                for item in group[:50]:  # cap at 50 per section
                    company = item.get("company", {})
                    flags = item.get("risk_flags", [])
                    flag_desc = "; ".join(f.get("description", "")[:40] for f in flags)
                    rows.append([
                        company.get("name_english", "N/A"),
                        company.get("pan") or "-",
                        company.get("district") or "N/A",
                        flag_desc,
                    ])
                pdf.data_table(headers, rows, col_widths=[55, 30, 30, 75])
        else:
            pdf.section_header("FLAGGED COMPANIES")
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(*Colors.LABEL)
            pdf.cell(0, 6, "No risk flags detected across the corporate registry.", new_x="LMARGIN", new_y="NEXT")

        # Output
        buf = io.BytesIO()
        pdf.output(buf)
        buf.seek(0)
        return buf.getvalue()
