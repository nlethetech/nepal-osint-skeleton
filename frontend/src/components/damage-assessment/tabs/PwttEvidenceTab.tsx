import { useMemo } from 'react';
import { CheckCircle2, Clock, AlertCircle, ExternalLink, Link2 } from 'lucide-react';
import { Tag, Intent } from '@blueprintjs/core';
import {
  getPwttArtifactDisplayUrl,
  type PwttArtifact,
  type PwttFinding,
} from '../../../api/connectedAnalyst';

interface PwttEvidenceTabProps {
  runId: string;
  artifacts: PwttArtifact[];
  findings: PwttFinding[];
}

function statusMeta(status: string) {
  const normalized = (status || '').toLowerCase();
  if (normalized === 'verified') {
    return { icon: CheckCircle2, className: 'text-bp-success', label: 'Verified' };
  }
  if (normalized === 'rejected' || normalized === 'disputed') {
    return { icon: AlertCircle, className: 'text-severity-critical', label: 'Rejected' };
  }
  return { icon: Clock, className: 'text-severity-high', label: 'Candidate' };
}

function isImageArtifact(url: string, artifact: PwttArtifact): boolean {
  if (artifact.mime_type?.startsWith('image/')) return true;
  if (artifact.artifact_type.toLowerCase().includes('three_panel')) return true;
  if (url.includes('/quick-analyze/three-panel')) return true;
  return false;
}

export function PwttEvidenceTab({ runId, artifacts, findings }: PwttEvidenceTabProps) {
  const sortedFindings = useMemo(
    () => [...findings].sort((a, b) => (b.confidence || 0) - (a.confidence || 0)),
    [findings],
  );

  return (
    <div className="p-6 space-y-6">
      <section className="rounded-xl p-4 bg-bp-card border border-bp-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-bp-text">Artifacts</h3>
          <span className="text-xs text-bp-text-muted">{artifacts.length} items</span>
        </div>
        {artifacts.length === 0 ? (
          <p className="text-sm text-bp-text-muted">No artifacts persisted for this run.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {artifacts.map((artifact) => {
              const url = getPwttArtifactDisplayUrl(runId, artifact);
              const canPreview = isImageArtifact(url, artifact);
              return (
                <article key={artifact.id} className="rounded-lg p-3 bg-bp-surface border border-bp-border">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-bp-text">{artifact.artifact_type}</p>
                    <Tag minimal style={{ fontSize: 10 }}>{artifact.source_classification}</Tag>
                  </div>
                  <p className="mt-1 text-[11px] break-all text-bp-text-muted">{artifact.file_path}</p>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-bp-primary hover:text-bp-primary-hover"
                  >
                    <ExternalLink size={12} />
                    Open artifact
                  </a>
                  {canPreview ? (
                    <img
                      src={url}
                      alt={artifact.artifact_type}
                      className="mt-2 w-full max-h-56 object-cover rounded border border-bp-border"
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl p-4 bg-bp-card border border-bp-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-bp-text">Findings And Provenance</h3>
          <span className="text-xs text-bp-text-muted">{sortedFindings.length} findings</span>
        </div>
        {sortedFindings.length === 0 ? (
          <p className="text-sm text-bp-text-muted">No findings extracted for this run.</p>
        ) : (
          <div className="space-y-3">
            {sortedFindings.map((finding) => {
              const meta = statusMeta(finding.verification_status);
              const Icon = meta.icon;
              return (
                <article key={finding.id} className="rounded-lg p-3 bg-bp-surface border border-bp-border">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-medium text-bp-text">
                        {finding.title || finding.finding_type}
                      </h4>
                      <p className="mt-1 text-xs text-bp-text-muted">
                        severity {finding.severity} | confidence {(finding.confidence * 100).toFixed(0)}%
                      </p>
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs ${meta.className}`}>
                      <Icon size={12} />
                      {meta.label}
                    </span>
                  </div>

                  {finding.provenance_refs && finding.provenance_refs.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {finding.provenance_refs.map((ref) => (
                        <div key={ref.id} className="rounded p-2 bg-bp-card border border-bp-border">
                          <p className="text-xs flex items-center gap-1 text-bp-text">
                            <Link2 size={11} />
                            {ref.source_name || ref.source_key || 'Unknown source'}
                          </p>
                          <p className="mt-1 text-[11px] text-bp-text-muted">
                            class {ref.source_classification} | confidence {(ref.confidence * 100).toFixed(0)}%
                          </p>
                          {ref.source_url ? (
                            <a
                              href={ref.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex mt-1 text-[11px] text-bp-primary hover:text-bp-primary-hover"
                            >
                              {ref.source_url}
                            </a>
                          ) : null}
                          {ref.excerpt ? (
                            <p className="mt-1 text-[11px] text-bp-text-muted">{ref.excerpt}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-severity-high">
                      No provenance references on this finding yet.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
