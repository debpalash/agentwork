# Readiness evidence register

This register separates what the repository proves from what an independent party must prove. A checked-in document is preparation evidence, not a certification, partnership, deployment, or legal opinion.

## Release claims

| Claim | Current evidence | Status | Production exit criterion | Accountable role |
|---|---|---|---|---|
| Contract safety | Invariant and lifecycle tests; threat model; audit scope | Internally verified only | Two independent contract audits; all Critical and High findings closed; Medium findings accepted in writing | Security lead |
| Application security | Request-bound wallet signatures, scoped keys, durable audit log, production validation | Internally verified only | Independent OWASP ASVS 5.0 assessment and sandbox penetration test with closure report | Security lead |
| Verifier independence | Distinct configured signers, snapshotted odd quorum, digest-bound votes | Implemented, not decentralized | At least three separately controlled operators; published operator attestations; failure and collusion drills | Protocol governance lead |
| Sybil resistance | Wallet identity, role gates, assurance levels, identity-cluster independence, stake | Layered controls, not proof of personhood | Pilot-specific identity policy, privacy review, red-team attack report, measured false accept/reject rates | Trust and safety lead |
| Dispute outcomes | Bonded three-arbiter panel, party exclusion, on-chain majority settlement | Technically enforceable on-chain | Counsel-approved terms, jurisdiction and appeals policy, operator agreements, incident drill | Legal/governance owner |
| Production operations | Immutable image requirements, migrations, health endpoints, queue leases, backup scripts | Runbook and local evidence | Signed release manifest; restore drill; key-rotation drill; SLO alert drill; operator approval | Site reliability owner |
| Accessibility | Semantic landmarks, keyboard focus, 44px controls, reduced motion, automated axe checks | Automated baseline | Independent WCAG 2.2 AA audit including keyboard, screen reader, zoom, and reflow; findings closed | Product owner |
| Institutional research | Risk quarantine, expiring approvals, access purpose, independent review/replication thresholds | Synthetic governance drill only | Named institutional owner and approvals, signed data agreement, incident contacts, ethics and community oversight | Institutional principal investigator |

## Evidence rules

1. Every artifact records the release commit, scope, author or organization, completion date, findings, exceptions, and a SHA-256 digest.
2. “Independent” means the assessor did not author the assessed control and is free to publish material limitations.
3. A control is not complete when a report merely exists. Its release-blocking findings must be resolved and retested.
4. No biomedical pilot may treat a platform administrator as an IRB, privacy officer, biosafety committee, regulator, clinician, or patient representative.
5. Mainnet and institutional launch decisions require named humans. An agent may prepare evidence but cannot sign accountability away.

## Evidence directory for a release

Create a private, access-controlled release packet with this structure. Publish only artifacts whose disclosure has been approved.

```text
release-evidence/<version>/
  manifest.json
  builds/
  contracts/
  security-audits/
  verifier-operators/
  dispute-governance/
  accessibility/
  operations/
  institutional-approvals/
  exceptions/
```

`manifest.json` must bind every file digest to the release commit and deployment addresses. Approval records should reference source-system identifiers rather than copy sensitive participant data into this repository.

## Standards baseline

- Secure development is mapped to [NIST SP 800-218 SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final).
- Web application assessment uses [OWASP ASVS 5.0](https://owasp.org/www-project-application-security-verification-standard/).
- Interface evaluation targets [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/).
- Identity policy should use the current [NIST SP 800-63-4 Digital Identity Guidelines](https://csrc.nist.gov/pubs/sp/800/63/4/final) where applicable.
- U.S. human-subject research must be evaluated by the responsible institution under [45 CFR 46 and the Common Rule](https://www.hhs.gov/ohrp/regulations-and-policy/regulations/index.html); other jurisdictions require their own analysis.
- High-risk life-science policy is time-sensitive. The institutional owner must review current authority, including the NIH [USG Policy for Stopping High-Risk Life Sciences Research](https://grants.nih.gov/grants/guide/notice-files/NOT-OD-26-101.html), before intake.

