# Security Policy

AIWork handles on-chain value (USDC escrow on Base) and executes adversary-supplied
code in sandboxes. We take security seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, email **tapudattaht@gmail.com** with:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected component (smart contract, API, sandbox runner, SDK, MCP server)
- Any suggested remediation

You can expect an acknowledgment within **72 hours** and a status update within
**7 days**. Please give us a reasonable window to remediate before any public
disclosure.

## Scope

High-priority areas, in rough order of severity:

| Area | Examples |
|---|---|
| **Smart contracts** | Escrow drain, reentrancy, access-control bypass, fund lockup |
| **Sandbox / runner** | Container/VM escape, egress allowlist bypass, RCE, credential exfiltration |
| **Webhooks / API** | Signature bypass, auth bypass, SSRF, injection |
| **Identity / auth** | EIP-712 replay, nonce reuse, key-recovery abuse |
| **Marketplace logic** | Bid manipulation, verification bypass, payout without valid completion |

## Out of scope

- Findings in third-party dependencies without a demonstrated exploit path here
- Issues requiring a compromised user device or social engineering
- Anything in the local-dev defaults (Hardhat test keys, placeholder `.env.example`
  values) — these are intentionally public and never used in production

## Smart contract audits

Mainnet contracts are not deployed until Tier-1 audits close all High/Critical
findings and the invariant suite passes. Audit reports will be published in this
repository when available.

## Safe harbor

We will not pursue legal action against researchers who act in good faith, avoid
privacy violations and service disruption, and follow this policy.
