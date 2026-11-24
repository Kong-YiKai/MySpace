CREATE SCHEMA IF NOT EXISTS asset_generation;

ALTER TABLE decoration.analysis_jobs
  ALTER COLUMN asset_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS asset_generation.jobs (
  job_id UUID PRIMARY KEY,
  retry_of_job_id UUID REFERENCES asset_generation.jobs(job_id),
  session_id UUID NOT NULL REFERENCES housing.sessions(session_id),
  analysis_id UUID NOT NULL,
  object_id TEXT NOT NULL,
  request JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'accepted', 'submitting', 'generating', 'downloading', 'normalizing', 'complete', 'failed'
  )),
  progress DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  external_task_id TEXT,
  source_glb_asset_id TEXT,
  normalized_glb_asset_id TEXT,
  normalized_transform JSONB,
  provider_evidence JSONB,
  error_code TEXT,
  error_message TEXT,
  retryable BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE asset_generation.jobs
  ADD COLUMN IF NOT EXISTS retry_of_job_id UUID REFERENCES asset_generation.jobs(job_id);

CREATE INDEX IF NOT EXISTS asset_generation_jobs_session_idx
  ON asset_generation.jobs(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS asset_generation_jobs_analysis_object_idx
  ON asset_generation.jobs(analysis_id, object_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS asset_generation_jobs_external_task_idx
  ON asset_generation.jobs(external_task_id)
  WHERE external_task_id IS NOT NULL;
