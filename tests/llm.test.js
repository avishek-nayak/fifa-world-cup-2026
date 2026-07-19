/**
 * @file Tests for the generative AI layer.
 *
 * These run with generation disabled, verifying that every function degrades
 * to a deterministic path. That guarantees the demo and CI never depend on a
 * network call or an API key.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  llmConfig, configureLLM, parseIncident, explainAssignment, resolveNoMatch, __testing__
} from '../src/llm.js';
import { scoreStaff, route } from '../src/scoring.js';
import { SCENARIOS } from '../src/data.js';

const makeTask = (over = {}) => ({
  title: 'Test', zone: 'east', needRole: 'facilities', needCerts: [],
  slaSec: 360, priority: 'crit', mode: 'urgent', loc: 'Gate A', ...over
});

const makeStaff = (over = {}) => ({
  name: 'Test Staff', role: 'facilities', unit: 'Facilities · East',
  certs: [], onShift: true, shiftLeftMin: 120, status: 'active',
  zoneAccess: ['east'], etaSec: 120, state: 'idle', doneThisShift: 3,
  capability: { seniority: 0.8, kit: 0.8, history: 0.8 },
  continuity: { zoneShifts: 2, similarTasks: 2 }, ...over
});

test('generation is disabled by default so the demo needs no API key', () => {
  assert.equal(llmConfig.enabled, false);
  assert.equal(llmConfig.apiKey, null);
});

test('configureLLM toggles generation on and off', () => {
  configureLLM('test-key');
  assert.equal(llmConfig.enabled, true);
  configureLLM(null);
  assert.equal(llmConfig.enabled, false);
});

/* ------------------------------------------------------------------ *
 * Incident parsing
 * ------------------------------------------------------------------ */

test('parseIncident returns every field the router requires', async () => {
  const task = await parseIncident('spill near gate a');
  for (const key of ['title', 'needRole', 'needCerts', 'zone', 'slaSec', 'priority', 'mode', 'loc']) {
    assert.ok(key in task, `missing field: ${key}`);
  }
  assert.ok(['urgent', 'routine'].includes(task.mode));
  assert.ok(Array.isArray(task.needCerts));
});

test('parseIncident routes a collapse to medical with a tight SLA', async () => {
  const task = await parseIncident('a fan has collapsed near section 104');
  assert.equal(task.needRole, 'medical');
  assert.equal(task.mode, 'urgent');
  assert.ok(task.slaSec <= 180, 'medical incidents need an aggressive deadline');
  assert.ok(task.needCerts.includes('first-aid'));
});

test('parseIncident routes an altercation to security', async () => {
  const task = await parseIncident('aggressive fan starting a fight in section 118');
  assert.equal(task.needRole, 'security');
  assert.ok(task.needCerts.includes('crowd-l3'));
});

test('parseIncident routes a spill to facilities', async () => {
  const task = await parseIncident('wet floor spill on the concourse');
  assert.equal(task.needRole, 'facilities');
});

test('parseIncident treats a bin overflow as routine, not urgent', async () => {
  const task = await parseIncident('bin overflow at gate d');
  assert.equal(task.needRole, 'facilities');
  assert.equal(task.mode, 'routine');
  assert.ok(task.slaSec > 600, 'routine work should carry a relaxed deadline');
});

test('parseIncident extracts a location when one is stated', async () => {
  const task = await parseIncident('spill in section 112');
  assert.match(task.loc.toLowerCase(), /112/);
});

test('parseIncident survives empty and malformed input', async () => {
  for (const input of ['', '   ', null, undefined, '???']) {
    const task = await parseIncident(input);
    assert.ok(task.needRole, `no role for input: ${JSON.stringify(input)}`);
    assert.ok(task.slaSec > 0);
  }
});

