/**
 * Validate and normalize an LRF Companion GeoJSON export before it can
 * replace the displayed observations. Accepts the FeatureCollection format
 * produced by LRF's GeoJsonExporter (featureType: "target", "ellipse95",
 * "observer").
 */

const AFFILIATIONS = new Set(['UNKNOWN', 'HOSTILE', 'NEUTRAL', 'FRIEND']);

export function normalizeLrfSnapshot(geojson) {
  if (!Array.isArray(geojson?.features)) return null;

  const targets = [];
  const ellipses = [];
  const observers = [];
  const targetIds = new Set();

  for (const feature of geojson.features) {
    const coords = feature?.geometry?.coordinates;
    const props = feature?.properties;
    if (!coords || !props || typeof props !== 'object') continue;

    const featureType = props.featureType;

    if (featureType === 'target' && feature.geometry?.type === 'Point') {
      const [lon, lat, hEllM] = coords;
      if (!validCoord(lon, lat)) continue;
      const id = props.observationId || props.targetEstimateId || feature.id;
      if (!id || targetIds.has(id)) continue;
      targetIds.add(id);
      targets.push({
        stableId: String(id),
        observationId: props.observationId ?? null,
        targetEstimateId: props.targetEstimateId ?? null,
        lon,
        lat,
        hEllM: Number.isFinite(hEllM) ? hEllM : 0,
        timeUtc: props.timeUtc ?? null,
        mgrs: typeof props.mgrs === 'string' ? props.mgrs : null,
        rangeM: finiteOrNull(props.rangeM),
        azimuthTrueDeg: finiteOrNull(props.azimuthTrueDeg),
        azimuthRef: props.azimuthRef ?? 'TRUE',
        inclinationDeg: finiteOrNull(props.inclinationDeg),
        cep50M: finiteOrNull(props.cep50M),
        semiMajor95M: finiteOrNull(props.semiMajor95M),
        semiMinor95M: finiteOrNull(props.semiMinor95M),
        ellipseOrientDeg: finiteOrNull(props.ellipseOrientDeg),
        covEnu: Array.isArray(props.covEnu) ? props.covEnu : null,
        affiliation: AFFILIATIONS.has(props.affiliation)
          ? props.affiliation
          : 'UNKNOWN',
        category: typeof props.category === 'string' ? props.category : null,
        remarks: typeof props.remarks === 'string' ? props.remarks : null,
        observerCallsign:
          typeof props.observerCallsign === 'string'
            ? props.observerCallsign
            : null,
      });
    } else if (
      featureType === 'ellipse95' &&
      feature.geometry?.type === 'Polygon'
    ) {
      const ring = coords?.[0];
      if (!Array.isArray(ring) || ring.length < 4) continue;
      ellipses.push({
        targetEstimateId: props.targetEstimateId ?? null,
        affiliation: AFFILIATIONS.has(props.affiliation)
          ? props.affiliation
          : 'UNKNOWN',
        semiMajor95M: finiteOrNull(props.semiMajor95M),
        semiMinor95M: finiteOrNull(props.semiMinor95M),
        ellipseOrientDeg: finiteOrNull(props.ellipseOrientDeg),
        ring: ring
          .filter((c) => Array.isArray(c) && c.length >= 2)
          .map(([lon, lat]) => [lon, lat]),
      });
    } else if (
      featureType === 'observer' &&
      feature.geometry?.type === 'Point'
    ) {
      const [lon, lat, hEllM] = coords;
      if (!validCoord(lon, lat)) continue;
      observers.push({
        id: props.id || feature.id || 'observer',
        callsign:
          typeof props.callsign === 'string' ? props.callsign : 'OBSERVER',
        lon,
        lat,
        hEllM: Number.isFinite(hEllM) ? hEllM : 0,
      });
    }
  }

  return {
    mission: geojson.mission ?? null,
    missionId: geojson.missionId ?? null,
    classification: geojson.classification ?? 'UNCLASSIFIED',
    targets,
    ellipses,
    observers,
  };
}

function validCoord(lon, lat) {
  return (
    Number.isFinite(lon) &&
    Math.abs(lon) <= 180 &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90
  );
}

function finiteOrNull(v) {
  return Number.isFinite(v) ? v : null;
}
