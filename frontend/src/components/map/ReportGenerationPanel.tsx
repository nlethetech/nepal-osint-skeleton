/**
 * Report Generation Panel - PDF/PNG/CSV export for intelligence reports
 */
import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  Download,
  Image,
  Table,
  Code,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  X,
  RefreshCw,
  Trash2,
  Eye,
} from 'lucide-react';
import apiClient from '../../api/client';

type ReportFormat = 'pdf' | 'png' | 'csv' | 'json';
type ReportType =
  | 'situational'
  | 'entity_dossier'
  | 'damage_assessment'
  | 'threat_matrix'
  | 'case_summary'
  | 'network_analysis';
type ReportStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface ReportMetadata {
  id: string;
  report_type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  title: string;
  created_at: string;
  completed_at?: string;
  file_path?: string;
  file_size?: number;
  download_url?: string;
  error?: string;
  request_params: Record<string, unknown>;
}

interface BoundingBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

const REPORT_TYPES: { id: ReportType; name: string; description: string }[] = [
  { id: 'situational', name: 'Situational Report', description: 'Current situation overview' },
  { id: 'entity_dossier', name: 'Entity Dossier', description: 'Comprehensive entity profile' },
  { id: 'damage_assessment', name: 'Damage Assessment', description: 'Satellite damage analysis' },
  { id: 'threat_matrix', name: 'Threat Matrix', description: 'Threat level breakdown' },
  { id: 'case_summary', name: 'Case Summary', description: 'Investigation case summary' },
  { id: 'network_analysis', name: 'Network Analysis', description: 'Entity network visualization' },
];

const FORMAT_ICONS: Record<ReportFormat, React.ReactNode> = {
  pdf: <FileText size={14} />,
  png: <Image size={14} />,
  csv: <Table size={14} />,
  json: <Code size={14} />,
};

const STATUS_STYLES: Record<ReportStatus, { bg: string; text: string; icon: React.ReactNode }> = {
  queued: { bg: 'bg-slate-600/30', text: 'text-slate-400', icon: <Clock size={12} /> },
  processing: {
    bg: 'bg-yellow-600/30',
    text: 'text-yellow-400',
    icon: <Loader2 size={12} className="animate-spin" />,
  },
  completed: { bg: 'bg-green-600/30', text: 'text-green-400', icon: <Check size={12} /> },
  failed: { bg: 'bg-red-600/30', text: 'text-red-400', icon: <AlertCircle size={12} /> },
};

interface ReportGenerationPanelProps {
  bbox?: BoundingBox;
  entityId?: string;
  caseId?: string;
}

