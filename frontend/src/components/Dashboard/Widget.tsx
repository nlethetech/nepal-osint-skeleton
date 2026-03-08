import { ReactNode, useEffect, useRef, useState } from 'react';
import { Expand, GripVertical, Minimize2, X } from 'lucide-react';
import { useDashboardStore, WIDGET_META, isWidgetWIP } from '../../stores/dashboardStore';

interface WidgetProps {
  id: string;
  title?: string;  // Optional title override
  icon?: ReactNode;
  badge?: string | number;
  badgeVariant?: 'default' | 'critical' | 'high';
  actions?: ReactNode;
  children: ReactNode;
}

export function Widget({ id, title, icon, badge, badgeVariant = 'default', actions, children }: WidgetProps) {
  const { widgetOrder, widgetSizes, widgetVisibility, toggleWidgetVisibility, setWidgetOrder } = useDashboardStore();
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const draggedWidgetIdRef = useRef<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const size = widgetSizes[id] || 'small';
  const meta = WIDGET_META[id];

  if (!widgetVisibility[id]) {
    return null;
  }

  const sizeClass = `widget-${size}`;
  const displayTitle = title || meta?.name || id;

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === widgetRef.current);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleDragStart = (event: React.DragEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select, .widget-actions')) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/widget-id', id);
    event.dataTransfer.setData('text/plain', id);
    draggedWidgetIdRef.current = id;
    setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const draggedId =
      event.dataTransfer.getData('text/widget-id') ||
      event.dataTransfer.getData('text/plain') ||
      draggedWidgetIdRef.current;
    if (!draggedId || draggedId === id) return;
    event.preventDefault();
    setIsDragOver(true);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const draggedId =
      event.dataTransfer.getData('text/widget-id') ||
      event.dataTransfer.getData('text/plain') ||
      draggedWidgetIdRef.current;
    if (!draggedId || draggedId === id) return;

    const fromIndex = widgetOrder.indexOf(draggedId);
    const toIndex = widgetOrder.indexOf(id);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;

    const newOrder = [...widgetOrder];
    const [moved] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, moved);
    setWidgetOrder(newOrder);
    draggedWidgetIdRef.current = null;
  };

  const handleDragEnd = () => {
    setIsDragging(false);
    setIsDragOver(false);
    draggedWidgetIdRef.current = null;
  };

  const toggleFullscreen = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const node = widgetRef.current;
    if (!node) return;

    try {
      if (document.fullscreenElement === node) {
        await document.exitFullscreen();
        return;
      }
      if (!document.fullscreenElement) {
        await node.requestFullscreen();
        return;
      }
      await document.exitFullscreen();
      await node.requestFullscreen();
    } catch (error) {
      console.error('Fullscreen toggle failed', error);
    }
  };

  return (
    <div
      ref={widgetRef}
      className={`widget ${sizeClass} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drop-target' : ''}`}
      data-widget-id={id}
      onDragOver={handleDragOver}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      <div
        className="widget-header"
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <span
          className="widget-drag-handle"
          title="Drag to reorder"
        >
          <GripVertical size={12} />
        </span>
        <span className="widget-title">
          {icon}
          {displayTitle}
          {isWidgetWIP(id) && (
            <span className="ml-1.5 px-1.5 py-0.5 text-[8px] font-bold bg-amber-500/20 text-amber-400 rounded uppercase tracking-wide">
              WIP
            </span>
          )}
          {badge && (
            <span className={`widget-badge ${badgeVariant}`}>
              {badge}
            </span>
          )}
        </span>
        {actions && <div className="widget-actions">{actions}</div>}
        <button
          className="widget-fullscreen"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'View fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Expand size={12} />}
        </button>
        <button
          className="widget-close"
          onClick={(event) => {
            event.stopPropagation();
            toggleWidgetVisibility(id);
          }}
        >
          <X size={12} />
        </button>
      </div>
      <div className="widget-body">
        {children}
      </div>
    </div>
  );
}
