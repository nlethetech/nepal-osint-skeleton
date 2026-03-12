import { useEffect, useState, createContext, useContext, useRef, useSyncExternalStore, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardHeader } from './DashboardHeader';
import { AnalystToolbar } from './AnalystToolbar';
import { FeedbackPanel } from './FeedbackPanel';
import { AlertTicker } from './AlertTicker';
import { useDashboardStore, PRESETS } from '../../stores/dashboardStore';
import { useAuthStore, UserRole } from '../../store/slices/authSlice';
import { useUserPreferencesStore } from '../../store/slices/userPreferencesSlice';
import { DashboardTour, WelcomeModal, getDashboardTourSteps } from '../onboarding';
// Lazy load heavy widgets for faster initial paint
const LazyMapWidget = lazy(() => import('./widgets/MapWidget').then(m => ({ default: m.MapWidget })));
const LazyElectionsWidget = lazy(() => import('./widgets/ElectionsWidget').then(m => ({ default: m.ElectionsWidget })));

import {
  ElectionMapWidget,
  KPIWidget,
  StoriesWidget,
  NewsFeedWidget,
  WeatherWidget,
  DisastersWidget,
  MarketWidget,
  EntitiesWidget,
  BriefingWidget,
  SocialWidget,
  AnnouncementsWidget,
  ThreatsWidget,
  SeismicWidget,
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
  // Collaboration Widgets (Palantir-grade OSINT)
  ActiveCasesWidget,
  CollaborationFeedWidget,
  VerificationQueueWidget,
  EntityWatchlistWidget,
  AnalystNotesWidget,
  SourceReliabilityWidget,
  AnalystLeaderboardWidget,
  // Situation Brief (Narada Analyst Agent)
  SituationBriefWidget,
  // Situation Monitor Widgets
  IntelBriefHeroWidget,
  PoliticalPulseWidget,
  ProvinceMonitorWidget,
  NarrativeTrackerWidget,
  DevelopingStoriesWidget,
  // Fact-Check Widget
  FactCheckWidget,
  // Promise Tracker
  PromiseTrackerWidget,
  // Parliament Session
  ParliamentSessionWidget,
  // Government Decisions
  GovtDecisionsWidget,
  // Bills Tracker
  BillTrackerWidget,
  // Parliamentary Activity (Verbatim)
  ParliamentaryActivityWidget,
} from './widgets';
import { CustomizePanel } from './CustomizePanel';
import { CommandPalette } from './CommandPalette';
import '../../styles/dashboard.css';
import '../../styles/professional-dashboard.css';

// Analyst mode context for child components
interface AnalystModeContextType {
  feedbackMode: boolean;
  selectedStories: Set<string>;
  toggleStorySelection: (id: string) => void;
  openFeedbackPanel: (story: any) => void;
}

export const AnalystModeContext = createContext<AnalystModeContextType | null>(null);
export const useAnalystMode = () => useContext(AnalystModeContext);

// Widget component map
export const WIDGET_COMPONENTS: Record<string, React.ComponentType> = {
  map: LazyMapWidget,
  'election-map': ElectionMapWidget,
  kpi: KPIWidget,
  stories: StoriesWidget,
  newsfeed: NewsFeedWidget,  // Real-time WebSocket feed
  weather: WeatherWidget,
  disasters: DisastersWidget,
  elections: LazyElectionsWidget,
  market: MarketWidget,
  entities: EntitiesWidget,
  briefing: BriefingWidget,
  social: SocialWidget,
  govt: AnnouncementsWidget,
  threats: ThreatsWidget,
  seismic: SeismicWidget,
  // Election Monitor Widgets (Palantir-style modular)
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
  'bill-tracker': BillTrackerWidget,
  'parliament-activity': ParliamentaryActivityWidget,
  // Situation Brief (Narada Analyst Agent)
  'situation-brief': SituationBriefWidget,
  // Collaboration Widgets (Palantir-grade OSINT)
  'cases-active': ActiveCasesWidget,
  'collab-feed': CollaborationFeedWidget,
  'verification-queue': VerificationQueueWidget,
  'entity-watchlist': EntityWatchlistWidget,
  'analyst-notes': AnalystNotesWidget,
  'source-reliability': SourceReliabilityWidget,
  'analyst-leaderboard': AnalystLeaderboardWidget,
  // Situation Monitor Widgets
  'intel-brief-hero': IntelBriefHeroWidget,
  'developing-stories': DevelopingStoriesWidget,
  'political-pulse': PoliticalPulseWidget,
  'province-monitor': ProvinceMonitorWidget,
  'narrative-tracker': NarrativeTrackerWidget,
  // Fact-Check Widget
  'fact-check': FactCheckWidget,
};

