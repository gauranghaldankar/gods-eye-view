#!/usr/bin/env node
/**
 * CoT XML to GeoJSON converter for LRF Companion observations.
 *
 * Reads Cursor-on-Target XML events (one or more <event> elements) from
 * stdin or a file, converts to the GeoJSON FeatureCollection format that
 * God's Eye View's LRF Observations layer expects.
 *
 * Usage:
 *   node tools/cot-to-geojson.mjs input.xml > output.geojson
 *   cat observations.xml | node tools/cot-to-geojson.mjs > output.geojson
 *   node tools/cot-to-geojson.mjs input.xml -o data/lrf/mission.geojson
 *
 * The converter handles both single <event> and multi-event files wrapped
 * in a root element.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', short: 'o' },
    mission: { type: 'string', short: 'm', default: 'LRF Demo' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (opts.help) {
  console.log(`Usage: cot-to-geojson.mjs [input.xml] [-o output.geojson] [-m mission-name]
  Reads CoT XML from file or stdin, writes LRF GeoJSON to stdout or -o file.`);
  process.exit(0);
}

const xml = positionals[0]
  ? readFileSync(positionals[0], 'utf-8')
  : readFileSync(0, 'utf-8');

const features = [];
const eventPattern = /<event\b[^>]*>([\s\S]*?)<\/event>/gi;
let match;

while ((match = eventPattern.exec(xml)) !== null) {
  const eventTag = match[0];
  const feature = parseEvent(eventTag);
  if (feature) features.push(feature);
}

const collection = {
  type: 'FeatureCollection',
  mission: opts.mission,
  missionId: null,
  createdUtc: new Date().toISOString(),
  classification: 'UNCLASSIFIED',
  features,
};

const json = JSON.stringify(collection, null, 2);

if (opts.output) {
  writeFileSync(opts.output, json, 'utf-8');
  console.error(`Wrote ${features.length} feature(s) to ${opts.output}`);
} else {
  process.stdout.write(json + '\n');
}

function parseEvent(eventXml) {
  const uid = attr(eventXml, 'event', 'uid');
  const type = attr(eventXml, 'event', 'type');
  const time = attr(eventXml, 'event', 'time');

  // Parse <point>
  const lat = numAttr(eventXml, 'point', 'lat');
  const lon = numAttr(eventXml, 'point', 'lon');
  const hae = numAttr(eventXml, 'point', 'hae');
  const ce = numAttr(eventXml, 'point', 'ce');

  if (lat == null || lon == null) return null;

  // Determine affiliation from CoT type
  const affiliation = cotTypeToAffiliation(type);

  // Parse <__lrf> detail
  const lrf = parseLrfDetail(eventXml);

  // Parse <contact>
  const callsign = attr(eventXml, 'contact', 'callsign');

  // Parse <remarks>
  const remarksMatch = eventXml.match(/<remarks>([\s\S]*?)<\/remarks>/);
  const remarks = remarksMatch ? remarksMatch[1].trim() : null;

  // Build target feature
  const properties = {
    featureType: 'target',
    observationId: uid,
    targetEstimateId: uid,
    timeUtc: time,
    rangeM: lrf?.range ?? null,
    azimuthTrueDeg: lrf?.azimuth ?? null,
    azimuthRef: lrf?.azRef || 'TRUE',
    inclinationDeg: lrf?.inclination ?? null,
    // Convert CE90 back to approximate CEP50: CEP50 ~ CE90 / 2.146 * 1.1774
    cep50M: ce ? Math.round((ce / 2.146) * 1.1774 * 10) / 10 : null,
    semiMajor95M: lrf?.ellipseSemiMajor
      ? lrf.ellipseSemiMajor * 2.4477
      : ce
        ? ce * 1.1414
        : null,
    semiMinor95M: lrf?.ellipseSemiMinor
      ? lrf.ellipseSemiMinor * 2.4477
      : ce
        ? ce * 1.1414
        : null,
    ellipseOrientDeg: lrf?.ellipseOrientation ?? 0,
    affiliation,
    category: lrf?.visionClass ?? null,
    remarks,
    observerCallsign: callsign,
  };

  return {
    type: 'Feature',
    id: uid,
    geometry: {
      type: 'Point',
      coordinates: hae != null ? [lon, lat, hae] : [lon, lat],
    },
    properties,
  };
}

function cotTypeToAffiliation(type) {
  if (!type) return 'UNKNOWN';
  if (type.startsWith('a-h')) return 'HOSTILE';
  if (type.startsWith('a-f')) return 'FRIEND';
  if (type.startsWith('a-n')) return 'NEUTRAL';
  return 'UNKNOWN';
}

function parseLrfDetail(xml) {
  const lrfMatch = xml.match(
    /<__lrf\b([^>]*)\/?>|<__lrf\b([^>]*)>([\s\S]*?)<\/__lrf>/,
  );
  if (!lrfMatch) return null;
  const attrs = lrfMatch[1] || lrfMatch[2] || '';
  return {
    range: numFromAttrs(attrs, 'range'),
    azimuth: numFromAttrs(attrs, 'azimuth'),
    azRef: strFromAttrs(attrs, 'azRef'),
    inclination: numFromAttrs(attrs, 'inclination'),
    method: strFromAttrs(attrs, 'method'),
    ellipseSemiMajor: numFromAttrs(attrs, 'ellipseSemiMajor'),
    ellipseSemiMinor: numFromAttrs(attrs, 'ellipseSemiMinor'),
    ellipseOrientation: numFromAttrs(attrs, 'ellipseOrientation'),
    deviceModel: strFromAttrs(attrs, 'deviceModel'),
    deviceSerial: strFromAttrs(attrs, 'deviceSerial'),
    visionClass: strFromAttrs(attrs, 'visionClass'),
    visionConfidence: numFromAttrs(attrs, 'visionConfidence'),
  };
}

function attr(xml, tag, name) {
  const tagMatch = xml.match(new RegExp(`<${tag}\\b([^>]*)`, 'i'));
  if (!tagMatch) return null;
  return strFromAttrs(tagMatch[1], name);
}

function numAttr(xml, tag, name) {
  const v = attr(xml, tag, name);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strFromAttrs(attrs, name) {
  const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? m[1] : null;
}

function numFromAttrs(attrs, name) {
  const v = strFromAttrs(attrs, name);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
