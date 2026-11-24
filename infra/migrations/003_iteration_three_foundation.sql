CREATE SCHEMA IF NOT EXISTS decoration;
CREATE SCHEMA IF NOT EXISTS provider;

ALTER TABLE housing.sessions
  ADD COLUMN IF NOT EXISTS shell_revision BIGINT,
  ADD COLUMN IF NOT EXISTS spatial_anchors JSONB,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE generation.jobs
  ADD COLUMN IF NOT EXISTS provider_evidence JSONB;

CREATE TABLE IF NOT EXISTS decoration.analysis_jobs (
  job_id UUID PRIMARY KEY,
  analysis_id UUID NOT NULL UNIQUE,
  session_id UUID NOT NULL REFERENCES housing.sessions(session_id),
  asset_id TEXT REFERENCES asset.assets(asset_id),
  status TEXT NOT NULL CHECK (status IN (
    'accepted', 'validating-file', 'recognizing', 'complete', 'failed'
  )),
  progress DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
  brief TEXT NOT NULL DEFAULT '',
  analysis JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS decoration_analysis_jobs_session_idx
  ON decoration.analysis_jobs(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS provider.operation_evidence (
  evidence_id UUID PRIMARY KEY,
  internal_job_id UUID,
  provider_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  external_task_id TEXT,
  external_project_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  input_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_asset_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_operation_external_task_idx
  ON provider.operation_evidence(provider_id, external_task_id)
  WHERE external_task_id IS NOT NULL;
