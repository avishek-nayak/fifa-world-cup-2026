/**
 * @file Build script.
 *
 * Bundles the ES modules and inlines the stylesheet into a single deployable
 * `dist/index.html`, stripping comments and redundant whitespace.
 *
 * Source keeps its JSDoc and formatting; only the shipped artefact is
 * compressed. That resolves the usual conflict between readable source and a
 * small payload — you do not have to choose.
 *
 * Deliberately dependency-free: `node build.js`, nothing to install.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Module load order — dependencies before dependents. @constant */
const MODULE_ORDER = ['scoring', 'data', 'dom', 'render', 'device', 'llm', 'ui', 'main'];

/**
 * Strip `import`/`export` syntax so modules can share one scope.
 * @param {string} source
 * @returns {string}
 */
function flattenModule(source) {
  return source
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^export\s+(const|function|async function|class|let)\b/gm, '$1')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, '');
}

/**
 * Remove comments and collapse whitespace.
 *
 * Conservative by design: it skips lines containing string or template
 * delimiters so quoted `//` sequences survive intact.
 *
 * @param {string} code
 * @returns {string}
 */
function minifyJS(code) {
  return code
    .replace(/^[ \t]*\/\*\*[\s\S]*?\*\/[ \t]*$/gm, '')  // JSDoc blocks at any indent
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')    // block comments at any indent
    .replace(/^\s*\/\/(?![^\n]*['"`]).*$/gm, '')        // whole-line comments only
    .split('\n')
    .map(line => line.replace(/^[ \t]+/, match => ' '.repeat(Math.min(match.length, 1))).trimEnd())
    .filter(line => line.trim().length > 0)
    .join('\n');
}

/**
 * Strip CSS comments and collapse whitespace around punctuation.
 * @param {string} css
 * @returns {string}
 */
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\n+/g, '')
    .trim();
}

/**
 * Base64 SHA-256 digest for a CSP hash source.
 * @param {string} content
 * @returns {string}
 */
function cspHash(content) {
  return `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`;
}

const bundle = MODULE_ORDER
  .map(name => flattenModule(readFileSync(`src/${name}.js`, 'utf8')))
  .join('\n');

const script = minifyJS(bundle);
const style = minifyCSS(readFileSync('src/styles.css', 'utf8'));

let html = readFileSync('index.html', 'utf8')
  .replace('<link rel="stylesheet" href="src/styles.css">', `<style>${style}</style>`)
  .replace('<script type="module" src="src/main.js"></script>', `<script>${script}</script>`);

const csp = [
  "default-src 'none'",
  `script-src '${cspHash(script)}'`,
  `style-src '${cspHash(style)}' https://fonts.googleapis.com`,
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  'connect-src https://api.anthropic.com',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

html = html.replace(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/,
  `<meta http-equiv="Content-Security-Policy" content="${csp}">`
);

// collapse inter-tag whitespace without touching text content
html = html.replace(/>\s+</g, '><');

if (!existsSync('dist')) mkdirSync('dist');
writeFileSync('dist/index.html', html);

const sourceBytes = MODULE_ORDER.reduce((sum, n) => sum + readFileSync(`src/${n}.js`).length, 0)
  + readFileSync('src/styles.css').length;

const kb = n => (n / 1024).toFixed(1);
console.log(`dist/index.html   ${kb(html.length)} KB`);
console.log(`source            ${kb(sourceBytes)} KB`);
console.log(`reduction         ${(100 - (html.length / sourceBytes) * 100).toFixed(0)}%`);
