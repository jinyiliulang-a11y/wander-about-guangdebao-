ALTER TABLE stores ADD COLUMN image_url text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE stores ADD COLUMN image_revision integer NOT NULL DEFAULT 0 CHECK(image_revision>=0);
