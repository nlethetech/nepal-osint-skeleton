/**
 * Gandaki Province Data and Constants
 *
 * Contains district information, coordinates, and configuration
 * for the Gandaki Province Dashboard.
 */

export const GANDAKI_DISTRICTS = [
  'Gorkha', 'Manang', 'Mustang', 'Myagdi', 'Kaski',
  'Lamjung', 'Tanahu', 'Nawalparasi East', 'Syangja', 'Parbat', 'Baglung'
] as const

export type GandakiDistrict = typeof GANDAKI_DISTRICTS[number]

export interface DistrictInfo {
  name: GandakiDistrict
  nameNe: string
  lat: number
  lng: number
  area: number // sq km
  population: number // approximate
  headquarters: string
}

export const GANDAKI_DISTRICT_DATA: DistrictInfo[] = [
  { name: 'Gorkha', nameNe: 'गोरखा', lat: 28.0, lng: 84.6333, area: 3610, population: 271000, headquarters: 'Gorkha Bazaar' },
  { name: 'Manang', nameNe: 'मनाङ', lat: 28.6667, lng: 84.0167, area: 2246, population: 6500, headquarters: 'Chame' },
  { name: 'Mustang', nameNe: 'मुस्ताङ', lat: 28.9985, lng: 83.8473, area: 3573, population: 14000, headquarters: 'Jomsom' },
  { name: 'Myagdi', nameNe: 'म्याग्दी', lat: 28.5667, lng: 83.5, area: 2297, population: 114000, headquarters: 'Beni' },
  { name: 'Kaski', nameNe: 'कास्की', lat: 28.2096, lng: 83.9856, area: 2017, population: 493000, headquarters: 'Pokhara' },
  { name: 'Lamjung', nameNe: 'लमजुङ', lat: 28.2833, lng: 84.3667, area: 1692, population: 167000, headquarters: 'Besisahar' },
  { name: 'Tanahu', nameNe: 'तनहुँ', lat: 27.9333, lng: 84.25, area: 1546, population: 324000, headquarters: 'Damauli' },
  { name: 'Nawalparasi East', nameNe: 'नवलपरासी पूर्व', lat: 27.6, lng: 84.1, area: 1043, population: 315000, headquarters: 'Kawasoti' },
  { name: 'Syangja', nameNe: 'स्याङ्जा', lat: 28.1, lng: 83.85, area: 1164, population: 289000, headquarters: 'Putalibazar' },
  { name: 'Parbat', nameNe: 'पर्वत', lat: 28.35, lng: 83.7, area: 494, population: 147000, headquarters: 'Kusma' },
  { name: 'Baglung', nameNe: 'बागलुङ', lat: 28.2667, lng: 83.5833, area: 1784, population: 268000, headquarters: 'Baglung Bazaar' },
]

// Provincial capital and bounds
export const GANDAKI_CAPITAL = {
  name: 'Pokhara',
  district: 'Kaski' as GandakiDistrict,
  lat: 28.2096,
  lng: 83.9856,
}

export const GANDAKI_BOUNDS: [[number, number], [number, number]] = [
  [27.4, 83.3], // [south, west]
  [29.2, 84.6], // [north, east]
]

export const GANDAKI_CENTER = {
  lat: 28.25,
  lng: 84.0,
  zoom: 8,
}

// Gandaki news sources - matches backend config/sources.yaml
export const GANDAKI_NEWS_SOURCES = [
  'gandaki_ratopati',
  'gandaki_ekantipur',
  'gandaki_onlinekhabar',
  'gandaknews',
  'ganthan_news',
  'pokharahotline',
] as const

// Source names for display
export const GANDAKI_SOURCE_NAMES: Record<string, string> = {
  'gandaki_ratopati': 'Ratopati Gandaki',
  'gandaki_ekantipur': 'eKantipur Gandaki',
  'gandaki_onlinekhabar': 'OnlineKhabar Gandaki',
  'gandaknews': 'Gandak News',
  'ganthan_news': 'Ganthan News',
  'pokharahotline': 'Pokhara Hotline',
}

// Keywords for Gandaki-related content filtering
export const GANDAKI_KEYWORDS = [
  // Province name
  'gandaki', 'gandaki province', 'गण्डकी', 'गण्डकी प्रदेश',
  // Major city
  'pokhara', 'पोखरा',
  // Geographic features
  'annapurna', 'अन्नपूर्ण', 'fewa', 'phewa', 'फेवा',
  'seti river', 'kaligandaki', 'कालीगण्डकी', 'marsyangdi',
  // District names (lowercase)
  ...GANDAKI_DISTRICTS.map(d => d.toLowerCase()),
  // District HQs
  'besisahar', 'damauli', 'kawasoti', 'putalibazar', 'kusma', 'beni', 'jomsom', 'chame',
] as const

// Pre-configured satellite analysis locations
export interface SatelliteLocation {
  id: string
  name: string
  description: string
  lat: number
  lng: number
  bbox: string // minLng,minLat,maxLng,maxLat
  type: 'city' | 'infrastructure' | 'disaster_prone' | 'airport'
}

export const GANDAKI_SATELLITE_LOCATIONS: SatelliteLocation[] = [
  {
    id: 'pokhara-city',
    name: 'Pokhara City',
    description: 'Provincial capital and tourism hub',
    lat: 28.2096,
    lng: 83.9856,
    bbox: '83.93,28.15,84.04,28.27',
    type: 'city',
  },
  {
    id: 'pokhara-airport',
    name: 'Pokhara Airport',
    description: 'International airport',
    lat: 28.2,
    lng: 83.98,
    bbox: '83.96,28.18,84.00,28.22',
    type: 'airport',
  },
  {
    id: 'kaligandaki-dam',
    name: 'Kaligandaki Dam',
    description: 'Hydropower facility',
    lat: 27.95,
    lng: 83.55,
    bbox: '83.52,27.92,83.58,27.98',
    type: 'infrastructure',
  },
  {
    id: 'gorkha-barpak',
    name: 'Gorkha (Barpak)',
    description: '2015 earthquake epicenter area',
    lat: 28.23,
    lng: 84.73,
    bbox: '84.68,28.18,84.78,28.28',
    type: 'disaster_prone',
  },
  {
    id: 'jomsom',
    name: 'Jomsom',
    description: 'Mustang district headquarters',
    lat: 28.78,
    lng: 83.73,
    bbox: '83.70,28.75,83.76,28.81',
    type: 'city',
  },
  {
    id: 'beni',
    name: 'Beni',
    description: 'Myagdi district headquarters',
    lat: 28.35,
    lng: 83.57,
    bbox: '83.54,28.32,83.60,28.38',
    type: 'city',
  },
]

// Time range options for dashboard
export const TIME_RANGE_OPTIONS = [
  { value: '24h', label: '24 Hours' },
  { value: '48h', label: '48 Hours' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
] as const

export type TimeRange = typeof TIME_RANGE_OPTIONS[number]['value']

// Theme colors
export const GANDAKI_THEME = {
  primary: '#3b82f6', // Professional blue
  accent: '#f59e0b', // Amber accent
  background: '#ffffff',
  backgroundSecondary: '#f8fafc',
  text: '#1e293b',
  textMuted: '#64748b',
  border: '#e2e8f0',
}
