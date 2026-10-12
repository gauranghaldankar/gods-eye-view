import { normalizeLrfSnapshot } from './records.js';

/**
 * Source that fetches LRF observation data from the local server endpoint.
 * The server reads GeoJSON files from a configured directory or file path.
 */
export function createLrfObservationsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/lrf/observations', { signal });
      if (!response.ok) {
        if (response.status === 404)
          return { targets: [], ellipses: [], observers: [] };
        throw new Error(`LRF observations HTTP ${response.status}`);
      }
      const payload = await response.json();
      signal?.throwIfAborted();
      const snapshot = normalizeLrfSnapshot(payload);
      if (!snapshot) throw new Error('Malformed LRF observations response');
      return snapshot;
    },
  };
}
