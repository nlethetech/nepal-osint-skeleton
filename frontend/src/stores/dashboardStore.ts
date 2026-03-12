import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  dimensionsFromSize,
  dimensionsFromSizes,
  findNearestPreset,
  type WidgetDimensions,
  type WidgetSize,
} from '../components/Dashboard/widgetGrid';

export type { WidgetSize } from '../components/Dashboard/widgetGrid';

export interface WidgetConfig {
  id: string;
  name: string;
  visible: boolean;
  size: WidgetSize;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  order: string[];
  visibility: Record<string, boolean>;
  sizes: Record<string, WidgetSize>;
}

// All available widgets
// Role hierarchy: consumer < analyst < dev
export type WidgetRole = 'consumer' | 'analyst' | 'dev';

export const WIDGET_META: Record<string, {
  name: string;
  category: string;
  minRole?: WidgetRole;  // Minimum role required (default: consumer)
  consumerName?: string; // Friendlier name for consumers
  wip?: boolean;         // Work in progress (hardcoded/placeholder data)
}> = {
  // Core widgets - available to all (REAL DATA)
  'situation-brief': { name: 'National Assessment', category: 'core', consumerName: 'National Assessment' },
  map: { name: 'Situation Map', category: 'core', consumerName: 'News Map' },
  'election-map': { name: 'Election Map', category: 'elections', consumerName: 'Election Map' },
  kpi: { name: 'Key Metrics', category: 'core', consumerName: 'Today\'s Stats' },
  stories: { name: 'Stories Feed', category: 'core', consumerName: 'Top Stories' },
  newsfeed: { name: 'Live News Feed', category: 'core', consumerName: 'Live Feed' },
  briefing: { name: 'Briefing', category: 'core', minRole: 'analyst', wip: true },
  entities: { name: 'Key Entities', category: 'core', minRole: 'analyst', consumerName: 'People in News', wip: true },

  // Collaboration widgets - analyst only (WIP - no backend yet)
  'cases-active': { name: 'Active Cases', category: 'collaboration', minRole: 'analyst', wip: true },
  'collab-feed': { name: 'Activity Feed', category: 'collaboration', minRole: 'analyst', wip: true },
  'verification-queue': { name: 'Verification Queue', category: 'collaboration', minRole: 'analyst', wip: true },
  'analyst-leaderboard': { name: 'Leaderboard', category: 'collaboration', minRole: 'analyst', wip: true },

  // Research widgets - analyst only (WIP - no backend yet)
  'entity-watchlist': { name: 'Entity Watchlist', category: 'research', minRole: 'analyst', wip: true },
  'analyst-notes': { name: 'Research Notes', category: 'research', minRole: 'analyst', wip: true },
  'source-reliability': { name: 'Source Reliability', category: 'research', minRole: 'analyst', wip: true },

  // Politics & elections - available to all (ECN data)
  elections: { name: 'Election Watchlist', category: 'politics', consumerName: 'Elections' },
  govt: { name: 'Govt Announcements', category: 'politics', consumerName: 'Government Updates' },

  // Economy - available to all (REAL DATA - NEPSE, forex, gold/silver)
  market: { name: 'Market & Exchange', category: 'economy', consumerName: 'Markets' },

  // Security - analyst only (REAL DATA)
  threats: { name: 'Risk Matrix', category: 'security', minRole: 'analyst' },

  // Media - available to all
  social: { name: 'Social Feed', category: 'media' },  // Uses Twitter API

  // Disasters & environment - REAL DATA from APIs
  disasters: { name: 'Disaster Alerts', category: 'disasters', consumerName: 'Alerts' },
  weather: { name: 'Weather & Forecast', category: 'disasters', consumerName: 'Weather' },
  seismic: { name: 'Seismic Activity', category: 'disasters', consumerName: 'Earthquakes', wip: true },  // BIPAD API — hidden for production

  // Election Monitor Widgets - ECN data (result.election.gov.np)
  'election-pr': { name: 'PR Seat Projection', category: 'elections' },
  'election-seats': { name: 'HOR Seat Tracker', category: 'elections' },
  'election-status': { name: 'FPTP Constituency Results', category: 'elections' },
  'swing-analysis': { name: 'Swing Analysis', category: 'elections', minRole: 'analyst' },
  'close-races': { name: 'Close Races', category: 'elections' },
  'incumbency': { name: 'Incumbency', category: 'elections', minRole: 'analyst' },
  'candidates': { name: 'Candidates', category: 'elections' },
  'party-switch': { name: 'Party Switchers', category: 'elections', minRole: 'analyst' },

  // Know Your Parliamentarian — elected winners from 2082
  neta: { name: 'Know Your Parliamentarian', category: 'politics', consumerName: 'Your Parliamentarians' },

  // Election Live Stream
  'election-live': { name: 'Election Live', category: 'elections', consumerName: 'Live Coverage' },

  // Situation Monitor Widgets
  'intel-brief-hero': { name: 'Situation Overview', category: 'core', consumerName: 'Situation Summary' },
  'political-pulse': { name: 'Political Pulse', category: 'media', consumerName: 'Political Activity' },
  'province-monitor': { name: 'Provincial Monitor', category: 'core', consumerName: 'Provincial Monitor' },
  'narrative-tracker': { name: 'Story Tracker', category: 'core', consumerName: 'Story Clusters' },
  'developing-stories': { name: 'Developing Stories', category: 'core', consumerName: 'Breaking News' },
  'fact-check': { name: 'Fact Check', category: 'core', consumerName: 'Fact Checker' },

  // Parliament & Accountability
  'promise-tracker': { name: 'Promise Tracker', category: 'parliament', consumerName: 'Manifesto Tracker' },
  'parliament-session': { name: 'Parliamentary Summary', category: 'parliament', consumerName: 'Parliament Summary' },
  'govt-decisions': { name: 'Government Decisions', category: 'parliament', consumerName: 'Govt Decisions' },
  'bill-tracker': { name: 'Bills Tracker', category: 'parliament', consumerName: 'Parliamentary Bills' },
  'parliament-activity': { name: 'Parliamentary Activity', category: 'parliament', consumerName: 'MP Activity' },
};

