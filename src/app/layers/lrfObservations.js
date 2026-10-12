import { createLrfObservationsLayer } from '../../layers/lrf-observations/index.js';
import { overlayHost } from './overlayHost.js';
/** Wire LRF observations to the application overlay host. */
export function createApplicationLrfObservations(options) {
  return createLrfObservationsLayer({ overlayHost, ...options });
}
