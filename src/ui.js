/**
 * @file Sequence orchestration.
 *
 * Coordinates the routing animation. Contains no scoring logic and no element
 * construction — decisions come from {@link module:scoring}, nodes come from
 * {@link module:render}. Each visual phase is a separate named function so the
 * sequence reads as a list of steps rather than one long procedure.
 *
 * @module ui
 */

import { route } from './scoring.js';
import { explainAssignment, resolveNoMatch, parseIncident, llmConfig } from './llm.js';
import { SCENARIOS } from './data.js';
import { el, clear, announce } from './dom.js';
import {
  candidateCard, filterSummary, filterCut, dispatchBanner, noMatchBanner, FILTER_NAMES
} from './render.js';
import { taskCard, createDeviceState, applyTaskEvent } from './device.js';

const $ = id => document.getElementById(id);

/**
 * Animation timings in milliseconds at 1x speed. Extracted so pacing lives in
 * one place and the phase functions carry no unexplained literals.
 * @constant
 */
export const TIMING = Object.freeze({
  incidentReveal: 500,
  gateStep: 160,
  cutStep: 140,
  afterFilters: 320,
  cardEnter: 90,
  cardSettle: 300,
  beforeVerdict: 280,
  factorsOpen: 700,
  beforeDispatch: 600,
  beforeMobileSwitch: 450
});

/** Sequence state. @private */
const state = {
  scenarioIndex: 0,
  speed: 1,
  routed: 0,
  running: false,
  device: createDeviceState(0),
  customTask: null
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms / state.speed));
const isMobile = () => window.matchMedia('(max-width:760px)').matches;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Show either the engine or device panel on narrow viewports.
 * @param {'engine'|'device'} view
 */
