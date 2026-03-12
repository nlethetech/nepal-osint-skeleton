import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button, Card, HTMLSelect, InputGroup, Tag, Tabs, Tab, TextArea, Intent, Spinner } from '@blueprintjs/core';
import {
  attachHypothesisEvidence,
  createHypothesis,
  generateAutonomousCorePapers,
  getAutonomousCorePaper,
  listCases,
  listHypotheses,
  updateHypothesis,
  type AutonomousPapersResponse,
  type Hypothesis,
} from '../../api/connectedAnalyst';
import { API_BASE_URL } from '../../api/client';
import {
  addCaseComment,
  getCaseComments,
  updateCase,
  type Case,
  type CaseComment,
} from '../../api/collaboration';
import { submitCorrection } from '../../api/corrections';

type BoardTab = 'hypotheses' | 'collaboration' | 'corrections' | 'papers';
const API_ORIGIN = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

function CitationSection({ citations }: { citations: Array<{ source_name?: string | null; source_url?: string | null; excerpt?: string | null }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 rounded bg-bp-card border border-bp-border">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-[10px] text-bp-text-secondary"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Citations ({citations.length})
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1">
          {citations.map((c, i) => (
            <p key={i} className="text-[10px] text-bp-text-secondary">
              [{i + 1}] {c.source_name ?? 'Unknown source'}
              {c.source_url && (
                <a
                  href={c.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 underline text-bp-primary"
                >
                  link
                </a>
              )}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export function HypothesisBoard() {
  const [activeTab, setActiveTab] = useState<BoardTab>('hypotheses');
  const [cases, setCases] = useState<Case[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [comments, setComments] = useState<CaseComment[]>([]);

  const [newStatement, setNewStatement] = useState('');
  const [newComment, setNewComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [correctionCandidateId, setCorrectionCandidateId] = useState('');
  const [correctionField, setCorrectionField] = useState('biography');
  const [correctionNewValue, setCorrectionNewValue] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionMessage, setCorrectionMessage] = useState<string | null>(null);

  const [papersPayload, setPapersPayload] = useState<AutonomousPapersResponse | null>(null);
  const [papersLoading, setPapersLoading] = useState(false);
  const [reportDetail, setReportDetail] = useState<Record<string, unknown> | null>(null);
  const [useLlm, setUseLlm] = useState(true);
  const [paperHours, setPaperHours] = useState(168);
  const [singhaRadius, setSinghaRadius] = useState(1.5);

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadCases() {
      setLoading(true);
      setError(null);
      try {
        const rows = await listCases(50);
        if (!cancelled) {
          setCases(rows);
          setSelectedCaseId((previous) => previous ?? rows[0]?.id ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load cases');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadCases();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadHypotheses() {
      if (!selectedCaseId) {
        setHypotheses([]);
        setComments([]);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const [hypothesisResponse, commentResponse] = await Promise.all([
          listHypotheses(selectedCaseId),
          getCaseComments(selectedCaseId),
        ]);
        if (!cancelled) {
          setHypotheses(hypothesisResponse.items);
          setComments(commentResponse);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load case board data');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadHypotheses();
    return () => {
      cancelled = true;
    };
  }, [selectedCaseId]);

  async function handleCreateHypothesis() {
    if (!selectedCaseId || newStatement.trim().length < 3) {
      return;
    }
    const created = await createHypothesis(selectedCaseId, {
      statement: newStatement.trim(),
      confidence: 0.6,
    });
    setHypotheses((prev) => [created, ...prev]);
    setNewStatement('');
  }

  async function handleMarkStatus(hypothesisId: string, status: string) {
    if (!selectedCaseId) {
      return;
    }
    const updated = await updateHypothesis(selectedCaseId, hypothesisId, { status });
    setHypotheses((prev) => prev.map((item) => (item.id === hypothesisId ? updated : item)));
  }

  async function handleAttachSampleEvidence(hypothesisId: string) {
    if (!selectedCaseId) {
      return;
    }

    await attachHypothesisEvidence(selectedCaseId, hypothesisId, {
      relation_type: 'context',
      evidence_type: 'analyst_note',
      source_name: 'Analyst Workspace',
      source_classification: 'independent',
      confidence: 0.65,
      excerpt: 'Analyst attached contextual evidence from connected graph and timeline.',
    });

    const refreshed = await listHypotheses(selectedCaseId);
    setHypotheses(refreshed.items);
  }

  async function handleAddComment() {
    if (!selectedCaseId || newComment.trim().length < 3) {
      return;
    }
    const created = await addCaseComment(selectedCaseId, { content: newComment.trim() });
    setComments((prev) => [...prev, created]);
    setNewComment('');
  }

  async function handleCaseVisibilityChange(visibility: 'public' | 'team' | 'private') {
    if (!selectedCaseId) {
      return;
    }
    const updated = await updateCase(selectedCaseId, { visibility });
    setCases((prev) => prev.map((item) => (item.id === selectedCaseId ? updated : item)));
  }

  async function handleSubmitCorrection() {
    setCorrectionMessage(null);
    if (!correctionCandidateId || !correctionNewValue || correctionReason.length < 10) {
      setCorrectionMessage('Candidate ID, new value, and reason (min 10 chars) are required.');
      return;
    }

    try {
      const response = await submitCorrection(correctionCandidateId, {
        field: correctionField,
        new_value: correctionNewValue,
        reason: correctionReason,
      });
      setCorrectionMessage(`Correction submitted: ${response.id}`);
      setCorrectionNewValue('');
      setCorrectionReason('');
    } catch (err) {
      setCorrectionMessage(err instanceof Error ? err.message : 'Failed to submit correction');
    }
  }

  async function handleGeneratePapers() {
    setPapersLoading(true);
    setError(null);
    try {
      const response = await generateAutonomousCorePapers({
        hours: paperHours,
        singha_radius_km: singhaRadius,
        use_llm: useLlm,
      });
      setPapersPayload(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate autonomous papers');
    } finally {
      setPapersLoading(false);
    }
  }

  async function handleLoadPersistedReport(reportId: string) {
    try {
      const detail = await getAutonomousCorePaper(reportId);
      setReportDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch persisted report');
    }
  }

  function handleExportMarkdown(filename: string, markdown: string) {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function resolvePwttImageUrl(url: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('/api/')) {
      return `${API_ORIGIN}${url}`;
    }
    return url;
  }

  return (
    <section className="h-full flex flex-col bg-bp-bg border border-bp-border rounded-xl">
      <header className="px-3 py-2 border-b border-bp-border">
        <h2 className="text-xs font-semibold tracking-wide uppercase text-bp-text">Hypothesis Board</h2>
        <div className="mt-2 grid grid-cols-1 xl:grid-cols-12 gap-2">
          <div className="xl:col-span-8">
            <HTMLSelect
              fill
              value={selectedCaseId ?? ''}
              onChange={(event) => setSelectedCaseId(event.target.value || null)}
              options={cases.map((item) => ({ value: item.id, label: item.title }))}
            />
          </div>
          <div className="xl:col-span-4">
            <HTMLSelect
              fill
              value={selectedCase?.visibility ?? 'public'}
              onChange={(event) => {
                void handleCaseVisibilityChange(event.target.value as 'public' | 'team' | 'private');
              }}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'team', label: 'Team' },
                { value: 'private', label: 'Private' },
              ]}
            />
          </div>
        </div>
      </header>

      <div className="px-2 py-2 border-b border-bp-border bg-bp-bg">
        <Tabs
          id="hypothesis-tabs"
          selectedTabId={activeTab}
          onChange={(t) => setActiveTab(t as BoardTab)}
        >
          <Tab id="hypotheses" title={<span className={activeTab === 'hypotheses' ? 'text-bp-text' : 'text-bp-text-secondary'}>hypotheses</span>} />
          <Tab id="collaboration" title={<span className={activeTab === 'collaboration' ? 'text-bp-text' : 'text-bp-text-secondary'}>collaboration</span>} />
          <Tab id="corrections" title={<span className={activeTab === 'corrections' ? 'text-bp-text' : 'text-bp-text-secondary'}>corrections</span>} />
          <Tab id="papers" title={<span className={activeTab === 'papers' ? 'text-bp-text' : 'text-bp-text-secondary'}>papers</span>} />
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && (
          <div className="flex items-center gap-2 px-2 py-1">
            <Spinner size={16} />
            <span className="text-xs text-bp-text-secondary">Loading case board...</span>
          </div>
        )}
        {error && <p className="text-xs px-2 py-1 text-severity-critical">{error}</p>}

        {activeTab === 'hypotheses' && (
          <>
            <div className="px-1 py-1 rounded bg-bp-card border border-bp-border">
              <p className="text-[10px] mb-1 text-bp-text-secondary">
                {selectedCase ? `Case ${selectedCase.title}` : 'No case selected'}
              </p>
              <div className="flex items-center gap-2">
                <InputGroup
                  small
                  fill
                  value={newStatement}
                  onChange={(e) => setNewStatement(e.target.value)}
                  placeholder="Add hypothesis statement"
                />
                <Button
                  small
                  intent={Intent.PRIMARY}
                  text="Add"
                  onClick={() => {
                    void handleCreateHypothesis();
                  }}
                />
              </div>
            </div>

            {!loading && !error && hypotheses.length === 0 && (
              <p className="text-xs px-2 py-1 text-bp-text-secondary">No hypotheses for this case.</p>
            )}

            {hypotheses.map((item) => (
              <div key={item.id} className="rounded-lg px-2 py-2 bg-bp-card border border-bp-border">
                <p className="text-xs text-bp-text">{item.statement}</p>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-bp-text-secondary">
                  <span>sources {item.source_count}</span>
                  <span>confidence {item.confidence.toFixed(2)}</span>
                  <span>{item.status}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {['open', 'supported', 'contradicted', 'inconclusive'].map((status) => (
                    <Button
                      key={status}
                      minimal
                      small
                      text={status}
                      onClick={() => {
                        void handleMarkStatus(item.id, status);
                      }}
                      className="!text-[10px] !text-bp-text-secondary"
                    />
                  ))}
                  <Button
                    small
                    intent={Intent.SUCCESS}
                    text="Attach Evidence"
                    onClick={() => {
                      void handleAttachSampleEvidence(item.id);
                    }}
                    className="ml-auto"
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {activeTab === 'collaboration' && (
          <>
            <div className="rounded-lg px-2 py-2 bg-bp-card border border-bp-border">
              <p className="text-xs mb-2 text-bp-text">
                Case collaboration thread {selectedCase ? `for "${selectedCase.title}"` : ''}
              </p>
              <div className="flex items-center gap-2">
                <InputGroup
                  small
                  fill
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add analyst comment for collaborators"
                />
                <Button
                  small
                  intent={Intent.SUCCESS}
                  text="Send"
                  onClick={() => {
                    void handleAddComment();
                  }}
                />
              </div>
            </div>
            {comments.length === 0 ? (
              <p className="text-xs px-2 py-1 text-bp-text-secondary">No comments yet for this case.</p>
            ) : (
              comments.map((item) => (
                <div key={item.id} className="rounded-lg px-2 py-2 bg-bp-card border border-bp-border">
                  <p className="text-xs text-bp-text">{item.content}</p>
                  <p className="mt-1 text-[10px] text-bp-text-secondary">
                    {item.author.full_name || item.author.email} • {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'corrections' && (
          <div className="rounded-lg px-2 py-2 space-y-2 bg-bp-card border border-bp-border">
            <p className="text-xs text-bp-text">
              Submit evidence-backed candidate corrections (biography, name, affiliations, education).
            </p>
            <InputGroup
              fill
              value={correctionCandidateId}
              onChange={(e) => setCorrectionCandidateId(e.target.value)}
              placeholder="Candidate external ID (e.g., 340111)"
            />
            <HTMLSelect
              fill
              value={correctionField}
              onChange={(event) => setCorrectionField(event.target.value)}
              options={[
                { value: 'biography', label: 'biography' },
                { value: 'name_en', label: 'name_en' },
                { value: 'name_ne', label: 'name_ne' },
                { value: 'party', label: 'party' },
                { value: 'education', label: 'education' },
                { value: 'aliases', label: 'aliases' },
              ]}
            />
            <InputGroup
              fill
              value={correctionNewValue}
              onChange={(e) => setCorrectionNewValue(e.target.value)}
              placeholder="Proposed new value"
            />
            <TextArea
              fill
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="Reason with source rationale (minimum 10 chars)"
              className="!resize-none !h-20"
            />
            <Button
              small
              intent={Intent.PRIMARY}
              text="Submit Correction"
              onClick={() => {
                void handleSubmitCorrection();
              }}
            />
            {correctionMessage && <p className="text-xs text-bp-primary">{correctionMessage}</p>}
          </div>
        )}

        {activeTab === 'papers' && (
          <>
            <div className="rounded-lg px-2 py-2 space-y-2 bg-bp-card border border-bp-border">
              <p className="text-xs text-bp-text">
                Generate 3 autonomous papers: political developments, security developments, and Singha Durbar damage assessment.
              </p>
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-2">
                <label className="xl:col-span-3 text-[10px] flex items-center gap-2 text-bp-text-secondary">
                  Hours
                  <InputGroup
                    type="number"
                    value={String(paperHours)}
                    min={24}
                    max={720}
                    onChange={(event) => setPaperHours(Number(event.target.value))}
                    fill
                  />
                </label>
                <label className="xl:col-span-4 text-[10px] flex items-center gap-2 text-bp-text-secondary">
                  Singha radius km
                  <InputGroup
                    type="number"
                    value={String(singhaRadius)}
                    min={0.2}
                    max={10}
                    onChange={(event) => setSinghaRadius(Number(event.target.value))}
                    fill
                  />
                </label>
                <label className="xl:col-span-3 text-[10px] flex items-center gap-2 text-bp-text-secondary">
                  <input
                    type="checkbox"
                    checked={useLlm}
                    onChange={(event) => setUseLlm(event.target.checked)}
                    className="rounded"
                  />
                  Use Claude Haiku
                </label>
                <div className="xl:col-span-2">
                  <Button
                    fill
                    small
                    intent={Intent.PRIMARY}
                    text={papersLoading ? 'Generating...' : 'Generate'}
                    disabled={papersLoading}
                    onClick={() => {
                      void handleGeneratePapers();
                    }}
                  />
                </div>
              </div>
            </div>

            {papersPayload?.warnings?.length ? (
              <div className="rounded px-2 py-2 border border-bp-warning bg-bp-surface">
                {papersPayload.warnings.map((warning) => (
                  <p key={warning} className="text-[10px] text-bp-warning">{warning}</p>
                ))}
              </div>
            ) : null}

            {!papersPayload && !papersLoading && (
              <p className="text-xs px-2 py-1 text-bp-text-secondary">No papers generated yet.</p>
            )}

            {papersPayload?.papers.map((paper) => (
              <article key={paper.paper_key} className="rounded-lg px-2 py-2 bg-bp-card border border-bp-border">
                <h3 className="text-xs font-semibold text-bp-text">{paper.title}</h3>
                <p className="text-[10px] mt-1 text-bp-text-secondary">
                  {new Date(paper.generated_at).toLocaleString()} • citations {paper.citations.length}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    minimal
                    small
                    text="Export Markdown"
                    onClick={() => {
                      handleExportMarkdown(`${paper.paper_key}.md`, paper.markdown);
                    }}
                    className="!text-[10px] !text-bp-text"
                  />
                  {papersPayload.report_ids?.length ? (
                    <Button
                      small
                      intent={Intent.PRIMARY}
                      text="Inspect Citations"
                      onClick={() => {
                        const index = papersPayload.papers.findIndex((item) => item.paper_key === paper.paper_key);
                        const reportId = papersPayload.report_ids?.[index];
                        if (reportId) {
                          void handleLoadPersistedReport(reportId);
                        }
                      }}
                      className="!text-[10px]"
                    />
                  ) : null}
                </div>
                <ul className="mt-2 space-y-1">
                  {paper.highlights.map((highlight) => (
                    <li key={highlight} className="text-[11px] text-bp-text-secondary">
                      - {highlight}
                    </li>
                  ))}
                </ul>

                {paper.pwtt_evidence && (
                  <div className="mt-2 rounded p-2 border border-bp-primary bg-bp-surface">
                    <p className="text-[10px] uppercase tracking-wide text-bp-primary">PWTT Evidence Pack</p>
                    <p className="mt-1 text-[11px] text-bp-text">
                      runs {paper.pwtt_evidence.run_count} • findings {paper.pwtt_evidence.finding_count}
                    </p>
                    <p className="text-[11px] text-bp-text">
                      building signals {paper.pwtt_evidence.building_damage.building_signal_count}
                      {paper.pwtt_evidence.building_damage.reported_buildings_affected !== undefined &&
                      paper.pwtt_evidence.building_damage.reported_buildings_affected !== null
                        ? ` • buildings affected ${paper.pwtt_evidence.building_damage.reported_buildings_affected}`
                        : ''}
                      {paper.pwtt_evidence.building_damage.damaged_area_km2 !== undefined &&
                      paper.pwtt_evidence.building_damage.damaged_area_km2 !== null
                        ? ` • damaged area ${paper.pwtt_evidence.building_damage.damaged_area_km2} km\u00B2`
                        : ''}
                      {paper.pwtt_evidence.building_damage.avg_damage_percentage !== undefined &&
                      paper.pwtt_evidence.building_damage.avg_damage_percentage !== null
                        ? ` • avg damage ${paper.pwtt_evidence.building_damage.avg_damage_percentage}%`
                        : ''}
                    </p>
                    {paper.pwtt_evidence.building_damage.note ? (
                      <p className="mt-1 text-[10px] text-bp-warning">{paper.pwtt_evidence.building_damage.note}</p>
                    ) : null}

                    {paper.pwtt_evidence.three_panel_images.length > 0 ? (
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
                        {paper.pwtt_evidence.three_panel_images.slice(0, 9).map((image) => {
                          const resolved = resolvePwttImageUrl(image.image_url);
                          return (
                            <a
                              key={image.artifact_id}
                              href={resolved}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded p-1 border border-bp-border bg-bp-bg"
                            >
                              <p className="text-[10px] mb-1 text-bp-text-secondary">
                                {image.label} • {image.source_classification}
                              </p>
                              <img
                                src={resolved}
                                alt={`${paper.paper_key}-${image.label}`}
                                className="w-full h-28 object-cover rounded"
                                loading="lazy"
                              />
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-[10px] text-bp-text-secondary">No three-panel images linked in this paper window.</p>
                    )}
                  </div>
                )}

                <div
                  className="mt-2 prose prose-invert prose-sm max-w-none rounded p-3 overflow-y-auto [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-xs [&_p]:text-[11px] [&_li]:text-[11px] bg-bp-bg border border-bp-border text-bp-text"
                >
                  <ReactMarkdown>{paper.markdown}</ReactMarkdown>
                </div>

                {/* Citations section */}
                {paper.citations.length > 0 && (
                  <CitationSection citations={paper.citations} />
                )}
              </article>
            ))}

            {reportDetail && (
              <article className="rounded px-2 py-2 border border-bp-primary bg-bp-surface">
                <h3 className="text-xs font-semibold text-bp-primary">Persisted Report Citation Inspector</h3>
                <p className="text-[10px] mt-1 text-bp-text">
                  report {String(reportDetail.id ?? '')} • type {String(reportDetail.report_type ?? '')}
                </p>
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {Array.isArray(reportDetail.citations) && reportDetail.citations.length > 0 ? (
                    reportDetail.citations.map((item) => {
                      const citation = item as Record<string, unknown>;
                      return (
                        <p key={String(citation.id)} className="text-[11px] break-all text-bp-text">
                          [{String(citation.citation_order)}] {String(citation.source_name ?? citation.source_id ?? '')} {String(citation.source_url ?? '')}
                        </p>
                      );
                    })
                  ) : (
                    <p className="text-[11px] text-bp-text">No citations persisted for this report.</p>
                  )}
                </div>
              </article>
            )}
          </>
        )}
      </div>
    </section>
  );
}