// Check if widget is WIP
export function isWidgetWIP(widgetId: string): boolean {
  return WIDGET_META[widgetId]?.wip || false;
}

// Helper to check if user can access widget
export function canAccessWidget(widgetId: string, userRole: WidgetRole | undefined): boolean {
  const meta = WIDGET_META[widgetId];
  if (!meta) return false;

  const minRole = meta.minRole || 'consumer';
  const roleHierarchy: WidgetRole[] = ['consumer', 'analyst', 'dev'];
  const userLevel = roleHierarchy.indexOf(userRole || 'consumer');
  const requiredLevel = roleHierarchy.indexOf(minRole);

  return userLevel >= requiredLevel;
}

// Get display name based on role
export function getWidgetDisplayName(widgetId: string, userRole: WidgetRole | undefined): string {
  const meta = WIDGET_META[widgetId];
  if (!meta) return widgetId;

  // Use consumer-friendly name for consumers
  if (userRole === 'consumer' && meta.consumerName) {
    return meta.consumerName;
  }
  return meta.name;
}

// Preset configurations - All sizes designed to fill 12-column grid without gaps
export const PRESETS: Record<string, Preset> = {
  // ============================================
  // CONSUMER PRESETS (Simplified, read-only)
  // ============================================
  news: {
    id: 'news',
    name: 'News Dashboard',
    description: 'News Map with stats, assessment, live feed, fact-check, clusters, provinces, social and markets',
    order: [
      'map', 'kpi', 'situation-brief', 'newsfeed', 'developing-stories',
      'fact-check', 'stories', 'social', 'narrative-tracker', 'province-monitor', 'market'
    ],
    visibility: {
      map: true, 'election-live': false, kpi: true, 'situation-brief': true, newsfeed: true,
      'developing-stories': true, 'fact-check': true, stories: true, social: true,
      'narrative-tracker': true, 'province-monitor': true, market: true,
      weather: false, govt: false,
      // Hidden
      'election-map': false, 'election-status': false,
      'political-pulse': false, briefing: false, entities: false,
      seismic: false, elections: false, disasters: false,
      threats: false,      neta: false, 'intel-brief-hero': false,
    },
    sizes: {
      map: 'situation',               // Row 1: 12 cols, double height (news map)
      'election-live': 'hero',        // Row 2: 12 cols (2x2 live streams)
      kpi: 'full',                    // Row 3: 12 cols
      'situation-brief': 'hero',      // Row 4: 12 cols (national assessment)
      newsfeed: 'large',              // Row 4: 8 cols (live feed)
      'developing-stories': 'small',  // Row 4: 4 cols (8+4=12)
      'fact-check': 'medium',         // Row 5: 6 cols
      stories: 'medium',              // Row 5: 6 cols (6+6=12)
      social: 'medium',               // Row 6: 6 cols
      'narrative-tracker': 'medium',  // Row 6: 6 cols (6+6=12)
      'province-monitor': 'large',    // Row 7: 8 cols
      market: 'small',                // Row 7: 4 cols (8+4=12)
    }
  },

  // ============================================
  // ANALYST PRESETS (Comprehensive)
  // ============================================
  analyst: {
    id: 'analyst',
    name: 'Analyst Election Monitor',
    description: 'Election coverage with intel brief, news feeds & social monitoring',
    order: [
      'election-map', 'kpi', 'situation-brief', 'newsfeed', 'developing-stories',
      'stories', 'social', 'election-status', 'fact-check'
    ],
    visibility: {
      'election-map': true, kpi: true, 'situation-brief': true, newsfeed: true,
      'developing-stories': true, stories: true, social: true, 'election-status': true,
      'fact-check': true,
      // Hidden
      map: false, market: false, weather: false, govt: false, threats: false,
      disasters: false, elections: false, seismic: false,
      briefing: false, entities: false
    },
    sizes: {
      'election-map': 'situation',
      kpi: 'full',
      'situation-brief': 'hero',
      newsfeed: 'large',
      'developing-stories': 'small',
      stories: 'medium',
      social: 'medium',
      'election-status': 'full',
      'fact-check': 'medium',
    }
  },

  intelligence: {
    id: 'intelligence',
    name: 'Intelligence Monitor',
    description: 'Tactical situation map, national brief, developing stories, fact-checks & provincial monitor',
    // Layout: situation(12) -> full(12) -> brief(12) -> medium+medium(6+6) x2
    order: [
      'map', 'kpi', 'situation-brief', 'developing-stories', 'fact-check', 'province-monitor',
      'newsfeed', 'narrative-tracker', 'social'
    ],
    visibility: {
      map: true, kpi: true, 'situation-brief': true, 'developing-stories': true, 'fact-check': true,
      'province-monitor': true, newsfeed: true, 'narrative-tracker': true, social: true,
      // Hidden
      stories: false, weather: false, disasters: false, elections: false,
      market: false, govt: false, threats: false, briefing: false, entities: false,
      seismic: false,
      'election-map': false, 'election-status': false, 'swing-analysis': false,
      'close-races': false, 'incumbency': false, 'candidates': false, 'party-switch': false,
      neta: false, 'intel-brief-hero': false, 'political-pulse': false,
    },
    sizes: {
      map: 'situation',                // Row 1: 12 cols, double height (tactical map)
      kpi: 'full',                    // Row 2: 12 cols
      'situation-brief': 'hero',      // Row 3: 12 cols (national assessment)
      'developing-stories': 'medium', // Row 4: 6 cols
      'fact-check': 'medium',         // Row 4: 6 cols (6+6=12)
      'province-monitor': 'full',     // Row 5: 12 cols
      newsfeed: 'medium',             // Row 6: 6 cols
      'narrative-tracker': 'medium',  // Row 6: 6 cols (6+6=12)
      social: 'full',                 // Row 7: 12 cols
    }
  },

  elections: {
    id: 'elections',
    name: 'Election Monitor',
    description: 'Nepal\'s Election Monitor — live stream, map, results',
    order: [
      'election-map', 'election-seats', 'election-live', 'election-pr', 'election-status'
    ],
    visibility: {
      'election-map': true, 'election-seats': true, 'election-live': true, 'election-pr': true, 'election-status': true,
      'candidates': false, 'close-races': false,
      newsfeed: false, social: false,
      // Hidden during live counting
      'swing-analysis': false, 'incumbency': false, 'party-switch': false,
      map: false, govt: false, elections: false, entities: false, stories: false,
      kpi: false, disasters: false, market: false,
      weather: false, seismic: false,
      threats: false, briefing: false
    },
    sizes: {
      'election-map': 'situation',   // Row 1: 12 cols, double height
      'election-seats': 'hero',       // Row 2: 12 cols (combined seat tracker)
      'election-live': 'hero',       // Row 3: 12 cols (YouTube live streams)
      'election-pr': 'hero',         // Row 4: 12 cols (PR seat projection)
      'election-status': 'hero',     // Row 4: 12 cols, tall (national scoreboard)
      'candidates': 'full',          // Row 4: 12 cols
      'close-races': 'full',         // Row 5: 12 cols
      newsfeed: 'medium',            // Row 6: 6 cols
      social: 'medium',              // Row 6: 6 cols (6+6=12)
    }
  },

  parliament: {
    id: 'parliament',
    name: 'Accountability',
    description: 'Track government promises, bills, parliamentary speeches & elected leaders',
    order: [
      'promise-tracker', 'bill-tracker', 'parliament-activity',
      'govt-decisions', 'parliament-session', 'neta',
    ],
    visibility: {
      'promise-tracker': true, 'bill-tracker': true, 'parliament-activity': true,
      'govt-decisions': true, 'parliament-session': true, neta: true,
      // Hidden
      'political-pulse': false,
      'election-seats': false, newsfeed: false, social: false, 'fact-check': false,
      map: false, kpi: false, 'situation-brief': false, stories: false,
      'election-map': false, 'election-status': false, 'election-live': false, 'election-pr': false,
      weather: false, disasters: false, elections: false, market: false, govt: false,
      threats: false, briefing: false, entities: false, seismic: false,
      'swing-analysis': false, 'close-races': false, 'incumbency': false,
      'candidates': false, 'party-switch': false,
      'developing-stories': false, 'narrative-tracker': false, 'province-monitor': false,
      'intel-brief-hero': false,
    },
    sizes: {
      'promise-tracker': 'hero',              // Row 1: 12 cols, ~6-7 rows tall (manifesto tracker)
      'bill-tracker': 'half',                 // Row 2: 6 cols (bills pipeline)
      'parliament-activity': 'half',          // Row 2: 6 cols (verbatim speech activity)
      'govt-decisions': 'half',               // Row 3: 6 cols
      'parliament-session': 'half',           // Row 3: 6 cols
      neta: 'full',                           // Row 4: 12 cols (full width)
    }
  },

  disaster: {
    id: 'disaster',
    name: 'Disaster Response',
    description: 'Emergency monitoring & alerts',
    // Layout: hero(12) -> medium+medium(6+6=12) -> large+small(8+4=12) -> medium+medium(6+6=12) x2
    order: [
      'map', 'weather', 'disasters',
      'newsfeed', 'govt', 'stories'
    ],
    visibility: {
      map: true, weather: true, disasters: true, seismic: false,
      stories: true, briefing: false, newsfeed: true, govt: true,
      kpi: false, elections: false, market: false, social: false, entities: false,
      threats: false
    },
    sizes: {
      map: 'situation',    // Row 1: 12 cols, double height
      weather: 'medium',   // Row 2: 6 cols
      disasters: 'large',  // Row 3: 8 cols
      newsfeed: 'medium',  // Row 4: 6 cols
      govt: 'medium',      // Row 5: 6 cols
      stories: 'medium'    // Row 5: 6 cols (6+6=12)
    }
  },

  compact: {
    id: 'compact',
    name: 'Compact View',
    description: 'Essential widgets only',
    // Layout: hero(12) -> full(12) -> medium+medium(6+6=12) -> large+small(8+4=12)
    order: ['map', 'kpi', 'newsfeed', 'elections', 'disasters', 'weather'],
    visibility: {
      map: true, kpi: true, weather: true, disasters: true, newsfeed: true, elections: true,
      stories: false, briefing: false, social: false, govt: false, entities: false,
      market: false, seismic: false, threats: false
    },
    sizes: {
      map: 'situation',    // Row 1: 12 cols, double height
      kpi: 'full',         // Row 2: 12 cols
      newsfeed: 'medium',  // Row 3: 6 cols
      elections: 'medium', // Row 3: 6 cols (6+6=12)
      disasters: 'large',  // Row 4: 8 cols
      weather: 'small'     // Row 4: 4 cols (8+4=12)
    }
  },

  // ============================================
  // POLITICAL ANALYST PRESET (Primary Analyst Workflow)
  // ============================================

  'political-analyst': {
    id: 'political-analyst',
    name: 'Political Analyst',
    description: 'Political intelligence & governance monitoring',
    // Optimized layout for political analysis workflow
    // Row 1: Map (12) - Situation Monitor (double height)
    // Row 2: Election Status (6) + Govt Announcements (6) = 12
    // Row 3: Active Cases (6) + Stories Feed (6) = 12
    // Row 4: Swing Analysis (6) + Entity Watchlist (6) = 12
    // Row 5: Social Feed (4) + Activity Feed (4) + Verification Queue (4) = 12
    // Row 6: Analyst Notes (4) + Leaderboard (4)
    order: [
      'map', 'election-status', 'govt', 'stories', 'swing-analysis',
      'social'
    ],
    visibility: {
      map: true, 'election-status': true, govt: true, 'cases-active': false, stories: true,
      'entity-watchlist': false, 'swing-analysis': true, social: true, 'collab-feed': false,
      'verification-queue': false, 'analyst-notes': false, 'analyst-leaderboard': false,
      market: false, kpi: false, threats: false, newsfeed: false, briefing: false,
      weather: false, seismic: false, disasters: false, entities: false,
      'source-reliability': false, elections: false,
      'close-races': false, 'incumbency': false, 'candidates': false, 'party-switch': false
    },
    sizes: {
      map: 'situation',              // Row 1: 12 cols, double height
      'election-status': 'medium',   // Row 2: 6 cols
      govt: 'medium',                // Row 2: 6 cols (6+6=12)
      stories: 'medium',             // Row 3: 6 cols
      'swing-analysis': 'medium',    // Row 3: 6 cols (6+6=12)
      social: 'medium'               // Row 4: 6 cols
    }
  },

  // ============================================
  // COLLABORATION HUB (Team Workspace)
  // ============================================

  'collab-hub': {
    id: 'collab-hub',
    name: 'Collaboration Hub',
    description: 'Team workspace & community verification',
    // Layout: large+small(8+4=12) -> medium+medium(6+6=12) x2 -> small+small+small(4+4+4=12) x2
    order: [
      'map', 'stories'
    ],
    visibility: {
      'cases-active': false, 'verification-queue': false, 'collab-feed': false,
      'analyst-leaderboard': false, map: true, stories: true, 'entity-watchlist': false,
      'source-reliability': false, 'analyst-notes': false,
      market: false, kpi: false, threats: false, newsfeed: false, briefing: false,
      weather: false, seismic: false, disasters: false, entities: false,
      social: false, govt: false, elections: false,
      'election-status': false, 'swing-analysis': false, 'close-races': false,
      'incumbency': false, 'candidates': false, 'party-switch': false
    },
    sizes: {
      map: 'hero',                   // Row 1: 12 cols (full width, half height)
      stories: 'full'                // Row 2: 12 cols
    }
  },

  // ============================================
  // ANALYST OPS PRESET (Bloomberg-Dense Console)
  // ============================================
  'analyst-ops': {
    id: 'analyst-ops',
    name: 'Analyst Console',
    description: 'Dense 6-widget ops workstation - no scrolling',
    // Layout: full(12) -> large+small(8+4=12) -> small+small+small(4+4+4=12)
    order: ['kpi', 'stories', 'newsfeed', 'threats', 'elections'],
    visibility: {
      kpi: true, stories: true, 'verification-queue': false,
      newsfeed: true, threats: true, elections: true,
      // Everything else hidden for focus
      map: false, disasters: false, weather: false,      seismic: false, market: false, social: false, govt: false,
      briefing: false, entities: false,
      'cases-active': false, 'collab-feed': false, 'analyst-leaderboard': false,
      'analyst-notes': false, 'entity-watchlist': false, 'source-reliability': false,
      'election-status': false, 'swing-analysis': false, 'close-races': false,
      'incumbency': false, 'candidates': false, 'party-switch': false
    },
    sizes: {
      kpi: 'full',                    // Row 1: 12 cols
      stories: 'large',               // Row 2: 8 cols
      newsfeed: 'small',              // Row 2: 4 cols (8+4=12)
      threats: 'small',               // Row 3: 4 cols
      elections: 'small'              // Row 3: 4 cols
    }
  },

  // ============================================
  // SITUATION MONITOR (Intelligence Platform)
  // ============================================
  'situation-monitor': {
    id: 'situation-monitor',
    name: 'Situation Monitor',
    description: 'At-a-glance intelligence platform — political, economic, security',
    // Layout: full(12) -> hero(12) -> brief(12) -> full(12) -> medium+medium(6+6=12)
    order: [
      'intel-brief-hero', 'developing-stories', 'political-pulse', 'province-monitor',
      'narrative-tracker', 'social', 'map'
    ],
    visibility: {
      'intel-brief-hero': true,
      'developing-stories': true,
      'political-pulse': true,
      'province-monitor': true,
      'narrative-tracker': true,
      social: true,
      map: true,
      // Hide everything else
      kpi: false, 'situation-brief': false, stories: false, newsfeed: false,
      weather: false, disasters: false, elections: false, market: false,
      entities: false, briefing: false, govt: false, threats: false,
      seismic: false,
      'election-map': false, 'election-status': false, 'swing-analysis': false,
      'close-races': false, 'incumbency': false, 'candidates': false, 'party-switch': false,
      neta: false, 'cases-active': false, 'collab-feed': false,
      'verification-queue': false, 'entity-watchlist': false,
      'analyst-notes': false, 'source-reliability': false, 'analyst-leaderboard': false,
    },
    sizes: {
      'intel-brief-hero': 'full',       // Row 1: 12 cols
      'developing-stories': 'full',     // Row 2: 12 cols
      'political-pulse': 'hero',        // Row 3: 12 cols (tall)
      'province-monitor': 'brief',      // Row 4: 12 cols (tall)
      'narrative-tracker': 'full',      // Row 5: 12 cols
      social: 'medium',                 // Row 6: 6 cols
      map: 'medium',                    // Row 6: 6 cols (6+6=12)
    }
  }
};

