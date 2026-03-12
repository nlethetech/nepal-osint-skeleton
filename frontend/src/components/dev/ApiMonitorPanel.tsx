import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Zap, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'
import { fetchApiMetrics, type ApiMetrics } from '../../api/system'

function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-4">
      <p className="text-[10px] text-white/30 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-mono font-bold tabular-nums ${color || 'text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/30 mt-0.5 font-mono">{sub}</p>}
    </div>
  )
}

export function ApiMonitorPanel() {
  const [period, setPeriod] = useState('24h')
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['api-metrics', period],
    queryFn: () => fetchApiMetrics(period),
    refetchInterval: 60000,
  })

  return (
    <div className="space-y-6">
      {/* Period Selector + Refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {['1h', '6h', '24h', '7d'].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                period === p
                  ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  : 'text-white/30 hover:text-white/60 border border-transparent'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      {isLoading || !data ? (
        <div className="flex items-center justify-center h-40">
          <RefreshCw className="w-5 h-5 text-white/20 animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-6 gap-3">
            <MetricCard
              label="Total Requests"
              value={data.request_count.toLocaleString()}
            />
            <MetricCard
              label="Errors"
              value={data.error_count.toLocaleString()}
              color={data.error_count > 0 ? 'text-red-400' : 'text-white'}
            />
            <MetricCard
              label="Error Rate"
              value={`${(data.error_rate * 100).toFixed(2)}%`}
              color={data.error_rate > 0.01 ? 'text-amber-400' : 'text-emerald-400'}
            />
            <MetricCard
              label="Avg Response"
              value={`${data.avg_response_ms.toFixed(0)}ms`}
            />
            <MetricCard
              label="P95"
              value={`${data.p95_response_ms.toFixed(0)}ms`}
              color={data.p95_response_ms > 500 ? 'text-amber-400' : 'text-white'}
            />
            <MetricCard
              label="P99"
              value={`${data.p99_response_ms.toFixed(0)}ms`}
              color={data.p99_response_ms > 1000 ? 'text-red-400' : 'text-white'}
            />
          </div>

          {/* Endpoint Table */}
          <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06]">
              <h3 className="text-xs font-semibold text-white flex items-center gap-2">
                <Zap size={13} className="text-white/30" />
                Endpoint Breakdown
              </h3>
            </div>
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] text-white/30 uppercase tracking-wider border-b border-white/[0.06]">
                  <th className="px-4 py-2.5">Endpoint</th>
                  <th className="px-4 py-2.5">Method</th>
                  <th className="px-4 py-2.5 text-right">Requests</th>
                  <th className="px-4 py-2.5 text-right">Avg (ms)</th>
                  <th className="px-4 py-2.5 text-right">P95 (ms)</th>
                  <th className="px-4 py-2.5 text-right">Errors</th>
                  <th className="px-4 py-2.5">Health</th>
                </tr>
              </thead>
              <tbody>
                {data.endpoints.map((ep, i) => {
                  const errorRate = ep.count > 0 ? ep.errors / ep.count : 0
                  return (
                    <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5 text-xs text-white font-mono">{ep.path}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold ${
                          ep.method === 'GET' ? 'text-emerald-400' :
                          ep.method === 'POST' ? 'text-blue-400' :
                          ep.method === 'PUT' ? 'text-amber-400' :
                          ep.method === 'DELETE' ? 'text-red-400' : 'text-white/40'
                        }`}>
                          {ep.method}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-white font-mono text-right tabular-nums">{ep.count.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-xs text-white font-mono text-right tabular-nums">{ep.avg_ms.toFixed(0)}</td>
                      <td className="px-4 py-2.5 text-xs text-white/50 font-mono text-right tabular-nums">{ep.p95_ms.toFixed(0)}</td>
                      <td className={`px-4 py-2.5 text-xs font-mono text-right tabular-nums ${ep.errors > 0 ? 'text-red-400' : 'text-white/30'}`}>
                        {ep.errors}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="w-16 h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              errorRate > 0.05 ? 'bg-red-400' : errorRate > 0.01 ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.max(5, (1 - errorRate) * 100)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
