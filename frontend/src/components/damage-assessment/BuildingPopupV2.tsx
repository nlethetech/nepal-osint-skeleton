/**
 * BuildingPopupV2 — Enhanced popup content for v2 buildings.
 *
 * Shows confidence bar, size class, VV/VH polarization, optical badges,
 * baseline CV, and temporal persistence.
 */

import type { BuildingDamageFeatureV2 } from '../../api/damageAssessmentV2';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#fde725',
  severe: '#6ece58',
  moderate: '#26828e',
  undamaged: '#440154',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'CRITICAL',
  severe: 'SEVERE',
  moderate: 'MODERATE',
  undamaged: 'UNDAMAGED',
};

/**
 * Generate HTML string for a v2 building popup (used with Leaflet bindPopup).
 */
export function buildingPopupV2Html(feature: BuildingDamageFeatureV2): string {
  const p = feature.properties;
  const sevColor = SEVERITY_COLORS[p.severity] || '#6b7280';
  const sevLabel = SEVERITY_LABELS[p.severity] || p.severity.toUpperCase();
  const confidencePct = Math.round(p.confidence * 100);
  const confidenceBarWidth = Math.min(confidencePct, 100);

  // Size class label
  const sizeLabel = p.size_class === 'sub_pixel' ? 'Sub-pixel' : p.size_class.charAt(0).toUpperCase() + p.size_class.slice(1);

  // Primary stat based on size class
  const primaryKey = p.size_class === 'large' ? 'mean' : p.size_class === 'medium' ? 'p90' : 'max';
  const primaryValue = primaryKey === 'mean' ? p.mean_t_stat : primaryKey === 'p90' ? p.p90_t_stat : p.max_t_stat;

  // Optical badges
  const ndviOk = p.dndvi !== null && p.dndvi < -0.1;
  const ndbiOk = p.dndbi !== null && p.dndbi > 0.05;
  const nbrOk = p.dnbr !== null && p.dnbr < -0.1;
  const opticalTotal = (p.dndvi !== null ? 1 : 0) + (p.dndbi !== null ? 1 : 0) + (p.dnbr !== null ? 1 : 0);

  // CV label
  const cvLabel = p.pre_cv < 0.15 ? 'stable' : p.pre_cv < 0.3 ? 'moderate' : 'noisy';

  // Temporal
  const temporalLabel = p.temporal_persistence !== null
    ? `${Math.round(p.temporal_persistence * 100)}% persistent`
    : 'N/A';

  return `
    <div style="font-family: system-ui, -apple-system, sans-serif; font-size: 12px; min-width: 220px; max-width: 280px; color: #1a1a1a;">
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 13px;">Building Damage</span>
        <span style="padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; color: #fff; background: ${sevColor};">
          ${sevLabel}
        </span>
      </div>

      <!-- Confidence bar -->
      <div style="margin-bottom: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
          <span style="font-size: 11px; color: #666;">Confidence</span>
          <span style="font-size: 11px; font-weight: 600;">${confidencePct}%</span>
        </div>
        <div style="height: 6px; background: #e5e7eb; border-radius: 3px; overflow: hidden;">
          <div style="height: 100%; width: ${confidenceBarWidth}%; background: ${confidencePct >= 70 ? '#10b981' : confidencePct >= 40 ? '#f59e0b' : '#6b7280'}; border-radius: 3px; transition: width 0.3s;"></div>
        </div>
      </div>

      <!-- Size + primary stat -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; padding: 6px; background: #f9fafb; border-radius: 6px;">
        <div>
          <div style="font-size: 10px; color: #999;">Size</div>
          <div style="font-weight: 500;">${sizeLabel} (${p.pixel_count} px)</div>
        </div>
        <div>
          <div style="font-size: 10px; color: #999;">Primary (${primaryKey})</div>
          <div style="font-weight: 600; color: ${sevColor};">${primaryValue.toFixed(2)}</div>
        </div>
      </div>

      <!-- p90 / max -->
      <div style="display: flex; gap: 12px; margin-bottom: 8px; font-size: 11px; color: #666;">
        <span>p90: <strong style="color: #1a1a1a;">${p.p90_t_stat.toFixed(2)}</strong></span>
        <span>max: <strong style="color: #1a1a1a;">${p.max_t_stat.toFixed(2)}</strong></span>
      </div>

      <!-- VV/VH polarization -->
      <div style="padding: 6px; background: #f0f9ff; border-radius: 6px; margin-bottom: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 11px;">
            <span style="color: #666;">VV:</span> <strong>${p.vv_t_stat.toFixed(1)}</strong>
            &nbsp;&nbsp;
            <span style="color: #666;">VH:</span> <strong>${p.vh_t_stat.toFixed(1)}</strong>
          </div>
          <span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; ${
            p.polarization_agreement
              ? 'background: #dcfce7; color: #16a34a;'
              : 'background: #fef2f2; color: #dc2626;'
          }">
            ${p.polarization_agreement ? '\u2713 AGREE' : '\u2717 DISAGREE'}
          </span>
        </div>
        <div style="font-size: 10px; color: #999; margin-top: 2px;">Quadratic: ${p.quadratic_t.toFixed(2)}</div>
      </div>

      <!-- Optical corroboration -->
      <div style="margin-bottom: 8px;">
        <div style="font-size: 11px; color: #666; margin-bottom: 4px;">
          Optical: <strong>${p.optical_corroboration_count}/${opticalTotal || 3}</strong>
        </div>
        <div style="display: flex; gap: 8px; font-size: 10px;">
          <span style="color: ${ndviOk ? '#16a34a' : '#dc2626'};">${ndviOk ? '\u2713' : '\u2717'} NDVI</span>
          <span style="color: ${ndbiOk ? '#16a34a' : '#dc2626'};">${ndbiOk ? '\u2713' : '\u2717'} NDBI</span>
          <span style="color: ${nbrOk ? '#16a34a' : '#dc2626'};">${nbrOk ? '\u2713' : '\u2717'} NBR</span>
        </div>
      </div>

      <!-- Footer stats -->
      <div style="display: flex; justify-content: space-between; font-size: 10px; color: #999; padding-top: 6px; border-top: 1px solid #e5e7eb;">
        <span>CV: ${p.pre_cv.toFixed(2)} (${cvLabel})</span>
        <span>Temporal: ${temporalLabel}</span>
      </div>
    </div>
  `;
}