// Theme types
export type ThemeMode = 'default' | 'bloomberg';

interface DashboardState {
  // Current layout state
  widgetOrder: string[];
  widgetVisibility: Record<string, boolean>;
  widgetSizes: Record<string, WidgetSize>;
  widgetDimensions: Record<string, WidgetDimensions>;
  activePreset: string;

  // UI state
  customizePanelOpen: boolean;
  theme: ThemeMode;

  // Actions
  setWidgetOrder: (order: string[]) => void;
  toggleWidgetVisibility: (widgetId: string) => void;
  setWidgetSize: (widgetId: string, size: WidgetSize) => void;
  setWidgetDimensions: (widgetId: string, dimensions: WidgetDimensions) => void;
  applyPreset: (presetId: string) => void;
  setCustomizePanelOpen: (open: boolean) => void;
  moveWidget: (fromIndex: number, toIndex: number) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const defaultPreset = PRESETS.news;

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      // Initial state from default preset
      widgetOrder: [...defaultPreset.order],
      widgetVisibility: { ...defaultPreset.visibility },
      widgetSizes: { ...defaultPreset.sizes } as Record<string, WidgetSize>,
      widgetDimensions: dimensionsFromSizes(defaultPreset.sizes as Record<string, WidgetSize>),
      activePreset: 'news',
      customizePanelOpen: false,
      theme: 'bloomberg' as ThemeMode,  // Default to Bloomberg theme

