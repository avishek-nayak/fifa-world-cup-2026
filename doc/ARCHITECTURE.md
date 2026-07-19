# Architecture

## The central decision

Routing decisions are **deterministic arithmetic**. Language generation sits
around that core, never inside it.

This is the choice worth defending, so it is stated plainly: if a language
model chose who responds to a cardiac arrest, that choice could not be
explained to an investigator, reproduced in a review, or audited after an
incident. It would also be slower and occasionally wrong in ways that cannot
be predicted from the inputs.

So the two concerns are separated:

| Concern | Implementation | Why |
|---|---|---|
| Who responds | Deterministic scoring (`src/scoring.js`) | Auditable, reproducible, instant, free to run |
| Understanding messy input | Generation (`src/llm.js`) | Radio chatter and fan reports are free-form and ambiguous |
| Explaining the decision | Generation (`src/llm.js`) | Natural phrasing beats string templates |
| Resolving no-match cases | Generation (`src/llm.js`) | Genuine reasoning under ambiguity |

## Module graph

```
main.js          entry point, boots the view
 └── ui.js       rendering and sequencing
      ├── scoring.js   pure decision engine — no DOM, no I/O
      ├── llm.js       generative layer, with deterministic fallbacks
      ├── data.js      incident scenarios and staff pools
      └── dom.js       safe element construction
```

`scoring.js` imports nothing. It is a pure function library, which is why it
reaches 100% line and function coverage in the test suite.

## The scoring model

### Stage 1 — hard filters

Binary eligibility, evaluated in a fixed order so the reported failure reason
is deterministic:

1. `role` — staff role matches the task's required role
2. `certified` — all required certifications held
3. `on shift` — clocked in, and the shift does not end inside the SLA window
4. `status` — not off-duty, on-break, or locked to another incident
5. `zone` — cleared for that area of the venue

Failing any check removes the candidate before any score is computed. This
ordering matters: without it, a very close and very free staffer could win a
medical call on proximity alone despite lacking first-aid certification.

### Stage 2 — weighted scoring

```
Score = 100 × Σ (weight × normalised factor)
```

Every weight set sums to 1.0 and every normalised factor is bounded to 0–1, so
the total is always 0–100. `validateWeights()` asserts this at load time and
the test suite asserts it explicitly.

| Factor | Normalisation | Rationale |
|---|---|---|
| Proximity | `1 − (ETA ÷ SLA)`, floored at 0 | Arriving after the deadline is worth nothing |
| Availability | Discrete state table | Interrupting a nearly-finished task costs less |
| Load balance | `1 − (done ÷ busiest peer)` | Prevents burnout of the most reliable staffer |
| Capability | `0.40 seniority + 0.35 kit + 0.25 history` | Fit beyond bare qualification |
| Continuity | Saturating blend of zone shifts and similar tasks | Local knowledge cuts time |

### Weights shift by priority

| Factor | Urgent | Routine |
|---|---|---|
| Proximity | **0.50** | 0.20 |
| Availability | 0.20 | 0.20 |
| Load balance | 0.05 | **0.35** |
| Capability | 0.20 | 0.15 |
| Continuity | 0.05 | 0.10 |

Urgent work prioritises speed; fairness barely registers. Routine work inverts
that. Scenario 4 in the demo exists to prove this: the closest, most
experienced staffer who already knows the zone loses by 20 points because he
has closed 12 tasks and his colleague has closed 2.

## Generative layer

Three functions, each with a deterministic fallback so the demo runs offline
and CI never depends on a network call:

**`parseIncident(report)`** — free text becomes structured task fields.
Fallback uses keyword matching over the same output shape.

**`explainAssignment(staff, score, task)`** — the score vector becomes the
sentence shown on the staffer's phone. The explanation is derived from the
deterministic result; generation controls wording only, never the decision.

**`resolveNoMatch(task, filtered)`** — when nobody clears the filters, decide
whether to widen the zone, pull an adjacent role, escalate, or defer.

Generation is disabled unless `configureLLM(apiKey)` is called. No key ships
with this repository.

## Security posture

No `innerHTML` anywhere in the application. Every element is built through
`dom.js`, which routes all text through `textContent`. This is not incidental:
`parseIncident()` accepts arbitrary free text and `explainAssignment()` returns
model-generated prose, so neither can be allowed to introduce markup.

A restrictive CSP is enforced by meta tag, permitting only self-hosted scripts,
the font CDN, and a single API endpoint. See `SECURITY.md`.

## Testing

64 tests across two suites, run with `node:test` — no external dependencies.

- `scoring.test.js` — configuration integrity, every normaliser, both filter
  stages, purity and immutability, tie-breaking, and regression tests pinning
  all four demo scenarios
- `llm.test.js` — fallback behaviour for every generative function, malformed
  input handling, and an end-to-end parse → route → explain flow

Coverage: 100% lines and functions on `scoring.js`. The uncovered paths in
`llm.js` are live network calls, which are deliberately not exercised in CI.

## What production would require

| Layer | Requirement |
|---|---|
| Positioning | BLE beacon mesh or WiFi triangulation — GPS fails inside a stadium bowl |
| Roster | Live feed of shifts, roles, certifications, status |
| Venue model | Walkable graph with level changes and crowd-density weighting |
| Task intake | The generative layer wired to real radio and camera feeds |
| Delivery | Push to staff devices with offline degradation for dead zones |

The scoring engine is production-shaped. Everything above it is integration
work.
