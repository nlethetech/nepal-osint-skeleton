/**
 * IntelBriefHeroWidget — Palantir-grade national situation overview card.
 * Full-width vertical layout with trajectory strip, expandable summary,
 * key judgment callout, animated stats, and province risk pills.
 */
import { memo, useState } from 'react';
import { Widget } from '../Widget';
import { Shield, TrendingUp, TrendingDown, Minus, Clock, FileText, MessageCircle, AlertTriangle, ChevronDown } from 'lucide-react';
import { useLatestBrief, useProvinceAnomalies } from '../../../api/hooks';
import { WidgetSkeleton, WidgetError } from './shared';
import CountUp from 'react-countup';
import { motion } from 'framer-motion';

/* ── animation variants ── */
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' as const } },
};

/* ── config ── */
const TRAJECTORY_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  ESCALATING:      { icon: TrendingUp,   color: '#FF6B6B', label: 'WORSENING' },
  STABLE:          { icon: Minus,        color: '#4ECDC4', label: 'STABLE' },
  'DE-ESCALATING': { icon: TrendingDown, color: '#45B7D1', label: 'IMPROVING' },
};

const THREAT_COLORS: Record<string, string> = {
  CRITICAL: 'var(--status-critical)',
  ELEVATED: 'var(--status-high)',
  GUARDED:  'var(--status-medium)',
  LOW:      'var(--status-low)',
};

const THREAT_LABELS: Record<string, string> = {
  CRITICAL: 'CRT',
  ELEVATED: 'ELV',
  GUARDED:  'MED',
  LOW:      'LOW',
};

function formatTimeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export const IntelBriefHeroWidget = memo(function IntelBriefHeroWidget() {
  const { data: brief, isLoading: briefLoading, error, refetch } = useLatestBrief();
  const { data: anomalyData } = useProvinceAnomalies();
  const [expanded, setExpanded] = useState(false);

  if (briefLoading) {
    return (
      <Widget id="intel-brief-hero" icon={<Shield size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (error || !brief) {
    return (
      <Widget id="intel-brief-hero" icon={<Shield size={14} />}>
        <WidgetError message="No analysis report available" onRetry={() => refetch()} />
      </Widget>
    );
  }

  const trajectory = TRAJECTORY_CONFIG[brief.trend_vs_previous || 'STABLE'] || TRAJECTORY_CONFIG.STABLE;
  const TrajectoryIcon = trajectory.icon;
  const threatColor = THREAT_COLORS[brief.key_judgment?.includes('CRITICAL') ? 'CRITICAL' : brief.key_judgment?.includes('ELEVATED') ? 'ELEVATED' : 'GUARDED'] || 'var(--text-muted)';

  // Province threat dots
  const anomalyProvinces = anomalyData?.provinces || [];
  const provinceDots = Array.from({ length: 7 }, (_, i) => {
    const pid = i + 1;
    const anomaly = anomalyProvinces.find((a: any) => a.province_id === pid);
    const sitrep = brief.province_sitreps?.find((s: any) => s.province_id === pid);
    const level = anomaly?.threat_level || sitrep?.threat_level || 'LOW';
    return { id: pid, level, color: THREAT_COLORS[level] || 'var(--text-muted)' };
  });

  const totalAnomalies = anomalyProvinces.reduce((sum: number, p: any) => sum + (p.anomalies?.length || 0), 0);
  const storiesCount = anomalyData?.stories_analyzed || brief.stories_analyzed || 0;
  const tweetsCount = anomalyData?.tweets_analyzed || 0;

  const stats = [
    { label: 'Stories', value: storiesCount, color: 'var(--text-primary)' },
    ...(tweetsCount > 0 ? [{ label: 'Tweets', value: tweetsCount, color: 'var(--text-primary)' }] : []),
    ...(totalAnomalies > 0 ? [{ label: 'Anomalies', value: totalAnomalies, color: 'var(--status-high)' }] : []),
  ];

  const summaryText = brief.national_summary || 'No national summary available for this period.';

  return (
    <Widget id="intel-brief-hero" icon={<Shield size={14} />}>
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {/* ── Trajectory strip ── */}
        <motion.div
          variants={fadeUp}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 16px',
            background: `color-mix(in srgb, ${trajectory.color} 8%, transparent)`,
            borderBottom: `1px solid color-mix(in srgb, ${trajectory.color} 20%, transparent)`,
          }}
        >
          <div style={{
            width: '3px', height: '20px', borderRadius: '2px',
            background: trajectory.color,
          }} />
          <TrajectoryIcon size={14} color={trajectory.color} />
          <span style={{
            fontSize: '11px', fontWeight: 700, color: trajectory.color,
            letterSpacing: '1px', textTransform: 'uppercase',
          }}>
            {trajectory.label}
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Situation trend
          </span>
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Clock size={10} />
            Updated {formatTimeAgo(brief.created_at)}
          </span>
        </motion.div>

        {/* ── Content area ── */}
        <div style={{ padding: '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* Section header */}
          <motion.div variants={fadeUp} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '16px', height: '2px', borderRadius: '1px',
              background: 'var(--status-medium)',
            }} />
            <span style={{
              fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '1.5px', color: 'var(--text-muted)',
            }}>
              Current Assessment
            </span>
          </motion.div>

          {/* Summary with clamp + expand */}
          <motion.div variants={fadeUp}>
            <div
              style={{
                fontSize: '13px', lineHeight: 1.65, color: 'var(--text-primary)',
                ...(expanded ? {} : {
                  display: '-webkit-box',
                  WebkitLineClamp: 4,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                }),
              }}
            >
              {summaryText}
            </div>
            {summaryText.length > 200 && (
              <button
                onClick={() => setExpanded(!expanded)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600,
                  padding: '4px 0 0', display: 'flex', alignItems: 'center', gap: '4px',
                }}
              >
                <ChevronDown
                  size={12}
                  style={{
                    transition: 'transform 0.2s',
                    transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  }}
                />
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </motion.div>

          {/* Key judgment callout */}
          {brief.key_judgment && (
            <motion.div
              variants={fadeUp}
              style={{
                borderLeft: `3px solid ${threatColor}`,
                background: `color-mix(in srgb, ${threatColor} 6%, var(--bg-elevated))`,
                padding: '10px 14px',
                borderRadius: '0 4px 4px 0',
                fontSize: '12px', lineHeight: 1.55,
                color: 'var(--text-secondary)',
              }}
            >
              {brief.key_judgment}
            </motion.div>
          )}

          {/* ── Bottom row: Stats + Province pills ── */}
          <motion.div
            variants={fadeUp}
            style={{
              display: 'flex', alignItems: 'stretch', gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {/* Stats cells — gap-as-border pattern */}
            <div style={{
              display: 'flex', gap: '1px',
              background: 'var(--border-subtle)', borderRadius: '6px',
              overflow: 'hidden', flexShrink: 0,
            }}>
              {stats.map((s, i) => (
                <div key={i} style={{
                  background: 'var(--bg-elevated)', padding: '8px 14px',
                  textAlign: 'center', minWidth: '64px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: '18px',
                    fontWeight: 600, color: s.color, lineHeight: 1.2,
                  }}>
                    <CountUp end={s.value} duration={1.2} preserveValue />
                  </div>
                  <div style={{
                    fontSize: '9px', color: 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.5px',
                    marginTop: '2px',
                  }}>
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Province pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
              {provinceDots.map(p => {
                const rawColor = THREAT_COLORS[p.level] || 'var(--text-muted)';
                return (
                  <div
                    key={p.id}
                    title={`Province ${p.id}: ${p.level}`}
                    onClick={() => {
                      const el = document.getElementById('province-monitor');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '4px',
                      padding: '4px 8px', borderRadius: '4px', cursor: 'pointer',
                      background: `color-mix(in srgb, ${rawColor} 10%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${rawColor} 25%, transparent)`,
                      transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = `color-mix(in srgb, ${rawColor} 50%, transparent)`;
                      (e.currentTarget as HTMLElement).style.background = `color-mix(in srgb, ${rawColor} 18%, transparent)`;
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.borderColor = `color-mix(in srgb, ${rawColor} 25%, transparent)`;
                      (e.currentTarget as HTMLElement).style.background = `color-mix(in srgb, ${rawColor} 10%, transparent)`;
                    }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: rawColor, flexShrink: 0,
                    }} />
                    <span style={{
                      fontSize: '10px', fontWeight: 600, color: rawColor,
                      fontFamily: 'var(--font-mono)',
                    }}>
                      P{p.id}
                    </span>
                    <span style={{
                      fontSize: '8px', color: 'var(--text-muted)',
                      textTransform: 'uppercase', letterSpacing: '0.3px',
                    }}>
                      {THREAT_LABELS[p.level] || 'LOW'}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </motion.div>
    </Widget>
  );
});