      setWidgetOrder: (order) => set({ widgetOrder: order, activePreset: 'custom' }),

      toggleWidgetVisibility: (widgetId) =>
        set((state) => {
          const newVisibility = !state.widgetVisibility[widgetId];
          // If turning on and not in order, add to end of order
          let newOrder = state.widgetOrder;
          if (newVisibility && !state.widgetOrder.includes(widgetId)) {
            newOrder = [...state.widgetOrder, widgetId];
          }
          return {
            widgetOrder: newOrder,
            widgetVisibility: {
              ...state.widgetVisibility,
              [widgetId]: newVisibility,
            },
            activePreset: 'custom',  // Mark as custom when user modifies
          };
        }),

      setWidgetSize: (widgetId, size) =>
        set((state) => ({
          widgetSizes: {
            ...state.widgetSizes,
            [widgetId]: size,
          },
          widgetDimensions: {
            ...state.widgetDimensions,
            [widgetId]: dimensionsFromSize(size),
          },
          activePreset: 'custom',  // Mark as custom when user modifies
        })),

      setWidgetDimensions: (widgetId, dimensions) =>
        set((state) => ({
          widgetDimensions: {
            ...state.widgetDimensions,
            [widgetId]: dimensions,
          },
          widgetSizes: {
            ...state.widgetSizes,
            [widgetId]: findNearestPreset(dimensions.cols, dimensions.rows),
          },
          activePreset: 'custom',  // Mark as custom when user modifies
        })),

