// Stories hooks
export {
  useStories,
  useCriticalStories,
  storiesKeys,
} from './useStories';

// Disaster hooks
export {
  useDisasterAlerts,
  useDisasterIncidents,
  useDisasterStats,
  useDisasterMapData,
  disasterKeys,
} from './useDisasters';

// Aggregated stories hooks
export {
  useAggregatedStories,
} from './useAggregatedStories';
export type {
  AggregatedCluster,
  AggregatedNewsResponse,
  ClusterStory,
} from './useAggregatedStories';

// River monitoring hooks
export {
  useRiverStations,
  useRiverStats,
  useRiverMapData,
  useRiverAlerts,
  riverKeys,
} from './useRiver';

// Weather hooks (DHM Nepal)
export {
  useCurrentWeather,
  useWeatherSummary,
  useWeatherHistory,
  weatherKeys,
} from './useWeather';

// Government Announcements hooks
export {
  useAnnouncementSummary,
  useAnnouncements,
  useAnnouncement,
  useAnnouncementSources,
  useMarkAsRead,
  useToggleImportant,
  announcementKeys,
} from './useAnnouncements';

// Market data hooks (NEPSE, forex, gold/silver, fuel)
export {
  useMarketSummary,
  useRefreshMarketData,
  marketKeys,
} from './useMarket';

// Infrastructure status hooks (derived from disaster data)
export {
  useInfrastructureStatus,
  useBorderCrossingStatus,
  infrastructureKeys,
} from './useInfrastructure';

// Seismic activity hooks (earthquakes from BIPAD)
export {
  useSeismicStats,
  useSeismicEvents,
  useSeismicMapData,
  seismicKeys,
} from './useSeismic';

// Twitter/X social feed hooks
export {
  useTweets,
  useTwitterStatus,
  useTwitterUsageStats,
  useSearchTweets,
  twitterKeys,
} from './useTwitter';
export type { Tweet, TweetListResponse, TwitterStatus, TwitterUsageStats } from './useTwitter';

// Elections hooks (v5 database-backed)
export {
  useElections,
  useElectionByYear,
  useNationalSummary,
  useConstituencies,
  useConstituencyDetail,
  useDistrictMapData,
  useConstituencyWatchlist,
  useAddToWatchlist,
  useRemoveFromWatchlist,
  useUpdateWatchlistAlertLevel,
  useSwingAnalysis,
  electionKeys,
} from './useElections';

// Energy / Power Grid hooks (NEA)
export {
  useEnergySummary,
  useRefreshEnergyData,
  energyKeys,
} from './useEnergy';

// Situation Briefs hooks (Analyst Agent)
export {
  useLatestBrief,
  useBriefById,
  useBriefHistory,
  useFakeNewsFlags,
  useProvinceSitrep,
  briefKeys,
} from './useBriefs';

// Situation Monitor hooks (cluster timeline + province anomalies)
export {
  useClusterTimeline,
  useDevelopingStories,
  useProvinceAnomalies,
  situationMonitorKeys,
} from './useSituationMonitor';

// Fact-check stub (no-op in skeleton)
export function useRequestFactCheck() {
  return {
    mutate: (_storyId: string, _options?: { onSuccess?: () => void; onError?: (err: unknown) => void }) => {
      _options?.onSuccess?.();
    },
    mutateAsync: async (_storyId: string) => {},
    isPending: false,
    isError: false,
    isSuccess: false,
  };
}

// Aviation monitoring hooks (ADS-B)
export {
  useLiveAircraft,
  useAirports,
  useAirportTraffic,
  useAircraftHistory,
  useHourlyCounts,
  useMilitaryStats,
  useTopAircraft,
  aviationKeys,
} from './useAviation';
