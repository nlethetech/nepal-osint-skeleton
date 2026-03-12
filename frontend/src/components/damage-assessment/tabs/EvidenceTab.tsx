/**
 * EvidenceTab - Multi-source evidence with provenance tracking
 *
 * Features:
 * - Evidence source cards (satellite, news, social media, government)
 * - Confidence scoring and verification status
 * - Auto-link OSINT stories to damage zones
 * - Filter by source type and verification status
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Satellite,
  Newspaper,
  Twitter,
  Building2,
  FileText,
  Image,
  Video,
  Link2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react';
import { Button, HTMLSelect, Intent, Spinner, Tag } from '@blueprintjs/core';
import { getAssessmentEvidence, linkStories, type Evidence } from '../../../api/damageAssessment';

interface EvidenceTabProps {
  assessmentId: string;
}

type SourceType = 'all' | 'satellite' | 'story' | 'social_media' | 'government';
type VerificationStatus = 'all' | 'verified' | 'unverified' | 'disputed';

const SOURCE_ICONS: Record<string, LucideIcon> = {
  satellite: Satellite,
  story: Newspaper,
  social_media: Twitter,
  government: Building2,
};

const SOURCE_LABELS: Record<string, string> = {
  satellite: 'Satellite Analysis',
  story: 'News Story',
  social_media: 'Social Media',
  government: 'Government Report',
};

const EVIDENCE_TYPE_ICONS: Record<string, LucideIcon> = {
  image: Image,
  video: Video,
  text: FileText,
  report: FileText,
};

const VERIFICATION_STATUS_CONFIG: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  verified: { label: 'Verified', color: 'text-bp-success', icon: CheckCircle2 },
  unverified: { label: 'Unverified', color: 'text-severity-medium', icon: Clock },
  disputed: { label: 'Disputed', color: 'text-severity-critical', icon: AlertCircle },
};

export function EvidenceTab({ assessmentId }: EvidenceTabProps) {
  const queryClient = useQueryClient();
  const [sourceFilter, setSourceFilter] = useState<SourceType>('all');
  const [verificationFilter, setVerificationFilter] = useState<VerificationStatus>('all');
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Fetch evidence
  const { data: evidenceData, isLoading } = useQuery({
    queryKey: ['damage-assessment-evidence', assessmentId],
    queryFn: () => getAssessmentEvidence(assessmentId),
    enabled: !!assessmentId,
  });

  // Link stories mutation
  const linkMutation = useMutation({
    mutationFn: () => linkStories(assessmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-assessment-evidence', assessmentId] });
    },
  });

  const evidence = evidenceData || [];
  const isLinking = linkMutation.isPending;

  // Filter evidence
  const filteredEvidence = evidence.filter((e) => {
    if (sourceFilter !== 'all' && e.source_type !== sourceFilter) return false;
    if (verificationFilter !== 'all' && e.verification_status !== verificationFilter) return false;
    return true;
  });

  // Group by source type for summary
  const evidenceBySouce = evidence.reduce((acc, e) => {
    acc[e.source_type] = (acc[e.source_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const toggleExpanded = (id: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLinkStories = () => {
    linkMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner size={30} />
      </div>
    );
  }

  if (evidence.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-bp-text-muted">
        <div className="p-8 max-w-md text-center bg-bp-card border border-bp-border rounded-xl">
          <Link2 size={48} className="mx-auto mb-4 text-bp-primary/50" />
          <h3 className="text-lg font-medium mb-2 text-bp-text">No Evidence Linked</h3>
          <p className="text-sm mb-6 text-bp-text-muted">
            Link OSINT stories and other evidence sources to this assessment to establish
            provenance and corroborate satellite-detected damage with ground truth.
          </p>
          <Button
            intent={Intent.PRIMARY}
            fill
            loading={isLinking}
            icon={isLinking ? undefined : <Link2 size={16} />}
            text={isLinking ? 'Linking Stories...' : 'Auto-Link OSINT Stories'}
            onClick={handleLinkStories}
            style={{ fontSize: 13 }}
          />
          <p className="text-xs mt-3 text-bp-text-muted">
            Stories are matched by geographic proximity, temporal overlap, and damage keywords
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with filters */}
      <div className="p-4 bg-bp-card border-b border-bp-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-medium text-bp-text">Evidence Sources</h3>
            <p className="text-sm text-bp-text-muted">{evidence.length} sources linked to this assessment</p>
          </div>
          <Button
            minimal
            icon={isLinking ? <Spinner size={14} /> : <Link2 size={14} />}
            text="Auto-Link More"
            disabled={isLinking}
            onClick={handleLinkStories}
            className="text-bp-text-muted text-xs"
          />
        </div>

        {/* Source Summary */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {Object.entries(SOURCE_LABELS).map(([key, label]) => {
            const Icon = SOURCE_ICONS[key];
            const count = evidenceBySouce[key] || 0;
            return (
              <button
                key={key}
                onClick={() => setSourceFilter(sourceFilter === key ? 'all' : key as SourceType)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  sourceFilter === key
                    ? 'bg-bp-primary/20 border border-bp-primary/30 text-bp-primary'
                    : 'bg-bp-surface text-bp-text-muted'
                }`}
              >
                <Icon size={16} />
                <span className="text-sm">{count}</span>
                <span className="text-xs hidden sm:inline text-bp-text-muted">{label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-bp-text-muted" />
            <span className="text-xs text-bp-text-muted">Filter:</span>
          </div>
          <HTMLSelect
            minimal
            value={verificationFilter}
            onChange={(e) => setVerificationFilter(e.target.value as VerificationStatus)}
            options={[
              { value: 'all', label: 'All Status' },
              { value: 'verified', label: 'Verified Only' },
              { value: 'unverified', label: 'Unverified' },
              { value: 'disputed', label: 'Disputed' },
            ]}
            className="bg-bp-surface text-bp-text-muted text-xs"
          />
        </div>
      </div>

      {/* Evidence Cards */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredEvidence.map((item) => (
            <EvidenceCard
              key={item.id}
              evidence={item}
              isExpanded={expandedCards.has(item.id)}
              onToggle={() => toggleExpanded(item.id)}
            />
          ))}
        </div>

        {filteredEvidence.length === 0 && (
          <div className="flex items-center justify-center h-full text-bp-text-muted">
            <p>No evidence matches the current filters</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface EvidenceCardProps {
  evidence: Evidence;
  isExpanded: boolean;
  onToggle: () => void;
}

function EvidenceCard({ evidence, isExpanded, onToggle }: EvidenceCardProps) {
  const SourceIcon = SOURCE_ICONS[evidence.source_type] || FileText;
  const TypeIcon = EVIDENCE_TYPE_ICONS[evidence.evidence_type] || FileText;
  const statusConfig = VERIFICATION_STATUS_CONFIG[evidence.verification_status] || VERIFICATION_STATUS_CONFIG.unverified;
  const StatusIcon = statusConfig.icon;

  const confidenceColor =
    evidence.confidence >= 0.8
      ? 'text-bp-success'
      : evidence.confidence >= 0.6
      ? 'text-severity-medium'
      : 'text-severity-critical';

  return (
    <div className="rounded-lg overflow-hidden bg-bp-card border border-bp-border">
      {/* Card Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-bp-surface">
              <SourceIcon size={20} className="text-bp-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-bp-text">
                {SOURCE_LABELS[evidence.source_type] || evidence.source_type}
              </p>
              <p className="text-xs text-bp-text-muted">
                {evidence.timestamp
                  ? new Date(evidence.timestamp).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Unknown date'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 text-xs ${statusConfig.color}`}>
              <StatusIcon size={12} />
              {statusConfig.label}
            </span>
          </div>
        </div>

        {/* Evidence Type & Confidence */}
        <div className="flex items-center gap-4 mb-3">
          <div className="flex items-center gap-1.5 text-xs text-bp-text-muted">
            <TypeIcon size={12} />
            <span className="capitalize">{evidence.evidence_type}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-bp-text-muted">Confidence:</span>
            <span className={`text-xs font-medium ${confidenceColor}`}>
              {(evidence.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>

        {/* Excerpt */}
        {evidence.excerpt && (
          <p className={`text-sm text-bp-text-muted ${!isExpanded ? 'line-clamp-2' : ''}`}>
            "{evidence.excerpt}"
          </p>
        )}
      </div>

      {/* Expandable Details */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-3 border-t border-bp-border">
          <div className="space-y-2 text-xs">
            {evidence.source_id && (
              <div className="flex justify-between">
                <span className="text-bp-text-muted">Source ID:</span>
                <span className="font-mono text-bp-text">{evidence.source_id}</span>
              </div>
            )}
            {evidence.zone_id && (
              <div className="flex justify-between">
                <span className="text-bp-text-muted">Linked Zone:</span>
                <span className="font-mono text-bp-text">{evidence.zone_id.slice(0, 8)}...</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-bp-text-muted">Added:</span>
              <span className="text-bp-text">
                {evidence.added_at ? new Date(evidence.added_at).toLocaleDateString() : new Date(evidence.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Card Footer */}
      <div className="flex items-center justify-between px-4 py-2 bg-bp-bg border-t border-bp-border">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs transition-colors text-bp-text-muted hover:text-bp-text-secondary"
        >
          {isExpanded ? (
            <>
              <ChevronUp size={14} />
              Less
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              More
            </>
          )}
        </button>
        {evidence.source_url && (
          <a
            href={evidence.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-bp-primary hover:text-bp-primary-hover transition-colors"
          >
            <ExternalLink size={12} />
            View Source
          </a>
        )}
      </div>
    </div>
  );
}
