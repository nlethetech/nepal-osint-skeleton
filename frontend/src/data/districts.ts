// Nepal Districts with centroids and province info
export interface DistrictInfo {
  name: string
  nameNe?: string
  province: string
  lat: number
  lng: number
}

export const DISTRICTS: DistrictInfo[] = [
  // Province 1 (Koshi)
  { name: "Taplejung", province: "Koshi", lat: 27.35, lng: 87.67 },
  { name: "Panchthar", province: "Koshi", lat: 27.1333, lng: 87.75 },
  { name: "Ilam", province: "Koshi", lat: 26.91, lng: 87.93 },
  { name: "Jhapa", nameNe: "झापा", province: "Koshi", lat: 26.5456, lng: 87.8942 },
  { name: "Morang", nameNe: "मोरङ", province: "Koshi", lat: 26.4525, lng: 87.2718 },
  { name: "Sunsari", nameNe: "सुनसरी", province: "Koshi", lat: 26.8121, lng: 87.2831 },
  { name: "Dhankuta", province: "Koshi", lat: 26.9867, lng: 87.3467 },
  { name: "Terhathum", province: "Koshi", lat: 27.1333, lng: 87.55 },
  { name: "Sankhuwasabha", province: "Koshi", lat: 27.3667, lng: 87.2167 },
  { name: "Bhojpur", province: "Koshi", lat: 27.1833, lng: 87.05 },
  { name: "Solukhumbu", province: "Koshi", lat: 27.7917, lng: 86.6608 },
  { name: "Okhaldhunga", province: "Koshi", lat: 27.3167, lng: 86.5 },
  { name: "Khotang", province: "Koshi", lat: 27.0167, lng: 86.85 },
  { name: "Udayapur", province: "Koshi", lat: 26.9333, lng: 86.5167 },

  // Province 2 (Madhesh)
  { name: "Saptari", province: "Madhesh", lat: 26.6333, lng: 86.7333 },
  { name: "Siraha", province: "Madhesh", lat: 26.65, lng: 86.2 },
  { name: "Dhanusha", nameNe: "धनुषा", province: "Madhesh", lat: 26.729, lng: 85.924 },
  { name: "Mahottari", province: "Madhesh", lat: 26.85, lng: 85.7833 },
  { name: "Sarlahi", province: "Madhesh", lat: 26.97, lng: 85.55 },
  { name: "Rautahat", province: "Madhesh", lat: 27.0, lng: 85.3 },
  { name: "Bara", province: "Madhesh", lat: 27.0, lng: 85.1 },
  { name: "Parsa", nameNe: "पर्सा", province: "Madhesh", lat: 27.0, lng: 84.95 },

  // Bagmati Province
  { name: "Dolakha", province: "Bagmati", lat: 27.7167, lng: 86.0667 },
  { name: "Sindhupalchok", province: "Bagmati", lat: 27.95, lng: 85.7 },
  { name: "Rasuwa", province: "Bagmati", lat: 28.1, lng: 85.3833 },
  { name: "Dhading", province: "Bagmati", lat: 27.8667, lng: 84.9333 },
  { name: "Nuwakot", province: "Bagmati", lat: 27.9167, lng: 85.1667 },
  { name: "Kathmandu", nameNe: "काठमाडौं", province: "Bagmati", lat: 27.7172, lng: 85.324 },
  { name: "Bhaktapur", nameNe: "भक्तपुर", province: "Bagmati", lat: 27.671, lng: 85.4298 },
  { name: "Lalitpur", nameNe: "ललितपुर", province: "Bagmati", lat: 27.6644, lng: 85.3188 },
  { name: "Kavrepalanchok", province: "Bagmati", lat: 27.55, lng: 85.55 },
  { name: "Ramechhap", province: "Bagmati", lat: 27.3333, lng: 86.0667 },
  { name: "Sindhuli", province: "Bagmati", lat: 27.25, lng: 85.9667 },
  { name: "Makwanpur", nameNe: "मकवानपुर", province: "Bagmati", lat: 27.427, lng: 85.032 },
  { name: "Chitwan", nameNe: "चितवन", province: "Bagmati", lat: 27.5291, lng: 84.3542 },

  // Gandaki Province
  { name: "Gorkha", province: "Gandaki", lat: 28.0, lng: 84.6333 },
  { name: "Manang", province: "Gandaki", lat: 28.6667, lng: 84.0167 },
  { name: "Mustang", province: "Gandaki", lat: 28.9985, lng: 83.8473 },
  { name: "Myagdi", province: "Gandaki", lat: 28.5667, lng: 83.5 },
  { name: "Kaski", nameNe: "कास्की", province: "Gandaki", lat: 28.2096, lng: 83.9856 },
  { name: "Lamjung", province: "Gandaki", lat: 28.2833, lng: 84.3667 },
  { name: "Tanahu", province: "Gandaki", lat: 27.9333, lng: 84.25 },
  { name: "Nawalparasi East", province: "Gandaki", lat: 27.6, lng: 84.1 },
  { name: "Syangja", province: "Gandaki", lat: 28.1, lng: 83.85 },
  { name: "Parbat", province: "Gandaki", lat: 28.35, lng: 83.7 },
  { name: "Baglung", province: "Gandaki", lat: 28.2667, lng: 83.5833 },

  // Lumbini Province
  { name: "Nawalparasi West", province: "Lumbini", lat: 27.6, lng: 83.7 },
  { name: "Rupandehi", nameNe: "रुपन्देही", province: "Lumbini", lat: 27.5057, lng: 83.45 },
  { name: "Kapilvastu", province: "Lumbini", lat: 27.5667, lng: 83.05 },
  { name: "Arghakhanchi", province: "Lumbini", lat: 27.95, lng: 83.1333 },
  { name: "Gulmi", province: "Lumbini", lat: 28.0833, lng: 83.2667 },
  { name: "Palpa", province: "Lumbini", lat: 27.8667, lng: 83.5333 },
  { name: "Dang", nameNe: "दाङ", province: "Lumbini", lat: 28.013, lng: 82.365 },
  { name: "Pyuthan", province: "Lumbini", lat: 28.1, lng: 82.85 },
  { name: "Rolpa", province: "Lumbini", lat: 28.4333, lng: 82.65 },
  { name: "Rukum East", province: "Lumbini", lat: 28.6167, lng: 82.55 },
  { name: "Banke", nameNe: "बाँके", province: "Lumbini", lat: 28.05, lng: 81.6167 },
  { name: "Bardiya", province: "Lumbini", lat: 28.3, lng: 81.35 },

  // Karnali Province
  { name: "Rukum West", province: "Karnali", lat: 28.7, lng: 82.4 },
  { name: "Salyan", province: "Karnali", lat: 28.3833, lng: 82.1667 },
  { name: "Dolpa", province: "Karnali", lat: 29.0, lng: 82.8 },
  { name: "Humla", province: "Karnali", lat: 29.9667, lng: 81.9 },
  { name: "Jumla", province: "Karnali", lat: 29.2747, lng: 82.183 },
  { name: "Kalikot", province: "Karnali", lat: 29.1667, lng: 81.6333 },
  { name: "Mugu", province: "Karnali", lat: 29.5, lng: 82.1 },
  { name: "Surkhet", nameNe: "सुर्खेत", province: "Karnali", lat: 28.6, lng: 81.6 },
  { name: "Dailekh", province: "Karnali", lat: 28.8333, lng: 81.7167 },
  { name: "Jajarkot", province: "Karnali", lat: 28.7, lng: 82.2 },

  // Sudurpashchim Province
  { name: "Bajura", province: "Sudurpashchim", lat: 29.45, lng: 81.5 },
  { name: "Bajhang", province: "Sudurpashchim", lat: 29.5333, lng: 81.1833 },
  { name: "Achham", province: "Sudurpashchim", lat: 29.0333, lng: 81.25 },
  { name: "Doti", province: "Sudurpashchim", lat: 29.2333, lng: 80.95 },
  { name: "Kailali", nameNe: "कैलाली", province: "Sudurpashchim", lat: 28.7, lng: 80.6 },
  { name: "Kanchanpur", province: "Sudurpashchim", lat: 28.85, lng: 80.15 },
  { name: "Dadeldhura", province: "Sudurpashchim", lat: 29.3, lng: 80.5833 },
  { name: "Baitadi", province: "Sudurpashchim", lat: 29.5167, lng: 80.4167 },
  { name: "Darchula", province: "Sudurpashchim", lat: 29.85, lng: 80.5333 },
]

