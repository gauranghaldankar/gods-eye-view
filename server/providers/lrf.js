import path from 'node:path';
import { promises as fsp } from 'node:fs';

/**
 * LRF Companion observations proxy.
 *
 * Reads GeoJSON files exported by the LRF Companion app from a configurable
 * directory and merges them into a single FeatureCollection served at
 * /api/lrf/observations. Files are re-read on each request (no cache) so
 * newly dropped exports appear immediately — suitable for a live demo where
 * the user pulls GeoJSON from the phone via `adb pull`.
 *
 * Configuration (env):
 *   LRF_DATA_DIR  — directory containing .geojson files (default: data/lrf/)
 *
 * Routes:
 *   GET /api/lrf/observations  → merged FeatureCollection
 *   GET /api/lrf/status        → { configured, fileCount, files }
 *
 * @returns {import('vite').Plugin}
 */
export function lrfProxy() {
  function dataDir() {
    return process.env.LRF_DATA_DIR || path.join(process.cwd(), 'data', 'lrf');
  }

  async function readGeoJsonFiles() {
    const dir = dataDir();
    let entries;
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return { files: [], features: [] };
    }
    const jsonFiles = entries
      .filter((f) => f.endsWith('.geojson') || f.endsWith('.json'))
      .sort();

    const allFeatures = [];
    let mission = null;
    let missionId = null;
    let classification = null;

    for (const file of jsonFiles) {
      try {
        const raw = await fsp.readFile(path.join(dir, file), 'utf-8');
        const geojson = JSON.parse(raw);
        if (Array.isArray(geojson?.features)) {
          allFeatures.push(...geojson.features);
          if (!mission && geojson.mission) mission = geojson.mission;
          if (!missionId && geojson.missionId) missionId = geojson.missionId;
          if (!classification && geojson.classification)
            classification = geojson.classification;
        }
      } catch (e) {
        console.warn(`[LRF] Failed to read ${file}:`, e.message);
      }
    }

    return {
      files: jsonFiles,
      features: allFeatures,
      mission,
      missionId,
      classification,
    };
  }

  return {
    name: 'gev:lrf-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === '/api/lrf/observations' && req.method === 'GET') {
          try {
            const data = await readGeoJsonFiles();
            const collection = {
              type: 'FeatureCollection',
              mission: data.mission || 'LRF Demo',
              missionId: data.missionId || null,
              classification: data.classification || 'UNCLASSIFIED',
              features: data.features,
            };
            res.writeHead(200, {
              'Content-Type': 'application/geo+json',
              'Cache-Control': 'no-cache',
            });
            res.end(JSON.stringify(collection));
          } catch (e) {
            console.error('[LRF] Error:', e);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal' }));
          }
          return;
        }

        if (req.url === '/api/lrf/status' && req.method === 'GET') {
          try {
            const data = await readGeoJsonFiles();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                configured: true,
                dataDir: dataDir(),
                fileCount: data.files.length,
                files: data.files,
                featureCount: data.features.length,
              }),
            );
          } catch (e) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ configured: false, dataDir: dataDir() }));
          }
          return;
        }

        next();
      });
    },
  };
}
