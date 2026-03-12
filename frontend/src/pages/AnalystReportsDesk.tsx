import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Spinner, Tag } from '@blueprintjs/core';
import { AlertTriangle, Download, FileText, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AnalystShell } from '../components/layout/AnalystShell';
import { useReportDeskActions, useReportDeskData, type ReportDeskTypeFilter } from '../api/hooks/useReportDesk';
import type { ReportDeskItem } from '../types/reportDesk';
import { getAutonomousCorePaper } from '../api/connectedAnalyst';
import { reportsApi, type ReportMetadata } from '../api/geospatial';
import { downloadEntityReport, downloadPANReport, downloadRiskReport } from '../api/reports';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

const WINDOW_OPTIONS = [
  { label: '24h', value: 24 },
  { label: '72h', value: 72 },
  { label: '7d', value: 24 * 7 },
  { label: '30d', value: 24 * 30 },
] as const;

const STATUS_OPTIONS = ['queued', 'processing', 'completed', 'failed', 'active', 'closed'] as const;
const REPORT_TYPE_OPTIONS: ReportDeskTypeFilter[] = [
  'political',
  'security',
  'damage',
  'case_summary',
  'situational',
  'threat_matrix',
  'network_analysis',
];

function formatRelative(iso?: string | null): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function groupItems(items: ReportDeskItem[]) {
  const todayStart = startOfToday();
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const grouped = {
    today: [] as ReportDeskItem[],
    last7d: [] as ReportDeskItem[],
    older: [] as ReportDeskItem[],
  };

  for (const item of items) {
    const ts = item.created_at ? new Date(item.created_at).getTime() : 0;
    if (ts >= todayStart) grouped.today.push(item);
    else if (ts >= weekStart) grouped.last7d.push(item);
    else grouped.older.push(item);
  }

  return grouped;
}

function statusIntent(status: string): 'success' | 'warning' | 'danger' | 'none' {
  if (status === 'completed' || status === 'closed') return 'success';
  if (status === 'processing' || status === 'active') return 'warning';
  if (status === 'failed') return 'danger';
  return 'none';
}

