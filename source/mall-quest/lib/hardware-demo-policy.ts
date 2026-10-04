import { HARDWARE_DEMO_INSTANCE } from "./application-scope";
import { validGeoLocation, type GeofenceCheck } from "./geofence";

// An isolated release literal selects this policy; request parameters cannot enable it.
export const NFC_LOCATION_PERMIT_MS = HARDWARE_DEMO_INSTANCE ? 600_000 : 30_000;
export const NFC_RANGE_SQL = HARDWARE_DEMO_INSTANCE ? "1=1" : "g.enabled=1";

/** Demo records a real browser position, without claiming proof of arrival. */
export function demoLocationCheck(location: unknown, now: number): GeofenceCheck {
  const result = (reason: GeofenceCheck["reason"]): GeofenceCheck => ({
    reason, inside: reason === "inside", distanceMeters: null,
    accuracyMeters: validGeoLocation(location) ? location.accuracy : null,
  });
  if (location == null) return result("location-required");
  if (!validGeoLocation(location)) return result("invalid-location");
  if (!Number.isFinite(now) || now - location.timestamp > NFC_LOCATION_PERMIT_MS || location.timestamp - now > 5_000)
    return result("stale-location");
  return result("inside");
}
