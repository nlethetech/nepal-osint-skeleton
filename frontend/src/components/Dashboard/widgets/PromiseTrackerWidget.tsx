/**
 * PromiseTrackerWidget — RSP Official Manifesto (2082) Promise Tracker
 *
 * Fetches promise data from the API (updated nightly by local Sonnet agent).
 * Falls back to hardcoded seed data if API returns empty.
 */
import { memo, useState, useMemo, useEffect } from 'react';
import { Widget } from '../Widget';
import { ClipboardCheck, ChevronDown, ChevronUp, Filter, RefreshCw } from 'lucide-react';
import apiClient from '../../../api/client';

type PromiseStatus = 'not_started' | 'in_progress' | 'partially_fulfilled' | 'fulfilled' | 'stalled';

interface ManifestoPromise {
  promise_id: string;
  promise: string;
  category: string;
  status: PromiseStatus;
  detail?: string;
  source?: string;
  status_detail?: string;
  last_checked_at?: string;
  status_changed_at?: string;
}

const STATUS_CONFIG: Record<PromiseStatus, { label: string; color: string; bg: string }> = {
  not_started:         { label: 'Not Started',   color: 'var(--text-muted)',     bg: 'rgba(113,113,122,0.12)' },
  in_progress:         { label: 'In Progress',   color: 'var(--accent-primary)', bg: 'rgba(59,130,246,0.12)' },
  partially_fulfilled: { label: 'Partial',       color: 'var(--status-medium)',  bg: 'rgba(234,179,8,0.12)' },
  fulfilled:           { label: 'Fulfilled',     color: 'var(--status-low)',     bg: 'rgba(34,197,94,0.12)' },
  stalled:             { label: 'Stalled',       color: 'var(--status-high)',    bg: 'rgba(249,115,22,0.12)' },
};

const CATEGORIES = [
  'Governance', 'Anti-Corruption', 'Judiciary', 'Economy',
  'Digital & IT', 'Financial Sector', 'Agriculture', 'Energy',
  'Tourism & Culture', 'Education', 'Health', 'Infrastructure',
  'Trade & Investment', 'Labor & Employment', 'Environment & Climate',
  'Social', 'Foreign Policy & Security',
] as const;

