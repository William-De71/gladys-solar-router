import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseData,
  parseActions,
  parseSystem,
  parseTemperatures,
  forceValue,
  readF1atb,
} from '../src/f1atb.js';
import { parseStatus, signedHex, commandsFor, readMsunpv, setMsunpvMode } from '../src/msunpv.js';
import { createRouterClient, splitAddress, RouterError } from '../src/router-api.js';
import {
  fromF1atb,
  fromMsunpv,
  mergeSnapshot,
  accumulate,
  HISTORY_POINTS,
} from '../src/routers.js';
import { parseHosts } from '../src/config.js';
import {
  f1atbState,
  f1atbAnswer,
  msunpvState,
  msunpvAnswer,
  createFakeNetwork,
} from './helpers/fake-routers.js';

const noSleep = async () => {};
const client = (network, address) =>
  createRouterClient({ address, request: network.request, sleep: noSleep });

test('F1ATB /ajax_data: grid, indexes, routed probe and temperatures', () => {
  const data = parseData(f1atbAnswer(f1atbState(), '/ajax_data').body);
  assert.deepEqual(data.house, {
    importW: 0,
    exportW: 420,
    importTodayWh: 1830,
    exportTodayWh: 2410,
    importWh: 1250300,
    exportWh: 845200,
  });
  assert.equal(data.probe.importW, 1350);
  assert.equal(data.source, 'UxIx2');
  assert.deepEqual(data.temperatures, [55.4, null, null, null]);
  const house = parseData(f1atbAnswer(f1atbState({ probe: null }), '/ajax_data').body);
  assert.equal(house.probe, null, '"Fake": no second probe');
  assert.throws(
    () => parseData('<html></html>'),
    (err) => err.kind === 'invalid',
  );
  assert.deepEqual(parseTemperatures('21.5|-127.00|0.00|x|'), [21.5, null, 0, null]);
});

test('F1ATB /ajax_etatActions and /ajax_dataESP32', () => {
  const state = f1atbState({
    actions: [
      { index: 0, title: 'Chauffe-eau', opening: '38', force: 0, hours: 212 },
      { index: 1, title: 'Pompe', opening: 'On', force: 45, hours: 50 },
      { index: 2, title: 'Radiateur', opening: 'Off', force: -12, hours: 0 },
    ],
  });
  assert.deepEqual(parseActions(f1atbAnswer(state, '/ajax_etatActions').body), [
    { index: 0, title: 'Chauffe-eau', opening: 38, forceMinutes: 0, onHours: 2.12 },
    { index: 1, title: 'Pompe', opening: 100, forceMinutes: 45, onHours: 0.5 },
    { index: 2, title: 'Radiateur', opening: 0, forceMinutes: -12, onHours: 0 },
  ]);
  assert.deepEqual(parseSystem(f1atbAnswer(state, '/ajax_dataESP32').body), {
    mac: 'a4cf12345678',
    hostname: 'RMS-ESP32-5678',
    ip: '192.168.1.30',
    rssi: -61,
    uptimeHours: 52.3,
  });
  const ethernet = parseSystem(f1atbAnswer(f1atbState({ rssi: null }), '/ajax_dataESP32').body);
  assert.equal(ethernet.rssi, null, 'Ethernet: no Wi-Fi signal');
});

test('F1ATB forcing: minutes on, minutes off, automatic, bounded', () => {
  assert.equal(forceValue('on', 90), 90);
  assert.equal(forceValue('off', 30), -30);
  assert.equal(forceValue('auto', 30), 0);
  assert.equal(forceValue('on', 99999), 1440);
  assert.equal(forceValue('on', 0), 60, 'a missing duration is an hour');
});

test('MSunPV status.xml: 2x2d in %, signed counters, modes', () => {
  const status = parseStatus(
    msunpvAnswer(msunpvState(), { method: 'GET', path: '/status.xml' }).body,
  );
  assert.equal(status.serial, '0000200');
  assert.equal(status.fourByFour, false);
  assert.equal(status.gridW, -350.2);
  assert.equal(status.pvW, 2140);
  assert.deepEqual(status.temperatures, { water: 58.5, bathroom: 0, ambient: 19.6 });
  assert.equal(status.outputs.water_heater.opening, 78, '312 of 400');
  assert.equal(status.outputs.water_heater.powerW, null);
  assert.equal(status.outputs.water_heater.mode, 'auto');
  assert.equal(status.importTodayWh, 4500);
  assert.equal(status.exportTodayWh, 3200);
  assert.equal(status.producedTodayWh, 12100);
  assert.equal(status.producedTotalWh, 8456300);
  assert.equal(status.rssi, -58);
  assert.equal(signedHex('ffffc0d9'), -16167);
  assert.equal(signedHex('9702'), 38658);
  assert.throws(
    () => parseStatus('<html>no</html>'),
    (err) => err.kind === 'invalid',
  );
});

test('MSunPV 4x4d: outputs in W and their daily counters', () => {
  const state = msunpvState({
    model: 'MS_PV4_4d',
    inAns: ['120', '-900', '1500', '250', '0', '61', '0', '0'],
    counters: [1000, -500, -9000, -100, 31000, 4000],
  });
  const status = parseStatus(msunpvAnswer(state, { method: 'GET', path: '/status.xml' }).body);
  assert.equal(status.fourByFour, true);
  assert.equal(status.outputs.water_heater.powerW, 1500);
  assert.equal(status.outputs.heater.powerW, 250);
  assert.equal(status.outputs.water_heater.todayWh, 3100);
  assert.equal(status.outputs.heater.todayWh, 400);
});

