import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, Github, Bell, User } from 'lucide-react';
import { AlertTicker } from './AlertTicker';
import { FeedbackPanel } from './FeedbackPanel';
import { CommandPalette } from './CommandPalette';
import { AnalystModeContext, WIDGET_COMPONENTS } from './Dashboard';
import { PRESETS, useDashboardStore } from '../../stores/dashboardStore';
import {
  BriefContextWidget,
  BriefDataProvider,
  BriefFindingsWidget,
  BriefProvinceWidget,
  BriefSnapshotWidget,
  BriefStatusWidget,
  BriefSummaryWidget,
} from './widgets/BriefSplitWidgets';
import '../../styles/dashboard.css';
import '../../styles/professional-dashboard.css';
import '../../styles/ui-test-dashboard.css';

const PRESET_TABS = [
  { id: 'news', label: 'News' },
  { id: 'parliament', label: 'Accountability' },
  { id: 'elections', label: 'Elections' },
] as const;

type DashboardSnapshot = Pick<
  ReturnType<typeof useDashboardStore.getState>,
  'widgetOrder' | 'widgetVisibility' | 'widgetSizes' | 'activePreset' | 'customizePanelOpen' | 'theme'
>;

const ALL_UITEST_BRIEF_WIDGETS = [
  'brief-summary-card',
  'brief-findings-card',
  'brief-status-card',
  'brief-snapshot-card',
  'brief-context-card',
  'brief-provinces-card',
] as const;

const UITEST_BRIEF_WIDGETS = [
  'brief-findings-card',
  'brief-context-card',
] as const;

const UITEST_WIDGET_COMPONENTS = {
  ...WIDGET_COMPONENTS,
  'brief-summary-card': BriefSummaryWidget,
  'brief-findings-card': BriefFindingsWidget,
  'brief-status-card': BriefStatusWidget,
  'brief-snapshot-card': BriefSnapshotWidget,
  'brief-context-card': BriefContextWidget,
  'brief-provinces-card': BriefProvinceWidget,
} as const;

function applyUITestLayout(presetId: string) {
  const basePreset = PRESETS[presetId] ?? PRESETS.news;

  if (presetId !== 'news') {
    useDashboardStore.setState((state) => ({
      widgetOrder: [...basePreset.order],
      widgetVisibility: {
        ...basePreset.visibility,
        ...Object.fromEntries(ALL_UITEST_BRIEF_WIDGETS.map((id) => [id, false])),
      },
      widgetSizes: { ...basePreset.sizes },
      activePreset: presetId,
      customizePanelOpen: false,
      theme: state.theme,
    }));
    return;
  }

  const splitOrder = [
    'map',
    'kpi',
    'brief-findings-card',
    'brief-context-card',
    'newsfeed',
    'developing-stories',
    'fact-check',
    'stories',
    'social',
    'narrative-tracker',
    'province-monitor',
  ];

  useDashboardStore.setState((state) => ({
    widgetOrder: splitOrder,
    widgetVisibility: {
      ...basePreset.visibility,
      'situation-brief': false,
      'brief-findings-card': true,
      'brief-context-card': true,
      'brief-summary-card': false,
      'brief-status-card': false,
      'brief-snapshot-card': false,
      'brief-provinces-card': false,
    },
    widgetSizes: {
      ...basePreset.sizes,
      'brief-findings-card': 'large',
      'brief-context-card': 'small',
    },
    activePreset: presetId,
    customizePanelOpen: false,
    theme: state.theme,
  }));
}

function Clock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hh = time.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const date = time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();

  return (
    <div className="uitest-clock">
      <span className="uitest-clock-date">{date}</span>
      <span>{hh}</span>
    </div>
  );
}

