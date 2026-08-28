# Independent security assessment scope

This is a procurement-ready scope, not an audit report. Assessors must be independent, name their methods and limitations, and test the pinned release commit and deployed bytecode.

## Required workstreams

### 1. Smart contracts

Assess `AgentRegistry`, `TaskManager`, `EscrowVault`, `DisputeResolution`, `BiddingEngine`, `ComplexityOracle`, token interactions, deployment scripts, and the complete role graph. Prioritize:

- escrow conservation across every state transition;
- reentrancy and adversarial ERC-20 behavior, including fee-on-transfer and callback tokens;
- integer rounding, milestone percentages, bonuses, cancellation, timeouts, and double release;
- role escalation, upgrade or replacement authority, verifier round replay, equivocation, and quorum reset;
- dispute bond accounting, party exclusion, panel replacement, early majority, and atomic settlement;
- chain reorganization assumptions and API/database crash windows.

Deliver manual review, static analysis, property and invariant tests, attack proofs for findings, and deployed-bytecode comparison.

### 2. API, identity, and web application

Assess against the pinned [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/) requirement identifiers. Cover wallet-message origin/method/path/body binding, nonce consumption, API-key scope, IDOR, role resolution, institutional-record authorization, SQL injection, SSRF, stored and reflected script injection, request limits, CORS, CSP, secrets, audit integrity, and rate-limit distribution.

### 3. Sandbox and supply chain

Attempt repository-to-host escape, credential theft, metadata-service access, unrestricted egress, dependency confusion, resource exhaustion, verifier-result forgery, commit substitution, and cross-job data access. Verify pinned images, signatures, SBOMs, provenance, secret separation, and the production refusal of simulated verification.

### 4. Protocol abuse

Model verifier and arbiter collusion, identity-cluster Sybils, review rings, bribery, griefing, withheld votes, malicious funders, malicious builders, webhook replay, and evidence-graph poisoning. Record which failures are prevented, detected, recoverable, or accepted.

## Deliverables

- executive report with explicit scope and exclusions;
- technical findings with severity, exploitability, affected commit, proof, and remediation;
- contract invariants and test artifacts contributed under an agreed license;
- ASVS matrix using versioned requirement identifiers;
- sandbox penetration-test evidence and egress map;
- retest letter that lists closed, open, and risk-accepted findings;
- report digest and assessor signature.

## Acceptance gate

Mainnet remains blocked until two independent contract assessors complete retesting, every Critical and High issue is closed, and every remaining issue has a named owner, deadline, and signed risk decision. An application or sandbox assessment cannot substitute for a contract audit, and one vendor cannot count as two independent assessors.

The secure-development evidence package should also map repository practices to [NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final), including protected environments, dependency provenance, vulnerability response, and retention of release evidence.

