/**
 * @file Tests for the DOM construction helpers and element builders.
 *
 * Node has no document, so a deliberately small stub stands in — just enough
 * surface for `el`, `svg`, `clear` and `replace` to run. That is sufficient to
 * assert the important property: text always arrives via `textContent` and is
 * never parsed as markup.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ *
 * Minimal DOM stub
 * ------------------------------------------------------------------ */

/**
 * @returns {Object} A node implementing the subset of the DOM the helpers use.
 */
function makeNode(tag) {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    dataset: {},
    style: {
      _props: {},
      setProperty(key, value) { this._props[key] = value; }
    },
    listeners: {},
    get firstChild() { return this.children[0] ?? null; },
    setAttribute(key, value) { this.attributes[key] = value; },
    getAttribute(key) { return this.attributes[key] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      this.children = this.children.filter(c => c !== child);
      return child;
    },
    addEventListener(event, handler) {
      (this.listeners[event] ??= []).push(handler);
    }
  };
}

globalThis.document = {
  createElement: makeNode,
  createElementNS: (_ns, tag) => makeNode(tag),
  createTextNode: text => ({ nodeType: 3, textContent: String(text) }),
  getElementById: () => null,
  body: makeNode('body')
};

const { el, svg, icon, clear, replace } = await import('../src/dom.js');
const { priorityClass } = await import('../src/render.js');

/* ------------------------------------------------------------------ *
 * el()
 * ------------------------------------------------------------------ */

test('el creates an element of the requested tag', () => {
  assert.equal(el('div').tagName, 'DIV');
  assert.equal(el('span').tagName, 'SPAN');
});

test('el assigns className and text', () => {
  const node = el('div', { className: 'card', text: 'hello' });
  assert.equal(node.className, 'card');
  assert.equal(node.textContent, 'hello');
});

test('el routes text through textContent, never as markup', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const node = el('div', { text: hostile });
  assert.equal(node.textContent, hostile, 'stored verbatim as text');
  assert.equal(node.children.length, 0, 'no elements were parsed out of it');
});

test('el coerces non-string text safely', () => {
  assert.equal(el('div', { text: 42 }).textContent, '42');
  assert.equal(el('div', { text: 0 }).textContent, '0');
  assert.equal(el('div', { text: false }).textContent, 'false');
});

test('el skips text entirely when it is null or undefined', () => {
  assert.equal(el('div', { text: null }).textContent, '');
  assert.equal(el('div', {}).textContent, '');
});

test('el sets attributes and skips null values', () => {
  const node = el('div', { attrs: { id: 'x', 'aria-label': 'Label', role: null } });
  assert.equal(node.attributes.id, 'x');
  assert.equal(node.attributes['aria-label'], 'Label');
  assert.ok(!('role' in node.attributes));
});

test('el populates dataset and style', () => {
  const node = el('div', { dataset: { w: 42 }, style: { background: 'red' } });
  assert.equal(node.dataset.w, '42');
  assert.equal(node.style._props.background, 'red');
});

test('el appends children and ignores falsy entries', () => {
  const node = el('div', { children: [el('span'), null, el('b'), undefined] });
  assert.equal(node.children.length, 2);
});

test('el binds event listeners', () => {
  const handler = () => {};
  const node = el('button', { on: { click: handler } });
  assert.equal(node.listeners.click.length, 1);
  assert.equal(node.listeners.click[0], handler);
});

/* ------------------------------------------------------------------ *
 * svg() and icon()
 * ------------------------------------------------------------------ */

test('svg creates namespaced elements with attributes', () => {
  const node = svg('circle', { r: '4', cx: '2' });
  assert.equal(node.tagName, 'CIRCLE');
  assert.equal(node.attributes.r, '4');
});

test('svg nests children', () => {
  const node = svg('svg', {}, [svg('path', { d: 'M0 0' })]);
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].tagName, 'PATH');
});

test('icon builds an svg wrapping a single path', () => {
  const node = icon('M12 2v20');
  assert.equal(node.tagName, 'SVG');
  assert.equal(node.attributes['aria-hidden'], 'true');
  assert.equal(node.children[0].attributes.d, 'M12 2v20');
});

test('icon accepts a custom class', () => {
  assert.equal(icon('M0 0', 'big').attributes.class, 'big');
});

/* ------------------------------------------------------------------ *
 * clear() and replace()
 * ------------------------------------------------------------------ */

test('clear removes every child', () => {
  const node = el('div', { children: [el('span'), el('span'), el('b')] });
  assert.equal(node.children.length, 3);
  clear(node);
  assert.equal(node.children.length, 0);
});

test('clear returns the node for chaining', () => {
  const node = el('div');
  assert.equal(clear(node), node);
});

test('clear on an empty node is a no-op', () => {
  const node = el('div');
  assert.doesNotThrow(() => clear(node));
  assert.equal(node.children.length, 0);
});

test('replace swaps children in one call', () => {
  const node = el('div', { children: [el('span')] });
  const fresh = el('b');
  replace(node, fresh);
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0], fresh);
});

test('replace ignores falsy replacements', () => {
  const node = el('div', { children: [el('span')] });
  replace(node, null, el('b'), undefined);
  assert.equal(node.children.length, 1);
});

/* ------------------------------------------------------------------ *
 * Render helpers under the stub
 * ------------------------------------------------------------------ */

test('priorityClass is total over its documented inputs', () => {
  for (const [input, expected] of [['crit', 'crit'], ['warn', 'warn'], ['low', 'low'], ['', 'low']]) {
    assert.equal(priorityClass(input), expected);
  }
});