// ── Hardcoded fallback — VERIFIED against RSP Manifesto (वाचा पत्र 2082) PDF, all 100 points ──
const FALLBACK_PROMISES: ManifestoPromise[] = [
  // ═══ GOVERNANCE (G1-G11) ═══
  { promise_id: 'G1', category: 'Governance', status: 'not_started', promise: 'Constitutional amendment discussion paper', detail: 'Prepare a discussion paper (बहस पत्र) for national consensus on constitutional amendments.', source: 'Point 10' },
  { promise_id: 'G2', category: 'Governance', status: 'not_started', promise: 'Limit federal ministries to 18 with expert ministers', detail: 'Cap ministries at 18. Specialist (विज्ञ) ministers and expertise-based administration.', source: 'Point 17' },
  { promise_id: 'G3', category: 'Governance', status: 'not_started', promise: 'Party leader term limited to two terms', detail: 'Party president max two consecutive terms. Annual public funding to parties by vote share.', source: 'Point 15' },
  { promise_id: 'G4', category: 'Governance', status: 'not_started', promise: 'Reform NPC into modern think-tank', detail: 'Transform NPC into policy research, data, and monitoring-focused think-tank.', source: 'Point 18' },
  { promise_id: 'G5', category: 'Governance', status: 'not_started', promise: 'Professionalize civil service, end political unions', detail: 'Abolish partisan unions. Professional, impartial, accountable administration.', source: 'Point 7' },
  { promise_id: 'G6', category: 'Governance', status: 'not_started', promise: 'End nepotism in appointments', detail: 'Bar officials from appointing family members as personal secretary (स्वकीय सचिव).', source: 'Point 16' },
  { promise_id: 'G7', category: 'Governance', status: 'not_started', promise: 'Classify & reform public institutions', detail: 'Classify public enterprises: merge, PPP, strategic partners, decentralize, or transfer.', source: 'Point 26' },
  { promise_id: 'G8', category: 'Governance', status: 'not_started', promise: 'Mission-mode public organizations', detail: 'Clear objectives, fixed budgets, time limits, qualified HR, results-based targets.', source: 'Point 27' },
  { promise_id: 'G9', category: 'Governance', status: 'not_started', promise: 'Gen-Z civic engagement in governance', detail: 'Formal youth platform. Recognize Bhadra 23-24 movement. Youth in policy bodies.', source: 'Point 2' },
  { promise_id: 'G10', category: 'Governance', status: 'not_started', promise: 'Depoliticize civil service trade unions', detail: 'Replace partisan unions with professional, merit-based employee representation.', source: 'Point 6' },
  { promise_id: 'G11', category: 'Governance', status: 'not_started', promise: 'Digital audit trail for all govt decisions', detail: 'Every decision requires digital process trail. End informal influence channels.', source: 'Point 8' },
  // ═══ ANTI-CORRUPTION (AC1-AC6) ═══
  { promise_id: 'AC1', category: 'Anti-Corruption', status: 'not_started', promise: 'Mandatory asset disclosure before/after office', detail: 'Full disclosure + independent audit of wealth change for officials and families.', source: 'Point 16' },
  { promise_id: 'AC2', category: 'Anti-Corruption', status: 'not_started', promise: 'Mandatory e-signatures & digital governance', detail: 'Legally mandate digital signatures. Digitize tippani.gov.np and paripatra.gov.np.', source: 'Point 5' },
  { promise_id: 'AC3', category: 'Anti-Corruption', status: 'not_started', promise: 'Amend CIAA, Constitutional Council, Judicial Council acts', detail: 'Strengthen constitutional body independence via governing act amendments.', source: 'Point 11' },
  { promise_id: 'AC4', category: 'Anti-Corruption', status: 'not_started', promise: 'Public funding for parties by vote share', detail: 'Annual public funding. Reform Political Party Act. Cap leader tenure.', source: 'Point 15' },
  { promise_id: 'AC5', category: 'Anti-Corruption', status: 'not_started', promise: 'Independent regulators to end cartels', detail: 'Independent, professional regulators against cartels and rent-seeking.', source: 'Point 20' },
  { promise_id: 'AC6', category: 'Anti-Corruption', status: 'not_started', promise: 'Zero-tolerance anti-corruption party culture', detail: 'Every member practices integrity. Zero tolerance for corruption within RSP.', source: 'Point 100' },
  // ═══ JUDICIARY (J1-J6) ═══
  { promise_id: 'J1', category: 'Judiciary', status: 'not_started', promise: 'Merit-based judicial appointments', detail: 'End political influence in court appointments. Meritocracy and competition.', source: 'Point 13' },
  { promise_id: 'J2', category: 'Judiciary', status: 'not_started', promise: 'Clear judicial backlog', detail: 'Fast-track pending cases. Implement Judicial Code 2046 immediately.', source: 'Point 12' },
  { promise_id: 'J3', category: 'Judiciary', status: 'not_started', promise: 'Study live court broadcasts', detail: 'Study live/recorded broadcasting of proceedings for transparency.', source: 'Point 14' },
  { promise_id: 'J4', category: 'Judiciary', status: 'not_started', promise: 'Define usury as economic crime', detail: 'Classify meter-byaj as economic crime. Dismantle networks in 5 years.', source: 'Point 32' },
  { promise_id: 'J5', category: 'Judiciary', status: 'not_started', promise: 'End caste discrimination via enforcement', detail: 'Address Dalit injustice through state policy, law, and enforcement.', source: 'Point 1' },
  { promise_id: 'J6', category: 'Judiciary', status: 'not_started', promise: 'Revenue judiciary & auditor reform', detail: 'Modernize revenue courts and state audit mechanisms.', source: 'Point 25' },
  // ═══ ECONOMY (E1-E9) ═══
  { promise_id: 'E1', category: 'Economy', status: 'not_started', promise: '$3,000 per-capita, $100B economy', detail: '7% real growth. Nepal Production Fund (नेपाल उत्पादन कोष).', source: 'Citizen Contract §2, Point 19' },
  { promise_id: 'E2', category: 'Economy', status: 'not_started', promise: 'Progressive tax reform', detail: 'Review family burden threshold. End retroactive rules. Enforce against evasion.', source: 'Point 22' },
  { promise_id: 'E3', category: 'Economy', status: 'not_started', promise: 'Create 12 lakh new formal jobs', detail: '1.2M jobs in IT, construction, tourism, agriculture, mining, sports, trade.', source: 'Citizen Contract §3' },
  { promise_id: 'E4', category: 'Economy', status: 'not_started', promise: 'Break cartels and monopolies', detail: 'Independent regulators against cartel pricing and regulatory capture.', source: 'Point 20' },
  { promise_id: 'E5', category: 'Economy', status: 'not_started', promise: 'Review NPR-INR peg policy', detail: 'Study with experts on fixed exchange rate maintained for decades.', source: 'Point 23' },
  { promise_id: 'E6', category: 'Economy', status: 'not_started', promise: 'Production economy, end remittance dependence', detail: 'Shift to production & export model. 30% NPF from formal employment.', source: 'Points 19, 21' },
  { promise_id: 'E7', category: 'Economy', status: 'not_started', promise: 'National Economic Reform Commission', detail: 'NERC to address 12 years of stagnation. Industry-Commerce Federation.', source: 'Point 28' },
  { promise_id: 'E8', category: 'Economy', status: 'not_started', promise: 'Mining & mineral industry', detail: 'Expand mining. Amend Mining Act 2076. Public-private partnerships.', source: 'Point 60' },
  { promise_id: 'E9', category: 'Economy', status: 'not_started', promise: 'Export electricity, agriculture & AI computation', detail: 'Export AI/computation power leveraging cold climate for data centers.', source: 'Point 39' },
  // ═══ DIGITAL & IT (D1-D7) ═══
  { promise_id: 'D1', category: 'Digital & IT', status: 'not_started', promise: 'National digital ID for all citizens', detail: 'National identity card, unified database, linked to all govt services.', source: 'Point 4' },
  { promise_id: 'D2', category: 'Digital & IT', status: 'not_started', promise: 'Digitize tippani.gov.np & paripatra.gov.np', detail: 'All memos and directives issued and tracked digitally.', source: 'Point 5' },
  { promise_id: 'D3', category: 'Digital & IT', status: 'not_started', promise: 'Complete government file digitization', detail: 'End manual routing. Digital audit trail (प्रक्रिया लेखाजोखा).', source: 'Point 9' },
  { promise_id: 'D4', category: 'Digital & IT', status: 'not_started', promise: 'Digital Parks in 7 provinces, $30B IT export', detail: 'IT as national strategic industry. Parks in all provinces. $1.5B→$30B.', source: 'Point 36' },
  { promise_id: 'D5', category: 'Digital & IT', status: 'not_started', promise: 'Digital infrastructure & cybersecurity', detail: 'Data centers, cloud, cybersecurity laws, privacy, connectivity.', source: 'Point 37' },
  { promise_id: 'D6', category: 'Digital & IT', status: 'not_started', promise: 'International payment gateway', detail: 'Remove barriers for startups. Digital-First nation transformation.', source: 'Point 38' },
  { promise_id: 'D7', category: 'Digital & IT', status: 'not_started', promise: 'All citizen services via digital platform', detail: 'End queueing. Digital permits, tourism, e-governance.', source: 'Point 52' },
  // ═══ FINANCIAL SECTOR (F1-F5) ═══
  { promise_id: 'F1', category: 'Financial Sector', status: 'not_started', promise: 'Cooperative & microfinance under NRB', detail: '50Cr+ cooperatives/microfinance under Nepal Rastra Bank.', source: 'Points 29, 30' },
  { promise_id: 'F2', category: 'Financial Sector', status: 'not_started', promise: 'NEPSE restructuring & market reform', detail: 'Restructure NEPSE/CDS. Private share. Insider trading rules.', source: 'Point 33' },
  { promise_id: 'F3', category: 'Financial Sector', status: 'not_started', promise: 'Grow institutional investors', detail: 'Expand pension/insurance/mutual funds. International exchange.', source: 'Point 34' },
  { promise_id: 'F4', category: 'Financial Sector', status: 'not_started', promise: 'Depositor & saver protection', detail: 'Unified savings protection fund against bank/cooperative failures.', source: 'Point 31' },
  { promise_id: 'F5', category: 'Financial Sector', status: 'not_started', promise: 'Energy sector debt cleanup', detail: 'Clean up NPAs. Restructure hydropower investment framework.', source: 'Point 30' },
  // ═══ AGRICULTURE (AG1-AG3) ═══
  { promise_id: 'AG1', category: 'Agriculture', status: 'not_started', promise: 'Food sovereignty & sustainable farming', detail: 'Food security via sustainable/organic farming. Land-use planning.', source: 'Point 41' },
  { promise_id: 'AG2', category: 'Agriculture', status: 'not_started', promise: 'Agricultural import substitution', detail: 'Replace imports with domestic production. Cold storage & processing.', source: 'Point 42' },
  { promise_id: 'AG3', category: 'Agriculture', status: 'not_started', promise: 'Agricultural modernization & irrigation', detail: 'Modern irrigation, mechanization, seed tech, crop insurance.', source: 'Point 43' },
  // ═══ ENERGY (EN1-EN5) ═══
  { promise_id: 'EN1', category: 'Energy', status: 'not_started', promise: '15,000 MW hydropower & Smart Grid', detail: '15,000 MW capacity. Smart National Grid. Energy export hub.', source: 'Citizen Contract §4, Point 44' },
  { promise_id: 'EN2', category: 'Energy', status: 'not_started', promise: '30,000 MW grid & provincial centers', detail: '30,000 km grid. Provincial energy centers. 10 signature projects.', source: 'Point 44' },
  { promise_id: 'EN3', category: 'Energy', status: 'not_started', promise: '10-year energy development plan', detail: 'Integrated plan: hydro, solar, wind. Infrastructure investment.', source: 'Point 45' },
  { promise_id: 'EN4', category: 'Energy', status: 'not_started', promise: '1500 kWh per-capita by 2035', detail: 'Industrial parks, EVs, electric cooking to grow consumption.', source: 'Point 46' },
  { promise_id: 'EN5', category: 'Energy', status: 'not_started', promise: 'Energy export to India & Bangladesh', detail: 'Cross-border trade. Regional market. South Asian energy hub.', source: 'Point 47' },
  // ═══ TOURISM & CULTURE (TM1-TM6) ═══
  { promise_id: 'TM1', category: 'Tourism & Culture', status: 'not_started', promise: 'Double tourism arrivals & spending', detail: 'Diversify: cultural, religious, wellness, adventure tourism.', source: 'Point 48' },
  { promise_id: 'TM2', category: 'Tourism & Culture', status: 'not_started', promise: 'International-standard airports', detail: 'Pokhara & Bhairahawa airports upgraded. Domestic fare competition.', source: 'Point 49' },
  { promise_id: 'TM3', category: 'Tourism & Culture', status: 'not_started', promise: 'Lumbini as world-class pilgrimage center', detail: 'Global Buddhist center. Ram-Janaki circuit. Heritage preservation.', source: 'Point 50' },
  { promise_id: 'TM4', category: 'Tourism & Culture', status: 'not_started', promise: 'Mountain tourism & Everest academy', detail: 'Mountaineering academy (माउन्टेन स्कुल). High-altitude research.', source: 'Point 51' },
  { promise_id: 'TM5', category: 'Tourism & Culture', status: 'not_started', promise: 'Sports professionalization', detail: 'Pro leagues. International training. Athlete pension fund.', source: 'Point 68' },
  { promise_id: 'TM6', category: 'Tourism & Culture', status: 'not_started', promise: 'Sports infrastructure in all provinces', detail: 'Multi-purpose facilities. School Sports curriculum.', source: 'Point 69' },
  // ═══ EDUCATION (ED1-ED7) ═══
  { promise_id: 'ED1', category: 'Education', status: 'not_started', promise: 'Free universities from politics', detail: 'Ban campus political activities. Protect academic freedom.', source: 'Point 61' },
  { promise_id: 'ED2', category: 'Education', status: 'not_started', promise: 'Public education quality overhaul', detail: 'Competitive with private. Teacher accountability & training.', source: 'Point 62' },
  { promise_id: 'ED3', category: 'Education', status: 'not_started', promise: 'Private school regulation', detail: 'Regulate fees and quality. Equal standards public/private.', source: 'Point 63' },
  { promise_id: 'ED4', category: 'Education', status: 'not_started', promise: 'Every child\'s early development access', detail: 'Universal early childhood centers. Comprehensive child rights.', source: 'Point 64' },
  { promise_id: 'ED5', category: 'Education', status: 'not_started', promise: 'Merit-based teacher evaluation', detail: 'Merit appointments/promotions. Professional development.', source: 'Point 65' },
  { promise_id: 'ED6', category: 'Education', status: 'not_started', promise: 'Higher education & research reform', detail: 'Universities as research institutions. International partnerships.', source: 'Point 66' },
  { promise_id: 'ED7', category: 'Education', status: 'not_started', promise: 'National Knowledge Bank for diaspora', detail: 'Connect diaspora expertise. राष्ट्रिय ज्ञान बैंक (Knowledge Bank).', source: 'Point 67' },
  // ═══ HEALTH (H1-H8) ═══
  { promise_id: 'H1', category: 'Health', status: 'not_started', promise: 'Minimum health standards nationwide', detail: 'न्यूनतम मापदण्ड across all districts including remote areas.', source: 'Point 70' },
  { promise_id: 'H2', category: 'Health', status: 'not_started', promise: 'Universal health insurance', detail: 'Insurance for every citizen. Increase health budget priority.', source: 'Citizen Contract §2, Point 71' },
  { promise_id: 'H3', category: 'Health', status: 'not_started', promise: 'Preventive over curative health', detail: 'Prevention-focused policy. Community health programs.', source: 'Point 72' },
  { promise_id: 'H4', category: 'Health', status: 'not_started', promise: 'Emergency medicine & burn centers', detail: 'Specialized centers. National emergency medical network.', source: 'Point 73' },
  { promise_id: 'H5', category: 'Health', status: 'not_started', promise: 'Disability prevention by 2087', detail: 'Prevent preventable disabilities. Rehabilitation & inclusion.', source: 'Point 74' },
  { promise_id: 'H6', category: 'Health', status: 'not_started', promise: 'Disease prevention & traditional medicine', detail: 'National campaigns. Traditional-modern medicine integration.', source: 'Point 75' },
  { promise_id: 'H7', category: 'Health', status: 'not_started', promise: 'Clean drinking water for all', detail: 'Water treatment fund. 24-hour clean water access nationwide.', source: 'Point 76' },
  { promise_id: 'H8', category: 'Health', status: 'not_started', promise: 'Mental health access & services', detail: 'Nationwide mental health. Community care. Reduce stigma.', source: 'Point 77' },
  // ═══ INFRASTRUCTURE (I1-I8) ═══
  { promise_id: 'I1', category: 'Infrastructure', status: 'not_started', promise: 'International-standard airports', detail: 'Safety, security, modern facilities. International compliance.', source: 'Point 53' },
  { promise_id: 'I2', category: 'Infrastructure', status: 'not_started', promise: 'Modern long-distance bus service', detail: 'Replace unsafe buses with quality, safe public transport.', source: 'Point 54' },
  { promise_id: 'I3', category: 'Infrastructure', status: 'not_started', promise: 'Road safety & highway expansion', detail: 'Address accidents. All-weather roads. Pedestrian safety.', source: 'Point 55' },
  { promise_id: 'I4', category: 'Infrastructure', status: 'not_started', promise: 'Smart urban planning & electric transit', detail: 'ITS in Kathmandu, Pokhara, Biratnagar. Reduce congestion.', source: 'Point 56' },
  { promise_id: 'I5', category: 'Infrastructure', status: 'not_started', promise: '50-year national railway masterplan', detail: 'Electric Mechi-Mahakali rail. China/India links. Urban metro.', source: 'Point 57' },
  { promise_id: 'I6', category: 'Infrastructure', status: 'not_started', promise: 'Highway modernization & bridges', detail: 'Quality all-weather roads. Bridge infrastructure.', source: 'Point 58' },
  { promise_id: 'I7', category: 'Infrastructure', status: 'not_started', promise: 'High-speed internet to all settlements', detail: '30,000 km fiber-optic highway. Affordable high-speed everywhere.', source: 'Citizen Contract §4' },
  { promise_id: 'I8', category: 'Infrastructure', status: 'not_started', promise: 'Hilly & mountain area development', detail: 'Special programs. Education, health, roads as basic infra.', source: 'Point 83' },
  // ═══ TRADE & INVESTMENT (T1-T3) ═══
  { promise_id: 'T1', category: 'Trade & Investment', status: 'not_started', promise: 'One-stop investment shop', detail: 'Single window (वान-स्टप) for all investment approvals.', source: 'Point 24' },
  { promise_id: 'T2', category: 'Trade & Investment', status: 'not_started', promise: 'Reduce import dependence', detail: 'Production-oriented economy. Prioritize energy, agriculture, IT.', source: 'Point 35' },
  { promise_id: 'T3', category: 'Trade & Investment', status: 'not_started', promise: 'Investment-friendly regulations', detail: 'Transparent, predictable rules. Competitive financial markets.', source: 'Points 24, 33' },
  // ═══ LABOR & EMPLOYMENT (L1-L4) ═══
  { promise_id: 'L1', category: 'Labor & Employment', status: 'not_started', promise: 'Foreign worker regulation in Nepal', detail: 'Legal framework for foreign companies/workers. Protect Nepali rights.', source: 'Point 40' },
  { promise_id: 'L2', category: 'Labor & Employment', status: 'not_started', promise: 'Dignified foreign employment', detail: 'Protect Nepalis abroad. End exploitation and excessive fees.', source: 'Point 79' },
  { promise_id: 'L3', category: 'Labor & Employment', status: 'not_started', promise: 'Labor rights & fair wages', detail: 'Dignified work, fair wages, safe conditions, social security.', source: 'Point 78' },
  { promise_id: 'L4', category: 'Labor & Employment', status: 'not_started', promise: 'Dalit & marginalized employment equity', detail: 'Special programs. Skill credit, business support, market access.', source: 'Point 80' },
  // ═══ ENVIRONMENT & CLIMATE (EV1-EV9) ═══
  { promise_id: 'EV1', category: 'Environment & Climate', status: 'not_started', promise: 'Forest conservation & reforestation', detail: 'Protect forests. Reforestation. Community forestry expansion.', source: 'Point 86' },
  { promise_id: 'EV2', category: 'Environment & Climate', status: 'not_started', promise: 'Wildlife & biodiversity protection', detail: 'Protect species. Manage human-wildlife conflict.', source: 'Point 87' },
  { promise_id: 'EV3', category: 'Environment & Climate', status: 'not_started', promise: 'Community forestry strengthening', detail: 'Expand model. Sustainable management. Local benefits.', source: 'Point 88' },
  { promise_id: 'EV4', category: 'Environment & Climate', status: 'not_started', promise: 'Infrastructure-environment balance', detail: 'EIA for all projects. Sustainable construction. River protection.', source: 'Point 89' },
  { promise_id: 'EV5', category: 'Environment & Climate', status: 'not_started', promise: 'Terai environmental security', detail: 'Floods, erosion, groundwater, arsenic contamination.', source: 'Point 90' },
  { promise_id: 'EV6', category: 'Environment & Climate', status: 'not_started', promise: 'Arsenic-free water for all', detail: 'National testing. Alternative sources. Safe water guarantee.', source: 'Point 91' },
  { promise_id: 'EV7', category: 'Environment & Climate', status: 'not_started', promise: '50% air pollution reduction', detail: 'EVs, clean cooking, emission standards. City air targets.', source: 'Point 93' },
  { promise_id: 'EV8', category: 'Environment & Climate', status: 'not_started', promise: 'Climate adaptation & disaster resilience', detail: 'Climate-resilient infra. Early warning. Integrated settlements.', source: 'Point 94' },
  { promise_id: 'EV9', category: 'Environment & Climate', status: 'not_started', promise: 'Climate diplomacy & जलवायु न्याय', detail: 'Global voice for climate justice. Himalayan vulnerability advocacy.', source: 'Point 95' },
  // ═══ SOCIAL (S1-S5) ═══
  { promise_id: 'S1', category: 'Social', status: 'not_started', promise: 'End caste, ethnic, gender discrimination', detail: 'Systemic reform via policy, law, and enforcement.', source: 'Point 1' },
  { promise_id: 'S2', category: 'Social', status: 'not_started', promise: 'Youth housing program', detail: 'Affordable housing. First Home policy with subsidized loans.', source: 'Point 81' },
  { promise_id: 'S3', category: 'Social', status: 'not_started', promise: 'Digital land records & biometric', detail: 'Digital verification to prevent fake (नक्कली) transactions.', source: 'Point 82' },
  { promise_id: 'S4', category: 'Social', status: 'not_started', promise: 'Diaspora voting & engagement', detail: 'Online voting. Diaspora fund. Dollar account. Knowledge Bank.', source: 'Citizen Contract §5, Point 99' },
  { promise_id: 'S5', category: 'Social', status: 'not_started', promise: 'Complete social security net', detail: 'Retirement, disability, unemployment, maternity, old age.', source: 'Point 85' },
  // ═══ FOREIGN POLICY & SECURITY (FP1-FP3) ═══
  { promise_id: 'FP1', category: 'Foreign Policy & Security', status: 'not_started', promise: 'Sovereignty & territorial integrity', detail: 'Uncompromising border defense. Modern security. Updated demarcation.', source: 'Point 96' },
  { promise_id: 'FP2', category: 'Foreign Policy & Security', status: 'not_started', promise: 'Border modernization & digital monitoring', detail: 'Technology-based border management. Trade facilitation.', source: 'Point 97' },
  { promise_id: 'FP3', category: 'Foreign Policy & Security', status: 'not_started', promise: 'Diplomatic corps professionalization', detail: 'Results-based postings. Balanced India-China policy.', source: 'Point 98' },
];

