/**
 * @file Deterministic staff-routing engine.
 *
 * Two-stage model:
 *   Stage 1 — hard filters remove anyone who *cannot* perform the task.
 *   Stage 2 — weighted factors rank everyone who survives.
 *
 * Deliberately contains no DOM access, no I/O and no randomness, so every
 * result is reproducible and unit-testable. See {@link ../../docs/ARCHITECTURE.md}
 * for why scoring is arithmetic rather than model-driven.
 *
 * @module scoring
 */

/**
 * Weight sets, factor colours and display labels.
 *
 * Weights within each mode sum to 1.0 — enforced by {@link validateWeights}
 * and asserted in the test suite.
 *
 * @constant
 */
export const SCORING = Object.freeze({
  weights: Object.freeze({
    urgent: Object.freeze({
      proximity: 0.50, availability: 0.20, load: 0.05, capability: 0.20, continuity: 0.05
    }),
    routine: Object.freeze({
      proximity: 0.20, availability: 0.20, load: 0.35, capability: 0.15, continuity: 0.10
    })
  }),
  colors: Object.freeze({
    proximity: '#38BDF8', availability: '#34D399', load: '#FBBF24',
    capability: '#A78BFA', continuity: '#F472B6'
  }),
  labels: Object.freeze({
    proximity: 'Proximity', availability: 'Availability', load: 'Load balance',
    capability: 'Capability', continuity: 'Continuity'
  })
});

/** Ordered factor keys. Rendering and scoring both rely on this order. @constant {string[]} */
export const FACTOR_KEYS = Object.freeze([
  'proximity', 'availability', 'load', 'capability', 'continuity'
]);

/** Staff states that make someone ineligible regardless of other attributes. @constant {string[]} */
export const BLOCKING_STATUSES = Object.freeze(['off-duty', 'on-break', 'locked']);

/**
 * Clamp a number into a range. Non-finite input collapses to the lower bound
 * so malformed telemetry can never inflate a score.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Factor normalisers. Each maps raw telemetry onto 0–1, where 1 is ideal.
 * @namespace
 */
export const norm = {
  /**
   * Travel time measured against the deadline. Meeting or exceeding the SLA
   * scores 0 — arriving late is worth nothing regardless of other merits.
   *
   * @param {number} etaSec Estimated travel time in seconds.
   * @param {number} slaSec Task deadline in seconds.
   * @returns {number} 0–1
   */
  proximity(etaSec, slaSec) {
    if (!Number.isFinite(slaSec) || slaSec <= 0) return 0;
    return clamp(1 - (etaSec / slaSec), 0, 1);
  },

  /**
   * Interruptibility by current task state. Unknown states score 0 rather
   * than defaulting to available.
   *
   * @param {'idle'|'finishing'|'active'|'assigned'|string} state
   * @returns {number} 0–1
   */
  availability(state) {
    const table = { idle: 1, finishing: 0.6, active: 0.2, assigned: 0 };
    return Object.prototype.hasOwnProperty.call(table, state) ? table[state] : 0;
  },

  /**
   * Fairness and fatigue. Someone who has closed fewer tasks than the busiest
   * eligible peer scores higher. Without this factor the closest reliable
   * staffer absorbs every task for the whole shift.
   *
   * @param {number} done Tasks closed this shift.
   * @param {number} poolMax Highest task count among eligible staff.
   * @returns {number} 0–1
   */
  load(done, poolMax) {
    if (!Number.isFinite(poolMax) || poolMax <= 0) return 1;
    return clamp(1 - (done / poolMax), 0, 1);
  },

  /**
   * Fit beyond bare qualification: seniority, equipment carried, and past
   * performance on this task type.
   *
   * @param {{seniority:number, kit:number, history:number}} c
   * @returns {number} 0–1
   */
  capability(c) {
    if (!c) return 0;
    return clamp(
      0.40 * (c.seniority ?? 0) + 0.35 * (c.kit ?? 0) + 0.25 * (c.history ?? 0),
      0, 1
    );
  },

  /**
   * Local knowledge accumulated during this match. Saturates — a fourth shift
   * in a zone adds nothing over a third.
   *
   * @param {{zoneShifts:number, similarTasks:number}} c
   * @returns {number} 0–1
   */
  continuity(c) {
    if (!c) return 0;
    const zone = Math.min((c.zoneShifts ?? 0) / 3, 1);
    const similar = Math.min((c.similarTasks ?? 0) / 4, 1);
    return clamp(0.6 * zone + 0.4 * similar, 0, 1);
  }
};

