import { useCallback, useRef, useState } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore';
import {
  clampWidgetDimensions,
  dimensionsFromSize,
  findNearestPreset,
  type WidgetDimensions,
} from './widgetGrid';

type Edge = 'right' | 'bottom' | 'corner' | 'left' | 'top' | 'top-left';

export function useWidgetResize(widgetId: string) {
  const setWidgetDimensions = useDashboardStore((s) => s.setWidgetDimensions);
  const widgetSizes = useDashboardStore((s) => s.widgetSizes);
  const widgetDimensions = useDashboardStore((s) => s.widgetDimensions);
  const [resizePreview, setResizePreview] = useState<WidgetDimensions | null>(null);

  const dragState = useRef<{
    edge: Edge;
    startX: number;
    startY: number;
    startCols: number;
    startRows: number;
    colWidth: number;
    rowHeight: number;
  } | null>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const state = dragState.current;
    if (!state) return;

    const deltaX = e.clientX - state.startX;
    const deltaY = e.clientY - state.startY;

    let targetCols = state.startCols;
    let targetRows = state.startRows;

    if (state.edge === 'right' || state.edge === 'corner') {
      targetCols = state.startCols + Math.round(deltaX / state.colWidth);
    }
    if (state.edge === 'left' || state.edge === 'top-left') {
      targetCols = state.startCols - Math.round(deltaX / state.colWidth);
    }
    if (state.edge === 'bottom' || state.edge === 'corner') {
      targetRows = state.startRows + Math.round(deltaY / state.rowHeight);
    }
    if (state.edge === 'top' || state.edge === 'top-left') {
      targetRows = state.startRows - Math.round(deltaY / state.rowHeight);
    }

    setResizePreview(clampWidgetDimensions({ cols: targetCols, rows: targetRows }));
  }, []);

  const handleMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.body.classList.remove('widget-resizing');

    const state = dragState.current;
    if (!state) return;

    setResizePreview((prev) => {
      if (prev) {
        setWidgetDimensions(widgetId, prev);
      }
      return null;
    });

    dragState.current = null;
  }, [widgetId, setWidgetDimensions, handleMouseMove]);

  const handleResizeStart = useCallback((edge: Edge, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const widgetEl = (e.target as HTMLElement).closest('.widget') as HTMLElement;
    if (!widgetEl) return;

    const gridEl = widgetEl.closest('.widget-grid') as HTMLElement;
    if (!gridEl) return;

    const gridRect = gridEl.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(gridEl).gap) || 6;
    const colWidth = (gridRect.width - 11 * gap) / 12;
    const rowHeight = 60; // base row height from minmax(60px, auto)

    const currentSize = widgetSizes[widgetId] || 'small';
    const currentDimensions = widgetDimensions[widgetId] || dimensionsFromSize(currentSize);
    const { cols, rows } = currentDimensions;

    dragState.current = {
      edge,
      startX: e.clientX,
      startY: e.clientY,
      startCols: cols,
      startRows: rows,
      colWidth,
      rowHeight,
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor =
      edge === 'left' || edge === 'right'
        ? 'ew-resize'
        : edge === 'top' || edge === 'bottom'
          ? 'ns-resize'
          : 'nwse-resize';
    document.body.classList.add('widget-resizing');
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [widgetId, widgetSizes, widgetDimensions, handleMouseMove, handleMouseUp]);

  const resizePreviewLabel = resizePreview
    ? `${resizePreview.cols}×${resizePreview.rows} · ${findNearestPreset(resizePreview.cols, resizePreview.rows)}`
    : null;

  return {
    handleResizeStart,
    resizePreview,
    resizePreviewLabel,
  };
}
