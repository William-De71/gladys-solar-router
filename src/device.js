// -----------------------------------------------------------------------------
// The Gladys devices of a solar router:
//
//   - the router itself: `ext:<selector>:router:<id>` (id = the 12 hexadecimal
//     digits of the F1ATB's MAC address, the serial number of an MSunPV):
//     grid exchange, indexes, routed power, production, temperatures, Wi-Fi;
//   - one device per output, so the user adds and places each load (water
//     heater, radiator…): `ext:<selector>:output:<id>-a<n>` for the action n
//     of an F1ATB (0 is the triac), `ext:<selector>:output:<id>-water_heater`
//     and `…-heater` for the two outputs of an MSunPV.
//
// The grid exchange follows the grid-sensor category of Gladys, as each
// router reports it: two values for the F1ATB (input-power, output-power),
// one signed value for the MSunPV (power: import > 0, export < 0).
// A feature appears once its value was seen (a second probe, a temperature
// probe, Wi-Fi rather than Ethernet), and then stays.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';
import { F1ATB_TEMPERATURES, MSUNPV_TEMPERATURES } from './routers.js';
import { MAX_FORCE_MINUTES } from './f1atb.js';

const ROUTER_TYPE = 'router';
const OUTPUT_TYPE = 'output';
const MAX_POWER = 100000;
const MAX_INDEX = 1000000000;

const power = (category, type, min = 0) => ({
  category,
  type,
  unit: U.WATT,
  min,
  max: MAX_POWER,
});
const index = (category, type) => ({
  category,
  type,
  unit: U.KILOWATT_HOUR,
  min: 0,
  max: MAX_INDEX,
});
const temperature = {
  category: C.TEMPERATURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: -50,
  max: 150,
};

const FEATURES = {
  // The router.
  grid_import_power: power(C.GRID_SENSOR, T.GRID_SENSOR.INPUT_POWER),
  grid_export_power: power(C.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_POWER),
  grid_power: power(C.GRID_SENSOR, T.GRID_SENSOR.POWER, -MAX_POWER),
  grid_import_index: index(C.GRID_SENSOR, T.GRID_SENSOR.INPUT_INDEX),
  grid_export_index: index(C.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_INDEX),
  routed_power: power(C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER),
  routed_energy: index(C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX),
  pv_power: power(C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER),
  pv_energy: index(C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.INDEX),
  ...Object.fromEntries(F1ATB_TEMPERATURES.map((key) => [key, temperature])),
  ...Object.fromEntries(Object.values(MSUNPV_TEMPERATURES).map((key) => [key, temperature])),
  rssi: { category: C.SIGNAL, type: T.SIGNAL.QUALITY, unit: null, min: -120, max: 0 },
  // An output.
  opening: { category: C.SWITCH, type: T.SWITCH.DIMMER, unit: null, min: 0, max: 100 },
  power: power(C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER),
  energy: index(C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX),
  forced: {
    category: C.SWITCH,
    type: T.SWITCH.BINARY,
    unit: null,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
  },
  mode: { category: C.TEXT, type: T.TEXT.TEXT, unit: null, min: 0, max: 0 },
  force_remaining: {
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: MAX_FORCE_MINUTES,
  },
  on_hours: {
    category: C.DURATION,
    type: T.DURATION.DECIMAL,
    unit: U.HOURS,
    min: 0,
    max: 24,
  },
};

// The order the router features are offered in.
const ROUTER_FEATURES = [
  'grid_import_power',
  'grid_export_power',
  'grid_power',
  'grid_import_index',
  'grid_export_index',
  'routed_power',
  'routed_energy',
  'pv_power',
  'pv_energy',
  ...F1ATB_TEMPERATURES,
  ...Object.values(MSUNPV_TEMPERATURES),
  'rssi',
];

/**
 * @description The ids of a router.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} id - The router id.
 * @returns {{ device: string, feature: Function }} The ids.
 */
