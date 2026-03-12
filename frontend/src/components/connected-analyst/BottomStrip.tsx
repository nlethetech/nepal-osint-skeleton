import { useEffect, useState } from 'react';
import { Tag, Intent } from '@blueprintjs/core';
import { Satellite, TrendingUp, AlertTriangle, DollarSign } from 'lucide-react';
import {
  getPwttRuns,
  getTradeWorkbenchSummary,
  type PwttRunSummary,
  type TradeWorkbenchSummary,
} from '../../api/connectedAnalyst';
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore';

function formatNpr(val: number): string {
  const abs = Math.abs(val);
  if (abs >= 10_000_000) return `${(val / 10_000_000).toFixed(1)}T`;
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}B`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)}M`;
  return val.toFixed(0);
}

function confidenceColor(c: number | null | undefined): string {
  const v = c ?? 0;
  if (v >= 0.7) return 'bg-bp-success/80';
  if (v >= 0.4) return 'bg-bp-warning/80';
  return 'bg-severity-critical/80';
}

export function BottomStrip({ className = '' }: { className?: string }) {
  const { selectedRunId, selectRun } = useConnectedAnalystStore();
  const [runs, setRuns] = useState<PwttRunSummary[]>([]);
  const [summary, setSummary] = useState<TradeWorkbenchSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [runsRes, summaryRes] = await Promise.allSettled([
        getPwttRuns({ limit: 20, offset: 0 }),
        getTradeWorkbenchSummary({}),
      ]);
      if (cancelled) return;
      if (runsRes.status === 'fulfilled') setRuns(runsRes.value.items);
      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value.summary);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className={`flex items-center gap-3 px-3 py-1.5 bg-bp-card border border-bp-border rounded-xl ${className}`}>
      {/* Left: PWTT run pills */}
      <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
        <Satellite size={12} className="flex-shrink-0 text-bp-text-secondary" />
        {runs.length === 0 ? (
          <span className="text-xs text-bp-text-secondary">No PWTT runs</span>
        ) : (
          runs.map((run) => (
            <Tag
              key={run.id}
              minimal
              interactive
              intent={selectedRunId === run.id ? Intent.SUCCESS : Intent.NONE}
              onClick={() => selectRun(run.id)}
              className="text-xs"
            >
              <span className="flex items-center gap-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${confidenceColor(run.confidence)}`} />
                <span className="truncate max-w-[80px] text-bp-text">{run.algorithm_name}</span>
              </span>
            </Tag>
          ))
        )}
      </div>

      {/* Center: Trade KPIs */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {summary ? (
          <>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bp-surface border border-bp-border">
              <TrendingUp size={10} className="text-severity-critical" />
              <span className="text-xs text-bp-text-secondary">Imports</span>
              <span className="text-xs text-bp-text font-medium">
                {formatNpr(summary.imports_total_npr_thousands)}
              </span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bp-surface border border-bp-border">
              <TrendingUp size={10} className="text-bp-success" />
              <span className="text-xs text-bp-text-secondary">Exports</span>
              <span className="text-xs text-bp-text font-medium">
                {formatNpr(summary.exports_total_npr_thousands)}
              </span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bp-surface border border-bp-border">
              <DollarSign size={10} className="text-bp-primary" />
              <span className="text-xs text-bp-text-secondary">Balance</span>
              <span className={`text-xs font-medium ${summary.trade_balance_npr_thousands >= 0 ? 'text-bp-success' : 'text-severity-critical'}`}>
                {formatNpr(summary.trade_balance_npr_thousands)}
              </span>
            </div>
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-bp-surface border border-bp-border">
              <AlertTriangle size={10} className="text-bp-warning" />
              <span className="text-xs text-bp-text-secondary">Anomalies</span>
              <span className="text-xs text-bp-text font-medium">
                {summary.anomaly_count}
              </span>
            </div>
          </>
        ) : (
          <span className="text-xs text-bp-text-secondary">Loading trade KPIs...</span>
        )}
      </div>
    </div>
  );
}
