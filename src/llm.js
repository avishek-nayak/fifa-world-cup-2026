/**
 * @file Generative AI layer.
 *
 * The routing decision itself is deterministic (see {@link module:scoring}) —
 * a language model must never choose who responds to a medical emergency,
 * because that choice has to be auditable and reproducible.
 *
 * Generation is used where it is genuinely superior to rules:
 *
 *  1. {@link parseIncident} — unstructured radio chatter, fan-app reports and
 *     camera events become structured task fields.
 *  2. {@link explainAssignment} — the score vector becomes the sentence the
 *     staffer reads on their phone.
 *  3. {@link resolveNoMatch} — when nobody clears the filters, reason about
 *     the fallback rather than failing silently.
 *
 * Every function degrades to a deterministic implementation when no API key
 * is configured, so the demo is fully functional offline and in CI.
 *
 * @module llm
 */

import { FACTOR_KEYS, SCORING } from './scoring.js';

/** @constant */
const API_URL = 'https://api.anthropic.com/v1/messages';
/** @constant */
const MODEL = 'claude-sonnet-4-6';

/**
 * Runtime configuration. `apiKey` stays null in the public demo — the fallback
 * paths produce identical structure without a network call.
 * @type {{apiKey: (string|null), enabled: boolean, timeoutMs: number}}
 */
export const llmConfig = {
  apiKey: null,
  enabled: false,
  timeoutMs: 8000
};

/**
 * Enable live generation.
 * @param {string} apiKey
 */
export function configureLLM(apiKey) {
  llmConfig.apiKey = apiKey;
  llmConfig.enabled = Boolean(apiKey);
}

/**
 * Minimal Messages API call with timeout and abort handling.
 *
 * @param {string} prompt
 * @param {number} [maxTokens=400]
 * @returns {Promise<string>} Raw text content.
 * @throws {Error} On timeout, network failure, or non-OK response.
 * @private
 */
async function callModel(prompt, maxTokens = 400) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), llmConfig.timeoutMs);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Model returned ${res.status}`);
    const data = await res.json();
    return (data.content ?? [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip markdown fences a model may wrap around JSON, then parse.
 * @param {string} text
 * @returns {Object}
 * @private
 */
function parseJSONResponse(text) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

/* ------------------------------------------------------------------ *
 * 1. Incident parsing
 * ------------------------------------------------------------------ */

/** @constant */
const ROLE_HINTS = Object.freeze({
  medical: ['collapse', 'collapsed', 'unwell', 'faint', 'bleeding', 'injured', 'chest pain', 'unconscious', 'seizure'],
  security: ['aggressive', 'fight', 'altercation', 'intruder', 'pitch invasion', 'threat', 'abusive'],
  facilities: ['spill', 'wet floor', 'bin', 'overflow', 'litter', 'blocked', 'leak', 'toilet']
});

/** @constant */
const CERT_HINTS = Object.freeze({
  medical: ['first-aid'],
  security: ['crowd-l3'],
  facilities: []
});

/**
 * Deterministic fallback parser — keyword matching over the same fields the
 * model returns, so downstream code is agnostic to which path ran.
 *
 * @param {string} report
 * @returns {Object} Structured task.
 * @private
 */
function parseIncidentFallback(report) {
  const text = String(report ?? '').toLowerCase();

  let needRole = 'facilities';
  let best = 0;
  for (const [role, words] of Object.entries(ROLE_HINTS)) {
    const hits = words.filter(w => text.includes(w)).length;
    if (hits > best) { best = hits; needRole = role; }
  }

  const isUrgent = needRole === 'medical' || needRole === 'security' ||
    /urgent|immediately|surge|emergency|now/.test(text);

  const sectionMatch = text.match(/(?:section|sec|gate)\s*([a-z0-9]+)/i);
  const loc = sectionMatch ? sectionMatch[0].replace(/\b\w/g, c => c.toUpperCase()) : 'Unspecified';

  return {
    title: String(report ?? '').trim().slice(0, 80) || 'Unclassified incident',
    origin: 'Parsed from report',
    zone: /west/.test(text) ? 'west' : /concourse/.test(text) ? 'concourse' : 'east',
    needRole,
    needCerts: CERT_HINTS[needRole] ?? [],
    slaSec: needRole === 'medical' ? 120 : isUrgent ? 300 : 1800,
    priority: isUrgent ? 'crit' : 'low',
    mode: isUrgent ? 'urgent' : 'routine',
    loc,
    source: 'fallback'
  };
}

/**
 * Turn an unstructured incident report into structured task fields.
 *
 * This is the step that genuinely needs generation — radio chatter and fan
 * reports are free-form, ambiguous and frequently misspelled.
 *
 * @param {string} report Raw text, e.g. "someone's collapsed near 104, send help".
 * @returns {Promise<Object>} Task object consumable by {@link module:scoring.route}.
 *
 * @example
 * const task = await parseIncident("aggressive fan kicking off in 118");
 * // → { needRole: 'security', needCerts: ['crowd-l3'], mode: 'urgent', ... }
 */
export async function parseIncident(report) {
  if (!llmConfig.enabled) return parseIncidentFallback(report);

  const prompt = `You are triaging a stadium incident report into structured fields.

Report: "${report}"

