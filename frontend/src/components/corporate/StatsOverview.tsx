import { useQuery } from '@tanstack/react-query';
import {
  Card,
  Tag,
  Intent,
  Spinner,
  ProgressBar,
  Section,
  SectionCard,
  Icon,
  Button,
} from '@blueprintjs/core';
import { getCorporateStats } from '../../api/corporate';
import { MetricCard } from '../../components/ui/narada-ui';

interface StatsOverviewProps {
  onNavigate?: (tab: string) => void;
}

export function StatsOverview({ onNavigate }: StatsOverviewProps) {
  const { data: stats, isLoading, isError } = useQuery({
    queryKey: ['corporate-stats'],
    queryFn: getCorporateStats,
  });

  if (isLoading) {
    return (
      <div className="bp6-dark flex items-center justify-center min-h-[400px] bg-bp-bg">
        <Spinner intent={Intent.PRIMARY} size={48} />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="bp6-dark flex items-center justify-center min-h-[400px] bg-bp-bg">
        <Tag intent={Intent.DANGER} large minimal>
          Failed to load corporate statistics
        </Tag>
      </div>
    );
  }

  const panPct = stats.pan_coverage_pct ?? 0;
  const camisPct = stats.total_companies > 0
    ? (stats.camis_enriched_count / stats.total_companies) * 100
    : 0;
  const irdPct = stats.ird_enrichment_pct ?? 0;

  // top_districts is a dict { district_name: count }, convert to sorted entries
  const districtEntries = Object.entries(stats.top_districts ?? {}).slice(0, 10);
  const maxDistrictCount = districtEntries.length > 0 ? districtEntries[0][1] : 1;

  const kpis: Array<{
    label: string;
    value: number;
    icon: string;
    intent?: Intent;
    pct?: number;
    subtitle?: string;
  }> = [
    {
      label: 'Total Companies',
      value: stats.total_companies,
      icon: 'office',
      pct: 1,
    },
    {
      label: 'With PAN',
      value: stats.companies_with_pan,
      icon: 'id-number',
      pct: panPct / 100,
      subtitle: `${panPct.toFixed(1)}% of total`,
    },
    {
      label: 'CAMIS Enriched',
      value: stats.camis_enriched_count,
      icon: 'tick-circle',
      intent: Intent.SUCCESS,
      pct: camisPct / 100,
      subtitle: `${camisPct.toFixed(1)}% of total`,
    },
    {
      label: 'IRD Enriched',
      value: stats.ird_enriched_count,
      icon: 'search',
      intent: Intent.PRIMARY,
      pct: irdPct / 100,
      subtitle: `${irdPct.toFixed(1)}% of PAN-holding`,
    },
    {
      label: 'Total Directors',
      value: stats.total_directors,
      icon: 'people',
      pct: undefined,
    },
  ];

  const quickLinks: Array<{ label: string; tab: string; icon: string; intent: Intent }> = [
    { label: 'Browse Companies', tab: 'companies', icon: 'search', intent: Intent.PRIMARY },
    { label: 'Risk Flags', tab: 'risk', icon: 'warning-sign', intent: Intent.WARNING },
    { label: 'Director Networks', tab: 'directors', icon: 'graph', intent: Intent.SUCCESS },
    { label: 'Address Clusters', tab: 'clusters', icon: 'map-marker', intent: Intent.NONE },
  ];

  return (
    <div className="bp6-dark bg-bp-bg min-h-full">
      <div className="p-4 space-y-4">

        {/* -- Top Row: KPI Cards -- */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {kpis.map((kpi) => (
            <Card
              key={kpi.label}
              className="p-4 bg-bp-card border border-bp-border shadow-none"
            >
              <div className="flex items-center justify-between mb-3">
                <Icon
                  icon={kpi.icon as any}
                  size={16}
                  className={
                    kpi.intent === Intent.SUCCESS
                      ? 'text-bp-success'
                      : kpi.intent === Intent.PRIMARY
                        ? 'text-bp-primary'
                        : 'text-bp-text-muted'
                  }
                />
                {kpi.subtitle && (
                  <Tag
                    minimal
                    round
                    intent={kpi.intent ?? Intent.NONE}
                    style={{ fontSize: 10 }}
                  >
                    {kpi.subtitle}
                  </Tag>
                )}
              </div>

              <div className="text-2xl font-mono font-semibold mb-1 text-bp-text">
                {kpi.value.toLocaleString()}
              </div>

              <div className="text-xs mb-3 text-bp-text-secondary">
                {kpi.label}
              </div>

              {kpi.pct !== undefined && (
                <ProgressBar
                  value={kpi.pct}
                  intent={kpi.intent ?? Intent.NONE}
                  stripes={false}
                  animate={false}
                  className="h-1"
                />
              )}
            </Card>
          ))}
        </div>

        {/* -- Middle Row: Enrichment Progress + District Coverage -- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          {/* Left: Enrichment Progress */}
          <Section
            title={<span className="text-bp-text">Enrichment Progress</span>}
            icon="timeline-events"
            className="rounded bg-bp-card border border-bp-border"
          >
            <SectionCard className="bg-bp-surface">
              <div className="space-y-5">
                {/* CAMIS */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon icon="tick-circle" size={14} className="text-bp-success" />
                      <span className="text-sm text-bp-text">
                        CAMIS Enrichment
                      </span>
                    </div>
                    <span className="text-sm font-mono text-bp-text-secondary">
                      {stats.camis_enriched_count.toLocaleString()} / {stats.total_companies.toLocaleString()}
                    </span>
                  </div>
                  <ProgressBar
                    value={camisPct / 100}
                    intent={Intent.SUCCESS}
                    stripes={false}
                    animate={false}
                  />
                  <div className="text-xs mt-1 text-right text-bp-text-muted">
                    {camisPct.toFixed(1)}%
                  </div>
                </div>

                {/* IRD */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon icon="search" size={14} className="text-bp-primary" />
                      <span className="text-sm text-bp-text">
                        IRD Enrichment
                      </span>
                    </div>
                    <span className="text-sm font-mono text-bp-text-secondary">
                      {stats.ird_enriched_count.toLocaleString()} / {stats.companies_with_pan.toLocaleString()}
                    </span>
                  </div>
                  <ProgressBar
                    value={irdPct / 100}
                    intent={Intent.PRIMARY}
                    stripes={false}
                    animate={false}
                  />
                  <div className="text-xs mt-1 text-right text-bp-text-muted">
                    {irdPct.toFixed(1)}%
                  </div>
                </div>
              </div>
            </SectionCard>
          </Section>

          {/* Right: Coverage by District */}
          <Section
            title={<span className="text-bp-text">Coverage by District</span>}
            icon="map"
            className="rounded bg-bp-card border border-bp-border"
          >
            <SectionCard className="bg-bp-surface">
              {districtEntries.length === 0 ? (
                <div className="text-sm text-center py-4 text-bp-text-muted">
                  No district data available
                </div>
              ) : (
                <div className="space-y-2">
                  {districtEntries.map(([district, count], idx) => {
                    const barWidth = (count / maxDistrictCount) * 100;
                    return (
                      <div key={district} className="flex items-center gap-3">
                        <span
                          className="text-xs font-mono w-24 text-right flex-shrink-0 truncate text-bp-text-secondary"
                          title={district}
                        >
                          {district}
                        </span>
                        <div className="flex-1 h-4 rounded-sm overflow-hidden bg-bp-card">
                          <div
                            className="h-full rounded-sm transition-all duration-300 bg-bp-primary"
                            style={{
                              width: `${barWidth}%`,
                              opacity: idx === 0 ? 1 : Math.max(0.3, 1 - idx * 0.07),
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono w-16 text-right flex-shrink-0 text-bp-text-muted">
                          {count.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </Section>
        </div>

        {/* -- Bottom Row: Quick Links -- */}
        <Section
          title={<span className="text-bp-text">Quick Links</span>}
          icon="link"
          className="rounded bg-bp-card border border-bp-border"
        >
          <SectionCard className="bg-bp-surface">
            <div className="flex items-center gap-3 flex-wrap">
              {quickLinks.map((link) => (
                <Button
                  key={link.tab}
                  icon={link.icon as any}
                  intent={link.intent}
                  text={link.label}
                  minimal
                  outlined
                  onClick={() => onNavigate?.(link.tab)}
                  className="border-bp-border"
                />
              ))}
            </div>
          </SectionCard>
        </Section>

      </div>
    </div>
  );
}