export function ReportGenerationPanel({
  bbox,
  entityId,
  caseId,
}: ReportGenerationPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [reports, setReports] = useState<ReportMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Form state
  const [reportType, setReportType] = useState<ReportType>('situational');
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [title, setTitle] = useState('');
  const [hours, setHours] = useState(24);
  const [categories, setCategories] = useState<string[]>([]);
  const [severities, setSeverities] = useState<string[]>([]);
  const [includeMap, setIncludeMap] = useState(true);
  const [includeCharts, setIncludeCharts] = useState(true);

  // Fetch existing reports
  const fetchReports = useCallback(async () => {
    try {
      const response = await apiClient.get('/reports', { params: { limit: 10 } })
      setReports(response.data.reports)
    } catch (error) {
      console.error('Failed to fetch reports:', error);
    }
  }, []);

  // Generate report
  const generateReport = async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.post('/reports/generate', {
        report_type: reportType,
        format,
        title: title || undefined,
        hours,
        categories,
        severities,
        entity_id: entityId,
        case_id: caseId,
        include_map: includeMap,
        map_bbox: bbox,
        include_charts: includeCharts,
        include_stories: true,
        include_entities: true,
        include_summary: true,
        max_stories: 50,
      })

      const data: ReportMetadata = response.data
      setReports((prev) => [data, ...prev]);
      setTitle('');
      pollReportStatus(data.id);
    } catch (error) {
      console.error('Failed to generate report:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Poll report status
  const pollReportStatus = async (reportId: string) => {
    const maxAttempts = 30;
    let attempts = 0;

    const poll = async () => {
      try {
        const response = await apiClient.get(`/reports/${reportId}/status`)
        const data: ReportMetadata = response.data
        setReports((prev) => prev.map((r) => (r.id === reportId ? data : r)));

        if (data.status === 'processing' || data.status === 'queued') {
          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(poll, 2000);
          }
        }
      } catch (error) {
        console.error('Failed to poll report status:', error);
      }
    };

    poll();
  };

  // Delete report
  const deleteReport = async (reportId: string) => {
    try {
      await apiClient.delete(`/reports/${reportId}`)
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (error) {
      console.error('Failed to delete report:', error);
    }
  };

  // Download report
  const downloadReport = async (report: ReportMetadata) => {
    if (report.status !== 'completed' || !report.download_url) return;

    try {
      if (report.format !== 'json') {
        console.log('Download URL:', report.download_url);
        return
      }

      const response = await apiClient.get(`/reports/${report.id}/download`)
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title.replace(/\s+/g, '_')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download report:', error);
    }
  };

  // Fetch reports on mount
  useEffect(() => {
    if (isExpanded) {
      fetchReports();
    }
  }, [isExpanded, fetchReports]);

  // Format file size
  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Toggle category/severity
  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const toggleSeverity = (sev: string) => {
    setSeverities((prev) =>
      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev]
    );
  };

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="absolute right-4 bottom-20 z-[1000] bg-slate-800/90 backdrop-blur-sm text-white p-2 rounded-lg shadow-lg hover:bg-slate-700 transition-colors"
        title="Generate Reports"
      >
        <FileText size={20} />
      </button>
    );
  }

  return (
    <div className="absolute right-4 bottom-20 z-[1000] w-80 bg-slate-900/95 backdrop-blur-sm rounded-lg shadow-xl border border-slate-700/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/50 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-cyan-400" />
          <span className="text-sm font-medium text-white">Report Generation</span>
        </div>
        <button
          onClick={() => setIsExpanded(false)}
          className="p-1 hover:bg-slate-700/50 rounded transition-colors"
        >
          <X size={14} className="text-slate-400" />
        </button>
      </div>

      <div className="p-3 space-y-3 max-h-[500px] overflow-y-auto">
        {/* Report Type */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Report Type</span>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as ReportType)}
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white"
          >
            {REPORT_TYPES.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            {REPORT_TYPES.find((t) => t.id === reportType)?.description}
          </p>
        </div>

        {/* Format */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Format</span>
          <div className="flex gap-1.5">
            {(['pdf', 'png', 'csv', 'json'] as ReportFormat[]).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs uppercase transition-colors ${
                  format === f
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {FORMAT_ICONS[f]}
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Title (optional)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Auto-generated if empty"
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-xs text-white placeholder-slate-500"
          />
        </div>

        {/* Time Window */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Time Window</span>
          <div className="flex gap-1.5">
            {[6, 12, 24, 48, 72, 168].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`flex-1 px-2 py-1 rounded text-xs transition-colors ${
                  hours === h
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {h < 24 ? `${h}h` : `${h / 24}d`}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Categories</span>
          <div className="flex flex-wrap gap-1.5">
            {['political', 'social', 'economic', 'disaster', 'security'].map((cat) => (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
                  categories.includes(cat)
                    ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/50'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Severities */}
        <div className="space-y-1.5">
          <span className="text-xs text-slate-400 font-medium">Severity Levels</span>
          <div className="flex flex-wrap gap-1.5">
            {['critical', 'high', 'medium', 'low'].map((sev) => (
              <button
                key={sev}
                onClick={() => toggleSeverity(sev)}
                className={`px-2 py-1 rounded text-xs capitalize transition-colors ${
                  severities.includes(sev)
                    ? 'bg-cyan-600/30 text-cyan-400 border border-cyan-500/50'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={includeMap}
              onChange={(e) => setIncludeMap(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700"
            />
            Include Map
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={includeCharts}
              onChange={(e) => setIncludeCharts(e.target.checked)}
              className="rounded bg-slate-800 border-slate-700"
            />
            Include Charts
          </label>
        </div>

        {/* Generate Button */}
        <button
          onClick={generateReport}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-cyan-600 text-white rounded text-xs font-medium hover:bg-cyan-500 disabled:opacity-50 transition-colors"
        >
          {isLoading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <FileText size={14} />
          )}
          Generate Report
        </button>

        {/* Recent Reports */}
        {reports.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400 font-medium">Recent Reports</span>
              <button
                onClick={fetchReports}
                className="p-1 hover:bg-slate-700/50 rounded transition-colors"
              >
                <RefreshCw size={12} className="text-slate-400" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="p-2 bg-slate-800/50 rounded border border-slate-700/50"
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white truncate">{report.title}</div>
                      <div className="text-xs text-slate-500">
                        {new Date(report.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <span
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${
                          STATUS_STYLES[report.status].bg
                        } ${STATUS_STYLES[report.status].text}`}
                      >
                        {STATUS_STYLES[report.status].icon}
                        {report.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 flex items-center gap-1">
                      {FORMAT_ICONS[report.format]}
                      {report.format.toUpperCase()}
                      {report.file_size && ` • ${formatFileSize(report.file_size)}`}
                    </span>
                    <div className="flex gap-1">
                      {report.status === 'completed' && (
                        <>
                          <button
                            onClick={() => downloadReport(report)}
                            className="p-1 bg-cyan-600/30 text-cyan-400 rounded hover:bg-cyan-600/40 transition-colors"
                            title="Download"
                          >
                            <Download size={12} />
                          </button>
                          <button
                            onClick={() => {}}
                            className="p-1 bg-slate-700/50 text-slate-400 rounded hover:bg-slate-700 transition-colors"
                            title="Preview"
                          >
                            <Eye size={12} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => deleteReport(report.id)}
                        className="p-1 bg-red-600/30 text-red-400 rounded hover:bg-red-600/40 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {report.error && (
                    <div className="mt-1 text-xs text-red-400">{report.error}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
