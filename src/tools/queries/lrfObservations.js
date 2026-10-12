/** LRF Companion observation queries. */

import { suggestView } from '../views.js';
import { defineTool } from '../catalog.js';
import { AREA_SCHEMA, areaContains, resolveArea } from '../area.js';
import { LIMIT_SCHEMA, capRows, countNoun, isoTime } from '../results.js';

export const getLrfObservations = defineTool({
  name: 'get_lrf_observations',
  title: 'LRF target observations',
  description:
    'Geolocated, error-bounded laser rangefinder target observations from ' +
    'LRF Companion. Each observation includes position, MGRS grid, range, ' +
    'azimuth, 95% error ellipse, CEP50, and NATO affiliation. Optionally ' +
    'filtered by area and affiliation.',
  inputSchema: {
    type: 'object',
    properties: {
      area: AREA_SCHEMA,
      affiliation: {
        type: 'string',
        enum: ['HOSTILE', 'FRIEND', 'NEUTRAL', 'UNKNOWN'],
        description: 'Filter by NATO affiliation.',
      },
      limit: LIMIT_SCHEMA,
    },
    additionalProperties: false,
  },
  requires: ['lrfObservations'],
  async run(args, { services, signal }) {
    const area = args.area
      ? await resolveArea(args.area, { services, signal })
      : null;
    const snapshot = await services.lrfObservations.getSnapshot({ signal });
    const targets = (snapshot.targets || [])
      .filter(
        (t) =>
          (!area || areaContains(area, t)) &&
          (!args.affiliation || t.affiliation === args.affiliation),
      )
      .sort(
        (a, b) =>
          affiliationPriority(a.affiliation) -
            affiliationPriority(b.affiliation) ||
          (a.rangeM ?? Infinity) - (b.rangeM ?? Infinity),
      );
    const result = capRows(targets, args.limit);
    const where = area ? ` in ${area.label}` : '';
    const affiliationNote = args.affiliation
      ? ` (${args.affiliation.toLowerCase()})`
      : '';
    return {
      summary: `${countNoun(targets.length, 'LRF observation')}${affiliationNote}${where}.`,
      data: {
        view: suggestView(services, {
          ...(area ? { area } : targets[0] ? { point: targets[0] } : {}),
          layers: ['lrf-observations'],
        }),
        mission: snapshot.mission,
        classification: snapshot.classification,
        ...result,
        rows: result.rows.map((t) => ({
          id: t.observationId || t.stableId,
          lat: t.lat,
          lon: t.lon,
          h_ell_m: t.hEllM,
          mgrs: t.mgrs,
          range_m: t.rangeM,
          azimuth_true_deg: t.azimuthTrueDeg,
          inclination_deg: t.inclinationDeg,
          cep50_m: t.cep50M,
          semi_major_95_m: t.semiMajor95M,
          semi_minor_95_m: t.semiMinor95M,
          ellipse_orient_deg: t.ellipseOrientDeg,
          affiliation: t.affiliation,
          category: t.category,
          remarks: t.remarks,
          observer: t.observerCallsign,
          time_utc: t.timeUtc,
        })),
      },
    };
  },
});

export const getLrfTargetDetail = defineTool({
  name: 'get_lrf_target_detail',
  title: 'LRF target detail',
  description:
    'Full measurement detail for a single LRF observation, including the ' +
    'complete ENU covariance matrix, error ellipse parameters, and all ' +
    'raw measurement metadata.',
  inputSchema: {
    type: 'object',
    properties: {
      observation_id: {
        type: 'string',
        description: 'The observation or target estimate UUID.',
      },
    },
    required: ['observation_id'],
    additionalProperties: false,
  },
  requires: ['lrfObservations'],
  async run(args, { services, signal }) {
    const snapshot = await services.lrfObservations.getSnapshot({ signal });
    const target = (snapshot.targets || []).find(
      (t) =>
        t.observationId === args.observation_id ||
        t.targetEstimateId === args.observation_id ||
        t.stableId === args.observation_id,
    );
    if (!target) {
      return {
        summary: `No observation found with ID ${args.observation_id}.`,
        data: { found: false },
      };
    }
    return {
      summary: `${target.affiliation} target at ${target.mgrs || `${target.lat.toFixed(6)}, ${target.lon.toFixed(6)}`}, range ${target.rangeM ? Math.round(target.rangeM) + 'm' : 'unknown'}, CEP50 ${target.cep50M ? Math.round(target.cep50M) + 'm' : 'unknown'}.`,
      data: {
        found: true,
        view: suggestView(services, {
          point: target,
          layers: ['lrf-observations'],
        }),
        observation: {
          id: target.observationId || target.stableId,
          target_estimate_id: target.targetEstimateId,
          lat: target.lat,
          lon: target.lon,
          h_ell_m: target.hEllM,
          mgrs: target.mgrs,
          range_m: target.rangeM,
          azimuth_true_deg: target.azimuthTrueDeg,
          azimuth_ref: target.azimuthRef,
          inclination_deg: target.inclinationDeg,
          cep50_m: target.cep50M,
          semi_major_95_m: target.semiMajor95M,
          semi_minor_95_m: target.semiMinor95M,
          ellipse_orient_deg: target.ellipseOrientDeg,
          cov_enu: target.covEnu,
          affiliation: target.affiliation,
          category: target.category,
          remarks: target.remarks,
          observer: target.observerCallsign,
          time_utc: target.timeUtc,
        },
      },
    };
  },
});

function affiliationPriority(aff) {
  return { HOSTILE: 0, UNKNOWN: 1, NEUTRAL: 2, FRIEND: 3 }[aff] ?? 1;
}
