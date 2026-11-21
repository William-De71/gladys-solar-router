// -----------------------------------------------------------------------------
// Dashboard widgets of the solar router integration (pure builders: app.js
// gives them what it read).
//
//   - overview: one router, the grid exchange and the routed (F1ATB) or
//     produced (MSunPV) power now, today's energy, the state of each output,
//     and a button per output (the first two) to force it or give it back to
//     the router;
//   - power:    one router, a chart of the last 24 hours (5-minute points kept
//     by the integration): grid exchange, and routed or produced power.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS, WIDGET_BUTTON_STYLES } from '@gladysassistant/integration-sdk';
import { t, ago, formatNumber } from './i18n.js';

const WIDGETS = { OVERVIEW: 'overview', POWER: 'power' };
const WIDGET_ACTIONS = { SET_MODE: 'set_mode' };
const TTL_SECONDS = { overview: 30, power: 300, message: 120 };
const MAX_BUTTONS = 2;
const MAX_TEMPERATURE_ROWS = 2;

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A widget content made of one message.
 * @param {string} message - The message.
 * @param {object} [options] - `{ heading, ttl }`.
 * @returns {object} The content.
 */
function messageContent(message, { heading, ttl = TTL_SECONDS.message } = {}) {
  const components = [];
  if (heading) {
    components.push({ type: 'text', variant: 'heading', text: clip(heading, 40) });
  }
  components.push({ type: 'text', variant: 'body', text: clip(message, 300) });
  return { ttl_seconds: ttl, components };
}

/**
 * @description A power as a tile value: W below 10 kW, kW above.
 * @param {number|null} watts - The power.
 * @param {string} language - The language.
 * @returns {{ value: string, unit?: string }} The value and its unit.
 */
function powerValue(watts, language) {
  if (!Number.isFinite(watts)) return { value: '–' };
  if (Math.abs(watts) >= 10000) {
    return { value: clip(formatNumber(watts / 1000, language, 1), 12), unit: 'kW' };
  }
  return { value: clip(formatNumber(watts, language, 0), 12), unit: 'W' };
}

/**
 * @description An energy in Wh as a tile value in kWh.
 * @param {number|null} wh - The energy.
 * @param {string} language - The language.
 * @returns {{ value: string, unit?: string }} The value and its unit.
 */
function energyValue(wh, language) {
  if (!Number.isFinite(wh)) return { value: '–' };
  return { value: clip(formatNumber(wh / 1000, language, 2), 12), unit: 'kWh' };
}

/**
 * @description The grid exchange of a router, signed (import > 0, export < 0).
 * @param {object} values - The router values.
 * @returns {number|null} The power.
 */
function gridOf(values = {}) {
  if (Number.isFinite(values.gridW)) return values.gridW;
  if (Number.isFinite(values.gridImportW) || Number.isFinite(values.gridExportW)) {
    return (values.gridImportW ?? 0) - (values.gridExportW ?? 0);
  }
  return null;
}

/**
 * @description The text of an output state: "Automatic · 45 %", "Forced on · 1 h 20".
 * @param {object} output - The stored output.
 * @param {string} model - `f1atb` or `msunpv`.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function outputState(output, model, language) {
  const parts = [];
  if (output.mode === 'auto') parts.push(t('mode_auto', language));
  else if (output.mode === 'on') parts.push(t('mode_forced_on', language));
  else if (output.mode === 'off') {
    parts.push(t(model === 'f1atb' ? 'mode_forced_off' : 'mode_off', language));
  }
  if (output.mode !== 'auto' && output.forceMinutes > 0) {
    parts.push(t('minutesLeft', language, { n: output.forceMinutes }));
  }
  if (Number.isFinite(output.powerW)) parts.push(`${formatNumber(output.powerW, language, 0)} W`);
  else if (Number.isFinite(output.opening)) parts.push(`${Math.round(output.opening)} %`);
  return parts.join(' · ') || '–';
}

/**
 * @description The color of an output state.
 * @param {object} output - The stored output.
 * @returns {string} A WIDGET_COLORS value.
 */
function outputColor(output) {
  if (output.mode === 'on') return WIDGET_COLORS.WARNING;
  if (output.mode === 'off') return WIDGET_COLORS.NEUTRAL;
  const active = (output.powerW ?? 0) > 0 || (output.opening ?? 0) > 0;
  return active ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL;
}

/**
 * @description The "overview" widget.
 * @param {object} options - Options.
 * @param {object} options.router - The stored router.
 * @param {string} options.name - Its name (the Gladys one when created).
 * @param {Function} options.outputName - `(output) => name`.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @returns {object} The content.
 */
