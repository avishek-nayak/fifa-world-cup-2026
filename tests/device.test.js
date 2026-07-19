/**
 * @file Tests for the device task lifecycle and presentation helpers.
 *
 * `applyTaskEvent` and `priorityClass` are pure, so they are asserted directly.
 * Node has no DOM, so element builders are verified through their pure inputs
 * rather than by rendering.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDeviceState, applyTaskEvent } from '../src/device.js';
import { priorityClass, FILTER_NAMES, ICONS } from '../src/render.js';
import { FACTOR_KEYS } from '../src/scoring.js';

/* ------------------------------------------------------------------ *
 * Device state machine
 * ------------------------------------------------------------------ */

test('a new device state starts with no open tasks', () => {
  const state = createDeviceState();
  assert.equal(state.open, 0);
  assert.equal(state.done, 0);
});

test('a device state can be seeded with prior completions', () => {
  assert.equal(createDeviceState(7).done, 7);
  assert.equal(createDeviceState(7).open, 0);
});

test('assigning a task increments the open count only', () => {
  const next = applyTaskEvent(createDeviceState(3), 'assign');
  assert.equal(next.open, 1);
  assert.equal(next.done, 3);
});

test('closing a task moves it from open to done', () => {
  const assigned = applyTaskEvent(createDeviceState(3), 'assign');
  const closed = applyTaskEvent(assigned, 'close');
  assert.equal(closed.open, 0);
  assert.equal(closed.done, 4);
});

test('returning a task decrements open without crediting completion', () => {
  const assigned = applyTaskEvent(createDeviceState(3), 'assign');
  const returned = applyTaskEvent(assigned, 'return');
  assert.equal(returned.open, 0);
  assert.equal(returned.done, 3, 'a returned task must not count as done');
});

test('open count never goes negative', () => {
  const state = applyTaskEvent(createDeviceState(0), 'close');
  assert.equal(state.open, 0);
  assert.equal(applyTaskEvent(state, 'return').open, 0);
});

test('applyTaskEvent does not mutate the state it is given', () => {
  const original = createDeviceState(2);
  const snapshot = { ...original };
  applyTaskEvent(original, 'assign');
  assert.deepEqual(original, snapshot);
});

test('an unknown lifecycle event throws rather than silently no-opping', () => {
  assert.throws(() => applyTaskEvent(createDeviceState(), 'teleport'), /Unknown task event/);
});

test('a full assign-close cycle over many tasks stays consistent', () => {
  let state = createDeviceState(0);
  for (let i = 0; i < 25; i++) {
    state = applyTaskEvent(state, 'assign');
    state = applyTaskEvent(state, 'close');
  }
  assert.equal(state.open, 0);
  assert.equal(state.done, 25);
});

test('interleaved assigns and returns settle correctly', () => {
  let state = createDeviceState(0);
  state = applyTaskEvent(state, 'assign');
  state = applyTaskEvent(state, 'assign');
  state = applyTaskEvent(state, 'return');
  state = applyTaskEvent(state, 'close');
  assert.equal(state.open, 0);
  assert.equal(state.done, 1);
});

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

test('priorityClass maps every priority to a known modifier', () => {
  assert.equal(priorityClass('crit'), 'crit');
  assert.equal(priorityClass('warn'), 'warn');
  assert.equal(priorityClass('low'), 'low');
});

test('priorityClass degrades unknown input to the safest modifier', () => {
  assert.equal(priorityClass('nonsense'), 'low');
  assert.equal(priorityClass(undefined), 'low');
  assert.equal(priorityClass(null), 'low');
});

test('filter names match the five documented eligibility checks', () => {
  assert.equal(FILTER_NAMES.length, 5);
  assert.deepEqual([...FILTER_NAMES], ['role', 'certified', 'on shift', 'status', 'zone']);
});

test('filter names are frozen against reordering at runtime', () => {
  assert.throws(() => { 'use strict'; FILTER_NAMES[0] = 'hacked'; });
});

