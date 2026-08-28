# Collagent threat model

This model covers the protocol in this repository. It is an internal security
review artifact, not an independent audit or certification.

## Assets and trust boundaries

| Asset | Authority | Failure impact |
|---|---|---|
| Escrowed payment tokens | `EscrowVault` state and role graph | Direct loss, theft, or indefinite lock |
| Task outcome | Task-party wallet plus verifier quorum | Payment for invalid work or denial of earned payment |
| Dispute outcome | Three bonded arbiter wallets | Incorrect irreversible escrow division |
| Verification evidence | Exact commit, TaskSpec policy digest, independent sandbox receipts | False consensus or unreproducible settlement |
| Controlled research | Institutional approval, identity assurance, purpose-bound access | Privacy, ethics, safety, and legal harm |
| Platform signer | Deployment secret/KMS | Role abuse across awards and panel assignment |
| PostgreSQL | API state, durable jobs, audit evidence | Availability loss and projection tampering; never sufficient alone to move escrow |

Trust boundaries are wallet → API, Forgejo → webhook, API → PostgreSQL, verifier
→ sandbox, verifier → chain, and arbiter → chain. PostgreSQL is a searchable
projection/control plane. Chain receipts remain authoritative for escrow,
verification consensus, and dispute settlement.

## Principal adversaries

- A poster attempting to reject valid work or select friendly arbiters.
- A worker submitting a different commit, poisoning verification, or creating
  reviewer/replicator sockpuppets.
- A verifier equivocating, reusing an identity, or reporting simulated work.
- Arbiters colluding, withdrawing stake mid-case, or refusing to vote.
- A malicious repository attempting sandbox escape, network exfiltration, or
  resource exhaustion.
- A compromised API key, platform signer, database role, dependency, or image.
- A problem sponsor trying to route prohibited biomedical work around ethics gates.

## Enforced controls

- Request-bound wallet signatures bind origin, chain, method, path, body digest,
  issued time, and a database-consumed nonce. Production rate limits are shared
  in PostgreSQL.
- Verification rounds snapshot an odd quorum, accept one vote per role-bearing
  wallet, commit all votes to the same artifact/policy digest, and release no
  work until majority consensus is final.
- Production queues fan one artifact to distinct verifier worker IDs. Each
  process requires its own signer and sandbox credentials. Simulated results
  cannot produce a settlement attestation.
- Passing consensus cannot be unilaterally rejected. A contest enters the bonded
  dispute path.
- Disputes freeze task state, exclude task parties from the panel, lock arbiter
  stake, resolve on a two-of-three majority, and divide escrow atomically in the
  resolution transaction. A non-voter can be replaced only after seven days.
- Payment tokens are allowlisted. Incoming escrow and bonuses reject
  fee-on-transfer behavior. Contract state changes precede external transfers.
- High-risk contributions require assurance levels, independent identity
  clusters, conflict disclosure, and distinct review/replication clusters.
- Biomedical work starts quarantined. Human-subject, controlled-data, security,
  ethics, and biosecurity approvals are explicit and expiring. DGOF/IROC work is
  rejected rather than merely labeled.

## Residual risk and release blockers

| Risk | Current status | Mainnet / institutional release gate |
|---|---|---|
| Contract implementation defect | Automated tests and internal adversarial review only | Two independent audits; all Critical/High findings closed |
| Admin/platform-key compromise | Roles remain administratively powerful | Multisig + timelock + hardware/KMS signers + rehearsed rotation |
| Verifier/operator collusion | Economic and identity separation is configurable, not socially guaranteed | Independent operators with published identities and infrastructure attestations |
| Arbiter Sybil/collusion | Role, stake, party exclusion, deterministic selection | Credential policy, independent operators, slashing/appeal governance pilot |
| Sandbox escape | Daytona isolation and exact-commit checks | External sandbox penetration test and restricted-egress deployment evidence |
| Institutional record forgery | API records digests but is not an IRB | Direct institutional partnership and signed source-of-truth integration |
| Biomedical harm | Protocol gates are not medical judgment | IRB/ethics, privacy, biosafety, clinical, and community oversight per pilot |
| Chain reorg/RPC censorship | Receipt waits use the configured client | Multiple RPC providers, confirmation policy, reorg reconciliation drill |
| Database loss | Durable jobs and projections are backed up | Encrypted off-site backups and successful quarterly restore drill |

## Required independent audit questions

Auditors should prioritize escrow conservation under every status transition,
role escalation, quorum-round reset/replay, adversarial ERC-20 behavior, dispute
bond accounting, arbiter replacement, early-majority resolution, chain/database
crash windows, webhook replay, sandbox credential exposure, and cross-identity
review/replication attacks. See [SECURITY.md](../SECURITY.md) for disclosure.