function setView(view) {
  $('grid').dataset.view = view;
  document.querySelectorAll('.switch button').forEach(button => {
    const active = button.dataset.v === view;
    button.classList.toggle('on', active);
    button.setAttribute('aria-selected', String(active));
    button.setAttribute('tabindex', active ? '0' : '-1');
  });
  if (view === 'device') $('sw-dot').hidden = true;
  window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/**
 * Animate a number upward. Collapses to an instant write when the user has
 * requested reduced motion.
 *
 * @param {HTMLElement} node
 * @param {number} target
 * @returns {Promise<void>}
 */
function countUp(node, target) {
  if (reducedMotion()) {
    node.textContent = String(target);
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let value = 0;
    let last = 0;
    const step = now => {
      if (now - last >= 34 / state.speed) {
        value += Math.max(1, Math.ceil((target - value) / 4));
        if (value >= target) {
          node.textContent = String(target);
          resolve();
          return;
        }
        node.textContent = String(value);
        last = now;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * Apply queued width writes in a single frame, avoiding layout thrash from
 * interleaved reads and writes.
 *
 * @param {Array<[HTMLElement, string]>} pairs
 */
function batchWidths(pairs) {
  requestAnimationFrame(() => {
    for (const [node, width] of pairs) node.style.width = width;
  });
}

/**
 * Render the incident header.
 * @param {Object} task
 * @returns {Promise<void>}
 */
async function phaseShowIncident(task) {
  $('incident').classList.add('hot');
  $('inc-title').textContent = task.title;
  $('inc-meta').textContent =
    `${task.loc.toUpperCase()} · ${task.origin} · SLA ${Math.round(task.slaSec / 60)} MIN`;

  const chip = $('inc-chip');
  chip.hidden = false;
  chip.className = `chip ${task.priority === 'crit' ? 'crit' : 'warn'}`;
  chip.textContent = task.priority === 'crit' ? 'Urgent' : 'Routine';

  $('weightmode').textContent = `Weights: ${task.mode}`;
  announce(`Incident: ${task.title}`);
  await wait(TIMING.incidentReveal);
}

/**
 * Animate the filter gates and list who was cut.
 * @param {HTMLElement} routeEl
 * @param {Object} decision
 * @param {number} poolSize
 * @returns {Promise<void>}
 */
async function phaseRunFilters(routeEl, decision, poolSize) {
  routeEl.appendChild(el('div', { className: 'stage-lbl', text: 'Stage 1 · Hard filters' }));

  const gates = clear($('gates'));
  const fragment = document.createDocumentFragment();
  const nodes = FILTER_NAMES.map(name => {
    const gate = el('span', { className: 'gate', text: name });
    fragment.appendChild(gate);
    return gate;
  });
  gates.appendChild(fragment);

  for (const gate of nodes) {
    await wait(TIMING.gateStep);
    gate.classList.add('pass');
  }

  routeEl.appendChild(
    filterSummary(poolSize, decision.eligible.length, decision.filtered.length)
  );

  for (const item of decision.filtered) {
    routeEl.appendChild(filterCut(item.staff.name, item.filter.failedOn));
    await wait(TIMING.cutStep);
  }
  await wait(TIMING.afterFilters);
}

/**
 * Render and animate each eligible candidate.
 * @param {HTMLElement} routeEl
 * @param {Array} ranked
 * @returns {Promise<HTMLElement[]>}
 */
async function phaseScoreCandidates(routeEl, ranked) {
  routeEl.appendChild(el('div', { className: 'stage-lbl', text: 'Stage 2 · Weighted scoring' }));

  const cards = [];
  for (const entry of ranked) {
    const card = candidateCard(entry);
    routeEl.appendChild(card);
    cards.push(card);

    await wait(TIMING.cardEnter);
    card.classList.add('in');
    await countUp(card.querySelector('.cand-score .num'), entry.score.total);

    batchWidths(Array.from(card.querySelectorAll('.stack i'), seg => [seg, `${seg.dataset.w}%`]));
    await wait(TIMING.cardSettle);
  }
  return cards;
}

/**
 * Mark the winner and open its factor table.
 * @param {HTMLElement[]} cards
 * @returns {Promise<void>}
 */
async function phaseRevealWinner(cards) {
  await wait(TIMING.beforeVerdict);

  cards.forEach((card, index) => {
    if (index === 0) {
      card.classList.add('win');
      card.querySelector('.cand-id .n').appendChild(el('span', { className: 'badge', text: 'Assigned' }));
    } else {
      card.classList.add('out');
    }
  });

  const factors = cards[0].querySelector('.factors');
  factors.classList.add('open');
  batchWidths(Array.from(factors.querySelectorAll('.fbar i'), bar => [bar, `${bar.dataset.w}%`]));
  await wait(TIMING.factorsOpen);
}

/**
 * Show the dispatch confirmation and update telemetry.
 * @param {HTMLElement} routeEl
 * @param {Object} winner
 * @param {Object} task
 * @param {number} latencyMs
 * @returns {Promise<void>}
 */
async function phaseDispatch(routeEl, winner, task, latencyMs) {
  routeEl.appendChild(dispatchBanner(winner.staff, task, latencyMs));
  routeEl.scrollTop = routeEl.scrollHeight;

  state.routed += 1;
  $('t-routed').textContent = String(state.routed);
  $('t-lat').textContent = `${latencyMs}ms`;
  announce(`Assigned to ${winner.staff.name}, score ${winner.score.total}`);
  await wait(TIMING.beforeDispatch);
}

/**
 * Place the assigned task on the device panel.
 * @param {Object} winner
 * @param {Object} task
 * @param {string} reason
 */
function phasePushToDevice(winner, task, reason) {
  const { staff } = winner;
  $('d-av').textContent = staff.initials;
  $('d-name').textContent = staff.name;
  $('d-role').textContent = staff.unit;

  state.device = createDeviceState(staff.doneThisShift);
  $('d-done').textContent = String(state.device.done);

  const idle = $('d-idle');
  if (idle) idle.style.display = 'none';

  const card = taskCard({
    task, staff, reason,
    onCountChange: event => {
      state.device = applyTaskEvent(state.device, event);
      $('d-open').textContent = String(state.device.open);
      $('d-done').textContent = String(state.device.done);
    }
  });

  $('d-list').insertBefore(card, $('d-list').firstChild);
  state.device = applyTaskEvent(state.device, 'assign');
  $('d-open').textContent = String(state.device.open);
}

/**
 * Enable or disable the sequence controls together.
 * @param {boolean} busy
 * @param {string} [runLabel]
 */
function setControlsBusy(busy, runLabel) {
  $('run').disabled = busy;
  $('next').disabled = busy;
  $('route').setAttribute('aria-busy', String(busy));
  if (runLabel) $('run').textContent = runLabel;
}

/**
 * Run the routing sequence for the current scenario.
 * @returns {Promise<void>}
 */
export async function run() {
  if (state.running) return;
  state.running = true;

  const scenario = SCENARIOS[state.scenarioIndex];
  const pool = scenario.pool;
  const task = state.customTask ?? scenario.task;
  const routeEl = clear($('route'));
  const started = performance.now();
  setControlsBusy(true);

  try {
    await phaseShowIncident(task);

    const decision = route(pool, task);
    await phaseRunFilters(routeEl, decision, pool.length);

    if (!decision.winner) {
      const fallback = await resolveNoMatch(task, decision.filtered);
      routeEl.appendChild(noMatchBanner(fallback.rationale));
      announce(fallback.rationale);
      return;
    }

    const cards = await phaseScoreCandidates(routeEl, decision.ranked);
    await phaseRevealWinner(cards);
    await phaseDispatch(routeEl, decision.winner, task, Math.round(performance.now() - started));

    const reason = await explainAssignment(decision.winner.staff, decision.winner.score, task);
    phasePushToDevice(decision.winner, task, reason);

    if (isMobile()) {
      $('sw-dot').hidden = false;
      await wait(TIMING.beforeMobileSwitch);
      setView('device');
    }
  } catch (error) {
    console.error('[dispatch] sequence failed:', error);
    routeEl.appendChild(el('div', {
      className: 'filter-cut',
      text: 'Sequence interrupted — press Trigger to retry.'
    }));
  } finally {
    setControlsBusy(false, 'Re-run this incident');
    state.customTask = null;
    state.running = false;
  }
}

/**
 * Reset the engine panel and advance to the next scenario.
 */
export function nextScenario() {
  state.scenarioIndex = (state.scenarioIndex + 1) % SCENARIOS.length;

  $('incident').classList.remove('hot');
  $('inc-title').textContent = 'No active incident';
  $('inc-meta').textContent = 'Trigger one to watch the engine assign it';
  $('inc-chip').hidden = true;
  clear($('gates'));

  clear($('route')).appendChild(el('div', {
    className: 'idle',
    children: [
      el('div', { className: 'big', text: 'Engine idle' }),
      document.createTextNode('Filters run first, then five weighted factors score everyone who survives.')
    ]
  }));

  $('run').disabled = false;
  $('run').textContent = 'Trigger incident';
  $('next').disabled = true;
  if (isMobile()) setView('engine');
}


/**
 * Parse a free-text incident report through the generative layer, show the
 * structured fields it produced, then route it.
 *
 * This is the generative step made visible: the operator types prose, and the
 * structured task the router consumes appears on screen before dispatch.
 *
 * @returns {Promise<void>}
 */
async function runTriage() {
  const input = $('triage-input');
  const output = $('triage-out');
  const button = $('triage-run');
  const report = input.value.trim();
  if (!report) {
    input.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Parsing…';

  try {
    const parsed = await parseIncident(report);
    const widest = SCENARIOS.reduce((a, b) => (a.pool.length >= b.pool.length ? a : b));
    state.customTask = { ...parsed, zone: widest.task.zone };

    clear(output);
    output.hidden = false;
    const fields = [
      ['role', parsed.needRole],
      ['priority', parsed.mode],
      ['SLA', `${Math.round(parsed.slaSec / 60)}m`],
      ['certs', parsed.needCerts.length ? parsed.needCerts.join(', ') : 'none'],
      ['source', parsed.source === 'llm' ? 'model' : 'rules']
    ];
    for (const [key, value] of fields) {
      output.appendChild(el('span', {
        className: 'tfield',
        children: [document.createTextNode(`${key} `), el('b', { text: String(value) })]
      }));
    }

    announce(`Parsed as ${parsed.needRole}, ${parsed.mode} priority`);
    state.scenarioIndex = SCENARIOS.indexOf(widest);
    await run();
  } catch (error) {
    console.error('[dispatch] triage failed:', error);
    clear(output);
    output.hidden = false;
    output.appendChild(el('span', { className: 'tfield', text: 'Parse failed — try rephrasing.' }));
  } finally {
    button.disabled = false;
    button.textContent = 'Parse & route';
  }
}

/**
 * Wire up controls. Called once on load.
 */
export function init() {
  document.querySelectorAll('.seg button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.seg button').forEach(other => {
        other.classList.remove('on');
        other.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('on');
      button.setAttribute('aria-pressed', 'true');
      state.speed = Number(button.dataset.sp);
    });
  });

  const tabs = Array.from(document.querySelectorAll('.switch button'));
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => setView(button.dataset.v));
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : tabs.length - 1;
      const next = tabs[(index + step) % tabs.length];
      setView(next.dataset.v);
      next.focus();
    });
  });

  $('triage-run').addEventListener('click', runTriage);
  $('triage-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') runTriage();
  });
  const modeTag = $('triage-mode');
  modeTag.textContent = llmConfig.enabled ? 'model' : 'rules';
  modeTag.classList.toggle('live', llmConfig.enabled);

  $('run').addEventListener('click', run);
  $('next').addEventListener('click', nextScenario);
  $('next').disabled = true;
  setView('engine');
}
