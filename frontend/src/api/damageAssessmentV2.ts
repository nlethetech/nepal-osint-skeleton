/**
 * Damage Assessment v2 API Client
 *
 * Separate from v1. Types + API functions for enhanced PWTT endpoints.
 */

import axios from 'axios';
import { useAuthStore } from '../store/slices/authSlice';
import type { QuickAnalyzeResult } from './damageAssessment';

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);
const EXPLICIT_API_BASE = (import.meta.env.VITE_API_URL || '').trim();

function normalizeBase(rawBase: string): string {
  const trimmed = rawBase.trim();
  if (!trimmed) {
    if (typeof window !== 'undefined' && LOCALHOST_HOSTNAMES.has(window.location.hostname)) {
      return 'http://localhost:8000';
    }
    return typeof window !== 'undefined' ? window.location.origin : '';
  }
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (withoutTrailingSlash.endsWith('/api/v1')) return withoutTrailingSlash.slice(0, -7);
  if (withoutTrailingSlash.endsWith('/api')) return withoutTrailingSlash.slice(0, -4);
  return withoutTrailingSlash;
}

const API_BASE = normalizeBase(EXPLICIT_API_BASE);

const apiV2 = axios.create({
  baseURL: `${API_BASE}/api/v1/damage-assessment-v2`,
});

apiV2.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiV2.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type SizeClass = 'large' | 'medium' | 'small' | 'sub_pixel';

export interface BuildingDamageFeatureV2 {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    // v1 fields
    mean_t_stat: number;
    max_t_stat: number;
    severity: 'undamaged' | 'moderate' | 'severe' | 'critical';
    centroid_lat: number;
    centroid_lng: number;
    area_m2: number;
    // v2 additions
    p90_t_stat: number;
    std_t_stat: number;
    vv_t_stat: number;
    vh_t_stat: number;
    quadratic_t: number;
    pixel_count: number;
    size_class: SizeClass;
    confidence: number; // 0-1
    polarization_agreement: boolean;
    dndvi: number | null;
    dndbi: number | null;
    dnbr: number | null;
    optical_corroboration_count: number;
    temporal_persistence: number | null;
    pre_cv: number;
  };
}

export interface QuickAnalyzeV2Params {
  center_lat: number;
  center_lng: number;
  radius_km: number;
  event_date: string;
  baseline_days?: number;
  post_event_days?: number;
  enable_terrain_flattening?: boolean;
  enable_optical?: boolean;
}

export interface QuickAnalyzeV2Result extends QuickAnalyzeResult {
  algorithm_version: string;
  terrain_flattened: boolean;
  building_damage_v2?: BuildingDamageFeatureV2[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export async function quickAnalyzeV2(params: QuickAnalyzeV2Params): Promise<QuickAnalyzeV2Result> {
  const { data } = await apiV2.post('/quick-analyze', {
    ...params,
    baseline_days: params.baseline_days ?? 365,
    post_event_days: params.post_event_days ?? 60,
    enable_terrain_flattening: params.enable_terrain_flattening ?? true,
    enable_optical: params.enable_optical ?? true,
  });
  return data;
}

export async function runPwttV2(
  assessmentId: string,
  params: {
    baseline_days?: number;
    post_event_days?: number;
    enable_terrain_flattening?: boolean;
    enable_optical?: boolean;
  } = {}
) {
  const { data } = await apiV2.post(`/assessments/${assessmentId}/run-pwtt`, {
    baseline_days: params.baseline_days ?? 365,
    post_event_days: params.post_event_days ?? 60,
    enable_terrain_flattening: params.enable_terrain_flattening ?? true,
    enable_optical: params.enable_optical ?? true,
  });
  return data;
}

/**
 * Check if a building feature has v2 properties.
 */
export function isV2Building(feature: unknown): feature is BuildingDamageFeatureV2 {
  const f = feature as { properties?: { confidence?: unknown; size_class?: unknown } };
  return f?.properties != null && 'confidence' in f.properties && 'size_class' in f.properties;
}