/**
 * Stage 1. Binary eligibility checks, evaluated in a fixed order so the
 * reported failure reason is deterministic.
 *
 * @param {Object} staff
 * @param {Object} task
 * @returns {{pass:boolean, checks:Array<{id:string, ok:boolean}>, failedOn:(string|null)}}
 */
export function passesFilters(staff, task) {
  const checks = [
    { id: 'role', ok: staff.role === task.needRole },
    { id: 'certified', ok: (task.needCerts ?? []).every(c => (staff.certs ?? []).includes(c)) },
    { id: 'on shift', ok: Boolean(staff.onShift) && (staff.shiftLeftMin * 60) > task.slaSec },
    { id: 'status', ok: !BLOCKING_STATUSES.includes(staff.status) },
    { id: 'zone', ok: (staff.zoneAccess ?? []).includes(task.zone) }
  ];
  const failed = checks.find(c => !c.ok);
  return { pass: !failed, checks, failedOn: failed ? failed.id : null };
}

/**
 * Stage 2. Weighted score for one eligible staff member.
 *
 * `total` is `100 × Σ(weight × normalised factor)`, rounded. Because every
 * weight set sums to 1.0 and every factor is bounded 0–1, `total` is always 0–100.
 *
 * @param {Object} staff
 * @param {Object} task
 * @param {number} poolMax Highest `doneThisShift` among eligible staff.
 * @param {'urgent'|'routine'} mode
 * @returns {{total:number, raw:Object, parts:Object, weights:Object, display:Object}}
 * @throws {Error} If `mode` is not a known weight set.
 */
export function scoreStaff(staff, task, poolMax, mode) {
  const weights = SCORING.weights[mode];
  if (!weights) throw new Error(`Unknown scoring mode: ${mode}`);

  const raw = {
    proximity: norm.proximity(staff.etaSec, task.slaSec),
    availability: norm.availability(staff.state),
    load: norm.load(staff.doneThisShift, poolMax),
    capability: norm.capability(staff.capability),
    continuity: norm.continuity(staff.continuity)
  };

  const parts = {};
  let total = 0;
  for (const key of FACTOR_KEYS) {
    parts[key] = weights[key] * raw[key];
    total += parts[key];
  }

  return {
    total: Math.round(total * 100),
    raw,
    parts,
    weights,
    display: {
      proximity: `${(staff.etaSec / 60).toFixed(1)}m`,
      availability: staff.state,
      load: `${staff.doneThisShift}/${poolMax}`,
      capability: `${Math.round(raw.capability * 100)}%`,
      continuity: `${Math.round(raw.continuity * 100)}%`
    }
  };
}

/**
 * Run both stages over a staff pool and return the full decision.
 *
 * Ties are broken by proximity, then by lower current load, so the result is
 * stable across runs rather than dependent on array order.
 *
 * @param {Object[]} pool
 * @param {Object} task
 * @returns {{eligible:Array, filtered:Array, ranked:Array, winner:(Object|null), poolMax:number}}
 */
export function route(pool, task) {
  const evaluated = pool.map(staff => ({ staff, filter: passesFilters(staff, task) }));
  const eligible = evaluated.filter(e => e.filter.pass);
  const filtered = evaluated.filter(e => !e.filter.pass);

  const poolMax = Math.max(1, ...eligible.map(e => e.staff.doneThisShift ?? 0));

  const ranked = eligible
    .map(e => ({ staff: e.staff, score: scoreStaff(e.staff, task, poolMax, task.mode) }))
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      if (a.staff.etaSec !== b.staff.etaSec) return a.staff.etaSec - b.staff.etaSec;
      return (a.staff.doneThisShift ?? 0) - (b.staff.doneThisShift ?? 0);
    });

  return { eligible, filtered, ranked, winner: ranked[0] ?? null, poolMax };
}

/**
 * Verify every weight set sums to 1.0 within floating-point tolerance.
 * A drifting weight set silently rescales every score, so this is asserted
 * at load time in tests.
 *
 * @param {number} [tolerance=1e-9]
 * @returns {boolean}
 */
export function validateWeights(tolerance = 1e-9) {
  return Object.values(SCORING.weights).every(set => {
    const sum = FACTOR_KEYS.reduce((acc, k) => acc + set[k], 0);
    return Math.abs(sum - 1) < tolerance;
  });
}
