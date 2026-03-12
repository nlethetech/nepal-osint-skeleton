import { useState, useEffect, useMemo } from 'react';
import apiClient from '../../api/client';

interface TickerItem {
  id: string;
  type: 'critical' | 'high' | 'medium' | 'low';
  headline: string;
  category: string;
  timestamp: Date;
}

function formatTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0 || diff < 60_000) return 'NOW';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string }> = {
  critical: { color: '#EF4444', bg: '#EF4444' },
  high: { color: '#F59E0B', bg: '#F59E0B' },
  medium: { color: '#3B82F6', bg: '#3B82F6' },
  low: { color: '#6B7280', bg: '#6B7280' },
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'BREAKING',
  high: 'ALERT',
  medium: 'NEWS',
  low: 'UPDATE',
};

interface AlertTickerProps {
  onAlertClick?: (alert: TickerItem) => void;
}

export function AlertTicker({ onAlertClick }: AlertTickerProps) {
  const [items, setItems] = useState<TickerItem[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await apiClient.get('/stories/recent', {
          params: { hours: 24, limit: 30 },
        });

        const stories = (res.data || []) as Array<{
          id: string;
          title: string;
          severity: string;
          category: string;
          published_at: string | null;
          created_at: string;
        }>;

        // Show critical/high first, then medium — skip low to keep ticker punchy
        const filtered = stories
          .filter(s => s.severity === 'critical' || s.severity === 'high' || s.severity === 'medium')
          .slice(0, 20);

        const tickerItems: TickerItem[] = filtered.map(s => ({
          id: s.id,
          type: (s.severity as TickerItem['type']) || 'medium',
          headline: s.title,
          category: s.category || '',
          timestamp: new Date(s.published_at || s.created_at),
        }));

        if (tickerItems.length > 0) {
          setItems(tickerItems);
        }
      } catch {
        // Silently handle
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const tickerContent = useMemo(() => {
    if (items.length === 0) return [];
    const copies = items.length >= 12 ? 2 : 3;
    return Array.from({ length: copies }, () => items).flat();
  }, [items]);

  if (loading) {
    return (
      <div className="bloomberg-ticker">
        <div className="bloomberg-ticker-track" style={{ animation: 'none', justifyContent: 'center' }}>
          <span style={{ color: 'var(--pro-text-muted)', fontSize: '11px' }}>
            Loading news...
          </span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bloomberg-ticker">
        <div className="bloomberg-ticker-track" style={{ animation: 'none', justifyContent: 'center' }}>
          <span style={{ color: 'var(--pro-text-muted)', fontSize: '11px' }}>
            No recent alerts
          </span>
        </div>
      </div>
    );
  }

  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const animationDuration = Math.max(50, items.length * (isMobile ? 12 : 6));

  return (
    <div
      className="bloomberg-ticker"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div
        className="bloomberg-ticker-track"
        style={{
          animationPlayState: isPaused ? 'paused' : 'running',
          animationDuration: `${animationDuration}s`,
          willChange: 'transform',
        }}
      >
        {tickerContent.map((item, index) => {
          const style = SEVERITY_STYLES[item.type] || SEVERITY_STYLES.medium;
          const label = SEVERITY_LABELS[item.type] || 'NEWS';
          return (
            <div
              key={`${item.id}-${index}`}
              className="bloomberg-ticker-item"
              onClick={() => onAlertClick?.(item)}
            >
              <span
                className="ticker-severity"
                style={{ background: style.bg, borderRadius: 1 }}
              />
              <span
                className="ticker-category"
                style={{ color: style.color, fontWeight: 700 }}
              >
                {label}
              </span>
              <span className="ticker-headline">
                {item.headline}
              </span>
              <span className="ticker-time" style={{
                color: 'rgba(255,255,255,0.4)',
                fontSize: '10px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                marginLeft: '6px',
              }}>
                {formatTime(item.timestamp)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Keep export for backwards compat but return null (no election banner needed)
export function AlertTickerBanner() {
  return null;
}
