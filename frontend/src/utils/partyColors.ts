/**
 * Canonical party color map for Nepal elections.
 * Import this everywhere instead of defining colors per-widget.
 */

// Exact party name → color
export const PARTY_COLORS: Record<string, string> = {
  // RSP — Sky Blue
  'Rastriya Swatantra Party': '#38BDF8',
  'राष्ट्रिय स्वतन्त्र पार्टी': '#38BDF8',
  'RSP': '#38BDF8',

  // Nepali Congress — Green
  'Nepali Congress': '#22C55E',
  'नेपाली काँग्रेस': '#22C55E',
  'NC': '#22C55E',

  // NCP (Nepali Communist Party) — Communist Red
  'Nepali Communist Party': '#DC2626',
  'नेपाली कम्युनिष्ट पार्टी': '#DC2626',
  'NCP': '#DC2626',

  // CPN-UML — Maroon
  'CPN-UML': '#991B1B',
  'CPN (UML)': '#991B1B',
  'नेपाल कम्युनिष्ट पार्टी (एकीकृत मार्क्सवादी लेनिनवादी)': '#991B1B',
  'UML': '#991B1B',

  // CPN-Maoist Centre — Dark Red
  'CPN-Maoist Centre': '#7F1D1D',
  'CPN (Maoist Centre)': '#7F1D1D',

  // CPN-Unified Socialist
  'CPN-Unified Socialist': '#B91C1C',
  'CPN (Unified Socialist)': '#B91C1C',

  // Shram Sanskriti Party — Sand
  'Shram Sanskriti Party': '#D4A76A',
  'श्रम संस्कृति पार्टी': '#D4A76A',
  'SSP': '#D4A76A',
  'SHR': '#D4A76A',

  // RPP — Sand-orange
  'Rastriya Prajatantra Party': '#D97706',
  'राष्ट्रिय प्रजातन्त्र पार्टी': '#D97706',
  'RPP': '#D97706',

  // Others — neutral gray
  'Janata Samajbadi Party': '#6B7280',
  'JSP': '#6B7280',
  'Janamat Party': '#6B7280',
  'Loktantrik Samajwadi Party': '#6B7280',
  'Nagarik Unmukti Party': '#6B7280',
  'Independent': '#6B7280',
  'IND': '#6B7280',
  'राष्ट्रिय परिवर्तन पार्टी': '#6B7280',
  'RPaP': '#6B7280',
  'नेपाल मजदुर किसान पार्टी': '#6B7280',
  'NMKP': '#6B7280',
  'जनता समाजवादी पार्टी, नेपाल': '#6B7280',
};

const DEFAULT_COLOR = '#6B7280';

export function getPartyColor(party: string): string {
  if (PARTY_COLORS[party]) return PARTY_COLORS[party];

  const lower = party.toLowerCase();
  if (lower.includes('swatantra') || lower.includes('rsp')) return '#38BDF8';
  if (lower.includes('congress')) return '#22C55E';
  if (lower.includes('nepali communist') || lower === 'ncp') return '#DC2626';
  if (lower.includes('uml')) return '#991B1B';
  if (lower.includes('maoist')) return '#7F1D1D';
  if (lower.includes('unified socialist')) return '#B91C1C';
  if (lower.includes('shram') || lower.includes('sanskriti')) return '#D4A76A';
  if (lower.includes('prajatantra') || lower.includes('rpp')) return '#D97706';

  return DEFAULT_COLOR;
}

// Short label helper
const SHORT_NAMES: Record<string, string> = {
  'Rastriya Swatantra Party': 'RSP',
  'राष्ट्रिय स्वतन्त्र पार्टी': 'RSP',
  'Nepali Congress': 'NC',
  'नेपाली काँग्रेस': 'NC',
  'CPN-UML': 'UML',
  'CPN (UML)': 'UML',
  'नेपाल कम्युनिष्ट पार्टी (एकीकृत मार्क्सवादी लेनिनवादी)': 'UML',
  'Nepali Communist Party': 'NCP',
  'नेपाली कम्युनिष्ट पार्टी': 'NCP',
  'CPN-Maoist Centre': 'MC',
  'CPN (Maoist Centre)': 'MC',
  'CPN-Unified Socialist': 'US',
  'CPN (Unified Socialist)': 'US',
  'Rastriya Prajatantra Party': 'RPP',
  'राष्ट्रिय प्रजातन्त्र पार्टी': 'RPP',
  'Shram Sanskriti Party': 'SSP',
  'श्रम संस्कृति पार्टी': 'SSP',
  'Janata Samajbadi Party': 'JSP',
  'जनता समाजवादी पार्टी, नेपाल': 'JSP',
  'Janamat Party': 'JP',
  'Loktantrik Samajwadi Party': 'LSP',
  'Nagarik Unmukti Party': 'NUP',
  'Independent': 'IND',
  'राष्ट्रिय परिवर्तन पार्टी': 'RPaP',
  'नेपाल मजदुर किसान पार्टी': 'NMKP',
};

export function getPartyTextColor(partyName: string | null | undefined): string {
  if (!partyName) return '#FFFFFF';
  const bg = getPartyColor(partyName);
  if (['#22C55E', '#38BDF8', '#D4A76A', '#D97706'].includes(bg)) return '#000000';
  return '#FFFFFF';
}

export const PARTY_LEGEND = [
  { key: 'RSP', name: 'Rastriya Swatantra', color: '#38BDF8' },
  { key: 'NC', name: 'Nepali Congress', color: '#22C55E' },
  { key: 'NCP', name: 'Nepali Communist Party', color: '#DC2626' },
  { key: 'UML', name: 'CPN-UML', color: '#991B1B' },
  { key: 'Maoist', name: 'CPN-Maoist', color: '#7F1D1D' },
  { key: 'RPP', name: 'RPP', color: '#D97706' },
  { key: 'SSP', name: 'Shram Sanskriti', color: '#D4A76A' },
  { key: 'Others', name: 'Others', color: '#6B7280' },
];

export function getPartyShortLabel(party: string): string {
  if (SHORT_NAMES[party]) return SHORT_NAMES[party];
  const lower = party.toLowerCase();
  if (lower.includes('swatantra') || lower.includes('rsp')) return 'RSP';
  if (lower.includes('congress')) return 'NC';
  if (lower.includes('nepali communist') || lower === 'ncp') return 'NCP';
  if (lower.includes('uml')) return 'UML';
  if (lower.includes('maoist')) return 'MC';
  if (lower.includes('unified socialist')) return 'US';
  if (lower.includes('prajatantra') || lower.includes('rpp')) return 'RPP';
  if (lower.includes('shram') || lower.includes('sanskriti')) return 'SSP';
  if (lower.includes('samajbadi') || lower.includes('jsp')) return 'JSP';
  if (lower.includes('janamat')) return 'JP';
  if (lower.includes('independent')) return 'IND';
  return party.slice(0, 3).toUpperCase();
}