const routerIds = (gladys, id) => gladys.externalIds(ROUTER_TYPE, id);

/**
 * @description The ids of an output.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {string} id - The router id.
 * @param {string} key - "a0", "water_heater".
 * @returns {{ device: string, feature: Function }} The ids.
 */
const outputIds = (gladys, id, key) => gladys.externalIds(OUTPUT_TYPE, `${id}-${key}`);

/**
 * @description What a device external id (or a feature id) points to.
 * @param {unknown} externalId - `ext:…:output:a4cf12345678-a1` (or `…:forced`).
 * @returns {{ type: string, id: string, key: string|null }|null} The target.
 */
function targetOf(externalId) {
  const match = String(externalId ?? '').match(
    /:(router|output):([0-9a-z]+)(?:-(a\d+|water_heater|heater))?(?::[a-z0-9_]+)?$/,
  );
  if (!match) return null;
  return { type: match[1], id: match[2], key: match[3] ?? null };
}

/**
 * @description The feature keys of an output.
 * @param {object} router - The stored router.
 * @returns {string[]} The keys.
 */
function outputFeatureKeys(router) {
  if (router.model === 'f1atb') {
    return ['opening', 'forced', 'mode', 'force_remaining', 'on_hours'];
  }
  return router.fourByFour ? ['power', 'energy', 'forced', 'mode'] : ['opening', 'forced', 'mode'];
}

/**
 * @description The name of a router: "F1ATB <hostname>", "MSunPV 2x2d".
 * @param {object} router - The stored router.
 * @returns {string} The name.
 */
function routerName(router) {
  if (router.model === 'msunpv') {
    const model = String(router.modelName ?? '')
      .replace(/^MS_?PV/i, '')
      .replace(/_/g, 'x')
      .trim();
    return model ? `MSunPV ${model}` : 'MSunPV';
  }
  const name = String(router.name ?? '').trim();
  return name ? `F1ATB ${name}` : 'F1ATB';
}

/**
 * @description The name of an output: its title in the F1ATB, the load of an MSunPV.
 * @param {object} output - The stored output.
 * @param {string} language - The language.
 * @returns {string} "Chauffe-eau", "Water heater".
 */
function outputTitle(output, language) {
  if (output.key === 'water_heater' || output.key === 'heater') {
    return t(`output_${output.key}`, language);
  }
  return String(output.title ?? '').trim() || `Action ${output.index}`;
}

/**
 * @description One feature.
 * @param {Function} id - `feature(key)` of the device ids.
 * @param {string} key - The feature key.
 * @param {string} language - The language of the name.
 * @returns {object} The feature.
 */
function feature(id, key, language) {
  const spec = FEATURES[key];
  return {
    name: t(`feature_${key}`, language),
    external_id: id(key),
    category: spec.category,
    type: spec.type,
    unit: spec.unit,
    min: spec.min,
    max: spec.max,
    read_only: spec.read_only ?? true,
    has_feedback: spec.has_feedback ?? false,
    keep_history: key !== 'mode',
  };
}

/**
 * @description The devices of a router: the router, then its outputs.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} router - The stored router.
 * @param {object} [options] - `{ language }`.
 * @returns {object[]} The discovered devices.
 */
function buildRouterDevices(gladys, router, { language = 'en' } = {}) {
  const ids = routerIds(gladys, router.id);
  const name = routerName(router);
  const model = router.model === 'msunpv' ? router.modelName || 'MSunPV' : 'F1ATB';
  const params = [
    { name: 'ROUTER_MODEL', value: router.model },
    { name: 'ROUTER_ID', value: router.id },
  ];
  const keys = ROUTER_FEATURES.filter((key) => router.present?.[key]);
  const devices = [
    {
      name: `${t('routerPrefix', language)} ${name}`,
      external_id: ids.device,
      model,
      should_poll: false,
      params,
      features: keys.map((key) => feature(ids.feature, key, language)),
    },
  ];
  for (const output of router.outputs ?? []) {
    const outputId = outputIds(gladys, router.id, output.key);
    devices.push({
      name: `${outputTitle(output, language)} (${name})`,
      external_id: outputId.device,
      model: `${model} output`,
      should_poll: false,
      params: [...params, { name: 'ROUTER_OUTPUT', value: output.key }],
      features: outputFeatureKeys(router).map((key) => feature(outputId.feature, key, language)),
    });
  }
  // A device needs at least one feature: a router seen without any value yet waits.
  return devices.filter((device) => device.features.length);
}