export const PROVINCE_COLORS: Record<string, string> = {
  'Koshi': '#3b82f6',
  'Madhesh': '#ef4444',
  'Bagmati': '#22c55e',
  'Gandaki': '#eab308',
  'Lumbini': '#f97316',
  'Karnali': '#8b5cf6',
  'Sudurpashchim': '#06b6d4',
}

export const NEPAL_BOUNDS = {
  center: { lat: 28.3949, lng: 84.124 },
  zoom: 7,
  minZoom: 7,  // Prevent zooming out beyond Nepal view
  maxZoom: 18,
  // Bounding box for Nepal - prevents panning outside
  bounds: {
    south: 26.347,
    west: 80.058,
    north: 30.447,
    east: 88.201,
  },
}

// Province bounding boxes for map zoom (with padding)
// Format: [[south, west], [north, east]]
export const PROVINCE_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  'Koshi': [[26.3, 86.3], [28.0, 88.2]],
  'Madhesh': [[26.4, 84.8], [27.2, 87.0]],
  'Bagmati': [[27.1, 84.1], [28.3, 86.3]],
  'Gandaki': [[27.4, 83.3], [29.2, 84.6]],
  'Lumbini': [[27.3, 81.1], [28.8, 83.8]],
  'Karnali': [[28.2, 81.3], [30.2, 83.0]],
  'Sudurpashchim': [[28.5, 80.0], [30.0, 81.7]],
}

