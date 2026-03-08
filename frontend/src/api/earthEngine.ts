/**
 * Earth Engine API — Stub for open-source skeleton
 */

export type SatelliteLayerType =
  | 'sentinel2-rgb'
  | 'sentinel2-false-color'
  | 'ndvi'
  | 'temperature'
  | 'precipitation'
  | 'flood-extent';

export interface LayerInfoEntry {
  name: string;
  description: string;
  unit?: string;
}

export const LAYER_INFO: Record<SatelliteLayerType, LayerInfoEntry> = {
  'sentinel2-rgb': { name: 'Sentinel-2 RGB', description: 'True color satellite imagery' },
  'sentinel2-false-color': { name: 'False Color', description: 'False color composite' },
  ndvi: { name: 'NDVI', description: 'Vegetation index', unit: 'index' },
  temperature: { name: 'Temperature', description: 'Land surface temperature', unit: 'C' },
  precipitation: { name: 'Precipitation', description: 'Rainfall data', unit: 'mm' },
  'flood-extent': { name: 'Flood Extent', description: 'Detected flood areas' },
};

export function getTileUrl(
  layerType: SatelliteLayerType,
  _date?: string,
  _bbox?: string | [number, number, number, number],
): string {
  return `/api/v1/gee/tiles/${layerType}/{z}/{x}/{y}`;
}
