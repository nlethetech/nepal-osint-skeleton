import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Button, HTMLSelect, Intent, Spinner, Tag } from '@blueprintjs/core';
import { AnalystShell } from '../components/layout/AnalystShell';
import { MetricCard, SectionHeader } from '../components/ui/narada-ui';
import {
  AlertTriangle,
  BarChart3,
  Download,
  Upload,
  Play,
  Calculator,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getTradeAnomalies,
  getTradeWorkbenchDrilldown,
  getTradeWorkbenchHsAggregation,
  getTradeWorkbenchSeries,
  getTradeWorkbenchSummary,
  recomputeTradeMetrics,
  runTradeIngest,
  uploadTradeFiles,
  type TradeAnomaly,
  type TradeWorkbenchDrillRow,
  type TradeWorkbenchHsAggregateRow,
  type TradeWorkbenchSeriesItem,
  type TradeWorkbenchSummary,
  type TradeWorkbenchTopItem,
} from '../api/connectedAnalyst';

interface HsChartRow {
  hsCode: string;
  imports: number;
  exports: number;
  total: number;
}

function formatValueNprThousands(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10000000) {
    return `${(value / 10000000).toFixed(2)}T`;
  }
  if (abs >= 1000000) {
    return `${(value / 1000000).toFixed(2)}B`;
  }
  if (abs >= 1000) {
    return `${(value / 1000).toFixed(2)}M`;
  }
  return value.toFixed(2);
}

function formatMonthLabel(fy: string, month: number): string {
  return `${fy} M${month}`;
}

