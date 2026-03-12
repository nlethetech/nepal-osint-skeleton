import { Shield, Vote, CloudLightning, Banknote, Users } from 'lucide-react'
import type { ThreatMatrixCell } from '../../api/analytics'

interface CategoryMatrixProps {
  cells: ThreatMatrixCell[]
  selectedCategories: string[]
  onCategoryClick: (category: string) => void
}

const CATEGORY_ICONS: Record<string, typeof Shield> = {
  security: Shield,
  political: Vote,
  disaster: CloudLightning,
  economic: Banknote,
  social: Users,
}

const LEVEL_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  elevated: 'bg-orange-500',
  guarded: 'bg-yellow-500',
  low: 'bg-green-500',
}

const LEVEL_BAR_WIDTH: Record<string, string> = {
  critical: 'w-full',
  elevated: 'w-3/4',
  guarded: 'w-1/2',
  low: 'w-1/4',
}

function CategoryCard({
  cell,
  isSelected,
  onClick,
}: {
  cell: ThreatMatrixCell
  isSelected: boolean
  onClick: () => void
}) {
  const Icon = CATEGORY_ICONS[cell.category.toLowerCase()] || Users
  const level = (cell.level || 'low').toLowerCase()

  return (
    <button
      onClick={onClick}
      className={`
        w-full text-left p-3 border-b border-[var(--pro-border-subtle)] transition-colors
        ${isSelected ? 'bg-[var(--pro-accent-muted)] border-l-2 border-l-[var(--pro-accent)]' : 'hover:bg-[var(--pro-bg-hover)]'}
      `}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className="text-[var(--pro-text-muted)]" />
        <span className="text-xs font-semibold text-[var(--pro-text-primary)] uppercase">
          {cell.category}
        </span>
        <span className="ml-auto text-[10px] text-[var(--pro-text-muted)]">
          {cell.event_count} events
        </span>
      </div>

      {/* Severity Bar */}
      <div className="h-1.5 bg-[var(--pro-bg-elevated)] rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full ${LEVEL_COLORS[level]} ${LEVEL_BAR_WIDTH[level]} transition-all`}
        />
      </div>

      {/* Severity Breakdown */}
      {cell.severity_breakdown && (
        <div className="flex items-center gap-2 text-[10px]">
          {cell.severity_breakdown.critical > 0 && (
            <span className="text-red-400">{cell.severity_breakdown.critical} crit</span>
          )}
          {cell.severity_breakdown.high > 0 && (
            <span className="text-orange-400">{cell.severity_breakdown.high} high</span>
          )}
          {cell.severity_breakdown.medium > 0 && (
            <span className="text-yellow-400">{cell.severity_breakdown.medium} med</span>
          )}
          {cell.severity_breakdown.low > 0 && (
            <span className="text-green-400">{cell.severity_breakdown.low} low</span>
          )}
        </div>
      )}
    </button>
  )
}

export function CategoryMatrix({ cells, selectedCategories, onCategoryClick }: CategoryMatrixProps) {
  // Sort by event count descending
  const sortedCells = [...cells].sort((a, b) => (b.event_count || 0) - (a.event_count || 0))

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--pro-border-subtle)]">
        <h2 className="text-[10px] font-semibold text-[var(--pro-text-muted)] uppercase tracking-wide">
          Categories
        </h2>
      </div>

      {/* Category List */}
      {sortedCells.length === 0 ? (
        <div className="p-4 text-center text-xs text-[var(--pro-text-muted)]">
          No category data
        </div>
      ) : (
        sortedCells.map((cell) => (
          <CategoryCard
            key={cell.category}
            cell={cell}
            isSelected={selectedCategories.includes(cell.category.toLowerCase())}
            onClick={() => onCategoryClick(cell.category.toLowerCase())}
          />
        ))
      )}
    </div>
  )
}
