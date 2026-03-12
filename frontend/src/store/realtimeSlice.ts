/**
 * Zustand Store for Real-Time Data
 *
 * Manages state for real-time updates including:
 * - Live story feed
 * - Intelligence alerts
 * - Threat matrix counts
 * - Entity mention counts
 * - Connection status
 * - Unread counts
 *
 * Features localStorage persistence for live feed data
 * so data survives page refreshes.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Storage key for localStorage (v3: dynamic intelligence alerts from high-severity stories)
const STORAGE_KEY = 'nepal-osint-realtime-v3'

// Clear old storage keys on load (one-time migration)
if (typeof window !== 'undefined') {
  localStorage.removeItem('nepal-osint-realtime-v1')
  localStorage.removeItem('nepal-osint-realtime-v2')
}

// Max age for cached data (1 hour in milliseconds)
const MAX_CACHE_AGE_MS = 60 * 60 * 1000

// =============================================================================
// PALANTIR-GRADE NEPAL RELEVANCE SCORING ENGINE
// Comprehensive weighted scoring system with entity recognition
// Last updated: January 2026 political scenario
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION - Adjustable thresholds without code changes
// ─────────────────────────────────────────────────────────────────────────────

const SCORING_CONFIG = {
  // Minimum score to pass filter (0-100)
  MIN_RELEVANCE_THRESHOLD: 25,
  // Minimum score for high-priority display
  HIGH_PRIORITY_THRESHOLD: 60,
  // Score boost for Nepal news sources
  NEPAL_SOURCE_BOOST: 30,
  // Score penalty for foreign markers
  FOREIGN_PENALTY: -40,
  // Score boost for Devanagari script detection
  DEVANAGARI_BOOST: 35,
  // Maximum score cap
  MAX_SCORE: 100,
  // Temporal decay half-life in hours (for trending topics)
  TRENDING_HALFLIFE_HOURS: 12,
}

// ─────────────────────────────────────────────────────────────────────────────
// WEIGHTED ENTITY DATABASE - Nepal Political Landscape (January 2026)
// ─────────────────────────────────────────────────────────────────────────────

interface EntityEntry {
  patterns: string[] // All variations/aliases
  weight: number     // Base relevance score (1-50)
  category: string   // Classification
}

const POLITICAL_ENTITIES: Record<string, EntityEntry> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 1: TOP LEADERSHIP (Weight: 45-50)
  // ═══════════════════════════════════════════════════════════════════════════

  // Prime Minister & President
  'pm_prachanda': {
    patterns: ['prachanda', 'pushpa kamal dahal', 'प्रचण्ड', 'पुष्पकमल दाहाल', 'prime minister nepal'],
    weight: 50,
    category: 'executive'
  },
  'president_poudel': {
    patterns: ['ram chandra poudel', 'रामचन्द्र पौडेल', 'president nepal', 'rashtrapati'],
    weight: 48,
    category: 'executive'
  },
  'kp_oli': {
    patterns: ['kp sharma oli', 'kp oli', 'केपी शर्मा ओली', 'केपी ओली', 'oli government'],
    weight: 48,
    category: 'political_leader'
  },
  'sher_bahadur_deuba': {
    patterns: ['sher bahadur deuba', 'शेरबहादुर देउवा', 'deuba', 'देउवा'],
    weight: 47,
    category: 'political_leader'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 2: RISING POLITICAL FIGURES (Weight: 40-45) - January 2026
  // ═══════════════════════════════════════════════════════════════════════════

  'rabi_lamichhane': {
    patterns: ['rabi lamichhane', 'रवि लामिछाने', 'rabi lamichhane rsp', 'home minister rabi'],
    weight: 45,
    category: 'political_leader'
  },
  'balen_shah': {
    patterns: ['balen shah', 'बालेन शाह', 'mayor balen', 'kathmandu mayor', 'बालेनको'],
    weight: 44,
    category: 'mayor'
  },
  'harka_sampang': {
    patterns: ['harka sampang', 'हर्क साम्पाङ', 'harka sampang rai', 'dharan mayor', 'mayor harka'],
    weight: 43,
    category: 'mayor'
  },
  'sudan_gurung': {
    patterns: ['sudan gurung', 'sudan gurung rsp', 'सुदन गुरुङ'],
    weight: 42,
    category: 'political_leader'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER 3: SENIOR POLITICAL LEADERS (Weight: 35-42)
  // ═══════════════════════════════════════════════════════════════════════════

  'madhav_nepal': {
    patterns: ['madhav kumar nepal', 'madhav nepal', 'माधवकुमार नेपाल', 'माधव नेपाल'],
    weight: 40,
    category: 'political_leader'
  },
  'baburam_bhattarai': {
    patterns: ['baburam bhattarai', 'बाबुराम भट्टराई', 'dr baburam'],
    weight: 38,
    category: 'political_leader'
  },
  'gagan_thapa': {
    patterns: ['gagan thapa', 'गगन थापा', 'health minister gagan'],
    weight: 38,
    category: 'political_leader'
  },
  'bishnu_poudel': {
    patterns: ['bishnu poudel', 'bishnu prasad poudel', 'बिष्णु पौडेल', 'finance minister bishnu'],
    weight: 37,
    category: 'cabinet'
  },
  'narayan_kaji': {
    patterns: ['narayan kaji shrestha', 'nkaji', 'नारायणकाजी श्रेष्ठ', 'prakash man singh'],
    weight: 36,
    category: 'political_leader'
  },
  'pampha_bhusal': {
    patterns: ['pampha bhusal', 'पम्फा भुसाल'],
    weight: 35,
    category: 'political_leader'
  },
  'upendra_yadav': {
    patterns: ['upendra yadav', 'उपेन्द्र यादव', 'janata samajwadi'],
    weight: 35,
    category: 'political_leader'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // POLITICAL PARTIES (Weight: 30-40)
  // ═══════════════════════════════════════════════════════════════════════════

  'rsp': {
    patterns: ['rastriya swatantra party', 'rsp', 'rsp party', 'स्वतन्त्र पार्टी', 'swatantra party'],
    weight: 40,
    category: 'party'
  },
  'nepali_congress': {
    patterns: ['nepali congress', 'congress party', 'nc party', 'नेपाली कांग्रेस', 'कांग्रेस'],
    weight: 38,
    category: 'party'
  },
  'cpn_uml': {
    patterns: ['cpn uml', 'uml party', 'एमाले', 'cpn-uml', 'unified marxist leninist'],
    weight: 38,
    category: 'party'
  },
  'cpn_maoist': {
    patterns: ['cpn maoist', 'maoist centre', 'माओवादी केन्द्र', 'माओवादी', 'cpn-mc'],
    weight: 36,
    category: 'party'
  },
  'janata_samajwadi': {
    patterns: ['janata samajwadi', 'jsp', 'jsp nepal', 'जसपा', 'janata samajbadi'],
    weight: 32,
    category: 'party'
  },
  'rastriya_prajatantra': {
    patterns: ['rastriya prajatantra', 'rpp', 'rpn', 'राप्रपा', 'prajatantra party'],
    weight: 30,
    category: 'party'
  },
  'loktantrik_samajwadi': {
    patterns: ['loktantrik samajwadi', 'lsp', 'लोसपा'],
    weight: 28,
    category: 'party'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // GOVERNMENT INSTITUTIONS (Weight: 25-35)
  // ═══════════════════════════════════════════════════════════════════════════

  'parliament': {
    patterns: ['parliament nepal', 'pratinidhi sabha', 'प्रतिनिधि सभा', 'national assembly', 'राष्ट्रिय सभा', 'federal parliament'],
    weight: 35,
    category: 'institution'
  },
  'supreme_court': {
    patterns: ['supreme court nepal', 'सर्वोच्च अदालत', 'chief justice nepal'],
    weight: 34,
    category: 'institution'
  },
  'election_commission': {
    patterns: ['election commission nepal', 'निर्वाचन आयोग', 'chief election commissioner'],
    weight: 33,
    category: 'institution'
  },
  'nepal_rastra_bank': {
    patterns: ['nepal rastra bank', 'nrb', 'राष्ट्र बैंक', 'central bank nepal'],
    weight: 32,
    category: 'institution'
  },
  'ciaa': {
    patterns: ['ciaa', 'akhtiyar', 'अख्तियार', 'anti-corruption'],
    weight: 31,
    category: 'institution'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY FORCES (Weight: 30-35)
  // ═══════════════════════════════════════════════════════════════════════════

  'nepal_army': {
    patterns: ['nepal army', 'नेपाली सेना', 'nepali sena', 'army chief nepal', 'coas nepal'],
    weight: 35,
    category: 'security'
  },
  'nepal_police': {
    patterns: ['nepal police', 'नेपाल प्रहरी', 'igp nepal', 'police headquarters'],
    weight: 33,
    category: 'security'
  },
  'apf': {
    patterns: ['armed police force', 'apf', 'sashastra prahari', 'सशस्त्र प्रहरी'],
    weight: 32,
    category: 'security'
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MAYORS & LOCAL LEADERS (Weight: 30-38)
  // ═══════════════════════════════════════════════════════════════════════════

  'lalitpur_mayor': {
    patterns: ['chiri babu maharjan', 'lalitpur mayor', 'ललितपुर मेयर'],
    weight: 35,
    category: 'mayor'
  },
  'pokhara_mayor': {
    patterns: ['pokhara mayor', 'dhan raj acharya', 'पोखरा मेयर'],
    weight: 34,
    category: 'mayor'
  },
  'bharatpur_mayor': {
    patterns: ['bharatpur mayor', 'renu dahal', 'रेनु दाहाल', 'भरतपुर मेयर'],
    weight: 33,
    category: 'mayor'
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOGRAPHIC ENTITIES - Weighted by significance
// ─────────────────────────────────────────────────────────────────────────────

const GEOGRAPHIC_ENTITIES: Record<string, EntityEntry> = {
  // Capital & Major Cities (High weight)
  'kathmandu': {
    patterns: ['kathmandu', 'काठमाडौं', 'ktm'],
    weight: 35,
    category: 'city'
  },
  'pokhara': {
    patterns: ['pokhara', 'पोखरा'],
    weight: 30,
    category: 'city'
  },
  'lalitpur': {
    patterns: ['lalitpur', 'patan', 'ललितपुर', 'पाटन'],
    weight: 28,
    category: 'city'
  },
  'bhaktapur': {
    patterns: ['bhaktapur', 'भक्तपुर'],
    weight: 27,
    category: 'city'
  },

  // Strategic border areas (High weight for geopolitics)
  'birgunj': {
    patterns: ['birgunj', 'वीरगञ्ज', 'birganj'],
    weight: 28,
    category: 'border_city'
  },
  'biratnagar': {
    patterns: ['biratnagar', 'विराटनगर'],
    weight: 27,
    category: 'city'
  },
  'nepalgunj': {
    patterns: ['nepalgunj', 'नेपालगञ्ज'],
    weight: 26,
    category: 'city'
  },
  'kakarbhitta': {
    patterns: ['kakarbhitta', 'kakarvitta', 'काकडभिट्टा'],
    weight: 25,
    category: 'border_city'
  },
  'tatopani': {
    patterns: ['tatopani', 'तातोपानी', 'tatopani border'],
    weight: 26,
    category: 'border_city'
  },
  'rasuwagadhi': {
    patterns: ['rasuwagadhi', 'रसुवागढी', 'kerung'],
    weight: 26,
    category: 'border_city'
  },

  // Provinces
  'bagmati_province': {
    patterns: ['bagmati province', 'bagmati pradesh', 'बागमती प्रदेश'],
    weight: 25,
    category: 'province'
  },
  'madhesh_province': {
    patterns: ['madhesh province', 'madhesh pradesh', 'मधेश प्रदेश', 'province 2'],
    weight: 25,
    category: 'province'
  },
  'lumbini_province': {
    patterns: ['lumbini province', 'लुम्बिनी प्रदेश'],
    weight: 24,
    category: 'province'
  },
  'gandaki_province': {
    patterns: ['gandaki province', 'गण्डकी प्रदेश'],
    weight: 24,
    category: 'province'
  },
  'koshi_province': {
    patterns: ['koshi province', 'कोशी प्रदेश', 'province 1'],
    weight: 24,
    category: 'province'
  },
  'karnali_province': {
    patterns: ['karnali province', 'कर्णाली प्रदेश'],
    weight: 23,
    category: 'province'
  },
  'sudurpashchim_province': {
    patterns: ['sudurpashchim province', 'सुदूरपश्चिम प्रदेश', 'far western'],
    weight: 23,
    category: 'province'
  },

  // Key government locations
  'singha_durbar': {
    patterns: ['singha durbar', 'सिंहदरबार', 'singh durbar'],
    weight: 32,
    category: 'landmark'
  },
  'baluwatar': {
    patterns: ['baluwatar', 'बालुवाटार', 'pm residence'],
    weight: 31,
    category: 'landmark'
  },
  'sheetal_niwas': {
    patterns: ['sheetal niwas', 'शीतल निवास', 'president residence'],
    weight: 30,
    category: 'landmark'
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// PHRASE-LEVEL PATTERNS - Multi-word geopolitical phrases
// ─────────────────────────────────────────────────────────────────────────────

const GEOPOLITICAL_PHRASES: Array<{ pattern: RegExp; weight: number; category: string }> = [
  // Nepal-India Relations
  { pattern: /nepal[\s-]?india\s+(relation|border|trade|ties|dispute|treaty|agreement)/i, weight: 40, category: 'geopolitics' },
  { pattern: /india[\s-]?nepal\s+(relation|border|trade|ties|dispute|treaty|agreement)/i, weight: 40, category: 'geopolitics' },
  { pattern: /(open|close|seal|block).{0,20}(border|boundary).{0,20}(nepal|india)/i, weight: 38, category: 'geopolitics' },
  { pattern: /1950\s+treaty|peace\s+and\s+friendship\s+treaty/i, weight: 35, category: 'geopolitics' },
  { pattern: /kalapani|lipulekh|limpiyadhura/i, weight: 42, category: 'geopolitics' },
  { pattern: /indian\s+blockade|border\s+blockade/i, weight: 45, category: 'geopolitics' },

  // Nepal-China Relations
  { pattern: /nepal[\s-]?china\s+(relation|border|trade|ties|bri|project)/i, weight: 40, category: 'geopolitics' },
  { pattern: /china[\s-]?nepal\s+(relation|border|trade|ties|bri|project)/i, weight: 40, category: 'geopolitics' },
  { pattern: /belt\s+and\s+road.{0,20}nepal/i, weight: 38, category: 'geopolitics' },
  { pattern: /bri\s+(project|initiative|investment).{0,20}nepal/i, weight: 36, category: 'geopolitics' },
  { pattern: /trans[\s-]?himalayan/i, weight: 35, category: 'geopolitics' },
  { pattern: /chinese\s+(investment|loan|grant|aid).{0,20}nepal/i, weight: 35, category: 'geopolitics' },

  // Constitutional & Political Crises
  { pattern: /constitution(al)?\s+(amendment|crisis|deadlock)/i, weight: 38, category: 'political' },
  { pattern: /government\s+(collapse|fall|resign|crisis)/i, weight: 40, category: 'political' },
  { pattern: /no[\s-]?confidence\s+motion/i, weight: 42, category: 'political' },
  { pattern: /parliament\s+(dissolve|prorogu|session|deadlock)/i, weight: 38, category: 'political' },
  { pattern: /coalition\s+(government|breakdown|partner|split)/i, weight: 35, category: 'political' },
  { pattern: /power\s+sharing\s+(deal|agreement|dispute)/i, weight: 36, category: 'political' },
  { pattern: /vote\s+of\s+(confidence|no[\s-]?confidence)/i, weight: 40, category: 'political' },

  // Economic Keywords
  { pattern: /nepal\s+budget|budget\s+nepal|national\s+budget/i, weight: 35, category: 'economic' },
  { pattern: /remittance.{0,20}nepal/i, weight: 32, category: 'economic' },
  { pattern: /foreign\s+(investment|aid|grant|loan).{0,20}nepal/i, weight: 33, category: 'economic' },
  { pattern: /mcc\s+(compact|agreement|nepal)/i, weight: 38, category: 'economic' },
  { pattern: /hydropower\s+(project|deal|agreement)/i, weight: 32, category: 'economic' },

  // Security & Conflict
  { pattern: /maoist\s+(insurgency|conflict|peace|combatant)/i, weight: 35, category: 'security' },
  { pattern: /(army|military)\s+(deployment|mobiliz|exercise)/i, weight: 36, category: 'security' },
  { pattern: /border\s+(tension|conflict|incident|firing)/i, weight: 40, category: 'security' },
  { pattern: /terai\s+(unrest|protest|movement|madhesh)/i, weight: 35, category: 'security' },

  // Elections
  { pattern: /(local|provincial|federal|national)\s+election/i, weight: 38, category: 'election' },
  { pattern: /election\s+(commission|date|result|postpone)/i, weight: 36, category: 'election' },
  { pattern: /by[\s-]?election/i, weight: 32, category: 'election' },
]

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY PATTERN RECOGNITION - Regex for Nepal-specific data
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_PATTERNS = {
  // Nepal phone numbers: +977-XXXXXXXXXX or 98XXXXXXXX
  phone: /(?:\+977[\s-]?)?(?:98|97|96|01|02|03|04|05|06|07|08|09)\d{7,8}/g,

  // NPR amounts: Rs. 1,00,000 or NPR 100000 or रु. १,००,०००
  currency: /(?:rs\.?|npr|रु\.?|नेरु\.?)\s*[\d,]+(?:\.\d{2})?(?:\s*(?:crore|lakh|arab|million|billion|करोड|लाख|अर्ब))?/gi,

  // Nepal date format: 2080/10/05 (Bikram Sambat) or २०८०/१०/०५
  nepaliDate: /(?:20[78]\d|२०[७८][०-९])[\/-](?:0?[1-9]|1[0-2]|[०-९]{1,2})[\/-](?:0?[1-9]|[12]\d|3[01]|[०-९]{1,2})/g,

  // Devanagari script (at least 3 consecutive characters)
  devanagari: /[\u0900-\u097F]{3,}/g,

  // Common Nepali name patterns (simplified)
  nepaliName: /(?:bahadur|kumar|prasad|lal|maya|devi|kumari|raj|man|bir)\s+\w+/gi,

  // Nepal-specific organizations
  nepalOrg: /(?:federation|chamber|association|union|council)\s+of\s+nepal/gi,
}

// ─────────────────────────────────────────────────────────────────────────────
// FOREIGN CONTENT MARKERS - Strong negative signals
// ─────────────────────────────────────────────────────────────────────────────

const FOREIGN_MARKERS: Array<{ patterns: string[]; weight: number; hardBlock?: boolean }> = [
  // ═══════════════════════════════════════════════════════════════════════════
  // HARD BLOCKS - These get filtered REGARDLESS of Nepal score
  // ═══════════════════════════════════════════════════════════════════════════

  // Pakistan (CRITICAL - must block, not a neighbor for OSINT purposes)
  {
    patterns: [
      'pakistan', 'pakistani', 'islamabad', 'karachi', 'lahore', 'rawalpindi', 'peshawar',
      'imran khan', 'nawaz sharif', 'bilawal bhutto', 'ppp pakistan', 'pti party', 'pmln',
      'pakistan army', 'isi pakistan', 'pak army', 'pakistan election', 'psl cricket',
      'sindh', 'punjab pakistan', 'balochistan', 'khyber', 'gilgit'
    ],
    weight: -60,
    hardBlock: true
  },
  // Bangladesh (Not relevant unless Nepal trade/border context)
  {
    patterns: [
      'bangladesh', 'bangladeshi', 'dhaka', 'chittagong', 'sheikh hasina', 'awami league bangladesh',
      'bnp bangladesh', 'bangladesh election', 'rohingya', 'cox bazar'
    ],
    weight: -50,
    hardBlock: true
  },
  // Sri Lanka
  {
    patterns: [
      'sri lanka', 'sri lankan', 'colombo', 'rajapaksa', 'wickremesinghe', 'sri lanka crisis',
      'sri lanka election', 'tamil tigers', 'ltte'
    ],
    weight: -50,
    hardBlock: true
  },
  // Hong Kong, Macau, Taiwan (separate from China mainland context)
  {
    patterns: [
      'hong kong', 'hongkong', 'macau', 'taiwan election', 'taipei', 'kaohsiung',
      'hk protest', 'hong kong protest', 'carrie lam', 'john lee hong kong'
    ],
    weight: -50,
    hardBlock: true
  },
  // Middle East (not relevant)
  {
    patterns: [
      'saudi arabia', 'uae', 'dubai', 'qatar', 'kuwait', 'bahrain', 'oman',
      'iran', 'tehran', 'iraq', 'syria', 'lebanon', 'jordan', 'yemen',
      'afghanistan', 'kabul', 'taliban', 'afghan'
    ],
    weight: -45,
    hardBlock: true
  },
  // US Politics (Strong filter)
  {
    patterns: ['trump', 'biden', 'kamala harris', 'desantis', 'maga', 'white house', 'capitol hill',
      'congress us', 'senate us', 'democrat', 'republican', 'gop'],
    weight: -50,
    hardBlock: true
  },
  // Entertainment celebrities (Very strong filter)
  {
    patterns: ['ishowspeed', 'adin ross', 'twitch streamer', 'streamer drama', 'youtuber drama',
      'tiktoker', 'influencer drama', 'kardashian', 'taylor swift', 'drake', 'kanye',
      'beyonce', 'rihanna', 'justin bieber', 'selena gomez', 'ariana grande'],
    weight: -60,
    hardBlock: true
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SOFT BLOCKS - Penalize but allow if strong Nepal context
  // ═══════════════════════════════════════════════════════════════════════════

  // International sports (Strong filter)
  {
    patterns: ['premier league', 'champions league', 'la liga', 'bundesliga', 'serie a', 'ligue 1',
      'nfl', 'nba', 'mlb', 'nhl', 'super bowl', 'world series',
      'ipl', 'bcci', 't20 world cup', 'ashes', 'test cricket', 'world cup cricket'],
    weight: -40
  },
  // Sports personalities (unless Nepal context)
  {
    patterns: ['ronaldo', 'messi', 'haaland', 'mbappe', 'virat kohli', 'rohit sharma', 'dhoni',
      'lebron james', 'sachin tendulkar', 'babar azam'],
    weight: -38
  },
  // Hollywood/Entertainment
  {
    patterns: ['hollywood', 'oscar', 'grammy', 'emmy', 'golden globe', 'netflix series', 'disney plus',
      'marvel', 'dc comics', 'box office', 'blockbuster', 'red carpet', 'bollywood award'],
    weight: -35
  },
  // Global conflicts (not relevant to Nepal)
  {
    patterns: ['ukraine war', 'russia ukraine', 'israel palestine', 'gaza', 'hamas', 'hezbollah',
      'iran nuclear', 'taiwan strait', 'south china sea', 'north korea missile', 'crimea'],
    weight: -35
  },
  // Southeast Asian countries
  {
    patterns: ['malaysia', 'singapore', 'indonesia', 'philippines', 'vietnam', 'thailand', 'myanmar',
      'cambodia', 'laos', 'brunei'],
    weight: -30
  },
  // Far East & Oceania
  {
    patterns: ['japan', 'south korea', 'taiwan', 'australia', 'new zealand', 'tokyo', 'seoul'],
    weight: -28
  },
  // Americas, Africa, Europe (non-relevant contexts)
  {
    patterns: ['brazil', 'argentina', 'mexico', 'canada', 'nigeria', 'egypt', 'south africa', 'kenya',
      'uk election', 'france election', 'germany election', 'european union', 'brexit'],
    weight: -25
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// NEIGHBOR COUNTRY MARKERS - For tagging India/China related stories
// ─────────────────────────────────────────────────────────────────────────────

const NEIGHBOR_MARKERS = {
  india: {
    patterns: [
      'india', 'indian', 'delhi', 'mumbai', 'kolkata', 'chennai', 'bangalore', 'hyderabad',
      'modi', 'bjp', 'rahul gandhi', 'congress india', 'lok sabha', 'rajya sabha',
      'uttar pradesh', 'bihar', 'west bengal', 'madhya pradesh', 'rajasthan', 'maharashtra',
      'bsf', 'ssi', 'indian embassy', 'mea india', 'new delhi',
      'sensex', 'nifty', 'rbi', 'rupee',
      'indian army', 'indian border', 'sashastra seema bal'
    ],
    weight: 15  // Positive weight when combined with Nepal context
  },
  china: {
    patterns: [
      'china', 'chinese', 'beijing', 'shanghai', 'xi jinping', 'ccp', 'pla',
      'tibet', 'xinjiang', 'tibet autonomous',
      'chinese embassy', 'bri', 'belt and road', 'obor',
      'yuan', 'renminbi', 'huawei', 'alibaba', 'tencent',
      'chinese army', 'pla', 'chinese border'
    ],
    weight: 15
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NEPAL NEWS SOURCES - Trusted sources get automatic boost
// ─────────────────────────────────────────────────────────────────────────────

const NEPAL_NEWS_SOURCES = [
  // Major English news
  { pattern: 'kathmandupost', weight: 30 },
  { pattern: 'himalayan', weight: 30 },
  { pattern: 'myrepublica', weight: 30 },
  { pattern: 'nepalitimes', weight: 28 },
  { pattern: 'theannapurnaexpress', weight: 28 },
  { pattern: 'risingnepaldaily', weight: 27 },

  // Major Nepali news
  { pattern: 'ekantipur', weight: 30 },
  { pattern: 'kantipur', weight: 30 },
  { pattern: 'onlinekhabar', weight: 29 },
  { pattern: 'ratopati', weight: 28 },
  { pattern: 'setopati', weight: 28 },
  { pattern: 'nagariknews', weight: 27 },
  { pattern: 'nepalkhabar', weight: 26 },

  // Government & official
  { pattern: 'gorkhapatraonline', weight: 30 },
  { pattern: 'nepalgov', weight: 30 },

  // Tech & specialized
  { pattern: 'techlekh', weight: 22 },
  { pattern: 'hamropatro', weight: 22 },
  { pattern: 'shaaboreal', weight: 20 },
]

// ─────────────────────────────────────────────────────────────────────────────
// TRENDING TOPICS - Recent events that should be boosted (configurable)
// ─────────────────────────────────────────────────────────────────────────────

const TRENDING_TOPICS: Array<{ patterns: string[]; boost: number; expiresAt?: Date }> = [
  // Add trending topics here - can be updated dynamically
  // Example: { patterns: ['local election 2026', 'स्थानीय निर्वाचन'], boost: 20, expiresAt: new Date('2026-02-01') },
]

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCORING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

interface RelevanceResult {
  isRelevant: boolean
  score: number
  neighborCountry: 'india' | 'china' | null
  reasons: string[]
  priority: 'critical' | 'high' | 'medium' | 'low'
}

/**
 * Palantir-grade Nepal relevance scoring engine
 * Computes weighted score (0-100) with explainable reasons
 */
