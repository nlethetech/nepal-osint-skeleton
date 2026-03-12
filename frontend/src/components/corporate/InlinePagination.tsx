import { Button, HTMLSelect } from '@blueprintjs/core';

interface InlinePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

export function InlinePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50],
  className = '',
}: InlinePaginationProps) {
  if (total <= 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-1 py-2 ${className}`}>
      <span className="text-xs text-bp-text-secondary">
        Showing {startItem}-{endItem} of {total}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <HTMLSelect
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.currentTarget.value))}
            minimal
            options={pageSizeOptions.map((size) => ({
              label: `${size} / page`,
              value: size,
            }))}
          />
        )}
        <Button
          icon="chevron-left"
          minimal
          small
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          aria-label="Previous page"
        />
        <span className="w-16 text-center text-xs text-bp-text-secondary">
          {currentPage} / {totalPages}
        </span>
        <Button
          icon="chevron-right"
          minimal
          small
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          aria-label="Next page"
        />
      </div>
    </div>
  );
}
