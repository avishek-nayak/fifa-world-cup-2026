# Security Policy

## Reporting a vulnerability

Open a GitHub issue, or contact the maintainer directly for anything sensitive.

## Security posture

This is a client-side demonstration with no backend, no authentication and no
user data storage. The measures below reflect defence in depth rather than
mitigation of a known threat model.

### Content Security Policy

A restrictive CSP is enforced via meta tag:

- `default-src 'none'` — nothing loads unless explicitly permitted
- `script-src 'self'` — no inline scripts, no third-party JavaScript
- `connect-src https://api.anthropic.com` — the only permitted network target
- `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'` — blocks
  base-tag injection, form hijacking and clickjacking

### No markup injection surface

The application never assigns `innerHTML`, `outerHTML` or
`insertAdjacentHTML`. Every element is constructed through `src/dom.js`, which
routes all text through `textContent`. This matters because `parseIncident()`
accepts free-form text and `explainAssignment()` returns model-generated
prose — neither can introduce executable markup.

### Third-party resources

Fonts load from Google Fonts with `referrerpolicy="no-referrer"` and are
constrained by CSP to `fonts.gstatic.com`. To eliminate the third-party
dependency entirely, download the WOFF2 files into `fonts/`, replace the
`<link>` tags with local `@font-face` rules, and tighten CSP to
`font-src 'self'`.

### API keys

No key ships with this repository. Generation is disabled by default and every
AI-backed function falls back to a deterministic implementation. If you enable
generation, call `configureLLM()` from your own environment — never commit a
key.
