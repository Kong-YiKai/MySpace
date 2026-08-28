CREATE SCHEMA IF NOT EXISTS floor_plan;
CREATE SCHEMA IF NOT EXISTS housing;

ALTER TABLE asset.assets
  ALTER COLUMN checksum_sha256 DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending_upload',
  ADD COLUMN IF NOT EXISTS original_file_name TEXT,
  ADD COLUMN IF NOT EXISTS expected_media_type TEXT,
  ADD COLUMN IF NOT EXISTS detected_media_type TEXT,
  ADD COLUMN IF NOT EXISTS width_pixels INTEGER,
  ADD COLUMN IF NOT EXISTS height_pixels INTEGER,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_code TEXT;

ALTER TABLE generation.jobs
  ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS housing_session_id UUID;

ALTER TABLE generation.outbox
  ADD COLUMN IF NOT EXISTS publish_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS floor_plan.validation_jobs (
  job_id UUID PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset.assets(asset_id),
  status TEXT NOT NULL CHECK (status IN (
    'accepted', 'validating-file', 'recognizing', 'normalizing', 'complete', 'failed'
  )),
  progress DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  confidence DOUBLE PRECISION CHECK (confidence >= 0 AND confidence <= 1),
  structured_plan JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS floor_plan_validation_jobs_asset_idx
  ON floor_plan.validation_jobs(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS housing.sessions (
  session_id UUID PRIMARY KEY,
  source JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('shell-generating', 'shell-ready', 'failed')),
  shell_job_id UUID NOT NULL UNIQUE REFERENCES generation.jobs(job_id),
  scene_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'generation_jobs_housing_session_fk'
  ) THEN
    ALTER TABLE generation.jobs
      ADD CONSTRAINT generation_jobs_housing_session_fk
      FOREIGN KEY (housing_session_id) REFERENCES housing.sessions(session_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS generation_jobs_housing_session_idx
  ON generation.jobs(housing_session_id);

