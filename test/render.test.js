/**
 * @file Tests for the presentation builders.
 *
 * Uses the same lightweight document stub as the DOM suite. These assert the
 * shape of what gets rendered — segment counts, factor rows, totals — so a
 * change to the scoring model that breaks the display is caught here rather
 * than discovered in a browser.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

function makeNode(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    dataset: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; } },
    listeners: {},
    get firstChild() { return this.children[0] ?? null; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach(c => this.children.push(c)); },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    addEventListener(e, h) { (this.listeners[e] ??= []).push(h); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    remove() {}
  };
}

globalThis.document = {
  createElement: makeNode,
  createElementNS: (_ns, tag) => makeNode(tag),
  createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
  getElementById: () => null,
  createDocumentFragment: () => makeNode('fragment'),
  body: makeNode('body')
};

const {
  contributionBar, factorTable, candidateCard,
  filterSummary, filterCut, dispatchBanner, noMatchBanner, taskMeta, jobState
} = await import('../src/render.js');
const { scoreStaff, FACTOR_KEYS } = await import('../src/scoring.js');

const task = {
  title: 'Wet floor', zone: 'east', needRole: 'facilities', needCerts: [],
  slaSec: 360, priority: 'crit', mode: 'urgent', loc: 'Gate A'
};

const staff = {
  name: 'Ravi Kulkarni', initials: 'RK', unit: 'Facilities · East',
  role: 'facilities', certs: [], onShift: true, shiftLeftMin: 120, status: 'active',
  zoneAccess: ['east'], etaSec: 108, state: 'idle', doneThisShift: 6,
  capability: { seniority: 0.85, kit: 1, history: 0.9 },
  continuity: { zoneShifts: 3, similarTasks: 4 }
};

const score = scoreStaff(staff, task, 10, 'urgent');

/** Depth-first search for the first descendant matching a class. */
function find(node, className) {
  if (node.className === className) return node;
  for (const child of node.children ?? []) {
    const hit = find(child, className);
    if (hit) return hit;
  }
  return null;
}

/** Collect every descendant with a given class. */
function findAll(node, className, acc = []) {
  if (node.className === className) acc.push(node);
  for (const child of node.children ?? []) findAll(child, className, acc);
  return acc;
}

/* ------------------------------------------------------------------ *
 * Contribution bar
 * ------------------------------------------------------------------ */

test('contribution bar renders one segment per scoring factor', () => {
  const bar = contributionBar(score);
  const stack = find(bar, 'stack');
  assert.ok(stack, 'stack element present');
  assert.equal(stack.children.length, FACTOR_KEYS.length);
});

test('segment widths encode each factor weighted contribution', () => {
  const stack = find(contributionBar(score), 'stack');
  stack.children.forEach((segment, index) => {
    const expected = (score.parts[FACTOR_KEYS[index]] * 100).toFixed(1);
    assert.equal(segment.dataset.w, expected);
  });
});

test('segment widths sum to the total score', () => {
  const stack = find(contributionBar(score), 'stack');
  const sum = stack.children.reduce((acc, seg) => acc + Number(seg.dataset.w), 0);
  assert.ok(Math.abs(sum - score.total) < 1, `segments sum to ${sum}, score is ${score.total}`);
});

test('every segment carries a colour', () => {
  const stack = find(contributionBar(score), 'stack');
  for (const segment of stack.children) {
    assert.ok(segment.style._props.background, 'segment has no background');
  }
});

test('legend lists every factor', () => {
  const legend = find(contributionBar(score), 'legend');
  assert.equal(legend.children.length, FACTOR_KEYS.length);
});

/* ------------------------------------------------------------------ *
 * Factor table
 * ------------------------------------------------------------------ */

test('factor table renders one row per factor plus a total', () => {
  const table = factorTable(score);
  assert.equal(findAll(table, 'fx').length, FACTOR_KEYS.length);
  assert.ok(find(table, 'fsum'), 'total row present');
});

test('factor bars encode raw normalised values, not weighted ones', () => {
  const rows = findAll(factorTable(score), 'fx');
  rows.forEach((row, index) => {
    const bar = find(row, 'fbar');
    const expected = (score.raw[FACTOR_KEYS[index]] * 100).toFixed(0);
    assert.equal(bar.children[0].dataset.w, expected);
  });
});

test('factor table starts collapsed', () => {
  assert.equal(factorTable(score).className, 'factors');
});

/* ------------------------------------------------------------------ *
 * Candidate card
 * ------------------------------------------------------------------ */

test('candidate card shows identity, score, bar and factor table', () => {
  const card = candidateCard({ staff, score });
  assert.equal(find(card, 'ini').textContent, 'RK');
  assert.equal(find(card, 'n').textContent, 'Ravi Kulkarni');
  assert.equal(find(card, 'r').textContent, 'Facilities · East');
  assert.ok(find(card, 'stack'));
  assert.ok(find(card, 'factors'));
});

test('candidate card score starts at zero so it can animate upward', () => {
  assert.equal(find(candidateCard({ staff, score }), 'num').textContent, '0');
});

/* ------------------------------------------------------------------ *
 * Status lines
 * ------------------------------------------------------------------ */

test('filter summary reports considered, eligible and cut counts', () => {
  const node = filterSummary(4, 3, 1);
  const text = node.children.map(c => c.textContent ?? '').join('');
  assert.match(text, /4 considered/);
  assert.match(text, /3 eligible/);
  assert.match(text, /1 filtered out/);
});

test('filter summary omits the cut clause when nobody was filtered', () => {
  const text = filterSummary(3, 3, 0).children.map(c => c.textContent ?? '').join('');
  assert.doesNotMatch(text, /filtered out/);
});

test('filter cut names the person and the failed check', () => {
  const node = filterCut('Marcus Tello', 'role');
  assert.match(node.textContent, /Marcus Tello/);
  assert.match(node.textContent, /role/);
});

test('dispatch banner names the assignee and reports latency', () => {
  const banner = dispatchBanner(staff, task, 47);
  assert.equal(find(banner, 'lat').textContent, '47ms');
  const text = findAll(banner, 'dt')[0].children.map(c => c.textContent ?? '').join('');
  assert.match(text, /Ravi Kulkarni/);
  assert.match(text, /Gate A/);
});

test('no-match banner surfaces the fallback rationale', () => {
  const banner = noMatchBanner('Widening the search radius.');
  assert.equal(find(banner, 'dt').textContent, 'Widening the search radius.');
});

test('task meta shows location, SLA and ETA', () => {
  const meta = taskMeta(task, staff);
  assert.equal(meta.children.length, 3);
  const text = meta.children
    .flatMap(child => child.children.map(c => c.textContent ?? ''))
    .join(' ');
  assert.match(text, /Gate A/);
  assert.match(text, /SLA 6m/);
  assert.match(text, /ETA 1\.8m/);
});

test('job state renders closed and returned variants distinctly', () => {
  assert.equal(jobState('Closed').className, 'job-state');
  assert.equal(jobState('Returned', true).className, 'job-state muted');
  assert.equal(find(jobState('Closed'), 'tick').textContent, '✓');
  assert.equal(find(jobState('Returned', true), 'tick').textContent, '↻');
});