function buildOverviewWidget({ router, name, outputName, language, now }) {
  const values = router.values ?? {};
  const down = Boolean(router.seen?.down);
  const components = [{ type: 'text', variant: 'heading', text: clip(name, 40) }];
  const grid = gridOf(values);
  const exporting = Number.isFinite(grid) && grid < 0;
  components.push({
    type: 'value',
    label: clip(t(exporting ? 'tileExport' : 'tileImport', language), 24),
    ...powerValue(Number.isFinite(grid) ? Math.abs(grid) : null, language),
    icon: exporting ? 'upload' : 'download',
    color: down ? WIDGET_COLORS.NEUTRAL : exporting ? WIDGET_COLORS.WARNING : WIDGET_COLORS.PRIMARY,
  });
  if (router.model === 'msunpv') {
    components.push({
      type: 'value',
      label: clip(t('tileProduction', language), 24),
      ...powerValue(values.pvW, language),
      icon: 'sun',
      color: down ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.SUCCESS,
    });
  } else if (router.present?.routed_power) {
    components.push({
      type: 'value',
      label: clip(t('tileRouted', language), 24),
      ...powerValue(values.routedW, language),
      icon: 'sun',
      color: down ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.SUCCESS,
    });
  }
  components.push({
    type: 'value',
    label: clip(t('tileExportedToday', language), 24),
    ...energyValue(values.exportTodayWh, language),
    icon: 'upload-cloud',
    color: WIDGET_COLORS.INFO,
  });
  if (Number.isFinite(values.routedTodayWh)) {
    components.push({
      type: 'value',
      label: clip(t('tileRoutedToday', language), 24),
      ...energyValue(values.routedTodayWh, language),
      icon: 'thermometer',
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  const outputs = router.outputs ?? [];
  const rows = [];
  if (down) {
    rows.push({
      label: clip(t('rowState', language), 40),
      value: clip(t('stateUnreachable', language), 40),
      color: WIDGET_COLORS.DANGER,
    });
  }
  for (const output of outputs.slice(0, 6)) {
    rows.push({
      label: clip(outputName(output), 40),
      value: clip(outputState(output, router.model, language), 40),
      color: down ? WIDGET_COLORS.NEUTRAL : outputColor(output),
    });
  }
  const temperatures = Object.entries(values.temperatures ?? {}).slice(0, MAX_TEMPERATURE_ROWS);
  for (const [key, value] of temperatures) {
    rows.push({
      label: clip(t(`feature_${key}`, language), 40),
      value: `${formatNumber(value, language, 1)} °C`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  rows.push({
    label: clip(t('rowLastReading', language), 40),
    value: clip(ago(router.readAt ?? 0, now, language), 40),
    color: down ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
  });
  components.push({ type: 'status', items: rows });
  if (!down) {
    for (const output of outputs.slice(0, MAX_BUTTONS)) {
      const forced = output.mode === 'on';
      components.push({
        type: 'button',
        label: clip(
          t(forced ? 'buttonAuto' : 'buttonForce', language, { name: outputName(output) }),
          24,
        ),
        icon: forced ? 'refresh-cw' : 'zap',
        style: forced ? WIDGET_BUTTON_STYLES.SECONDARY : WIDGET_BUTTON_STYLES.PRIMARY,
        action: {
          key: `${WIDGET_ACTIONS.SET_MODE}_${output.key}`.slice(0, 32),
          params: { router: router.id, output: output.key, mode: forced ? 'auto' : 'on' },
        },
      });
    }
  }
  return { ttl_seconds: TTL_SECONDS.overview, components };
}

/**
 * @description The "power" widget: the last 24 hours.
 * @param {object} options - Options.
 * @param {object} options.router - The stored router.
 * @param {string} options.name - Its name.
 * @param {string} options.language - The user language.
 * @returns {object} The content.
 */
function buildPowerWidget({ router, name, language }) {
  const down = Boolean(router.seen?.down);
  const history = router.history ?? [];
  const components = [{ type: 'text', variant: 'heading', text: clip(name, 40) }];
  const values = router.values ?? {};
  const grid = gridOf(values);
  components.push({
    type: 'value',
    label: clip(t('tileGrid', language), 24),
    ...powerValue(grid, language),
    icon: 'activity',
    color: down ? WIDGET_COLORS.NEUTRAL : WIDGET_COLORS.PRIMARY,
  });
  const second = router.model === 'msunpv' ? 'pv' : 'routed';
  const secondLabel = t(second === 'pv' ? 'tileProduction' : 'tileRouted', language);
  const points = (key) =>
    history
      .filter((point) => Number.isFinite(point[key]))
      .map((point) => ({ t: new Date(point.t).toISOString(), v: Math.round(point[key]) }));
  const series = [{ name: clip(t('tileGrid', language), 40), points: points('grid') }];
  if (points(second).length) series.push({ name: clip(secondLabel, 40), points: points(second) });
  if (series[0].points.length >= 2) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      title: clip(t('chartPowerDay', language), 60),
      unit: 'W',
      series,
    });
  } else if (!down) {
    // Two texts at most: the heading and this caption, or the heading and the body below.
    components.push({
      type: 'text',
      variant: 'caption',
      text: clip(t('widgetNoHistory', language), 80),
    });
  }
  if (down) {
    components.push({ type: 'text', variant: 'body', text: clip(t('widgetDown', language), 300) });
  }
  return { ttl_seconds: TTL_SECONDS.power, components };
}

export {
  WIDGETS,
  WIDGET_ACTIONS,
  TTL_SECONDS,
  MAX_BUTTONS,
  clip,
  messageContent,
  powerValue,
  energyValue,
  gridOf,
  outputState,
  outputColor,
  buildOverviewWidget,
  buildPowerWidget,
};