const round = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const bounded = (value, key) => Math.min(FEATURES[key].max, Math.max(FEATURES[key].min, value));

/**
 * @description The text of a mode.
 * @param {string|null} mode - `auto`, `on`, `off`.
 * @param {string} model - `f1atb` or `msunpv`.
 * @param {string} language - The language.
 * @returns {string|null} The text.
 */
function modeText(mode, model, language) {
  if (!mode) return null;
  if (mode === 'off') return t(model === 'f1atb' ? 'mode_forced_off' : 'mode_off', language);
  return t(mode === 'on' ? 'mode_forced_on' : 'mode_auto', language);
}

/**
 * @description The states of a router and its outputs; an unknown value is left untouched.
 * @param {object} gladys - The GladysIntegration instance.
 * @param {object} router - The stored router.
 * @param {object} [options] - `{ language }` (the mode texts).
 * @returns {object[]} `{ device_feature_external_id, state | text }`.
 */
function buildRouterStates(gladys, router, { language = 'en' } = {}) {
  const states = [];
  const values = router.values ?? {};
  const ids = routerIds(gladys, router.id);
  const push = (id, key, value, decimals) => {
    if (Number.isFinite(value)) {
      states.push({
        device_feature_external_id: id(key),
        state: bounded(round(value, decimals), key),
      });
    }
  };
  push(ids.feature, 'grid_import_power', values.gridImportW, 0);
  push(ids.feature, 'grid_export_power', values.gridExportW, 0);
  push(ids.feature, 'grid_power', values.gridW, 0);
  push(ids.feature, 'grid_import_index', values.gridImportWh / 1000, 3);
  push(ids.feature, 'grid_export_index', values.gridExportWh / 1000, 3);
  push(ids.feature, 'routed_power', values.routedW, 0);
  push(ids.feature, 'routed_energy', values.routedWh / 1000, 3);
  push(ids.feature, 'pv_power', values.pvW, 0);
  push(ids.feature, 'pv_energy', values.pvWh / 1000, 3);
  for (const [key, value] of Object.entries(values.temperatures ?? {})) {
    if (FEATURES[key]) push(ids.feature, key, value, 1);
  }
  push(ids.feature, 'rssi', values.rssi, 0);
  const keys = outputFeatureKeys(router);
  for (const output of router.outputs ?? []) {
    const id = outputIds(gladys, router.id, output.key).feature;
    const pushOutput = (key, value, decimals) => {
      if (keys.includes(key)) push(id, key, value, decimals);
    };
    pushOutput('opening', output.opening, 0);
    pushOutput('power', output.powerW, 0);
    pushOutput('energy', Number.isFinite(output.indexWh) ? output.indexWh / 1000 : null, 3);
    if (output.mode) {
      pushOutput('forced', output.mode === 'on' ? 1 : 0, 0);
      states.push({
        device_feature_external_id: id('mode'),
        text: modeText(output.mode, router.model, language),
      });
    }
    pushOutput('force_remaining', output.mode === 'auto' ? 0 : output.forceMinutes, 0);
    pushOutput('on_hours', output.onHours, 2);
  }
  return states;
}

export {
  ROUTER_TYPE,
  OUTPUT_TYPE,
  FEATURES,
  ROUTER_FEATURES,
  routerIds,
  outputIds,
  targetOf,
  outputFeatureKeys,
  routerName,
  outputTitle,
  modeText,
  buildRouterDevices,
  buildRouterStates,
};