// Helper to get combined bounds for multiple provinces
export function getProvinceBounds(provinces: string[]): [[number, number], [number, number]] | null {
  if (provinces.length === 0) return null

  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180

  for (const province of provinces) {
    const bounds = PROVINCE_BOUNDS[province]
    if (bounds) {
      minLat = Math.min(minLat, bounds[0][0])
      minLng = Math.min(minLng, bounds[0][1])
      maxLat = Math.max(maxLat, bounds[1][0])
      maxLng = Math.max(maxLng, bounds[1][1])
    }
  }

  if (minLat === 90) return null
  return [[minLat, minLng], [maxLat, maxLng]]
}

// List of all provinces
export const PROVINCES = [
  'Koshi', 'Madhesh', 'Bagmati', 'Gandaki',
  'Lumbini', 'Karnali', 'Sudurpashchim'
] as const

export type Province = typeof PROVINCES[number]

// Get districts for a province
export function getDistrictsForProvince(province: Province): string[] {
  return DISTRICTS.filter((d) => d.province === province).map((d) => d.name)
}

// Get districts for multiple provinces
export function getDistrictsForProvinces(provinces: Province[]): string[] {
  return DISTRICTS.filter((d) => provinces.includes(d.province as Province)).map((d) => d.name)
}

// Normalize district name for comparison
export function normalizeDistrictName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace('kavrepalanchowk', 'kavrepalanchok')
    .replace('sindhupalchowk', 'sindhupalchok')
    .replace('kapilbastu', 'kapilvastu')
    .replace('makawanpur', 'makwanpur')  // GeoJSON uses Makawanpur
    // Known variant: some sources use the official spelling "Tanahun"
    // while parts of the UI/data still refer to it as "Tanahu".
    .replace('tanahun', 'tanahu')
    .replace('nawalparasi (bardaghat susta east)', 'nawalparasi east')
    .replace('nawalparasi (bardaghat susta west)', 'nawalparasi west')
    .replace('rukum (east)', 'rukum east')
    .replace('rukum (west)', 'rukum west')
}

// Get province for a district
export function getProvinceForDistrict(districtName: string): string | null {
  const normalized = normalizeDistrictName(districtName)
  const district = DISTRICTS.find(d => normalizeDistrictName(d.name) === normalized)
  return district?.province || null
}
