/**
 * Command Palette (K to open)
 * Search widgets, presets, and actions from a single overlay.
 */
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { Search, Layout, ToggleRight, Keyboard } from 'lucide-react';
import { useDashboardStore, PRESETS, WIDGET_META } from '../../stores/dashboardStore';

interface PaletteItem {
  id: string;
  label: string;
  description: string;
  type: 'preset' | 'widget' | 'shortcut';
  action: () => void;
}

export const CommandPalette = memo(function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { applyPreset, activePreset, toggleWidgetVisibility, widgetVisibility } = useDashboardStore();

  // Build searchable items
  const allItems: PaletteItem[] = [];

  // Presets
  const CONSUMER_PRESETS = ['news', 'elections', 'parliament'] as const;
  for (const pid of CONSUMER_PRESETS) {
    const p = PRESETS[pid];
    if (!p) continue;
    allItems.push({
      id: `preset:${pid}`,
      label: p.name,
      description: `Switch to ${p.name}`,
      type: 'preset',
      action: () => { applyPreset(pid); setOpen(false); },
    });
  }

  // Widgets
  for (const [wid, meta] of Object.entries(WIDGET_META)) {
    const name = meta.consumerName || meta.name;
    const isVisible = widgetVisibility[wid];
    allItems.push({
      id: `widget:${wid}`,
      label: name,
      description: isVisible ? `Hide ${name}` : `Show ${name}`,
      type: 'widget',
      action: () => { toggleWidgetVisibility(wid); setOpen(false); },
    });
  }

  // Shortcuts
  allItems.push({
    id: 'shortcut:help',
    label: 'Keyboard Shortcuts',
    description: 'N = News, E = Elections, K = Search',
    type: 'shortcut',
    action: () => setOpen(false),
  });

  // Filter
  const q = query.toLowerCase().trim();
  const filtered = q
    ? allItems.filter(item =>
        item.label.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      )
    : allItems;

  // Clamp selection
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Open/close handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key.toLowerCase() === 'k' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setOpen(prev => !prev);
        setQuery('');
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard nav inside palette
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      filtered[selectedIndex].action();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }, [filtered, selectedIndex]);

  if (!open) return null;

  const typeIcon = (type: string) => {
    if (type === 'preset') return <Layout size={14} className="text-blue-400 shrink-0" />;
    if (type === 'widget') return <ToggleRight size={14} className="text-emerald-400 shrink-0" />;
    return <Keyboard size={14} className="text-white/30 shrink-0" />;
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-lg mx-4 bg-[#1a1a22] border border-white/10 rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
          <Search size={16} className="text-white/30 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search presets, widgets, actions..."
            className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
          />
          <kbd className="text-[10px] text-white/20 bg-white/[0.06] px-1.5 py-0.5 rounded border border-white/[0.08] font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-white/30">No results</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              onClick={item.action}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === selectedIndex ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
              }`}
            >
              {typeIcon(item.type)}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{item.label}</div>
                <div className="text-[11px] text-white/30 truncate">{item.description}</div>
              </div>
              {item.type === 'preset' && activePreset === item.id.replace('preset:', '') && (
                <span className="text-[9px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-medium">
                  ACTIVE
                </span>
              )}
              {item.type === 'widget' && widgetVisibility[item.id.replace('widget:', '')] && (
                <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-medium">
                  ON
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-white/[0.06] flex items-center gap-4 text-[10px] text-white/20">
          <span><kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">↵</kbd> select</span>
          <span><kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">N</kbd> News <kbd className="font-mono bg-white/[0.06] px-1 py-0.5 rounded">E</kbd> Elections</span>
        </div>
      </div>
    </div>
  );
});
