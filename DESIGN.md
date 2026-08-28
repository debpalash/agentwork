# Collagent design direction

This direction is derived from the owner-approved Collagent name, the simplified C-to-node mark, the product thesis "One problem. A world of minds.", and the current evidence-led protocol implementation.

## Design read

Collagent is a public problem-solving network for builders, researchers, funders, and reviewers. The interface should feel like an evidence ledger: rigorous, open, calm under complexity, and visibly built for coordinated work rather than speculative trading.

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

- ENERGY 2: the public landing page must attract serious participation without turning scientific and technical work into spectacle.
- RHYTHM 2: work screens use predictable ledgers and graphs, while public pages vary composition to explain the protocol without repeating card grids.
- MOTION 1: hover, press, focus, and state transitions only. Evidence, status, and causality must never compete with decorative motion.

## Identity

The core motif is a path that becomes a node. The open C represents an unsolved problem; the line and terminal node represent contributions moving toward a verifiable result. Use connecting rules, dependency lines, and evidence relationships when the data requires them. Do not use a decorative background grid.

The voice is direct, rigorous, and inviting. Prefer concrete protocol nouns such as problem, workstream, contribution, evidence, review, credit, and funding pledge. Avoid invented certainty, generic AI vocabulary, terminal costume, and military command-center language.

## Color

- Deep ink surfaces (`#061012` through `#12282c`) keep dense evidence and provenance views readable during long technical sessions.
- Signal lime (`#b9ff66`) marks the single primary action or active navigation state. It is not general decoration.
- Provenance cyan (`#62e5ff`) marks links, identifiers, and evidence relationships.
- Review violet (`#9c8cff`) is reserved for review and dispute context.
- Red, amber, and green are semantic states only and always appear with text or an icon.
- Neutral text and borders carry most hierarchy so state colors remain meaningful.

The logo gradient is an approved brand asset. Elsewhere, use flat color unless a data visualization needs a continuous scale.

## Typography

- Inter is the body and display face because the platform contains long charters, review notes, forms, and dense lists that need a neutral, highly readable sans serif.
- JetBrains Mono is limited to hashes, addresses, code, exact protocol states, timestamps, and tabular figures. It must not define page headings or ordinary controls.
- Headings use natural capitalization and compact tracking. Interface labels describe actions in plain language.

## Shape, spacing, and elevation

- Use an 8px spacing rhythm with 4px only inside compact data rows.
- Controls are at least 44px high and have at least 8px between adjacent touch targets.
- Primary panels use 8px corners; nested data rows use 4px; status tags may be compact rectangles. Avoid making every surface a pill.
- Most surfaces stay flat with 1px separators. A shadow is reserved for temporary layers such as wallet menus and dialogs because those layers sit above the work surface.
- Content width follows the task: readable prose stays narrow, evidence graphs and operational tables may use the full work area.

## Layout hierarchy

Every screen has one focal decision:

- Landing: understand the protocol and open the live problem network.
- Problems: choose a real problem or inspect its evidence graph.
- Overview: find work that needs attention.
- Tasks: select executable work.
- Builders: assess a contributor's capabilities and record.
- Post: publish human-authored task requirements for agents and builders.
- Disputes: inspect evidence and take the allowed review action.
- Docs: complete a real integration step.

Public pages should show real indexed activity and protocol state. Product demonstrations must use working UI or clearly labeled empty states, never fake terminal windows, fabricated people, or invented statistics.

## Icons

Use the Collagent outline icon family: 24px view box, 1.75px stroke, square or slightly rounded geometry, and no fill at the primary navigation level. Each icon represents a protocol object or action. Decorative icons beside visible labels are hidden from assistive technology; icon-only controls have an accessible name.

## Responsive behavior

Mobile is a distinct layout. Primary content comes first, columns stack, long identifiers wrap, data tables become contained scroll regions or labeled rows, and navigation opens from a labeled 44px control. No page may rely on `overflow-x: hidden` to conceal a layout defect.

Verify at 320, 375, 390, 768, 1024, and 1440 CSS pixels, including landscape at a phone-height viewport. Fixed or sticky interface elements must not cover content or keyboard focus.

## Motion policy

Use shared 120ms and 180ms transition tokens for color, border, and opacity feedback. Do not animate layout dimensions or run infinite pulses, counters, floating elements, or background movement. Under `prefers-reduced-motion: reduce`, remove nonessential transition time and disable smooth scrolling.

## Decision reasons

- Dark default: Collagent is a dense technical work surface used for sustained review, and the owner-approved campaign already establishes this identity.
- Lime accent: it continues the approved mark and creates one unmistakable action signal.
- Cyan provenance: it distinguishes machine-readable links and evidence relationships from actions.
- Violet review state: it separates deliberation from success, failure, and funding semantics.
- Flat evidence-led surfaces: stable separators make relationships easier to scan than decoration or elevation.
- Limited monospace: exact protocol data benefits from fixed character shapes, while prose benefits from a readable sans serif.
- Low motion: reviewers need stable evidence and status, not attention-seeking animation.
- Custom SVG icons: protocol-specific objects need one coherent visual language that remains crisp and themeable.
