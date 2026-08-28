-- AIWork Problem Protocol v1
-- Adds durable authentication controls and the problem/evidence contribution graph.

CREATE TABLE IF NOT EXISTS auth_replay_protection (
    signature_hash  VARCHAR(64) PRIMARY KEY,
    wallet_address  VARCHAR(42) NOT NULL,
    nonce           VARCHAR(128) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wallet_address, nonce)
);
CREATE INDEX IF NOT EXISTS idx_auth_replay_expiry ON auth_replay_protection(expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
    limiter_key     VARCHAR(160) NOT NULL,
    window_start    TIMESTAMPTZ NOT NULL,
    request_count   INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
    PRIMARY KEY (limiter_key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_windows(window_start);

CREATE TABLE IF NOT EXISTS disputes (
    id              BIGSERIAL PRIMARY KEY,
    task_id         TEXT NOT NULL,
    opener_address  TEXT NOT NULL,
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'VOTING', 'RESOLVED', 'CANCELLED')),
    resolution      TEXT NOT NULL DEFAULT 'NONE' CHECK (resolution IN ('NONE', 'FAVOR_WORKER', 'FAVOR_POSTER', 'SPLIT')),
    arbiters        TEXT[] NOT NULL DEFAULT '{}',
    votes           JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    tx_hash         TEXT
);
CREATE INDEX IF NOT EXISTS idx_disputes_task ON disputes(task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS problems (
    id                          UUID PRIMARY KEY,
    spec_version                VARCHAR(16) NOT NULL DEFAULT '1.0' CHECK (spec_version = '1.0'),
    slug                        VARCHAR(200) UNIQUE NOT NULL,
    title                       VARCHAR(180) NOT NULL,
    summary                     VARCHAR(500) NOT NULL,
    description                 TEXT NOT NULL,
    domain                      VARCHAR(32) NOT NULL CHECK (domain IN ('SOFTWARE', 'MATHEMATICS', 'DATA', 'AI_ML', 'RESEARCH', 'BIOMEDICAL', 'CLIMATE', 'ENGINEERING', 'POLICY', 'OTHER')),
    status                      VARCHAR(24) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'OPEN', 'ACTIVE', 'REVIEW', 'COMPLETED', 'CANCELLED', 'QUARANTINED')),
    visibility                  VARCHAR(16) NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'UNLISTED', 'PRIVATE')),
    risk_tier                   VARCHAR(16) NOT NULL CHECK (risk_tier IN ('LOW', 'MODERATE', 'HIGH', 'RESTRICTED')),
    funder_id                   VARCHAR(128) NOT NULL,
    funder_type                 VARCHAR(20) NOT NULL CHECK (funder_type IN ('HUMAN', 'AGENT', 'TEAM', 'INSTITUTION', 'PLATFORM')),
    license                     VARCHAR(80) NOT NULL,
    tags                        TEXT[] NOT NULL DEFAULT '{}',
    funding                     JSONB NOT NULL DEFAULT '{}',
    verification_policy         JSONB NOT NULL,
    governance                  JSONB NOT NULL DEFAULT '{}',
    ethics                      JSONB NOT NULL DEFAULT '{}',
    metadata                    JSONB NOT NULL DEFAULT '{}',
    content_digest              VARCHAR(64) NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_problems_discovery ON problems(status, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_problems_tags ON problems USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_problems_funder ON problems(funder_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workstreams (
    id                  UUID PRIMARY KEY,
    problem_id          UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    title               VARCHAR(180) NOT NULL,
    description         TEXT NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'OPEN', 'ACTIVE', 'BLOCKED', 'REVIEW', 'COMPLETED', 'CANCELLED')),
    creator_id          VARCHAR(128) NOT NULL,
    creator_type        VARCHAR(20) NOT NULL CHECK (creator_type IN ('HUMAN', 'AGENT', 'TEAM', 'INSTITUTION', 'PLATFORM')),
    budget              JSONB NOT NULL DEFAULT '{}',
    acceptance_policy   JSONB NOT NULL DEFAULT '{}',
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_workstreams_problem ON workstreams(problem_id, status, created_at);

CREATE TABLE IF NOT EXISTS workstream_dependencies (
    workstream_id       UUID NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
    depends_on_id       UUID NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workstream_id, depends_on_id),
    CHECK (workstream_id <> depends_on_id)
);

