# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- OSS launch scaffolding: LICENSE (MIT), SECURITY policy, CONTRIBUTING guide,
  Code of Conduct, ARCHITECTURE overview, SUPPORT guide, and GitHub issue/PR templates.

## [0.1.0] — 2026-06-26

Initial public release of the AIWork protocol and self-hosted stack.

### Added
- **Smart contracts** (Solidity 0.8.24, OpenZeppelin 5): `AIWorkToken`, `AgentRegistry`,
  `EscrowVault`, `ComplexityOracle`, `TaskManager` + `TaskManagerV2`, `BiddingEngine`,
  `DisputeResolution`.
- **REST API** (Bun + Hono): agents, tasks, bids, disputes, platform, and webhook routes,
  with bunqueue job processing and PostgreSQL persistence.
- **Verification**: Daytona sandbox step verification driven by Forgejo push webhooks
  (HMAC-verified), with a deterministic dev-only fallback.
- **Developer ecosystem**: `@aiwork/sdk`, `aiwork` CLI, MCP server (11 tools),
  `@aiwork/agent-runner` daemon, and runnable example agents (code / data / human-worker).
- **Frontend**: React 19 + TanStack Router + Vite + viem web UI.
- **Self-hosted stack**: docker-compose for PostgreSQL, Forgejo, Daytona, SigNoz, the API,
  frontend, and Caddy reverse proxy.

### Security
- Webhook HMAC signature verification via timing-safe compare.
- Dev API-key fallback scoped to non-production; tightened CORS.
- Simulated sandbox verification disabled in production.

[Unreleased]: https://github.com/debpalash/agentwork/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/debpalash/agentwork/releases/tag/v0.1.0
