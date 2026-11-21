// The devices offered on the Discovery screen, checked like the core checks
// them (a single invalid field rejects the whole batch, and a missing min /
// max / read_only / has_feedback makes "Add" fail in 422).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  buildRouterDevices,
  buildRouterStates,
  targetOf,
  routerName,
  FEATURES,
} from '../src/device.js';
import { readF1atb } from '../src/f1atb.js';
import { readMsunpv } from '../src/msunpv.js';
import { fromF1atb, fromMsunpv, mergeSnapshot } from '../src/routers.js';
import { createRouterClient } from '../src/router-api.js';
import { LANGUAGES } from '../src/i18n.js';
import { f1atbState, msunpvState, createFakeNetwork } from './helpers/fake-routers.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};

// The pairs of the core (DEVICE_FEATURE_UNITS_BY_CATEGORY, master 2026-11-20).
const UNITS_OF = {
  [C.GRID_SENSOR]: [U.WATT, U.KILOWATT_HOUR],
  [C.ENERGY_SENSOR]: [U.WATT, U.KILOWATT_HOUR],
  [C.ENERGY_PRODUCTION_SENSOR]: [U.WATT, U.KILOWATT_HOUR],
  [C.TEMPERATURE_SENSOR]: [U.CELSIUS],
  [C.SIGNAL]: [null],
  [C.SWITCH]: [null],
  [C.TEXT]: [null],
  [C.DURATION]: [U.MINUTES, U.HOURS],
};

/**
 * @description A stored router after one reading of a fake one.
 * @param {string} kind - `f1atb` or `msunpv`.
 * @param {object} state - The fake state.
 * @returns {Promise<object>} The router.
 */
async function storedRouter(kind, state) {
  const network = createFakeNetwork({ r: { kind, state } });
  const client = createRouterClient({
    address: 'r',
    request: network.request,
    sleep: async () => {},
  });
  const snapshot =
    kind === 'f1atb' ? fromF1atb(await readF1atb(client)) : fromMsunpv(await readMsunpv(client));
  const router = { id: snapshot.id, address: 'r', outputs: [] };
  mergeSnapshot(router, snapshot, 0);
  return router;
}

const keysOf = (device) => device.features.map((feature) => feature.external_id.split(':').pop());

test('every feature is complete and uses a category / type / unit pair of the core', async () => {
  const routers = [
    await storedRouter('f1atb', f1atbState()),
    await storedRouter('msunpv', msunpvState()),
    await storedRouter('msunpv', msunpvState({ model: 'MS_PV4_4d', serial: '0000301' })),
  ];
  for (const language of LANGUAGES) {
    for (const router of routers) {
      for (const device of buildRouterDevices(fakeGladys, router, { language })) {
        assert.equal(device.should_poll, false);
        assert.equal(device.poll_frequency, undefined, 'its own timer');
        assert.ok(device.name.length <= 100);
        assert.ok(device.features.length > 0);
        for (const feature of device.features) {
          for (const key of ['name', 'external_id', 'category', 'type', 'min', 'max']) {
            assert.ok(feature[key] !== undefined, `${feature.external_id}: ${key}`);
          }
          assert.equal(typeof feature.read_only, 'boolean');
          assert.equal(typeof feature.has_feedback, 'boolean');
          assert.ok(feature.min <= feature.max);
          assert.ok(UNITS_OF[feature.category]?.includes(feature.unit), feature.external_id);
          assert.ok(
            Object.values(T).some((types) => Object.values(types).includes(feature.type)),
            feature.type,
          );
        }
      }
    }
  }
  for (const spec of Object.values(FEATURES)) {
    assert.ok(Object.values(C).includes(spec.category));
  }
});

test('F1ATB: the router and one device per action, the grid as two values', async () => {
  const router = await storedRouter('f1atb', f1atbState());
  const devices = buildRouterDevices(fakeGladys, router, { language: 'fr' });
  assert.deepEqual(
    devices.map((device) => [device.name, device.external_id, keysOf(device)]),
    [
      [
        'Routeur solaire F1ATB RMS-ESP32-5678',
        'ext:test-integration:router:a4cf12345678',
        [
          'grid_import_power',
          'grid_export_power',
          'grid_import_index',
          'grid_export_index',
          'routed_power',
          'routed_energy',
          'temperature_1',
          'rssi',
        ],
      ],
      [
        'Chauffe-eau (F1ATB RMS-ESP32-5678)',
        'ext:test-integration:output:a4cf12345678-a0',
        ['opening', 'forced', 'mode', 'force_remaining', 'on_hours'],
      ],
      [
        'Radiateur salon (F1ATB RMS-ESP32-5678)',
        'ext:test-integration:output:a4cf12345678-a1',
        ['opening', 'forced', 'mode', 'force_remaining', 'on_hours'],
      ],
    ],
  );
  const grid = devices[0].features.slice(0, 2);
  assert.deepEqual(
    grid.map((feature) => [feature.category, feature.type, feature.unit, feature.min]),
    [
      ['grid-sensor', 'input-power', 'watt', 0],
      ['grid-sensor', 'output-power', 'watt', 0],
    ],
  );
  const forced = devices[1].features.find((feature) => feature.external_id.endsWith(':forced'));
  assert.equal(forced.read_only, false, 'the only command');
  assert.equal(forced.has_feedback, true);
  const house = await storedRouter('f1atb', f1atbState({ probe: null, rssi: null }));
  const keys = keysOf(buildRouterDevices(fakeGladys, house)[0]);
  assert.ok(!keys.includes('routed_power'), 'no second probe');
  assert.ok(!keys.includes('rssi'), 'Ethernet');
});

