/**
 * Aviation monitoring API client — live aircraft tracking and airport traffic.
 */
import { apiClient } from './client';

// ── Types ──

export type AirspaceCategory = 'in_nepal' | 'near_nepal' | 'nepal_carrier' | 'overflight';

export interface AircraftPosition {
  hex_code: string;
  callsign: string | null;
  registration: string | null;
  aircraft_type: string | null;
  latitude: number;
  longitude: number;
  altitude_ft: number | null;
  ground_speed_kts: number | null;
  track_deg: number | null;
  vertical_rate_fpm: number | null;
  squawk: string | null;
  is_military: boolean;
  is_on_ground: boolean;
  category: string | null;
  airspace_category: AirspaceCategory | null;
  nearest_airport_icao: string | null;
  seen_at: string;
}

export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevation_ft: number;
  type: 'international' | 'domestic' | 'STOL';
}

export interface AirportTraffic {
  icao: string;
  name: string;
  type: 'international' | 'domestic' | 'STOL';
  current_count: number;
  avg_count: number;
  status: 'busier' | 'quieter' | 'normal';
  percent_change: number;
  hourly_counts: number[];
}

export interface HourlyCount {
  hour: string;
  total: number;
  military: number;
}

export interface MilitaryAircraft {
  hex_code: string;
  callsign: string | null;
  registration: string | null;
  aircraft_type: string | null;
  observations: number;
  est_flight_hours: number;
  last_seen: string | null;
  daily_activity: Record<string, number>;
}

export interface MilitaryStats {
  unique_aircraft: number;
  total_observations: number;
  est_total_hours: number;
  aircraft: MilitaryAircraft[];
}

export interface TopAircraft {
  hex_code: string;
  callsign: string | null;
  registration: string | null;
  aircraft_type: string | null;
  is_military: boolean;
  observations: number;
  est_hours: number;
  top_airport: string | null;
}

// ── API Functions ──

export async function getLiveAircraft(militaryOnly = false): Promise<AircraftPosition[]> {
  const params = new URLSearchParams();
  if (militaryOnly) params.set('military_only', 'true');
  const { data } = await apiClient.get(`/aviation/live?${params}`);
  return data.aircraft;
}

export async function getAirports(): Promise<Airport[]> {
  const { data } = await apiClient.get('/aviation/airports');
  return data.airports;
}

export async function getAirportTraffic(): Promise<AirportTraffic[]> {
  const { data } = await apiClient.get('/aviation/traffic');
  return data.traffic;
}

export async function getAircraftHistory(hexCode: string, hours = 24): Promise<{ latitude: number; longitude: number; altitude_ft: number | null; seen_at: string }[]> {
  const { data } = await apiClient.get(`/aviation/history/${hexCode}?hours=${hours}`);
  return data.positions;
}

export async function getHourlyCounts(days = 7): Promise<HourlyCount[]> {
  const { data } = await apiClient.get(`/aviation/analytics/hourly?days=${days}`);
  return data.hourly;
}

export async function getMilitaryStats(days = 7): Promise<MilitaryStats> {
  const { data } = await apiClient.get(`/aviation/analytics/military?days=${days}`);
  return data;
}

export async function getTopAircraft(days = 7, limit = 20): Promise<TopAircraft[]> {
  const { data } = await apiClient.get(`/aviation/analytics/top-aircraft?days=${days}&limit=${limit}`);
  return data.aircraft;
}
