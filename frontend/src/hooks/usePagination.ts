import { useState, useCallback } from 'react'

interface UsePaginationOptions {
  initialPage?: number
  initialPageSize?: number
}

interface UsePaginationReturn {
  page: number
  pageSize: number
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  reset: () => void
  offset: number
}

export function usePagination({
  initialPage = 1,
  initialPageSize = 20,
}: UsePaginationOptions = {}): UsePaginationReturn {
  const [page, setPage] = useState(initialPage)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const handleSetPageSize = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1) // Reset to first page when page size changes
  }, [])

  const reset = useCallback(() => {
    setPage(initialPage)
    setPageSize(initialPageSize)
  }, [initialPage, initialPageSize])

  const offset = (page - 1) * pageSize

  return {
    page,
    pageSize,
    setPage,
    setPageSize: handleSetPageSize,
    reset,
    offset,
  }
}
