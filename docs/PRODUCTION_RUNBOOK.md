# Production runbook

This runbook defines the minimum operable deployment. It does not authorize
mainnet value or biomedical research; those releases also require the external
gates in the threat model.

## Deployment gate

Before deployment:

1. Record the release commit, signed image digests, migration checksums, contract
   addresses, chain ID, and independent audit reports in the change ticket.
2. Verify an odd quorum of at least three `VERIFIER_ROLE` wallets, three bonded
   `ARBITER_ROLE` wallets, a separate panel manager, and a multisig/timelocked
   default administrator. No key may appear in more than one operator set.
3. Resolve every production image variable to `name:tag@sha256:digest`; never use
   `latest`. Store signer and service secrets in the deployment secret manager,
   not an env file or CI log.
4. Run contract tests, API type/build, frontend build, dependency audit,
   production Compose validation, backup verification, and the synthetic pilot
   drills.
5. Validate every image lock, resolve Compose, pull the signed release images,
   and deploy without allowing a node-local rebuild:

   ```sh
   ./scripts/validate-production-env.sh
   docker compose -f docker-compose.yml -f docker-compose.production.yml config --quiet
   docker compose -f docker-compose.yml -f docker-compose.production.yml pull
   docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --no-build
   ```

The production overlay runs two enqueue-only API replicas, one scheduler, and
three independently targeted verifier workers. PostgreSQL claims use
`FOR UPDATE SKIP LOCKED`; crashed claims become reclaimable after ten minutes.
Exhausted jobs remain queryable in `durable_jobs` with status `FAILED`.

## Health and service objectives

- Liveness: `GET /api/v1/platform/live`
- Readiness: `GET /api/v1/platform/ready` (database migration table + chain)
- Dependency health: `GET /api/v1/platform/health`
- Metrics: `GET /api/v1/platform/metrics`
- Queue state: `GET /api/v1/platform/queues`

Initial pilot objectives:

| Indicator | Objective | Page condition |
|---|---:|---:|
| API availability | 99.9% monthly | readiness fails for 5 minutes |
| p95 write latency | under 1 second excluding chain finality | over 2 seconds for 10 minutes |
| Verification queue age | under 5 minutes | oldest runnable job over 15 minutes |
| DLQ | zero unexplained jobs | any new failed settlement/verification job |
| Chain projection lag | under 2 finalized blocks | over 10 finalized blocks |
| Backup RPO / restore RTO | 15 minutes / 2 hours | missed backup or failed drill |

## Backup and restore

Run `scripts/backup-postgres.sh` from a host with `pg_dump`, `pg_restore`, and an
encrypted destination. It creates a custom-format archive, validates its catalog,
and writes a SHA-256 checksum. Copy both files to an encrypted, access-logged,
off-site store with retention controls.

`scripts/verify-backup.sh /absolute/archive.dump` is non-destructive. A restore
drill must use a newly provisioned isolated database, then run API readiness and
the protocol integration tests against it. Never point a drill at production.

On-chain state is reconstructed from chain history and deployment manifests;
database backups cover discovery, access records, audit evidence, and durable
jobs. Reconciliation must never overwrite a finalized chain outcome.

## Incidents

1. Freeze new posting/awards at the edge while preserving reads and evidence.
2. Classify affected boundary: signer, contract, verifier, arbiter, sandbox,
   database, controlled data, or dependency.
3. For signer suspicion, revoke its role from the multisig/timelock and rotate
   service credentials. Do not redeploy contracts until escrow exposure is known.
4. Preserve logs, receipts, job payloads, image digests, and database snapshots.
5. Reconcile chain-first. A database status is never proof of payment or dispute
   resolution.
6. For controlled biomedical data, notify the named institutional/privacy leads
   under the pilot agreement; the platform team must not improvise disclosure law.
7. Publish a post-incident report after containment and coordinated disclosure.

## Rollback

Application replicas use start-first updates and rollback on failed health. A
schema migration is forward-only: restore code compatibility or apply a new
corrective migration. Never edit an applied migration or erase the migration
ledger. Contract rollback means pausing new use and migrating through audited
governance; deployed bytecode is not silently replaced.