export default function AnalystReportsDesk() {
  const navigate = useNavigate();
  const [windowHours, setWindowHours] = useState(72);
  const [includeAutonomousPapers, setIncludeAutonomousPapers] = useState(true);
  const [includeReportJobs, setIncludeReportJobs] = useState(true);
  const [includeCaseSummaries, setIncludeCaseSummaries] = useState(true);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [reportTypes, setReportTypes] = useState<ReportDeskTypeFilter[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [corporateEntityId, setCorporateEntityId] = useState('');
  const [corporatePan, setCorporatePan] = useState('');

  const filters = {
    windowHours,
    includeAutonomousPapers,
    includeReportJobs,
    includeCaseSummaries,
    statuses,
    reportTypes,
  };

  const { items, kpis, autonomousSummary, isLoading, isFetching, error } = useReportDeskData(filters);
  const actions = useReportDeskActions();

  const groupedItems = useMemo(() => groupItems(items), [items]);
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedItemId) ?? null,
    [items, selectedItemId],
  );

  useEffect(() => {
    if (!selectedItemId && items.length > 0) {
      setSelectedItemId(items[0].id);
      return;
    }
    if (selectedItemId && !items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(items[0]?.id ?? null);
    }
  }, [items, selectedItemId]);

  const autonomousDetailQuery = useQuery({
    queryKey: ['report-desk', 'autonomous-detail', selectedItem?.source, selectedItem?.id],
    queryFn: () => {
      if (!selectedItem || selectedItem.source !== 'autonomous_paper') {
        return Promise.resolve(null);
      }
      return getAutonomousCorePaper(selectedItem.payload.id);
    },
    enabled: selectedItem?.source === 'autonomous_paper',
    staleTime: 30_000,
  });

  const onGenerateAutonomous = () => {
    actions.generateAutonomous.mutate(windowHours, {
      onSuccess: () => setMessage('Autonomous core papers generated.'),
      onError: (err) => setMessage(err instanceof Error ? err.message : 'Failed to generate autonomous papers.'),
    });
  };

  const onGenerateThreatMatrix = () => {
    actions.generateThreatMatrixJob.mutate(undefined, {
      onSuccess: () => setMessage('Threat matrix report job queued.'),
      onError: (err) => setMessage(err instanceof Error ? err.message : 'Failed to queue threat matrix job.'),
    });
  };

  const onGenerateEntityList = () => {
    actions.generateEntityListJob.mutate(undefined, {
      onSuccess: () => setMessage('Quick entity-list report job queued.'),
      onError: (err) => setMessage(err instanceof Error ? err.message : 'Failed to queue quick entity-list job.'),
    });
  };

  const onRefreshAll = async () => {
    try {
      await actions.refreshAll();
      setMessage('Refreshed report sources.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to refresh report sources.');
    }
  };

  const onDownloadReportJob = async (job: ReportMetadata) => {
    try {
      if (job.status !== 'completed') return;
      if (job.format === 'json') {
        const payload = await reportsApi.download(job.id);
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${job.title.replace(/\s+/g, '_')}_${job.id}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setMessage('Report downloaded.');
        return;
      }
      if (job.download_url) {
        window.open(job.download_url, '_blank', 'noopener,noreferrer');
        setMessage('Attempted report download in a new tab.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to download report.');
    }
  };

  const onOpenAutonomousRawJson = () => {
    const payload = autonomousDetailQuery.data;
    if (!payload) return;
    const raw = JSON.stringify(payload, null, 2);
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const onExportAutonomousMarkdown = () => {
    const payload = autonomousDetailQuery.data as Record<string, unknown> | null;
    const markdown = typeof payload?.markdown === 'string' ? payload.markdown : '';
    if (!markdown) return;
    const title = typeof payload?.metadata === 'object' && payload?.metadata
      ? String((payload.metadata as Record<string, unknown>).title || 'autonomous-paper')
      : 'autonomous-paper';
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Markdown exported.');
  };

  const toggleStatus = (status: string) => {
    setStatuses((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  };

  const toggleReportType = (reportType: ReportDeskTypeFilter) => {
    setReportTypes((prev) => (
      prev.includes(reportType) ? prev.filter((r) => r !== reportType) : [...prev, reportType]
    ));
  };

  const leftRail = (
    <div className="h-full overflow-y-auto space-y-2">
      <Card className="bg-bp-card border border-bp-border p-3">
        <p className="bp-section-header mb-2">Time Window</p>
        <div className="grid grid-cols-2 gap-1.5">
          {WINDOW_OPTIONS.map((option) => (
            <Button
              key={option.value}
              small
              outlined
              onClick={() => setWindowHours(option.value)}
              className={windowHours === option.value ? 'border-bp-primary text-bp-text' : 'text-bp-text-secondary'}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="bg-bp-card border border-bp-border p-3">
        <p className="bp-section-header mb-2">Sources</p>
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs text-bp-text-secondary">
            <input type="checkbox" checked={includeAutonomousPapers} onChange={(e) => setIncludeAutonomousPapers(e.target.checked)} />
            Autonomous Papers
          </label>
          <label className="flex items-center gap-2 text-xs text-bp-text-secondary">
            <input type="checkbox" checked={includeReportJobs} onChange={(e) => setIncludeReportJobs(e.target.checked)} />
            Report Jobs
          </label>
          <label className="flex items-center gap-2 text-xs text-bp-text-secondary">
            <input type="checkbox" checked={includeCaseSummaries} onChange={(e) => setIncludeCaseSummaries(e.target.checked)} />
            Case Summaries
          </label>
        </div>
      </Card>

      <Card className="bg-bp-card border border-bp-border p-3">
        <p className="bp-section-header mb-2">Status Filters</p>
        <div className="flex flex-wrap gap-1">
          {STATUS_OPTIONS.map((status) => (
            <Tag
              key={status}
              interactive
              minimal
              onClick={() => toggleStatus(status)}
              className={`cursor-pointer border ${statuses.includes(status) ? 'border-bp-primary text-bp-text' : 'border-bp-border text-bp-text-secondary'}`}
            >
              {status}
            </Tag>
          ))}
        </div>
      </Card>

      <Card className="bg-bp-card border border-bp-border p-3">
        <p className="bp-section-header mb-2">Report Type Filters</p>
        <div className="flex flex-wrap gap-1">
          {REPORT_TYPE_OPTIONS.map((type) => (
            <Tag
              key={type}
              interactive
              minimal
              onClick={() => toggleReportType(type)}
              className={`cursor-pointer border ${reportTypes.includes(type) ? 'border-bp-primary text-bp-text' : 'border-bp-border text-bp-text-secondary'}`}
            >
              {type}
            </Tag>
          ))}
        </div>
      </Card>

      <Card className="bg-bp-card border border-bp-border p-3">
        <p className="bp-section-header mb-2">Corporate Quick Reports</p>
        <div className="space-y-2">
          <div className="space-y-1">
            <input
              value={corporateEntityId}
              onChange={(e) => setCorporateEntityId(e.target.value)}
              className="w-full rounded border border-bp-border bg-bp-bg px-2 py-1 text-xs text-bp-text"
              placeholder="Company ID (UUID)"
            />
            <Button
              small
              fill
              icon={<Download size={12} />}
              onClick={() => {
                if (!corporateEntityId.trim()) return;
                void downloadEntityReport(corporateEntityId.trim())
                  .then(() => setMessage('Entity dossier download started.'))
                  .catch((err) => setMessage(err instanceof Error ? err.message : 'Entity dossier download failed.'));
              }}
            >
              Entity Dossier PDF
            </Button>
          </div>

          <div className="space-y-1">
            <input
              value={corporatePan}
              onChange={(e) => setCorporatePan(e.target.value)}
              className="w-full rounded border border-bp-border bg-bp-bg px-2 py-1 text-xs text-bp-text"
              placeholder="PAN"
            />
            <Button
              small
              fill
              icon={<Download size={12} />}
              onClick={() => {
                if (!corporatePan.trim()) return;
                void downloadPANReport(corporatePan.trim())
                  .then(() => setMessage('PAN investigation report download started.'))
                  .catch((err) => setMessage(err instanceof Error ? err.message : 'PAN report download failed.'));
              }}
            >
              PAN Investigation PDF
            </Button>
          </div>

          <Button
            small
            fill
            icon={<Download size={12} />}
            onClick={() => {
              void downloadRiskReport()
                .then(() => setMessage('Risk summary report download started.'))
                .catch((err) => setMessage(err instanceof Error ? err.message : 'Risk summary download failed.'));
            }}
          >
            Risk Summary PDF
          </Button>
        </div>
      </Card>
    </div>
  );

  const center = (
    <div className="h-full min-h-0 flex flex-col gap-2">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <Card className="bg-bp-card border border-bp-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-bp-text-secondary">Reports Generated</p>
          <p className="text-xl font-semibold text-bp-text mt-1">{kpis.reports_generated}</p>
        </Card>
        <Card className="bg-bp-card border border-bp-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-bp-text-secondary">Pending / Failed Jobs</p>
          <p className="text-xl font-semibold text-bp-warning mt-1">{kpis.pending_or_failed_jobs}</p>
        </Card>
        <Card className="bg-bp-card border border-bp-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-bp-text-secondary">Active Cases</p>
          <p className="text-xl font-semibold text-bp-primary mt-1">{kpis.active_cases}</p>
        </Card>
        <Card className="bg-bp-card border border-bp-border p-3">
          <p className="text-[10px] uppercase tracking-wide text-bp-text-secondary">Throughput Proxy</p>
          <p className="text-xl font-semibold text-bp-success mt-1">{kpis.throughput_proxy}</p>
        </Card>
      </div>

      <Card className="bg-bp-card border border-bp-border p-3 flex-1 min-h-0 overflow-y-auto">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Spinner size={20} />
          </div>
        ) : (
          <div className="space-y-4">
            {(['today', 'last7d', 'older'] as const).map((groupKey) => {
              const title = groupKey === 'today' ? 'Today' : groupKey === 'last7d' ? 'Last 7 days' : 'Older';
              const list = groupedItems[groupKey];
              if (list.length === 0) return null;
              return (
                <section key={groupKey} className="space-y-1.5">
                  <p className="bp-section-header">{title}</p>
                  <div className="space-y-1.5">
                    {list.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedItemId(item.id)}
                        className={`w-full text-left rounded border px-2 py-2 transition-colors ${selectedItemId === item.id ? 'border-bp-primary bg-bp-primary/10' : 'border-bp-border bg-bp-surface hover:bg-bp-hover'}`}
                      >
                        {item.source === 'autonomous_paper' && (
                          <>
                            <div className="flex items-center gap-2">
                              <Sparkles size={12} className="text-bp-primary" />
                              <p className="text-xs font-semibold text-bp-text truncate">{item.payload.title}</p>
                              <Tag minimal intent={statusIntent(item.status)} className="ml-auto text-[10px]">{item.status}</Tag>
                            </div>
                            <p className="text-[10px] text-bp-text-secondary mt-1">
                              {item.payload.report_type} • {item.payload.citations_count} citations • {formatRelative(item.created_at)}
                            </p>
                            {item.payload.highlights?.length > 0 && (
                              <p className="text-[11px] text-bp-text-secondary mt-1 truncate">
                                {item.payload.highlights[0]}
                              </p>
                            )}
                          </>
                        )}

                        {item.source === 'report_job' && (
                          <>
                            <div className="flex items-center gap-2">
                              <FileText size={12} className="text-bp-primary" />
                              <p className="text-xs font-semibold text-bp-text truncate">{item.payload.title}</p>
                              <Tag minimal intent={statusIntent(item.status)} className="ml-auto text-[10px]">{item.status}</Tag>
                            </div>
                            <p className="text-[10px] text-bp-text-secondary mt-1">
                              {item.payload.report_type} • {item.payload.format} • {formatRelative(item.created_at)}
                            </p>
                          </>
                        )}

                        {item.source === 'case_summary' && (
                          <>
                            <div className="flex items-center gap-2">
                              <ShieldCheck size={12} className="text-bp-primary" />
                              <p className="text-xs font-semibold text-bp-text truncate">{item.payload.title}</p>
                              <Tag minimal intent={statusIntent(item.status)} className="ml-auto text-[10px]">{item.status}</Tag>
                            </div>
                            <p className="text-[10px] text-bp-text-secondary mt-1">
                              priority {item.payload.priority} • evidence {item.payload.evidence_count} • comments {item.payload.comment_count} • {formatRelative(item.created_at)}
                            </p>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            {items.length === 0 && (
              <p className="text-xs text-bp-text-secondary">No report items in the selected filters/window.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );

  const rightRail = (
    <Card className="h-full bg-bp-card border border-bp-border p-3 overflow-y-auto">
      {!selectedItem && (
        <p className="text-xs text-bp-text-secondary">Select a report item to inspect details.</p>
      )}

      {selectedItem?.source === 'autonomous_paper' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-bp-primary" />
            <p className="text-sm font-semibold text-bp-text">{selectedItem.payload.title}</p>
          </div>
          <div className="text-[11px] text-bp-text-secondary">
            {selectedItem.payload.report_type} • {selectedItem.payload.citations_count} citations • {formatRelative(selectedItem.created_at)}
          </div>

          <div className="flex gap-2">
            <Button small icon={<FileText size={12} />} onClick={onOpenAutonomousRawJson} disabled={!autonomousDetailQuery.data}>
              Open Raw JSON
            </Button>
            <Button small icon={<Download size={12} />} onClick={onExportAutonomousMarkdown} disabled={!autonomousDetailQuery.data}>
              Export Markdown
            </Button>
          </div>

          {autonomousDetailQuery.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-bp-text-secondary"><Spinner size={14} /> Loading report detail...</div>
          ) : (
            <>
              <div className="rounded border border-bp-border bg-bp-surface p-2 prose prose-invert prose-sm max-w-none [&_p]:text-[11px] [&_li]:text-[11px]">
                <ReactMarkdown>{String((autonomousDetailQuery.data as Record<string, unknown> | null)?.markdown || '')}</ReactMarkdown>
              </div>
              <div className="rounded border border-bp-border bg-bp-surface p-2">
                <p className="bp-section-header mb-1">Citations</p>
                {Array.isArray((autonomousDetailQuery.data as Record<string, unknown> | null)?.citations) &&
                ((autonomousDetailQuery.data as Record<string, unknown>).citations as Array<Record<string, unknown>>).length > 0 ? (
                  <div className="space-y-1">
                    {((autonomousDetailQuery.data as Record<string, unknown>).citations as Array<Record<string, unknown>>).map((citation, idx) => (
                      <div key={`${citation.id ?? idx}`} className="text-[11px] text-bp-text-secondary">
                        [{idx + 1}] {String(citation.source_name || citation.source_id || 'source')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-bp-text-secondary">No citations.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {selectedItem?.source === 'report_job' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-bp-text">{selectedItem.payload.title}</p>
          <div className="flex items-center gap-2">
            <Tag minimal intent={statusIntent(selectedItem.status)}>{selectedItem.status}</Tag>
            <span className="text-[11px] text-bp-text-secondary">{selectedItem.payload.report_type}</span>
            <span className="text-[11px] text-bp-text-secondary">{selectedItem.payload.format}</span>
          </div>
          <p className="text-[11px] text-bp-text-secondary">Created {formatRelative(selectedItem.created_at)}</p>
          <Button
            small
            icon={<Download size={12} />}
            disabled={selectedItem.payload.status !== 'completed'}
            onClick={() => void onDownloadReportJob(selectedItem.payload)}
          >
            Download
          </Button>
          <div className="rounded border border-bp-border bg-bp-surface p-2">
            <p className="bp-section-header mb-1">Request Params</p>
            <pre className="text-[10px] text-bp-text-secondary whitespace-pre-wrap break-words">
              {JSON.stringify(selectedItem.payload.request_params || {}, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {selectedItem?.source === 'case_summary' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-bp-text">{selectedItem.payload.title}</p>
          <div className="flex items-center gap-2">
            <Tag minimal intent={statusIntent(selectedItem.status)}>{selectedItem.status}</Tag>
            <span className="text-[11px] text-bp-text-secondary">priority {selectedItem.payload.priority}</span>
          </div>
          <div className="rounded border border-bp-border bg-bp-surface p-2 text-[11px] text-bp-text-secondary space-y-1">
            <p>Evidence: <span className="text-bp-text">{selectedItem.payload.evidence_count}</span></p>
            <p>Comments: <span className="text-bp-text">{selectedItem.payload.comment_count}</span></p>
            <p>Hypothesis: <span className="text-bp-text">{selectedItem.payload.hypothesis || 'n/a'}</span></p>
            <p>Conclusion: <span className="text-bp-text">{selectedItem.payload.conclusion || 'n/a'}</span></p>
          </div>
          <Button small icon={<ShieldCheck size={12} />} onClick={() => navigate('/investigation')}>
            Open In Investigation
          </Button>
        </div>
      )}
    </Card>
  );

  return (
    <AnalystShell
      activePage="analyst"
      frameClassName="overflow-hidden p-3"
      contentClassName="overflow-hidden"
      density="compact"
      layoutConfig={{ centerScrollable: false }}
      toolbar={(
        <div className="flex items-center gap-2 px-3 py-2 bg-bp-card border border-bp-border rounded-lg">
          <Button
            small
            intent="primary"
            icon={<Sparkles size={12} />}
            loading={actions.generateAutonomous.isPending}
            onClick={onGenerateAutonomous}
          >
            Generate Autonomous Papers
          </Button>
          <Button
            small
            icon={<FileText size={12} />}
            loading={actions.generateThreatMatrixJob.isPending}
            onClick={onGenerateThreatMatrix}
          >
            Generate Threat Matrix Job
          </Button>
          <Button
            small
            icon={<FileText size={12} />}
            loading={actions.generateEntityListJob.isPending}
            onClick={onGenerateEntityList}
          >
            Generate Entity List Job
          </Button>
          <Button
            small
            icon={<RefreshCw size={12} />}
            loading={isFetching}
            onClick={() => void onRefreshAll()}
          >
            Refresh All Sources
          </Button>
          <div className="flex-1" />
          {autonomousSummary && (
            <Tag minimal className="text-[10px] border border-bp-border text-bp-text-secondary">
              autonomous 24h {autonomousSummary.generated_last_24h} • 7d {autonomousSummary.generated_last_7d}
            </Tag>
          )}
          {message && (
            <Tag
              minimal
              intent={error ? 'danger' : 'none'}
              className="max-w-[320px] truncate"
              onRemove={() => setMessage(null)}
            >
              {message}
            </Tag>
          )}
          {error && (
            <Tag minimal intent="danger" icon={<AlertTriangle size={12} />}>
              Data load error
            </Tag>
          )}
        </div>
      )}
      leftRail={leftRail}
      center={center}
      rightRail={rightRail}
      status={(
        <div className="px-3 py-1.5 border border-bp-border rounded-lg bg-bp-card text-[10px] text-bp-text-secondary flex items-center gap-3">
          <span>Report Desk</span>
          <span>{items.length} items</span>
          <span>{windowHours}h window</span>
        </div>
      )}
    >
      {null}
    </AnalystShell>
  );
}
