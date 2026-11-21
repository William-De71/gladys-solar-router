// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and the fake routers of the tests (test/helpers/fake-routers.js), over
// 24 hours up to Sunday, 22 November 2026 at 14:15 in Paris. The made-up
// house: solar panels from 8:00 to 17:00 under passing clouds, a household
// that draws more in the morning and the evening, an F1ATB that routes the
// surplus to the water heater through its triac, and an MSunPV next door.
// Smooth made-up curves (no randomness): never real data.
// Written as JSON for render.js: node gen.mjs <repo> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { LANGUAGES } = await load('src/i18n.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);
const { createFakeNetwork, f1atbState, msunpvState, dataDir, recordingLogger } = await load(
  'test/helpers/fake-routers.js',
);

const NOW = Date.parse('2026-11-22T13:15:00Z');
const STEP = 5 * 60000;
const F1 = '192.168.1.30';
const MS = '192.168.1.31';
const F1_ID = 'a4cf12345678';
const MS_ID = '0000200';
const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
// The three cards drawn: the F1ATB overview, its power over 24 hours, the MSunPV overview.
const CARDS = {
  overview: { widget: 'overview', settings: { router: `ext:test-integration:router:${F1_ID}` } },
  power: { widget: 'power', settings: { router: `ext:test-integration:router:${F1_ID}` } },
  msunpv: { widget: 'overview', settings: { router: `ext:test-integration:router:${MS_ID}` } },
};
// The names a user would give the devices in Gladys.
const NAMES = {
  en: { f1: 'Solar router', ms: 'Garage router', a0: 'Water heater', a1: 'Living room heater' },
  fr: { f1: 'Routeur solaire', ms: 'Routeur du garage', a0: 'Chauffe-eau', a1: 'Radiateur salon' },
  de: { f1: 'Solarrouter', ms: 'Router Garage', a0: 'Warmwasser', a1: 'Heizung Wohnzimmer' },
  es: { f1: 'Router solar', ms: 'Router del garaje', a0: 'Termo', a1: 'Radiador del salón' },
};

// Local hours of Paris (UTC+1 in November).
const hourOf = (ms) => (((ms / 3600000 + 1) % 24) + 24) % 24;
const bump = (hour, from, to) =>
  hour >= from && hour < to ? Math.sin((Math.PI * (hour - from)) / (to - from)) : 0;
const production = (ms) => {
  const hour = hourOf(ms);
  const clouds = 0.75 + 0.25 * Math.sin(hour * 2.3);
  return Math.round(3200 * clouds * bump(hour, 8, 17));
};
const household = (ms) => {
  const hour = hourOf(ms);
  return Math.round(
    380 + 900 * bump(hour, 6.5, 8.5) + 1400 * bump(hour, 18, 22.5) + 450 * bump(hour, 12, 13.5),
  );
};
// The triac takes the surplus up to the 2 400 W of the water heater; a little
// is still exported while the regulation catches up.
const routed = (ms) => Math.max(0, Math.min(2400, production(ms) - household(ms) - 40));

/**
 * @description Set the fake routers to an instant.
 * @param {object} f1 - The F1ATB state.
 * @param {object} ms - The MSunPV state.
 * @param {number} at - The instant.
 * @param {object} totals - Running totals (Wh).
 */
