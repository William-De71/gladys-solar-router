// -----------------------------------------------------------------------------
// Fake solar routers for the tests: an F1ATB (the text pages of Server.ino,
// V17) and an MSunPV (status.xml and the parS post), answering through the
// `request` transport of src/router-api.js. Nothing starts on import.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GS = '\x1d';
const RS = '\x1e';
const US = '\x1f';
const FS = '\x1c';

/**
 * @description The state of a made-up F1ATB router.
 * @param {object} [overrides] - Values to change.
 * @returns {object} The state.
 */
function f1atbState(overrides = {}) {
  return {
    mac: 'A4:CF:12:34:56:78',
    hostname: 'RMS-ESP32-5678',
    ip: '192.168.1.30',
    rssi: -61,
    uptimeHours: 52.3,
    temperatures: [55.4, -127, -127, -127],
    house: {
      importW: 0,
      exportW: 420,
      importTodayWh: 1830,
      exportTodayWh: 2410,
      importWh: 1250300,
      exportWh: 845200,
    },
    // null: a router measuring the house only ("Fake").
    probe: {
      importW: 1350,
      exportW: 0,
      importTodayWh: 5120,
      exportTodayWh: 0,
      importWh: 2103400,
      exportWh: 0,
    },
    actions: [
      { index: 0, title: 'Chauffe-eau', opening: '38', force: 0, hours: 212 },
      { index: 1, title: 'Radiateur salon', opening: 'Off', force: 0, hours: 0 },
    ],
    ...overrides,
  };
}

const energy = (group) =>
  [
    group.importW,
    group.exportW,
    0,
    0,
    group.importTodayWh,
    group.exportTodayWh,
    group.importWh,
    group.exportWh,
  ].join(RS);

/**
 * @description The pages of an F1ATB.
 * @param {object} state - f1atbState().
 * @param {string} path - The path and query.
 * @returns {{ status: number, body: string }} The answer.
 */
function f1atbAnswer(state, path) {
  const temps = `${state.temperatures.join('|')}|`;
  if (path === '/ajax_data') {
    const body =
      ['Deb', '22/11/2026 14:05:12', 'UxIx2', 'HC..', '', temps, '1'].join(RS) +
      GS +
      energy(state.house) +
      GS +
      (state.probe ? energy(state.probe) : 'Fake') +
      GS +
      FS +
      ['230.1', '1.8'].join(RS) +
      FS +
      'Fin\r';
    return { status: 200, body };
  }
  if (path === '/ajax_dataESP32') {
    const body =
      [
        state.uptimeHours,
        '4',
        state.rssi ?? ' ',
        'AA:BB:CC:DD:EE:FF',
        '6',
        state.mac,
        'MaBox',
        `${state.ip}${US}${state.hostname}${US}::`,
        '192.168.1.1',
        '255.255.255.0',
        '1, 2, 3',
        '4, 5, 6',
        'inutil',
        '150000',
        '120000',
        'Pas de Triac',
        'Secteur',
        '1',
        '',
      ].join(RS) + GS;
    return { status: 200, body };
  }
  if (path === '/ajax_etatActions') {
    const records = state.actions
      .map((action) =>
        [action.index, action.title, action.opening, action.force, action.hours, ''].join(RS),
      )
      .join(GS);
    return {
      status: 200,
      body: [temps, 'UxIx2', '0', String(state.actions.length), `${records}${GS}`].join(GS),
    };
  }
  const force = path.match(/^\/ForceAction\?NumAction=(\d+)&Force=(-?\d+)$/);
  if (force) {
    const action = state.actions.find((entry) => entry.index === Number(force[1]));
    if (action) action.force = Number(force[2]);
    return { status: 200, body: 'Force' };
  }
  return { status: 404, body: 'Not found' };
}

/**
 * @description The state of a made-up MSunPV router.
 * @param {object} [overrides] - Values to change.
 * @returns {object} The state.
 */
