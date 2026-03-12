/**
 * mapColors.ts - Light theme color palette for map components
 * ===========================================================
 *
 * Live UA Map style - clean, professional, light backgrounds
 * Optimized for light terrain/road maps.
 */

export const MAP_COLORS = {
  severity: {
    CRITICAL: '#dc2626',
    HIGH: '#ea580c',
    MEDIUM: '#ca8a04',
    LOW: '#6b7280',
  },
  category: {
    SECURITY: '#b91c1c',
    POLITICAL: '#1d4ed8',
    ECONOMIC: '#047857',
    INFRASTRUCTURE: '#b45309',
    DISASTER: '#dc2626',
    HEALTH: '#be185d',
    SOCIAL: '#6b21a8',
    ENVIRONMENT: '#0f766e',
    GENERAL: '#4b5563',
  },
  background: {
    marker: '#ffffff',
    tooltip: '#ffffff',
    surface: '#f9fafb',
  },
  border: {
    default: '#e5e7eb',
    subtle: '#f3f4f6',
    strong: '#d1d5db',
  },
  text: {
    primary: '#111827',
    secondary: '#4b5563',
    muted: '#6b7280',
  },
} as const;

export const MAP_SHADOWS = {
  marker: '0 1px 3px rgba(0,0,0,0.1)',
  tooltip: '0 4px 16px rgba(0,0,0,0.12)',
  cluster: '0 2px 8px rgba(0,0,0,0.1)',
} as const;

/**
 * Professional tooltip CSS class
 */
export const TOOLTIP_CLASS = 'professional-tooltip';
