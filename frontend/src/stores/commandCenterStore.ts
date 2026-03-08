/**
 * Command Center Store — Stub for open-source skeleton
 */
import { create } from 'zustand';

interface CommandCenterState {
  drawnPolygons: Array<{ id: string; coordinates: Array<{ lat: number; lng: number }> }>;
  filters: Record<string, unknown>;
  addPolygon: (polygon: { id: string; coordinates: Array<{ lat: number; lng: number }> }) => void;
  removePolygon: (id: string) => void;
  clearPolygons: () => void;
}

export const useCommandCenterStore = create<CommandCenterState>((set, get) => ({
  drawnPolygons: [],
  filters: {},
  addPolygon: (polygon) =>
    set({ drawnPolygons: [...get().drawnPolygons, polygon] }),
  removePolygon: (id) =>
    set({ drawnPolygons: get().drawnPolygons.filter((p) => p.id !== id) }),
  clearPolygons: () => set({ drawnPolygons: [] }),
}));
