/**
 * @file Unit tests for the deterministic routing engine.
 * Run with `npm test` (node:test, no external dependencies).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCORING, FACTOR_KEYS, BLOCKING_STATUSES,
  clamp, norm, passesFilters, scoreStaff, route, validateWeights
} from '../src/scoring.js';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** @returns {Object} A task requiring facilities staff, urgent weighting. */
const makeTask = (over = {}) => ({
  title: 'Test incident', zone: 'east', needRole: 'facilities',
  needCerts: ['wet-floor'], slaSec: 360, priority: 'crit', mode: 'urgent',
  loc: 'Gate A', ...over
});

/** @returns {Object} A fully eligible staff member. */
const makeStaff = (over = {}) => ({
  name: 'Test Staff', role: 'facilities', initials: 'TS', unit: 'Facilities · East',
  certs: ['wet-floor'], onShift: true, shiftLeftMin: 120, status: 'active',
  zoneAccess: ['east'], etaSec: 120, state: 'idle', doneThisShift: 3,
  capability: { seniority: 0.8, kit: 0.8, history: 0.8 },
  continuity: { zoneShifts: 2, similarTasks: 2 },
  ...over
});

/* ------------------------------------------------------------------ *
 * Configuration integrity
 * ------------------------------------------------------------------ */

test('weight sets sum to exactly 1.0', () => {
  assert.equal(validateWeights(), true);
  for (const [mode, set] of Object.entries(SCORING.weights)) {
    const sum = FACTOR_KEYS.reduce((a, k) => a + set[k], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `${mode} sums to ${sum}`);
  }
});

test('every factor key has a weight, colour and label in both modes', () => {
  for (const key of FACTOR_KEYS) {
    assert.ok(SCORING.colors[key], `missing colour: ${key}`);
    assert.ok(SCORING.labels[key], `missing label: ${key}`);
    assert.equal(typeof SCORING.weights.urgent[key], 'number');
    assert.equal(typeof SCORING.weights.routine[key], 'number');
  }
});

test('urgent weights proximity highest; routine weights load highest', () => {
  const u = SCORING.weights.urgent;
  const r = SCORING.weights.routine;
  assert.ok(u.proximity === Math.max(...Object.values(u)));
  assert.ok(r.load === Math.max(...Object.values(r)));
  assert.ok(r.load > u.load, 'routine must value fairness more than urgent');
  assert.ok(u.proximity > r.proximity, 'urgent must value speed more than routine');
});

test('SCORING is frozen against mutation', () => {
  assert.throws(() => { 'use strict'; SCORING.weights.urgent.proximity = 0.99; });
});

/* ------------------------------------------------------------------ *
 * clamp
 * ------------------------------------------------------------------ */

test('clamp bounds values and rejects non-finite input', () => {
  assert.equal(clamp(0.5, 0, 1), 0.5);
  assert.equal(clamp(-3, 0, 1), 0);
  assert.equal(clamp(7, 0, 1), 1);
  assert.equal(clamp(NaN, 0, 1), 0);
  assert.equal(clamp(Infinity, 0, 1), 0);
  assert.equal(clamp(undefined, 0, 1), 0);
});

/* ------------------------------------------------------------------ *
 * Normalisers
 * ------------------------------------------------------------------ */

test('proximity: instant arrival scores 1, at-SLA scores 0, overdue scores 0', () => {
  assert.equal(norm.proximity(0, 360), 1);
  assert.equal(norm.proximity(360, 360), 0);
  assert.equal(norm.proximity(720, 360), 0, 'overdue must not go negative');
  assert.ok(Math.abs(norm.proximity(180, 360) - 0.5) < 1e-9);
});

test('proximity: guards against zero or invalid SLA', () => {
  assert.equal(norm.proximity(100, 0), 0);
  assert.equal(norm.proximity(100, -5), 0);
  assert.equal(norm.proximity(100, NaN), 0);
});

test('availability: known states map correctly, unknown states score 0', () => {
  assert.equal(norm.availability('idle'), 1);
  assert.equal(norm.availability('finishing'), 0.6);
  assert.equal(norm.availability('active'), 0.2);
  assert.equal(norm.availability('assigned'), 0);
  assert.equal(norm.availability('nonsense'), 0);
  assert.equal(norm.availability(undefined), 0);
});

test('availability: prototype keys do not leak through', () => {
  assert.equal(norm.availability('toString'), 0);
  assert.equal(norm.availability('constructor'), 0);
});

