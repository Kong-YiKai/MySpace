CREATE SCHEMA IF NOT EXISTS generation;
CREATE SCHEMA IF NOT EXISTS scene;
CREATE SCHEMA IF NOT EXISTS asset;

CREATE TABLE IF NOT EXISTS generation.jobs (
  job_id UUID PRIMARY KEY,
  request_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN (
    'accepted', 'generating', 'normalizing', 'complete', 'failed', 'cancelled'
  )),
  progress DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  request JSONB NOT NULL,
  scene_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generation.outbox (
  event_id UUID PRIMARY KEY,
  subject TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS scene.scenes (
  scene_id TEXT PRIMARY KEY,
  current_revision BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scene.revisions (
  scene_id TEXT NOT NULL REFERENCES scene.scenes(scene_id),
  revision BIGINT NOT NULL,
  manifest JSONB NOT NULL,
  command_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scene_id, revision)
);

CREATE TABLE IF NOT EXISTS asset.assets (
  asset_id TEXT PRIMARY KEY,
  storage_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  media_type TEXT,
  checksum_sha256 TEXT NOT NULL,
  size_bytes BIGINT,
  source_lineage JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
