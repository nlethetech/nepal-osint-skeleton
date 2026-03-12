import { useRef, useEffect, useState, useCallback } from 'react';
import {
  Spinner,
  NonIdealState,
  Intent,
  ButtonGroup,
  Button,
  Tag,
  Icon,
} from '@blueprintjs/core';
import { useQuery } from '@tanstack/react-query';
import {
  getRegistrationTimeline,
  type TimelineBucket,
} from '../../api/corporate';

interface RegistrationTimelineProps {
  onCompanyClick?: (id: string) => void;
  onPANClick?: (pan: string) => void;
}

type GroupBy = 'month' | 'year';

export function RegistrationTimeline({ onCompanyClick, onPANClick }: RegistrationTimelineProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>('year');
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['registration-timeline', groupBy],
    queryFn: () => getRegistrationTimeline({ group_by: groupBy }),
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  // Find max for scaling
  const maxCount = Math.max(...items.map((b) => b.count), 1);

  // Anomaly detection: flag periods with count > 2 standard deviations above mean
  const mean = items.length > 0 ? items.reduce((s, b) => s + b.count, 0) / items.length : 0;
  const stdDev = items.length > 1
    ? Math.sqrt(items.reduce((s, b) => s + (b.count - mean) ** 2, 0) / items.length)
    : 0;
  const anomalyThreshold = mean + 2 * stdDev;

  const isAnomaly = useCallback(
    (count: number) => count > anomalyThreshold && stdDev > 0,
    [anomalyThreshold, stdDev],
  );

  if (isLoading) {
    return (
      <div className="bp6-dark flex items-center justify-center bg-bp-bg" style={{ minHeight: 400 }}>
        <Spinner intent={Intent.PRIMARY} size={48} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bp6-dark p-8 bg-bp-bg">
        <NonIdealState
          icon="error"
          title="Failed to load timeline"
          description={error instanceof Error ? error.message : 'An error occurred.'}
        />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bp6-dark p-8 bg-bp-bg">
        <NonIdealState
          icon="timeline-events"
          title="No registration data"
          description="No company registrations with dates found."
        />
      </div>
    );
  }

  return (
    <div className="bp6-dark flex flex-col h-full bg-bp-bg text-bp-text">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-bp-border bg-bp-card">
        <div className="flex items-center gap-3">
          <Icon icon="timeline-events" size={18} className="text-bp-primary-hover" />
          <h2 className="m-0 text-lg font-semibold">Registration Timeline</h2>
          <Tag minimal round className="text-bp-text-muted">
            {items.reduce((s, b) => s + b.count, 0).toLocaleString()} total registrations
          </Tag>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-bp-text-muted">Group by:</span>
          <ButtonGroup>
            <Button
              text="Year"
              small
              active={groupBy === 'year'}
              intent={groupBy === 'year' ? Intent.PRIMARY : Intent.NONE}
              onClick={() => setGroupBy('year')}
            />
            <Button
              text="Month"
              small
              active={groupBy === 'month'}
              intent={groupBy === 'month' ? Intent.PRIMARY : Intent.NONE}
              onClick={() => setGroupBy('month')}
            />
          </ButtonGroup>
        </div>
      </div>

      {/* Chart area */}
      <div className="flex-1 overflow-x-auto p-4" ref={chartRef}>
        {/* Anomaly legend */}
        {items.some((b) => isAnomaly(b.count)) && (
          <div className="flex items-center gap-2 mb-3">
            <Icon icon="warning-sign" size={12} className="text-severity-critical" />
            <span className="text-xs text-severity-critical">
              Anomalous periods (2+ std dev above mean of {Math.round(mean).toLocaleString()})
            </span>
          </div>
        )}

        {/* Bar chart */}
        <div className="flex items-end gap-[2px]" style={{ minHeight: 300, height: 'calc(100% - 60px)' }}>
          {items.map((bucket, idx) => {
            const heightPct = (bucket.count / maxCount) * 100;
            const anomaly = isAnomaly(bucket.count);
            const hovered = hoveredBar === idx;

            return (
              <div
                key={bucket.period}
                className="flex flex-col items-center flex-1 min-w-[3px] relative group"
                style={{ height: '100%', justifyContent: 'flex-end' }}
                onMouseEnter={() => setHoveredBar(idx)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                {/* Tooltip */}
                {hovered && (
                  <div
                    className="absolute bottom-full mb-2 px-3 py-2 rounded-md text-xs whitespace-nowrap z-10 bg-bp-surface border border-bp-border"
                    style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}
                  >
                    <div className="font-semibold text-bp-text">{bucket.period}</div>
                    <div className="font-mono text-bp-primary-hover">
                      {bucket.count.toLocaleString()} registrations
                    </div>
                    {anomaly && (
                      <div className="mt-1 flex items-center gap-1 text-severity-critical">
                        <Icon icon="warning-sign" size={10} />
                        Anomalous spike
                      </div>
                    )}
                  </div>
                )}

                {/* Bar */}
                <div
                  className="w-full rounded-t-sm transition-all duration-150"
                  style={{
                    height: `${heightPct}%`,
                    minHeight: bucket.count > 0 ? 2 : 0,
                    backgroundColor: anomaly
                      ? hovered ? '#CD4246' : '#CD4246'
                      : hovered ? '#4C90F0' : '#2D72D2',
                    opacity: hovered ? 1 : 0.85,
                  }}
                />

                {/* Label (show for year, or every 12th month) */}
                {(groupBy === 'year' || idx % 12 === 0) && (
                  <span
                    className="text-[9px] mt-1 font-mono select-none text-bp-text-muted"
                    style={{ writingMode: groupBy === 'month' ? 'vertical-rl' : undefined }}
                  >
                    {bucket.period}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between px-5 py-2 border-t border-bp-border text-[10px] font-mono text-bp-text-muted bg-bp-card">
        <span>
          {items.length} {groupBy === 'year' ? 'years' : 'months'} of data
        </span>
        <span>
          Mean: {Math.round(mean).toLocaleString()} / {groupBy}
          {' · '}
          Peak: {maxCount.toLocaleString()} ({items.find((b) => b.count === maxCount)?.period})
        </span>
        <span>
          {items.filter((b) => isAnomaly(b.count)).length} anomalous {groupBy === 'year' ? 'years' : 'months'}
        </span>
      </div>
    </div>
  );
}
