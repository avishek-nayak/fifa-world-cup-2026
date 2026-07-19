/**
 * @file The assigned staffer's device panel.
 *
 * Task counters live in a small state object created by {@link createDeviceState}
 * rather than as module-level globals, so the counter logic can be exercised in
 * isolation without a document.
 *
 * @module device
 */

import { el, replace, announce } from './dom.js';
import { taskMeta, jobState, priorityClass, ICONS } from './render.js';
import { icon } from './dom.js';

/**
 * Create a fresh counter state for the device panel.
 *
 * @param {number} [done=0] Tasks already closed this shift.
 * @returns {{open:number, done:number}}
 */
export function createDeviceState(done = 0) {
  return { open: 0, done };
}

/**
 * Apply a task lifecycle transition to the counters.
 *
 * Pure: returns a new state rather than mutating, so transitions can be
 * asserted directly in tests.
 *
 * @param {{open:number, done:number}} state
 * @param {'assign'|'close'|'return'} event
 * @returns {{open:number, done:number}}
 * @throws {Error} On an unrecognised event.
 */
export function applyTaskEvent(state, event) {
  switch (event) {
    case 'assign': return { ...state, open: state.open + 1 };
    case 'close': return { open: Math.max(0, state.open - 1), done: state.done + 1 };
    case 'return': return { ...state, open: Math.max(0, state.open - 1) };
    default: throw new Error(`Unknown task event: ${event}`);
  }
}

/**
 * Build the action row for a freshly assigned task.
 *
 * @param {Object} handlers
 * @param {Function} handlers.onAccept
 * @param {Function} handlers.onPass
 * @returns {HTMLElement}
 * @private
 */
function actionRow({ onAccept, onPass }) {
  return el('div', {
    className: 'job-act',
    children: [
      el('button', {
        className: 'go', text: 'Accept', attrs: { type: 'button' }, on: { click: onAccept }
      }),
      el('button', {
        text: "Can't take it", attrs: { type: 'button' }, on: { click: onPass }
      })
    ]
  });
}

/**
 * Build a task card for the device panel.
 *
 * @param {Object} options
 * @param {Object} options.task
 * @param {Object} options.staff
 * @param {string} options.reason Generated explanation.
 * @param {Function} options.onCountChange Called with a lifecycle event name.
 * @returns {HTMLElement}
 */
export function taskCard({ task, staff, reason, onCountChange }) {
  const card = el('article', {
    className: 'job fresh',
    attrs: { 'aria-label': `Assigned task: ${task.title}` }
  });

  const removeSoon = () => {
    setTimeout(() => {
      card.classList.add('gone');
      setTimeout(() => card.remove(), 420);
    }, 950);
  };

  const handleClose = actions => {
    actions.replaceWith(jobState('Closed · logged to ops'));
    onCountChange('close');
    announce(`Task closed: ${task.title}`);
    removeSoon();
  };

  const handleAccept = () => {
    card.classList.remove('fresh');
    const doneButton = el('button', {
      className: 'go', text: 'Mark done', attrs: { type: 'button', style: 'flex:1' }
    });
    const actions = card.querySelector('.job-act');
    replace(actions, doneButton);
    doneButton.addEventListener('click', () => handleClose(actions));
  };

  const handlePass = () => {
    const actions = card.querySelector('.job-act');
    actions.replaceWith(jobState('Returned · re-scoring remaining pool', true));
    onCountChange('return');
    announce('Task returned and re-routing');
    removeSoon();
  };

  card.append(
    el('div', {
      className: 'job-top',
      children: [
        el('span', { className: `job-pr ${priorityClass(task.priority)}` }),
        el('div', {
          className: 'job-tx',
          children: [
            el('div', { className: 'job-tt', text: task.title }),
            taskMeta(task, staff)
          ]
        })
      ]
    }),
    el('div', {
      className: 'job-why',
      children: [icon(ICONS.info), el('span', { text: reason })]
    }),
    actionRow({ onAccept: handleAccept, onPass: handlePass })
  );

  return card;
}
