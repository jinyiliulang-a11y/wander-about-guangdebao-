ALTER TABLE store_geofences
ADD COLUMN shape_type TEXT NOT NULL DEFAULT 'circle'
CONSTRAINT geofence_shape_type CHECK (shape_type IN ('circle', 'polygon'));
--> statement-breakpoint
ALTER TABLE store_geofences
ADD COLUMN polygon_json TEXT
CONSTRAINT geofence_polygon_shape CHECK (
 (shape_type = 'circle' AND polygon_json IS NULL)
 OR (shape_type = 'polygon' AND polygon_json IS NOT NULL AND CASE
  WHEN length(polygon_json)<=16384 AND json_valid(polygon_json)
  THEN json_type(polygon_json)='array' AND json_array_length(polygon_json) BETWEEN 3 AND 64
  ELSE 0 END)
);