function exportRowsToCsv(rows: TradeWorkbenchDrillRow[]): void {
  const header = [
    'fiscal_year_bs',
    'month_ordinal',
    'upto_month',
    'direction',
    'table_name',
    'hs_code',
    'commodity_description',
    'partner_country',
    'customs_office',
    'value_npr_thousands',
    'delta_value_npr_thousands',
  ];

  const body = rows.map((row) => [
    row.fiscal_year_bs,
    row.month_ordinal,
    row.upto_month,
    row.direction,
    row.table_name,
    row.hs_code ?? '',
    row.commodity_description ?? '',
    row.partner_country ?? '',
    row.customs_office ?? '',
    row.value_npr_thousands,
    row.delta_value_npr_thousands ?? '',
  ]);

  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trade_workbench_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function TradeAnalysis() {
  const [fiscalYear, setFiscalYear] = useState('');
  const [direction, setDirection] = useState('');
  const [hsCode, setHsCode] = useState('');
  const [partnerCountry, setPartnerCountry] = useState('');
  const [customsOffice, setCustomsOffice] = useState('');

  const [summary, setSummary] = useState<TradeWorkbenchSummary | null>(null);
  const [topCustoms, setTopCustoms] = useState<TradeWorkbenchTopItem[]>([]);
  const [topPartners, setTopPartners] = useState<TradeWorkbenchTopItem[]>([]);
  const [topHs, setTopHs] = useState<TradeWorkbenchTopItem[]>([]);

  const [rows, setRows] = useState<TradeWorkbenchDrillRow[]>([]);
  const [hsAggregates, setHsAggregates] = useState<TradeWorkbenchHsAggregateRow[]>([]);
  const [series, setSeries] = useState<TradeWorkbenchSeriesItem[]>([]);
  const [anomalies, setAnomalies] = useState<TradeAnomaly[]>([]);
  const [hsCoverage, setHsCoverage] = useState<{ hs_codes_total: number; rows_scanned: number }>({
    hs_codes_total: 0,
    rows_scanned: 0,
  });

  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSeriesDimension = useMemo(() => {
    if (customsOffice.trim()) return { dimension: 'customs_office', dimensionKey: customsOffice.trim() };
    if (partnerCountry.trim()) return { dimension: 'partner_country', dimensionKey: partnerCountry.trim() };
    if (hsCode.trim()) return { dimension: 'hs_code', dimensionKey: hsCode.trim() };
    return null;
  }, [customsOffice, partnerCountry, hsCode]);

  const hsChartRows = useMemo<HsChartRow[]>(() => {
    return hsAggregates.map((item) => ({
      hsCode: item.hs_code,
      imports: item.imports_npr_thousands,
      exports: item.exports_npr_thousands,
      total: item.total_value_npr_thousands,
    }));
  }, [hsAggregates]);

  const hsDescriptionByCode = useMemo(() => {
    const mapping = new Map<string, string>();
    for (const item of hsAggregates) {
      const description = item.commodity_description?.trim();
      if (description) {
        mapping.set(item.hs_code, description);
      }
    }
    return mapping;
  }, [hsAggregates]);

  const seriesChartRows = useMemo(() => {
    return series.map((item) => ({
      label: formatMonthLabel(item.fiscal_year_bs, item.month_ordinal),
      value: item.value_npr_thousands,
      delta: item.delta_value_npr_thousands ?? 0,
      direction: item.direction,
    }));
  }, [series]);

  async function loadAllData() {
    setLoading(true);
    setError(null);

    try {
      const [summaryPayload, drillPayload, anomaliesPayload] = await Promise.all([
        getTradeWorkbenchSummary({
          fiscal_year_bs: fiscalYear || undefined,
        }),
        getTradeWorkbenchDrilldown({
          fiscal_year_bs: fiscalYear || undefined,
          direction: direction || undefined,
          hs_code: hsCode || undefined,
          partner_country: partnerCountry || undefined,
          customs_office: customsOffice || undefined,
          limit: 500,
          offset: 0,
        }),
        getTradeAnomalies({
          fiscal_year_bs: fiscalYear || undefined,
          limit: 100,
          offset: 0,
        }),
      ]);

      setSummary(summaryPayload.summary);
      setTopCustoms(summaryPayload.top_customs || []);
      setTopPartners(summaryPayload.top_partners || []);
      setTopHs(summaryPayload.top_hs_codes || []);

      setRows(drillPayload.items || []);
      setAnomalies(anomaliesPayload.items || []);

      const hsPageSize = 1000;
      let hsOffset = 0;
      let hsTotal = 0;
      let hsRowsScanned = 0;
      const hsAllRows: TradeWorkbenchHsAggregateRow[] = [];

      let hasMoreHsRows = true;
      while (hasMoreHsRows) {
        const hsPayload = await getTradeWorkbenchHsAggregation({
          fiscal_year_bs: fiscalYear || undefined,
          direction: direction || undefined,
          partner_country: partnerCountry || undefined,
          customs_office: customsOffice || undefined,
          hs_prefix: hsCode || undefined,
          sort_by: 'total_value_npr_thousands',
          sort_direction: 'desc',
          limit: hsPageSize,
          offset: hsOffset,
        });

        hsAllRows.push(...(hsPayload.items || []));
        hsTotal = hsPayload.total ?? hsTotal;
        hsRowsScanned = hsPayload.coverage?.rows_scanned ?? hsRowsScanned;

        const fetched = hsPayload.items?.length ?? 0;
        hsOffset += fetched;
        hasMoreHsRows = fetched > 0 && hsOffset < hsTotal;
      }

      setHsAggregates(hsAllRows);
      setHsCoverage({
        hs_codes_total: hsTotal,
        rows_scanned: hsRowsScanned,
      });

      if (activeSeriesDimension) {
        const seriesPayload = await getTradeWorkbenchSeries({
          dimension: activeSeriesDimension.dimension,
          dimension_key: activeSeriesDimension.dimensionKey,
          direction: direction || undefined,
          fiscal_year_bs: fiscalYear || undefined,
        });
        setSeries(seriesPayload.items || []);
      } else {
        setSeries([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trade analysis data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAllData();
  }, []);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const result = await uploadTradeFiles(Array.from(files));
      setMessage(`Uploaded ${result.count ?? 0} workbook file(s). Run ingest to persist.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleIngest() {
    setIngesting(true);
    setError(null);
    setMessage(null);

    try {
      const result = await runTradeIngest('trade_data');
      const summaryData = (result.summary as Record<string, unknown>) || {};
      setMessage(
        `Ingest complete. Files ${summaryData.processed_files ?? 0}, facts ${summaryData.facts_upserted ?? 0}, anomalies ${summaryData.anomalies_upserted ?? 0}.`,
      );
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trade ingest failed');
    } finally {
      setIngesting(false);
    }
  }

  async function handleRecompute() {
    setRecomputing(true);
    setError(null);
    setMessage(null);

    try {
      const result = await recomputeTradeMetrics(fiscalYear || undefined);
      setMessage(
        `Recompute complete. Delta rows ${result.delta_rows_updated ?? 0}, anomalies ${result.anomalies_upserted ?? 0}.`,
      );
      await loadAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed');
    } finally {
      setRecomputing(false);
    }
  }

  return (
    <AnalystShell
      activePage="trade"
      toolbar={(
        <>
          <div className="flex items-center gap-3 px-4 py-1.5 flex-shrink-0 bg-bp-card border-b border-bp-border">
            <label className="px-3 py-1.5 rounded text-xs cursor-pointer inline-flex items-center gap-1 bg-bp-surface border border-bp-border text-bp-text-secondary hover:bg-bp-hover transition-colors">
              <Upload size={13} />
              {uploading ? 'Uploading...' : 'Upload XLSX'}
              <input type="file" accept=".xlsx" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
            <Button
              small
              intent={Intent.PRIMARY}
              icon={<Play size={13} />}
              text={ingesting ? 'Ingesting...' : 'Run Ingest'}
              disabled={ingesting}
              onClick={() => { void handleIngest(); }}
              className="text-xs"
            />
            <Button
              small
              intent={Intent.WARNING}
              icon={<Calculator size={13} />}
              text={recomputing ? 'Recomputing...' : 'Recompute'}
              disabled={recomputing}
              onClick={() => { void handleRecompute(); }}
              className="text-xs"
            />
            <div className="flex-1" />
            <Button small minimal icon="refresh" loading={loading} onClick={() => { void loadAllData(); }} className="text-bp-text-secondary" />
            <Button small minimal icon={<Download size={13} />} text="Export CSV" onClick={() => exportRowsToCsv(rows)} className="text-xs text-bp-text-secondary" />
          </div>

          <div className="px-4 py-2 border-b border-bp-border flex items-center gap-2 bg-bp-card">
            <input
              className="rounded px-3 py-1.5 text-sm flex-1 max-w-[180px] bg-bp-surface border border-bp-border text-bp-text placeholder:text-bp-text-muted focus:border-bp-primary focus:outline-none"
              placeholder="Fiscal year (e.g., 2081-82)"
              value={fiscalYear}
              onChange={(event) => setFiscalYear(event.target.value)}
            />
            <HTMLSelect
              minimal
              value={direction}
              onChange={(event) => setDirection(event.target.value)}
              options={[
                { value: '', label: 'Direction: all' },
                { value: 'import', label: 'Import' },
                { value: 'export', label: 'Export' },
              ]}
              className="text-xs"
            />
            <input
              className="rounded px-3 py-1.5 text-sm flex-1 max-w-[140px] bg-bp-surface border border-bp-border text-bp-text placeholder:text-bp-text-muted focus:border-bp-primary focus:outline-none"
              placeholder="HS code"
              value={hsCode}
              onChange={(event) => setHsCode(event.target.value)}
            />
            <input
              className="rounded px-3 py-1.5 text-sm flex-1 max-w-[160px] bg-bp-surface border border-bp-border text-bp-text placeholder:text-bp-text-muted focus:border-bp-primary focus:outline-none"
              placeholder="Partner country"
              value={partnerCountry}
              onChange={(event) => setPartnerCountry(event.target.value)}
            />
            <input
              className="rounded px-3 py-1.5 text-sm flex-1 max-w-[160px] bg-bp-surface border border-bp-border text-bp-text placeholder:text-bp-text-muted focus:border-bp-primary focus:outline-none"
              placeholder="Customs office"
              value={customsOffice}
              onChange={(event) => setCustomsOffice(event.target.value)}
            />
            <Button
              small
              intent={Intent.PRIMARY}
              text="Apply"
              onClick={() => { void loadAllData(); }}
              className="text-xs"
            />
            <Button
              small
              minimal
              text="Reset"
              onClick={() => {
                setFiscalYear('');
                setDirection('');
                setHsCode('');
                setPartnerCountry('');
                setCustomsOffice('');
                setTimeout(() => { void loadAllData(); }, 0);
              }}
              className="text-xs text-bp-text-muted"
            />
          </div>

          {(message || error) && (
            <div className="px-4 py-1.5 bg-bp-card border-b border-bp-border">
              {message && (
                <Tag minimal large intent={Intent.SUCCESS} onRemove={() => setMessage(null)}>
                  {message}
                </Tag>
              )}
              {error && (
                <Tag minimal large intent={Intent.DANGER} onRemove={() => setError(null)}>
                  {error}
                </Tag>
              )}
            </div>
          )}
        </>
      )}
      statusBar={(
        <div className="flex items-center justify-between px-4 py-1.5 border-t border-bp-border bg-bp-bg text-bp-text-muted font-mono text-[10px]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-bp-success" />
              LIVE
            </span>
            <span>Trade Intelligence</span>
            {loading && <span>Loading...</span>}
          </div>
          <div className="flex items-center gap-4">
            <span>{rows.length} drill rows</span>
            <span>{anomalies.length} anomalies</span>
            <span>{new Date().toLocaleTimeString('en-US', { hour12: false })} NPT</span>
          </div>
        </div>
      )}
      contentClassName="overflow-y-auto p-4"
    >
      <div>
        <div className="max-w-[1700px] mx-auto space-y-4">
          {/* KPI Cards */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Imports"
              value={formatValueNprThousands(summary?.imports_total_npr_thousands ?? 0)}
              icon="chart"
              animate={false}
            />
            <MetricCard
              label="Exports"
              value={formatValueNprThousands(summary?.exports_total_npr_thousands ?? 0)}
              icon="chart"
              animate={false}
            />
            <div className="bg-bp-card border border-bp-border rounded p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 size={14} className={(summary?.trade_balance_npr_thousands ?? 0) < 0 ? 'text-severity-critical' : 'text-bp-success'} />
                <span className="bp-section-header">Trade Balance</span>
              </div>
              <span className={`text-xl font-semibold tabular-nums ${(summary?.trade_balance_npr_thousands ?? 0) < 0 ? 'text-severity-critical' : 'text-bp-success'}`}>
                {formatValueNprThousands(summary?.trade_balance_npr_thousands ?? 0)}
              </span>
            </div>
            <div className="bg-bp-card border border-bp-border rounded p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle size={14} className="text-bp-warning" />
                <span className="bp-section-header">Open Anomalies</span>
                {(summary?.anomaly_count ?? anomalies.length) > 0 && (
                  <Tag minimal round intent={Intent.WARNING} className="text-xs">
                    {summary?.anomaly_count ?? anomalies.length} open
                  </Tag>
                )}
              </div>
              <span className="text-xl font-semibold text-bp-warning tabular-nums">
                {summary?.anomaly_count ?? anomalies.length}
              </span>
            </div>
          </section>

          {/* HS Code Chart section */}
          <section className="rounded p-4 bg-bp-card border border-bp-border">
            <SectionHeader
              title="HS Code Import Export Matrix"
              action={
                <span className="text-xs font-mono text-bp-text-muted">
                  {hsCoverage.hs_codes_total} HS codes &bull; {hsCoverage.rows_scanned} rows scanned
                </span>
              }
            />
            <div className="h-[440px] overflow-x-auto">
              {hsChartRows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-bp-text-muted">
                  No HS data available for selected filters.
                </div>
              ) : (
                <div style={{ width: `${Math.max(1200, hsChartRows.length * 42)}px`, height: '100%' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hsChartRows} margin={{ top: 10, right: 24, left: 0, bottom: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#404854" />
                      <XAxis dataKey="hsCode" angle={-45} textAnchor="end" interval={0} height={90} tick={{ fill: '#738091', fontSize: 11 }} />
                      <YAxis tickFormatter={formatValueNprThousands} tick={{ fill: '#738091', fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number) => formatValueNprThousands(value)}
                        labelFormatter={(label) => {
                          const hsCodeLabel = String(label ?? '');
                          const description = hsDescriptionByCode.get(hsCodeLabel);
                          return description ? `${hsCodeLabel} - ${description}` : hsCodeLabel;
                        }}
                        contentStyle={{ background: '#1C2127', border: '1px solid #404854', color: '#F6F7F9' }}
                      />
                      <Legend />
                      <Bar dataKey="imports" fill="#ef4444" name="Imports" />
                      <Bar dataKey="exports" fill="#10b981" name="Exports" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </section>

          {/* Time Series + Top Dimensions */}
          <section className="grid grid-cols-1 xl:grid-cols-12 gap-3">
            <div className="xl:col-span-8 rounded p-4 bg-bp-card border border-bp-border">
              <SectionHeader
                title="Entity Time Series"
                action={
                  <span className="text-xs font-mono text-bp-text-muted">
                    {activeSeriesDimension
                      ? `${activeSeriesDimension.dimension}: ${activeSeriesDimension.dimensionKey}`
                      : 'Select HS, partner, or customs to load a series'}
                  </span>
                }
              />
              <div className="h-[320px]">
                {seriesChartRows.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-bp-text-muted">
                    No series loaded.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={seriesChartRows}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#404854" />
                      <XAxis dataKey="label" tick={{ fill: '#738091', fontSize: 11 }} />
                      <YAxis tickFormatter={formatValueNprThousands} tick={{ fill: '#738091', fontSize: 11 }} />
                      <Tooltip formatter={(value: number) => formatValueNprThousands(value)} contentStyle={{ background: '#1C2127', border: '1px solid #404854', color: '#F6F7F9' }} />
                      <Legend />
                      <Line type="monotone" dataKey="value" stroke="#2D72D2" strokeWidth={2} dot={false} name="Value" />
                      <Line type="monotone" dataKey="delta" stroke="#C87619" strokeWidth={2} dot={false} name="Monthly Delta" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="xl:col-span-4 rounded p-4 space-y-3 bg-bp-card border border-bp-border">
              <SectionHeader title="Top Dimensions" />
              <div className="rounded p-3 bg-bp-surface border border-bp-border">
                <p className="text-xs mb-2 uppercase tracking-wide text-bp-text-muted">Top Customs</p>
                {topCustoms.slice(0, 8).map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-0.5">
                    <span className="text-xs truncate flex-1 text-bp-text">{item.key}</span>
                    <span className="text-xs font-mono ml-2 text-bp-text-muted">{formatValueNprThousands(item.value_npr_thousands)}</span>
                  </div>
                ))}
              </div>
              <div className="rounded p-3 bg-bp-surface border border-bp-border">
                <p className="text-xs mb-2 uppercase tracking-wide text-bp-text-muted">Top Partners</p>
                {topPartners.slice(0, 8).map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-0.5">
                    <span className="text-xs truncate flex-1 text-bp-text">{item.key}</span>
                    <span className="text-xs font-mono ml-2 text-bp-text-muted">{formatValueNprThousands(item.value_npr_thousands)}</span>
                  </div>
                ))}
              </div>
              <div className="rounded p-3 bg-bp-surface border border-bp-border">
                <p className="text-xs mb-2 uppercase tracking-wide text-bp-text-muted">Top HS Codes</p>
                {topHs.slice(0, 8).map((item) => (
                  <div key={item.key} className="flex items-center justify-between py-0.5">
                    <span className="text-xs truncate flex-1 text-bp-text">{item.key}</span>
                    <span className="text-xs font-mono ml-2 text-bp-text-muted">{formatValueNprThousands(item.value_npr_thousands)}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Anomaly Register */}
          <section className="rounded p-4 bg-bp-card border border-bp-border">
            <SectionHeader title="Anomaly Register" count={anomalies.length} />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-bp-text-muted border-b border-bp-border">
                    <th className="text-left py-2 px-2">Dimension</th>
                    <th className="text-left py-2 px-2">Key</th>
                    <th className="text-left py-2 px-2">FY/Month</th>
                    <th className="text-right py-2 px-2">Observed</th>
                    <th className="text-right py-2 px-2">Expected</th>
                    <th className="text-right py-2 px-2">Deviation</th>
                    <th className="text-left py-2 px-2">Severity</th>
                    <th className="text-right py-2 px-2">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {anomalies.slice(0, 120).map((item) => (
                    <tr key={item.id} className="border-b border-bp-surface text-bp-text hover:bg-bp-hover transition-colors">
                      <td className="py-2 px-2">{item.dimension}</td>
                      <td className="py-2 px-2">{item.dimension_key}</td>
                      <td className="py-2 px-2">{item.fiscal_year_bs} / {item.month_ordinal}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatValueNprThousands(item.observed_value)}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatValueNprThousands(item.expected_value ?? 0)}</td>
                      <td className="py-2 px-2 text-right font-mono">{item.deviation_pct?.toFixed(2) ?? '-'}%</td>
                      <td className="py-2 px-2">
                        <Tag minimal intent={item.severity === 'critical' || item.severity === 'high' ? Intent.DANGER : Intent.WARNING} icon={<AlertTriangle size={11} />}>
                          {item.severity}
                        </Tag>
                      </td>
                      <td className="py-2 px-2 text-right font-mono">{item.confidence.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Trade Fact Drilldown */}
          <section className="rounded p-4 bg-bp-card border border-bp-border">
            <SectionHeader title="Trade Fact Drilldown" count={rows.length} />
            <div className="overflow-x-auto max-h-[560px]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-bp-card">
                  <tr className="text-bp-text-muted border-b border-bp-border">
                    <th className="text-left py-2 px-2">FY</th>
                    <th className="text-left py-2 px-2">Month</th>
                    <th className="text-left py-2 px-2">Direction</th>
                    <th className="text-left py-2 px-2">Table</th>
                    <th className="text-left py-2 px-2">HS</th>
                    <th className="text-left py-2 px-2">Commodity</th>
                    <th className="text-left py-2 px-2">Partner</th>
                    <th className="text-left py-2 px-2">Customs</th>
                    <th className="text-right py-2 px-2">Value</th>
                    <th className="text-right py-2 px-2">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 1000).map((row) => (
                    <tr key={row.id} className="border-b border-bp-surface text-bp-text hover:bg-bp-hover transition-colors">
                      <td className="py-2 px-2">{row.fiscal_year_bs}</td>
                      <td className="py-2 px-2">{row.month_ordinal}</td>
                      <td className="py-2 px-2">{row.direction}</td>
                      <td className="py-2 px-2">{row.table_name}</td>
                      <td className="py-2 px-2 font-mono">{row.hs_code ?? '-'}</td>
                      <td className="py-2 px-2 max-w-[240px] truncate" title={row.commodity_description ?? ''}>{row.commodity_description ?? '-'}</td>
                      <td className="py-2 px-2">{row.partner_country ?? '-'}</td>
                      <td className="py-2 px-2">{row.customs_office ?? '-'}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatValueNprThousands(row.value_npr_thousands)}</td>
                      <td className="py-2 px-2 text-right font-mono">{formatValueNprThousands(row.delta_value_npr_thousands ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </AnalystShell>
  );
}
