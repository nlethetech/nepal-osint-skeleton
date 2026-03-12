import { useEffect, useMemo, useState } from 'react';
import { Button, HTMLSelect, Intent, Spinner, Tag } from '@blueprintjs/core';
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
import { SeverityBadge } from '../ui/narada-ui';
import {
  getTradeWorkbenchDrilldown,
  getTradeWorkbenchSeries,
  getTradeWorkbenchSummary,
  recomputeTradeMetrics,
  uploadTradeFiles,
  type TradeAnomaly,
  type TradeWorkbenchDrillRow,
  type TradeWorkbenchSeriesItem,
  type TradeWorkbenchSummary,
  type TradeWorkbenchTopItem,
} from '../../api/connectedAnalyst';

function formatNpr(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${(value / 10_000_000).toFixed(2)}T`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}B`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}M`;
  return value.toFixed(2);
}

export function TradeInvestigationWorkbench() {
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
  const [series, setSeries] = useState<TradeWorkbenchSeriesItem[]>([]);
  const [seriesAnomalies, setSeriesAnomalies] = useState<TradeAnomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeDimension = useMemo(() => {
    if (customsOffice) return { dimension: 'customs_office', key: customsOffice };
    if (partnerCountry) return { dimension: 'partner_country', key: partnerCountry };
    if (hsCode) return { dimension: 'hs_code', key: hsCode };
    return null;
  }, [customsOffice, partnerCountry, hsCode]);

  async function refreshWorkbench() {
    setLoading(true);
    setError(null);
    try {
      const [summaryPayload, drillPayload] = await Promise.all([
        getTradeWorkbenchSummary({
          fiscal_year_bs: fiscalYear || undefined,
        }),
        getTradeWorkbenchDrilldown({
          fiscal_year_bs: fiscalYear || undefined,
          direction: direction || undefined,
          hs_code: hsCode || undefined,
          partner_country: partnerCountry || undefined,
          customs_office: customsOffice || undefined,
          limit: 100,
          offset: 0,
        }),
      ]);

      setSummary(summaryPayload.summary);
      setTopCustoms(summaryPayload.top_customs);
      setTopPartners(summaryPayload.top_partners);
      setTopHs(summaryPayload.top_hs_codes);
      setRows(drillPayload.items);

      if (activeDimension) {
        const seriesPayload = await getTradeWorkbenchSeries({
          dimension: activeDimension.dimension,
          dimension_key: activeDimension.key,
          direction: direction || undefined,
          fiscal_year_bs: fiscalYear || undefined,
        });
        setSeries(seriesPayload.items);
        setSeriesAnomalies(seriesPayload.anomalies || []);
      } else {
        setSeries([]);
        setSeriesAnomalies([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trade workbench');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshWorkbench();
  }, []);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setMessage(null);
    setError(null);
    try {
      const payload = await uploadTradeFiles(Array.from(files));
      setMessage(`Uploaded ${payload.count ?? 0} file(s). Run trade ingest to persist into DB.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    }
  }

  async function handleRecompute() {
    setMessage(null);
    setError(null);
    try {
      const payload = await recomputeTradeMetrics(fiscalYear || undefined);
      setMessage(
        `Recomputed deltas ${payload.delta_rows_updated ?? 0}, anomalies ${payload.anomalies_upserted ?? 0}.`,
      );
      await refreshWorkbench();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed');
    }
  }

  // Chart data for series line chart
  const seriesChartRows = useMemo(
    () =>
      series.map((item) => ({
        label: `${item.fiscal_year_bs} M${item.month_ordinal}`,
        value: item.value_npr_thousands,
        delta: item.delta_value_npr_thousands ?? 0,
      })),
    [series],
  );

  // Chart data for top dimensions bar chart (top 5 from each category)
  const topBarData = useMemo(() => {
    const items = [
      ...topCustoms.slice(0, 5).map((i) => ({ name: i.key, value: i.value_npr_thousands, category: 'Customs' })),
      ...topPartners.slice(0, 5).map((i) => ({ name: i.key, value: i.value_npr_thousands, category: 'Partner' })),
      ...topHs.slice(0, 5).map((i) => ({ name: i.key, value: i.value_npr_thousands, category: 'HS Code' })),
    ];
    return items;
  }, [topCustoms, topPartners, topHs]);

  return (
    <section className="h-full flex flex-col bg-bp-bg border border-bp-border rounded-xl">
      <header className="px-3 py-2 flex items-center justify-between gap-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-bp-text">Trade Investigation Workbench</h2>
        <div className="flex items-center gap-2">
          <label className="text-[10px] px-2 py-0.5 border border-bp-border rounded bg-bp-card text-bp-text-secondary cursor-pointer">
            Upload XLSX
            <input type="file" multiple accept=".xlsx" className="hidden" onChange={handleUpload} />
          </label>
          <Button minimal small text="Recompute" intent={Intent.WARNING}
            onClick={() => { void handleRecompute(); }} className="text-[10px]" />
          <Button minimal small text="Refresh" intent={Intent.PRIMARY}
            onClick={() => { void refreshWorkbench(); }} className="text-[10px]" />
        </div>
      </header>

      <div className="px-3 py-2 grid grid-cols-1 xl:grid-cols-12 gap-2 border-b border-bp-border">
        <input
          className="xl:col-span-2 rounded px-2 py-1 text-xs bg-bp-card border border-bp-border text-bp-text placeholder:text-bp-text-muted"
          placeholder="FY (e.g. 2081-82)"
          value={fiscalYear}
          onChange={(event) => setFiscalYear(event.target.value)}
        />
        <div className="xl:col-span-2">
          <HTMLSelect minimal fill value={direction} onChange={(e) => setDirection(e.target.value)}
            options={[{ value: '', label: 'direction all' }, { value: 'import', label: 'import' }, { value: 'export', label: 'export' }]}
            className="bg-bp-card text-bp-text" />
        </div>
        <input
          className="xl:col-span-2 rounded px-2 py-1 text-xs bg-bp-card border border-bp-border text-bp-text placeholder:text-bp-text-muted"
          placeholder="HS code"
          value={hsCode}
          onChange={(event) => setHsCode(event.target.value)}
        />
        <input
          className="xl:col-span-3 rounded px-2 py-1 text-xs bg-bp-card border border-bp-border text-bp-text placeholder:text-bp-text-muted"
          placeholder="Partner country"
          value={partnerCountry}
          onChange={(event) => setPartnerCountry(event.target.value)}
        />
        <input
          className="xl:col-span-3 rounded px-2 py-1 text-xs bg-bp-card border border-bp-border text-bp-text placeholder:text-bp-text-muted"
          placeholder="Customs office"
          value={customsOffice}
          onChange={(event) => setCustomsOffice(event.target.value)}
        />
      </div>

      {message && <p className="px-3 py-1 text-[11px] text-bp-success">{message}</p>}
      {error && <p className="px-3 py-1 text-[11px] text-severity-critical">{error}</p>}
      {loading && (
        <div className="px-3 py-1 flex items-center gap-1.5">
          <Spinner size={16} />
          <span className="text-[11px] text-bp-text-secondary">Loading trade intelligence...</span>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="px-3 py-2 grid grid-cols-4 gap-2 text-center border-b border-bp-border">
        <div className="rounded px-2 py-1.5 border border-bp-border">
          <p className="text-[10px] text-bp-text-secondary">Imports</p>
          <p className="text-sm font-semibold text-severity-critical">{formatNpr(summary?.imports_total_npr_thousands ?? 0)}</p>
        </div>
        <div className="rounded px-2 py-1.5 border border-bp-border">
          <p className="text-[10px] text-bp-text-secondary">Exports</p>
          <p className="text-sm font-semibold text-bp-success">{formatNpr(summary?.exports_total_npr_thousands ?? 0)}</p>
        </div>
        <div className="rounded px-2 py-1.5 border border-bp-border">
          <p className="text-[10px] text-bp-text-secondary">Balance</p>
          <p className={`text-sm font-semibold ${(summary?.trade_balance_npr_thousands ?? 0) >= 0 ? 'text-bp-success' : 'text-severity-critical'}`}>
            {formatNpr(summary?.trade_balance_npr_thousands ?? 0)}
          </p>
        </div>
        <div className="rounded px-2 py-1.5 border border-bp-border">
          <p className="text-[10px] text-bp-text-secondary">Anomalies</p>
          <p className="text-sm font-semibold text-bp-warning">{summary?.anomaly_count ?? 0}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-12 gap-2 p-2">
        {/* Left: Drilldown table */}
        <div className="xl:col-span-5 rounded overflow-hidden flex flex-col min-h-0 border border-bp-border">
          <div className="px-2 py-1 text-[10px] uppercase border-b border-bp-border text-bp-text-secondary">Drilldown</div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-bp-text-secondary">
                  <th className="text-left px-2 py-1">FY</th>
                  <th className="text-left px-2 py-1">M</th>
                  <th className="text-left px-2 py-1">Dir</th>
                  <th className="text-left px-2 py-1">HS</th>
                  <th className="text-right px-2 py-1">Delta</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 50).map((row) => (
                  <tr key={row.id} className="border-t border-bp-border text-bp-text">
                    <td className="px-2 py-1">{row.fiscal_year_bs}</td>
                    <td className="px-2 py-1">{row.month_ordinal}</td>
                    <td className="px-2 py-1">{row.direction}</td>
                    <td className="px-2 py-1 truncate max-w-[60px]">{row.hs_code || '-'}</td>
                    <td className={`px-2 py-1 text-right ${(row.delta_value_npr_thousands ?? 0) >= 0 ? 'text-bp-success' : 'text-severity-critical'}`}>
                      {formatNpr(row.delta_value_npr_thousands ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Charts */}
        <div className="xl:col-span-7 flex flex-col gap-2 min-h-0">
          {/* Series line chart */}
          <div className="flex-1 rounded overflow-hidden flex flex-col min-h-0 border border-bp-border">
            <div className="px-2 py-1 text-[10px] uppercase border-b border-bp-border text-bp-text-secondary">
              Series {activeDimension ? `(${activeDimension.dimension}: ${activeDimension.key})` : '-- select a filter'}
            </div>
            <div className="flex-1 min-h-0 p-1">
              {seriesChartRows.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-bp-text-secondary">
                  Select HS/partner/customs filter to load series.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={seriesChartRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#404854" />
                    <XAxis dataKey="label" tick={{ fill: '#ABB3BF', fontSize: 10 }} />
                    <YAxis tickFormatter={formatNpr} tick={{ fill: '#ABB3BF', fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: number) => formatNpr(value)}
                      contentStyle={{ background: '#1C2127', border: '1px solid #404854', fontSize: 11, color: '#F6F7F9' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="value" stroke="#2D72D2" strokeWidth={2} dot={false} name="Value" />
                    <Line type="monotone" dataKey="delta" stroke="#C87619" strokeWidth={2} dot={false} name="Delta" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Top dimensions bar chart */}
          <div className="flex-1 rounded overflow-hidden flex flex-col min-h-0 border border-bp-border">
            <div className="px-2 py-1 text-[10px] uppercase border-b border-bp-border text-bp-text-secondary">Top Dimensions</div>
            <div className="flex-1 min-h-0 p-1">
              {topBarData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[11px] text-bp-text-secondary">
                  No top dimension data loaded.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topBarData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#404854" />
                    <XAxis
                      dataKey="name"
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                      tick={{ fill: '#ABB3BF', fontSize: 9 }}
                      height={50}
                    />
                    <YAxis tickFormatter={formatNpr} tick={{ fill: '#ABB3BF', fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: number) => formatNpr(value)}
                      contentStyle={{ background: '#1C2127', border: '1px solid #404854', fontSize: 11, color: '#F6F7F9' }}
                    />
                    <Bar dataKey="value" fill="#2D72D2" name="Value (NPR K)" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Anomalies list */}
          {seriesAnomalies.length > 0 && (
            <div className="rounded px-2 py-1.5 max-h-24 overflow-y-auto border border-bp-border">
              <p className="text-[10px] uppercase mb-1 text-bp-text-secondary">Anomalies ({seriesAnomalies.length})</p>
              {seriesAnomalies.slice(0, 8).map((item) => (
                <p key={item.id} className="text-[10px] text-bp-text-secondary">
                  {item.fiscal_year_bs} M{item.month_ordinal}{' '}
                  <SeverityBadge severity={item.severity} />
                  {' '}score {item.anomaly_score.toFixed(2)}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
