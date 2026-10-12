import path from 'node:path';
import { createRequire } from 'node:module';
import { promises as fsp } from 'node:fs';
import { readRequestBody } from './common/request.js';

/**
 * LRF Companion observations proxy with WebSocket sync.
 *
 * Combines two data paths:
 * 1. File-based: reads GeoJSON files from data/lrf/ (for manual adb pull)
 * 2. WebSocket: real-time push from LRF Android app at /api/lrf/ws
 *
 * Both paths merge into a single FeatureCollection at GET /api/lrf/observations.
 * DELETE /api/lrf/observations/:id removes an observation and broadcasts the
 * delete to all connected Android clients.
 *
 * Configuration (env):
 *   LRF_DATA_DIR  — directory containing .geojson files (default: data/lrf/)
 *
 * Routes:
 *   GET    /api/lrf/observations      → merged FeatureCollection
 *   POST   /api/lrf/observations      → push a GeoJSON Feature (returns 201)
 *   DELETE /api/lrf/observations/:id   → remove by observationId (returns 200)
 *   GET    /api/lrf/status            → { configured, fileCount, wsClients }
 *   WS     /api/lrf/ws               → bidirectional sync channel
 *
 * @returns {import('vite').Plugin}
 */

let _WebSocket;
function wsImpl() {
  if (_WebSocket !== undefined) return _WebSocket;
  try {
    _WebSocket = createRequire(import.meta.url)('ws');
  } catch {
    _WebSocket = null;
    console.warn('[LRF] `ws` unavailable; WebSocket sync is off.');
  }
  return _WebSocket;
}

export function lrfProxy() {
  function dataDir() {
    return process.env.LRF_DATA_DIR || path.join(process.cwd(), 'data', 'lrf');
  }

  // In-memory store for WebSocket-pushed observations: observationId → Feature
  const _liveFeatures = new Map();
  // Connected WebSocket clients
  const _clients = new Set();
  let _wss = null;

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

    return { files: jsonFiles, features: allFeatures, mission, missionId, classification };
  }

  /** Build merged FeatureCollection from files + live WebSocket data. */
  async function buildCollection() {
    const fileData = await readGeoJsonFiles();
    const liveFeatures = [..._liveFeatures.values()];
    return {
      type: 'FeatureCollection',
      mission: fileData.mission || 'LRF Demo',
      missionId: fileData.missionId || null,
      classification: fileData.classification || 'UNCLASSIFIED',
      features: [...fileData.features, ...liveFeatures],
    };
  }

  /** Broadcast a JSON message to all connected clients. */
  function broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const ws of _clients) {
      try {
        if (ws.readyState === 1) ws.send(payload);
      } catch { /* client gone */ }
    }
  }

  /** Store a pushed GeoJSON Feature by its observationId. */
  function ingestFeature(feature) {
    if (!feature || feature.type !== 'Feature') return false;
    const id =
      feature.properties?.observationId ||
      feature.properties?.id ||
      feature.id;
    if (!id) return false;
    _liveFeatures.set(id, feature);
    return true;
  }

  function dispose() {
    for (const ws of _clients) {
      try { ws.close(1001, 'server shutdown'); } catch { /* ignore */ }
    }
    _clients.clear();
    _liveFeatures.clear();
    if (_wss) {
      _wss.close();
      _wss = null;
    }
  }

  const install = (server) => {
    // REST routes
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url || '/', 'http://localhost');

      // GET /api/lrf/observations
      if (url.pathname === '/api/lrf/observations' && req.method === 'GET') {
        try {
          const collection = await buildCollection();
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

      // POST /api/lrf/observations — push a Feature or FeatureCollection
      if (url.pathname === '/api/lrf/observations' && req.method === 'POST') {
        try {
          const body = await readRequestBody(req, 1_048_576);
          const payload = JSON.parse(body);
          let count = 0;
          if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
            for (const f of payload.features) {
              if (ingestFeature(f)) count++;
            }
          } else if (payload.type === 'Feature') {
            if (ingestFeature(payload)) count = 1;
          }
          res.writeHead(count > 0 ? 201 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ingested: count, total: _liveFeatures.size }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message || 'bad request' }));
        }
        return;
      }

      // DELETE /api/lrf/observations/:id
      if (url.pathname.startsWith('/api/lrf/observations/') && req.method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.slice('/api/lrf/observations/'.length));
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing id' }));
          return;
        }
        const existed = _liveFeatures.delete(id);
        // Broadcast delete to connected Android clients
        broadcast({ type: 'delete', id });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted: existed, id }));
        return;
      }

      // GET /api/lrf/status
      if (url.pathname === '/api/lrf/status' && req.method === 'GET') {
        try {
          const fileData = await readGeoJsonFiles();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              configured: true,
              dataDir: dataDir(),
              fileCount: fileData.files.length,
              files: fileData.files,
              liveFeatureCount: _liveFeatures.size,
              wsClients: _clients.size,
            }),
          );
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ configured: false, dataDir: dataDir() }));
        }
        return;
      }

      next();
    });

    // WebSocket upgrade — /api/lrf/ws
    const WS = wsImpl();
    if (WS && server.httpServer) {
      _wss = new WS.WebSocketServer({ noServer: true });

      server.httpServer.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost');
        if (url.pathname !== '/api/lrf/ws') return;
        _wss.handleUpgrade(req, socket, head, (ws) => {
          _clients.add(ws);
          console.log(`[LRF] WebSocket connected (${_clients.size} client(s))`);

          // Send current live state on connect
          if (_liveFeatures.size > 0) {
            ws.send(JSON.stringify({
              type: 'snapshot',
              features: [..._liveFeatures.values()],
            }));
          }

          ws.on('message', (data) => {
            try {
              const msg = JSON.parse(String(data));
              if (msg.type === 'observation' && msg.geojson) {
                if (ingestFeature(msg.geojson)) {
                  console.log(`[LRF] WS observation: ${msg.geojson.properties?.observationId || msg.geojson.id}`);
                }
              } else if (msg.type === 'observer' && msg.geojson) {
                ingestFeature(msg.geojson);
              } else if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
              }
            } catch { /* ignore malformed */ }
          });

          ws.on('close', () => {
            _clients.delete(ws);
            console.log(`[LRF] WebSocket disconnected (${_clients.size} client(s))`);
          });

          ws.on('error', () => {
            _clients.delete(ws);
          });
        });
      });

      server.httpServer.on('close', dispose);
    }
  };

  return {
    name: 'gev:lrf-proxy',
    configureServer: install,
    configurePreviewServer: install,
    closeBundle() { dispose(); },
  };
}
