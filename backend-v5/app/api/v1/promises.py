"""API routes for manifesto promise tracking."""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, require_dev
from app.models.promise import ManifestoPromise

router = APIRouter(prefix="/promises", tags=["promises"])


class PromiseOut(BaseModel):
    id: str
    promise_id: str
    party: str
    election_year: str
    category: str
    promise: str
    detail: Optional[str] = None
    source: Optional[str] = None
    status: str
    status_detail: Optional[str] = None
    evidence_urls: Optional[str] = None
    last_checked_at: Optional[str] = None
    status_changed_at: Optional[str] = None

    class Config:
        from_attributes = True


class PromiseStatusUpdate(BaseModel):
    status: str
    status_detail: Optional[str] = None
    evidence_urls: Optional[str] = None


class PromiseBulkIngest(BaseModel):
    """Bulk ingest from local agent."""
    updates: list[dict]  # [{promise_id, status, status_detail, evidence_urls}]


@router.get("", response_model=list[PromiseOut])
async def list_promises(
    party: str = Query("RSP"),
    election_year: str = Query("2082"),
    category: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List all manifesto promises, optionally filtered."""
    q = select(ManifestoPromise).where(
        ManifestoPromise.party == party,
        ManifestoPromise.election_year == election_year,
    ).order_by(ManifestoPromise.promise_id)

    if category:
        q = q.where(ManifestoPromise.category == category)
    if status:
        q = q.where(ManifestoPromise.status == status)

    result = await db.execute(q)
    rows = result.scalars().all()
    return [
        PromiseOut(
            id=str(r.id),
            promise_id=r.promise_id,
            party=r.party,
            election_year=r.election_year,
            category=r.category,
            promise=r.promise,
            detail=r.detail,
            source=r.source,
            status=r.status,
            status_detail=r.status_detail,
            evidence_urls=r.evidence_urls,
            last_checked_at=r.last_checked_at.isoformat() if r.last_checked_at else None,
            status_changed_at=r.status_changed_at.isoformat() if r.status_changed_at else None,
        )
        for r in rows
    ]


@router.get("/summary")
async def promise_summary(
    party: str = Query("RSP"),
    election_year: str = Query("2082"),
    db: AsyncSession = Depends(get_db),
):
    """Summary stats for promise tracker widget."""
    q = select(ManifestoPromise).where(
        ManifestoPromise.party == party,
        ManifestoPromise.election_year == election_year,
    )
    result = await db.execute(q)
    rows = result.scalars().all()

    by_status: dict[str, int] = {}
    by_category: dict[str, int] = {}
    for r in rows:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        by_category[r.category] = by_category.get(r.category, 0) + 1

    return {
        "total": len(rows),
        "by_status": by_status,
        "by_category": by_category,
        "promises": [
            {
                "promise_id": r.promise_id,
                "category": r.category,
                "promise": r.promise,
                "detail": r.detail,
                "source": r.source,
                "status": r.status,
                "status_detail": r.status_detail,
                "evidence_urls": r.evidence_urls,
                "last_checked_at": r.last_checked_at.isoformat() if r.last_checked_at else None,
                "status_changed_at": r.status_changed_at.isoformat() if r.status_changed_at else None,
            }
            for r in rows
        ],
    }


@router.post("/ingest")
async def ingest_promise_updates(
    payload: PromiseBulkIngest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_dev),
):
    """Bulk update promise statuses from local agent."""
    from datetime import datetime, timezone

    updated = 0
    for u in payload.updates:
        pid = u.get("promise_id")
        if not pid:
            continue

        result = await db.execute(
            select(ManifestoPromise).where(ManifestoPromise.promise_id == pid)
        )
        promise = result.scalar_one_or_none()
        if not promise:
            continue

        old_status = promise.status
        new_status = u.get("status", old_status)

        promise.status = new_status
        if u.get("status_detail"):
            promise.status_detail = u["status_detail"]
        if u.get("evidence_urls"):
            promise.evidence_urls = u["evidence_urls"]
        promise.last_checked_at = datetime.now(timezone.utc)
        if new_status != old_status:
            promise.status_changed_at = datetime.now(timezone.utc)
        updated += 1

    await db.commit()
    return {"updated": updated, "total": len(payload.updates)}


@router.put("/{promise_id}", dependencies=[Depends(require_dev)])
async def update_single_promise(
    promise_id: str,
    body: PromiseStatusUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a single promise status (dev console)."""
    from datetime import datetime, timezone

    result = await db.execute(
        select(ManifestoPromise).where(ManifestoPromise.promise_id == promise_id)
    )
    promise = result.scalar_one_or_none()
    if not promise:
        raise HTTPException(404, f"Promise {promise_id} not found")

    old_status = promise.status
    promise.status = body.status
    if body.status_detail is not None:
        promise.status_detail = body.status_detail
    if body.evidence_urls is not None:
        promise.evidence_urls = body.evidence_urls
    promise.last_checked_at = datetime.now(timezone.utc)
    if body.status != old_status:
        promise.status_changed_at = datetime.now(timezone.utc)

    await db.commit()
    return {
        "promise_id": promise_id,
        "old_status": old_status,
        "new_status": body.status,
        "updated": True,
    }


@router.post("/seed")
async def seed_promises(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_dev),
):
    """Seed initial RSP manifesto promises (idempotent)."""
    from uuid import uuid4

    # ── VERIFIED against RSP Manifesto (वाचा पत्र 2082) PDF, all 100 points ──
    # Each entry: (promise_id, category, title, detail, source_reference)
    SEED_DATA = [
        # ═══ GOVERNANCE (G1-G11) ═══
        ("G1", "Governance", "Constitutional amendment discussion paper", "Prepare a 'discussion paper' (बहस पत्र) for national consensus on constitutional amendments. Topics: directly elected executive, proportional parliament, MPs not becoming ministers, non-partisan local government, reformed provinces.", "Point 10"),
        ("G2", "Governance", "Limit federal ministries to 18 with expert ministers", "Cap ministries at 18. Establish specialist (विज्ञ) ministers and expertise-based civil service administration.", "Point 17"),
        ("G3", "Governance", "Party leader term limited to two terms", "Party president cannot hold top position for more than two consecutive terms. Annual public funding to parties based on vote share.", "Point 15"),
        ("G4", "Governance", "Reform National Planning Commission into think-tank", "Transform NPC into modern policy research, data, and monitoring-focused think-tank.", "Point 18"),
        ("G5", "Governance", "Professionalize civil service, end political unions", "Abolish partisan trade unions in civil service. Make administration fully professional, impartial, and accountable.", "Point 7"),
        ("G6", "Governance", "End nepotism in personal secretary appointments", "Bar officials from appointing family members to positions like personal secretary (स्वकीय सचिव).", "Point 16"),
        ("G7", "Governance", "Classify & reform public institutions", "Classify public enterprises: merge some, PPP for some, strategic partners for others, decentralize or transfer assets.", "Point 26"),
        ("G8", "Governance", "Mission-mode (मिसन मोड) public organizations", "Run public projects with clear objectives, fixed budgets, time limits, qualified HR, and results-based targets.", "Point 27"),
        ("G9", "Governance", "Gen-Z civic engagement & youth in governance", "Formal Gen-Z engagement. Recognize 2082 Bhadra 23-24 youth movement. Include youth in policy-making bodies.", "Point 2"),
        ("G10", "Governance", "Depoliticize civil service trade unions", "Replace partisan trade unions (दलगत ट्रेड युनियन) with professional, merit-based employee representation.", "Point 6"),
        ("G11", "Governance", "Mandatory digital audit trail for all government decisions", "Every administrative decision requires proper digital process trail. End informal influence on government decisions.", "Point 8"),
        # ═══ ANTI-CORRUPTION (AC1-AC6) ═══
        ("AC1", "Anti-Corruption", "Mandatory asset disclosure before and after office", "Full asset disclosure before taking office and independent audit after term ends, for officials and families.", "Point 16"),
        ("AC2", "Anti-Corruption", "Digital governance with mandatory e-signatures", "Make digital signatures legally mandatory. Digitize tippani.gov.np and paripatra.gov.np. End paper-based routing.", "Point 5"),
        ("AC3", "Anti-Corruption", "Amend CIAA Act 2048, Constitutional Council Act 2066, Judicial Council Act 2073", "Strengthen independence of constitutional bodies by amending governing acts for capacity, jurisdiction, governance.", "Point 11"),
        ("AC4", "Anti-Corruption", "Political party funding from public funds", "Annual public funding to parties based on vote share. Reform Political Party Act. Cap party leader tenure.", "Point 15"),
        ("AC5", "Anti-Corruption", "End cartel pricing via independent regulators", "Create politically independent, professional regulators to eliminate cartel pricing, rent-seeking, regulatory capture.", "Point 20"),
        ("AC6", "Anti-Corruption", "Build zero-tolerance anti-corruption party culture", "Every party member practices integrity (नम्रता, परिश्रम, सेवा, जवाफदेहिता). Zero tolerance for corruption.", "Point 100"),
        # ═══ JUDICIARY (J1-J6) ═══
        ("J1", "Judiciary", "Merit-based judicial appointments", "End political influence in Supreme/High Court appointments. Shift to meritocracy and competitive system.", "Point 13"),
        ("J2", "Judiciary", "Clear judicial backlog, amend Judicial Code 2046", "Fast-track pending transitional justice cases. Implement Judicial Code of 2046 immediately.", "Point 12"),
        ("J3", "Judiciary", "Study live broadcast of court proceedings", "Study options for live or recorded broadcasting of court proceedings for judicial transparency.", "Point 14"),
        ("J4", "Judiciary", "Define usury as economic crime", "Classify meter-byaj (usury) and unfair financial transactions as economic crimes. Dismantle networks in 5 years.", "Point 32"),
        ("J5", "Judiciary", "End caste-based discrimination via enforcement", "Address historical injustice against Dalits through state policy, legal reform, and active enforcement.", "Point 1"),
        ("J6", "Judiciary", "Revenue judiciary and state auditor reform", "Modernize revenue courts and state audit. Strengthen financial accountability in government.", "Point 25"),
        # ═══ ECONOMY (E1-E9) ═══
        ("E1", "Economy", "$3,000 per-capita income and $100B economy", "Per-capita $3,000, economy $100B, 7% real annual growth. Nepal Production Fund (नेपाल उत्पादन कोष).", "Citizen Contract \u00a72, Point 19"),
        ("E2", "Economy", "Progressive tax reform to reduce middle-class burden", "Review family burden (पारिवारिक भार) tax threshold. End retroactive tax rules. Enforce against evasion.", "Point 22"),
        ("E3", "Economy", "Create 12 lakh new formal jobs", "Generate 1.2M new jobs in IT, construction, tourism, agriculture, mining, sports, trade.", "Citizen Contract \u00a73"),
        ("E4", "Economy", "Break cartels and monopolies", "Build independent regulators to eliminate cartel pricing, rent-seeking, regulatory capture.", "Point 20"),
        ("E5", "Economy", "Review Indian rupee peg policy", "Study with international experts on decades-old fixed NPR-INR exchange rate policy.", "Point 23"),
        ("E6", "Economy", "Production-oriented economy, end remittance dependence", "Shift from remittance-dependent consumption to production & export model. 30% of NPF from formal employment.", "Point 19, 21"),
        ("E7", "Economy", "National Economic Reform Commission", "Create Nepal Economic Reform Commission (NERC) to address 12-year economic stagnation. Industry-Commerce Federation.", "Point 28"),
        ("E8", "Economy", "Mining & mineral industry development", "Expand mining based on demand and export. Amend Mining Act 2076. Public-private partnerships in minerals.", "Point 60"),
        ("E9", "Economy", "Export electricity, agriculture & AI computation", "Export not just raw electricity but AI/computation power, leveraging cold climate for data centers.", "Point 39"),
        # ═══ DIGITAL & IT (D1-D7) ═══
        ("D1", "Digital & IT", "National digital ID for all citizens", "Issue national identity card to every citizen. Unified database linked to all government services.", "Point 4"),
        ("D2", "Digital & IT", "Digitize tippani.gov.np & paripatra.gov.np", "All government memos and directives issued and tracked digitally.", "Point 5"),
        ("D3", "Digital & IT", "Complete government file digitization", "End manual file routing. Every file tracked digitally with process audit trail (प्रक्रिया लेखाजोखा).", "Point 9"),
        ("D4", "Digital & IT", "Digital Parks in all 7 provinces, $30B IT export", "IT as national strategic industry. Digital parks in 7 provinces. IT exports from $1.5B to $30B in 10 years.", "Point 36"),
        ("D5", "Digital & IT", "Digital infrastructure & cybersecurity framework", "Data centers, cloud, AI compute, cybersecurity laws, privacy framework, high-speed connectivity nationwide.", "Point 37"),
        ("D6", "Digital & IT", "International payment gateway & Digital-First", "Remove barriers for startups to access international payment gateways. Digital-First nation transformation.", "Point 38"),
        ("D7", "Digital & IT", "All citizen services via digital platform", "Government-to-citizen services online. End queueing at offices. Digital permits, tourism, and e-governance.", "Point 52"),
        # ═══ FINANCIAL SECTOR (F1-F5) ═══
        ("F1", "Financial Sector", "Cooperative & microfinance regulation under NRB", "Bring cooperatives/microfinance with 50Cr+ transactions under Nepal Rastra Bank supervision.", "Points 29, 30"),
        ("F2", "Financial Sector", "NEPSE restructuring & capital market reform", "Restructure NEPSE and CDS. Increase private sector share. Competitive depository services. Insider trading rules.", "Point 33"),
        ("F3", "Financial Sector", "Grow institutional investors", "Expand pension funds, insurance, mutual funds. Insider trading regulation. International-standard exchange.", "Point 34"),
        ("F4", "Financial Sector", "Depositor & small saver protection", "Unified savings protection fund (एकीकृत बचत सुरक्षा कोष). Protect depositors from cooperative/bank failures.", "Point 31"),
        ("F5", "Financial Sector", "Energy sector debt cleanup", "Clean up energy sector NPA. Restructure hydropower investment. Sustainable energy financing framework.", "Point 30"),
        # ═══ AGRICULTURE (AG1-AG3) ═══
        ("AG1", "Agriculture", "Agricultural sustainability & food sovereignty", "Food security through sustainable farming. Organic agriculture. Land-use planning. Crop insurance.", "Point 41"),
        ("AG2", "Agriculture", "Agricultural import substitution", "Replace agricultural imports with domestic production. Cold storage, processing, and marketing infrastructure.", "Point 42"),
        ("AG3", "Agriculture", "Agricultural modernization & irrigation", "Modern irrigation. Mechanized farming. Research and seed technology. Fertilizer reform. Cooperative credit.", "Point 43"),
        # ═══ ENERGY (EN1-EN5) ═══
        ("EN1", "Energy", "15,000 MW installed hydropower capacity", "15,000 MW installed capacity. Smart National Grid. Nepal as regional energy export hub.", "Citizen Contract \u00a74, Point 44"),
        ("EN2", "Energy", "30,000 MW grid target & provincial energy centers", "30,000 km grid backbone. Provincial energy export centers. 10 strategic signature hydropower projects.", "Point 44"),
        ("EN3", "Energy", "10-year comprehensive energy development plan", "Integrated energy plan: hydro, solar, wind. Long-term infrastructure investment. Clean energy transition.", "Point 45"),
        ("EN4", "Energy", "Grow per-capita electricity consumption to 1500 kWh", "Domestic electrification via industrial parks, EVs, electric cooking. 2035 target: 1500 kWh per capita.", "Point 46"),
        ("EN5", "Energy", "Energy export diplomacy with India & Bangladesh", "Cross-border energy trade. Regional energy market access. Nepal as South Asian energy hub.", "Point 47"),
        # ═══ TOURISM & CULTURE (TM1-TM6) ═══
        ("TM1", "Tourism & Culture", "Double tourism arrivals & per-tourist spending", "Increase tourist numbers and spending. Diversify beyond trekking: cultural, religious, wellness tourism.", "Point 48"),
        ("TM2", "Tourism & Culture", "Pokhara & Bhairahawa airports to international standard", "Full international-standard airports. Reduce domestic airfare via competition. New terminal infrastructure.", "Point 49"),
        ("TM3", "Tourism & Culture", "Lumbini as world-class Buddhist pilgrimage center", "Develop Lumbini globally. Ram-Janaki and religious-cultural circuits. Heritage preservation.", "Point 50"),
        ("TM4", "Tourism & Culture", "Mountain tourism & Everest academy", "Adventure/mountaineering academy (माउन्टेन स्कुल). High-altitude medical research. Climate partnerships.", "Point 51"),
        ("TM5", "Tourism & Culture", "Sports professionalization & athlete pension", "Professional sports leagues. International training. Kheladi Pension Kosh (athlete pension fund).", "Point 68"),
        ("TM6", "Tourism & Culture", "Sports infrastructure in all 7 provinces", "Multi-purpose sports facilities in every province. School Sports curriculum. Community programs.", "Point 69"),
        # ═══ EDUCATION (ED1-ED7) ═══
        ("ED1", "Education", "Free universities from political interference", "Ban political activities on campuses. Protect academic freedom. End student union violence.", "Point 61"),
        ("ED2", "Education", "Public education quality overhaul", "Fundamental reform: competitive with private sector. Teacher accountability and continuous training.", "Point 62"),
        ("ED3", "Education", "Private school regulation & fee control", "Regulate private school fees and quality. Equal standards across public and private institutions.", "Point 63"),
        ("ED4", "Education", "Every child's right to early development access", "Universal early childhood development centers. Comprehensive child rights protection.", "Point 64"),
        ("ED5", "Education", "Teacher merit-based evaluation & development", "Merit-based teacher appointments/promotions. Continuous professional development. End patronage hiring.", "Point 65"),
        ("ED6", "Education", "Higher education & research reform", "Transform universities into research institutions. International partnerships. Competitive programs.", "Point 66"),
        ("ED7", "Education", "National Knowledge Bank for diaspora expertise", "Connect diaspora students and professionals. Establish National Knowledge Bank (राष्ट्रिय ज्ञान बैंक).", "Point 67"),
        # ═══ HEALTH (H1-H8) ═══
        ("H1", "Health", "Minimum health service standards nationwide", "Ensure न्यूनतम मापदण्ड (minimum standards) across all districts including remote areas.", "Point 70"),
        ("H2", "Health", "Universal health insurance expansion", "Strengthen and expand health insurance to every citizen. Increase health budget priority.", "Citizen Contract \u00a72, Point 71"),
        ("H3", "Health", "Preventive health over curative approach", "Shift to prevention-focused policy. Community health programs. Reduce lifestyle diseases.", "Point 72"),
        ("H4", "Health", "Emergency medicine & burn treatment centers", "Specialized emergency and burn centers. National emergency medical service network.", "Point 73"),
        ("H5", "Health", "Disability prevention & rehabilitation by 2087", "Prevent preventable disabilities. Comprehensive rehabilitation. Social inclusion programs.", "Point 74"),
        ("H6", "Health", "Disease prevention & traditional medicine integration", "National prevention campaigns. Research integrating traditional and modern medicine.", "Point 75"),
        ("H7", "Health", "Clean drinking water for every household", "Water treatment fund (जलन उपचार कोष). Scientific purification. 24-hour clean water access.", "Point 76"),
        ("H8", "Health", "Mental health access & community services", "Expand mental health services nationwide. Community-based care. Reduce stigma.", "Point 77"),
        # ═══ INFRASTRUCTURE (I1-I8) ═══
        ("I1", "Infrastructure", "Airport infrastructure to international standards", "Upgrade airports for safety, security, and modern facilities. International compliance.", "Point 53"),
        ("I2", "Infrastructure", "Modern long-distance bus service", "Replace unsafe buses with quality, safe public transport. Route quality standards.", "Point 54"),
        ("I3", "Infrastructure", "Road safety & strategic highway expansion", "Address road accidents. All-weather roads. Pedestrian/cyclist safety. Maintenance standards.", "Point 55"),
        ("I4", "Infrastructure", "Smart urban planning & electric transit", "Modern urban bus, electric transit, ITS in Kathmandu, Pokhara, Biratnagar. Reduce congestion.", "Point 56"),
        ("I5", "Infrastructure", "National 50-year railway masterplan", "Electric Mechi-Mahakali rail. Connection to China/India. Urban metro systems.", "Point 57"),
        ("I6", "Infrastructure", "Highway network modernization & bridges", "Quality all-weather roads (गुणस्तरीय सडक). Bridge infrastructure. National highway upgrades.", "Point 58"),
        ("I7", "Infrastructure", "High-speed internet to all settlements", "30,000 km national fiber-optic highway. Affordable high-speed internet everywhere.", "Citizen Contract \u00a74"),
        ("I8", "Infrastructure", "Hilly & mountain area special development", "Special programs for hill/mountain areas. Education, health, roads as basic infrastructure.", "Point 83"),
        # ═══ TRADE & INVESTMENT (T1-T3) ═══
        ("T1", "Trade & Investment", "One-stop shop for investment", "Single window (वान-स्टप सेवा केन्द्र) for all domestic and foreign investment approvals.", "Point 24"),
        ("T2", "Trade & Investment", "Reduce import dependence via domestic production", "Shift to production-oriented economy. Prioritize domestic energy, agriculture, IT.", "Point 35"),
        ("T3", "Trade & Investment", "Investment-friendly regulatory framework", "Transparent, predictable regulations. Strengthen financial markets.", "Points 24, 33"),
        # ═══ LABOR & EMPLOYMENT (L1-L4) ═══
        ("L1", "Labor & Employment", "Foreign worker regulation in Nepal", "Clear legal framework for foreign companies/workers in Nepal. Protect Nepali workers' rights.", "Point 40"),
        ("L2", "Labor & Employment", "Dignified foreign employment & worker protection", "Protect Nepalis abroad from exploitation. Company transparency. End excessive agency fees.", "Point 79"),
        ("L3", "Labor & Employment", "Labor rights, fair wages & safe conditions", "Labor as dignified work, not cheap resource. Fair wages, safe conditions, social security.", "Point 78"),
        ("L4", "Labor & Employment", "Dalit & marginalized employment equity", "Special employment programs for Dalits. Skill-based credit, business support, market access.", "Point 80"),
        # ═══ ENVIRONMENT & CLIMATE (EV1-EV9) ═══
        ("EV1", "Environment & Climate", "Forest conservation & reforestation", "Protect forests. Reforestation programs. Community forestry expansion. Ban illegal logging.", "Point 86"),
        ("EV2", "Environment & Climate", "Wildlife & biodiversity protection", "Protect endangered species. Manage human-wildlife conflict. Expand protected areas.", "Point 87"),
        ("EV3", "Environment & Climate", "Community forestry strengthening", "Expand community forestry model. Sustainable management. Local economic benefits.", "Point 88"),
        ("EV4", "Environment & Climate", "Infrastructure-environment balance", "Environmental impact assessment for all projects. Sustainable construction. River protection.", "Point 89"),
        ("EV5", "Environment & Climate", "Terai environmental security", "Terai-specific: floods, river erosion, groundwater depletion, arsenic contamination.", "Point 90"),
        ("EV6", "Environment & Climate", "Arsenic-free water for all citizens", "National arsenic testing program. Alternative water sources. Safe water guarantee.", "Point 91"),
        ("EV7", "Environment & Climate", "50% air pollution reduction in cities", "EVs, clean cooking energy, industrial emission standards. Major city air quality targets.", "Point 93"),
        ("EV8", "Environment & Climate", "Climate adaptation & disaster resilience", "Climate-resilient infrastructure. Early warning. Community preparedness. Integrated settlements.", "Point 94"),
        ("EV9", "Environment & Climate", "Climate diplomacy & जलवायु न्याय leadership", "Nepal as global voice for climate justice. Leverage Himalayan vulnerability for advocacy.", "Point 95"),
        # ═══ SOCIAL (S1-S5) ═══
        ("S1", "Social", "End caste, ethnic, and gender discrimination", "Address systemic discrimination through policy, law, and social reform. Active enforcement.", "Point 1"),
        ("S2", "Social", "Youth & first-time homebuyer housing program", "Affordable housing for youth. First Home policy with subsidized loans and land planning.", "Point 81"),
        ("S3", "Social", "Digital land records & biometric verification", "Digital Biometric land verification to prevent fraud. End fake (नक्कली) land transactions.", "Point 82"),
        ("S4", "Social", "Diaspora voting rights & engagement", "Online voting abroad. एक पटकको नेपाली, सधैंको नेपाली policy. Diaspora fund. Dollar account.", "Citizen Contract \u00a75, Point 99"),
        ("S5", "Social", "Complete social security net for all citizens", "Comprehensive: retirement, disability, unemployment, maternity, old age support.", "Point 85"),
        # ═══ FOREIGN POLICY & SECURITY (FP1-FP3) ═══
        ("FP1", "Foreign Policy & Security", "Sovereignty & territorial integrity", "Uncompromising defense of borders. Modernized border security. Updated demarcation.", "Point 96"),
        ("FP2", "Foreign Policy & Security", "Border modernization & digital monitoring", "Modern border management with technology. Digital monitoring. Trade facilitation.", "Point 97"),
        ("FP3", "Foreign Policy & Security", "Diplomatic corps professionalization", "Results-based postings. End political diplomat appointments. Balanced India-China policy.", "Point 98"),
    ]

    created = 0
    for pid, cat, promise, detail, source in SEED_DATA:
        existing = await db.execute(
            select(ManifestoPromise).where(ManifestoPromise.promise_id == pid)
        )
        if existing.scalar_one_or_none():
            continue
        db.add(ManifestoPromise(
            id=uuid4(),
            promise_id=pid,
            party="RSP",
            election_year="2082",
            category=cat,
            promise=promise,
            detail=detail,
            source=source,
            status="not_started",
        ))
        created += 1

    await db.commit()
    return {"seeded": created, "total": len(SEED_DATA)}
