export type TourPlacement = 'top' | 'right' | 'bottom' | 'left' | 'center'

export interface DashboardTourStep {
  id: string
  title: string
  description: string
  targetId?: string
  placement: TourPlacement
  mobileEnabled: boolean
  guestCta?: 'create-account'
  requiresScroll?: boolean
  presetId?: 'news' | 'parliament' | 'elections'
}

const DESKTOP_STEPS: DashboardTourStep[] = [
  {
    id: 'presets',
    title: 'Switch dashboard views',
    description: 'These tabs swap the dashboard composition. Use them to move between news, accountability, and election-focused views.',
    targetId: 'preset-tabs',
    placement: 'bottom',
    mobileEnabled: false,
  },
  {
    id: 'news-tab',
    title: 'Start in the News workspace',
    description: 'Begin in News when you want the live operational picture first. This is the default workspace for breaking developments, verified updates, and fast situational awareness.',
    targetId: 'news-tab',
    placement: 'bottom',
    mobileEnabled: false,
    presetId: 'news',
  },
  {
    id: 'news-map',
    title: 'Use the map for fast geographic context',
    description: 'The News map shows where activity, incidents, and pressure are concentrating. Use it first when you want to understand location, spread, and intensity before opening individual stories.',
    targetId: 'news-map',
    placement: 'bottom',
    mobileEnabled: true,
    requiresScroll: true,
    presetId: 'news',
  },
  {
    id: 'national-assessment',
    title: 'Start with National Assessment',
    description: 'This is the fastest read on the national picture. Use it first when you want the top synthesis before opening raw feeds.',
    targetId: 'national-assessment',
    placement: 'bottom',
    mobileEnabled: true,
    requiresScroll: true,
    presetId: 'news',
  },
  {
    id: 'stories-feed',
    title: 'Watch the live intake',
    description: 'Live Feed shows raw story intake as it lands. This is where you monitor what is new before it matures into broader narrative patterns.',
    targetId: 'stories-feed',
    placement: 'top',
    mobileEnabled: true,
    requiresScroll: true,
  },
  {
    id: 'fact-check',
    title: 'Open the fact checks',
    description: 'Fact Check highlights claims that have already been reviewed, disputed, or confirmed so you can separate noise from stronger reporting.',
    targetId: 'fact-check',
    placement: 'top',
    mobileEnabled: true,
    requiresScroll: true,
    presetId: 'news',
  },
  {
    id: 'provincial-monitor',
    title: 'Scan province-by-province',
    description: 'Provincial Monitor rolls activity up by province so you can see where pressure, risk, or stability is concentrated.',
    targetId: 'provincial-monitor',
    placement: 'top',
    mobileEnabled: false,
    requiresScroll: true,
    presetId: 'news',
  },
  {
    id: 'accountability-tab',
    title: 'Then move into Accountability',
    description: 'After you understand the live picture, move to Accountability when you want to track promises, bills, parliamentary activity, and government decisions.',
    targetId: 'accountability-tab',
    placement: 'bottom',
    mobileEnabled: false,
    presetId: 'parliament',
  },
  {
    id: 'accountability-overview',
    title: 'This is the accountability workspace',
    description: 'The Accountability view pulls manifesto promises and legislative tracking into one place so users can monitor delivery, not just headlines.',
    targetId: 'accountability-overview',
    placement: 'bottom',
    mobileEnabled: false,
    requiresScroll: true,
    presetId: 'parliament',
  },
  {
    id: 'bill-tracker',
    title: 'Use Bill Tracker for legislative movement',
    description: 'Bill Tracker shows which bills are registered, debated, stalled, or moving through committee so users can follow how legislation is actually progressing.',
    targetId: 'bill-tracker',
    placement: 'top',
    mobileEnabled: false,
    requiresScroll: true,
    presetId: 'parliament',
  },
  {
    id: 'parliament-session',
    title: 'Use Parliamentary Session for chamber context',
    description: 'Parliamentary Session summarizes what happened inside the chamber, including agenda, discussion flow, and the current session picture behind the headlines.',
    targetId: 'parliament-session',
    placement: 'top',
    mobileEnabled: false,
    requiresScroll: true,
    presetId: 'parliament',
  },
  {
    id: 'account-menu',
    title: 'Guest versus account',
    description: 'Guest sessions are temporary and read-only. Create an account when you want a persistent identity and future personalized features.',
    targetId: 'account-menu',
    placement: 'bottom',
    mobileEnabled: true,
    guestCta: 'create-account',
  },
  {
    id: 'help-tour',
    title: 'Replay this anytime',
    description: 'Use Guide whenever you want to replay the tour later. You do not need to remember everything on the first pass.',
    targetId: 'help-tour',
    placement: 'bottom',
    mobileEnabled: true,
    guestCta: 'create-account',
  },
]

const MOBILE_STEPS: DashboardTourStep[] = [
  {
    id: 'news-map',
    title: 'Start with the map',
    description: 'The map gives you the fastest geographic read on where activity is clustering before you drill into individual stories.',
    targetId: 'news-map',
    placement: 'bottom',
    mobileEnabled: true,
    requiresScroll: true,
    presetId: 'news',
  },
  {
    id: 'national-assessment',
    title: 'This is your live dashboard',
    description: 'National Assessment is the fastest way to understand the current picture before drilling into live feeds or province detail.',
    targetId: 'national-assessment',
    placement: 'bottom',
    mobileEnabled: true,
    requiresScroll: true,
    presetId: 'news',
  },
  {
    id: 'fact-check',
    title: 'Use live feed and fact check together',
    description: 'Watch new reporting in the live feed, then cross-check reviewed claims here when you need more confidence.',
    targetId: 'fact-check',
    placement: 'top',
    mobileEnabled: true,
    requiresScroll: true,
  },
  {
    id: 'accountability-tab',
    title: 'Use Accountability for follow-through',
    description: 'After checking the news flow, open Accountability to monitor promises, bills, and parliamentary follow-through.',
    targetId: 'accountability-tab',
    placement: 'bottom',
    mobileEnabled: true,
    presetId: 'parliament',
  },
  {
    id: 'help-tour',
    title: 'Return here anytime',
    description: 'Open Guide to replay this walkthrough later. If you are still in a guest session, create an account when you want a persistent identity.',
    targetId: 'help-tour',
    placement: 'bottom',
    mobileEnabled: true,
    guestCta: 'create-account',
  },
]

export function getDashboardTourSteps(isMobile: boolean): DashboardTourStep[] {
  return isMobile ? MOBILE_STEPS : DESKTOP_STEPS
}
