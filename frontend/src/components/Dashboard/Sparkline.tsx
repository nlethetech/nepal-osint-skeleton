import { useMemo } from 'react';

interface SparklineProps {
  data: number[];
  trend?: 'up' | 'down' | 'stable';
  height?: number;
  width?: number;
  strokeWidth?: number;
  showArea?: boolean;
}

/**
 * SVG-based mini chart for KPI visualization.
 * Shows trend line with optional filled area.
 */
export function Sparkline({
  data,
  trend = 'stable',
  height = 24,
  width = 60,
  strokeWidth = 1.5,
  showArea = true,
}: SparklineProps) {
  const { pathD, areaD, color } = useMemo(() => {
    if (!data.length) {
      return { pathD: '', areaD: '', color: 'var(--text-muted)' };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    // Normalize data points to SVG coordinates
    const points = data.map((value, i) => {
      const x = (i / (data.length - 1 || 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return { x, y };
    });

    // Build SVG path
    const pathD = points.reduce((acc, point, i) => {
      if (i === 0) return `M ${point.x} ${point.y}`;
      return `${acc} L ${point.x} ${point.y}`;
    }, '');

    // Build area path (for fill)
    const areaD = pathD + ` L ${width} ${height} L 0 ${height} Z`;

    // Determine color based on trend
    const color =
      trend === 'up'
        ? 'var(--status-critical)'
        : trend === 'down'
          ? 'var(--status-low)'
          : 'var(--accent-primary)';

    return { pathD, areaD, color };
  }, [data, trend, height, width]);

  if (!data.length) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-[9px] text-[var(--text-muted)]"
      >
        No data
      </div>
    );
  }

  return (
    <svg width={width} height={height} className="sparkline">
      {showArea && (
        <path d={areaD} fill={color} fillOpacity={0.15} />
      )}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End point dot */}
      <circle
        cx={width}
        cy={data.length > 0 ? height - ((data[data.length - 1] - Math.min(...data)) / (Math.max(...data) - Math.min(...data) || 1)) * (height - 4) - 2 : height / 2}
        r={2}
        fill={color}
      />
    </svg>
  );
}
