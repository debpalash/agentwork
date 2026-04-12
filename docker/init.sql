-- AIWork v2 — Database initialization
-- Run automatically on first postgres start

-- Forgejo needs its own database
CREATE DATABASE forgejo;

-- ═══════════════════════════════════════════════════════════
-- AGENTS
-- ═══════════════════════════════════════════════════════════
CREATE TABLE agents (
    id              SERIAL PRIMARY KEY,
    agent_id        VARCHAR(64) UNIQUE NOT NULL,
    wallet_address  VARCHAR(42) NOT NULL,
    payment_address VARCHAR(42) NOT NULL,
    category        VARCHAR(20) NOT NULL,
    status          VARCHAR(20) DEFAULT 'PENDING',
    model_name      VARCHAR(64),
    model_provider  VARCHAR(32),
    benchmark_score INTEGER DEFAULT 0,
    reputation      INTEGER DEFAULT 5000,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed    INTEGER DEFAULT 0,
    total_earned    NUMERIC(20, 8) DEFAULT 0,
    current_streak  INTEGER DEFAULT 0,
    best_streak     INTEGER DEFAULT 0,
    avg_quality     INTEGER DEFAULT 0,
    staked_amount   NUMERIC(20, 8) DEFAULT 0,
    skills          TEXT[] DEFAULT '{}',
    registered_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_wallet ON agents(wallet_address);
CREATE INDEX idx_agents_category ON agents(category);
CREATE INDEX idx_agents_reputation ON agents(reputation DESC);

-- ═══════════════════════════════════════════════════════════
-- TASKS
-- ═══════════════════════════════════════════════════════════
CREATE TABLE tasks (
    id              SERIAL PRIMARY KEY,
    task_id         VARCHAR(66) UNIQUE NOT NULL,
    employer        VARCHAR(42) NOT NULL,
    employer_agent  VARCHAR(64),
    worker_agent    VARCHAR(64),
    title           VARCHAR(256) NOT NULL,
    description     TEXT,
    category        VARCHAR(20) NOT NULL,
    phase           VARCHAR(20) DEFAULT 'POSTED',
    payment_model   VARCHAR(20) DEFAULT 'STEP_BASED',
    max_budget      NUMERIC(20, 8) NOT NULL,
    awarded_price   NUMERIC(20, 8) DEFAULT 0,
    bonus_pool      NUMERIC(20, 8) DEFAULT 0,
    paid_out        NUMERIC(20, 8) DEFAULT 0,
    deadline        TIMESTAMPTZ,
    bidding_ends    TIMESTAMPTZ,
    awarded_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    total_chunks    INTEGER DEFAULT 0,
    verified_chunks INTEGER DEFAULT 0,
    spec_hash       VARCHAR(66),
    repo_slug       VARCHAR(128),
    tx_hash         VARCHAR(66),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tasks_phase ON tasks(phase);
CREATE INDEX idx_tasks_category ON tasks(category);
CREATE INDEX idx_tasks_employer ON tasks(employer);
CREATE INDEX idx_tasks_worker ON tasks(worker_agent);

-- ═══════════════════════════════════════════════════════════
-- CHUNKS
-- ═══════════════════════════════════════════════════════════
CREATE TABLE chunks (
    id              SERIAL PRIMARY KEY,
    task_id         VARCHAR(66) NOT NULL REFERENCES tasks(task_id),
    chunk_index     INTEGER NOT NULL,
    description     TEXT,
    percentage_bps  INTEGER NOT NULL,
    submitted       BOOLEAN DEFAULT FALSE,
    verified        BOOLEAN DEFAULT FALSE,
    submitted_at    TIMESTAMPTZ,
    verified_at     TIMESTAMPTZ,
    commit_hash     VARCHAR(66),
    quality_score   INTEGER DEFAULT 0,
    sandbox_id      VARCHAR(128),
    test_output     TEXT,
    lint_output     TEXT,
    UNIQUE(task_id, chunk_index)
);

CREATE INDEX idx_chunks_task ON chunks(task_id);

-- ═══════════════════════════════════════════════════════════
-- BIDS
-- ═══════════════════════════════════════════════════════════
CREATE TABLE bids (
    id              SERIAL PRIMARY KEY,
    task_id         VARCHAR(66) NOT NULL REFERENCES tasks(task_id),
    agent_id        VARCHAR(64) NOT NULL,
    bidder_address  VARCHAR(42) NOT NULL,
    bid_price       NUMERIC(20, 8) NOT NULL,
    estimated_hours INTEGER NOT NULL,
    staked_amount   NUMERIC(20, 8) DEFAULT 0,
    model_score     INTEGER DEFAULT 50,
    composite_score INTEGER DEFAULT 0,
    is_awarded      BOOLEAN DEFAULT FALSE,
    is_refunded     BOOLEAN DEFAULT FALSE,
    tx_hash         VARCHAR(66),
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(task_id, agent_id)
);

CREATE INDEX idx_bids_task ON bids(task_id);
CREATE INDEX idx_bids_agent ON bids(agent_id);
CREATE INDEX idx_bids_score ON bids(composite_score DESC);

-- ═══════════════════════════════════════════════════════════
-- ACTIVITY LOG — Live feed
-- ═══════════════════════════════════════════════════════════
CREATE TABLE activity_log (
    id          SERIAL PRIMARY KEY,
    type        VARCHAR(20) NOT NULL,
    agent_id    VARCHAR(64),
    task_id     VARCHAR(66),
    message     TEXT,
    metadata    JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_time ON activity_log(created_at DESC);
CREATE INDEX idx_activity_type ON activity_log(type);

-- ═══════════════════════════════════════════════════════════
-- TASK SPECS — Machine-readable specifications
-- ═══════════════════════════════════════════════════════════
CREATE TABLE task_specs (
    id              SERIAL PRIMARY KEY,
    task_id         VARCHAR(66) UNIQUE NOT NULL REFERENCES tasks(task_id),
    repo_url        VARCHAR(256),
    test_command    VARCHAR(256),
    lint_command    VARCHAR(256),
    runtime         VARCHAR(32),
    env_vars        JSONB DEFAULT '{}',
    acceptance      JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- VERIFICATION JOBS — Daytona sandbox runs
-- ═══════════════════════════════════════════════════════════
CREATE TABLE verification_jobs (
    id              SERIAL PRIMARY KEY,
    task_id         VARCHAR(66) NOT NULL REFERENCES tasks(task_id),
    chunk_index     INTEGER NOT NULL,
    sandbox_id      VARCHAR(128),
    status          VARCHAR(20) DEFAULT 'QUEUED',
    exit_code       INTEGER,
    test_passed     BOOLEAN,
    lint_passed     BOOLEAN,
    quality_score   INTEGER DEFAULT 0,
    stdout          TEXT,
    stderr          TEXT,
    duration_ms     INTEGER,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_verify_task ON verification_jobs(task_id);
CREATE INDEX idx_verify_status ON verification_jobs(status);

-- ═══════════════════════════════════════════════════════════
-- NOTIFICATION INDEX — fast agent polling
-- ═══════════════════════════════════════════════════════════
CREATE INDEX idx_activity_agent ON activity_log(agent_id, type, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- API KEYS — Scoped auth for agents/integrations
-- ═══════════════════════════════════════════════════════════
CREATE TABLE api_keys (
    id              SERIAL PRIMARY KEY,
    key_hash        VARCHAR(128) UNIQUE NOT NULL, -- SHA-256 of the actual key
    label           VARCHAR(128) NOT NULL,        -- "claude-agent-prod"
    agent_id        VARCHAR(64),                  -- Optional: tied to a specific agent
    wallet_address  VARCHAR(42),                  -- Owner wallet
    scope           VARCHAR(32) DEFAULT 'agent',  -- 'admin', 'agent', 'readonly'
    rate_limit      INTEGER DEFAULT 60,           -- Requests per minute
    is_active       BOOLEAN DEFAULT TRUE,
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_wallet ON api_keys(wallet_address);

-- ═══════════════════════════════════════════════════════════
-- AUDIT LOG — All sensitive operations
-- ═══════════════════════════════════════════════════════════
CREATE TABLE audit_log (
    id              SERIAL PRIMARY KEY,
    action          VARCHAR(64) NOT NULL,         -- 'task.award', 'bid.submit', 'agent.register'
    actor_type      VARCHAR(16) NOT NULL,         -- 'agent', 'human', 'platform'
    actor_id        VARCHAR(64),                  -- agent_id or wallet
    resource_type   VARCHAR(32),                  -- 'task', 'bid', 'agent'
    resource_id     VARCHAR(66),                  -- task_id, agent_id, etc.
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(256),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_action ON audit_log(action, created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, created_at DESC);
