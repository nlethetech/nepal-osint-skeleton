import { memo, useMemo, useState } from 'react';
import {
  FileText,
  Paperclip,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
  Building2,
  ChevronRight,
  Clock,
  Star,
  MapPin,
  Search,
  X,
} from 'lucide-react';
import { Widget } from '../Widget';
import { useAnnouncementSummary, useToggleImportant } from '../../../api/hooks/useAnnouncements';
import { formatBsToAd } from '../../../lib/nepaliDate';
import { useSettingsStore } from '../../../store/slices/settingsSlice';
import type { Announcement } from '../../../types/announcement';

// Category colors
const CATEGORY_COLORS: Record<string, string> = {
  'press-release': '#5c7cba',
  'notice': '#b89830',
  'circular': '#408850',
  'press-release-ne': '#5c7cba',
  'notice-ne': '#b89830',
};

function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category] || '#64748b';
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return formatDate(dateString) || 'Unknown';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return formatDate(dateString);
  }
}

function getAnnouncementDisplayDate(announcement: Announcement): string | null {
  // Prefer the announcement's official publication date over ingestion timestamps.
  if (announcement.date_ad) {
    return formatDate(announcement.date_ad);
  }

  if (announcement.date_bs) {
    return formatBsToAd(announcement.date_bs);
  }

  if (announcement.published_at) {
    return getTimeAgo(announcement.published_at);
  }

  if (announcement.fetched_at) {
    return `Fetched ${formatDate(announcement.fetched_at)}`;
  }

  if (announcement.created_at) {
    return `Added ${formatDate(announcement.created_at)}`;
  }

  return null;
}

// Loading skeleton
function AnnouncementsSkeleton() {
  return (
    <div style={{ padding: '12px' }}>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            padding: '12px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div
            style={{
              width: '80%',
              height: '14px',
              background: 'var(--bg-tertiary)',
              borderRadius: '4px',
              marginBottom: '8px',
              animation: 'pulse 1.5s infinite',
            }}
          />
          <div
            style={{
              width: '50%',
              height: '10px',
              background: 'var(--bg-tertiary)',
              borderRadius: '4px',
              animation: 'pulse 1.5s infinite',
            }}
          />
        </div>
      ))}
    </div>
  );
}

// Error state
function AnnouncementsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      style={{
        padding: '24px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
      }}
    >
      <AlertTriangle size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
      <div style={{ fontSize: '12px', marginBottom: '12px' }}>
        Failed to load announcements
      </div>
      <button
        onClick={onRetry}
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          padding: '6px 12px',
          fontSize: '11px',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <RefreshCw size={12} />
        Retry
      </button>
    </div>
  );
}

