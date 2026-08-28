-- Identity assurance, verifier quorum receipts, enforceable dispute projection,
-- and institutional governance records for controlled research.

ALTER TABLE verification_jobs ADD COLUMN IF NOT EXISTS quorum_finalized BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE verification_jobs ADD COLUMN IF NOT EXISTS quorum_passed BOOLEAN;
ALTER TABLE verification_jobs ADD COLUMN IF NOT EXISTS quorum_received INTEGER;
ALTER TABLE verification_jobs ADD COLUMN IF NOT EXISTS quorum_required INTEGER;

CREATE TABLE IF NOT EXISTS verifier_receipts (
    id                  UUID PRIMARY KEY,
    task_id             VARCHAR(66) NOT NULL,
    chunk_index         INTEGER NOT NULL,
    round_id            INTEGER NOT NULL,
    verifier_address    VARCHAR(42) NOT NULL,
    evidence_hash       VARCHAR(66) NOT NULL,
    passed              BOOLEAN NOT NULL,
    quality_score       INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
    tx_hash             VARCHAR(66) NOT NULL UNIQUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, chunk_index, round_id, verifier_address)
);
CREATE INDEX IF NOT EXISTS idx_verifier_receipts_round
    ON verifier_receipts(task_id, chunk_index, round_id);

CREATE TABLE IF NOT EXISTS durable_jobs (
    id              UUID PRIMARY KEY,
    queue           VARCHAR(32) NOT NULL CHECK (queue IN ('verification', 'bidding-deadline', 'notifications')),
    dedup_key       VARCHAR(300) NOT NULL,
    target_id       VARCHAR(128) NOT NULL,
    payload         JSONB NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    progress        SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    run_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_by       VARCHAR(200),
    locked_at       TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    result          JSONB,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (queue, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_claim
    ON durable_jobs(queue, target_id, run_at, created_at)
    WHERE status IN ('PENDING', 'RUNNING');

CREATE TABLE IF NOT EXISTS actor_trust_profiles (
    actor_id                VARCHAR(128) PRIMARY KEY,
    actor_type              VARCHAR(20) NOT NULL CHECK (actor_type IN ('HUMAN', 'AGENT', 'TEAM', 'INSTITUTION', 'PLATFORM')),
    assurance_level         SMALLINT NOT NULL CHECK (assurance_level BETWEEN 1 AND 4),
    identity_cluster_hash   VARCHAR(64) NOT NULL CHECK (identity_cluster_hash ~ '^[0-9a-f]{64}$'),
    issuer_id               VARCHAR(128) NOT NULL,
    evidence_digest         VARCHAR(64) NOT NULL CHECK (evidence_digest ~ '^[0-9a-f]{64}$'),
    status                  VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED')),
    valid_until             TIMESTAMPTZ,
    metadata                JSONB NOT NULL DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_actor_trust_cluster
    ON actor_trust_profiles(identity_cluster_hash, assurance_level) WHERE status = 'ACTIVE';

ALTER TABLE contribution_reviews ADD COLUMN IF NOT EXISTS assurance_level SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE contribution_reviews ADD COLUMN IF NOT EXISTS identity_cluster_hash VARCHAR(64);
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS assurance_level SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS identity_cluster_hash VARCHAR(64);
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS contributor_assurance_level SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE contributions ADD COLUMN IF NOT EXISTS contributor_identity_cluster_hash VARCHAR(64);

CREATE TABLE IF NOT EXISTS institutional_approvals (
    id                      UUID PRIMARY KEY,
    problem_id              UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    approval_type           VARCHAR(24) NOT NULL CHECK (approval_type IN ('IRB', 'IRB_EXEMPTION', 'IBC', 'DATA_ACCESS', 'BIOSECURITY', 'LEGAL', 'SECURITY', 'ETHICS')),
    authority_name          VARCHAR(300) NOT NULL,
    authority_identifier    VARCHAR(200) NOT NULL,
    protocol_reference      VARCHAR(200) NOT NULL,
    document_digest         VARCHAR(64) NOT NULL CHECK (document_digest ~ '^[0-9a-f]{64}$'),
    decision                VARCHAR(16) NOT NULL CHECK (decision IN ('APPROVED', 'DENIED', 'SUSPENDED', 'EXPIRED')),
    scope                   JSONB NOT NULL DEFAULT '{}',
    issued_at               TIMESTAMPTZ NOT NULL,
    expires_at              TIMESTAMPTZ,
    recorded_by             VARCHAR(128) NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (problem_id, approval_type, authority_identifier, protocol_reference)
);
CREATE INDEX IF NOT EXISTS idx_institutional_approvals_problem
    ON institutional_approvals(problem_id, approval_type, decision, expires_at);

CREATE TABLE IF NOT EXISTS problem_access_grants (
    id                  UUID PRIMARY KEY,
    problem_id          UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    actor_id            VARCHAR(128) NOT NULL,
    purpose             TEXT NOT NULL,
    terms_digest        VARCHAR(64) NOT NULL CHECK (terms_digest ~ '^[0-9a-f]{64}$'),
    approved_by         VARCHAR(128) NOT NULL,
    issued_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    UNIQUE (problem_id, actor_id)
);
CREATE INDEX IF NOT EXISTS idx_problem_access_active
    ON problem_access_grants(problem_id, actor_id, expires_at) WHERE revoked_at IS NULL;

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS chain_dispute_id BIGINT;
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS settlement_tx_hash VARCHAR(66);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS worker_share_bps INTEGER CHECK (worker_share_bps BETWEEN 0 AND 10000);
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS settlement_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_chain_id
    ON disputes(chain_dispute_id) WHERE chain_dispute_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_open_tx
    ON disputes(tx_hash) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS governance_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(64) NOT NULL,
    actor_id        VARCHAR(128) NOT NULL,
    resource_type   VARCHAR(64) NOT NULL,
    resource_id     VARCHAR(128) NOT NULL,
    decision        VARCHAR(32),
    evidence_digest VARCHAR(64),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_governance_audit_resource
    ON governance_audit_log(resource_type, resource_id, created_at DESC);
