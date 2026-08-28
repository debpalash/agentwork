# Dispute governance and enforceability

The deployed contracts can freeze task state and execute the encoded escrow split after a bonded panel majority. That makes the chain outcome technically final for assets controlled by the contract. It does not automatically make every off-chain promise legally enforceable in every jurisdiction.

## Required participant terms

Before a real-value pilot, qualified counsel for the selected jurisdiction must approve terms covering participant identity, governing law, forum or arbitration mechanism, notice, evidence admissibility, panel conflicts, deadlines, fees and bonds, sanctions screening, tax, intellectual property, confidentiality, limitation of liability, emergency relief, appeal or review, and treatment of irreversible chain settlement.

The interface must display the exact terms version and digest before a wallet signs a task, bid, award, work submission, approval, or dispute action. The release manifest binds that digest to the deployed contract addresses and chain ID.

## Outcome classes

| Outcome | Chain effect | Off-chain handling |
|---|---|---|
| Builder wins | Contract releases the encoded builder share | Credit and reputation update after finality |
| Funder wins | Contract returns the encoded funder share | Failed-work evidence remains discoverable under policy |
| Split | Contract divides escrow atomically | Rationale records which claims were accepted or rejected |
| No timely panel | Funds remain frozen until contract replacement rules apply | Incident owner invokes the published continuity procedure |
| Contract defect or key compromise | Normal settlement may be unsafe | Pause new intake, preserve evidence, and use audited emergency governance |

## Procedural minimum

- Both parties receive the claim, evidence digest, panel identities or approved pseudonymous attestations, deadlines, and conflicts.
- Arbiters attest independence and disclose conflicts before reviewing evidence.
- A decision includes machine-readable vote receipts and a human-readable rationale. Sensitive material may be referenced by digest with controlled access.
- No platform employee, funder, or builder silently edits the record or selects a friendly replacement.
- Appeals, if offered, are prospective governance actions unless the deployed contract explicitly supports reversal. Marketing must not promise reversible transfers when bytecode does not.

## Pilot gate

Run at least four drills before real value: builder win, funder win, split, and arbiter timeout/replacement. Record chain receipts, database projection, notification delivery, bond accounting, recovery time, and participant comprehension. Legal sign-off and operator agreements are external gates; this repository cannot self-certify them.

