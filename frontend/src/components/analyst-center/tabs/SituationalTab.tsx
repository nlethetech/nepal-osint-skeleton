import { useMemo, useState, useEffect } from 'react'
import { Target } from 'lucide-react'
import { useAnalystCenterStore } from '../../../stores/analystCenterStore'
import { useSettingsStore, getDistrictsForProvinces } from '../../../store/slices/settingsSlice'
import { ProvinceFilter } from '../../settings/ProvinceFilter'
import { CategoryMatrix } from '../CategoryMatrix'
import { ActivityTimeline } from '../ActivityTimeline'
import { StoryFeed } from '../StoryFeed'
import { KeyActorsPanel } from '../KeyActorsPanel'
import { DistrictHotspots } from '../DistrictHotspots'
import { QuickHotspotChecker } from '../../damage-assessment/QuickHotspotChecker'

function LeftPanel() {
  const { categoryMatrix, hourlyTrends, stories, filters, setFilters } = useAnalystCenterStore()

  // Compute category stats from stories if API matrix is empty
  const computedCategories = useMemo(() => {
    if (categoryMatrix.length > 0) return categoryMatrix

    const categoryStats: Record<
      string,
      { count: number; critical: number; high: number; medium: number; low: number }
    > = {}

    stories.forEach((story) => {
      const cat = (story.story_type || 'social').toLowerCase()
      const sev = (story.severity || 'medium').toLowerCase()

      if (!categoryStats[cat]) {
        categoryStats[cat] = { count: 0, critical: 0, high: 0, medium: 0, low: 0 }
      }
      categoryStats[cat].count++
      if (sev === 'critical') categoryStats[cat].critical++
      else if (sev === 'high') categoryStats[cat].high++
      else if (sev === 'medium') categoryStats[cat].medium++
      else categoryStats[cat].low++
    })

    return Object.entries(categoryStats).map(([category, stats]) => ({
      category: category.charAt(0).toUpperCase() + category.slice(1),
      level: (stats.critical > 0
        ? 'critical'
        : stats.high > 0
          ? 'elevated'
          : stats.medium > 0
            ? 'guarded'
            : 'low') as 'critical' | 'elevated' | 'guarded' | 'low',
      trend: 'stable' as const,
      event_count: stats.count,
      severity_breakdown: {
        critical: stats.critical,
        high: stats.high,
        medium: stats.medium,
        low: stats.low,
      },
    }))
  }, [categoryMatrix, stories])

  // Compute hourly trends from stories - fix date handling
  const computedTrends = useMemo(() => {
    if (hourlyTrends.length > 0) return hourlyTrends

    const hourStats: { hour: string; count: number; label: string }[] = []
    const now = new Date()

    // Initialize last 12 hours
    for (let i = 11; i >= 0; i--) {
      const hour = new Date(now.getTime() - i * 60 * 60 * 1000)
      const key = hour.toISOString().slice(0, 13)
      const label = hour.getHours().toString().padStart(2, '0') + ':00'
      hourStats.push({ hour: key, count: 0, label })
    }

    stories.forEach((story) => {
      if (story.first_reported_at) {
        const storyHour = story.first_reported_at.slice(0, 13)
        const stat = hourStats.find((h) => h.hour === storyHour)
        if (stat) stat.count++
      }
    })

    return hourStats
  }, [hourlyTrends, stories])

  const handleCategoryClick = (category: string) => {
    const current = filters.categories
    if (current.includes(category)) {
      setFilters({ categories: current.filter((c) => c !== category) })
    } else {
      setFilters({ categories: [category] })
    }
  }

  const handleHourClick = (hour: string) => {
    console.log('Hour clicked:', hour)
  }

  return (
    <div className="flex flex-col h-full">
      <CategoryMatrix
        cells={computedCategories}
        selectedCategories={filters.categories}
        onCategoryClick={handleCategoryClick}
      />
      <div className="mt-auto">
        <ActivityTimeline data={computedTrends} onHourClick={handleHourClick} />
      </div>
    </div>
  )
}