test('MSunPV commands: only the bits of the output change', () => {
  const current = ['a', '0', '0', '0', '0', '0', '0', '2'];
  assert.equal(commandsFor(current, 'water_heater', 'on'), '9;0;0;0;0;0;0;2;');
  assert.equal(commandsFor(current, 'water_heater', 'off'), '8;0;0;0;0;0;0;2;');
  assert.equal(commandsFor(current, 'heater', 'on'), '6;0;0;0;0;0;0;2;');
  assert.equal(commandsFor(current, 'heater', 'auto'), '10;0;0;0;0;0;0;2;');
  assert.throws(() => commandsFor(current, 'pump', 'on'));
});

test('the client reads both routers and recognises a web page that is no router', async () => {
  const f1 = f1atbState();
  const ms = msunpvState();
  const network = createFakeNetwork({
    '192.168.1.30': { kind: 'f1atb', state: f1 },
    '192.168.1.31:8080': { kind: 'msunpv', state: ms },
    '192.168.1.1': { kind: 'web' },
  });
  const reading = await readF1atb(client(network, '192.168.1.30'));
  assert.equal(reading.id, 'a4cf12345678');
  assert.equal(reading.actions.length, 2);
  const msReading = await readMsunpv(client(network, '192.168.1.31:8080'));
  assert.equal(msReading.id, '0000200');
  await assert.rejects(readF1atb(client(network, '192.168.1.1')), (err) => err.kind === 'http');
  await assert.rejects(
    readF1atb(client(network, '192.168.1.99')),
    (err) => err instanceof RouterError && err.kind === 'unreachable',
  );
  const parS = await setMsunpvMode(client(network, '192.168.1.31:8080'), 'water_heater', 'on');
  assert.equal(parS, '9;0;0;0;0;0;0;2;');
  assert.deepEqual(ms.posts, ['9;0;0;0;0;0;0;2;']);
  assert.deepEqual(splitAddress('[fe80::1]:81'), { host: 'fe80::1', port: 81 });
  assert.deepEqual(parseHosts(' http://192.168.1.30/ , Routeur.local:8080;192.168.1.30'), [
    '192.168.1.30',
    'routeur.local:8080',
  ]);
});

test('one request at a time per router', async () => {
  let inFlight = 0;
  let most = 0;
  const request = async () => {
    inFlight += 1;
    most = Math.max(most, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return { status: 200, body: 'ok' };
  };
  const one = createRouterClient({ address: '192.168.1.30', request, sleep: noSleep });
  await Promise.all([one.get('/a'), one.get('/b'), one.get('/c')]);
  assert.equal(most, 1);
  assert.deepEqual(one.counts(), { requests: 3, failures: 0 });
});

test('snapshots: F1ATB modes, MSunPV indexes summed across midnight', async () => {
  const network = createFakeNetwork({
    '192.168.1.30': {
      kind: 'f1atb',
      state: f1atbState({
        actions: [
          { index: 0, title: 'Chauffe-eau', opening: '38', force: 30, hours: 0 },
          { index: 1, title: 'Radiateur', opening: 'Off', force: -5, hours: 0 },
        ],
      }),
    },
  });
  const snapshot = fromF1atb(await readF1atb(client(network, '192.168.1.30')));
  assert.deepEqual(
    snapshot.outputs.map((output) => [output.key, output.mode, output.forceMinutes]),
    [
      ['a0', 'on', 30],
      ['a1', 'off', 5],
    ],
  );
  const counters = {};
  assert.equal(accumulate(counters, 'import', 1000), 0, 'starts at 0');
  assert.equal(accumulate(counters, 'import', 1600), 600);
  assert.equal(accumulate(counters, 'import', 200), 800, 'after the midnight reset');
  assert.equal(accumulate(counters, 'import', null), 800, 'unknown: unchanged');

  const ms = msunpvState();
  const router = { id: '0000200', outputs: [] };
  const read = async () =>
    fromMsunpv(
      await readMsunpv(client(createFakeNetwork({ m: { kind: 'msunpv', state: ms } }), 'm')),
    );
  assert.equal(mergeSnapshot(router, await read(), 0), true, 'new features');
  assert.equal(router.values.gridImportWh, 0);
  ms.counters = [47000, -32500, -125000, -84567, 0, 0];
  assert.equal(mergeSnapshot(router, await read(), 60000), false, 'same devices');
  assert.equal(router.values.gridImportWh, 200);
  assert.equal(router.values.gridExportWh, 50);
  assert.equal(router.present.temperature_bathroom, undefined, 'a probe reading 0 is not offered');
  assert.equal(router.present.temperature_water, true);
  assert.equal(router.history.length, 1, 'one point per 5 minutes');
  for (let minute = 5; minute < 5 * (HISTORY_POINTS + 20); minute += 5) {
    mergeSnapshot(router, await read(), minute * 60000);
  }
  assert.equal(router.history.length, HISTORY_POINTS, '24 hours kept');
});