const MOBILE_WIDGETS_BY_PRESET: Record<string, string[]> = {
  news: ['situation-brief', 'developing-stories', 'fact-check', 'newsfeed', 'province-monitor'],
  analyst: ['election-map', 'situation-brief', 'newsfeed', 'election-status', 'fact-check'],
  intelligence: ['map', 'situation-brief', 'developing-stories', 'fact-check', 'province-monitor'],
  elections: ['election-seats', 'election-status', 'election-pr', 'election-live'],
  parliament: ['promise-tracker', 'bill-tracker', 'parliament-activity', 'govt-decisions', 'parliament-session'],
  disaster: ['map', 'disasters', 'weather', 'newsfeed', 'govt'],
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
  switch (role) {
    case 'dev':
    case 'analyst':
      return 'analyst';
    case 'consumer':
    default:
      return 'news';
  }
}

function getMobileWidgetOrder(presetId: string, visibleWidgets: string[]): string[] {
  const presetWidgets = MOBILE_WIDGETS_BY_PRESET[presetId];
  if (presetWidgets) {
    const visibleSet = new Set(visibleWidgets);
    const ordered = presetWidgets.filter((id) => visibleSet.has(id) && WIDGET_COMPONENTS[id]);
    if (ordered.length > 0) return ordered;
  }

  return visibleWidgets.filter((id) => WIDGET_COMPONENTS[id]).slice(0, 5);
}

