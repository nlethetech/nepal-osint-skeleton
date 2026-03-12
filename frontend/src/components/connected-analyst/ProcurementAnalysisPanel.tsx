import { useState, useEffect, useCallback } from 'react'
import { Button, HTMLSelect, Tag, Intent, Spinner } from '@blueprintjs/core'
import {
  ChevronDown, ChevronRight, Search, Shield, ShieldAlert,
  ShieldCheck, FileText, CheckCircle, Eye, AlertTriangle, XCircle,
} from 'lucide-react'
import { useConnectedAnalystStore } from '../../stores/connectedAnalystStore'
import { SeverityBadge } from '../ui/narada-ui'
import {
  getProcurementSummary, getRiskFlags, getSameDayAwards, getOcrCrossRef,
  getEntityDrilldown, createInvestigationCase, requestVerification,
  type ProcurementSummary, type RiskFlag, type SameDayAward, type OcrMatch,
  type EntityDrilldown,
} from '../../api/procurementAnalysis'

function formatNpr(value: number | null): string {
  if (value == null) return '--'
  if (value >= 1e9) return `NPR ${(value / 1e9).toFixed(1)}B`
  if (value >= 1e6) return `NPR ${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `NPR ${(value / 1e3).toFixed(0)}K`
  return `NPR ${value.toLocaleString()}`
}

function riskColor(score: number): string {
  if (score >= 80) return 'text-severity-critical'
  if (score >= 60) return 'text-severity-high'
  if (score >= 40) return 'text-severity-medium'
  return 'text-bp-text-secondary'
}

function riskBg(score: number): string {
  if (score >= 80) return 'bg-red-500/20 border-red-500/30'
  if (score >= 60) return 'bg-amber-500/20 border-amber-500/30'
  if (score >= 40) return 'bg-yellow-500/20 border-yellow-500/30'
  return 'bg-bp-card border-bp-border'
}

function riskDot(score: number): string {
  if (score >= 80) return 'bg-severity-critical'
  if (score >= 60) return 'bg-severity-high'
  if (score >= 40) return 'bg-severity-medium'
  return 'bg-bp-text-secondary'
}

// ── KPI Card ──────────────────────────────────────────────

function KpiCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="px-2.5 py-1.5 flex-1 min-w-0 bg-bp-card border border-bp-border rounded-xl">
      <div className={`text-sm font-semibold truncate ${accent ? 'text-bp-warning' : 'text-bp-text'}`}>
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-wider mt-0.5 text-bp-text-secondary">{label}</div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────

export function ProcurementAnalysisPanel() {
  const { setRightPanelMode } = useConnectedAnalystStore()

  // State
  const [summary, setSummary] = useState<ProcurementSummary | null>(null)
  const [flags, setFlags] = useState<RiskFlag[]>([])
  const [selectedFlag, setSelectedFlag] = useState<RiskFlag | null>(null)
  const [drilldown, setDrilldown] = useState<EntityDrilldown | null>(null)
  const [ocrMatches, setOcrMatches] = useState<OcrMatch[]>([])
  const [sameDayAwards, setSameDayAwards] = useState<SameDayAward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState('risk_score')

  // Section collapse
  const [ocrExpanded, setOcrExpanded] = useState(false)
  const [sameDayExpanded, setSameDayExpanded] = useState(false)

  // Action feedback
  const [actionMsg, setActionMsg] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // ── Data loading ────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, f] = await Promise.all([
        getProcurementSummary(),
        getRiskFlags({ sort_by: sortBy }),
      ])
      setSummary(s)
      setFlags(f)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load procurement data')
    } finally {
      setLoading(false)
    }
  }, [sortBy])

  useEffect(() => { loadData() }, [loadData])

  // Load drilldown on flag select
  useEffect(() => {
    if (!selectedFlag) {
      setDrilldown(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const dd = await getEntityDrilldown(selectedFlag.procuring_entity)
        if (!cancelled) setDrilldown(dd)
      } catch {
        if (!cancelled) setDrilldown(null)
      }
    })()
    return () => { cancelled = true }
  }, [selectedFlag])

  // Lazy-load OCR matches
  useEffect(() => {
    if (!ocrExpanded || ocrMatches.length > 0) return
    ;(async () => {
      try {
        const data = await getOcrCrossRef({ limit: 100 })
        setOcrMatches(data)
      } catch { /* ignore */ }
    })()
  }, [ocrExpanded, ocrMatches.length])

  // Lazy-load same-day awards
  useEffect(() => {
    if (!sameDayExpanded || sameDayAwards.length > 0) return
    ;(async () => {
      try {
        const data = await getSameDayAwards()
        setSameDayAwards(data)
      } catch { /* ignore */ }
    })()
  }, [sameDayExpanded, sameDayAwards.length])

  // ── Actions ─────────────────────────────────────────────

  const clearAction = () => { setActionMsg(null); setActionError(null) }

  const handleCreateCase = async (flag: RiskFlag) => {
    clearAction()
    try {
      const result = await createInvestigationCase({
        procuring_entity: flag.procuring_entity,
        contractor_name: flag.contractor_name,
        flag_data: {
          risk_score: flag.risk_score,
          risk_level: flag.risk_level,
          contract_count: flag.contract_count,
          total_value: flag.total_value,
          budget_pct: flag.budget_pct,
          flags: flag.flags,
          contracts: flag.contracts,
        },
      })
      setActionMsg(`Case created: ${result.title} (${result.evidence_count} evidence items)`)
      // Switch to hypothesis tab to view the case
      setTimeout(() => setRightPanelMode('hypothesis'), 1500)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to create case')
    }
  }

  const handleVerify = async (flag: RiskFlag) => {
    clearAction()
    try {
      const result = await requestVerification({
        procuring_entity: flag.procuring_entity,
        contractor_name: flag.contractor_name,
        flag_data: {
          risk_score: flag.risk_score,
          flags: flag.flags,
          budget_pct: flag.budget_pct,
          contract_count: flag.contract_count,
          total_value: flag.total_value,
        },
      })
      setActionMsg(`Verification requested: ${result.status}`)
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to request verification')
    }
  }

  // ── Render ──────────────────────────────────────────────

  if (loading && !summary) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={16} />
        <span className="ml-2 text-xs text-bp-text-secondary">Loading procurement analysis...</span>
      </div>
    )
  }

  if (error && !summary) {
    return (
      <div className="h-full flex items-center justify-center px-4">
        <p className="text-xs text-severity-critical text-center">{error}</p>
      </div>
    )
  }

  return (
    <div className="h-full min-h-0 flex flex-col overflow-y-auto">
      {/* Section A: Header + KPI Bar */}
      <div className="px-3 py-2 border-b border-bp-border bg-bp-bg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <ShieldAlert size={12} className="text-bp-primary" />
            <span className="text-[10px] uppercase tracking-wider font-medium text-bp-text-secondary">
              Procurement Investigation
            </span>
          </div>
          <Button minimal small icon="refresh" loading={loading} onClick={loadData} className="text-bp-text-muted" />
        </div>

        {summary && (
          <div className="flex gap-1.5">
            <KpiCard label="Contracts" value={summary.total_contracts.toLocaleString()} />
            <KpiCard label="Value" value={formatNpr(summary.total_value_npr)} />
            <KpiCard label="Entities" value={summary.unique_entities} />
            <KpiCard label="Flags" value={summary.flagged_pairs_count} accent />
          </div>
        )}
      </div>

      {/* Action messages */}
      {actionMsg && (
        <div className="mx-3 mt-2 px-2 py-1.5 flex items-center gap-1.5">
          <Tag intent={Intent.SUCCESS} minimal className="text-[10px]">
            <span className="flex items-center gap-1"><CheckCircle size={10} />{actionMsg}</span>
          </Tag>
          <Button minimal small onClick={clearAction} className="ml-auto text-bp-success hover:text-bp-text" text="x" />
        </div>
      )}
      {actionError && (
        <div className="mx-3 mt-2 px-2 py-1.5 flex items-center gap-1.5">
          <Tag intent={Intent.DANGER} minimal className="text-[10px]">
            <span className="flex items-center gap-1"><XCircle size={10} />{actionError}</span>
          </Tag>
          <Button minimal small onClick={clearAction} className="ml-auto text-severity-critical hover:text-bp-text" text="x" />
        </div>
      )}

      {/* Section B: Risk Flags Table */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider font-medium text-bp-text-secondary">
            Risk Flags
          </span>
          <HTMLSelect minimal value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            options={[
              { value: 'risk_score', label: 'Sort: Risk' },
              { value: 'budget_pct', label: 'Sort: Budget %' },
              { value: 'contract_count', label: 'Sort: Count' },
              { value: 'total_value', label: 'Sort: Value' },
            ]}
            className="bg-bp-card text-bp-text-secondary border border-bp-border rounded"
          />
        </div>

        <div className="space-y-1">
          {flags.length === 0 && !loading && (
            <div className="text-[10px] text-center py-4 text-bp-text-secondary">No risk flags found</div>
          )}
          {flags.map((flag, i) => {
            const isSelected = selectedFlag?.procuring_entity === flag.procuring_entity
              && selectedFlag?.contractor_name === flag.contractor_name
            return (
              <button
                key={`${flag.procuring_entity}-${flag.contractor_name}-${i}`}
                onClick={() => setSelectedFlag(isSelected ? null : flag)}
                className={`w-full text-left px-2 py-1.5 rounded border transition-colors ${
                  isSelected
                    ? 'bg-bp-primary/20 border-bp-primary/40'
                    : `${riskBg(flag.risk_score)} hover:bg-bp-hover`
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${riskDot(flag.risk_score)}`} />
                  <span className={`text-xs font-mono font-bold ${riskColor(flag.risk_score)}`}>
                    {Math.round(flag.risk_score)}
                  </span>
                  <span className="text-[10px] truncate flex-1 text-bp-text">
                    {flag.procuring_entity.length > 25
                      ? flag.procuring_entity.slice(0, 25) + '...'
                      : flag.procuring_entity}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                  <span className="text-[9px] text-bp-text-secondary">&#x2194;</span>
                  <span className="text-[10px] truncate flex-1 text-bp-text-secondary">
                    {flag.contractor_name.length > 25
                      ? flag.contractor_name.slice(0, 25) + '...'
                      : flag.contractor_name}
                  </span>
                  <span className="text-[9px] flex-shrink-0 text-bp-text-secondary">
                    {formatNpr(flag.total_value)}
                  </span>
                  <span className="text-[9px] text-bp-warning/80 flex-shrink-0">
                    {flag.budget_pct}%
                  </span>
                </div>
                {/* Flag badges */}
                <div className="flex gap-1 mt-1 ml-5">
                  {flag.flags.map((f) => (
                    <Tag key={f} minimal className="text-[8px]">{f.replace(/_/g, ' ')}</Tag>
                  ))}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Section C: Entity Drilldown (on flag click) */}
      {selectedFlag && drilldown && (
        <div className="px-3 py-2 border-t border-bp-border">
          <div className="rounded-lg p-2.5 bg-bp-card border border-bp-border">
            <div className="text-[10px] uppercase tracking-wider text-bp-primary font-medium mb-2">
              {drilldown.entity}
            </div>

            {/* Contractor bars */}
            <div className="space-y-1 mb-3">
              <div className="text-[9px] uppercase text-bp-text-secondary">Contractors</div>
              {drilldown.contractors.slice(0, 5).map((c) => (
                <div key={c.name} className="flex items-center gap-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="h-1.5 rounded-full overflow-hidden bg-bp-surface">
                      <div
                        className={`h-full rounded-full ${c.pct > 50 ? 'bg-severity-critical/70' : 'bg-bp-primary/50'}`}
                        style={{ width: `${Math.min(c.pct, 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[9px] truncate max-w-[120px] text-bp-text-secondary">{c.name}</span>
                  <span className="text-[9px] flex-shrink-0 text-bp-text-secondary">{c.pct}%</span>
                  <span className="text-[9px] flex-shrink-0 text-bp-text-secondary">{formatNpr(c.value)}</span>
                </div>
              ))}
            </div>

            {/* Timeline */}
            {drilldown.timeline.length > 0 && (
              <div className="mb-3">
                <div className="text-[9px] uppercase mb-1 text-bp-text-secondary">Timeline</div>
                <div className="space-y-0.5 max-h-[100px] overflow-y-auto">
                  {drilldown.timeline.slice(0, 10).map((t, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[9px]">
                      <span className="flex-shrink-0 w-[65px] text-bp-text-secondary">{t.date || '--'}</span>
                      <span className="w-1 h-1 rounded-full bg-bp-primary/50 flex-shrink-0" />
                      <span className="truncate flex-1 text-bp-text-secondary">{t.contractor}</span>
                      <span className="flex-shrink-0 text-bp-text-secondary">{formatNpr(t.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* OCR Status */}
            <div className="mb-3">
              <div className="text-[9px] uppercase mb-1 text-bp-text-secondary">OCR Status</div>
              {drilldown.contractors.slice(0, 3).map((c) => (
                <div key={c.name} className="flex items-center gap-1 text-[9px]">
                  {c.ocr_match ? (
                    <ShieldCheck size={9} className="text-bp-success flex-shrink-0" />
                  ) : (
                    <XCircle size={9} className="text-severity-critical flex-shrink-0" />
                  )}
                  <span className={c.ocr_match ? 'text-bp-success' : 'text-severity-critical'}>
                    {c.name.length > 30 ? c.name.slice(0, 30) + '...' : c.name}
                  </span>
                  <span className="ml-auto text-bp-text-secondary">
                    {c.ocr_match ? `Reg#${c.ocr_match.registration_number}` : 'NOT FOUND'}
                  </span>
                </div>
              ))}
            </div>

            {/* Flags */}
            {drilldown.flags.length > 0 && (
              <div className="mb-3">
                <div className="text-[9px] uppercase mb-1 text-bp-text-secondary">Flags</div>
                {drilldown.flags.slice(0, 5).map((f, i) => (
                  <div key={i} className="flex items-start gap-1 text-[9px] mb-0.5">
                    <AlertTriangle
                      size={9}
                      className={`flex-shrink-0 mt-0.5 ${
                        f.severity === 'critical' ? 'text-severity-critical' : 'text-severity-high'
                      }`}
                    />
                    <span className="text-bp-text-secondary">{f.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Existing Cases */}
            <div className="mb-3">
              <div className="text-[9px] uppercase mb-1 text-bp-text-secondary">Existing Cases</div>
              {drilldown.existing_cases.length === 0 ? (
                <div className="text-[9px] text-bp-text-secondary">None</div>
              ) : (
                drilldown.existing_cases.map((c) => (
                  <div key={c.id} className="text-[9px] text-bp-primary">{c.title} ({c.status})</div>
                ))
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-1.5 flex-wrap">
              <Button small icon={<Search size={9} />} text="Create Case" intent={Intent.PRIMARY}
                onClick={() => handleCreateCase(selectedFlag)} className="text-[9px]" />
              <Button small icon={<CheckCircle size={9} />} text="Verify" minimal
                onClick={() => handleVerify(selectedFlag)} className="text-[9px] text-bp-text-secondary" />
              <Button small icon={<Eye size={9} />} text="Watch" minimal disabled
                className="text-[9px] text-bp-text-muted" title="Watch (coming soon)" />
              <Button small icon={<FileText size={9} />} text="Note" minimal disabled
                className="text-[9px] text-bp-text-muted" title="Note (coming soon)" />
            </div>
          </div>
        </div>
      )}

      {/* Section D: OCR Cross-Reference (collapsible) */}
      <div className="px-3 py-1.5 border-t border-bp-border">
        <button
          onClick={() => setOcrExpanded(!ocrExpanded)}
          className="flex items-center gap-1 w-full text-left"
        >
          {ocrExpanded ? (
            <ChevronDown size={10} className="text-bp-text-secondary" />
          ) : (
            <ChevronRight size={10} className="text-bp-text-secondary" />
          )}
          <span className="text-[10px] uppercase tracking-wider font-medium text-bp-text-secondary">
            OCR Registry Matches
          </span>
          {ocrMatches.length > 0 && (
            <span className="text-[9px] ml-auto text-bp-text-secondary">
              {ocrMatches.filter((m) => m.match_type !== 'none').length}/{ocrMatches.length} matched
            </span>
          )}
        </button>

        {ocrExpanded && (
          <div className="mt-1.5 space-y-0.5 max-h-[200px] overflow-y-auto">
            {ocrMatches.length === 0 && (
              <div className="text-[9px] py-2 text-center text-bp-text-secondary">
                <Spinner size={10} className="inline mr-1" />
                Loading OCR matches...
              </div>
            )}
            {ocrMatches.map((m, i) => (
              <div key={i} className="flex items-center gap-1 text-[9px]">
                {m.match_type === 'exact' && (
                  <ShieldCheck size={9} className="text-bp-success flex-shrink-0" />
                )}
                {m.match_type === 'fuzzy' && (
                  <Shield size={9} className="text-severity-high flex-shrink-0" />
                )}
                {m.match_type === 'none' && (
                  <XCircle size={9} className="text-severity-critical/50 flex-shrink-0" />
                )}
                <span
                  className={`truncate flex-1 ${
                    m.match_type === 'exact'
                      ? 'text-bp-success'
                      : m.match_type === 'fuzzy'
                        ? 'text-severity-high'
                        : 'text-bp-text-secondary'
                  }`}
                >
                  {m.contractor_name.length > 22 ? m.contractor_name.slice(0, 22) + '...' : m.contractor_name}
                </span>
                <span className="flex-shrink-0 text-right max-w-[120px] truncate text-bp-text-secondary">
                  {m.match_type === 'none'
                    ? 'NOT FOUND'
                    : m.company
                      ? `Reg#${m.company.registration_number}, ${m.company.district || '?'}`
                      : '--'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section E: Same-Day Awards (collapsible) */}
      <div className="px-3 py-1.5 border-t border-bp-border">
        <button
          onClick={() => setSameDayExpanded(!sameDayExpanded)}
          className="flex items-center gap-1 w-full text-left"
        >
          {sameDayExpanded ? (
            <ChevronDown size={10} className="text-bp-text-secondary" />
          ) : (
            <ChevronRight size={10} className="text-bp-text-secondary" />
          )}
          <span className="text-[10px] uppercase tracking-wider font-medium text-bp-text-secondary">
            Same-Day Multi-Awards
          </span>
          {sameDayAwards.length > 0 && (
            <span className="text-[9px] ml-auto text-bp-text-secondary">{sameDayAwards.length} clusters</span>
          )}
        </button>

        {sameDayExpanded && (
          <div className="mt-1.5 space-y-2 max-h-[200px] overflow-y-auto">
            {sameDayAwards.length === 0 && (
              <div className="text-[9px] py-2 text-center text-bp-text-secondary">
                <Spinner size={10} className="inline mr-1" />
                Loading same-day awards...
              </div>
            )}
            {sameDayAwards.slice(0, 20).map((sda, i) => (
              <div key={i} className="rounded p-1.5 bg-bp-bg border border-bp-border">
                <div className="flex items-center gap-1 text-[9px] mb-1">
                  <span className="text-bp-warning/80 font-mono">{sda.award_date || '--'}</span>
                  <span className="truncate text-bp-text-secondary">{sda.procuring_entity}</span>
                </div>
                {sda.contractors.map((c, j) => (
                  <div key={j} className="flex items-center gap-1 text-[9px] ml-2">
                    <span className="text-bp-text-secondary">&#x2192;</span>
                    <span className="truncate flex-1 text-bp-text-secondary">
                      {c.name.length > 20 ? c.name.slice(0, 20) + '...' : c.name}
                    </span>
                    <span className="flex-shrink-0 text-bp-text-secondary">{formatNpr(c.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom padding */}
      <div className="h-4 flex-shrink-0" />
    </div>
  )
}