test('every icon is a non-empty SVG path string', () => {
  for (const [name, path] of Object.entries(ICONS)) {
    assert.equal(typeof path, 'string', `${name} must be a string`);
    assert.ok(path.length > 5, `${name} looks empty`);
    assert.match(path, /^M/, `${name} should start with a moveto command`);
  }
});

test('the factor key order used by rendering matches the scoring engine', () => {
  assert.equal(FACTOR_KEYS.length, 5);
  assert.deepEqual(
    [...FACTOR_KEYS],
    ['proximity', 'availability', 'load', 'capability', 'continuity']
  );
});

/* ------------------------------------------------------------------ *
 * Task card construction
 * ------------------------------------------------------------------ */

function stubNode(tag) {
  return {
    tagName: tag.toUpperCase(), className: '', textContent: '', children: [],
    attributes: {}, dataset: {}, listeners: {},
    style: { _props: {}, setProperty(k, v) { this._props[k] = v; } },
    get firstChild() { return this.children[0] ?? null; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { cs.forEach(c => this.children.push(c)); },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    addEventListener(e, h) { (this.listeners[e] ??= []).push(h); },
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector(sel) {
      const want = sel.replace('.', '');
      const walk = node => {
        for (const child of node.children ?? []) {
          if (child.className === want) return child;
          const hit = walk(child);
          if (hit) return hit;
        }
        return null;
      };
      return walk(this);
    },
    replaceWith() {},
    remove() {}
  };
}

globalThis.document = {
  createElement: stubNode,
  createElementNS: (_ns, tag) => stubNode(tag),
  createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
  getElementById: () => null,
  body: stubNode('body')
};

const { taskCard } = await import('../src/device.js');

const cardTask = {
  title: 'Wet floor — Gate A', loc: 'Gate A', slaSec: 360, priority: 'crit'
};
const cardStaff = { name: 'Ravi', initials: 'RK', etaSec: 108 };

function deepFind(node, className) {
  if (node.className === className) return node;
  for (const child of node.children ?? []) {
    const hit = deepFind(child, className);
    if (hit) return hit;
  }
  return null;
}

test('task card renders the title, reason and action buttons', () => {
  const card = taskCard({
    task: cardTask, staff: cardStaff, reason: 'Nearest and free.', onCountChange() {}
  });
  assert.equal(deepFind(card, 'job-tt').textContent, 'Wet floor — Gate A');
  assert.ok(deepFind(card, 'job-why'), 'explanation block present');
  assert.equal(deepFind(card, 'job-act').children.length, 2);
});

test('task card marks itself fresh and labels itself for screen readers', () => {
  const card = taskCard({
    task: cardTask, staff: cardStaff, reason: 'Reason.', onCountChange() {}
  });
  assert.match(card.className, /fresh/);
  assert.match(card.getAttribute('aria-label'), /Wet floor/);
});

test('task card renders the generated reason verbatim as text', () => {
  const reason = 'Assigned to you: nearest responder, free right now.';
  const card = taskCard({ task: cardTask, staff: cardStaff, reason, onCountChange() {} });
  const why = deepFind(card, 'job-why');
  const text = why.children.map(c => c.textContent ?? '').join('');
  assert.match(text, /nearest responder/);
});

test('task card action buttons are wired to click handlers', () => {
  const card = taskCard({
    task: cardTask, staff: cardStaff, reason: 'Reason.', onCountChange() {}
  });
  const [accept, pass] = deepFind(card, 'job-act').children;
  assert.ok(accept.listeners.click?.length, 'accept has a handler');
  assert.ok(pass.listeners.click?.length, 'pass has a handler');
});

test('returning a task notifies the counter with a return event', () => {
  const events = [];
  const card = taskCard({
    task: cardTask, staff: cardStaff, reason: 'Reason.',
    onCountChange: e => events.push(e)
  });
  const passButton = deepFind(card, 'job-act').children[1];
  passButton.listeners.click[0]();
  assert.deepEqual(events, ['return']);
});