export function Dashboard() {
  const { widgetOrder, widgetVisibility, applyPreset, activePreset, theme } = useDashboardStore();
  const { user, isGuest } = useAuthStore();
  const {
    clearTourReplay,
    completeDashboardTour,
    shouldShowDashboardOnboarding,
    skipDashboardTour,
    startDashboardTour,
    tourReplayRequested,
  } = useUserPreferencesStore();
  const initializedForRole = useRef<UserRole | null>(null);
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  // Analyst mode state
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [selectedStories, setSelectedStories] = useState<Set<string>>(new Set());
  const [feedbackPanelStory, setFeedbackPanelStory] = useState<any>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);

  const isAnalystOrDev = user?.role === 'analyst' || user?.role === 'dev';
  const onboardingUserKey = useMemo(() => {
    if (!user) return null;
    return isGuest ? `guest:${user.id}` : `${user.authProvider}:${user.id}`;
  }, [isGuest, user]);
  const onboardingSteps = useMemo(() => getDashboardTourSteps(isMobile), [isMobile]);

  // Initialize dashboard preset based on user role (only once per role change)
  useEffect(() => {
    if (!user?.role) return;
    if (initializedForRole.current === user.role) return;

    const targetPreset = isMobile && (user.role === 'analyst' || user.role === 'dev')
      ? 'news'
      : getPresetForRole(user.role);

    // Only auto-apply if user hasn't customized (check if current matches a known preset)
    const isDefaultState = (activePreset === 'analyst' || activePreset === 'news') && initializedForRole.current === null;

    if (isDefaultState && PRESETS[targetPreset]) {
      applyPreset(targetPreset);
    }

    initializedForRole.current = user.role;
  }, [user?.role, applyPreset, activePreset, isMobile]);

  // Keyboard shortcuts: N → News, E → Elections, T → toggle tactical map
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
  }, [applyPreset]);

  // Toggle story selection for bulk actions
  const toggleStorySelection = (id: string) => {
    setSelectedStories(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Open feedback panel for a story
  const openFeedbackPanel = (story: any) => {
    setFeedbackPanelStory(story);
  };

  // Handle bulk actions
  const handleBulkAction = (action: string) => {
    // TODO: Implement bulk feedback submission
    // TODO: Implement bulk feedback submission
    setSelectedStories(new Set());
  };

  // Handle feedback submission
  const handleFeedbackSubmit = (feedback: any) => {
    // TODO: Submit feedback to backend
    // TODO: Submit to backend
  };

  // Filter and order widgets
  const allVisible = widgetOrder.filter(id => widgetVisibility[id]);
  const visibleWidgets = isMobile
    ? getMobileWidgetOrder(activePreset, allVisible)
    : allVisible;
  // Analyst mode context value — memoized to prevent unnecessary consumer re-renders
  const analystModeValue = useMemo<AnalystModeContextType>(() => ({
    feedbackMode,
    selectedStories,
    toggleStorySelection,
    openFeedbackPanel,
  }), [feedbackMode, selectedStories]);

  const themeClass = theme === 'bloomberg' ? 'bloomberg-theme' : '';

  useEffect(() => {
    if (!onboardingUserKey || user?.role !== 'consumer') return;
    if (showWelcome || tourOpen) return;

    const timer = window.setTimeout(() => {
      if (shouldShowDashboardOnboarding(onboardingUserKey, isGuest)) {
        setShowWelcome(true);
      }
    }, tourReplayRequested ? 0 : 500);

    return () => window.clearTimeout(timer);
  }, [
    isGuest,
    onboardingUserKey,
    shouldShowDashboardOnboarding,
    showWelcome,
    tourOpen,
    tourReplayRequested,
    user?.role,
  ]);

  const handleStartTour = () => {
    startDashboardTour();
    clearTourReplay();
    setShowWelcome(false);
    setTourOpen(true);
  };

  const handleSkipOnboarding = () => {
    if (onboardingUserKey) {
      skipDashboardTour(onboardingUserKey);
    } else {
      clearTourReplay();
    }
    setShowWelcome(false);
    setTourOpen(false);
  };

  const handleCompleteTour = () => {
    if (onboardingUserKey) {
      completeDashboardTour(onboardingUserKey);
    } else {
      clearTourReplay();
    }
    setShowWelcome(false);
    setTourOpen(false);
  };

  const handleCreateAccount = () => {
    if (onboardingUserKey) {
      skipDashboardTour(onboardingUserKey);
    } else {
      clearTourReplay();
    }
    setShowWelcome(false);
    setTourOpen(false);
    navigate('/login', { state: { mode: 'signup' } });
  };

  const handleTourStepChange = (step: { presetId?: 'news' | 'parliament' | 'elections' }) => {
    if (step.presetId && activePreset !== step.presetId) {
      applyPreset(step.presetId)
    }
  }

  return (
    <AnalystModeContext.Provider value={analystModeValue}>
      <div
        className={`dashboard-app ${themeClass} ${feedbackMode ? 'feedback-mode' : ''} ${isMobile ? 'mobile-layout' : ''}`}
        data-active-preset={activePreset}
      >
        <DashboardHeader />

        {/* Alert Ticker - always visible */}
        <AlertTicker />

        {/* Analyst Toolbar - only for analyst/dev roles */}
        {isAnalystOrDev && (
          <AnalystToolbar
            feedbackMode={feedbackMode}
            setFeedbackMode={setFeedbackMode}
            selectedCount={selectedStories.size}
            onBulkAction={handleBulkAction}
          />
        )}

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
        <CommandPalette />

        {/* Feedback Panel */}
        {feedbackPanelStory && (
          <FeedbackPanel
            story={feedbackPanelStory}
            onClose={() => setFeedbackPanelStory(null)}
            onSubmit={handleFeedbackSubmit}
          />
        )}

        {user?.role === 'consumer' && (
          <>
            <WelcomeModal
              isOpen={showWelcome}
              isGuest={isGuest}
              onStartTour={handleStartTour}
              onSkip={handleSkipOnboarding}
              onCreateAccount={handleCreateAccount}
            />
            <DashboardTour
              isOpen={tourOpen}
              isGuest={isGuest}
              steps={onboardingSteps}
              onComplete={handleCompleteTour}
              onSkip={handleSkipOnboarding}
              onCreateAccount={handleCreateAccount}
              onStepChange={handleTourStepChange}
            />
          </>
        )}

      </div>
    </AnalystModeContext.Provider>
  );
}
