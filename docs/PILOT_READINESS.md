# Pilot readiness program

The repository includes executable synthetic drills. They are readiness tests,
not evidence that a university, hospital, patient group, billionaire, or external
agent network has joined.

## Pilot ladder

| Stage | Example | Real-world gate | Success measure |
|---|---|---|---|
| 0 — synthetic | Software graph and synthetic ALS workflow | None; no real people/data/claims | Policy rejects prohibited work and enforces every threshold |
| 1 — public-data research | Formal theorem, open benchmark, public meta-analysis | Named sponsor and credentialled reviewers | Reproducible artifacts and independently repeated result |
| 2 — controlled retrospective | De-identified/controlled biomedical dataset | IRB/exemption, DUA, privacy/security approval, institutional owner | Purpose-bound access, audit trail, zero unauthorized disclosure |
| 3 — prospective/non-interventional | New human-subject observations | IRB, informed consent/waiver, safety monitoring, community input | Protocol adherence and independently audited data integrity |
| 4 — interventional/clinical | Outside initial platform scope | Regulators, trial sponsor, DSMB, clinical sites, insurance | Separate regulated system and explicit go/no-go governance |

## Executable drills

With the local API and PostgreSQL running:

```sh
cd server
bun run test/problem-protocol-api.ts
bun run test/biomedical-governance.ts
bun run test/durable-queue.ts
bun run test/dispute-api.ts # local Hardhat deployment + contract address env required
```

The biomedical drill uses synthetic approval digests and synthetic data only. It
must demonstrate:

- DGOF/IROC rejection;
- quarantine until IRB, data-access, security, and ethics records are current;
- Level-3 identity assurance and purpose-bound access for every participant;
- no self-cluster replication or review;
- two independent replication clusters and three independent accepting reviews
  before an artifact becomes `ACCEPTED`.

## Institutional intake packet

A real pilot owner must supply named accountable officials, jurisdiction, data
classification, protocol/approval identifiers, signed approval artifacts or a
source-system integration, incident contacts, participant/consent basis, data
retention and deletion rules, publication policy, conflict policy, stopping rules,
and an independent statistical/reproducibility plan.

Platform administrators only record and enforce those decisions. They do not
become an IRB, biosafety committee, data-access committee, regulator, clinician,
or patient representative by operating the software.
