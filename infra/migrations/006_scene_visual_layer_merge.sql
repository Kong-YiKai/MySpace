ALTER TABLE scene_service.revisions
  DROP CONSTRAINT IF EXISTS revisions_operation_check;

ALTER TABLE scene_service.revisions
  ADD CONSTRAINT revisions_operation_check
  CHECK (operation IN ('initialize', 'apply', 'undo', 'redo', 'visual-layer-merge'));