test('MSunPV: one signed grid value, production, outputs in % (2x2d) or W (4x4d)', async () => {
  const small = await storedRouter('msunpv', msunpvState());
  const devices = buildRouterDevices(fakeGladys, small, { language: 'en' });
  assert.deepEqual(
    devices.map((device) => [device.name, keysOf(device)]),
    [
      [
        'Solar router MSunPV 2x2d',
        [
          'grid_power',
          'grid_import_index',
          'grid_export_index',
          'pv_power',
          'pv_energy',
          'temperature_water',
          'temperature_ambient',
          'rssi',
        ],
      ],
      ['Water heater (MSunPV 2x2d)', ['opening', 'forced', 'mode']],
      ['Radiator (MSunPV 2x2d)', ['opening', 'forced', 'mode']],
    ],
  );
  assert.equal(devices[0].features[0].min, -100000, 'signed: import > 0, export < 0');
  const big = await storedRouter('msunpv', msunpvState({ model: 'MS_PV4_4d' }));
  assert.deepEqual(keysOf(buildRouterDevices(fakeGladys, big)[1]), [
    'power',
    'energy',
    'forced',
    'mode',
  ]);
});

test('states: rounded, bounded, indexes in kWh, the mode as text', async () => {
  const router = await storedRouter(
    'f1atb',
    f1atbState({
      actions: [
        { index: 0, title: 'Chauffe-eau', opening: '38.4', force: 25, hours: 212 },
        { index: 1, title: 'Radiateur', opening: 'Off', force: 0, hours: 0 },
      ],
    }),
  );
  const states = Object.fromEntries(
    buildRouterStates(fakeGladys, router, { language: 'fr' }).map((state) => [
      state.device_feature_external_id.replace('ext:test-integration:', ''),
      state.state ?? state.text,
    ]),
  );
  assert.deepEqual(states, {
    'router:a4cf12345678:grid_import_power': 0,
    'router:a4cf12345678:grid_export_power': 420,
    'router:a4cf12345678:grid_import_index': 1250.3,
    'router:a4cf12345678:grid_export_index': 845.2,
    'router:a4cf12345678:routed_power': 1350,
    'router:a4cf12345678:routed_energy': 2103.4,
    'router:a4cf12345678:temperature_1': 55.4,
    'router:a4cf12345678:rssi': -61,
    'output:a4cf12345678-a0:opening': 38,
    'output:a4cf12345678-a0:forced': 1,
    'output:a4cf12345678-a0:mode': 'Marche forcée',
    'output:a4cf12345678-a0:force_remaining': 25,
    'output:a4cf12345678-a0:on_hours': 2.12,
    'output:a4cf12345678-a1:opening': 0,
    'output:a4cf12345678-a1:forced': 0,
    'output:a4cf12345678-a1:mode': 'Automatique',
    'output:a4cf12345678-a1:force_remaining': 0,
    'output:a4cf12345678-a1:on_hours': 0,
  });
});

test('external ids read back; names', () => {
  assert.deepEqual(targetOf('ext:x:output:a4cf12345678-a12:forced'), {
    type: 'output',
    id: 'a4cf12345678',
    key: 'a12',
  });
  assert.deepEqual(targetOf('ext:x:output:0000200-water_heater'), {
    type: 'output',
    id: '0000200',
    key: 'water_heater',
  });
  assert.deepEqual(targetOf('ext:x:router:0000200:grid_power'), {
    type: 'router',
    id: '0000200',
    key: null,
  });
  assert.equal(targetOf('something else'), null);
  assert.equal(routerName({ model: 'msunpv', modelName: 'MS_PV4_4d' }), 'MSunPV 4x4d');
  assert.equal(routerName({ model: 'f1atb', name: '' }), 'F1ATB');
});