test('load: fewer completed tasks scores higher', () => {
  assert.equal(norm.load(0, 10), 1);
  assert.equal(norm.load(10, 10), 0);
  assert.equal(norm.load(5, 10), 0.5);
});

test('load: empty pool returns full score rather than dividing by zero', () => {
  assert.equal(norm.load(0, 0), 1);
  assert.equal(norm.load(3, 0), 1);
});

test('capability: weighted blend, bounded, tolerant of missing fields', () => {
  assert.equal(norm.capability({ seniority: 1, kit: 1, history: 1 }), 1);
  assert.equal(norm.capability({ seniority: 0, kit: 0, history: 0 }), 0);
  assert.equal(norm.capability(null), 0);
  const partial = norm.capability({ seniority: 1 });
  assert.ok(Math.abs(partial - 0.4) < 1e-9, 'missing fields treated as zero');
});

test('continuity: saturates so extra shifts add nothing', () => {
  assert.equal(norm.continuity({ zoneShifts: 3, similarTasks: 4 }), 1);
  assert.equal(norm.continuity({ zoneShifts: 99, similarTasks: 99 }), 1);
  assert.equal(norm.continuity({ zoneShifts: 0, similarTasks: 0 }), 0);
  assert.equal(norm.continuity(null), 0);
});

test('all normalisers stay within 0-1 across a wide input sweep', () => {
  for (let i = -50; i <= 150; i += 10) {
    const v = i / 100;
    assert.ok(norm.proximity(i * 10, 360) >= 0 && norm.proximity(i * 10, 360) <= 1);
    assert.ok(norm.load(i, 10) >= 0 && norm.load(i, 10) <= 1);
    const cap = norm.capability({ seniority: v, kit: v, history: v });
    assert.ok(cap >= 0 && cap <= 1, `capability out of range at ${v}`);
  }
});

/* ------------------------------------------------------------------ *
 * Stage 1 — filters
 * ------------------------------------------------------------------ */

test('a fully qualified staff member passes every filter', () => {
  const r = passesFilters(makeStaff(), makeTask());
  assert.equal(r.pass, true);
  assert.equal(r.failedOn, null);
  assert.equal(r.checks.length, 5);
});

test('wrong role is rejected', () => {
  const r = passesFilters(makeStaff({ role: 'security' }), makeTask());
  assert.equal(r.pass, false);
  assert.equal(r.failedOn, 'role');
});

test('missing certification is rejected even when physically closest', () => {
  const r = passesFilters(makeStaff({ certs: [], etaSec: 1 }), makeTask());
  assert.equal(r.pass, false);
  assert.equal(r.failedOn, 'certified');
});

test('shift ending before the SLA is rejected', () => {
  // SLA 360s = 6 min; 5 minutes of shift left is not enough.
  const r = passesFilters(makeStaff({ shiftLeftMin: 5 }), makeTask());
  assert.equal(r.pass, false);
  assert.equal(r.failedOn, 'on shift');
});

test('every blocking status is rejected', () => {
  for (const status of BLOCKING_STATUSES) {
    const r = passesFilters(makeStaff({ status }), makeTask());
    assert.equal(r.pass, false, `${status} should block`);
    assert.equal(r.failedOn, 'status');
  }
});

test('missing zone access is rejected', () => {
  const r = passesFilters(makeStaff({ zoneAccess: ['west'] }), makeTask());
  assert.equal(r.pass, false);
  assert.equal(r.failedOn, 'zone');
});

test('tasks requiring no certification accept staff with none', () => {
  const r = passesFilters(makeStaff({ certs: [] }), makeTask({ needCerts: [] }));
  assert.equal(r.pass, true);
});

test('all required certifications must be held, not just one', () => {
  const task = makeTask({ needCerts: ['wet-floor', 'hazmat'] });
  assert.equal(passesFilters(makeStaff({ certs: ['wet-floor'] }), task).pass, false);
  assert.equal(passesFilters(makeStaff({ certs: ['wet-floor', 'hazmat'] }), task).pass, true);
});

test('filter order is deterministic — role reported before zone', () => {
  const broken = makeStaff({ role: 'medical', zoneAccess: [] });
  assert.equal(passesFilters(broken, makeTask()).failedOn, 'role');
});

/* ------------------------------------------------------------------ *
 * Stage 2 — scoring
 * ------------------------------------------------------------------ */