// Single announcement item
function AnnouncementItem({
  announcement,
  onToggleImportant,
}: {
  announcement: Announcement;
  onToggleImportant: (id: string, isImportant: boolean) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    window.open(announcement.url, '_blank');
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        cursor: 'pointer',
        background: isHovered ? 'var(--bg-tertiary)' : 'transparent',
        transition: 'background 0.15s ease',
        position: 'relative',
      }}
    >
      {/* Title row */}
      <div
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '8px',
          marginBottom: '6px',
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 400,
              color: 'var(--text-primary)',
              lineHeight: '1.4',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {announcement.title}
          </div>
        </div>

        {/* Important star */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleImportant(announcement.id, !announcement.is_important);
          }}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '2px',
            opacity: announcement.is_important || isHovered ? 1 : 0,
            transition: 'opacity 0.15s ease',
          }}
        >
          <Star
            size={14}
            fill={announcement.is_important ? '#fbbf24' : 'none'}
            color={announcement.is_important ? '#fbbf24' : 'var(--text-muted)'}
          />
        </button>
      </div>

      {/* Meta row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '10px',
          color: 'var(--text-muted)',
        }}
      >
        {/* Category badge */}
        <span
          style={{
            padding: '2px 6px',
            borderRadius: '3px',
            background: `${getCategoryColor(announcement.category)}20`,
            color: getCategoryColor(announcement.category),
            fontWeight: 500,
            textTransform: 'capitalize',
          }}
        >
          {announcement.category.replace(/-ne$/, '').replace('-', ' ')}
        </span>

        {/* Source */}
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Building2 size={10} />
          {announcement.source_name}
        </span>

        {/* Display the official notice date first; only fall back to ingestion time when necessary */}
        {(() => {
          const displayDate = getAnnouncementDisplayDate(announcement);
          if (!displayDate) return null;
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <Clock size={10} />
              {displayDate}
            </span>
          );
        })()}

        {/* Attachments */}
        {announcement.has_attachments && announcement.attachments.length > 0 && (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              color: 'var(--accent-primary)',
            }}
          >
            <Paperclip size={10} />
            {announcement.attachments.length}
          </span>
        )}
      </div>

      {/* Attachment links */}
      {announcement.has_attachments && announcement.attachments.length > 0 && (
        <div
          style={{
            marginTop: '8px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '6px',
          }}
        >
          {announcement.attachments.slice(0, 3).map((att, idx) => (
            <a
              key={idx}
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 8px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                fontSize: '10px',
                color: 'var(--text-secondary)',
                textDecoration: 'none',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                e.currentTarget.style.color = 'var(--accent-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.color = 'var(--text-secondary)';
              }}
            >
              <FileText size={10} />
              {att.name.length > 20 ? att.name.slice(0, 20) + '...' : att.name}
              <ExternalLink size={8} />
            </a>
          ))}
          {announcement.attachments.length > 3 && (
            <span
              style={{
                fontSize: '10px',
                color: 'var(--text-muted)',
                alignSelf: 'center',
              }}
            >
              +{announcement.attachments.length - 3} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Time filter options (hours)
const TIME_FILTERS = [
  { label: '1D', hours: 24 },
  { label: '3D', hours: 72 },
  { label: '7D', hours: 168 },
  { label: 'All', hours: undefined },
];

type ReadFilter = 'all' | 'important';
type SortFilter = 'newest' | 'oldest';

function getAnnouncementTimestamp(announcement: Announcement): number {
  const dateValue =
    announcement.published_at ??
    announcement.date_ad ??
    announcement.fetched_at ??
    announcement.created_at;

  if (!dateValue) return 0;
  const timestamp = new Date(dateValue).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export const AnnouncementsWidget = memo(function AnnouncementsWidget() {
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<number | undefined>(168); // Default 7 days
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [sortFilter, setSortFilter] = useState<SortFilter>('newest');
  const [searchQuery, setSearchQuery] = useState('');

  // Get province filter from settings store
  const { selectedProvinces, isProvinceFilterEnabled, getFilterLabel } = useSettingsStore();

  // Only pass provinces to API when filter is enabled
  const provincesForApi = isProvinceFilterEnabled ? selectedProvinces : undefined;

  const { data, isLoading, isError, refetch } = useAnnouncementSummary(15, timeFilter, provincesForApi);
  const toggleImportantMutation = useToggleImportant();

  const handleToggleImportant = (id: string, isImportant: boolean) => {
    toggleImportantMutation.mutate({ id, isImportant });
  };

  const sourceEntries = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.by_source).sort(([, countA], [, countB]) => countB - countA);
  }, [data]);

  // Filter and sort announcements
  const filteredAnnouncements = useMemo(() => {
    if (!data) return [];

    let items = [...data.latest];

    if (activeFilter !== 'all') {
      items = items.filter((a) => a.category.startsWith(activeFilter));
    }

    if (sourceFilter !== 'all') {
      items = items.filter((a) => a.source === sourceFilter);
    }

    if (readFilter === 'important') {
      items = items.filter((a) => a.is_important);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      items = items.filter((a) =>
        [a.title, a.source_name, a.source, a.category]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(query))
      );
    }

    if (sortFilter === 'oldest') {
      items.sort((a, b) => getAnnouncementTimestamp(a) - getAnnouncementTimestamp(b));
    } else {
      items.sort((a, b) => getAnnouncementTimestamp(b) - getAnnouncementTimestamp(a));
    }

    return items;
  }, [activeFilter, data, readFilter, searchQuery, sortFilter, sourceFilter]);

  const hasAdvancedFilters =
    sourceFilter !== 'all' ||
    readFilter !== 'all' ||
    sortFilter !== 'newest' ||
    searchQuery.trim().length > 0;

  const resetAdvancedFilters = () => {
    setSourceFilter('all');
    setReadFilter('all');
    setSortFilter('newest');
    setSearchQuery('');
  };

  if (isLoading) {
    return (
      <Widget id="govt" icon={<Building2 size={14} />}>
        <AnnouncementsSkeleton />
      </Widget>
    );
  }

  if (isError || !data) {
    return (
      <Widget id="govt" icon={<Building2 size={14} />}>
        <AnnouncementsError onRetry={() => refetch()} />
      </Widget>
    );
  }

  return (
    <Widget id="govt" icon={<Building2 size={14} />}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }}
      >
        {/* Header with stats and filter */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          {/* Stats */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '18px',
                  fontWeight: 600,
                }}
              >
                {data.total}
              </span>
              <span
                style={{
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  marginLeft: '4px',
                }}
              >
                total
              </span>
            </div>
            {/* Time filter pills */}
            <div
              style={{
                display: 'flex',
                gap: '2px',
                background: 'var(--bg-tertiary)',
                borderRadius: '4px',
                padding: '2px',
                marginLeft: '4px',
              }}
            >
              {TIME_FILTERS.map((filter) => (
                <button
                  key={filter.label}
                  onClick={() => setTimeFilter(filter.hours)}
                  style={{
                    padding: '3px 6px',
                    fontSize: '9px',
                    fontWeight: 500,
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    background:
                      timeFilter === filter.hours ? 'var(--bg-secondary)' : 'transparent',
                    color:
                      timeFilter === filter.hours
                        ? 'var(--text-primary)'
                        : 'var(--text-muted)',
                    boxShadow:
                      timeFilter === filter.hours ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {/* Province filter indicator - show only when filter is active */}
            {isProvinceFilterEnabled && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '3px 8px',
                  background: 'rgba(64, 136, 80, 0.15)',
                  borderRadius: '4px',
                  marginLeft: '4px',
                }}
                title={`Filtered by: ${selectedProvinces.join(', ')}`}
              >
                <MapPin size={10} color="#408850" />
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 500,
                    color: '#408850',
                  }}
                >
                  {getFilterLabel()}
                </span>
              </div>
            )}
          </div>

          {/* Category filter pills */}
          <div
            style={{
              display: 'flex',
              gap: '4px',
              background: 'var(--bg-tertiary)',
              borderRadius: '6px',
              padding: '2px',
            }}
          >
            <button
              onClick={() => setActiveFilter('all')}
              style={{
                padding: '4px 10px',
                fontSize: '10px',
                fontWeight: 500,
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                background:
                  activeFilter === 'all' ? 'var(--bg-secondary)' : 'transparent',
                color:
                  activeFilter === 'all'
                    ? 'var(--text-primary)'
                    : 'var(--text-muted)',
                boxShadow:
                  activeFilter === 'all' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
              }}
            >
              All
            </button>
            {['press-release', 'notice', 'circular'].map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveFilter(cat)}
                style={{
                  padding: '4px 10px',
                  fontSize: '10px',
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  background:
                    activeFilter === cat ? 'var(--bg-secondary)' : 'transparent',
                  color:
                    activeFilter === cat
                      ? 'var(--text-primary)'
                      : 'var(--text-muted)',
                  boxShadow:
                    activeFilter === cat ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                  textTransform: 'capitalize',
                }}
              >
                {cat.replace('-', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Professional filter toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,0.01)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              flex: '1 1 220px',
              minWidth: '160px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 8px',
              border: '1px solid var(--border-subtle)',
              borderRadius: '5px',
              background: 'var(--bg-tertiary)',
            }}
          >
            <Search size={11} color="var(--text-muted)" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, source..."
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                width: '100%',
                color: 'var(--text-primary)',
                fontSize: '10px',
              }}
            />
          </div>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{
              minWidth: '140px',
              padding: '5px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: '10px',
            }}
          >
            <option value="all">All sources</option>
            {sourceEntries.map(([source, count]) => (
              <option key={source} value={source}>
                {source} ({count})
              </option>
            ))}
          </select>

          <select
            value={readFilter}
            onChange={(e) => setReadFilter(e.target.value as ReadFilter)}
            style={{
              minWidth: '95px',
              padding: '5px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: '10px',
            }}
          >
            <option value="all">All</option>
            <option value="important">Important</option>
          </select>

          <select
            value={sortFilter}
            onChange={(e) => setSortFilter(e.target.value as SortFilter)}
            style={{
              minWidth: '110px',
              padding: '5px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: '10px',
            }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>

          <button
            onClick={resetAdvancedFilters}
            disabled={!hasAdvancedFilters}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '5px 8px',
              borderRadius: '5px',
              border: '1px solid var(--border-subtle)',
              background: hasAdvancedFilters ? 'var(--bg-tertiary)' : 'transparent',
              color: hasAdvancedFilters ? 'var(--text-secondary)' : 'var(--text-muted)',
              fontSize: '10px',
              cursor: hasAdvancedFilters ? 'pointer' : 'default',
            }}
          >
            <X size={10} />
            Clear
          </button>
        </div>

        {/* Announcements list */}
        <div
          style={{
            flex: '1 1 0',
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {filteredAnnouncements.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: '12px',
              }}
            >
              No announcements found
            </div>
          ) : (
            filteredAnnouncements.map((announcement) => (
              <AnnouncementItem
                key={announcement.id}
                announcement={announcement}
                onToggleImportant={handleToggleImportant}
              />
            ))
          )}
        </div>

        {/* Footer with source breakdown */}
        <div
          style={{
            borderTop: '1px solid var(--border-subtle)',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '9px',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            <span>Sources</span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'nowrap',
              gap: '6px',
              overflowX: 'auto',
              overflowY: 'hidden',
              flex: 1,
              minWidth: 0,
              paddingBottom: '2px',
            }}
          >
            {sourceEntries.map(([source, count]) => {
              const isActive = sourceFilter === source;
              return (
                <button
                  key={source}
                  onClick={() => setSourceFilter(isActive ? 'all' : source)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    borderRadius: '999px',
                    border: `1px solid ${
                      isActive ? 'var(--accent-primary)' : 'var(--border-subtle)'
                    }`,
                    background: isActive ? 'rgba(92, 124, 186, 0.18)' : 'var(--bg-tertiary)',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '9px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  title={`${source}: ${count}`}
                >
                  <span
                    style={{
                      maxWidth: '130px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {source}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: isActive ? 'var(--accent-primary)' : 'var(--text-muted)',
                    }}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <a
            href="/announcements"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              color: 'var(--accent-primary)',
              textDecoration: 'none',
              fontSize: '10px',
              whiteSpace: 'nowrap',
            }}
          >
            View all <ChevronRight size={12} />
          </a>
        </div>
      </div>
    </Widget>
  );
});
