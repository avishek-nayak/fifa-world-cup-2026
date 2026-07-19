/**
 * @file Pure presentation builders.
 *
 * Every function here takes data and returns a detached DOM node. None of them
 * read global state, query the document, or mutate anything outside the node
 * they create — which makes each one testable by asserting on the returned
 * element's structure.
 *
 * @module render
 */

import { SCORING, FACTOR_KEYS } from './scoring.js';
import { el, icon } from './dom.js';

/** Single-path icon geometry. @constant */
export const ICONS = Object.freeze({
  pin: 'M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 7v5l3 2',
  pulse: 'M3 12h4l3 8 4-16 3 8h4',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01'
});

/** Filter gate labels, in evaluation order. @constant {readonly string[]} */
export const FILTER_NAMES = Object.freeze(['role', 'certified', 'on shift', 'status', 'zone']);

/**
 * Map a task priority onto its CSS modifier.
 * @param {'crit'|'warn'|'low'|string} priority
 * @returns {string}
 */
export function priorityClass(priority) {
  if (priority === 'crit') return 'crit';
  if (priority === 'warn') return 'warn';
  return 'low';
}

/**
 * Stacked contribution bar — one segment per factor, sized to that factor's
 * weighted contribution. The segments together *are* the score.
 *
 * @param {Object} score Result of `scoreStaff`.
 * @returns {HTMLElement}
 */
export function contributionBar(score) {
  const segments = FACTOR_KEYS.map(key => el('i', {
    dataset: { w: (score.parts[key] * 100).toFixed(1) },
    style: { background: SCORING.colors[key] }
  }));

  const legend = FACTOR_KEYS.map(key => el('span', {
    className: 'lg',
    children: [
      el('b', { style: { background: SCORING.colors[key] } }),
      document.createTextNode(`${SCORING.labels[key]} `),
      el('span', { text: (score.parts[key] * 100).toFixed(0) })
    ]
  }));

  return el('div', {
    className: 'stackwrap',
    children: [
      el('div', { className: 'stack', children: segments }),
      el('div', { className: 'legend', children: legend })
    ]
  });
}

/**
 * Collapsible factor table showing raw value and weight per factor.
 *
 * @param {Object} score
 * @returns {HTMLElement}
 */
export function factorTable(score) {
  const rows = FACTOR_KEYS.map(key => el('div', {
    className: 'fx',
    children: [
      el('span', { className: 'fk', text: SCORING.labels[key] }),
      el('span', {
        className: 'fbar',
        children: [el('i', {
          dataset: { w: (score.raw[key] * 100).toFixed(0) },
          style: { background: SCORING.colors[key] }
        })]
      }),
      el('span', { className: 'fraw', text: score.display[key] }),
      el('span', { className: 'fw', text: `×${score.weights[key].toFixed(2)}` })
    ]
  }));

  return el('div', {
    className: 'factors',
    children: [
      ...rows,
      el('div', {
        className: 'fsum',
        children: [
          el('span', { text: 'Σ weighted contribution' }),
          el('b', { text: String(score.total) })
        ]
      })
    ]
  });
}

/**
 * One candidate card: identity, animated score, contribution bar, factor table.
 *
 * @param {{staff:Object, score:Object}} entry
 * @returns {HTMLElement}
 */
export function candidateCard({ staff, score }) {
  return el('div', {
    className: 'cand',
    children: [
      el('div', {
        className: 'cand-top',
        children: [
          el('div', { className: 'ini', text: staff.initials }),
          el('div', {
            className: 'cand-id',
            children: [
              el('div', { className: 'n', text: staff.name }),
              el('div', { className: 'r', text: staff.unit })
            ]
          }),
          el('div', {
            className: 'cand-score',
            children: [
              el('div', { className: 'num', text: '0' }),
              el('div', { className: 'lbl', text: 'score' })
            ]
          })
        ]
      }),
      contributionBar(score),
      factorTable(score)
    ]
  });
}

/**
 * Summary line reporting how many candidates survived the filters.
 *
 * @param {number} considered
 * @param {number} eligible
 * @param {number} filtered
 * @returns {HTMLElement}
 */
export function filterSummary(considered, eligible, filtered) {
  return el('div', {
    className: 'filter-summary',
    children: [
      document.createTextNode(`${considered} considered · `),
      el('b', { text: `${eligible} eligible` }),
      document.createTextNode(filtered ? ` · ${filtered} filtered out` : '')
    ]
  });
}

/**
 * Struck-through line naming a filtered candidate and the check they failed.
 *
 * @param {string} name
 * @param {string} failedOn
 * @returns {HTMLElement}
 */
export function filterCut(name, failedOn) {
  return el('div', { className: 'filter-cut', text: `${name} — failed ${failedOn}` });
}

/**
 * Dispatch confirmation banner.
 *
 * @param {Object} staff
 * @param {Object} task
 * @param {number} latencyMs
 * @returns {HTMLElement}
 */
export function dispatchBanner(staff, task, latencyMs) {
  return el('div', {
    className: 'dispatch in',
    children: [
      el('span', { className: 'tick', text: '✓' }),
      el('span', {
        className: 'dt',
        children: [
          document.createTextNode('Assigned to '),
          el('b', { text: staff.name }),
          document.createTextNode(` · ETA ${(staff.etaSec / 60).toFixed(1)} min to ${task.loc}`)
        ]
      }),
      el('span', { className: 'lat', text: `${latencyMs}ms` })
    ]
  });
}

/**
 * Banner shown when no candidate clears the filters.
 *
 * @param {string} rationale
 * @returns {HTMLElement}
 */
export function noMatchBanner(rationale) {
  return el('div', {
    className: 'dispatch in',
    children: [
      el('span', { className: 'tick', text: '!' }),
      el('span', { className: 'dt', text: rationale })
    ]
  });
}

/**
 * Metadata row for an assigned task: location, deadline, travel time.
 *
 * @param {Object} task
 * @param {Object} staff
 * @returns {HTMLElement}
 */
export function taskMeta(task, staff) {
  const item = (path, label) => el('span', {
    children: [icon(path), document.createTextNode(label)]
  });
  return el('div', {
    className: 'job-mt',
    children: [
      item(ICONS.pin, task.loc),
      item(ICONS.clock, `SLA ${Math.round(task.slaSec / 60)}m`),
      item(ICONS.pulse, `ETA ${(staff.etaSec / 60).toFixed(1)}m`)
    ]
  });
}

/**
 * Terminal state row for a task the staffer has closed or returned.
 *
 * @param {string} text
 * @param {boolean} [muted=false]
 * @returns {HTMLElement}
 */
export function jobState(text, muted = false) {
  return el('div', {
    className: muted ? 'job-state muted' : 'job-state',
    children: [
      el('span', { className: 'tick', text: muted ? '↻' : '✓' }),
      el('span', { text })
    ]
  });
}
