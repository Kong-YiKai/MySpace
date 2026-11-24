CREATE SCHEMA IF NOT EXISTS scene_service;

CREATE TABLE IF NOT EXISTS scene_service.scenes (
  scene_id TEXT PRIMARY KEY,
  current_revision BIGINT NOT NULL,
  shell_revision BIGINT,
  manifest JSONB NOT NULL,
  spatial_constraints JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scene_service.revisions (
  scene_id TEXT NOT NULL REFERENCES scene_service.scenes(scene_id),
  revision BIGINT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('initialize', 'apply', 'undo', 'redo')),
  command_id TEXT,
  manifest JSONB NOT NULL,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scene_id, revision)
);

CREATE TABLE IF NOT EXISTS scene_service.commands (
  command_id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scene_service.scenes(scene_id),
  applied_revision BIGINT NOT NULL,
  envelope JSONB NOT NULL,
  before_manifest JSONB NOT NULL,
  after_manifest JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applied', 'undone', 'superseded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scene_service_commands_history_idx
  ON scene_service.commands(scene_id, applied_revision DESC, updated_at DESC);
