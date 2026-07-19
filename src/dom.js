/**
 * @file Safe DOM construction helpers.
 *
 * The application builds every element through these functions rather than
 * assigning `innerHTML`. All text reaches the document via `textContent`, so
 * user- or model-supplied strings can never be parsed as markup — which
 * matters here because {@link module:llm.parseIncident} accepts free text and
 * {@link module:llm.explainAssignment} returns model-generated prose.
 *
 * @module dom
 */

/** SVG namespace. @constant */
const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an element with attributes and children in one call.
 *
 * `text` is assigned via `textContent`; there is deliberately no escape hatch
 * for raw markup.
 *
 * @param {string} tag
 * @param {Object} [options]
 * @param {string} [options.className]
 * @param {string} [options.text] Text content, always escaped.
 * @param {Object<string,string>} [options.attrs] Attributes to set.
 * @param {Object<string,string>} [options.dataset] `data-*` values.
 * @param {Object<string,string>} [options.style] Inline style properties.
 * @param {Array<Node>} [options.children]
 * @param {Object<string,Function>} [options.on] Event listeners.
 * @returns {HTMLElement}
 *
 * @example
 * el('div', { className: 'card', text: userSuppliedName });
 */
export function el(tag, options = {}) {
  const node = document.createElement(tag);
  const { className, text, attrs, dataset, style, children, on } = options;

  if (className) node.className = className;
  if (text != null) node.textContent = String(text);

  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) node.setAttribute(k, String(v));
    }
  }
  if (dataset) {
    for (const [k, v] of Object.entries(dataset)) node.dataset[k] = String(v);
  }
  if (style) {
    for (const [k, v] of Object.entries(style)) node.style.setProperty(k, String(v));
  }
  if (children) {
    for (const child of children) {
      if (child) node.appendChild(child);
    }
  }
  if (on) {
    for (const [evt, handler] of Object.entries(on)) node.addEventListener(evt, handler);
  }
  return node;
}

/**
 * Create an SVG element. Required because SVG nodes need namespace-aware
 * construction that `document.createElement` does not provide.
 *
 * @param {string} tag
 * @param {Object<string,string>} [attrs]
 * @param {Array<Node>} [children]
 * @returns {SVGElement}
 */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child) node.appendChild(child);
  }
  return node;
}

/**
 * Build a single-path icon.
 *
 * @param {string} pathData The `d` attribute.
 * @param {string} [className='mi']
 * @returns {SVGElement}
 */
export function icon(pathData, className = 'mi') {
  return svg('svg', { viewBox: '0 0 24 24', class: className, 'aria-hidden': 'true' }, [
    svg('path', { d: pathData })
  ]);
}

/**
 * Remove every child of a node without touching `innerHTML`.
 * @param {HTMLElement} node
 * @returns {HTMLElement} The same node, for chaining.
 */
export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/**
 * Replace a node's children with a new set.
 * @param {HTMLElement} node
 * @param {...Node} children
 * @returns {HTMLElement}
 */
export function replace(node, ...children) {
  clear(node);
  for (const child of children) {
    if (child) node.appendChild(child);
  }
  return node;
}

/**
 * Announce a message to assistive technology via a polite live region.
 * The region is created once and reused.
 *
 * @param {string} message
 */
export function announce(message) {
  let region = document.getElementById('a11y-live');
  if (!region) {
    region = el('div', {
      attrs: { id: 'a11y-live', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
      className: 'sr-only'
    });
    document.body.appendChild(region);
  }
  region.textContent = message;
}
