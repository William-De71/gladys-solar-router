// The whole integration against the fake Gladys of the SDK
// (`@gladysassistant/integration-sdk/testing`), which checks the discovered
// devices, the states and the scene events like the host API does, and fake
// routers (test/helpers/fake-routers.js) on a fake clock.
// No test touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';

import { createApp, ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { TRIGGERS, SCENE_ACTIONS, SET_MODE_OUTPUTS, TODAY_OUTPUTS } from '../src/events.js';
import { FILE } from '../src/store.js';
import { LANGUAGES } from '../src/i18n.js';
import {
  createFakeNetwork,
  f1atbState,
  msunpvState,
  dataDir,
  recordingLogger,
} from './helpers/fake-routers.js';

const NOW = Date.parse('2026-11-22T10:00:00Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const F1 = '192.168.1.30';
const MS = '192.168.1.31';
const CONFIG = { hosts: `${F1}, ${MS}`, interval: '10', force_minutes: '90', language: 'en' };
const PREFIX = 'ext:test-integration';
const F1_ID = 'a4cf12345678';
const MS_ID = '0000200';
const routerId = (id, feature) => `${PREFIX}:router:${id}${feature ? `:${feature}` : ''}`;
const outputId = (id, key, feature) =>
  `${PREFIX}:output:${id}-${key}${feature ? `:${feature}` : ''}`;

/**
 * @description The integration, connected to a fake Gladys and fake routers.
 * @param {object} t - The test context.
 * @param {object} [options] - `{ config, dir, clock, routers }`.
 * @returns {Promise<object>} `{ gladys, app, network, clock, dir, logger, f1, ms }`.
 */
async function startApp(
  t,
  { config = CONFIG, dir = dataDir(), clock = { now: NOW }, routers } = {},
) {
  const f1 = f1atbState();
  const ms = msunpvState();
  const network = createFakeNetwork(
    routers ?? { [F1]: { kind: 'f1atb', state: f1 }, [MS]: { kind: 'msunpv', state: ms } },
  );
  const logger = recordingLogger();
  const gladys = createFakeGladys({ config });
  const app = createApp(gladys, {
    request: network.request,
    dataDir: dir,
    now: () => clock.now,
    sleep: async () => {},
    timeZone: 'Europe/Paris',
    timers: false,
    logger,
  });
  await gladys.connect();
  await app.whenReady();
  t.after(async () => {
    await gladys.fake.shutdown().catch(() => {});
  });
  return { gladys, app, network, clock, dir, logger, f1, ms };
}

/**
 * @description Run the timer like the real one (every 10 s) for a while.
 * @param {object} env - `{ app, clock }`.
 * @param {number} ms - How long.
 * @param {number} [step] - The interval.
 */
async function run({ app, clock }, ms, step = 10 * SECOND) {
  const end = clock.now + ms;
  while (clock.now < end) {
    await app.tick();
    clock.now += step;
  }
}

/**
 * @description Create every offered device, like the user would.
 * @param {object} gladys - The fake Gladys.
 */
async function createAll(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(structuredClone(device));
  }
}
const widget = async (gladys, key, options) =>
  (await gladys.fake.widgetGet(key, options)).data.content;
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const lastState = (gladys, id) =>
  gladys.fake.states.filter((state) => state.device_feature_external_id === id).at(-1);
const deviceOf = (gladys, externalId) =>
  gladys.fake.discoveredDevices.find((device) => device.external_id === externalId);
const featureOf = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`));

test('startup: both routers recognised by their answers, their devices offered', async (t) => {
  const env = await startApp(t);
  const { gladys, network } = env;
  assert.deepEqual(network.calls, [], 'no request before the timer');
  await run(env, 10 * SECOND);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => [device.name, device.external_id]),
    [
      ['Solar router F1ATB RMS-ESP32-5678', routerId(F1_ID)],
      ['Chauffe-eau (F1ATB RMS-ESP32-5678)', outputId(F1_ID, 'a0')],
      ['Radiateur salon (F1ATB RMS-ESP32-5678)', outputId(F1_ID, 'a1')],
      ['Solar router MSunPV 2x2d', routerId(MS_ID)],
      ['Water heater (MSunPV 2x2d)', outputId(MS_ID, 'water_heater')],
      ['Radiator (MSunPV 2x2d)', outputId(MS_ID, 'heater')],
    ],
  );
  // The MSunPV was tried as an F1ATB first (404), then recognised; never again.
  const msCalls = () => network.calls.filter((call) => call.address === MS).map((c) => c.path);
  assert.deepEqual(msCalls(), ['/ajax_data', '/status.xml']);
  await run(env, 10 * SECOND);
  assert.deepEqual(msCalls(), ['/ajax_data', '/status.xml', '/status.xml']);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    '2 router(s) read: Solar router F1ATB RMS-ESP32-5678, Solar router MSunPV 2x2d.',
  );
  assert.deepEqual(gladys.fake.states, [], 'no state before the devices exist');
  assert.deepEqual(gladys.fake.sceneEvents, [], 'never at the first reading');
  const stored = JSON.parse(readFileSync(join(env.dir, FILE), 'utf8'));
  assert.deepEqual(stored.addresses, { [F1]: 'f1atb', [MS]: 'msunpv' });
});

test('states once created, only what changed; the indexes of the MSunPV summed', async (t) => {
  const env = await startApp(t);
  const { gladys, ms } = env;
  await run(env, 10 * SECOND);
  await createAll(gladys);
  assert.equal(lastState(gladys, routerId(F1_ID, 'grid_export_power')).state, 420);
  assert.equal(lastState(gladys, routerId(F1_ID, 'grid_import_index')).state, 1250.3);
  assert.equal(lastState(gladys, outputId(F1_ID, 'a0', 'opening')).state, 38);
  assert.equal(lastState(gladys, outputId(F1_ID, 'a0', 'mode')).text, 'Automatic');
  assert.equal(lastState(gladys, routerId(MS_ID, 'grid_power')).state, -350);
  assert.equal(lastState(gladys, routerId(MS_ID, 'pv_energy')).state, 8456.3);
  assert.equal(lastState(gladys, routerId(MS_ID, 'grid_import_index')).state, 0);
  ms.counters = [46000, -33000, -122000, -84563, 0, 0];
  const before = gladys.fake.states.length;
  await run(env, 10 * SECOND);
  assert.equal(lastState(gladys, routerId(MS_ID, 'grid_import_index')).state, 0.1);
  assert.equal(lastState(gladys, routerId(MS_ID, 'grid_export_index')).state, 0.1);
  const sent = gladys.fake.states.slice(before).map((state) => state.device_feature_external_id);
  assert.ok(!sent.includes(routerId(F1_ID, 'grid_export_power')), 'unchanged: not sent');
});

test('the forced switch: F1ATB for the configured minutes, MSunPV until switched back', async (t) => {
  const env = await startApp(t);
  const { gladys, f1, ms, network } = env;
  await run(env, 10 * SECOND);
  await createAll(gladys);
  const heater = deviceOf(gladys, outputId(F1_ID, 'a0'));
  let ack = await gladys.fake.setValue(heater, featureOf(heater, 'forced'), 1);
  assert.equal(ack.success, true, ack.error);
  assert.ok(network.calls.some((call) => call.path === '/ForceAction?NumAction=0&Force=90'));
  assert.equal(f1.actions[0].force, 90);
  assert.equal(lastState(gladys, outputId(F1_ID, 'a0', 'forced')).state, 1);
  assert.equal(lastState(gladys, outputId(F1_ID, 'a0', 'force_remaining')).state, 90);
  ack = await gladys.fake.setValue(heater, featureOf(heater, 'forced'), 0);
  assert.equal(ack.success, true, ack.error);
  assert.equal(f1.actions[0].force, 0, 'back to automatic');
  assert.deepEqual(events(gladys, TRIGGERS.FORCING_ENDED), [], 'our own change');

  const tank = deviceOf(gladys, outputId(MS_ID, 'water_heater'));
  await gladys.fake.setValue(tank, featureOf(tank, 'forced'), 1);
  assert.deepEqual(ms.posts, ['9;0;0;0;0;0;0;2;'], 'forced bit, the radiator untouched');
  await gladys.fake.setValue(tank, featureOf(tank, 'forced'), 0);
  assert.equal(ms.posts.at(-1), '10;0;0;0;0;0;0;2;');
  const opening = featureOf(heater, 'opening');
  ack = await gladys.fake.setValue(heater, opening, 50);
  assert.equal(ack.success, false, 'read only');
});

test('forcing_ended: an F1ATB forcing that runs out by itself', async (t) => {
  const env = await startApp(t);
  const { gladys, f1 } = env;
  f1.actions[0].force = 2;
  await run(env, 10 * SECOND);
  await createAll(gladys);
  await run(env, 30 * SECOND);
  assert.deepEqual(events(gladys, TRIGGERS.FORCING_ENDED), []);
  f1.actions[0].force = 0;
  await run(env, 10 * SECOND);
  const [event] = events(gladys, TRIGGERS.FORCING_ENDED);
  assert.deepEqual(event.data, {
    router: routerId(F1_ID),
    router_name: 'Solar router F1ATB RMS-ESP32-5678',
    output: outputId(F1_ID, 'a0'),
    output_name: 'Chauffe-eau',
    previous_mode: 'on',
    message: 'Chauffe-eau: the forcing ended, the router decides again.',
  });
  await run(env, 30 * SECOND);
  assert.equal(events(gladys, TRIGGERS.FORCING_ENDED).length, 1, 'once');
});

test('triggers: unreachable after 3 readings and a minute, back online, restarted', async (t) => {
  const routers = {
    [F1]: { kind: 'f1atb', state: f1atbState() },
  };
  const env = await startApp(t, { config: { ...CONFIG, hosts: F1 }, routers });
  const { gladys } = env;
  await run(env, 30 * SECOND);
  routers[F1].kind = 'down';
  await run(env, 30 * SECOND);
  assert.deepEqual(events(gladys, TRIGGERS.UNREACHABLE), [], 'not yet a minute');
  await run(env, 60 * SECOND);
  const [down] = events(gladys, TRIGGERS.UNREACHABLE);
  assert.equal(down.data.router, routerId(F1_ID));
  assert.equal(down.data.model, 'f1atb');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  routers[F1].kind = 'f1atb';
  routers[F1].state.uptimeHours = 0.05;
  await run(env, 10 * SECOND);
  const [back] = events(gladys, TRIGGERS.BACK_ONLINE);
  assert.ok(back.data.down_minutes >= 1);
  const [restarted] = events(gladys, TRIGGERS.RESTARTED);
  assert.equal(restarted.data.uptime_before_hours, 52.3);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('scene actions: set an output, today’s energy, only the declared outputs', async (t) => {
  const env = await startApp(t);
  const { gladys, f1 } = env;
  await run(env, 10 * SECOND);
  let ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_OUTPUT_MODE, {
    output: outputId(F1_ID, 'a1'),
    mode: 'off',
    minutes: 30,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(f1.actions[1].force, -30);
  assert.deepEqual(ack.data.outputs, {
    output_name: 'Radiateur salon',
    mode: 'off',
    minutes: 30,
    summary: 'Radiateur salon: Forced off for 30 min.',
  });
  for (const key of Object.keys(ack.data.outputs)) assert.ok(SET_MODE_OUTPUTS.includes(key));
  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_OUTPUT_MODE, {
    output: routerId(F1_ID),
    mode: 'on',
  });
  assert.equal(ack.success, false, 'the router is not an output');
  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_TODAY, { router: routerId(MS_ID) });
  assert.deepEqual(ack.data.outputs, {
    router_name: 'Solar router MSunPV 2x2d',
    imported_kwh: 4.5,
    exported_kwh: 3.2,
    produced_kwh: 12.1,
    grid_watts: -350,
    summary: 'Solar router MSunPV 2x2d today: 4.5 kWh drawn, 3.2 kWh exported, 12.1 kWh produced.',
  });
  ack = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_TODAY, {});
  assert.equal(ack.data.outputs.routed_kwh, 5.12, 'the first router: the F1ATB, its probe');
  for (const key of Object.keys(ack.data.outputs)) assert.ok(TODAY_OUTPUTS.includes(key));
});

test('widgets: overview and power in every language, valid; the buttons force', async (t) => {
  const env = await startApp(t);
  const { gladys, f1 } = env;
  for (let minute = 0; minute < 30; minute += 5) {
    await run(env, 10 * SECOND);
    env.clock.now += 5 * MINUTE;
  }
  for (const language of LANGUAGES) {
    for (const router of [routerId(F1_ID), routerId(MS_ID)]) {
      const overview = await widget(gladys, WIDGETS.OVERVIEW, { language, settings: { router } });
      assert.deepEqual(validateWidgetContent(overview), [], `overview ${language}`);
      assert.ok(overview.components.length <= 8);
      const power = await widget(gladys, WIDGETS.POWER, { language, settings: { router } });
      assert.deepEqual(validateWidgetContent(power), [], `power ${language}`);
      assert.ok(power.components.some((component) => component.type === 'chart'));
    }
  }
  const overview = await widget(gladys, WIDGETS.OVERVIEW, {
    language: 'fr',
    settings: { router: routerId(F1_ID) },
  });
  const buttons = overview.components.filter((component) => component.type === 'button');
  assert.deepEqual(
    buttons.map((button) => button.label),
    ['Forcer Chauffe-eau', 'Forcer Radiateur salon'],
  );
  const ack = await gladys.fake.widgetAction(
    WIDGETS.OVERVIEW,
    buttons[0].action.key,
    buttons[0].action.params,
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(f1.actions[0].force, 90);
  assert.equal(ack.data.message.en, 'Chauffe-eau: Forced on.');
  const after = await widget(gladys, WIDGETS.OVERVIEW, {
    language: 'en',
    settings: { router: routerId(F1_ID) },
  });
  assert.equal(after.components.find((c) => c.type === 'button').label, 'Auto Chauffe-eau');
});

test('no address, or an address that is no router: a clear status', async (t) => {
  const empty = await startApp(t, { config: { language: 'fr' } });
  await run(empty, 10 * SECOND);
  assert.equal(empty.gladys.fake.connectionStatus.connected, false);
  assert.match(empty.gladys.fake.connectionStatus.message.fr, /Saisissez l’adresse/);
  const content = await widget(empty.gladys, WIDGETS.OVERVIEW, { language: 'fr', settings: {} });
  assert.deepEqual(validateWidgetContent(content), []);

  const routers = { '192.168.1.1': { kind: 'web' } };
  const box = await startApp(t, { config: { hosts: '192.168.1.1' }, routers });
  const ack = await box.gladys.fake.action(ACTIONS.SEARCH);
  assert.match(ack.data.message.fr, /ni un routeur F1ATB ni un MSunPV/);
  const calls = box.network.calls.length;
  await run(box, 10 * SECOND);
  assert.equal(box.network.calls.length, calls, 'left alone for a while');
});

test('a restart of the container keeps the routers, the indexes and the history', async (t) => {
  const dir = dataDir();
  const first = await startApp(t, { dir });
  await run(first, 10 * SECOND);
  await first.gladys.fake.shutdown();
  const second = await startApp(t, { dir });
  assert.equal(second.app.store.data.routers[F1_ID].model, 'f1atb');
  assert.equal(second.app.store.data.routers[MS_ID].history.length, 1);
  assert.equal(second.gladys.fake.discoveredDevices.length, 6, 'offered at once');
});

test('diagnostic: in the logs', async (t) => {
  const env = await startApp(t);
  await run(env, 10 * SECOND);
  const ack = await env.gladys.fake.action(ACTIONS.DIAGNOSTIC);
  assert.match(ack.data.message.en, /Diagnostic written/);
  const lines = env.logger.lines.filter(([, line]) => line.includes('diagnostic'));
  assert.ok(lines.length >= 1);
  assert.match(lines[0][1], /a4cf12345678/);
});