Respond with ONLY a JSON object, no preamble and no markdown fences:
{
  "title": "short incident title, max 60 chars",
  "needRole": "facilities" | "security" | "medical",
  "needCerts": ["array of required certifications"],
  "zone": "east" | "west" | "concourse",
  "slaSec": number (120 for medical, 180-360 urgent, 1800 routine),
  "priority": "crit" | "warn" | "low",
  "mode": "urgent" | "routine",
  "loc": "human-readable location"
}

Valid certifications: first-aid, defib, crowd-l3, restraint, wet-floor, hazmat.`;

  try {
    const parsed = parseJSONResponse(await callModel(prompt, 500));
    return { ...parseIncidentFallback(report), ...parsed, origin: 'Parsed by model', source: 'llm' };
  } catch (err) {
    console.warn('[llm] parseIncident fell back:', err.message);
    return parseIncidentFallback(report);
  }
}

/* ------------------------------------------------------------------ *
 * 2. Assignment explanation
 * ------------------------------------------------------------------ */

/**
 * Deterministic phrasing keyed to the three highest-contributing factors.
 * @param {Object} staff
 * @param {Object} score
 * @returns {string}
 * @private
 */
function explainFallback(staff, score) {
  const phrases = {
    proximity: `nearest eligible responder (${(staff.etaSec / 60).toFixed(1)} min out)`,
    availability: staff.state === 'idle' ? 'free right now' : 'wrapping up a task nearby',
    load: `lighter workload than peers (${staff.doneThisShift} closed)`,
    capability: 'best equipped and most experienced for this task',
    continuity: 'already working this zone tonight'
  };
  const top = FACTOR_KEYS
    .slice()
    .sort((a, b) => score.parts[b] - score.parts[a])
    .slice(0, 3)
    .map(k => phrases[k]);
  return `Assigned to you: ${top[0]}, ${top[1]}, and ${top[2]}.`;
}

/**
 * Generate the plain-language reason shown on the assigned staffer's device.
 *
 * The explanation is derived from the deterministic score — generation
 * controls only the wording, never the decision.
 *
 * @param {Object} staff
 * @param {Object} score Result of {@link module:scoring.scoreStaff}.
 * @param {Object} task
 * @returns {Promise<string>} One or two sentences.
 */
export async function explainAssignment(staff, score, task) {
  if (!llmConfig.enabled) return explainFallback(staff, score);

  const contributions = FACTOR_KEYS
    .map(k => `${SCORING.labels[k]}: ${(score.parts[k] * 100).toFixed(1)} pts (raw ${score.raw[k].toFixed(2)})`)
    .join(', ');

  const prompt = `A stadium task was auto-assigned. Write the one-sentence reason the staff member sees on their phone.

Task: ${task.title} at ${task.loc}
Assigned to: ${staff.name}, ${staff.unit}
Total score: ${score.total}/100
Factor contributions: ${contributions}

Rules: address them as "you", cite only the two or three highest-contributing
factors, stay under 25 words, no jargon, no preamble. Return the sentence only.`;

  try {
    const text = (await callModel(prompt, 150)).trim();
    return text || explainFallback(staff, score);
  } catch (err) {
    console.warn('[llm] explainAssignment fell back:', err.message);
    return explainFallback(staff, score);
  }
}

/* ------------------------------------------------------------------ *
 * 3. No-match reasoning
 * ------------------------------------------------------------------ */

/**
 * Decide what to do when no staff member clears the hard filters.
 *
 * Genuine reasoning under ambiguity — widen the zone, pull an adjacent role,
 * or escalate — which is why it is delegated to the model rather than encoded
 * as another rule table.
 *
 * @param {Object} task
 * @param {Array<{staff:Object, filter:Object}>} filtered Everyone who failed, with reasons.
 * @returns {Promise<{action:string, rationale:string, source:string}>}
 */
export async function resolveNoMatch(task, filtered) {
  const reasons = filtered.map(f => `${f.staff.name}: failed ${f.filter.failedOn}`).join('; ');

  if (!llmConfig.enabled) {
    const allZone = filtered.length > 0 && filtered.every(f => f.filter.failedOn === 'zone');
    return {
      action: allZone ? 'widen-zone' : 'escalate-supervisor',
      rationale: allZone
        ? 'Every candidate failed only on zone access — widening the search radius.'
        : 'No eligible staff. Escalating to the zone supervisor for manual assignment.',
      source: 'fallback'
    };
  }

  const prompt = `No stadium staff passed the eligibility filters for this task.

Task: ${task.title} — needs ${task.needRole}, certs [${(task.needCerts ?? []).join(', ') || 'none'}], SLA ${task.slaSec}s
Failures: ${reasons}

Choose one action: widen-zone, adjacent-role, escalate-supervisor, defer.
Respond with ONLY JSON: {"action": "...", "rationale": "one sentence"}`;

  try {
    const parsed = parseJSONResponse(await callModel(prompt, 200));
    return { ...parsed, source: 'llm' };
  } catch (err) {
    console.warn('[llm] resolveNoMatch fell back:', err.message);
    return resolveNoMatch(task, filtered);
  }
}

export const __testing__ = { parseIncidentFallback, explainFallback, ROLE_HINTS };