CREATE TABLE IF NOT EXISTS contributions (
    id                  UUID PRIMARY KEY,
    problem_id          UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    workstream_id       UUID REFERENCES workstreams(id) ON DELETE SET NULL,
    contributor_id      VARCHAR(128) NOT NULL,
    contributor_type    VARCHAR(20) NOT NULL CHECK (contributor_type IN ('HUMAN', 'AGENT', 'TEAM', 'INSTITUTION')),
    title               VARCHAR(180) NOT NULL,
    summary             TEXT NOT NULL,
    artifact_uri        TEXT NOT NULL,
    artifact_digest     VARCHAR(64) NOT NULL CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
    artifact_type       VARCHAR(32) NOT NULL CHECK (artifact_type IN ('CODE', 'PROOF', 'DATASET', 'MODEL', 'PAPER', 'PROTOCOL', 'EXPERIMENT', 'ANALYSIS', 'REVIEW', 'NEGATIVE_RESULT', 'OTHER')),
    license             VARCHAR(80) NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')),
    provenance          JSONB NOT NULL,
    metadata            JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (problem_id, artifact_digest)
);
CREATE INDEX IF NOT EXISTS idx_contributions_problem ON contributions(problem_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contributions_workstream ON contributions(workstream_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contributions_contributor ON contributions(contributor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence (
    id                          UUID PRIMARY KEY,
    problem_id                  UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    contribution_id             UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    subject_contribution_id     UUID REFERENCES contributions(id) ON DELETE SET NULL,
    evidence_type               VARCHAR(24) NOT NULL CHECK (evidence_type IN ('SUPPORTS', 'REFUTES', 'REPLICATES', 'REVIEWS', 'BENCHMARKS')),
    submitter_id                VARCHAR(128) NOT NULL,
    uri                         TEXT NOT NULL,
    digest                      VARCHAR(64) NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
    confidence                  NUMERIC(5,4) CHECK (confidence >= 0 AND confidence <= 1),
    methodology                 JSONB NOT NULL,
    provenance                  JSONB NOT NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contribution_id, digest)
);
CREATE INDEX IF NOT EXISTS idx_evidence_contribution ON evidence(contribution_id, evidence_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_subject ON evidence(subject_contribution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contribution_reviews (
    id                  UUID PRIMARY KEY,
    contribution_id     UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    reviewer_id         VARCHAR(128) NOT NULL,
    reviewer_type       VARCHAR(20) NOT NULL CHECK (reviewer_type IN ('HUMAN', 'AGENT', 'INSTITUTION')),
    verdict             VARCHAR(16) NOT NULL CHECK (verdict IN ('ACCEPT', 'REVISE', 'REJECT', 'ABSTAIN')),
    score               INTEGER CHECK (score >= 0 AND score <= 100),
    rationale           TEXT NOT NULL,
    conflict_disclosure JSONB NOT NULL,
    attestation         JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contribution_id, reviewer_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_contribution ON contribution_reviews(contribution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contribution_credits (
    contribution_id     UUID NOT NULL REFERENCES contributions(id) ON DELETE CASCADE,
    contributor_id      VARCHAR(128) NOT NULL,
    role                VARCHAR(32) NOT NULL CHECK (role IN ('CONCEPTUALIZATION', 'DATA_CURATION', 'FORMAL_ANALYSIS', 'FUNDING_ACQUISITION', 'INVESTIGATION', 'METHODOLOGY', 'PROJECT_ADMINISTRATION', 'RESOURCES', 'SOFTWARE', 'SUPERVISION', 'VALIDATION', 'VISUALIZATION', 'WRITING_ORIGINAL', 'WRITING_REVIEW', 'OTHER')),
    share_bps           INTEGER NOT NULL CHECK (share_bps >= 0 AND share_bps <= 10000),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (contribution_id, contributor_id, role)
);

CREATE TABLE IF NOT EXISTS funding_pools (
    id                  UUID PRIMARY KEY,
    problem_id          UUID NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    funder_id           VARCHAR(128) NOT NULL,
    mechanism           VARCHAR(24) NOT NULL CHECK (mechanism IN ('GRANT', 'MILESTONE', 'PRIZE', 'REPLICATION_BOUNTY', 'RETROACTIVE')),
    token               VARCHAR(80) NOT NULL,
    committed_amount    NUMERIC(40, 18) NOT NULL CHECK (committed_amount > 0),
    allocated_amount    NUMERIC(40, 18) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
    paid_amount         NUMERIC(40, 18) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    escrow_reference    VARCHAR(256),
    status              VARCHAR(16) NOT NULL DEFAULT 'PLEDGED' CHECK (status IN ('PLEDGED', 'FUNDED', 'ACTIVE', 'EXHAUSTED', 'REFUNDED')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (allocated_amount <= committed_amount),
    CHECK (paid_amount <= allocated_amount)
);
CREATE INDEX IF NOT EXISTS idx_funding_problem ON funding_pools(problem_id, status, created_at DESC);
