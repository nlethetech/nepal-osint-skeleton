/**
 * ProvinceMonitorWidget — 7-province situation board.
 * Compact table layout with expandable detail rows.
 * Dual data: Province Anomaly Agent (primary) + Brief sitreps (overlay).
 */
import { memo, useState } from 'react';
import { Widget } from '../Widget';
import {
  MapPin, TrendingUp, TrendingDown, Minus, ChevronRight,
  AlertTriangle, Newspaper, MessageCircle, Clock, Shield,
} from 'lucide-react';
import { useLatestBrief, useProvinceAnomalies } from '../../../api/hooks';
import type { ProvinceSitrep } from '../../../api/briefs';
import type { ProvinceAnomalyData } from '../../../api/situationMonitor';
import { WidgetSkeleton, WidgetError } from './shared';

const PROVINCES: { id: number; name: string; short: string }[] = [
  { id: 1, name: 'Koshi', short: 'KOS' },
  { id: 2, name: 'Madhesh', short: 'MAD' },
  { id: 3, name: 'Bagmati', short: 'BAG' },
  { id: 4, name: 'Gandaki', short: 'GAN' },
  { id: 5, name: 'Lumbini', short: 'LUM' },
  { id: 6, name: 'Karnali', short: 'KAR' },
  { id: 7, name: 'Sudurpashchim', short: 'SDP' },
];

const THREAT_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: '#CD4246', bg: 'rgba(205,66,70,0.18)', label: 'CRITICAL' },
  ELEVATED: { color: '#C87619', bg: 'rgba(200,118,25,0.18)', label: 'HIGH' },
  GUARDED:  { color: '#D1980B', bg: 'rgba(209,152,11,0.15)', label: 'MEDIUM' },
  LOW:      { color: '#238551', bg: 'rgba(35,133,81,0.12)', label: 'LOW' },
};

const TRAJECTORY_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  ESCALATING:      { icon: TrendingUp, color: '#CD4246', label: 'WORSE' },
  STABLE:          { icon: Minus, color: '#8F99A8', label: 'STABLE' },
  'DE-ESCALATING': { icon: TrendingDown, color: '#238551', label: 'BETTER' },
};

const ANOMALY_COLORS: Record<string, string> = {
  critical: '#CD4246',
  high: '#C87619',
  medium: '#D1980B',
  low: '#238551',
};

