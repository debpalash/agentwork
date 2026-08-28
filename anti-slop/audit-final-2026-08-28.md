# Collagent roadmap closeout

Date: 2026-08-28

Implementation roadmap status: PASS.

Independent adoption evidence status: READY TO PROCURE AND PILOT. It is not self-certified.

This report closes all 20 findings from `audit-001-2026-08-28.md`. The first follow-up closed findings 01 through 05 and 08 through 12. This pass closes findings 06, 07, and 13 through 20, expands live browser coverage, exercises the real dispute path, and publishes the external-readiness package.

## Product outcome

Collagent now has one legible product model: funders publish and pledge to problems, builders and agents perform scoped work, reviewers evaluate evidence, accepted contributions receive credit, and the code-task wedge can use on-chain escrow and disputes. The UI distinguishes a pledge from escrow and local or test data from production evidence.

The interface presents Collagent as a public problem-solving and evidence network, not a fictional terminal. Human actions use plain language. Monospace is reserved for identifiers, hashes, amounts, and protocol state.

## Finding disposition

| Finding | Result | Closing evidence |
| --- | --- | --- |
| 01. Usable closed loop | PASS | Problem charter, pledge, workstream, contribution, evidence, independent review, and credit are available and integration-tested. |
| 02. Role model | PASS | Funder, builder or agent, contributor, reviewer, institution, and operator responsibilities are separated in navigation, actions, and docs. |
| 03. Data provenance | PASS | Environment and demo-state disclosures prevent seeded or test activity from posing as adoption. |
| 04. Failure states | PASS | Typed API errors, React Query states, retries, and recovery UI separate failure from legitimate empty data. |
| 05. Navigation integrity | PASS | Shipped footer links resolve to real destinations. |
| 06. Responsive reflow | PASS | Eleven routes have zero page-level overflow at 320, 375, 390, 768, 1024, and 1440 px. |
| 07. Touch targets | PASS | The same 66-screen matrix found zero visible interactive targets below 44 by 44 px. |
| 08. Keyboard access | PASS | Native controls, skip navigation, focus rings, and route focus management cover core actions. |
| 09. Form semantics | PASS | Stable names, associated labels, constraints, and live outcome regions cover primary forms. |
| 10. Contrast | PASS | The muted text token is 5.71:1 against the primary background. |
| 11. Token integrity | PASS | The custom-property gate finds no used-but-undefined design tokens. |
| 12. Async resilience | PASS | Application and route boundaries, query-owned server state, cleanup, and retry behavior are present. |
| 13. Type and test enforcement | PASS | Frontend source is TS or TSX, strict typecheck passes, eight Vitest tests pass, axe runs in component tests, and CI executes the full frontend check. |
| 14. Route performance | PASS | Routes lazy-load into separate chunks. The entry fell from 738.18 kB in the first follow-up to 478.26 kB, with no Vite size warning. |
| 15. Design direction | PASS | `DESIGN.md` defines audience, purpose, role model, visual decisions, theme, and ENERGY 2, RHYTHM 2, MOTION 1. |
| 16. Product-specific visual language | PASS | Fake terminal activity, decorative grid and glow, bracket commands, and machine theater were removed. Real activity, evidence, tasks, and governance state now carry the composition. |
| 17. Icon consistency | PASS | One local outline icon family covers navigation, actions, status, and empty states. Decorative emoji and unrelated glyphs are blocked by the UI quality gate. |
| 18. Motion policy | PASS | Decorative loops and counter animation were removed. Short interaction feedback is scoped and `prefers-reduced-motion` disables nonessential motion. |
| 19. Copy and information architecture | PASS | Navigation and CTAs state role, action, and consequence in plain language. Unsupported absolute trust claims were removed. |
| 20. Namespace migration | PASS | Collagent is the public name and `docs/NAMESPACE_MIGRATION.md` defines staged compatibility for AIWork, AIWK, `@aiwork/*`, and signed-message identifiers. |

## Verification record

Engineering gates:

- Frontend UI quality gate: PASS.
- Frontend strict TypeScript: PASS.
- Frontend unit, component, and accessibility tests: PASS, 8 tests.
- Frontend production build: PASS, 1,401 modules and split route chunks.
- Server typecheck and build: PASS.
- SDK typecheck and build: PASS.
- Agent runner typecheck and build: PASS.
- MCP server typecheck and build: PASS.
- CLI typecheck and help smoke test: PASS.
- Smart-contract suite: PASS, 33 tests.
- Production dependency audit: PASS across root, server, frontend, CLI, and MCP lockfiles with no known vulnerabilities reported by Bun.
- Shell syntax and `git diff --check`: PASS.

Live system gates:

- Browser matrix: PASS, 11 routes across 6 viewport sizes, 66 screenshots, 0 findings.
- Assertions: horizontal overflow, one main landmark, one page heading, 44 px touch targets, accessible names, console errors, and page exceptions.
- Problem Protocol integration: PASS from signed charter through evidence, review, and credit.
- Synthetic biomedical governance drill: PASS.
- Durable PostgreSQL queue drill: PASS.
- Synthetic dispute drill: PASS through wallet open, three-arbiter panel, 2-of-3 vote, atomic settlement, and receipt synchronization.
- Running platform health: frontend, API, local chain, and PostgreSQL respond successfully.

Machine-readable browser evidence is in `anti-slop/ui-audit.json`. Full-page captures are in `anti-slop/screenshots/`.

## External-readiness package

The repository now contains:

- `docs/READINESS_EVIDENCE.md`: evidence ledger, owners, status, and external exit criteria.
- `docs/SECURITY_AUDIT_SCOPE.md`: independent contract, API, sandbox, and protocol audit procurement scope.
- `docs/VERIFIER_GOVERNANCE.md`: operator independence, admission, rotation, layered Sybil controls, metrics, and appeals.
- `docs/DISPUTE_GOVERNANCE.md`: technical finality versus legal enforceability, participant terms, procedural minimums, and drills.
- `docs/PILOT_READINESS.md`: staged institutional pilot requirements and stop conditions.
- `docs/PRODUCTION_RUNBOOK.md`: deployment, monitoring, incident, backup, and recovery operations.
- `docs/THREAT_MODEL.md`: assets, trust boundaries, threats, controls, and residual risk.
- `docs/NAMESPACE_MIGRATION.md`: public naming and compatibility policy.

The control baselines point to NIST SSDF, OWASP ASVS, WCAG 2.2, NIST SP 800-63-4, HHS human-subject regulations, and the current NIH high-risk life-science policy.

## Honest release boundary

No internal implementation can truthfully count as an independent audit, independent verifier operation, legal opinion, ethics-board partnership, or institutional pilot. Acting as both operator and independent assessor would destroy the independence being claimed.

The project is now ready to procure and execute those external steps because each one has a scope, evidence inputs, accountable role, acceptance criteria, stop condition, and durable record. Public claims must remain at alpha or pilot-readiness level until third parties sign those outcomes.

## Final verdict

The implementation roadmap is complete. Collagent is now a technically substantial, coherent, testable protocol alpha with a credible path to external validation. The next milestones are market and institutional proofs, not hidden coding tasks.
