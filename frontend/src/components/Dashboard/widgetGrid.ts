export type WidgetSize =
  | 'brief'
  | 'situation'
  | 'command'
  | 'hero'
  | 'full'
  | 'wide'
  | 'large'
  | 'half'
  | 'medium'
  | 'third'
  | 'small'
  | 'quarter'
  | 'mini'
  | 'compact'
  | 'slim';

export type WidgetDimensions = {
  cols: number;
  rows: number;
};

export const SIZE_MAP: Record<WidgetSize, WidgetDimensions> = {
  mini: { cols: 3, rows: 3 },
  quarter: { cols: 3, rows: 4 },
  compact: { cols: 4, rows: 3 },
  small: { cols: 4, rows: 4 },
  third: { cols: 4, rows: 5 },
  slim: { cols: 6, rows: 3 },
  medium: { cols: 6, rows: 4 },
  half: { cols: 6, rows: 5 },
  large: { cols: 8, rows: 4 },
  wide: { cols: 8, rows: 5 },
  full: { cols: 12, rows: 4 },
  hero: { cols: 12, rows: 7 },
  situation: { cols: 12, rows: 8 },
  brief: { cols: 12, rows: 9 },
  command: { cols: 12, rows: 10 },
};

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function clampWidgetDimensions(dimensions: WidgetDimensions): WidgetDimensions {
  return {
    cols: clamp(dimensions.cols, 3, 12),
    rows: clamp(dimensions.rows, 3, 12),
  };
}

export function findNearestPreset(targetCols: number, targetRows: number): WidgetSize {
  let bestSize: WidgetSize = 'medium';
  let bestDist = Infinity;

  for (const [size, { cols, rows }] of Object.entries(SIZE_MAP)) {
    const dist = Math.abs(cols - targetCols) * 1.5 + Math.abs(rows - targetRows);
    if (dist < bestDist) {
      bestDist = dist;
      bestSize = size as WidgetSize;
    }
  }

  return bestSize;
}

export function dimensionsFromSize(size: WidgetSize): WidgetDimensions {
  return SIZE_MAP[size] || SIZE_MAP.medium;
}

export function dimensionsFromSizes(sizes: Record<string, WidgetSize>): Record<string, WidgetDimensions> {
  return Object.fromEntries(
    Object.entries(sizes).map(([widgetId, size]) => [widgetId, dimensionsFromSize(size)]),
  );
}