function setTo(f1, ms, at, totals) {
  const surplus = production(at) - household(at) - routed(at);
  const importW = Math.max(0, -surplus);
  const exportW = Math.max(0, surplus);
  const hours = STEP / 3600000;
  totals.import += importW * hours;
  totals.export += exportW * hours;
  totals.routed += routed(at) * hours;
  totals.produced += production(at) * hours;
  f1.house = {
    importW,
    exportW,
    importTodayWh: Math.round(totals.import),
    exportTodayWh: Math.round(totals.export),
    importWh: 1250300 + Math.round(totals.import),
    exportWh: 845200 + Math.round(totals.export),
  };
  f1.probe = {
    importW: routed(at),
    exportW: 0,
    importTodayWh: Math.round(totals.routed),
    exportTodayWh: 0,
    importWh: 2103400 + Math.round(totals.routed),
    exportWh: 0,
  };
  const opening = Math.round((100 * routed(at)) / 2400);
  f1.actions = [
    {
      index: 0,
      title: 'Chauffe-eau',
      opening: String(opening),
      force: 0,
      hours: Math.round((100 * totals.routed) / 2400),
    },
    { index: 1, title: 'Radiateur salon', opening: 'Off', force: 0, hours: 0 },
  ];
  f1.temperatures = [Math.round(10 * (48 + totals.routed / 900)) / 10, -127, -127, -127];
  const grid = importW - exportW;
  ms.inAns = [
    String(grid).replace('.', ','),
    String(-production(at) * 0.8),
    String(Math.round((4 * opening) / 1.2)),
    '0',
    '0',
    String(Math.round(10 * (52 + totals.routed / 1200)) / 10).replace('.', ','),
    '0',
    '19,8',
  ];
  ms.counters = [
    Math.round(totals.import * 10),
    -Math.round(totals.export * 8),
    -Math.round(totals.produced * 8),
    -84563,
    0,
    0,
  ];
}

/**
 * @description One language: the app run for 24 hours, then the widgets.
 * @param {string} language - Language.
 * @returns {Promise<object>} The widget contents.
 */
async function contents(language) {
  const clock = { now: NOW - 24 * 3600000 };
  const f1 = f1atbState({ rssi: -63, uptimeHours: 412.6 });
  const ms = msunpvState();
  const network = createFakeNetwork({
    [F1]: { kind: 'f1atb', state: f1 },
    [MS]: { kind: 'msunpv', state: ms },
  });
  const totals = { import: 0, export: 0, routed: 0, produced: 0 };
  const gladys = createFakeGladys({ config: { hosts: `${F1}, ${MS}`, language } });
  const app = createApp(gladys, {
    request: network.request,
    dataDir: dataDir(),
    now: () => clock.now,
    sleep: async () => {},
    timeZone: 'Europe/Paris',
    timers: false,
    logger: recordingLogger(),
  });
  await gladys.connect();
  await app.whenReady();
  let created = false;
  while (clock.now <= NOW) {
    // The daily counters start at midnight, Paris time.
    if (hourOf(clock.now) < hourOf(clock.now - STEP)) {
      Object.assign(totals, { import: 0, export: 0, routed: 0, produced: 0 });
    }
    setTo(f1, ms, clock.now, totals);
    await app.tick();
    if (!created) {
      for (const discovered of gladys.fake.discoveredDevices) {
        const id = discovered.external_id;
        const key = id.includes(':router:')
          ? id.includes(F1_ID)
            ? 'f1'
            : 'ms'
          : id.includes(F1_ID)
            ? id.split('-').pop()
            : null;
        await gladys.fake.deviceCreated({
          ...structuredClone(discovered),
          name: NAMES[language][key] ?? discovered.name,
        });
      }
      created = true;
    }
    clock.now += STEP;
  }
  clock.now = NOW;
  const result = {};
  for (const [name, { widget, settings }] of Object.entries(CARDS)) {
    result[name] = (await gladys.fake.widgetGet(widget, { settings, language })).data.content;
  }
  await gladys.fake.shutdown();
  return result;
}

const all = {};
for (const language of LANGUAGES) {
  all[language] = await contents(language);
}

const card = (key) => {
  const widget = manifest.widgets.find((item) => item.key === key);
  return { icon: widget.icon, label: widget.label };
};
writeFileSync(
  out,
  JSON.stringify({
    contents: all,
    images: {},
    cards: Object.fromEntries(
      Object.entries(CARDS).map(([name, { widget }]) => [name, card(widget)]),
    ),
    now: NOW,
  }),
);