test('scores are integers within 0-100', () => {
  const s = scoreStaff(makeStaff(), makeTask(), 10, 'urgent');
  assert.ok(Number.isInteger(s.total));
  assert.ok(s.total >= 0 && s.total <= 100);
});

test('a perfect candidate scores 100', () => {
  const perfect = makeStaff({
    etaSec: 0, state: 'idle', doneThisShift: 0,
    capability: { seniority: 1, kit: 1, history: 1 },
    continuity: { zoneShifts: 3, similarTasks: 4 }
  });
  assert.equal(scoreStaff(perfect, makeTask(), 10, 'urgent').total, 100);
});

test('a worst-case candidate scores 0', () => {
  const worst = makeStaff({
    etaSec: 9999, state: 'assigned', doneThisShift: 10,
    capability: { seniority: 0, kit: 0, history: 0 },
    continuity: { zoneShifts: 0, similarTasks: 0 }
  });
  assert.equal(scoreStaff(worst, makeTask(), 10, 'urgent').total, 0);
});

test('weighted parts reconstruct the total', () => {
  const s = scoreStaff(makeStaff(), makeTask(), 10, 'urgent');
  const sum = FACTOR_KEYS.reduce((a, k) => a + s.parts[k], 0);
  assert.equal(Math.round(sum * 100), s.total);
});

test('each part equals weight multiplied by its raw factor', () => {
  const s = scoreStaff(makeStaff(), makeTask(), 10, 'urgent');
  for (const k of FACTOR_KEYS) {
    assert.ok(Math.abs(s.parts[k] - (s.weights[k] * s.raw[k])) < 1e-12, `mismatch on ${k}`);
  }
});

test('an unknown scoring mode throws rather than silently misweighting', () => {
  assert.throws(() => scoreStaff(makeStaff(), makeTask(), 10, 'bogus'), /Unknown scoring mode/);
});

test('scoring is pure — repeated calls return identical totals', () => {
  const staff = makeStaff();
  const task = makeTask();
  const a = scoreStaff(staff, task, 10, 'urgent').total;
  const b = scoreStaff(staff, task, 10, 'urgent').total;
  assert.equal(a, b);
});

test('scoring does not mutate its inputs', () => {
  const staff = makeStaff();
  const task = makeTask();
  const staffCopy = JSON.parse(JSON.stringify(staff));
  const taskCopy = JSON.parse(JSON.stringify(task));
  scoreStaff(staff, task, 10, 'urgent');
  assert.deepEqual(staff, staffCopy);
  assert.deepEqual(task, taskCopy);
});

test('the same candidate scores differently under urgent and routine weights', () => {
  const heavilyLoaded = makeStaff({ etaSec: 30, doneThisShift: 10 });
  const urgent = scoreStaff(heavilyLoaded, makeTask(), 10, 'urgent').total;
  const routine = scoreStaff(heavilyLoaded, makeTask(), 10, 'routine').total;
  assert.ok(urgent > routine, 'a fast but exhausted staffer should lose ground under routine weights');
});

/* ------------------------------------------------------------------ *
 * route() — full decision
 * ------------------------------------------------------------------ */

test('route separates eligible from filtered candidates', () => {
  const pool = [
    makeStaff({ name: 'Eligible' }),
    makeStaff({ name: 'Wrong role', role: 'medical' })
  ];
  const r = route(pool, makeTask());
  assert.equal(r.eligible.length, 1);
  assert.equal(r.filtered.length, 1);
  assert.equal(r.winner.staff.name, 'Eligible');
});

test('route ranks candidates in descending score order', () => {
  const pool = [
    makeStaff({ name: 'Slow', etaSec: 340 }),
    makeStaff({ name: 'Fast', etaSec: 20 }),
    makeStaff({ name: 'Medium', etaSec: 180 })
  ];
  const totals = route(pool, makeTask()).ranked.map(r => r.score.total);
  for (let i = 1; i < totals.length; i++) {
    assert.ok(totals[i - 1] >= totals[i], 'ranking must be monotonic');
  }
});

test('route returns a null winner when everyone is filtered out', () => {
  const pool = [makeStaff({ role: 'medical' }), makeStaff({ status: 'off-duty' })];
  const r = route(pool, makeTask());
  assert.equal(r.winner, null);
  assert.equal(r.ranked.length, 0);
  assert.equal(r.filtered.length, 2);
});

test('route handles an empty pool without throwing', () => {
  const r = route([], makeTask());
  assert.equal(r.winner, null);
  assert.equal(r.poolMax, 1);
});

