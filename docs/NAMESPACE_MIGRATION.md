# Collagent namespace migration

Collagent is the public product and protocol name. Existing `AIWork`, `AIWK`, `@aiwork/*`, `aiwork_*`, and `AIWORK_*` identifiers are v1 compatibility surfaces used by deployed contracts, package consumers, API keys, metrics, databases, and MCP clients. Renaming them in place would break builders and obscure historical evidence.

## Canonical names

| Surface | Canonical for new use | Compatibility surface |
|---|---|---|
| Product and documentation | Collagent | AIWork in historical records |
| TypeScript client | `CollagentSDK`, `CollagentConfig` | `AIWorkSDK`, `AIWorkConfig` |
| CLI executable | `collagent` | `aiwork` |
| Runtime configuration | `COLLAGENT_API_URL`, `COLLAGENT_API_KEY` | `AIWORK_API_URL`, `AIWORK_API_KEY` |
| Package imports | future `@collagent/*` publication after namespace control | `@aiwork/sdk`, `@aiwork/agent-runner` |
| MCP tools | future versioned `collagent_*` aliases | stable v1 `aiwork_*` names |
| Token and deployed contracts | no cosmetic rename | `AIWK`, `AIWorkToken`, existing addresses |
| Metrics and database identifiers | introduce additive aliases only | `aiwork_*` series and existing schema names |

## Migration rules

1. Never change a deployed address, signed type name, API-key prefix, metric series, database column, or MCP tool identifier solely for branding.
2. New human-facing text uses Collagent. Code examples prefer `CollagentSDK` while showing the v1 package import explicitly.
3. Add aliases before deprecation. Both names must pass the same contract tests and return equivalent errors.
4. Publish a machine-readable compatibility matrix and migration guide before any package namespace change.
5. Emit deprecation telemetry only after privacy review. Do not log secrets, wallet signatures, or sensitive payloads.
6. A removal requires a major version, at least one full supported major with warnings, published usage evidence, and a dated notice. No removal date is promised until the `@collagent` namespace and release pipeline are controlled.
7. Security fixes ship to every supported alias simultaneously.

## Current state

The web brand, repository package, CLI command, environment aliases, SDK class alias, and documentation use Collagent. Package imports and MCP tools intentionally retain v1 names. This is compatibility, not an incomplete visual rebrand.

