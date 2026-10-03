ALTER TABLE tasks ADD COLUMN nfc_claim integer NOT NULL DEFAULT 0 CHECK(nfc_claim IN (0,1));
--> statement-breakpoint
ALTER TABLE claims ADD COLUMN nfc_request_hash text CHECK(nfc_request_hash IS NULL OR length(nfc_request_hash)=64);
--> statement-breakpoint
UPDATE tasks SET nfc_claim=1 WHERE EXISTS(
  SELECT 1 FROM stores s WHERE s.id=tasks.store_id AND s.point_mode='hardware'
    AND (tasks.id='quest-' || s.id OR EXISTS(SELECT 1 FROM hardware_devices h WHERE h.store_id=s.id AND h.bound_task_id=tasks.id))
);
--> statement-breakpoint
CREATE TRIGGER hardware_task_nfc_insert AFTER INSERT ON hardware_devices WHEN NEW.bound_task_id IS NOT NULL BEGIN
  UPDATE tasks SET nfc_claim=1 WHERE id=NEW.bound_task_id AND store_id=NEW.store_id
    AND EXISTS(SELECT 1 FROM stores s WHERE s.id=NEW.store_id AND s.point_mode='hardware');
END;
--> statement-breakpoint
CREATE TRIGGER hardware_task_nfc_bind AFTER UPDATE OF bound_task_id,store_id ON hardware_devices WHEN NEW.bound_task_id IS NOT NULL BEGIN
  UPDATE tasks SET nfc_claim=1 WHERE id=NEW.bound_task_id AND store_id=NEW.store_id
    AND EXISTS(SELECT 1 FROM stores s WHERE s.id=NEW.store_id AND s.point_mode='hardware');
END;
--> statement-breakpoint
CREATE TRIGGER hardware_canonical_nfc AFTER INSERT ON tasks BEGIN
  UPDATE tasks SET nfc_claim=1 WHERE id=NEW.id AND EXISTS(
    SELECT 1 FROM stores s WHERE s.id=NEW.store_id AND s.point_mode='hardware' AND NEW.id='quest-' || s.id);
END;
--> statement-breakpoint
CREATE TRIGGER hardware_store_nfc AFTER UPDATE OF point_mode ON stores WHEN NEW.point_mode='hardware' BEGIN
  UPDATE tasks SET nfc_claim=1 WHERE store_id=NEW.id
    AND (id='quest-' || NEW.id OR EXISTS(SELECT 1 FROM hardware_devices h WHERE h.store_id=NEW.id AND h.bound_task_id=tasks.id));
END;
