import { distanceMeters, validCoordinates, validGeoLocation, validRadius, type GeoLocation, type StoreGeofence } from "./geofence";
import type { Store } from "./game-types";

export const NEARBY_POSITION_MAX_AGE_MS = 5 * 60_000;
export const NEARBY_RADII = [0, 500, 1000, 3000, 5000] as const;
export type NearbyRadius = (typeof NEARBY_RADII)[number];
export type NearbyReason = "all" | "nearby" | "location-required" | "invalid-location" | "stale-location" | "precision-low";
export function nearbyStores(stores: Store[], fences: StoreGeofence[], radius: NearbyRadius, location: GeoLocation | null, now: number) {
  let locationReason: NearbyReason = "nearby";
  if (!location) locationReason = "location-required";
  else if (!validGeoLocation(location)) locationReason = "invalid-location";
  else if (!Number.isFinite(now) || now - location.timestamp > NEARBY_POSITION_MAX_AGE_MS || location.timestamp - now > 5000) locationReason = "stale-location";
  const usable = locationReason === "nearby";
  const reason: NearbyReason = radius === 0 ? "all" : !usable ? locationReason : location!.accuracy > radius ? "precision-low" : "nearby";
  const entries = stores.filter(store => store.status !== "inactive").map(store => {
    const fence = fences.find(item => item.storeId === store.id);
    const configured = !!fence && fence.enabled && Number.isSafeInteger(fence.revision) && fence.revision > 0 && fence.coordinateSystem === "WGS84" && validCoordinates(fence.latitude, fence.longitude) && validRadius(fence.radiusMeters);
    const distance = usable && configured ? distanceMeters(location!, { latitude: fence!.latitude!, longitude: fence!.longitude! }) : null;
    return { store, distanceMeters: distance, configured };
  }).filter(entry => reason !== "nearby" || (entry.distanceMeters !== null && entry.distanceMeters - location!.accuracy <= radius));
  if (usable) entries.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  return { entries, reason };
}
export function approximateDistance(distance: number) {
  return distance < 1000 ? `约 ${Math.round(distance / 10) * 10} 米` : `约 ${(distance / 1000).toFixed(1)} 公里`;
}
