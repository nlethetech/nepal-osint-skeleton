/**
 * Static party color/name mapping for tracked political Twitter accounts.
 * Used by PoliticalPulseWidget to color-code account activity.
 */

export type AccountCategory = 'politician' | 'journalist' | 'party' | 'official' | 'activist';

export interface PartyInfo {
  party: string;
  shortName: string;
  color: string;
  displayName: string;
  category: AccountCategory;
}

// Party colors
const NC = '#1E88E5';       // Nepali Congress — blue
const UML = '#E53935';      // CPN-UML — red
const MAOIST = '#C62828';   // Maoist Centre — dark red
const RSP = '#FF8F00';      // Rastriya Swatantra Party — amber
const RPP = '#7B1FA2';      // RPP — purple
const INDEPENDENT = '#78909C'; // Independent — blue-grey
const NEWS = '#00897B';     // News/Media — teal
const OFFICIAL = '#1565C0'; // Government/Official — dark blue

export const PARTY_MAP: Record<string, PartyInfo> = {
  // ── Government & Official ──
  ECNOfficial:      { party: 'Government', shortName: 'GOV', color: OFFICIAL, displayName: 'Election Commission', category: 'official' },
  NepaliArmyHQ:     { party: 'Government', shortName: 'GOV', color: OFFICIAL, displayName: 'Nepal Army HQ', category: 'official' },
  BIPADPortal:      { party: 'Government', shortName: 'GOV', color: OFFICIAL, displayName: 'BIPAD Portal', category: 'official' },
  neaborngov:       { party: 'Government', shortName: 'GOV', color: OFFICIAL, displayName: 'Nepal Police HQ', category: 'official' },
  moaborngov:       { party: 'Government', shortName: 'GOV', color: OFFICIAL, displayName: 'Ministry of Home Affairs', category: 'official' },
  SushilaKarki:     { party: 'Independent', shortName: 'IND', color: INDEPENDENT, displayName: 'Sushila Karki', category: 'official' },
  KulmanGhising:    { party: 'Government', shortName: 'GOV', color: OFFICIAL, displayName: 'Kulman Ghising', category: 'official' },

  // ── NC (Nepali Congress) ──
  SherBDeuba:       { party: 'NC', shortName: 'NC', color: NC, displayName: 'Sher Bahadur Deuba', category: 'politician' },
  thapagk:          { party: 'NC', shortName: 'NC', color: NC, displayName: 'Gagan Thapa', category: 'politician' },
  BinodKChaudhary:  { party: 'NC', shortName: 'NC', color: NC, displayName: 'Binod Chaudhary', category: 'politician' },
  NPSaudnc:         { party: 'NC', shortName: 'NC', color: NC, displayName: 'NP Saud', category: 'politician' },
  NCPurnaKhadka:    { party: 'NC', shortName: 'NC', color: NC, displayName: 'Purna Bahadur Khadka', category: 'politician' },
  NepaliCongress:   { party: 'NC', shortName: 'NC', color: NC, displayName: 'Nepali Congress', category: 'party' },

  // ── CPN-UML ──
  kpsharmaoli:      { party: 'UML', shortName: 'UML', color: UML, displayName: 'KP Sharma Oli', category: 'politician' },
  yogesbhattarai:   { party: 'UML', shortName: 'UML', color: UML, displayName: 'Yogesh Bhattarai', category: 'politician' },
  BishnuRimal:      { party: 'UML', shortName: 'UML', color: UML, displayName: 'Bishnu Rimal', category: 'politician' },
  IshwarPokhrel:    { party: 'UML', shortName: 'UML', color: UML, displayName: 'Ishwar Pokhrel', category: 'politician' },
  GokulPBaskota:    { party: 'UML', shortName: 'UML', color: UML, displayName: 'Gokul Baskota', category: 'politician' },
  rlgolchha:        { party: 'UML', shortName: 'UML', color: UML, displayName: 'Rajlakshmi Golchha', category: 'politician' },
  CPNUML:           { party: 'UML', shortName: 'UML', color: UML, displayName: 'CPN-UML', category: 'party' },

  // ── Maoist Centre ──
  cmprachanda:      { party: 'Maoist', shortName: 'MC', color: MAOIST, displayName: 'Pushpa Kamal Dahal', category: 'politician' },
  JSPrabhakar:      { party: 'Maoist', shortName: 'MC', color: MAOIST, displayName: 'Janardan Sharma', category: 'politician' },
  ram_partha:       { party: 'Maoist', shortName: 'MC', color: MAOIST, displayName: 'Ram Karki', category: 'politician' },
  MaoistCentre:     { party: 'Maoist', shortName: 'MC', color: MAOIST, displayName: 'Maoist Centre', category: 'party' },

  // ── RSP (Rastriya Swatantra Party) ──
  hamrorabi:        { party: 'RSP', shortName: 'RSP', color: RSP, displayName: 'Rabi Lamichhane', category: 'politician' },
  SwarnimWagle:     { party: 'RSP', shortName: 'RSP', color: RSP, displayName: 'Swarnim Wagle', category: 'politician' },
  sumnima_udas:     { party: 'RSP', shortName: 'RSP', color: RSP, displayName: 'Sumnima Udas', category: 'politician' },
  Kabindra99:       { party: 'RSP', shortName: 'RSP', color: RSP, displayName: 'Kabindra Burlakoti', category: 'politician' },
  Himalayabiraj:    { party: 'RSP', shortName: 'RSP', color: RSP, displayName: 'Biraj Bhakta Shrestha', category: 'politician' },
  party_swatantra:  { party: 'RSP', shortName: 'RSP', color: RSP, displayName: 'Swatantra Party', category: 'party' },

  // ── RPP ──
  KTnepal:          { party: 'RPP', shortName: 'RPP', color: RPP, displayName: 'Kamal Thapa', category: 'politician' },
  RabindraMishra:   { party: 'RPP', shortName: 'RPP', color: RPP, displayName: 'Rabindra Mishra', category: 'politician' },
  RajendraLingden:  { party: 'RPP', shortName: 'RPP', color: RPP, displayName: 'Rajendra Lingden', category: 'politician' },
  DrPrakashChan1:   { party: 'RPP', shortName: 'RPP', color: RPP, displayName: 'Prakash C. Lohani', category: 'politician' },
  RPPNepal:         { party: 'RPP', shortName: 'RPP', color: RPP, displayName: 'RPP', category: 'party' },

  // ── Independent / Other ──
  BalenShah_:       { party: 'Independent', shortName: 'IND', color: INDEPENDENT, displayName: 'Balen Shah', category: 'politician' },
  brb1954:          { party: 'Socialist', shortName: 'SOC', color: '#F57C00', displayName: 'Baburam Bhattarai', category: 'politician' },
  HarkaSampang:     { party: 'Independent', shortName: 'IND', color: INDEPENDENT, displayName: 'Harka Sampang', category: 'politician' },
  brtdhl:           { party: 'Independent', shortName: 'IND', color: INDEPENDENT, displayName: 'Bharat Dahal', category: 'politician' },

  // ── Activists ──
  MahabirPun:       { party: 'Independent', shortName: 'IND', color: INDEPENDENT, displayName: 'Mahabir Pun', category: 'activist' },
  SudanGurung:      { party: 'Independent', shortName: 'IND', color: INDEPENDENT, displayName: 'Sudan Gurung', category: 'activist' },

  // ── News / Media ──
  kathmandupost:    { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Kathmandu Post', category: 'journalist' },
  OnlineKhabar:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Online Khabar', category: 'journalist' },
  BBCNepali:        { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'BBC Nepali', category: 'journalist' },
  eaborngov:        { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Ekantipur', category: 'journalist' },
  RatopatiNews:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Ratopati', category: 'journalist' },
  RepublicaEng:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Republica', category: 'journalist' },

  // ── Journalists & Analysts ──
  sudheerktm:       { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Sudheer Sharma', category: 'journalist' },
  realpbhattarai:   { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Pradip Bhattarai', category: 'journalist' },
  Vijaykumarko:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Vijay Kumar Panday', category: 'journalist' },
  kundadixit:       { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Kunda Dixit', category: 'journalist' },
  romangautam:      { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Roman Gautam', category: 'journalist' },
  bhadrarukum:      { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Bhadra Sharma', category: 'journalist' },
  kishorenepal:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Kishore Nepal', category: 'journalist' },
  RameshBhushal:    { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Ramesh Bhushal', category: 'journalist' },
  KoshRKoirala:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Kosh R Koirala', category: 'journalist' },
  NepaliComment:    { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Dipesh Tripathi', category: 'journalist' },
  rabirajbaral:     { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Rabi Raj Baral', category: 'journalist' },
  Cvaanee:          { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Shivanee Thapa', category: 'journalist' },
  biswasktm:        { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Biswas Baral', category: 'journalist' },
  shwetha19S:       { party: 'Media', shortName: 'NEWS', color: NEWS, displayName: 'Shwetha Srikanthan', category: 'journalist' },
};

const FALLBACK: PartyInfo = {
  party: 'Unknown',
  shortName: '?',
  color: '#546E7A',
  displayName: '',
  category: 'politician',
};

/** Lookup with graceful fallback for unknown handles. */
export function getPartyInfo(username: string): PartyInfo {
  const info = PARTY_MAP[username];
  if (info) return info;
  return { ...FALLBACK, displayName: `@${username}` };
}