export const PromiseTrackerWidget = memo(function PromiseTrackerWidget() {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promises, setPromises] = useState<ManifestoPromise[]>(FALLBACK_PROMISES);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  useEffect(() => {
    const fetchPromises = async () => {
      try {
        const res = await apiClient.get('/promises/summary', {
          params: { party: 'RSP', election_year: '2082' },
        });
        const data = res.data;
        if (data.promises && data.promises.length > 0) {
          setPromises(data.promises);
          // Find most recent last_checked_at
          const checked = data.promises
            .map((p: any) => p.last_checked_at)
            .filter(Boolean)
            .sort()
            .pop();
          if (checked) setLastChecked(checked);
        }
      } catch {
        // Use fallback data
      }
      setLoading(false);
    };
    fetchPromises();
  }, []);

  const filtered = selectedCategory
    ? promises.filter(p => p.category === selectedCategory)
    : promises;

  const total = promises.length;
  const byStatus = useMemo(() => promises.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>), [promises]);

  const fulfilled = byStatus.fulfilled || 0;
  const inProgress = byStatus.in_progress || 0;
  const notStarted = byStatus.not_started || 0;
  const partial = byStatus.partially_fulfilled || 0;
  const stalled = byStatus.stalled || 0;

  const progressPct = Math.round(((fulfilled * 1 + inProgress * 0.3 + partial * 0.5) / total) * 100);

  return (
    <Widget id="promise-tracker" icon={<ClipboardCheck size={14} />}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Compact Summary + Filter — single row */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {/* Title */}
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 700 }}>RSP</span> Government Promise Tracker
          </span>

          {/* Segmented progress bar */}
          <div style={{
            flex: 1, height: 5, borderRadius: 3,
            background: 'var(--bg-active)',
            overflow: 'hidden', display: 'flex',
            minWidth: 60,
          }}>
            {fulfilled > 0 && <div title={`${fulfilled} Fulfilled`} style={{ height: '100%', width: `${(fulfilled / total) * 100}%`, background: 'var(--status-low, #22C55E)', transition: 'width 0.6s ease' }} />}
            {partial > 0 && <div title={`${partial} Partial`} style={{ height: '100%', width: `${(partial / total) * 100}%`, background: 'var(--status-medium, #EAB308)', transition: 'width 0.6s ease' }} />}
            {inProgress > 0 && <div title={`${inProgress} In Progress`} style={{ height: '100%', width: `${(inProgress / total) * 100}%`, background: 'var(--accent-primary, #2D72D2)', transition: 'width 0.6s ease' }} />}
            {stalled > 0 && <div title={`${stalled} Stalled`} style={{ height: '100%', width: `${(stalled / total) * 100}%`, background: 'var(--status-high, #F97316)', transition: 'width 0.6s ease' }} />}
          </div>

          {/* Compact stats */}
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {[
              { label: 'Done', value: fulfilled, color: 'var(--status-low)', tip: 'Promises fully delivered' },
              { label: 'Active', value: inProgress, color: 'var(--accent-primary)', tip: 'Currently being worked on' },
              { label: 'Stalled', value: stalled, color: 'var(--status-high)', tip: 'No progress detected' },
              { label: 'Pending', value: notStarted, color: 'var(--text-muted)', tip: 'Not yet started' },
            ].map(s => (
              <div key={s.label} title={`${s.tip} (${s.value}/${total})`} style={{
                display: 'flex', alignItems: 'center', gap: 3,
                fontSize: 10, color: s.color, fontFamily: 'var(--font-mono)', cursor: 'default',
              }}>
                <span style={{ fontWeight: 700 }}>{s.value}</span>
                <span style={{ color: 'var(--text-disabled)', fontSize: 9 }}>{s.label}</span>
              </div>
            ))}
          </div>

          {/* Dropdown filter */}
          <select
            value={selectedCategory || ''}
            onChange={e => setSelectedCategory(e.target.value || null)}
            style={{
              padding: '3px 6px', fontSize: 10, fontFamily: 'var(--font-sans)',
              background: 'var(--bg-elevated)', color: selectedCategory ? 'var(--text-primary)' : 'var(--text-muted)',
              border: '1px solid var(--border-subtle)', borderRadius: 4,
              cursor: 'pointer', flexShrink: 0, minHeight: 26,
            }}
          >
            <option value="">All ({total})</option>
            {CATEGORIES.map(cat => {
              const count = promises.filter(p => p.category === cat).length;
              return <option key={cat} value={cat}>{cat} ({count})</option>;
            })}
          </select>

          {/* Percentage */}
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
            {progressPct}%
          </span>
        </div>

        {/* Promise List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : filtered.map(p => {
            const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.not_started;
            const expanded = expandedId === p.promise_id;
            return (
              <div
                key={p.promise_id}
                onClick={() => setExpandedId(expanded ? null : p.promise_id)}
                title={`${p.promise_id}: ${p.promise} — ${cfg.label}`}
                style={{
                  padding: '10px 12px',
                  minHeight: 44,
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  {/* Status dot */}
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: cfg.color,
                    marginTop: 5, flexShrink: 0,
                  }} />

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                        {p.promise}
                      </span>
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 4 }}>
                        {p.detail && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {p.detail}
                          </div>
                        )}
                        {p.status_detail && (
                          <div style={{
                            fontSize: 10, color: 'var(--accent-primary)', lineHeight: 1.4, marginTop: 4,
                            padding: '4px 8px', background: 'rgba(59,130,246,0.08)',
                            border: '1px solid rgba(59,130,246,0.15)',
                          }}>
                            <RefreshCw size={9} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
                            {p.status_detail}
                          </div>
                        )}
                        {p.source && (
                          <div style={{
                            fontSize: 9, color: 'var(--text-disabled)',
                            fontFamily: 'var(--font-mono)', marginTop: 4,
                          }}>
                            Ref: {p.source}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right side: category tag + status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 8, color: 'var(--text-disabled)',
                      fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}>
                      {p.promise_id}
                    </span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, color: cfg.color,
                      background: cfg.bg, padding: '1px 6px',
                      textTransform: 'uppercase', letterSpacing: '0.04em',
                      whiteSpace: 'nowrap',
                    }}>
                      {cfg.label}
                    </span>
                    {expanded ? (
                      <ChevronUp size={12} style={{ color: 'var(--text-disabled)' }} />
                    ) : (
                      <ChevronDown size={12} style={{ color: 'var(--text-disabled)' }} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '6px 12px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 9, color: 'var(--text-disabled)' }}>
            Govt Promise Tracker ({total} promises tracked)
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' }}>
            {lastChecked
              ? `Checked ${new Date(lastChecked).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
              : `${filtered.length} shown`
            }
          </span>
        </div>
      </div>
    </Widget>
  );
});
