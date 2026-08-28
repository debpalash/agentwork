# Verifier, arbiter, and Sybil governance

Smart contracts can enforce role membership, distinct wallets, stake, quorum, and digest-bound votes. They cannot prove that three wallets are controlled by three independent people or organizations. Production therefore combines technical controls with operator governance.

## Independence unit

The independence unit is an operator organization, not a wallet. Each operator discloses legal controller, beneficial control relevant to conflicts, hosting provider and region, signing system, verifier software digest, and relationships to funders, builders, other operators, and the platform company. Sensitive identity evidence stays with an approved assurance provider; the public registry receives an attestation and expiry, not raw documents.

The registry rejects overlapping operator control for the same quorum. Wallet rotation does not create a new independence unit.

## Admission and rotation

1. Governance publishes objective capability, identity, conflict, stake, and availability criteria.
2. A separate trust reviewer validates the organization and infrastructure attestation.
3. The candidate completes deterministic conformance vectors and a malicious-repository sandbox drill.
4. A timelocked multisig grants the least-privilege role after a public notice period.
5. Attestations expire. Operators re-attest at least annually and after a material control change.
6. Scheduled rotation limits entrenched panels; emergency removal requires a recorded reason and later review.

No funder, builder, task party, or shared beneficial controller may verify or arbitrate its own outcome. Assignment samples distinct eligible operator clusters from finalized-chain entropy and snapshots membership for the round.

## Sybil defense layers

| Layer | Stops | Does not prove |
|---|---|---|
| Wallet signature and nonce | Request forgery and replay | Unique human or organization |
| Scoped role and expiring assurance | Unauthorized capability use | Independence by itself |
| Identity-cluster exclusion | Multiple accounts from one known controller | Undisclosed common control |
| Stake and slashing path | Cost-free equivocation and some non-performance | Honest judgment |
| Distinct infrastructure attestation | Obvious shared-host failure | No hidden coordination |
| Random assignment and rotation | Easy panel capture | Bribery resistance |
| Public receipts and challenge window | Undetectable inconsistent votes | Correct underlying evidence |
| Independent audits and red teams | Known implementation weaknesses | Permanent security |

Token balance, social accounts, API keys, and wallet count are never sufficient identity evidence. Higher-risk domains require stronger assurance, conflict review, and statistically independent replication.

## Operating measures

Publish per epoch: eligible operator count, controller concentration, infrastructure concentration, assignment distribution, agreement rate, abstention and timeout rate, challenged outcomes, overturned outcomes, slash events, median verification time, software-version diversity, and correlated failures. Raw participant or controlled-research data must not be exposed.

Production targets at least three operators for a quorum and should grow beyond the minimum so one outage does not halt settlement. No controller or hosting provider should hold enough assigned seats to form a majority. If that condition is breached, new high-value work pauses.

## Failure and appeal

Equivocation, forged receipts, undeclared conflicts, repeated non-performance, or compromised signers trigger suspension. Pending rounds preserve their snapshot unless the documented replacement timeout fires. Evidence remains immutable. Disputed outcomes follow [dispute governance](./DISPUTE_GOVERNANCE.md), and operator removal never rewrites a finalized chain receipt.

Where identity assurance is required, pilot owners should select levels using the current [NIST SP 800-63-4](https://csrc.nist.gov/pubs/sp/800/63/4/final) and applicable local privacy law. Collagent does not claim universal proof-of-personhood.

