/**
 * ThreePanelView - Display Pre/Post/PWTT satellite comparison
 *
 * Shows three panels side by side:
 * - Pre Destruction (before event RGB)
 * - Post Destruction (after event RGB)
 * - PWTT Damage Heatmap (t-statistic visualization)
 */

import { useState, useEffect } from 'react';
import { Download, AlertTriangle, Maximize2, X, ExternalLink } from 'lucide-react';
import { Button, Intent, Spinner } from '@blueprintjs/core';
import { fetchThreePanelImage } from '../../api/damageAssessment';

interface ThreePanelViewProps {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  eventDate: string;
  baselineDays?: number;
  postEventDays?: number;
  beforeTileUrl?: string;
  afterTileUrl?: string;
  pwttTileUrl?: string;
  bbox?: [number, number, number, number];
}

export function ThreePanelView({
  centerLat,
  centerLng,
  radiusKm,
  eventDate,
  baselineDays = 365,
  postEventDays = 60,
  beforeTileUrl,
  afterTileUrl,
  pwttTileUrl,
  bbox,
}: ThreePanelViewProps) {
  const [viewMode, setViewMode] = useState<'tiles' | 'static'>('tiles');
  const [staticImageUrl, setStaticImageUrl] = useState<string | null>(null);
  const [staticImageBlob, setStaticImageBlob] = useState<Blob | null>(null);
  const [isLoadingStatic, setIsLoadingStatic] = useState(false);
  const [staticError, setStaticError] = useState<string | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);

  // Fetch static image with proper authentication
  const handleGenerateStatic = async () => {
    setIsLoadingStatic(true);
    setStaticError(null);

    try {
      const blob = await fetchThreePanelImage({
        center_lat: centerLat,
        center_lng: centerLng,
        radius_km: radiusKm,
        event_date: eventDate,
        baseline_days: baselineDays,
        post_event_days: postEventDays,
      });

      // Create object URL from blob for display
      const objectUrl = URL.createObjectURL(blob);
      setStaticImageUrl(objectUrl);
      setStaticImageBlob(blob);
      setViewMode('static');
    } catch (err) {
      console.error('Failed to fetch three-panel image:', err);
      setStaticError(err instanceof Error ? err.message : 'Failed to generate image. Make sure you are logged in.');
    } finally {
      setIsLoadingStatic(false);
    }
  };

  // Clean up object URL when component unmounts
  useEffect(() => {
    return () => {
      if (staticImageUrl) {
        URL.revokeObjectURL(staticImageUrl);
      }
    };
  }, [staticImageUrl]);

  // Handle ESC key to close fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullScreen) {
        setIsFullScreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullScreen]);

  // Download the static image
  const handleDownload = () => {
    if (staticImageBlob) {
      const url = URL.createObjectURL(staticImageBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `pwtt-three-panel-${eventDate}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  // Construct static tile image URLs from dynamic tile URLs
  // This extracts the base URL for displaying as static images
  const getTileSnapshot = (tileUrl: string | undefined, label: string) => {
    if (!tileUrl) {
      return (
        <div className="w-full h-full flex items-center justify-center text-xs bg-bp-surface text-bp-text-muted">
          No {label} Available
        </div>
      );
    }

    // For tile URLs, we'll show a placeholder indicating it's a dynamic layer
    // The actual rendering happens on the map
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-xs gap-2 bg-bp-surface text-bp-text-muted">
        <ExternalLink size={16} />
        <span>View on Map</span>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            minimal
            active={viewMode === 'tiles'}
            text="Tile View"
            onClick={() => setViewMode('tiles')}
            className={`text-xs ${viewMode === 'tiles' ? 'text-bp-text' : 'text-bp-text-muted'}`}
          />
          <Button
            minimal
            active={viewMode === 'static'}
            text="Static Image"
            onClick={handleGenerateStatic}
            loading={isLoadingStatic}
            className={`text-xs ${viewMode === 'static' ? 'text-bp-text' : 'text-bp-text-muted'}`}
          />
        </div>

        {viewMode === 'static' && staticImageUrl && (
          <div className="flex gap-2">
            <Button
              intent={Intent.PRIMARY}
              icon={<Maximize2 size={12} />}
              text="Full Screen"
              onClick={() => setIsFullScreen(true)}
              className="text-xs"
            />
            <Button
              minimal
              icon={<Download size={12} />}
              text="Download"
              onClick={handleDownload}
              className="text-xs text-bp-text-muted"
            />
          </div>
        )}
      </div>

      {/* Error Display */}
      {staticError && (
        <div className="p-2 bg-severity-critical/10 border border-severity-critical/30 rounded-lg text-xs text-severity-critical flex items-center gap-2">
          <AlertTriangle size={14} />
          {staticError}
        </div>
      )}

      {/* Panel Display */}
      {viewMode === 'tiles' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {/* Pre Destruction */}
            <div className="relative aspect-square rounded-lg overflow-hidden bg-bp-bg">
              <div className={`w-full h-full flex items-center justify-center text-xs ${beforeTileUrl ? 'text-bp-success' : 'text-bp-text-muted'}`}>
                <div className="text-center">
                  <div className={`w-8 h-8 rounded-full ${beforeTileUrl ? 'bg-bp-success/20' : 'bg-bp-hover'} flex items-center justify-center mx-auto mb-2`}>
                    <div className={`w-3 h-3 rounded-full ${beforeTileUrl ? 'bg-bp-success' : 'bg-bp-border'}`} />
                  </div>
                  <span>{beforeTileUrl ? 'Layer Ready' : 'No Data'}</span>
                </div>
              </div>
              <span className="absolute bottom-1 left-1 px-2 py-0.5 bg-bp-bg/80 text-[10px] rounded text-bp-text">
                Pre Destruction
              </span>
            </div>

            {/* Post Destruction */}
            <div className="relative aspect-square rounded-lg overflow-hidden bg-bp-bg">
              <div className={`w-full h-full flex items-center justify-center text-xs ${afterTileUrl ? 'text-severity-high' : 'text-bp-text-muted'}`}>
                <div className="text-center">
                  <div className={`w-8 h-8 rounded-full ${afterTileUrl ? 'bg-severity-high/20' : 'bg-bp-hover'} flex items-center justify-center mx-auto mb-2`}>
                    <div className={`w-3 h-3 rounded-full ${afterTileUrl ? 'bg-severity-high' : 'bg-bp-border'}`} />
                  </div>
                  <span>{afterTileUrl ? 'Layer Ready' : 'No Data'}</span>
                </div>
              </div>
              <span className="absolute bottom-1 left-1 px-2 py-0.5 bg-bp-bg/80 text-[10px] rounded text-bp-text">
                Post Destruction
              </span>
            </div>

            {/* PWTT Heatmap */}
            <div className="relative aspect-square rounded-lg overflow-hidden bg-bp-bg">
              <div className={`w-full h-full flex items-center justify-center text-xs ${pwttTileUrl ? 'text-severity-critical' : 'text-bp-text-muted'}`}>
                <div className="text-center">
                  <div className={`w-8 h-8 rounded-full ${pwttTileUrl ? 'bg-severity-critical/20' : 'bg-bp-hover'} flex items-center justify-center mx-auto mb-2`}>
                    <div className={`w-3 h-3 rounded-full ${pwttTileUrl ? 'bg-severity-critical' : 'bg-bp-border'}`} />
                  </div>
                  <span>{pwttTileUrl ? 'Layer Ready' : 'No Data'}</span>
                </div>
              </div>
              <span className="absolute bottom-1 left-1 px-2 py-0.5 bg-bp-bg/80 text-[10px] rounded text-bp-text">
                PWTT Damage
              </span>
            </div>
          </div>
          <p className="text-[10px] text-center text-bp-text-muted">
            Tile layers are visible on the map. Click "Static Image" for a downloadable comparison view.
          </p>
        </div>
      ) : (
        /* Static Image View */
        <div className="relative aspect-[3/1] rounded-lg overflow-hidden bg-bp-bg">
          {isLoadingStatic ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner size={20} />
            </div>
          ) : staticImageUrl ? (
            <img
              src={staticImageUrl}
              alt="Three-panel PWTT visualization"
              className="w-full h-full object-contain"
              onError={() => setStaticError('Failed to load image')}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-bp-text-muted">
              Click "Static Image" to generate
            </div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-bp-text-muted">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-severity-medium" />
          <span>Moderate</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-severity-high" />
          <span>Severe</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-severity-critical" />
          <span>Critical</span>
        </div>
      </div>

      {/* Full Screen Modal */}
      {isFullScreen && staticImageUrl && (
        <div
          className="fixed inset-0 z-50 bg-bp-bg/95 flex items-center justify-center p-4"
          onClick={() => setIsFullScreen(false)}
        >
          {/* Close button */}
          <button
            onClick={() => setIsFullScreen(false)}
            className="absolute top-4 right-4 p-2 hover:bg-bp-hover rounded-full transition-colors bg-bp-surface"
          >
            <X size={24} className="text-bp-text" />
          </button>

          {/* Download button in fullscreen */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDownload();
            }}
            className="absolute top-4 left-4 px-4 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm bg-bp-primary text-bp-text hover:bg-bp-primary-hover"
          >
            <Download size={16} />
            Download PNG
          </button>

          {/* Image container */}
          <div
            className="max-w-[95vw] max-h-[90vh] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={staticImageUrl}
              alt="Three-panel PWTT visualization - Full Screen"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />

            {/* Info bar */}
            <div className="absolute bottom-0 left-0 right-0 bg-bp-bg/80 backdrop-blur-sm p-3 rounded-b-lg">
              <div className="flex items-center justify-between text-sm text-bp-text">
                <div className="flex items-center gap-4 text-bp-text-muted">
                  <span>PWTT Building-Level Damage Analysis</span>
                  <span>|</span>
                  <span>Event: {eventDate}</span>
                  <span>|</span>
                  <span>Radius: {radiusKm} km</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-severity-medium" />
                    <span>Moderate (T&gt;3)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-severity-high" />
                    <span>Severe (T&gt;4.5)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-3 h-3 rounded bg-severity-critical" />
                    <span>Critical (T&gt;6)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs text-bp-text-muted">
            Click anywhere or press ESC to close
          </div>
        </div>
      )}
    </div>
  );
}