      applyPreset: (presetId) => {
        const preset = PRESETS[presetId];
        if (!preset) return;
        set({
          widgetOrder: [...preset.order],
          widgetVisibility: { ...preset.visibility },
          widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
          widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
          activePreset: presetId,
        });
      },

      setCustomizePanelOpen: (open) => set({ customizePanelOpen: open }),

      moveWidget: (fromIndex, toIndex) =>
        set((state) => {
          const newOrder = [...state.widgetOrder];
          const [removed] = newOrder.splice(fromIndex, 1);
          newOrder.splice(toIndex, 0, removed);
          return { widgetOrder: newOrder };
        }),

      setTheme: (theme) => set({ theme }),

      toggleTheme: () =>
        set((state) => ({
          theme: state.theme === 'bloomberg' ? 'default' : 'bloomberg',
        })),
    }),
    {
      name: 'rta-dashboard-v14',  // v44: News preset includes market widget by default
      version: 44,
      migrate: (persistedState: unknown, version: number) => {
        if (!persistedState || typeof persistedState !== 'object') {
          return persistedState as DashboardState;
        }

        const state = persistedState as DashboardState;

        // v44: Update News preset to include market widget by default
        if (version < 44 && state.activePreset === 'news') {
          const preset = PRESETS.news;
          return {
            ...state,
            widgetOrder: [...preset.order],
            widgetVisibility: { ...preset.visibility },
            widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
            widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
            activePreset: 'news',
          };
        }

        // v42: Normalize national assessment to hero footprint
        if (version < 42) {
          const nextSizes = {
            ...state.widgetSizes,
            'situation-brief': 'hero' as WidgetSize,
          };

          return {
            ...state,
            widgetSizes: nextSizes,
            widgetDimensions: dimensionsFromSizes(nextSizes),
          };
        }

        // v41: Remove temporary Home preset and reset landing to News
        if (version < 41 && (state.activePreset === 'home' || state.activePreset === 'consumer')) {
          const preset = PRESETS.news;
          return {
            ...state,
            activePreset: 'news',
            widgetOrder: [...preset.order],
            widgetVisibility: { ...preset.visibility },
            widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
            widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
          };
        }

        // v39: Post-election — switch everyone from elections to news preset
        if (version < 39 && state.activePreset === 'elections') {
          const preset = PRESETS.news;
          return {
            ...state,
            activePreset: 'news',
            widgetOrder: [...preset.order],
            widgetVisibility: { ...preset.visibility },
            widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
            widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
          };
        }
        if (version < 13 && state.activePreset === 'consumer') {
          return {
            ...state,
            widgetOrder: Array.isArray(state.widgetOrder)
              ? state.widgetOrder.filter((id) => id !== 'neta')
              : PRESETS.consumer.order,
            widgetVisibility: {
              ...state.widgetVisibility,
              neta: false,
            },
            widgetSizes: {
              ...state.widgetSizes,
              neta: state.widgetSizes?.neta || 'small',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              neta: state.widgetSizes?.neta || 'small',
            } as Record<string, WidgetSize>),
          };
        }

        // v15: Add situation-brief widget
        if (version < 15) {
          const order = Array.isArray(state.widgetOrder) ? [...state.widgetOrder] : [];
          // Insert after kpi if present, otherwise add to end
          if (!order.includes('situation-brief')) {
            const kpiIdx = order.indexOf('kpi');
            if (kpiIdx !== -1) {
              order.splice(kpiIdx + 1, 0, 'situation-brief');
            } else {
              order.push('situation-brief');
            }
          }
          return {
            ...state,
            widgetOrder: order,
            widgetVisibility: {
              ...state.widgetVisibility,
              'situation-brief': true,
            },
            widgetSizes: {
              ...state.widgetSizes,
              'situation-brief': 'hero',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              'situation-brief': 'hero',
            } as Record<string, WidgetSize>),
          };
        }


        // v23: Remove live-cams from News Dashboard starting view
        if (version < 23) {
          if (state.activePreset === 'consumer') {
            const order = Array.isArray(state.widgetOrder) ? [...state.widgetOrder] : [];
            // Move live-cams to end if present
            const lcIdx = order.indexOf('live-cams');
            if (lcIdx !== -1) {
              order.splice(lcIdx, 1);
              order.push('live-cams');
            }
            return {
              ...state,
              widgetOrder: order,
              widgetVisibility: {
                ...state.widgetVisibility,
                'live-cams': false,
              },
            };
          }
        }

        // v34: Election dashboard was default — now superseded by v39 news migration
        if (version < 38) {
          const preset = PRESETS.news;
          return {
            ...state,
            activePreset: 'news',
            widgetOrder: [...preset.order],
            widgetVisibility: { ...preset.visibility },
            widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
            widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
          };
        }

        // v25: Reset consumer users to cleaner preset layout
        if (version < 25) {
          if (state.activePreset === 'consumer') {
            const preset = PRESETS.consumer;
            return {
              ...state,
              widgetOrder: [...preset.order],
              widgetVisibility: { ...preset.visibility },
              widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
              widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
            };
          }
        }

        // v24: Add developing-stories widget for all users
        if (version < 24) {
          const order = Array.isArray(state.widgetOrder) ? [...state.widgetOrder] : [];
          if (!order.includes('developing-stories')) {
            // Insert after situation-brief if present, otherwise after kpi
            const briefIdx = order.indexOf('situation-brief');
            const kpiIdx = order.indexOf('kpi');
            const insertIdx = briefIdx !== -1 ? briefIdx + 1 : kpiIdx !== -1 ? kpiIdx + 1 : 0;
            order.splice(insertIdx, 0, 'developing-stories');
          }
          return {
            ...state,
            widgetOrder: order,
            widgetVisibility: {
              ...state.widgetVisibility,
              'developing-stories': true,
            },
            widgetSizes: {
              ...state.widgetSizes,
              'developing-stories': 'full',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              'developing-stories': 'full',
            } as Record<string, WidgetSize>),
          };
        }


        // v20: Reset consumer users to latest preset (includes live-cams + political-pulse)
        if (version < 20) {
          if (state.activePreset === 'consumer') {
            const preset = PRESETS.consumer;
            return {
              ...state,
              widgetOrder: [...preset.order],
              widgetVisibility: { ...preset.visibility },
              widgetSizes: { ...preset.sizes } as Record<string, WidgetSize>,
              widgetDimensions: dimensionsFromSizes(preset.sizes as Record<string, WidgetSize>),
            };
          }
          // Non-consumer users: register new widgets without auto-enabling
          const order = Array.isArray(state.widgetOrder) ? [...state.widgetOrder] : [];
          if (!order.includes('live-cams')) order.push('live-cams');
          if (!order.includes('political-pulse')) order.push('political-pulse');
          return {
            ...state,
            widgetOrder: order,
            widgetVisibility: {
              ...state.widgetVisibility,
              'live-cams': state.widgetVisibility?.['live-cams'] ?? false,
              'political-pulse': state.widgetVisibility?.['political-pulse'] ?? false,
            },
            widgetSizes: {
              ...state.widgetSizes,
              'live-cams': state.widgetSizes?.['live-cams'] || 'medium',
              'political-pulse': state.widgetSizes?.['political-pulse'] || 'medium',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              'live-cams': state.widgetSizes?.['live-cams'] || 'medium',
              'political-pulse': state.widgetSizes?.['political-pulse'] || 'medium',
            } as Record<string, WidgetSize>),
          };
        }

        // v17: Register situation monitor widgets (no auto-enable, just make them available)
        if (version < 17) {
          return {
            ...state,
            widgetVisibility: {
              ...state.widgetVisibility,
              'intel-brief-hero': state.widgetVisibility?.['intel-brief-hero'] ?? false,
              'political-pulse': state.widgetVisibility?.['political-pulse'] ?? false,
              'province-monitor': state.widgetVisibility?.['province-monitor'] ?? false,
              'narrative-tracker': state.widgetVisibility?.['narrative-tracker'] ?? false,
            },
            widgetSizes: {
              ...state.widgetSizes,
              'intel-brief-hero': 'full',
              'political-pulse': 'hero',
              'province-monitor': 'brief',
              'narrative-tracker': 'full',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              'intel-brief-hero': 'full',
              'political-pulse': 'hero',
              'province-monitor': 'brief',
              'narrative-tracker': 'full',
            } as Record<string, WidgetSize>),
          };
        }

        // v16: Normalize situation-brief size to dedicated hero footprint
        if (version < 16) {
          return {
            ...state,
            widgetSizes: {
              ...state.widgetSizes,
              'situation-brief': 'hero',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              'situation-brief': 'hero',
            } as Record<string, WidgetSize>),
          };
        }

        // v14: Enable market & power widgets by default
        if (version < 14) {
          const order = Array.isArray(state.widgetOrder) ? [...state.widgetOrder] : [];
          if (!order.includes('market')) order.push('market');
          if (!order.includes('power')) order.push('power');
          return {
            ...state,
            widgetOrder: order,
            widgetVisibility: {
              ...state.widgetVisibility,
              market: true,
              power: true,
            },
            widgetSizes: {
              ...state.widgetSizes,
              market: state.widgetSizes?.market || 'medium',
              power: state.widgetSizes?.power || 'medium',
            },
            widgetDimensions: dimensionsFromSizes({
              ...(state.widgetSizes || {}),
              market: state.widgetSizes?.market || 'medium',
              power: state.widgetSizes?.power || 'medium',
            } as Record<string, WidgetSize>),
          };
        }

        return {
          ...state,
          widgetDimensions: state.widgetDimensions || dimensionsFromSizes((state.widgetSizes || defaultPreset.sizes) as Record<string, WidgetSize>),
        };
      },
    }
  )
);
