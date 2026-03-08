/**
 * StoriesWidget - Historical stories feed with filtering.
 *
 * History-only view with filters for category, date range, source(s),
 * and multi-source corroboration.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ExternalLink, Link2, X } from 'lucide-react';
import { Widget } from '../Widget';
import {
  getStories,
  getRelatedStories,
  getStorySources,
  type RelatedStoryItem,
  type StorySourceOption,
} from '../../../api/stories';
import { WidgetSkeleton, WidgetError, WidgetEmpty, formatTimeAgo } from './shared';
import type { Story } from '../../../types/api';

type StoryCategoryFilter = 'all' | 'economic' | 'political' | 'security' | 'social';

type HistoricalStory = Story & {
  category?: string | null;
  severity?: string | null;
  source_name?: string | null;
};

function toIsoStartOfDay(dateValue?: string): string | undefined {
  if (!dateValue) return undefined;
  return `${dateValue}T00:00:00Z`;
}

function toIsoEndOfDay(dateValue?: string): string | undefined {
  if (!dateValue) return undefined;
  return `${dateValue}T23:59:59Z`;
}

export const StoriesWidget = memo(function StoriesWidget() {
  const [historicalCategory, setHistoricalCategory] = useState<StoryCategoryFilter>('all');
  const [historicalPage, setHistoricalPage] = useState(1);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [multiSourceOnly, setMultiSourceOnly] = useState(false);

  const [expandedRelatedStoryId, setExpandedRelatedStoryId] = useState<string | null>(null);
  const [relatedStoriesById, setRelatedStoriesById] = useState<Record<string, RelatedStoryItem[]>>({});
  const [relatedLoadingId, setRelatedLoadingId] = useState<string | null>(null);

  const isDateRangeInvalid = !!fromDate && !!toDate && fromDate > toDate;
  const normalizedFromDate = toIsoStartOfDay(fromDate || undefined);
  const normalizedToDate = toIsoEndOfDay(toDate || undefined);

  useEffect(() => {
    setHistoricalPage(1);
  }, [historicalCategory, fromDate, toDate, selectedSourceIds, multiSourceOnly]);

  const historicalQuery = useQuery({
    queryKey: [
      'stories',
      'historical',
      historicalPage,
      historicalCategory,
      normalizedFromDate,
      normalizedToDate,
      selectedSourceIds.join(','),
      multiSourceOnly,
    ],
    queryFn: () =>
      getStories({
        page: historicalPage,
        pageSize: 12,
        category: historicalCategory === 'all' ? undefined : historicalCategory,
        fromDate: normalizedFromDate,
        toDate: normalizedToDate,
        sourceIds: selectedSourceIds.length ? selectedSourceIds : undefined,
        nepalOnly: true,
        multiSourceOnly,
      }),
    enabled: !isDateRangeInvalid,
    staleTime: 60 * 1000,
  });

  const sourcesQuery = useQuery({
    queryKey: [
      'stories',
      'historical',
      'sources',
      historicalCategory,
      normalizedFromDate,
      normalizedToDate,
      multiSourceOnly,
    ],
    queryFn: () =>
      getStorySources({
        category: historicalCategory === 'all' ? undefined : historicalCategory,
        fromDate: normalizedFromDate,
        toDate: normalizedToDate,
        nepalOnly: true,
        multiSourceOnly,
        limit: 300,
      }),
    staleTime: 5 * 60 * 1000,
  });

  const historicalStories = (historicalQuery.data?.items || []) as HistoricalStory[];
  const historicalTotal = historicalQuery.data?.total || 0;
  const historicalPageSize = historicalQuery.data?.page_size || 12;
  const historicalTotalPages = Math.max(1, Math.ceil(historicalTotal / historicalPageSize));

  const sourceOptions = sourcesQuery.data || [];

  const selectedSources = useMemo(() => {
    const sourceMap = new Map(sourceOptions.map((item) => [item.source_id, item]));
    return selectedSourceIds.map((sourceId) => {
      const option = sourceMap.get(sourceId);
      return option || ({ source_id: sourceId, source_name: sourceId, story_count: 0 } as StorySourceOption);
    });
  }, [selectedSourceIds, sourceOptions]);

  const availableSources = useMemo(
    () => sourceOptions.filter((item) => !selectedSourceIds.includes(item.source_id)),
    [sourceOptions, selectedSourceIds],
  );

  const getSeverityBadge = (severity?: string) => {
    const badges: Record<string, { text: string; className: string }> = {
      critical: { text: 'CRIT', className: 'critical' },
      high: { text: 'HIGH', className: 'high' },
      medium: { text: 'MED', className: 'medium' },
      low: { text: 'LOW', className: 'low' },
    };
    return badges[severity || 'low'] || badges.low;
  };

  const getCategoryClass = (category?: string) => {
    const classes: Record<string, string> = {
      political: 'tag-political',
      economic: 'tag-economic',
      security: 'tag-security',
      disaster: 'tag-disaster',
      social: 'tag-social',
    };
    return classes[category || ''] || '';
  };

  const handleAddSource = (sourceId: string) => {
    if (!sourceId || selectedSourceIds.includes(sourceId)) return;
    setSelectedSourceIds((prev) => [...prev, sourceId]);
  };

  const handleRemoveSource = (sourceId: string) => {
    setSelectedSourceIds((prev) => prev.filter((id) => id !== sourceId));
  };

  const clearFilters = () => {
    setHistoricalCategory('all');
    setFromDate('');
    setToDate('');
    setSelectedSourceIds([]);
    setMultiSourceOnly(false);
  };

  const handleRelatedToggle = async (storyId: string) => {
    if (expandedRelatedStoryId === storyId) {
      setExpandedRelatedStoryId(null);
      return;
    }

    if (relatedStoriesById[storyId]) {
      setExpandedRelatedStoryId(storyId);
      return;
    }

    try {
      setRelatedLoadingId(storyId);
      const payload = await getRelatedStories(storyId, {
        topK: 6,
        minSimilarity: 0.55,
        hours: 24 * 365 * 5,
      });
      setRelatedStoriesById((prev) => ({
        ...prev,
        [storyId]: payload.similar_stories || [],
      }));
      setExpandedRelatedStoryId(storyId);
    } catch {
      setRelatedStoriesById((prev) => ({
        ...prev,
        [storyId]: [],
      }));
      setExpandedRelatedStoryId(storyId);
    } finally {
      setRelatedLoadingId(null);
    }
  };

  if (historicalQuery.isLoading) {
    return (
      <Widget id="stories" icon={<BookOpen size={14} />}>
        <WidgetSkeleton />
      </Widget>
    );
  }

  if (isDateRangeInvalid) {
    return (
      <Widget id="stories" icon={<BookOpen size={14} />} badge={historicalTotal} actions={<span className="widget-action active">History</span>}>
        <WidgetError message="Invalid date range: From date is after To date" />
      </Widget>
    );
  }

  if (historicalQuery.error) {
    return (
      <Widget id="stories" icon={<BookOpen size={14} />} badge={historicalTotal} actions={<span className="widget-action active">History</span>}>
        <WidgetError message="Failed to load stories" onRetry={() => historicalQuery.refetch()} />
      </Widget>
    );
  }

  return (
    <Widget
      id="stories"
      icon={<BookOpen size={14} />}
      badge={historicalTotal}
      actions={<span className="widget-action active">History</span>}
    >
      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto' }}>
        {(['all', 'economic', 'political', 'security', 'social'] as StoryCategoryFilter[]).map((item) => (
          <button
            key={item}
            className={`widget-action ${historicalCategory === item ? 'active' : ''}`}
            onClick={() => setHistoricalCategory(item)}
            style={{ fontSize: '10px', textTransform: 'capitalize', whiteSpace: 'nowrap' }}
          >
            {item}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)' }}>
          From
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              borderRadius: 4,
              fontSize: 10,
              padding: '3px 6px',
            }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-muted)' }}>
          To
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              borderRadius: 4,
              fontSize: 10,
              padding: '3px 6px',
            }}
          />
        </label>

        <button
          type="button"
          className={`widget-action ${multiSourceOnly ? 'active' : ''}`}
          onClick={() => setMultiSourceOnly((prev) => !prev)}
          style={{ fontSize: 10 }}
        >
          Multi-Source Only
        </button>

        <button
          type="button"
          className="widget-action"
          onClick={clearFilters}
          style={{ fontSize: 10 }}
        >
          Clear
        </button>
      </div>

      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            onChange={(event) => {
              handleAddSource(event.target.value);
              event.currentTarget.value = '';
            }}
            defaultValue=""
            style={{
              flex: 1,
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              borderRadius: 4,
              fontSize: 10,
              padding: '4px 6px',
            }}
          >
            <option value="">+ Add source filter</option>
            {availableSources.map((source) => (
              <option key={source.source_id} value={source.source_id}>
                {source.source_name} ({source.story_count})
              </option>
            ))}
          </select>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {sourcesQuery.isLoading ? 'Loading sources...' : `${sourceOptions.length} sources`}
          </span>
        </div>

        {selectedSources.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {selectedSources.map((source) => (
              <span
                key={source.source_id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 999,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--bg-elevated)',
                }}
              >
                {source.source_name}
                <button
                  type="button"
                  onClick={() => handleRemoveSource(source.source_id)}
                  style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center' }}
                  title={`Remove ${source.source_name}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {!historicalStories.length ? (
        <WidgetEmpty message="No historical stories for selected filters" />
      ) : (
        <div className="feed-list" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {historicalStories.map((story) => {
            const storyCategory = (story.category || 'general').toLowerCase();
            const storySeverity = (story.severity || 'low').toLowerCase();
            const badge = getSeverityBadge(storySeverity);
            const relatedItems = relatedStoriesById[story.id] || [];
            const showRelated = expandedRelatedStoryId === story.id;

            return (
              <div key={story.id} className="feed-item cluster-item">
                <div className={`feed-indicator ${badge.className}`} />
                <div className="feed-content">
                  <div className="feed-meta">
                    <span className={`feed-badge ${badge.className}`}>{badge.text}</span>
                    <span className={`feed-tag ${getCategoryClass(storyCategory)}`}>{storyCategory}</span>
                    {story.source_name && <span className="source-count-badge">{story.source_name}</span>}
                    {multiSourceOnly && <span className="source-count-badge">Multi-source</span>}
                  </div>

                  <a
                    href={story.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="feed-title feed-title-link text-left w-full hover:text-blue-400 transition-colors group"
                  >
                    <span className="group-hover:underline">{story.title}</span>
                    <ExternalLink size={12} className="inline-block ml-2 opacity-0 group-hover:opacity-100 text-blue-400 transition-opacity" />
                  </a>

                  <div className="feed-time" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{formatTimeAgo(story.published_at || story.created_at)}</span>
                    <button
                      className="expand-btn"
                      onClick={() => handleRelatedToggle(story.id)}
                      title="Find related stories using E5 embeddings"
                    >
                      <Link2 size={14} style={{ marginRight: 4 }} />
                      Related
                    </button>
                  </div>

                  {showRelated && (
                    <div className="cluster-stories">
                      {relatedLoadingId === story.id ? (
                        <div className="cluster-story-link">
                          <span className="cluster-story-title">Finding related stories...</span>
                        </div>
                      ) : relatedItems.length > 0 ? (
                        relatedItems.map((related) => (
                          <a
                            key={related.story_id}
                            href={related.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cluster-story-link"
                          >
                            <span className="cluster-story-source">
                              {related.source_name || related.source_id || 'Source'}
                            </span>
                            <span className="cluster-story-title">{related.title}</span>
                            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginRight: 6 }}>
                              {(related.similarity * 100).toFixed(0)}%
                            </span>
                            <ExternalLink size={10} />
                          </a>
                        ))
                      ) : (
                        <div className="cluster-story-link">
                          <span className="cluster-story-title">No related stories found via E5</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: 11 }}>
        <span style={{ color: 'var(--text-muted)' }}>
          Page {historicalPage} / {historicalTotalPages}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            className="widget-action"
            onClick={() => setHistoricalPage((p) => Math.max(1, p - 1))}
            disabled={historicalPage <= 1}
          >
            Prev
          </button>
          <button
            className="widget-action"
            onClick={() => setHistoricalPage((p) => Math.min(historicalTotalPages, p + 1))}
            disabled={historicalPage >= historicalTotalPages}
          >
            Next
          </button>
        </div>
      </div>
    </Widget>
  );
});
