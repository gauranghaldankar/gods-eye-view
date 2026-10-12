import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createLrfObservationsSource } from '../layers/lrf-observations/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'lrf-observations': createLrfObservationsSource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    cables: createBundledCableSource(),
  };
}
