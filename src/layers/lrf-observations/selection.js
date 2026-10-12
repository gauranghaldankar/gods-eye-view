import * as Cesium from 'cesium';
import { affiliationCss } from './model.js';

export const LRF_SELECTED_OVERLAY_SOURCE_ID = 'lrf-selected';

function affiliationTag(aff) {
  return (
    { HOSTILE: 'HOS', FRIEND: 'FRD', NEUTRAL: 'NEU', UNKNOWN: 'UNK' }[aff] ||
    'UNK'
  );
}

export function createLrfSelectedOverlayEntry({ id, position, target }) {
  const aff = target.affiliation || 'UNKNOWN';
  const tag = affiliationTag(aff);
  const title = `${tag} · ${target.category || 'Target'}`;

  const details = [];
  if (target.mgrs) details.push(`MGRS ${target.mgrs}`);
  const range = target.rangeM != null ? `${Math.round(target.rangeM)}m` : '';
  const az =
    target.azimuthTrueDeg != null
      ? `${target.azimuthTrueDeg.toFixed(1)}°T`
      : '';
  if (range || az) details.push([range, az].filter(Boolean).join(' · '));
  if (target.cep50M != null)
    details.push(
      `CEP ${Math.round(target.cep50M)}m · ${Math.round(target.semiMajor95M || 0)}×${Math.round(target.semiMinor95M || 0)}m 95%`,
    );
  if (target.observerCallsign) details.push(`OBS ${target.observerCallsign}`);
  if (target.remarks) details.push(target.remarks);
  if (target.timeUtc)
    details.push(target.timeUtc.replace('T', ' ').replace('Z', ' Z'));

  return {
    id: String(id),
    position,
    variant: 'selected',
    selected: true,
    protected: true,
    paintLane: 'selected',
    collisionGroup: 'ambient-card',
    priority: Number.MAX_SAFE_INTEGER,
    title,
    details,
    accent: affiliationCss(aff),
    cardStyle: 'tactical',
    interactive: false,
    anchorRadiusPx: 9,
    minAnchorGapPx: 11,
    verticalOnly: true,
    placement: 'above',
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
  };
}
