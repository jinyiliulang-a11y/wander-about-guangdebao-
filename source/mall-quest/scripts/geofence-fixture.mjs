// Explicit synthetic coordinates for legacy isolated business scenarios only.
// Production never seeds a center. The strict fence suite does not use this setup.
import { run } from './business-fixture.mjs';
export const fixtureLocation = () => ({ latitude: 31.23, longitude: 121.47, accuracy: 5, timestamp: Date.now() });
export function setupFixtureGeofences() {
  run(`INSERT INTO store_geofences(store_id,enabled,latitude,longitude,radius_meters,revision,updated_at)
    SELECT id,1,31.23,121.47,150,1,? FROM stores WHERE event_id='mall-48h'`, Date.now());
}