test('parsed output is directly routable by the scoring engine', async () => {
  const task = await parseIncident('wet floor spill near gate a east');
  const pool = [makeStaff({ certs: [] })];
  const result = route(pool, task);
  assert.ok(result.eligible.length + result.filtered.length === 1, 'router accepted the parsed task');
});

/* ------------------------------------------------------------------ *
 * Explanation
 * ------------------------------------------------------------------ */

test('explainAssignment returns a short human sentence', async () => {
  const staff = makeStaff();
  const score = scoreStaff(staff, makeTask(), 10, 'urgent');
  const text = await explainAssignment(staff, score, makeTask());
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 20);
  assert.ok(text.split(' ').length < 45, 'explanation must stay glanceable');
});

test('explanation cites the dominant factor for a very close responder', async () => {
  const near = makeStaff({ etaSec: 5, doneThisShift: 0 });
  const score = scoreStaff(near, makeTask(), 10, 'urgent');
  const text = await explainAssignment(near, score, makeTask());
  assert.match(text.toLowerCase(), /nearest|min out/);
});

test('explanation shifts to fairness language under routine weights', async () => {
  const light = makeStaff({ etaSec: 300, doneThisShift: 0 });
  const score = scoreStaff(light, makeTask({ mode: 'routine' }), 10, 'routine');
  const text = await explainAssignment(light, score, makeTask({ mode: 'routine' }));
  assert.match(text.toLowerCase(), /workload|closed/);
});

test('explanation never contains raw score internals', async () => {
  const staff = makeStaff();
  const score = scoreStaff(staff, makeTask(), 10, 'urgent');
  const text = await explainAssignment(staff, score, makeTask());
  assert.doesNotMatch(text, /parts|raw|0\.\d{3}/, 'internals must not leak to the staffer');
});

/* ------------------------------------------------------------------ *
 * No-match resolution
 * ------------------------------------------------------------------ */

test('resolveNoMatch returns a recognised action and a rationale', async () => {
  const filtered = [{ staff: makeStaff({ name: 'A' }), filter: { failedOn: 'role' } }];
  const r = await resolveNoMatch(makeTask(), filtered);
  assert.ok(['widen-zone', 'adjacent-role', 'escalate-supervisor', 'defer'].includes(r.action));
  assert.ok(r.rationale.length > 10);
});

test('resolveNoMatch widens the search when zone access is the only blocker', async () => {
  const filtered = [
    { staff: makeStaff({ name: 'A' }), filter: { failedOn: 'zone' } },
    { staff: makeStaff({ name: 'B' }), filter: { failedOn: 'zone' } }
  ];
  const r = await resolveNoMatch(makeTask(), filtered);
  assert.equal(r.action, 'widen-zone');
});

test('resolveNoMatch escalates when failures are mixed', async () => {
  const filtered = [
    { staff: makeStaff({ name: 'A' }), filter: { failedOn: 'zone' } },
    { staff: makeStaff({ name: 'B' }), filter: { failedOn: 'certified' } }
  ];
  const r = await resolveNoMatch(makeTask(), filtered);
  assert.equal(r.action, 'escalate-supervisor');
});

/* ------------------------------------------------------------------ *
 * End-to-end
 * ------------------------------------------------------------------ */

test('a free-text report flows through parse, route and explain', async () => {
  const task = await parseIncident('someone collapsed near section 104 on the concourse');
  const sc = SCENARIOS[2];
  const result = route(sc.pool, { ...sc.task, ...task, zone: sc.task.zone, needRole: task.needRole });
  if (result.winner) {
    const text = await explainAssignment(result.winner.staff, result.winner.score, sc.task);
    assert.ok(text.length > 20);
  } else {
    const fallback = await resolveNoMatch(task, result.filtered);
    assert.ok(fallback.action);
  }
});

test('fallback parser is exported for direct verification', () => {
  const task = __testing__.parseIncidentFallback('bleeding fan section 110');
  assert.equal(task.needRole, 'medical');
  assert.equal(task.source, 'fallback');
});
