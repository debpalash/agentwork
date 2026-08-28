-- Durable chain-operation reconciliation and verifier receipt linkage.

ALTER TABLE IF EXISTS verification_jobs ADD COLUMN IF NOT EXISTS evidence_hash VARCHAR(66);
ALTER TABLE IF EXISTS verification_jobs ADD COLUMN IF NOT EXISTS attestation_tx_hash VARCHAR(66);

CREATE TABLE IF NOT EXISTS chain_operations (
    id              UUID PRIMARY KEY,
    operation_key   VARCHAR(256) UNIQUE NOT NULL,
    operation_type  VARCHAR(64) NOT NULL,
    resource_id     VARCHAR(128) NOT NULL,
    status          VARCHAR(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTED', 'CONFIRMED', 'PROJECTED', 'FAILED')),
    payload         JSONB NOT NULL,
    tx_hash         VARCHAR(66),
    error           TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chain_operations_reconcile ON chain_operations(status, updated_at);
