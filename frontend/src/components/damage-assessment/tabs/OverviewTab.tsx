/**
 * OverviewTab - Executive dashboard with key findings
 *
 * Displays:
 * - Metric cards (damaged area, affected population, critical zones, confidence)
 * - Severity breakdown
 * - Key findings
 * - Top affected zones
 */

import {
  AlertTriangle,
  Users,
  Building2,
  CheckCircle2,
  TrendingUp,
  MapPin,
  type LucideIcon,
} from 'lucide-react';
import { Card, ProgressBar, Tag, Section, SectionCard, Intent } from '@blueprintjs/core';
import type { Assessment, AssessmentStats } from '../../../api/damageAssessment';

interface OverviewTabProps {
  assessment: Assessment & { zones?: Array<{ id: string; zone_name?: string; severity: string; damage_percentage: number; area_km2: number }> };
  stats?: AssessmentStats;
}

const severityToIntent: Record<string, Intent> = {
  critical: Intent.DANGER,
  severe: Intent.WARNING,
  moderate: Intent.WARNING,
  minor: Intent.SUCCESS,
};

export function OverviewTab({ assessment, stats }: OverviewTabProps) {
  const severityColors = {
    critical: { bg: 'bg-severity-critical/20', text: 'text-severity-critical', bar: 'bg-severity-critical' },
    severe: { bg: 'bg-severity-high/20', text: 'text-severity-high', bar: 'bg-severity-high' },
    moderate: { bg: 'bg-severity-medium/20', text: 'text-severity-medium', bar: 'bg-severity-medium' },
    minor: { bg: 'bg-bp-success/20', text: 'text-bp-success', bar: 'bg-bp-success' },
  };

  const hasAnalysisResults = assessment.damaged_area_km2 !== undefined && assessment.damaged_area_km2 !== null;

  return (
    <div className="p-6 space-y-6">
      {/* Event Info */}
      <Section
        title={<span className="text-bp-text">{assessment.event_name}</span>}
        icon="globe"
        className="rounded bg-bp-card border border-bp-border"
      >
        <SectionCard className="bg-bp-surface">
          <div className="flex flex-wrap items-center gap-4 text-sm text-bp-text-muted">
            <span className="flex items-center gap-1.5">
              <MapPin size={14} />
              {assessment.districts?.join(', ') || 'Nepal'}
            </span>
            <span>
              Event Date: {new Date(assessment.event_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className="capitalize">Type: {assessment.event_type.replace('_', ' ')}</span>
          </div>
          {assessment.event_description && (
            <p className="mt-3 text-sm pt-3 text-bp-text-muted border-t border-bp-border">
              {assessment.event_description}
            </p>
          )}
        </SectionCard>
      </Section>

      {!hasAnalysisResults ? (
        <div className="bg-severity-high/10 border border-severity-high/30 rounded-xl p-6 text-center">
          <AlertTriangle size={32} className="mx-auto mb-3 text-severity-high" />
          <h3 className="text-severity-high font-medium mb-2">Analysis Not Run</h3>
          <p className="text-sm text-severity-high/70">
            Click "Run PWTT Analysis" in the header to detect damage using Sentinel-1 SAR imagery.
          </p>
        </div>
      ) : (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={AlertTriangle}
              iconColor="text-severity-critical"
              iconBg="bg-severity-critical/20"
              label="Damaged Area"
              value={`${assessment.damaged_area_km2?.toFixed(2) || 0} km²`}
              subvalue={`${assessment.damage_percentage?.toFixed(1) || 0}% of total`}
              intent={Intent.DANGER}
              pct={Math.min((assessment.damage_percentage || 0) / 100, 1)}
            />
            <MetricCard
              icon={Users}
              iconColor="text-severity-high"
              iconBg="bg-severity-high/20"
              label="Affected Population"
              value={assessment.affected_population?.toLocaleString() || '0'}
              subvalue={assessment.displaced_estimate ? `${assessment.displaced_estimate.toLocaleString()} displaced` : 'Estimate pending'}
              intent={Intent.WARNING}
            />
            <MetricCard
              icon={Building2}
              iconColor="text-bp-primary"
              iconBg="bg-bp-primary/20"
              label="Critical Zones"
              value={`${(assessment.critical_area_km2 || 0).toFixed(2)} km²`}
              subvalue={stats ? `${stats.zones_by_severity?.critical || 0} zones identified` : undefined}
              intent={Intent.PRIMARY}
            />
            <MetricCard
              icon={CheckCircle2}
              iconColor="text-bp-success"
              iconBg="bg-bp-success/20"
              label="Confidence Score"
              value={`${((assessment.confidence_score || 0) * 100).toFixed(0)}%`}
              subvalue={`${assessment.baseline_images_count || 0} baseline images`}
              intent={Intent.SUCCESS}
              pct={assessment.confidence_score || 0}
            />
          </div>

          {/* Severity Breakdown */}
          <Section
            title={<span className="text-bp-text">Severity Breakdown</span>}
            icon="warning-sign"
            className="rounded bg-bp-card border border-bp-border"
          >
            <SectionCard className="bg-bp-surface">
              <div className="space-y-3">
                {[
                  { key: 'critical', label: 'Critical', value: assessment.critical_area_km2 || 0 },
                  { key: 'severe', label: 'Severe', value: assessment.severe_area_km2 || 0 },
                  { key: 'moderate', label: 'Moderate', value: assessment.moderate_area_km2 || 0 },
                  { key: 'minor', label: 'Minor', value: assessment.minor_area_km2 || 0 },
                ].map(({ key, label, value }) => {
                  const colors = severityColors[key as keyof typeof severityColors];
                  const maxArea = Math.max(
                    assessment.critical_area_km2 || 0,
                    assessment.severe_area_km2 || 0,
                    assessment.moderate_area_km2 || 0,
                    assessment.minor_area_km2 || 0,
                    0.1
                  );
                  const percentage = (value / maxArea) * 100;
                  return (
                    <div key={key} className="flex items-center gap-4">
                      <span className={`w-20 text-sm ${colors.text}`}>{label}</span>
                      <div className="flex-1 h-4 rounded-sm overflow-hidden bg-bp-bg">
                        <div
                          className={`h-full ${colors.bar} transition-all duration-500 rounded-sm`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="w-24 text-xs font-mono text-right text-bp-text-muted">
                        {value.toFixed(2)} km²
                      </span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </Section>

          {/* Key Findings */}
          {assessment.key_findings && assessment.key_findings.length > 0 && (
            <Section
              title={<span className="text-bp-text">Key Findings</span>}
              icon="search"
              className="rounded bg-bp-card border border-bp-border"
            >
              <SectionCard className="bg-bp-surface">
                <ul className="space-y-2">
                  {assessment.key_findings.map((finding, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-bp-text">
                      <span className="text-severity-critical mt-1">&bull;</span>
                      {finding}
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </Section>
          )}

          {/* Infrastructure Impact */}
          {(assessment.buildings_affected || assessment.roads_damaged_km || assessment.bridges_affected) && (
            <Section
              title={<span className="text-bp-text">Infrastructure Impact</span>}
              icon="office"
              className="rounded bg-bp-card border border-bp-border"
            >
              <SectionCard className="bg-bp-surface">
                <div className="grid grid-cols-3 gap-4">
                  {assessment.buildings_affected ? (
                    <div className="text-center">
                      <div className="text-2xl font-bold text-bp-text">
                        {assessment.buildings_affected.toLocaleString()}
                      </div>
                      <div className="text-xs text-bp-text-muted">Buildings Affected</div>
                    </div>
                  ) : null}
                  {assessment.roads_damaged_km ? (
                    <div className="text-center">
                      <div className="text-2xl font-bold text-bp-text">
                        {assessment.roads_damaged_km.toFixed(1)} km
                      </div>
                      <div className="text-xs text-bp-text-muted">Roads Damaged</div>
                    </div>
                  ) : null}
                  {assessment.bridges_affected ? (
                    <div className="text-center">
                      <div className="text-2xl font-bold text-bp-text">
                        {assessment.bridges_affected}
                      </div>
                      <div className="text-xs text-bp-text-muted">Bridges Affected</div>
                    </div>
                  ) : null}
                </div>
              </SectionCard>
            </Section>
          )}

          {/* Top Affected Zones */}
          {assessment.zones && assessment.zones.length > 0 && (
            <Section
              title={<span className="text-bp-text">Top Affected Zones</span>}
              icon="map-marker"
              className="rounded bg-bp-card border border-bp-border"
            >
              <SectionCard className="bg-bp-surface">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-bp-text-muted border-b border-bp-border">
                        <th className="pb-2 font-medium">Zone</th>
                        <th className="pb-2 font-medium">Severity</th>
                        <th className="pb-2 font-medium text-right">Area</th>
                        <th className="pb-2 font-medium text-right">Damage %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assessment.zones.slice(0, 5).map((zone) => (
                        <tr key={zone.id} className="border-b border-bp-border">
                          <td className="py-2 text-bp-text">
                            {zone.zone_name || `Zone ${zone.id.slice(0, 8)}`}
                          </td>
                          <td className="py-2">
                            <Tag minimal intent={severityToIntent[zone.severity] || Intent.NONE} style={{ fontSize: 10 }}>
                              {zone.severity}
                            </Tag>
                          </td>
                          <td className="py-2 text-right text-bp-text-muted">{zone.area_km2.toFixed(3)} km²</td>
                          <td className="py-2 text-right text-bp-text-muted">{zone.damage_percentage.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

interface MetricCardProps {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  label: string;
  value: string;
  subvalue?: string;
  intent?: Intent;
  pct?: number;
}

function MetricCard({ icon: LucideIcon, iconColor, iconBg, label, value, subvalue, intent, pct }: MetricCardProps) {
  return (
    <Card
      className="p-4 bg-bp-card border border-bp-border shadow-none"
    >
      <div className="flex items-center justify-between mb-3">
        <LucideIcon size={16} className={iconColor} />
        {subvalue && (
          <Tag minimal round intent={intent ?? Intent.NONE} style={{ fontSize: 10 }}>
            {subvalue}
          </Tag>
        )}
      </div>
      <div className="text-2xl font-mono font-semibold mb-1 text-bp-text">
        {value}
      </div>
      <div className="text-xs mb-3 text-bp-text-muted">
        {label}
      </div>
      {pct !== undefined && (
        <ProgressBar value={pct} intent={intent ?? Intent.NONE} stripes={false} animate={false} className="h-1" />
      )}
    </Card>
  );
}