test('ties break on proximity, then on lighter load', () => {
  const base = { capability: { seniority: 0.5, kit: 0.5, history: 0.5 }, continuity: { zoneShifts: 1, similarTasks: 1 } };
  const pool = [
    makeStaff({ name: 'Further', etaSec: 100, doneThisShift: 5, ...base }),
    makeStaff({ name: 'Closer', etaSec: 99, doneThisShift: 5, ...base })
  ];
  const r = route(pool, makeTask());
  if (r.ranked[0].score.total === r.ranked[1].score.total) {
    assert.equal(r.ranked[0].staff.name, 'Closer');
  }
});

test('poolMax is derived only from eligible staff', () => {
  const pool = [
    makeStaff({ name: 'Eligible', doneThisShift: 4 }),
    makeStaff({ name: 'Ineligible', role: 'medical', doneThisShift: 99 })
  ];
  assert.equal(route(pool, makeTask()).poolMax, 4);
});

/* ------------------------------------------------------------------ *
 * Regression tests — the four demo scenarios
 * ------------------------------------------------------------------ */

const { SCENARIOS } = await import('../src/data.js');

test('all four demo scenarios are present and well-formed', () => {
  assert.equal(SCENARIOS.length, 4);
  for (const sc of SCENARIOS) {
    assert.ok(sc.task.title);
    assert.ok(['urgent', 'routine'].includes(sc.task.mode));
    assert.ok(sc.pool.length >= 3, 'each scenario needs a meaningful pool');
  }
});

test('scenario 1: proximity alone does not win — the closest is filtered on role', () => {
  const sc = SCENARIOS[0];
  const r = route(sc.pool, sc.task);
  assert.equal(r.winner.staff.name, 'Ravi Kulkarni');
  const marcus = r.filtered.find(f => f.staff.name === 'Marcus Tello');
  assert.ok(marcus, 'Marcus must be filtered, not scored');
  assert.equal(marcus.filter.failedOn, 'role');
});

test('scenario 2: the nearest responder is cut for missing certification', () => {
  const sc = SCENARIOS[1];
  const r = route(sc.pool, sc.task);
  assert.equal(r.winner.staff.name, 'Marcus Tello');
  const jonas = r.filtered.find(f => f.staff.name === 'Jonas Berg');
  assert.equal(jonas.filter.failedOn, 'certified');
  const winnerEta = r.winner.staff.etaSec;
  assert.ok(jonas.staff.etaSec < winnerEta, 'the filtered candidate was genuinely closer');
});

test('scenario 3: an on-break staffer is excluded despite being nearby', () => {
  const sc = SCENARIOS[2];
  const r = route(sc.pool, sc.task);
  assert.equal(r.winner.staff.name, 'Aisha Bello');
  const lena = r.filtered.find(f => f.staff.name === 'Lena Ortiz');
  assert.equal(lena.filter.failedOn, 'status');
});

test('scenario 4: routine weights let load balance beat proximity and experience', () => {
  const sc = SCENARIOS[3];
  const r = route(sc.pool, sc.task);
  assert.equal(sc.task.mode, 'routine');
  assert.equal(r.winner.staff.name, 'Sana Mirza');

  const ravi = r.ranked.find(x => x.staff.name === 'Ravi Kulkarni');
  assert.ok(ravi.staff.etaSec < r.winner.staff.etaSec, 'Ravi was closer');
  assert.ok(ravi.staff.doneThisShift > r.winner.staff.doneThisShift, 'Ravi was busier');
  assert.ok(
    r.winner.score.total - ravi.score.total >= 10,
    'the fairness margin must be decisive, not a coin flip'
  );
});

test('every scenario produces a decisive winner', () => {
  for (const [i, sc] of SCENARIOS.entries()) {
    const r = route(sc.pool, sc.task);
    assert.ok(r.winner, `scenario ${i} produced no winner`);
    if (r.ranked.length > 1) {
      const margin = r.ranked[0].score.total - r.ranked[1].score.total;
      assert.ok(margin >= 6, `scenario ${i} margin of ${margin} is too thin to demo`);
    }
  }
});

test('swapping a scenario to the opposite weight mode can change the winner', () => {
  const sc = SCENARIOS[3];
  const asUrgent = route(sc.pool, { ...sc.task, mode: 'urgent' });
  const asRoutine = route(sc.pool, sc.task);
  assert.notEqual(
    asUrgent.winner.staff.name,
    asRoutine.winner.staff.name,
    'weight mode must materially affect the outcome'
  );
});