function formatTimeAgo(dateString: string | null): string {
  if (!dateString) return '';
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function ProvinceRow({ prov, anomaly, sitrep, isExpanded, onToggle }: {
  prov: { id: number; name: string; short: string };
  anomaly: ProvinceAnomalyData | null;
  sitrep: ProvinceSitrep | null;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const level = anomaly?.threat_level || sitrep?.threat_level || 'LOW';
  const threat = THREAT_CONFIG[level] || THREAT_CONFIG.LOW;
  const trajectory = anomaly?.threat_trajectory || sitrep?.threat_trajectory || 'STABLE';
  const trajConfig = TRAJECTORY_CONFIG[trajectory] || TRAJECTORY_CONFIG.STABLE;
  const TrajIcon = trajConfig.icon;
  const anomalyList = anomaly?.anomalies || [];
  const summary = anomaly?.summary || sitrep?.bluf || null;
  const storyCount = anomaly?.story_count ?? sitrep?.story_count ?? 0;
  const tweetCount = anomaly?.tweet_count ?? 0;

  const getDimension = (key: 'political' | 'economic' | 'security') =>
    anomaly?.[key] || sitrep?.[key] || null;

  return (
    <>
      {/* Main row */}
      <tr
        onClick={onToggle}
        style={{
          cursor: 'pointer',
          borderBottom: isExpanded ? 'none' : '1px solid var(--border-subtle)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-active, rgba(255,255,255,0.03))')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Expand indicator */}
        <td style={{ width: '20px', padding: '7px 0 7px 8px', verticalAlign: 'middle' }}>
          <ChevronRight
            size={10}
            color="var(--text-muted)"
            style={{
              transform: isExpanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.15s',
            }}
          />
        </td>

        {/* Province name */}
        <td style={{ padding: '7px 8px', verticalAlign: 'middle' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{
              width: '3px', height: '16px', borderRadius: '1px',
              background: threat.color, flexShrink: 0,
            }} />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {prov.name}
            </span>
          </div>
        </td>

        {/* Threat level badge */}
        <td style={{ padding: '7px 6px', verticalAlign: 'middle', textAlign: 'center' }}>
          <span style={{
            fontSize: '9px', fontWeight: 700, padding: '2px 6px',
            background: threat.bg, color: threat.color,
            letterSpacing: '0.5px', borderRadius: '2px',
            display: 'inline-block',
          }}>
            {threat.label}
          </span>
        </td>

        {/* Trajectory */}
        <td style={{ padding: '7px 6px', verticalAlign: 'middle', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px' }}>
            <TrajIcon size={10} color={trajConfig.color} />
            <span style={{ fontSize: '9px', color: trajConfig.color, fontWeight: 500 }}>
              {trajConfig.label}
            </span>
          </div>
        </td>

        {/* Anomaly count */}
        <td style={{ padding: '7px 6px', verticalAlign: 'middle', textAlign: 'center' }}>
          {anomalyList.length > 0 ? (
            <span style={{
              fontSize: '10px', fontWeight: 700,
              color: anomalyList.some(a => a.severity === 'critical' || a.severity === 'high')
                ? '#C87619' : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
            }}>
              <AlertTriangle size={9} />
              {anomalyList.length}
            </span>
          ) : (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>—</span>
          )}
        </td>

        {/* Data sources */}
        <td style={{ padding: '7px 6px', verticalAlign: 'middle', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            {storyCount > 0 && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                <Newspaper size={8} />{storyCount}
              </span>
            )}
            {tweetCount > 0 && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                <MessageCircle size={8} />{tweetCount}
              </span>
            )}
            {storyCount === 0 && tweetCount === 0 && (
              <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>—</span>
            )}
          </div>
        </td>

        {/* Summary snippet */}
        <td style={{ padding: '7px 8px 7px 6px', verticalAlign: 'middle', maxWidth: '1px', width: '100%' }}>
          <div style={{
            fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {summary || 'No data in this period'}
          </div>
        </td>
      </tr>

      {/* Expanded detail */}
      {isExpanded && (
        <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <td colSpan={7} style={{ padding: '0 8px 10px 28px' }}>
            {/* Summary full text */}
            {summary && (
              <div style={{
                fontSize: '11px', lineHeight: 1.6, color: 'var(--text-primary)',
                padding: '8px 10px', margin: '4px 0 8px',
                background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
                borderLeft: `3px solid ${threat.color}`,
              }}>
                {summary}
              </div>
            )}

            {/* Dimension assessments */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: anomalyList.length > 0 ? '8px' : '0' }}>
              {(['political', 'economic', 'security'] as const).map(key => {
                const text = getDimension(key);
                if (!text) return (
                  <div key={key} style={{ padding: '6px 8px' }}>
                    <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '3px' }}>
                      {key}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      No data available
                    </div>
                  </div>
                );
                return (
                  <div key={key} style={{
                    padding: '6px 8px',
                    background: 'rgba(255,255,255,0.015)',
                    borderRadius: '2px',
                  }}>
                    <div style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', marginBottom: '3px' }}>
                      {key}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {text}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Anomalies list */}
            {anomalyList.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {anomalyList.map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    padding: '3px 8px', borderRadius: '2px',
                    background: `${ANOMALY_COLORS[a.severity] || '#8F99A8'}12`,
                    border: `1px solid ${ANOMALY_COLORS[a.severity] || '#8F99A8'}30`,
                  }}>
                    <div style={{
                      width: '5px', height: '5px', borderRadius: '50%',
                      background: ANOMALY_COLORS[a.severity] || '#8F99A8',
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                      {a.district && <strong style={{ color: 'var(--text-primary)' }}>{a.district}: </strong>}
                      {a.description}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Brief extras (disaster, election, hotspots) */}
            {sitrep && (
              <>
                {sitrep.disaster && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', fontSize: '10px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '8px', minWidth: '50px', paddingTop: '2px' }}>Disaster</span>
                    <span style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{sitrep.disaster}</span>
                  </div>
                )}
                {sitrep.election && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px', fontSize: '10px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '8px', minWidth: '50px', paddingTop: '2px' }}>Election</span>
                    <span style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>{sitrep.election}</span>
                  </div>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export const ProvinceMonitorWidget = memo(function ProvinceMonitorWidget() {
  const { data: anomalyData, isLoading: anomalyLoading } = useProvinceAnomalies();
  const { data: brief, isLoading: briefLoading, error, refetch } = useLatestBrief();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const isLoading = anomalyLoading && briefLoading;

  if (isLoading) {
    return (
      <Widget id="province-monitor" icon={<MapPin size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error && !anomalyData) {
    return (
      <Widget id="province-monitor" icon={<MapPin size={14} />}>
        <WidgetError message="Failed to load province data" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const anomalyProvinces = anomalyData?.provinces || [];
  const sitreps = brief?.province_sitreps || [];
  const totalAnomalies = anomalyProvinces.reduce((sum, p) => sum + (p.anomalies?.length || 0), 0);
  const elevatedCount = anomalyProvinces.filter(p =>
    p.threat_level === 'ELEVATED' || p.threat_level === 'CRITICAL'
  ).length;
  const updatedAgo = anomalyData?.completed_at ? formatTimeAgo(anomalyData.completed_at) : null;

  return (
    <Widget
      id="province-monitor"
      icon={<MapPin size={14} />}
      badge={totalAnomalies > 0 ? `${totalAnomalies}` : undefined}
      badgeVariant={elevatedCount > 0 ? 'high' : 'default'}
    >
      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '5px 10px',
        borderBottom: '1px solid var(--border-subtle)',
        fontSize: '9px', color: 'var(--text-muted)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Shield size={9} />
          <span>7 provinces tracked</span>
        </div>
        {anomalyData && anomalyData.stories_analyzed > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Newspaper size={8} />
            <span>{anomalyData.stories_analyzed} stories</span>
          </div>
        )}
        {anomalyData && anomalyData.tweets_analyzed > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <MessageCircle size={8} />
            <span>{anomalyData.tweets_analyzed} tweets</span>
          </div>
        )}
        {updatedAgo && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Clock size={8} />
            <span>{updatedAgo}</span>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}>
          <thead>
            <tr style={{
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <th style={{ width: '20px', padding: '5px 0 5px 8px' }} />
              <th style={{
                padding: '5px 8px', textAlign: 'left',
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.8px', color: 'var(--text-muted)',
                width: '110px',
              }}>
                Province
              </th>
              <th style={{
                padding: '5px 6px', textAlign: 'center',
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.8px', color: 'var(--text-muted)',
                width: '55px',
              }}>
                Risk
              </th>
              <th style={{
                padding: '5px 6px', textAlign: 'center',
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.8px', color: 'var(--text-muted)',
                width: '52px',
              }}>
                Trend
              </th>
              <th style={{
                padding: '5px 6px', textAlign: 'center',
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.8px', color: 'var(--text-muted)',
                width: '42px',
              }}>
                <AlertTriangle size={8} style={{ display: 'inline' }} />
              </th>
              <th style={{
                padding: '5px 6px', textAlign: 'center',
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.8px', color: 'var(--text-muted)',
                width: '70px',
              }}>
                Sources
              </th>
              <th style={{
                padding: '5px 8px 5px 6px', textAlign: 'left',
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.8px', color: 'var(--text-muted)',
              }}>
                Summary
              </th>
            </tr>
          </thead>
          <tbody>
            {PROVINCES.map(prov => {
              const anomaly = anomalyProvinces.find(a => a.province_id === prov.id) || null;
              const sitrep = sitreps.find(s => s.province_id === prov.id) || null;
              return (
                <ProvinceRow
                  key={prov.id}
                  prov={prov}
                  anomaly={anomaly}
                  sitrep={sitrep}
                  isExpanded={expandedId === prov.id}
                  onToggle={() => setExpandedId(expandedId === prov.id ? null : prov.id)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </Widget>
  );
});