export function UITestDashboard() {
  const { widgetOrder, widgetVisibility } = useDashboardStore();
  const [selectedStories, setSelectedStories] = useState<Set<string>>(new Set());
  const [feedbackPanelStory, setFeedbackPanelStory] = useState<any>(null);
  const [selectedTab, setSelectedTab] = useState<(typeof PRESET_TABS)[number]['id']>('news');
  const [layoutReady, setLayoutReady] = useState(false);
  const snapshotRef = useRef<DashboardSnapshot | null>(null);

  useEffect(() => {
    const setup = () => {
      const current = useDashboardStore.getState();
      if (!snapshotRef.current) {
        snapshotRef.current = {
          widgetOrder: [...current.widgetOrder],
          widgetVisibility: { ...current.widgetVisibility },
          widgetSizes: { ...current.widgetSizes },
          activePreset: current.activePreset,
          customizePanelOpen: current.customizePanelOpen,
          theme: current.theme,
        };
      }

      useDashboardStore.setState({ customizePanelOpen: false });
      setSelectedTab('news');
      applyUITestLayout('news');
      setLayoutReady(true);
    };

    const persistApi = (useDashboardStore as typeof useDashboardStore & {
      persist?: {
        hasHydrated?: () => boolean;
        onFinishHydration?: (listener: () => void) => () => void;
      };
    }).persist;

    let unsubscribeHydration: (() => void) | undefined;
    if (persistApi?.hasHydrated?.()) {
      setup();
    } else if (persistApi?.onFinishHydration) {
      unsubscribeHydration = persistApi.onFinishHydration(setup);
    } else {
      setup();
    }

    return () => {
      unsubscribeHydration?.();
      const snapshot = snapshotRef.current;
      if (!snapshot) return;
      useDashboardStore.setState({
        widgetOrder: [...snapshot.widgetOrder],
        widgetVisibility: { ...snapshot.widgetVisibility },
        widgetSizes: { ...snapshot.widgetSizes },
        activePreset: snapshot.activePreset,
        customizePanelOpen: snapshot.customizePanelOpen,
        theme: snapshot.theme,
      });
    };
  }, []);

  const visibleWidgets = widgetOrder.filter((id) => widgetVisibility[id]);
  const toggleStorySelection = (id: string) => {
    setSelectedStories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const analystModeValue = useMemo(() => ({
    feedbackMode: false,
    selectedStories,
    toggleStorySelection,
    openFeedbackPanel: (story: any) => setFeedbackPanelStory(story),
  }), [selectedStories]);

  if (!layoutReady) {
    return null;
  }

  return (
    <AnalystModeContext.Provider value={analystModeValue}>
      <div className="dashboard-app uitest-shell" data-active-preset={selectedTab}>
        <header className="uitest-navbar">
          <div className="uitest-navbar-brand">
            <div className="uitest-brand-copy">
              <span className="uitest-brand-title">NepalOSINT</span>
            </div>
          </div>

          <nav className="uitest-nav">
            {PRESET_TABS.map((tab) => {
              const isActive = selectedTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`uitest-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedTab(tab.id);
                    applyUITestLayout(tab.id);
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="uitest-search">
            <Search size={14} className="uitest-search-icon" />
            <input
              className="uitest-search-input"
              placeholder="Search widgets, stories, entities..."
              onFocus={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }))}
              readOnly
            />
          </div>

          <div className="uitest-navbar-actions">
            <Clock />
            <button
              type="button"
              className="uitest-icon-btn"
              title="Refresh route"
              onClick={() => window.location.reload()}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              className="uitest-icon-btn"
              title="Notifications"
            >
              <Bell size={14} />
            </button>
            <button
              type="button"
              className="uitest-icon-btn"
              title="Account"
            >
              <User size={14} />
            </button>
            <a
              className="uitest-icon-btn"
              title="GitHub repository"
              href="https://github.com/nlethetech/nepal-osint-skeleton"
              target="_blank"
              rel="noreferrer"
            >
              <Github size={14} />
            </a>
          </div>
        </header>

        <AlertTicker />

        <main className="dashboard-main uitest-main">
          <div className="widget-grid">
            <BriefDataProvider>
              <Suspense fallback={null}>
                {visibleWidgets.map((widgetId) => {
                  const WidgetComponent = UITEST_WIDGET_COMPONENTS[widgetId as keyof typeof UITEST_WIDGET_COMPONENTS];
                  if (!WidgetComponent) return null;
                  return <WidgetComponent key={widgetId} />;
                })}
              </Suspense>
            </BriefDataProvider>
          </div>
        </main>

        <CommandPalette />

        {feedbackPanelStory && (
          <FeedbackPanel
            story={feedbackPanelStory}
            onClose={() => setFeedbackPanelStory(null)}
            onSubmit={() => {}}
          />
        )}
      </div>
    </AnalystModeContext.Provider>
  );
}
