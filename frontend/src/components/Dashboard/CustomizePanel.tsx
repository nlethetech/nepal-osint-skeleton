import { useState } from 'react';
import { X, GripVertical, Sliders } from 'lucide-react';
import { useDashboardStore, WIDGET_META, PRESETS, WidgetSize, canAccessWidget, getWidgetDisplayName, isWidgetWIP } from '../../stores/dashboardStore';
import { useAuthStore } from '../../store/slices/authSlice';

const SIZES: WidgetSize[] = ['hero', 'brief', 'full', 'large', 'medium', 'small', 'mini'];

// Presets available for each role
// Election day: only show election monitor preset
const CONSUMER_PRESETS = ['news', 'elections'];
const ANALYST_PRESETS = ['news', 'elections', 'analyst'];

export function CustomizePanel() {
  const {
    customizePanelOpen,
    setCustomizePanelOpen,
    widgetOrder,
    widgetVisibility,
    widgetSizes,
    activePreset,
    toggleWidgetVisibility,
    setWidgetSize,
    applyPreset,
    setWidgetOrder,
  } = useDashboardStore();
  const { user } = useAuthStore();

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverItem, setDragOverItem] = useState<string | null>(null);

  if (!customizePanelOpen) return null;

  // Filter presets based on role
  const isConsumer = user?.role === 'consumer';
  const availablePresetIds = isConsumer ? CONSUMER_PRESETS : ANALYST_PRESETS;
  const availablePresets = availablePresetIds
    .map(id => PRESETS[id])
    .filter(Boolean);

  // Check if current config is "custom" (user has modified widgets)
  const isCustomConfig = activePreset === 'custom' || !Object.keys(PRESETS).includes(activePreset);

  // Get enabled widgets in order, then disabled ones
  // Filter by role - consumers only see consumer-accessible widgets
  const userRole = user?.role;
  const enabledWidgets = widgetOrder.filter(id =>
    widgetVisibility[id] && WIDGET_META[id] && canAccessWidget(id, userRole) && !isWidgetWIP(id)
  );
  const disabledWidgets = Object.keys(WIDGET_META).filter(id =>
    !widgetVisibility[id] && canAccessWidget(id, userRole) && !isWidgetWIP(id)
  );

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, widgetId: string) => {
    setDraggedItem(widgetId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', widgetId);
    // Add dragging class after a small delay to not affect the drag image
    setTimeout(() => {
      (e.target as HTMLElement).classList.add('dragging');
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setDraggedItem(null);
    setDragOverItem(null);
    (e.target as HTMLElement).classList.remove('dragging');
  };

  const handleDragOver = (e: React.DragEvent, widgetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedItem && draggedItem !== widgetId) {
      setDragOverItem(widgetId);
    }
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedItem || draggedItem === targetId) return;

    const currentOrder = [...widgetOrder];
    const draggedIndex = currentOrder.indexOf(draggedItem);
    const targetIndex = currentOrder.indexOf(targetId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // Remove dragged item and insert at target position
    currentOrder.splice(draggedIndex, 1);
    currentOrder.splice(targetIndex, 0, draggedItem);

    setWidgetOrder(currentOrder);
    useDashboardStore.setState({ activePreset: 'custom' });

    setDraggedItem(null);
    setDragOverItem(null);
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/70 z-[1000]"
        onClick={() => setCustomizePanelOpen(false)}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 w-full sm:w-[380px] h-screen bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] z-[1001] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)]">
          <span className="text-[13px] font-semibold">Customize Dashboard</span>
          <button
            onClick={() => setCustomizePanelOpen(false)}
            className="w-7 h-7 flex items-center justify-center border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Presets Section */}
          <div className="mb-5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 pb-2 border-b border-[var(--border-subtle)]">
              Quick Presets
            </div>
            <div className="grid grid-cols-2 gap-2">
              {availablePresets.map(preset => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset.id)}
                  className={`p-3 text-left border transition-all ${
                    activePreset === preset.id
                      ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.1)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  <div className="text-[12px] font-semibold text-[var(--text-primary)] mb-1">
                    {preset.name}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] leading-tight">
                    {preset.description}
                  </div>
                </button>
              ))}

              {/* Custom option for all users */}
              <button
                onClick={() => {
                  if (!isCustomConfig) {
                    useDashboardStore.setState({ activePreset: 'custom' });
                  }
                }}
                className={`p-3 text-left border transition-all ${
                  isCustomConfig
                    ? 'border-[var(--accent-primary)] bg-[rgba(59,130,246,0.1)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                }`}
              >
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)] mb-1">
                  <Sliders size={12} />
                  Custom
                </div>
                <div className="text-[10px] text-[var(--text-muted)] leading-tight">
                  Build your own layout
                </div>
              </button>
            </div>
          </div>

          {/* Widgets Section - Only show in Custom mode */}
          {isCustomConfig && (
            <div>
              {/* Enabled Widgets - Draggable */}
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 pb-2 border-b border-[var(--border-subtle)]">
                Active Widgets (drag to reorder)
              </div>
              <div className="flex flex-col gap-1 mb-4">
                {enabledWidgets.map((widgetId) => {
                  const meta = WIDGET_META[widgetId];
                  if (!meta) return null;

                  const isDragging = draggedItem === widgetId;
                  const isDragOver = dragOverItem === widgetId;

                  return (
                    <div
                      key={widgetId}
                      draggable
                      onDragStart={(e) => handleDragStart(e, widgetId)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, widgetId)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, widgetId)}
                      className={`flex items-center gap-2.5 p-2.5 border transition-all cursor-grab active:cursor-grabbing ${
                        isDragging
                          ? 'opacity-50 border-[var(--accent-primary)] bg-[var(--accent-primary)]/10'
                          : isDragOver
                          ? 'border-[var(--accent-primary)] border-dashed bg-[var(--accent-primary)]/5'
                          : 'bg-[var(--bg-elevated)] border-transparent hover:border-[var(--border-default)]'
                      }`}
                    >
                      <span className="text-[var(--text-muted)] cursor-grab hover:text-[var(--text-primary)]">
                        <GripVertical size={14} />
                      </span>
                      <div className="flex-1">
                        <span className="text-[12px] text-[var(--text-primary)]">
                          {getWidgetDisplayName(widgetId, userRole)}
                        </span>
                        {isWidgetWIP(widgetId) && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[8px] font-bold bg-amber-500/20 text-amber-400 rounded uppercase">
                            WIP
                          </span>
                        )}
                        <span className="ml-2 text-[9px] text-[var(--text-muted)] uppercase">
                          {meta.category}
                        </span>
                      </div>
                      <select
                        value={widgetSizes[widgetId] || 'medium'}
                        onChange={(e) => setWidgetSize(widgetId, e.target.value as WidgetSize)}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-[var(--bg-active)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] px-2 py-1 cursor-pointer focus:outline-none focus:border-[var(--accent-primary)]"
                      >
                        {SIZES.map(size => (
                          <option key={size} value={size}>{size}</option>
                        ))}
                      </select>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWidgetVisibility(widgetId);
                        }}
                        className="w-9 h-5 relative transition-colors bg-[var(--accent-primary)]"
                      >
                        <span className="absolute top-[3px] left-[19px] w-[14px] h-[14px] bg-white transition-all" />
                      </button>
                    </div>
                  );
                })}
                {enabledWidgets.length === 0 && (
                  <div className="text-center py-4 text-[var(--text-muted)] text-[11px]">
                    No widgets enabled. Toggle some below.
                  </div>
                )}
              </div>

              {/* Disabled Widgets */}
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-3 pb-2 border-b border-[var(--border-subtle)]">
                Available Widgets
              </div>
              <div className="flex flex-col gap-1">
                {disabledWidgets.map((widgetId) => {
                  const meta = WIDGET_META[widgetId];
                  if (!meta) return null;

                  return (
                    <div
                      key={widgetId}
                      className="flex items-center gap-2.5 p-2.5 border bg-[var(--bg-surface)] border-[var(--border-subtle)] opacity-60 hover:opacity-80 transition-all"
                    >
                      <span className="text-[var(--text-disabled)]">
                        <GripVertical size={14} />
                      </span>
                      <div className="flex-1">
                        <span className="text-[12px] text-[var(--text-primary)]">
                          {getWidgetDisplayName(widgetId, userRole)}
                        </span>
                        {isWidgetWIP(widgetId) && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[8px] font-bold bg-amber-500/20 text-amber-400 rounded uppercase">
                            WIP
                          </span>
                        )}
                        <span className="ml-2 text-[9px] text-[var(--text-muted)] uppercase">
                          {meta.category}
                        </span>
                      </div>
                      <select
                        value={widgetSizes[widgetId] || 'medium'}
                        onChange={(e) => setWidgetSize(widgetId, e.target.value as WidgetSize)}
                        disabled
                        className="bg-[var(--bg-active)] border border-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] px-2 py-1 opacity-50"
                      >
                        {SIZES.map(size => (
                          <option key={size} value={size}>{size}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => toggleWidgetVisibility(widgetId)}
                        className="w-9 h-5 relative transition-colors bg-[var(--bg-active)] hover:bg-[var(--bg-hover)]"
                      >
                        <span className="absolute top-[3px] left-[3px] w-[14px] h-[14px] bg-[var(--text-muted)] transition-all" />
                      </button>
                    </div>
                  );
                })}
                {disabledWidgets.length === 0 && (
                  <div className="text-center py-4 text-[var(--text-muted)] text-[11px]">
                    All widgets are active!
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Info for preset modes */}
          {!isCustomConfig && (
            <div className="text-center py-8 text-[var(--text-muted)]">
              <p className="text-[12px] mb-2">Using <span className="text-[var(--text-primary)] font-medium">{PRESETS[activePreset]?.name || activePreset}</span> layout</p>
              <p className="text-[10px]">Select "Custom" above to modify widgets and layout</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-[var(--bg-elevated)] border-t border-[var(--border-subtle)] flex gap-2">
          <button
            onClick={() => applyPreset(isConsumer ? 'news' : 'analyst')}
            className="flex-1 py-2.5 px-4 text-[12px] font-semibold border border-[var(--border-default)] bg-[var(--bg-active)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            Reset
          </button>
          <button
            onClick={() => setCustomizePanelOpen(false)}
            className="flex-1 py-2.5 px-4 text-[12px] font-semibold bg-[var(--accent-primary)] border-[var(--accent-primary)] text-white hover:bg-[var(--accent-hover)]"
          >
            Apply & Close
          </button>
        </div>
      </div>

      {/* Drag styles */}
      <style>{`
        .dragging {
          opacity: 0.5;
        }
      `}</style>
    </>
  );
}
