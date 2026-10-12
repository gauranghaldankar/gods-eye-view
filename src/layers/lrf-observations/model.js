import * as Cesium from 'cesium';

export const LRF_OVERLAY_SOURCE_ID = 'lrf-observations';
export const LRF_OVERLAY_COHORT_LIMIT = 64;
export const LRF_OVERLAY_COLLISION_CAPACITY = 32;

/** NATO-standard affiliation colors (MIL-STD-2525). */
const AFFILIATION_COLORS = {
  HOSTILE: Cesium.Color.fromCssColorString('#FF4444'),
  FRIEND: Cesium.Color.fromCssColorString('#4488FF'),
  NEUTRAL: Cesium.Color.fromCssColorString('#44BB44'),
  UNKNOWN: Cesium.Color.fromCssColorString('#FFCC00'),
};

const AFFILIATION_CSS = {
  HOSTILE: '#FF4444',
  FRIEND: '#4488FF',
  NEUTRAL: '#44BB44',
  UNKNOWN: '#FFCC00',
};

export function affiliationColor(affiliation) {
  return AFFILIATION_COLORS[affiliation] || AFFILIATION_COLORS.UNKNOWN;
}

export function affiliationCss(affiliation) {
  return AFFILIATION_CSS[affiliation] || AFFILIATION_CSS.UNKNOWN;
}

/** Short affiliation label for the overlay. */
function affiliationTag(affiliation) {
  return (
    { HOSTILE: 'HOS', FRIEND: 'FRD', NEUTRAL: 'NEU', UNKNOWN: 'UNK' }[
      affiliation
    ] || 'UNK'
  );
}

/**
 * Build the overlay label for one LRF observation.
 * Shows affiliation tag + CEP50 or category.
 */
export function createLrfOverlayEntry({ id, position, target }) {
  const aff = target.affiliation || 'UNKNOWN';
  const tag = affiliationTag(aff);
  const detail = target.cep50M
    ? `CEP ${Math.round(target.cep50M)}m`
    : target.category || '';
  const title = detail ? `${tag} ${detail}` : tag;

  return {
    id: String(id),
    position,
    variant: 'label',
    title,
    accent: affiliationCss(aff),
    priority: priorityForTarget(target),
    collisionGroup: 'ambient-label',
    paintLane: 'ambient-label',
    interactive: false,
    edgeFade: 'keyhole',
    horizonCull: true,
    terrainOcclusion: false,
    gapPx: 15,
    verticalOnly: true,
    placement: 'above',
  };
}

/** Hostile targets get highest priority, then by range (closer = more urgent). */
function priorityForTarget(target) {
  const base =
    { HOSTILE: 9000, FRIEND: 3000, NEUTRAL: 5000, UNKNOWN: 7000 }[
      target.affiliation
    ] || 7000;
  const rangeBonus = target.rangeM
    ? Math.max(0, 1000 - Math.round(target.rangeM / 10))
    : 0;
  return base + rangeBonus;
}

export function selectLrfOverlayCohort(
  entries,
  limit = LRF_OVERLAY_COHORT_LIMIT,
) {
  const cap = Math.max(
    0,
    Math.min(LRF_OVERLAY_COHORT_LIMIT, Math.floor(Number(limit) || 0)),
  );
  if (!Array.isArray(entries) || cap === 0) return [];
  return entries
    .slice()
    .sort(
      (a, b) =>
        b.priority - a.priority || String(a.id).localeCompare(String(b.id)),
    )
    .slice(0, cap);
}

/**
 * Map one observation to a JSON-safe analyst record.
 * Pure — no Cesium types.
 */
export function mapAnalystRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    id: text(raw?.observationId) || `OBS-${String(index).padStart(4, '0')}`,
    lat: num(raw?.lat),
    lon: num(raw?.lon),
    h_ell_m: num(raw?.hEllM),
    mgrs: text(raw?.mgrs),
    range_m: num(raw?.rangeM),
    azimuth_true_deg: num(raw?.azimuthTrueDeg),
    inclination_deg: num(raw?.inclinationDeg),
    cep50_m: num(raw?.cep50M),
    semi_major_95_m: num(raw?.semiMajor95M),
    semi_minor_95_m: num(raw?.semiMinor95M),
    ellipse_orient_deg: num(raw?.ellipseOrientDeg),
    affiliation: text(raw?.affiliation),
    category: text(raw?.category),
    remarks: text(raw?.remarks),
    observer: text(raw?.observerCallsign),
    time_utc: text(raw?.timeUtc),
  };
}

export { normalizeLrfSnapshot } from './records.js';