function msunpvState(overrides = {}) {
  return {
    model: 'MS_PV2_2d',
    serial: '0000200',
    inAns: ['-350,2', '-2140,0', '312', '0', '0', '58,5', '0,0', '19,6'],
    // Water heater automatic, radiator automatic.
    cmd0: 0x0a,
    // 4.5 kWh drawn, 3.2 kWh exported, 12.1 kWh produced, 8 456.3 kWh in all.
    counters: [45000, -32000, -121000, -84563, 0, 0],
    rssi: -58,
    posts: [],
    ...overrides,
  };
}

const hex = (value) => (value < 0 ? value + 0x100000000 : value).toString(16);

/**
 * @description The pages of an MSunPV.
 * @param {object} state - msunpvState().
 * @param {object} req - `{ method, path, body }`.
 * @returns {{ status: number, body: string }} The answer.
 */
function msunpvAnswer(state, req) {
  if (req.method === 'GET' && req.path === '/status.xml') {
    const inputs = [...state.inAns, ...Array(16 - state.inAns.length).fill(' 0')];
    const commands = [state.cmd0.toString(16), 0, 0, 0, 0, 0, 0, 2];
    const body = [
      '<?xml version="1.0" encoding="ISO-8859-1"?><xml>',
      `<inAns>${inputs.join(';')};</inAns>`,
      `<paramSys>20:59:45;22/11/2026;On;01:00;0,0;${state.model};5.0.1;${state.serial};104b;104b;00:00;00:00</paramSys>`,
      `<cmdPos>${commands.join(';')};</cmdPos>`,
      `<cptVals>${[...state.counters, 0, 0].map(hex).join(';')};</cptVals>`,
      state.rssi === null ? '' : `<rssi>x;${state.rssi};</rssi>`,
      '<survMm>0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;</survMm>',
      '<outStat>0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;0;</outStat>',
      '<chOutVal>0;0;</chOutVal></xml>',
    ].join('');
    return { status: 200, body };
  }
  if (req.method === 'POST' && req.path === '/index.xml') {
    const parS = new URLSearchParams(req.body).get('parS') ?? '';
    state.posts.push(parS);
    state.cmd0 = Number(parS.split(';')[0]);
    return { status: 200, body: '<xml></xml>' };
  }
  return { status: 404, body: 'Not found' };
}

/**
 * @description A fake network of routers.
 * @param {object} routers - `{ "192.168.1.30": { kind: 'f1atb' | 'msunpv' | 'web' | 'down', state } }`.
 * @returns {{ request: Function, calls: object[] }} The transport and the requests seen.
 */
function createFakeNetwork(routers) {
  const calls = [];
  const request = async ({ host, port, method, path, body }) => {
    const address = port === 80 ? host : `${host}:${port}`;
    calls.push({ address, method, path });
    const router = routers[address];
    if (!router || router.kind === 'down') {
      throw new Error('connect EHOSTUNREACH');
    }
    if (router.kind === 'f1atb') return f1atbAnswer(router.state, path);
    if (router.kind === 'msunpv') return msunpvAnswer(router.state, { method, path, body });
    return { status: path === '/' ? 200 : 404, body: '<html>a box</html>' };
  };
  return { request, calls };
}

/**
 * @description A fresh writable folder (the /data of a test).
 * @returns {string} The folder.
 */
const dataDir = () => mkdtempSync(join(tmpdir(), 'solar-router-'));

/**
 * @description A logger that keeps its lines.
 * @returns {object} The logger, with `lines`.
 */
function recordingLogger() {
  const lines = [];
  const keep =
    (level) =>
    (...args) =>
      lines.push([
        level,
        args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' '),
      ]);
  return {
    lines,
    debug: keep('debug'),
    info: keep('info'),
    warn: keep('warn'),
    error: keep('error'),
  };
}

export {
  dataDir,
  recordingLogger,
  GS,
  RS,
  US,
  f1atbState,
  f1atbAnswer,
  msunpvState,
  msunpvAnswer,
  createFakeNetwork,
};
