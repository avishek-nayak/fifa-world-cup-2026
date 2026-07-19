/**
 * @file Application entry point.
 *
 * Boots the view once the document is parsed. Generation stays disabled unless
 * an API key is supplied — see {@link module:llm.configureLLM} — so the public
 * demo runs entirely offline on deterministic fallbacks.
 *
 * @module main
 */

import { init } from './ui.js';
import { validateWeights } from './scoring.js';

/* A drifting weight set silently rescales every score, so fail loudly in
   development rather than shipping subtly wrong numbers. */
if (!validateWeights()) {
  console.error('[dispatch] Weight sets do not sum to 1.0 — scores will be misscaled.');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
