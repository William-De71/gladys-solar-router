// -----------------------------------------------------------------------------
// Scene triggers and scene actions of the solar router integration.
//
// Triggers (once per transition, worked out after each reading, never from a
// scene action, never at the first reading of a router):
//   - router_unreachable  no answer UNREACHABLE_AFTER times in a row, and for
//                         at least UNREACHABLE_MIN_MS;
//   - router_back_online  it answers again;
//   - router_restarted    its uptime went back (F1ATB: power cut, update);
//   - forcing_ended       an F1ATB output forced on or off went back to
//                         automatic by itself (its countdown reached 0).
//
// Scene actions:
//   - set_output_mode     forced on, forced off or automatic, for some minutes
//                         on an F1ATB (it counts them down), until changed on
//                         an MSunPV;
//   - get_today           today's energy of a router (drawn, exported,
//                         routed, produced) and its power now.
// -----------------------------------------------------------------------------

const TRIGGERS = {
  UNREACHABLE: 'router_unreachable',
  BACK_ONLINE: 'router_back_online',
  RESTARTED: 'router_restarted',
  FORCING_ENDED: 'forcing_ended',
};
const SCENE_ACTIONS = { SET_OUTPUT_MODE: 'set_output_mode', GET_TODAY: 'get_today' };
const MODES = ['on', 'off', 'auto'];
const DEFAULT_MINUTES = 60;
const SET_MODE_OUTPUTS = ['output_name', 'mode', 'minutes', 'summary'];
const TODAY_OUTPUTS = [
  'router_name',
  'imported_kwh',
  'exported_kwh',
  'routed_kwh',
  'produced_kwh',
  'grid_watts',
  'summary',
];
const UNREACHABLE_AFTER = 3;
const UNREACHABLE_MIN_MS = 60 * 1000;

/**
 * @description Keep only the declared keys of an object (outputs).
 * @param {object} values - The values.
 * @param {string[]} keys - The declared keys.
 * @returns {object} The kept values, without the null ones.
 */
function pick(values, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => values[key] !== undefined && values[key] !== null)
      .map((key) => [key, values[key]]),
  );
}

/**
 * @description A number rounded to some decimals.
 * @param {number|null} value - The value.
 * @param {number} decimals - The decimals.
 * @returns {number|null} The rounded value.
 */
function rounded(value, decimals) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * @description What changed for a router after a reading.
 * @param {object} previous - `{ failures, since, uptime, down, seen }` (or undefined).
 * @param {object} reading - `{ ok: boolean, uptimeHours: number|null, now: number }`.
 * @returns {{ next: object, events: Array<{ key: string, data: object }> }} The new
 * state and the events (data without the router identity).
 */
function detectRouter(previous, reading) {
  const state = previous ?? { failures: 0, since: null, uptime: null, down: false, seen: false };
  const events = [];
  const next = { ...state };
  if (!reading.ok) {
    next.failures = (state.failures ?? 0) + 1;
    next.since ??= reading.now;
    if (
      !state.down &&
      state.seen &&
      next.failures >= UNREACHABLE_AFTER &&
      reading.now - next.since >= UNREACHABLE_MIN_MS
    ) {
      next.down = true;
      events.push({ key: TRIGGERS.UNREACHABLE, data: { failures: next.failures } });
    }
    return { next, events };
  }
  if (state.down) {
    events.push({
      key: TRIGGERS.BACK_ONLINE,
      data: {
        down_minutes: Math.max(0, Math.round((reading.now - (state.since ?? reading.now)) / 60000)),
      },
    });
  }
  const uptime = reading.uptimeHours;
  // The firmware rounds the uptime to 0.01 h: a drop of more than that is a restart.
  if (
    state.seen &&
    Number.isFinite(state.uptime) &&
    Number.isFinite(uptime) &&
    uptime < state.uptime - 0.02
  ) {
    events.push({
      key: TRIGGERS.RESTARTED,
      data: { uptime_before_hours: rounded(state.uptime, 1) },
    });
  }
  next.failures = 0;
  next.since = null;
  next.down = false;
  next.seen = true;
  next.uptime = Number.isFinite(uptime) ? uptime : state.uptime;
  return { next, events };
}

/**
 * @description The F1ATB outputs whose forcing ended by itself.
 * @param {object[]} before - The outputs before the reading.
 * @param {object[]} after - The outputs after it.
 * @param {Set<string>} commanded - The outputs a scene or the user just set (ignored).
 * @returns {Array<{ key: string, previous: string }>} The outputs, with the mode they left.
 */
function endedForcings(before, after, commanded) {
  const found = [];
  for (const output of after) {
    const old = before.find((entry) => entry.key === output.key);
    if (!old || commanded.has(output.key)) continue;
    if ((old.mode === 'on' || old.mode === 'off') && output.mode === 'auto') {
      found.push({ key: output.key, previous: old.mode });
    }
  }
  return found;
}

export {
  TRIGGERS,
  SCENE_ACTIONS,
  MODES,
  DEFAULT_MINUTES,
  SET_MODE_OUTPUTS,
  TODAY_OUTPUTS,
  UNREACHABLE_AFTER,
  UNREACHABLE_MIN_MS,
  pick,
  rounded,
  detectRouter,
  endedForcings,
};
