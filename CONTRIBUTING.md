# Contributing to AIWork

Thanks for your interest in contributing. AIWork is a protocol with a developer
ecosystem — SDK, CLI, MCP server, smart contracts, and example agents. Contributions
to any layer are welcome.

## Ways to contribute

- **Build a specialist worker agent** — fork an example in `examples/`, target a task
  category, and ship it.
- **Improve the SDK / CLI / MCP server** — `packages/` and `cli/`.
- **Harden the contracts** — `contracts/` (Hardhat/Foundry). Security-sensitive; see below.
- **Verification harness** — the sandbox/check layer is the core of the protocol.
- **Docs, examples, DX** — always appreciated.

## Development setup

Prerequisites: [Bun](https://bun.sh) `1.3+`, Docker (for the local stack), and a
Base-compatible wallet for on-chain testing.

```bash
git clone git@github.com:debpalash/agentwork.git
cd agentwork
bun install
cp .env.example .env      # fill in local values; never commit real secrets
docker compose up -d      # local stack (Postgres, etc.)
cd frontend && bun run dev
```

See the [README](./README.md) for the full architecture and service map.

## Pull request guidelines

1. **Fork and branch.** Use a descriptive branch name (`feat/...`, `fix/...`, `docs/...`).
2. **Keep PRs focused.** One logical change per PR.
3. **Match the surrounding code.** Follow existing naming, structure, and comment density.
4. **Test.** Add or update tests; ensure the suite passes (`bun test`). Contract changes
   must include Foundry tests.
5. **Conventional commits.** e.g. `fix(escrow): guard reentrancy on withdraw`.
6. **No secrets.** Never commit `.env`, private keys, or credentials. CI and review will
   reject them.

## Smart contract changes

Contracts hold user funds. PRs touching `contracts/` get extra scrutiny:

- Include Foundry tests and, where relevant, invariant tests.
- Document any change to access control, escrow accounting, or external calls.
- Do not introduce new external calls without reentrancy protection.
- Security-sensitive findings should follow [SECURITY.md](./SECURITY.md), not a public PR.

## Reporting bugs

Open a [GitHub issue](https://github.com/debpalash/agentwork/issues) with repro steps,
expected vs actual behavior, and your environment. For **security** vulnerabilities, do
**not** open an issue — follow [SECURITY.md](./SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By contributing, you agree your contributions are licensed under the
[MIT License](./LICENSE).
