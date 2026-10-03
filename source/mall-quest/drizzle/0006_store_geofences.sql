-- No fictional centers are seeded. Unconfigured/disabled stores cannot issue new rewards.
CREATE TABLE store_geofences (
  store_id text PRIMARY KEY NOT NULL REFERENCES stores(id),
  enabled integer NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  latitude real,
  longitude real,
  radius_meters real,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
  updated_at integer NOT NULL,
  CONSTRAINT geofence_center_pair CHECK((latitude IS NULL)=(longitude IS NULL)),
  CONSTRAINT geofence_latitude_range CHECK(latitude IS NULL OR (latitude>=-90 AND latitude<=90)),
  CONSTRAINT geofence_longitude_range CHECK(longitude IS NULL OR (longitude>=-180 AND longitude<=180)),
  CONSTRAINT geofence_radius_range CHECK(radius_meters IS NULL OR (radius_meters>=20 AND radius_meters<=5000)),
  CONSTRAINT geofence_enabled_center CHECK(enabled=0 OR (latitude IS NOT NULL AND longitude IS NOT NULL AND radius_meters IS NOT NULL))
);