function CenterPanel() {
  const { stories, selectedStoryId, selectStory, isLoading, currentPage, pageSize, totalStories, setPage } =
    useAnalystCenterStore()

  return (
    <StoryFeed
      stories={stories}
      selectedStoryId={selectedStoryId}
      onSelectStory={selectStory}
      isLoading={isLoading}
      currentPage={currentPage}
      pageSize={pageSize}
      totalStories={totalStories}
      onPageChange={setPage}
    />
  )
}

function RightPanel() {
  const { keyActors, stories, filters, setFilters } = useAnalystCenterStore()

  // Compute district stats from stories
  const districtStats = useMemo(() => {
    const stats: Record<string, { count: number; critical: number; high: number }> = {}

    stories.forEach((story) => {
      const districts = story.districts_affected || []
      const sev = (story.severity || 'medium').toLowerCase()

      districts.forEach((district) => {
        if (!stats[district]) {
          stats[district] = { count: 0, critical: 0, high: 0 }
        }
        stats[district].count++
        if (sev === 'critical') stats[district].critical++
        if (sev === 'high') stats[district].high++
      })
    })

    return Object.entries(stats)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [stories])

  const handleActorClick = (id: string) => {
    console.log('Actor clicked:', id)
  }

  const handleDistrictClick = (district: string) => {
    const current = filters.districts
    if (current.includes(district)) {
      setFilters({ districts: current.filter((d) => d !== district) })
    } else {
      setFilters({ districts: [district] })
    }
  }

  return (
    <div className="flex flex-col h-full">
      <KeyActorsPanel actors={keyActors} onActorClick={handleActorClick} />
      <div className="mt-auto border-t border-[var(--pro-border-subtle)]">
        <DistrictHotspots
          districts={districtStats}
          selectedDistricts={filters.districts}
          onDistrictClick={handleDistrictClick}
        />
      </div>
    </div>
  )
}

export function SituationalTab() {
  const [showHotspotChecker, setShowHotspotChecker] = useState(false)

  // Province filter integration
  const { selectedProvinces, isProvinceFilterEnabled } = useSettingsStore()
  const { setFilters, filters } = useAnalystCenterStore()

  // Compute selected districts from provinces
  const selectedDistricts = useMemo(() => {
    if (!isProvinceFilterEnabled || selectedProvinces.length === 7) return []
    return getDistrictsForProvinces(selectedProvinces)
  }, [selectedProvinces, isProvinceFilterEnabled])

  // Sync province filter with analyst center store when provinces change
  useEffect(() => {
    // Only update if the districts actually changed to avoid infinite loops
    const currentDistricts = filters.districts
    const districtsChanged =
      selectedDistricts.length !== currentDistricts.length ||
      !selectedDistricts.every((d) => currentDistricts.includes(d))

    if (districtsChanged) {
      setFilters({ districts: selectedDistricts })
    }
  }, [selectedDistricts, filters.districts, setFilters])

  return (
    <div className="flex flex-col flex-1 h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--pro-border-subtle)] bg-[var(--pro-bg-secondary)]">
        <div className="text-sm font-medium text-[var(--pro-text-secondary)]">
          Situational Awareness
        </div>
        <div className="flex items-center gap-2">
          <ProvinceFilter />
          <button
            onClick={() => setShowHotspotChecker(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Target size={14} />
            Quick Damage Check
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Left Panel */}
        <div className="w-56 flex-shrink-0 border-r border-[var(--pro-border-subtle)] overflow-y-auto">
          <LeftPanel />
        </div>

        {/* Center Panel */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <CenterPanel />
        </div>

        {/* Right Panel */}
        <div className="w-64 flex-shrink-0 border-l border-[var(--pro-border-subtle)] overflow-y-auto">
          <RightPanel />
        </div>
      </div>

      {/* Quick Hotspot Checker Modal */}
      {showHotspotChecker && (
        <QuickHotspotChecker onClose={() => setShowHotspotChecker(false)} />
      )}
    </div>
  )
}