function computeNepalRelevanceScore(title: string, sourceId?: string): RelevanceResult {
  const text = title.toLowerCase()
  const originalText = title
  let score = 0
  const reasons: string[] = []

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Check for strong Nepal indicators (base score)
  // ═══════════════════════════════════════════════════════════════════════════

  // Direct Nepal mention
  if (/\bnepal\b/i.test(text) || /नेपाल/.test(originalText)) {
    score += 40
    reasons.push('Direct Nepal mention (+40)')
  }

  // Devanagari script detection
  const devanagariMatches = originalText.match(ENTITY_PATTERNS.devanagari)
  if (devanagariMatches && devanagariMatches.length > 0) {
    score += SCORING_CONFIG.DEVANAGARI_BOOST
    reasons.push(`Devanagari script detected (+${SCORING_CONFIG.DEVANAGARI_BOOST})`)
  }

  // Nepal currency pattern
  if (ENTITY_PATTERNS.currency.test(text) || /रु\.?\s*[\d,]/.test(originalText)) {
    score += 25
    reasons.push('Nepal currency reference (+25)')
  }

  // Nepal phone pattern
  if (ENTITY_PATTERNS.phone.test(text)) {
    score += 15
    reasons.push('Nepal phone number (+15)')
  }

  // Bikram Sambat date
  if (ENTITY_PATTERNS.nepaliDate.test(text)) {
    score += 20
    reasons.push('Nepali date format (+20)')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Political entity matching (weighted)
  // ═══════════════════════════════════════════════════════════════════════════

  for (const [, entity] of Object.entries(POLITICAL_ENTITIES)) {
    for (const pattern of entity.patterns) {
      if (text.includes(pattern.toLowerCase())) {
        score += entity.weight
        reasons.push(`Political: ${pattern} (+${entity.weight})`)
        break // Count each entity only once
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Geographic entity matching
  // ═══════════════════════════════════════════════════════════════════════════

  for (const [, entity] of Object.entries(GEOGRAPHIC_ENTITIES)) {
    for (const pattern of entity.patterns) {
      if (text.includes(pattern.toLowerCase())) {
        score += entity.weight
        reasons.push(`Location: ${pattern} (+${entity.weight})`)
        break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Phrase-level pattern matching
  // ═══════════════════════════════════════════════════════════════════════════

  for (const phrase of GEOPOLITICAL_PHRASES) {
    if (phrase.pattern.test(text)) {
      score += phrase.weight
      reasons.push(`Phrase: ${phrase.category} (+${phrase.weight})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Source reputation boost
  // ═══════════════════════════════════════════════════════════════════════════

  if (sourceId) {
    const sourceLower = sourceId.toLowerCase()
    for (const source of NEPAL_NEWS_SOURCES) {
      if (sourceLower.includes(source.pattern)) {
        score += source.weight
        reasons.push(`Nepal source: ${source.pattern} (+${source.weight})`)
        break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Foreign content penalty (with hard blocks)
  // ═══════════════════════════════════════════════════════════════════════════

  let foreignPenalty = 0
  let isHardBlocked = false
  let hardBlockReason = ''

  for (const foreign of FOREIGN_MARKERS) {
    for (const pattern of foreign.patterns) {
      if (text.includes(pattern.toLowerCase())) {
        // HARD BLOCKS: Always reject regardless of Nepal score
        if (foreign.hardBlock) {
          isHardBlocked = true
          hardBlockReason = pattern
          foreignPenalty = -100 // Ensure score goes to 0
          break
        }
        // SOFT BLOCKS: Apply penalty proportionally
        // Higher Nepal score = less penalty (they might be Nepal-related)
        const penaltyMultiplier = score >= 60 ? 0.3 : score >= 40 ? 0.6 : 1.0
        const adjustedPenalty = Math.floor(foreign.weight * penaltyMultiplier)
        foreignPenalty = Math.min(foreignPenalty, adjustedPenalty)
        reasons.push(`Foreign: ${pattern} (${adjustedPenalty})`)
        break
      }
    }
    if (isHardBlocked) break
  }

  if (isHardBlocked) {
    reasons.push(`BLOCKED: ${hardBlockReason}`)
  }
  score += foreignPenalty

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 7: Neighbor country detection & tagging
  // ═══════════════════════════════════════════════════════════════════════════

  let neighborCountry: 'india' | 'china' | null = null
  let hasIndiaMarker = false
  let hasChinaMarker = false

  for (const pattern of NEIGHBOR_MARKERS.india.patterns) {
    if (text.includes(pattern.toLowerCase())) {
      hasIndiaMarker = true
      break
    }
  }

  for (const pattern of NEIGHBOR_MARKERS.china.patterns) {
    if (text.includes(pattern.toLowerCase())) {
      hasChinaMarker = true
      break
    }
  }

  if (hasIndiaMarker && !hasChinaMarker) {
    neighborCountry = 'india'
    // Boost if Nepal context exists
    if (score > 30) {
      score += NEIGHBOR_MARKERS.india.weight
      reasons.push(`India relation (+${NEIGHBOR_MARKERS.india.weight})`)
    }
  } else if (hasChinaMarker && !hasIndiaMarker) {
    neighborCountry = 'china'
    if (score > 30) {
      score += NEIGHBOR_MARKERS.china.weight
      reasons.push(`China relation (+${NEIGHBOR_MARKERS.china.weight})`)
    }
  } else if (hasIndiaMarker && hasChinaMarker) {
    neighborCountry = 'india' // Default to India if both mentioned
    if (score > 30) {
      score += 20
      reasons.push('Multi-neighbor geopolitics (+20)')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 8: Trending topics boost
  // ═══════════════════════════════════════════════════════════════════════════

  const now = new Date()
  for (const topic of TRENDING_TOPICS) {
    if (topic.expiresAt && now > topic.expiresAt) continue

    for (const pattern of topic.patterns) {
      if (text.includes(pattern.toLowerCase())) {
        score += topic.boost
        reasons.push(`Trending: ${pattern} (+${topic.boost})`)
        break
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL: Normalize score and determine priority
  // ═══════════════════════════════════════════════════════════════════════════

  // Clamp score to 0-100
  score = Math.max(0, Math.min(SCORING_CONFIG.MAX_SCORE, score))

  // Determine relevance
  const isRelevant = score >= SCORING_CONFIG.MIN_RELEVANCE_THRESHOLD

  // Determine priority level
  let priority: 'critical' | 'high' | 'medium' | 'low'
  if (score >= 80) priority = 'critical'
  else if (score >= SCORING_CONFIG.HIGH_PRIORITY_THRESHOLD) priority = 'high'
  else if (score >= 40) priority = 'medium'
  else priority = 'low'

  return {
    isRelevant,
    score,
    neighborCountry,
    reasons,
    priority
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveStory {
  id: string
  title: string
  source_id: string
  source_type?: string
  url: string
  published_at?: string
  nepal_relevance?: string
  timestamp: string
  // Consolidated intelligence fields (populated after processing)
  consolidated_id?: string
  source_count?: number
  severity?: string
  story_type?: string
  entities?: Array<{ name: string; type: string }>
  is_consolidated?: boolean
  // Palantir-grade relevance scoring (new)
  neighbor_country?: 'india' | 'china' | null
  relevance_score?: number                           // 0-100 weighted score
  relevance_priority?: 'critical' | 'high' | 'medium' | 'low'
  relevance_reasons?: string[]                       // Explainable scoring
}

export interface LiveAlert {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'danger' | 'warning' | 'watch' | 'normal'
  description?: string
  entities?: string[]
  timestamp: string
  source_url?: string   // URL to the original story
  source_id?: string    // Source identifier
  // Dynamic intelligence alert fields
  hazard_type?: string  // story_type: political, security, disaster, crime, etc.
  district?: string     // Primary district name
  is_active?: boolean   // Whether alert is still active
  source_count?: number // Number of corroborating sources
}

export interface ConsolidatedIntel {
  story_id: string
  consolidated_id: string
  headline: string
  source_count: number
  is_new_story: boolean
  severity: string
  story_type?: string
  entities: Array<{ name: string; type: string }>
  source: string
  url?: string
  nepal_relevance?: string
  timestamp: string
}

export interface ThreatMatrixUpdate {
  story_type: string
  severity: string
  story_id: string
}

export interface EntityUpdate {
  story_id: string
  entities: Array<{ name: string; type: string }>
}

// Threat matrix category counts by severity
export interface ThreatMatrixCounts {
  political: { critical: number; high: number; medium: number; low: number }
  security: { critical: number; high: number; medium: number; low: number }
  disaster: { critical: number; high: number; medium: number; low: number }
  economic: { critical: number; high: number; medium: number; low: number }
  social: { critical: number; high: number; medium: number; low: number }
}

// Entity mention tracking for Key Actors
export interface EntityMention {
  name: string
  type: string
  count: number
  lastSeen: string
}

interface RealtimeState {
  // Connection state
  isConnected: boolean
  lastConnectedAt: string | null

  // Live data
  liveStories: LiveStory[]
  liveAlerts: LiveAlert[]

  // Real-time threat matrix delta (counts changes since last API fetch)
  threatMatrixDelta: ThreatMatrixCounts

  // Real-time entity mentions (recent activity)
  recentEntityMentions: EntityMention[]

  // Unread counts
  unreadStories: number
  unreadAlerts: number

  // Data version - increments when new data arrives (for triggering component refreshes)
  dataVersion: number
  threatMatrixVersion: number
  keyActorsVersion: number
  lastDataReceivedAt: string | null

  // Settings
  maxStoriesInFeed: number
  maxAlertsInFeed: number
  isPaused: boolean

  // Actions
  setConnected: (connected: boolean) => void
  addStory: (data: Record<string, unknown>) => void
  addRealtimeStory: (data: Record<string, unknown>) => void
  addConsolidatedStories: (stories: LiveStory[]) => void
  addAlert: (data: Record<string, unknown>) => void
  upsertConsolidatedIntel: (intel: ConsolidatedIntel) => void
  updateThreatMatrix: (update: ThreatMatrixUpdate) => void
  updateEntityMentions: (update: EntityUpdate) => void
  clearStories: () => void
  clearAlerts: () => void
  markStoriesRead: () => void
  markAlertsRead: () => void
  setPaused: (paused: boolean) => void
  incrementDataVersion: () => void
  resetThreatMatrixDelta: () => void
}

const initialThreatMatrix: ThreatMatrixCounts = {
  political: { critical: 0, high: 0, medium: 0, low: 0 },
  security: { critical: 0, high: 0, medium: 0, low: 0 },
  disaster: { critical: 0, high: 0, medium: 0, low: 0 },
  economic: { critical: 0, high: 0, medium: 0, low: 0 },
  social: { critical: 0, high: 0, medium: 0, low: 0 },
}

// Safe date parser - returns 0 for invalid dates
const safeGetTime = (timestamp: string | null | undefined): number => {
  if (!timestamp) return 0
  try {
    const time = new Date(timestamp).getTime()
    return isNaN(time) ? 0 : time
  } catch {
    return 0
  }
}

// Filter out stories older than the cache age
const filterStaleData = <T extends { timestamp: string }>(items: T[], maxAgeMs: number): T[] => {
  const cutoff = Date.now() - maxAgeMs
  return items.filter(item => safeGetTime(item.timestamp) > cutoff)
}

export const useRealtimeStore = create<RealtimeState>()(
  persist(
    (set, get) => ({
  // Initial state
  isConnected: false,
  lastConnectedAt: null,
  liveStories: [],
  liveAlerts: [],
  threatMatrixDelta: { ...initialThreatMatrix },
  recentEntityMentions: [],
  unreadStories: 0,
  unreadAlerts: 0,
  dataVersion: 0,
  threatMatrixVersion: 0,
  keyActorsVersion: 0,
  lastDataReceivedAt: null,
  maxStoriesInFeed: 100,
  maxAlertsInFeed: 50,
  isPaused: false,

  // Actions
  setConnected: (connected) => {
    set({
      isConnected: connected,
      lastConnectedAt: connected ? new Date().toISOString() : get().lastConnectedAt,
    })
  },

  addStory: (data) => {
    if (get().isPaused) return

    const title = (data.title as string) || 'Untitled'
    const sourceId = (data.source_id as string) || 'unknown'
    const url = (data.url as string) || ''
    const storyId = (data.id as string) || `story_${Date.now()}`

    // STEP 1: Palantir-grade relevance scoring (do this first to get score)
    const relevanceResult = computeNepalRelevanceScore(title, sourceId)

    // Skip non-Nepal-relevant stories
    if (!relevanceResult.isRelevant) {
      return
    }

    // No similar story merging in the client: keep the feed as a pure rendering layer.
    const story: LiveStory = {
      id: storyId,
      title,
      source_id: sourceId,
      source_type: data.source_type as string,
      url,
      published_at: data.published_at as string,
      nepal_relevance: data.nepal_relevance as string,
      timestamp: new Date().toISOString(),
      // Palantir-grade scoring fields
      neighbor_country: relevanceResult.neighborCountry,
      relevance_score: relevanceResult.score,
      relevance_priority: relevanceResult.priority,
      relevance_reasons: relevanceResult.reasons,
      source_count: 1,
      is_consolidated: false,
    }

    set((state) => {
      // Final ID-based duplicate check (in case of race condition)
      if (state.liveStories.some(s => s.id === story.id)) {
        return state
      }

      const newStories = [story, ...state.liveStories].slice(0, state.maxStoriesInFeed)
      return {
        liveStories: newStories,
        unreadStories: state.unreadStories + 1,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  // Add consolidated stories directly without relevance filtering
  // (these are already validated/filtered on the backend)
  addConsolidatedStories: (stories) => {
    if (get().isPaused) return

    set((state) => {
      // Filter out duplicates by ID
      const existingIds = new Set(state.liveStories.map(s => s.id))
      const newStories = stories.filter(s => !existingIds.has(s.id))

      if (newStories.length === 0) return state

      const mergedStories = [...newStories, ...state.liveStories]
        .sort((a, b) => safeGetTime(b.timestamp) - safeGetTime(a.timestamp))
        .slice(0, state.maxStoriesInFeed)

      return {
        liveStories: mergedStories,
        unreadStories: state.unreadStories + newStories.length,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  // Add a single real-time story from WebSocket (no relevance filtering)
  // Backend already filters for Nepal-relevant stories before broadcasting
  addRealtimeStory: (data) => {
    if (get().isPaused) return

    const title = (data.title as string) || 'Untitled'
    const sourceId = (data.source_id as string) || 'unknown'
    const url = (data.url as string) || ''
    const storyId = (data.id as string) || `story_${Date.now()}`

    // Check for duplicates by ID or URL
    const existingStories = get().liveStories
    if (existingStories.some(s => s.id === storyId || (url && s.url === url))) {
      return
    }

    // Create new story
    const story: LiveStory = {
      id: storyId,
      title,
      source_id: sourceId,
      source_type: data.source_type as string,
      url,
      published_at: data.published_at as string,
      nepal_relevance: data.nepal_relevance as string,
      timestamp: new Date().toISOString(),
      source_count: 1,
      is_consolidated: false,
      relevance_score: 80, // Default high score for real-time (backend pre-filtered)
      relevance_priority: 'high',
    }

    set((state) => {
      const newStories = [story, ...state.liveStories].slice(0, state.maxStoriesInFeed)
      return {
        liveStories: newStories,
        unreadStories: state.unreadStories + 1,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  addAlert: (data) => {
    if (get().isPaused) return

    const alert: LiveAlert = {
      id: (data.id as string) || `alert_${Date.now()}`,
      title: (data.title as string) || 'Alert',
      severity: (data.severity as LiveAlert['severity']) || 'medium',
      description: data.description as string,
      entities: data.entities as string[],
      timestamp: (data.timestamp as string) || new Date().toISOString(),
      source_url: data.source_url as string,
      source_id: data.source_id as string,
      hazard_type: data.hazard_type as string,
      district: data.district as string,
      is_active: data.is_active as boolean,
      source_count: data.source_count as number,
    }

    set((state) => {
      // Check for duplicates
      if (state.liveAlerts.some(a => a.id === alert.id)) {
        return state
      }

      const newAlerts = [alert, ...state.liveAlerts].slice(0, state.maxAlertsInFeed)
      return {
        liveAlerts: newAlerts,
        unreadAlerts: state.unreadAlerts + 1,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  upsertConsolidatedIntel: (intel: ConsolidatedIntel) => {
    if (get().isPaused) return

    set((state) => {
      const consolidatedId = intel.consolidated_id || intel.story_id

      // Match by consolidated_id (preferred) and fall back to legacy story_id matching
      const matchIndex = state.liveStories.findIndex(
        (s) => s.id === consolidatedId || s.consolidated_id === consolidatedId || s.id === intel.story_id
      )

      const timestamp = intel.timestamp || new Date().toISOString()
      const priorityFromSeverity =
        intel.severity === 'critical'
          ? 'critical'
          : intel.severity === 'high'
          ? 'high'
          : intel.severity === 'medium'
          ? 'medium'
          : 'low'

      const updated: LiveStory = matchIndex >= 0
        ? {
            ...state.liveStories[matchIndex],
            id: consolidatedId,
            consolidated_id: consolidatedId,
            title: intel.headline || state.liveStories[matchIndex].title,
            source_id: state.liveStories[matchIndex].source_id || intel.source || 'multiple',
            url: state.liveStories[matchIndex].url || intel.url || '',
            timestamp,
            source_count: intel.source_count || state.liveStories[matchIndex].source_count,
            severity: intel.severity,
            story_type: intel.story_type,
            entities: intel.entities,
            is_consolidated: true,
            relevance_priority: priorityFromSeverity,
          }
        : {
            id: consolidatedId,
            consolidated_id: consolidatedId,
            title: intel.headline || 'Untitled',
            source_id: intel.source || 'multiple',
            url: intel.url || '',
            timestamp,
            source_count: intel.source_count || 1,
            severity: intel.severity,
            story_type: intel.story_type,
            entities: intel.entities,
            is_consolidated: true,
            relevance_priority: priorityFromSeverity,
            relevance_score: undefined,
            relevance_reasons: undefined,
          }

      const nextStories = [...state.liveStories]
      const unreadDelta = matchIndex >= 0 ? 0 : 1
      if (matchIndex >= 0) nextStories.splice(matchIndex, 1)
      nextStories.unshift(updated)

      return {
        liveStories: nextStories.slice(0, state.maxStoriesInFeed),
        unreadStories: state.unreadStories + unreadDelta,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  updateThreatMatrix: (update: ThreatMatrixUpdate) => {
    const { story_type, severity } = update

    // Map story_type to threat matrix category
    const categoryMap: Record<string, keyof ThreatMatrixCounts> = {
      political: 'political',
      security: 'security',
      disaster: 'disaster',
      economic: 'economic',
      social: 'social',
    }

    const category = categoryMap[story_type]
    if (!category) {
      return
    }

    const severityKey = severity as 'critical' | 'high' | 'medium' | 'low'
    if (!['critical', 'high', 'medium', 'low'].includes(severityKey)) {
      return
    }

    set((state) => {
      const newDelta = { ...state.threatMatrixDelta }
      newDelta[category] = {
        ...newDelta[category],
        [severityKey]: newDelta[category][severityKey] + 1,
      }

      return {
        threatMatrixDelta: newDelta,
        threatMatrixVersion: state.threatMatrixVersion + 1,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  updateEntityMentions: (update: EntityUpdate) => {
    set((state) => {
      const now = new Date().toISOString()
      const existingMentions = new Map(
        state.recentEntityMentions.map(e => [e.name.toLowerCase(), e])
      )

      // Update or add entities
      for (const entity of update.entities) {
        const key = entity.name.toLowerCase()
        const existing = existingMentions.get(key)
        if (existing) {
          existingMentions.set(key, {
            ...existing,
            count: existing.count + 1,
            lastSeen: now,
          })
        } else {
          existingMentions.set(key, {
            name: entity.name,
            type: entity.type,
            count: 1,
            lastSeen: now,
          })
        }
      }

      // Sort by count and keep top 20
      const sortedMentions = Array.from(existingMentions.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)

      return {
        recentEntityMentions: sortedMentions,
        keyActorsVersion: state.keyActorsVersion + 1,
        dataVersion: state.dataVersion + 1,
        lastDataReceivedAt: new Date().toISOString(),
      }
    })
  },

  clearStories: () => {
    set({ liveStories: [], unreadStories: 0 })
  },

  clearAlerts: () => {
    set({ liveAlerts: [], unreadAlerts: 0 })
  },

  markStoriesRead: () => {
    set({ unreadStories: 0 })
  },

  markAlertsRead: () => {
    set({ unreadAlerts: 0 })
  },

  setPaused: (paused) => {
    set({ isPaused: paused })
  },

  incrementDataVersion: () => {
    set((state) => ({
      dataVersion: state.dataVersion + 1,
      lastDataReceivedAt: new Date().toISOString(),
    }))
  },

  resetThreatMatrixDelta: () => {
    set({ threatMatrixDelta: { ...initialThreatMatrix } })
  },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields (not connection state or versions)
      // Note: liveAlerts not persisted - always fetch fresh from dynamic alerts API
      partialize: (state) => ({
        liveStories: state.liveStories,
        recentEntityMentions: state.recentEntityMentions,
        lastDataReceivedAt: state.lastDataReceivedAt,
      }),
      // Filter out stale data when rehydrating from localStorage
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Filter out stories older than 1 hour
          state.liveStories = filterStaleData(state.liveStories, MAX_CACHE_AGE_MS)
          // Alerts are always fetched fresh from dynamic alerts API, never from cache
          state.liveAlerts = []
          // Reset unread counts since we're loading from cache
          state.unreadStories = 0
          state.unreadAlerts = 0
          // Restored stories from cache; alerts fetched fresh
        }
      },
    }
  )
)
