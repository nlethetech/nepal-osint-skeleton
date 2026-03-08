import { useEffect, useRef, useSyncExternalStore, lazy, Suspense } from 'react';
import { DashboardHeader } from './DashboardHeader';
import { AlertTicker } from './AlertTicker';
import { useDashboardStore, PRESETS } from '../../stores/dashboardStore';
import { useAuthStore, UserRole } from '../../store/slices/authSlice';
// Lazy load heavy widgets for faster initial paint
const LazyMapWidget = lazy(() => import('./widgets/MapWidget').then(m => ({ default: m.MapWidget })));
const LazyElectionsWidget = lazy(() => import('./widgets/ElectionsWidget').then(m => ({ default: m.ElectionsWidget })));

import {
  ElectionMapWidget,
  StoriesWidget,
  NewsFeedWidget,
  WeatherWidget,
  DisastersWidget,
  AnnouncementsWidget,
  // Election Monitor Widgets
  ElectionStatusWidget,
  SwingAnalysisWidget,
  CloseRacesWidget,
  IncumbencyWidget,
  CandidatesWidget,
  PartySwitchWidget,
  // Know Your Neta
  KnowYourNetaWidget,
  // Election Live Stream
  ElectionLiveWidget,
  ElectionPRWidget,
  ElectionSeatsWidget,
  // Situation Brief
  SituationBriefWidget,
  // Developing Stories
  DevelopingStoriesWidget,
  // Promise Tracker
  PromiseTrackerWidget,
  // Parliament Session
  ParliamentSessionWidget,
  // Government Decisions
  GovtDecisionsWidget,
  // River Monitoring
  RiverMonitoringWidget,
} from './widgets';
import { CustomizePanel } from './CustomizePanel';
import '../../styles/dashboard.css';
import '../../styles/professional-dashboard.css';

// Widget component map (public widgets only)
const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  map: LazyMapWidget,
  'election-map': ElectionMapWidget,
  stories: StoriesWidget,
  newsfeed: NewsFeedWidget,
  weather: WeatherWidget,
  disasters: DisastersWidget,
  elections: LazyElectionsWidget,
  govt: AnnouncementsWidget,
  // Election Monitor Widgets
  'election-status': ElectionStatusWidget,
  'swing-analysis': SwingAnalysisWidget,
  'close-races': CloseRacesWidget,
  'incumbency': IncumbencyWidget,
  'candidates': CandidatesWidget,
  'party-switch': PartySwitchWidget,
  // Know Your Neta
  neta: KnowYourNetaWidget,
  // Election Live Stream
  'election-live': ElectionLiveWidget,
  'election-pr': ElectionPRWidget,
  'election-seats': ElectionSeatsWidget,
  // Promise Tracker
  'promise-tracker': PromiseTrackerWidget,
  'parliament-session': ParliamentSessionWidget,
  'govt-decisions': GovtDecisionsWidget,
  // Situation Brief
  'situation-brief': SituationBriefWidget,
  // Developing Stories
  'developing-stories': DevelopingStoriesWidget,
  // River Monitoring
  'river-monitoring': RiverMonitoringWidget,
};

// Mobile detection hook
const MOBILE_QUERY = '(max-width: 768px)';
const mobileSubscribe = (cb: () => void) => {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener('change', cb);
  return () => mql.removeEventListener('change', cb);
};
const getMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getMobileServerSnapshot = () => false;

function useIsMobile() {
  return useSyncExternalStore(mobileSubscribe, getMobileSnapshot, getMobileServerSnapshot);
}

// Get appropriate preset based on user role
function getPresetForRole(role?: UserRole): string {
  return 'news';
}

export function Dashboard() {
  const { widgetOrder, widgetVisibility, applyPreset, activePreset, theme, toggleWidgetVisibility } = useDashboardStore();
  const { user } = useAuthStore();
  const initializedForRole = useRef<UserRole | null>(null);
  const isMobile = useIsMobile();

  // Initialize dashboard preset based on user role (only once per role change)
  useEffect(() => {
    if (!user?.role) return;
    if (initializedForRole.current === user.role) return;

    const targetPreset = getPresetForRole(user.role);

    // Only auto-apply if user hasn't customized
    const isDefaultState = (activePreset === 'analyst' || activePreset === 'news') && initializedForRole.current === null;

    if (isDefaultState && PRESETS[targetPreset]) {
      applyPreset(targetPreset);
    }

    initializedForRole.current = user.role;
  }, [user?.role, applyPreset, activePreset]);

  // Keyboard shortcuts: N -> News, E -> Elections
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'n') {
        e.preventDefault();
        applyPreset('news');
      } else if (key === 'e') {
        e.preventDefault();
        applyPreset('elections');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [applyPreset, toggleWidgetVisibility]);

  // Mobile: HOR seat tracker + FPTP results + PR projection
  const MOBILE_WIDGETS = ['election-seats', 'election-status', 'election-pr'];

  // Filter and order widgets
  const allVisible = widgetOrder.filter(id => widgetVisibility[id]);
  const visibleWidgets = isMobile
    ? MOBILE_WIDGETS.filter(id => WIDGET_COMPONENTS[id])
    : allVisible;

  const themeClass = theme === 'bloomberg' ? 'bloomberg-theme' : '';

  return (
    <div className={`dashboard-app ${themeClass} ${isMobile ? 'mobile-layout' : ''}`}>
      <DashboardHeader />

      {/* Alert Ticker - always visible */}
      <AlertTicker />

      <main className="dashboard-main">
        <div className="widget-grid">
          <Suspense fallback={null}>
            {visibleWidgets.map(widgetId => {
              const WidgetComponent = WIDGET_COMPONENTS[widgetId];
              if (!WidgetComponent) return null;
              return <WidgetComponent key={widgetId} />;
            })}
          </Suspense>
        </div>
      </main>

      <CustomizePanel />
    </div>
  );
}
