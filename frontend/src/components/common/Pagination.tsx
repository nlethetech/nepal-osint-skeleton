import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  showPageNumbers?: boolean
  showFirstLast?: boolean
  compact?: boolean
}

// Generate page numbers with ellipsis
function generatePageNumbers(currentPage: number, totalPages: number): (number | '...')[] {
  const pages: (number | '...')[] = []

  if (totalPages <= 7) {
    // Show all pages if 7 or fewer
    for (let i = 1; i <= totalPages; i++) {
      pages.push(i)
    }
  } else {
    // Always show first page
    pages.push(1)

    if (currentPage > 3) {
      pages.push('...')
    }

    // Pages around current
    const start = Math.max(2, currentPage - 1)
    const end = Math.min(totalPages - 1, currentPage + 1)

    for (let i = start; i <= end; i++) {
      pages.push(i)
    }

    if (currentPage < totalPages - 2) {
      pages.push('...')
    }

    // Always show last page
    if (totalPages > 1) {
      pages.push(totalPages)
    }
  }

  return pages
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  showPageNumbers = true,
  showFirstLast = false,
  compact = false,
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize)
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, total)

  const canGoPrev = page > 1
  const canGoNext = page < totalPages

  const pageNumbers = generatePageNumbers(page, totalPages)

  // Compact version (for small spaces)
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrev}
          className="btn btn-ghost btn-xs"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs text-osint-muted tabular-nums">
          {page}/{totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
          className="btn btn-ghost btn-xs"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-osint-border bg-osint-card/50">
      {/* Left side: Item count and page size selector */}
      <div className="flex items-center gap-4">
        <span className="text-sm text-osint-muted">
          <span className="text-osint-text font-medium tabular-nums">{startItem}-{endItem}</span>
          {' of '}
          <span className="text-osint-text font-medium tabular-nums">{total.toLocaleString()}</span>
        </span>

        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="select input-sm w-auto"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Right side: Navigation */}
      <div className="flex items-center gap-1">
        {/* First page button */}
        {showFirstLast && (
          <button
            onClick={() => onPageChange(1)}
            disabled={!canGoPrev}
            className="btn btn-ghost btn-sm"
            aria-label="First page"
          >
            <ChevronsLeft size={16} />
          </button>
        )}

        {/* Previous button */}
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrev}
          className="btn btn-ghost btn-sm"
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>

        {/* Page numbers */}
        {showPageNumbers && totalPages > 0 && (
          <div className="flex items-center gap-1 mx-1">
            {pageNumbers.map((p, idx) =>
              p === '...' ? (
                <span key={`ellipsis-${idx}`} className="px-2 text-osint-muted">
                  ...
                </span>
              ) : (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`
                    btn btn-sm min-w-[32px] tabular-nums
                    ${p === page
                      ? 'btn-primary'
                      : 'btn-ghost'
                    }
                  `}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? 'page' : undefined}
                >
                  {p}
                </button>
              )
            )}
          </div>
        )}

        {/* Simple page indicator when page numbers hidden */}
        {!showPageNumbers && (
          <span className="px-3 text-sm text-osint-text tabular-nums">
            {page} / {totalPages}
          </span>
        )}

        {/* Next button */}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext}
          className="btn btn-ghost btn-sm"
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>

        {/* Last page button */}
        {showFirstLast && (
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={!canGoNext}
            className="btn btn-ghost btn-sm"
            aria-label="Last page"
          >
            <ChevronsRight size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

// Simplified pagination for smaller components
export function SimplePagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="btn btn-ghost btn-sm"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm text-osint-muted tabular-nums min-w-[60px] text-center">
        {page} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="btn btn-ghost btn-sm"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}
