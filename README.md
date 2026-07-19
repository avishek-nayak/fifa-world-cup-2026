# Dispatch — Stadium Staff Auto-Routing

**A GenAI-enabled operations tool for FIFA World Cup 2026 venue staff.**
When an incident happens, the system decides *which specific person* should
handle it — and shows its work.

![CI](https://github.com/YOUR-USERNAME/YOUR-REPO/actions/workflows/ci.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-121%20passing-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-96%25-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)

[**→ Live demo**](#) · Replace with your GitHub Pages URL after deploying.

---

## The problem

A stadium holds 80,000 people and runs on hundreds of staff across cleaning,
security and medical. When something goes wrong — a spill, an aggressive fan,
a collapse — the current process is a radio call and a supervisor guessing who
is free and nearby.

That guess is made hundreds of times a match, under time pressure, with
incomplete information.

## What this does

1. **Hard filters** eliminate anyone who *cannot* do the job — wrong role,
   missing certification, off shift, on break, no zone access.
2. **Weighted scoring** ranks everyone who survives across five factors.
3. **Dispatch** sends the task to the winner's device with a plain-language
   reason.

The decision is visible throughout. An ops manager can audit why a specific
person was chosen; the staffer knows why it landed on their phone.

---

## Why this isn't "send the nearest person"

**Filters run before scoring.** In the security scenario, Jonas is the closest
responder and never gets scored — he lacks crowd-control L3 certification.

**Weights change by priority.** Urgent tasks weight proximity at 0.50 and
fairness at 0.05. Routine tasks invert it. In the bin-overflow scenario Ravi is
closer, more experienced and already working that zone, and **still loses by 20
points** because he has closed 12 tasks this shift and Sana has closed 2.

**Fatigue is modelled.** Without a load factor the closest reliable staffer
absorbs every task all match. This is the factor most routing demos omit and
the one an operations manager notices first.

---

## Where the AI sits

The routing decision is **deterministic arithmetic, not a language model**.
If an LLM chose who responds to a cardiac arrest, that choice could not be
explained to an investigator or reproduced in review.

Generation is used where it is genuinely superior:

| Function | Job |
|---|---|
| `parseIncident()` | Radio chatter and fan reports → structured task fields |
| `explainAssignment()` | Score vector → the sentence on the staffer's phone |
| `resolveNoMatch()` | Reason about fallbacks when nobody qualifies |

**The triage panel makes this visible.** Type a plain-language report — "someone
collapsed near section 104" — and the parsed fields appear on screen (role,
priority, SLA, certifications, and whether rules or the model produced them)
before the engine routes it. The generative step is demonstrable, not just
described.

Every function degrades to a deterministic implementation when no API key is
configured, so the demo runs fully offline. Enable generation with:

```js
import { configureLLM } from './src/llm.js';
configureLLM('your-api-key');
```

Full reasoning in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The scoring model

### Stage 1 — hard filters

| Filter | Rule |
|---|---|
| Role | Staff role matches the task's required role |
| Certification | All required certifications held |
| On shift | Clocked in, shift doesn't end inside the SLA window |
| Status | Not off-duty, on-break or locked to another incident |
| Zone access | Cleared for that area of the venue |

### Stage 2 — weighted score

```
Score = 100 × Σ (weight × normalised factor)
```

| Factor | Measures | Normalisation |
|---|---|---|
| Proximity | Travel time vs deadline | `1 − (ETA ÷ SLA)`, floored at 0 |
| Availability | Interruptibility | idle 1.0 · finishing 0.6 · active 0.2 |
| Load balance | Fatigue and fairness | `1 − (done ÷ busiest peer)` |
| Capability | Fit beyond qualification | `0.40 seniority + 0.35 kit + 0.25 history` |
| Continuity | Local knowledge | Zone shifts + similar tasks, saturating |

### Weights by priority

| Factor | Urgent | Routine |
|---|---|---|
| Proximity | **0.50** | 0.20 |
| Availability | 0.20 | 0.20 |
| Load balance | 0.05 | **0.35** |
| Capability | 0.20 | 0.15 |
| Continuity | 0.05 | 0.10 |

Proximity uses **travel time, not straight-line distance** — inside a stadium
bowl these diverge sharply.

---

## Running it

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
cd YOUR-REPO
npm test              # 64 tests, no dependencies required
npm run serve         # http://localhost:8000
```

The app uses ES modules, so it must be served over HTTP rather than opened
as a `file://` URL.

### Deploying to GitHub Pages

Push to `main` — the CI workflow tests and deploys automatically. Or manually:
**Settings → Pages → Deploy from a branch → `main` / `root`**.

---

## Testing

```bash
npm test              # 121 tests, no dependencies required
npm run test:coverage # coverage report
npm run lint          # ESLint, zero warnings tolerated
npm run build         # minified dist/index.html
npm run verify        # lint + test + build
```

**Coverage: 96% overall.** Four modules — `scoring.js`, `render.js`, `dom.js`
and `data.js` — sit at 100% lines and functions. Uncovered paths in `llm.js`
are live network calls, deliberately not exercised in CI.

Node has no DOM, so the presentation suites run against a small document stub
defined in the test files. That is enough to assert the property that matters:
text always arrives via `textContent` and is never parsed as markup.

The suite covers configuration integrity (weight sets summing to 1.0), every
normaliser including malformed input, both filter stages, purity and
immutability, tie-breaking determinism, and regression tests pinning all four
demo scenarios — including an assertion that the routine-weights margin stays
decisive rather than becoming a coin flip.

---

## Demo guide

| # | Scenario | The point |
|---|---|---|
| 1 | Wet floor, Gate A | Marcus is closest but filtered on role |
| 2 | Aggressive fan, Sec 118 | Jonas is nearest, cut on missing certification |
| 3 | Fan collapsed, Sec 104 | Lena is close and free but on break |
| 4 | Bin overflow, Gate D | **The strongest.** Routine weights let fairness override proximity, experience and familiarity |

The **1× / 2× / 4×** control sets animation speed.

---

## Project structure

```
index.html              shell — no inline scripts, CSP enforced
build.js                dependency-free bundler and minifier
src/
  scoring.js            pure decision engine (no DOM, no I/O)
  llm.js                generative layer with deterministic fallbacks
  dom.js                safe element construction (no innerHTML)
  render.js             pure element builders
  device.js             staff device panel and task lifecycle
  ui.js                 sequence orchestration
  data.js               incident scenarios and staff pools
  main.js               entry point
  styles.css
tests/
  scoring.test.js       47 tests — engine, filters, regressions
  llm.test.js           17 tests — generative layer and fallbacks
  device.test.js        21 tests — task lifecycle state machine
  dom.test.js           19 tests — safe construction, XSS resistance
  render.test.js        17 tests — element structure
dist/index.html         built artefact (21% smaller than source)
docs/ARCHITECTURE.md
.github/workflows/ci.yml
SECURITY.md
```

### Source and artefact are separate

`npm run build` bundles the modules and strips comments into
`dist/index.html`, regenerating the CSP hashes to match. Source keeps its
JSDoc and formatting; only the shipped file is compressed — so readable code
and a small payload are not in tension.

## Security

- Restrictive CSP: `default-src 'none'`, no inline scripts, single permitted
  API endpoint
- **Zero `innerHTML` usage** — all text via `textContent`, which matters
  because the AI layer accepts free text and returns generated prose
- No API keys in the repository; generation disabled by default

See [`SECURITY.md`](SECURITY.md).

## Accessibility

- Skip-to-content link, semantic landmarks, labelled regions
- `aria-live` announcements for routing decisions
- `aria-busy` during scoring
- Full keyboard operation including arrow-key tab navigation
- `prefers-reduced-motion` honoured — animations collapse to instant
- Responsive to 360px with a tab layout on mobile so the result is never
  buried below the engine

---

## Honest limitations

- **Positioning is simulated.** ETAs are supplied per scenario. Real indoor
  positioning needs BLE beacons or WiFi triangulation — GPS fails inside a
  stadium bowl. This is hardware, not software.
- **No venue graph.** Real travel time needs the stadium modelled as a walkable
  node network with crowd-density weighting.
- **Cold start.** Capability history and continuity need data you won't have on
  day one. Ship at weight 0 and enable as history accumulates.
- **Gaming risk.** If staff see load-balance scores they learn to look busy.
  Expose scores to supervisors only.
- **Scenarios are fixed.** Four hand-authored incidents. The scoring is real;
  the incident stream is not.
- **Fonts load from a CDN.** Self-hosting would remove the last third-party
  dependency — see `SECURITY.md` for the steps.

## Built for

FIFA World Cup 2026 GenAI hackathon — stadium operations.

Venue staff were chosen deliberately. Most entries build the fan-facing
chatbot; staff and volunteers are named in the brief and almost universally
skipped, despite being where operational pain concentrates.

## License

MIT
