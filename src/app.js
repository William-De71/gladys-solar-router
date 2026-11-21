// -----------------------------------------------------------------------------
// The solar router integration: every handler, registered on a Gladys client.
//
// Brings the F1ATB and MSunPV solar routers of the local network into Gladys,
// through the pages their own web interface reads:
//   - devices (device.js): the router (grid exchange, indexes, routed power,
//     production, temperatures, Wi-Fi) and one device per output (opening or
//     power, forced on switch, mode, forcing time left);
//   - scene triggers (events.js): unreachable, back online, restarted,
//     forcing ended;
//   - scene actions: set the mode of an output, today's energy;
//   - dashboard widgets (widgets.js): overview with buttons, power over 24 h;
//   - configuration buttons: search and test, diagnostic.
//
// Pace: a timer reads every router every 5, 10, 30 or 60 s (one request at a
// time per router). Each typed address is recognised once (F1ATB first, then
// MSunPV) and remembered. A router is known by its MAC address (F1ATB) or
// serial number (MSunPV), not by its address.
//
// index.js only creates the SDK client; the tests drive this module with the
// fake Gladys of the SDK and fake routers (test/helpers/fake-routers.js).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { logger as sdkLogger } from '@gladysassistant/integration-sdk';
import {
  normalizeConfig,
  readLanguage,
  guessLanguage,
  INTERNAL_KEYS,
  AUTO_LANGUAGE,
} from './config.js';
import { createRouterClient } from './router-api.js';
import { readF1atb, forceF1atb } from './f1atb.js';
import { readMsunpv, setMsunpvMode } from './msunpv.js';
import { createStore } from './store.js';
import { fromF1atb, fromMsunpv, mergeSnapshot } from './routers.js';
import {
  routerIds,
  outputIds,
  targetOf,
  routerName,
  outputTitle,
  modeText,
  buildRouterDevices,
  buildRouterStates,
} from './device.js';
import {
  TRIGGERS,
  SCENE_ACTIONS,
  MODES,
  DEFAULT_MINUTES,
  SET_MODE_OUTPUTS,
  TODAY_OUTPUTS,
  pick,
  rounded,
  detectRouter,
  endedForcings,
} from './events.js';
import {
  WIDGETS,
  WIDGET_ACTIONS,
  messageContent,
  gridOf,
  buildOverviewWidget,
  buildPowerWidget,
} from './widgets.js';
import { MINUTE_MS, defaultTimeZone, usableTimeZone } from './time.js';
import { t, all, formatNumber, LANGUAGES } from './i18n.js';

const ACTIONS = {
  SEARCH: 'search',
  DIAGNOSTIC: 'diagnostic',
};
const MODELS = ['f1atb', 'msunpv'];
const READERS = {
  f1atb: async (client) => fromF1atb(await readF1atb(client)),
  msunpv: async (client) => fromMsunpv(await readMsunpv(client)),
};
const STARTUP_DELAY_MS = 3 * 1000;
// An address that is no router is tried again after this delay.
const RETRY_UNKNOWN_MS = 30 * MINUTE_MS;
// Re-send unchanged values now and then, so that Gladys does not show them as outdated.
const HEARTBEAT_MS = 30 * MINUTE_MS;
const DIAGNOSTIC_CHUNK = 3000;
const { version: VERSION } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

/**
 * @description Register every handler of the integration on a Gladys client.
 * @param {object} gladys - A GladysIntegration (or the fake Gladys of the SDK).
 * @param {object} [options] - Options.
 * @param {Function} [options.request] - HTTP transport of the routers (tests).
 * @param {string} [options.dataDir] - The writable folder (/data).
 * @param {Function} [options.now] - `() => number` in ms (tests).
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @param {string} [options.timeZone] - IANA timezone of Gladys (TZ by default).
 * @param {boolean} [options.timers] - Arm the reading timer (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} Handles for the tests.
 */
function createApp(
  gladys,
  {
    request,
    dataDir,
    now = () => Date.now(),
    sleep,
    timeZone: zone = defaultTimeZone(),
    timers = true,
    logger = sdkLogger,
  } = {},
) {
  const timeZone = usableTimeZone(zone);
  let config = normalizeConfig();
  let language = guessLanguage(timeZone);
  let createdNames = new Map();
  let lastStatus = null;
  let lastDiscovery = null;
  let timer = null;
  let startTimer = null;
  let running = null;
  let stopped = false;
  const clients = new Map();
  const notRouter = new Map();
  // Outputs set by a scene, a widget or the switch: their next change is ours.
  const commanded = new Map();

  const store = createStore({ ...(dataDir ? { dir: dataDir } : {}), logger });

  /**
   * @description The client of an address (one per address: its queue).
   * @param {string} address - The address.
   * @returns {object} The client.
   */
  function clientOf(address) {
    if (!clients.has(address)) {
      clients.set(
        address,
        createRouterClient({
          address,
          ...(request ? { request } : {}),
          ...(sleep ? { sleep } : {}),
        }),
      );
    }
    return clients.get(address);
  }

  const routers = () => Object.values(store.data.routers);

  /**
   * @description Remember the language of a widget request, and store it when it changed.
   * @param {string} next - The language.
   */
  function rememberLanguage(next) {
    if (!LANGUAGES.includes(next) || next === language) {
      return;
    }
    language = next;
    gladys
      .setConfig({ [INTERNAL_KEYS.language]: next })
      .catch((err) => logger.warn(`Unable to store the language: ${err.message}`));
  }

  /**
   * @description Language of the texts Gladys does not ask for in a language.
   * @returns {string} The language.
   */
  const textLanguage = () => (config.language === AUTO_LANGUAGE ? language : config.language);

  // --- Names -------------------------------------------------------------------------

  /**
   * @description The name of a router: the one the user gave it in Gladys, else its own.
   * @param {object} router - The stored router.
   * @param {string} [lang] - The language of the default name.
   * @returns {string} The name.
   */
  const nameOfRouter = (router, lang = textLanguage()) =>
    createdNames.get(routerIds(gladys, router.id).device) ||
    `${t('routerPrefix', lang)} ${routerName(router)}`;

  /**
   * @description The name of an output: the one the user gave it in Gladys, else its
   * title. The " (<router>)" ending of the default name is left out: the widgets and
   * the scene texts already say which router it is.
   * @param {object} router - The stored router.
   * @param {object} output - The output.
   * @param {string} [lang] - The language of the default name.
   * @returns {string} The name.
   */
  const nameOfOutput = (router, output, lang = textLanguage()) => {
    const given = createdNames.get(outputIds(gladys, router.id, output.key).device);
    const suffix = ` (${routerName(router)})`;
    const name = given?.endsWith(suffix) ? given.slice(0, -suffix.length).trim() : given;
    return name || outputTitle(output, lang);
  };

  /**
   * @description The router and the output a widget, a scene or a feature points to.
   * @param {unknown} externalId - A `source: "devices"` value or a feature external id.
   * @returns {{ router: object|null, output: object|null }} The target; the first router by default.
   */
  function resolve(externalId) {
    const target = targetOf(externalId);
    const router = (target && store.data.routers[target.id]) || routers()[0] || null;
    if (!router) {
      return { router: null, output: null };
    }
    const output =
      target?.key && target.id === router.id
        ? ((router.outputs ?? []).find((entry) => entry.key === target.key) ?? null)
        : null;
    return { router, output };
  }

  // --- Errors and status -------------------------------------------------------------

  /**
   * @description The message of an error, for a user.
   * @param {object} err - The error (`kind`, `address`).
   * @param {string} lang - The language.
   * @returns {string} The message.
   */
  function errorText(err, lang) {
    const key = { unreachable: 'errUnreachable', invalid: 'errNotRouter', http: 'errNotRouter' }[
      err?.kind
    ];
    if (key) {
      return t(key, lang, { address: err.address ?? '' });
    }
    return t('errFailed', lang, { detail: String(err?.message ?? '').slice(0, 120) });
  }

  /**
   * @description Report the connection status, only when it changed.
   * @param {boolean} connected - Connected or not.
   * @param {object} message - The multi-language message.
   * @returns {Promise<void>}
   */
  async function reportStatus(connected, message) {
    const clipped = Object.fromEntries(
      Object.entries(message).map(([lang, text]) => [lang, text.slice(0, 200)]),
    );
    const signature = JSON.stringify([connected, clipped]);
    if (signature === lastStatus) {
      return;
    }
    lastStatus = signature;
    try {
      await gladys.setConnectionStatus(connected, clipped);
    } catch (err) {
      lastStatus = null;
      logger.error('Unable to report the connection status', err);
    }
  }

  /**
   * @description Work out the connection status.
   * @returns {Promise<void>}
   */
  async function refreshStatus() {
    const list = routers().filter((router) => config.hosts.includes(router.address));
    if (!config.hosts.length) {
      await reportStatus(false, all('statusNoHosts'));
      return;
    }
    if (!list.length) {
      const error = store.data.lastError;
      await reportStatus(
        false,
        all((lang) => (error ? errorText(error, lang) : t('statusNoRouter', lang))),
      );
      return;
    }
    const down = list.filter((router) => router.seen?.down);
    if (down.length === list.length) {
      await reportStatus(
        false,
        all((lang) =>
          t('statusDown', lang, { names: down.map((r) => nameOfRouter(r, lang)).join(', ') }),
        ),
      );
      return;
    }
    await reportStatus(
      true,
      all((lang) =>
        [
          t('statusOk', lang, {
            count: list.length,
            names: list.map((r) => nameOfRouter(r, lang)).join(', '),
          }),
          ...(down.length
            ? [
                t('statusSomeDown', lang, {
                  names: down.map((r) => nameOfRouter(r, lang)).join(', '),
                }),
              ]
            : []),
        ].join(' '),
      ),
    );
  }

  /**
   * @description Refresh the devices the user created, and their names.
   * @returns {Promise<void>}
   */
  async function refreshCreatedDevices() {
    try {
      const devices = await gladys.getDevices();
      createdNames = new Map(devices.map((device) => [device.external_id, device.name ?? '']));
    } catch (err) {
      logger.warn(`Unable to read the devices: ${err.message}`);
    }
  }

  /**
   * @description Ask the open widgets to pull their content again.
   */
  function refreshWidgets() {
    for (const key of Object.values(WIDGETS)) {
      Promise.resolve(gladys.requestWidgetRefresh(key)).catch(() => {});
    }
  }

  /**
   * @description Publish scene events, one by one.
   * @param {Array<{ key: string, data: object }>} events - The events.
   * @returns {Promise<void>}
   */
  async function publishEvents(events) {
    for (const { key, data } of events) {
      logger.info(`Solar router: ${key} (${data.router_name})`);
      try {
        await gladys.publishSceneEvent(key, data);
      } catch (err) {
        logger.warn(`Unable to fire ${key}: ${err.message}`);
      }
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /**
   * @description Offer the devices of every router, when they changed.
   * @param {boolean} [force] - Publish even when unchanged.
   * @returns {Promise<number>} How many devices were offered.
   */
  async function publishDiscoveredDevices(force = false) {
    const lang = textLanguage();
    const devices = routers().flatMap((router) =>
      buildRouterDevices(gladys, router, { language: lang }),
    );
    const signature = JSON.stringify(devices);
    if (force || signature !== lastDiscovery) {
      await gladys.publishDiscoveredDevices(devices);
      lastDiscovery = signature;
    }
    return devices.length;
  }

  /**
   * @description Publish the states of the created devices.
   * @returns {Promise<void>}
   */
  async function publishAllStates() {
    const lang = textLanguage();
    for (const router of routers()) {
      if (router.seen?.down) {
        // Unreachable: the values age, Gladys shows them as outdated.
        continue;
      }
      const states = buildRouterStates(gladys, router, { language: lang }).filter((state) =>
        createdNames.has(state.device_feature_external_id.replace(/:[a-z0-9_]+$/, '')),
      );
      if (!states.length) continue;
      await gladys
        .publishChangedStates(states, { heartbeat: HEARTBEAT_MS })
        .catch((err) =>
          logger.warn(`Unable to publish the states of ${router.id}: ${err.message}`),
        );
    }
  }

  // --- Reading -----------------------------------------------------------------------

  /**
   * @description Note an error.
   * @param {Error} err - The error.
   * @param {string} address - The address.
   */
  function noteError(err, address) {
    const kind = err.kind ?? 'failed';
    logger.warn(`Solar router ${address} (${kind}): ${err.message}`);
    store.data.lastError = { kind, address, message: String(err.message).slice(0, 200), at: now() };
  }

  /**
   * @description Read an address with the model it is known as, or recognise it.
   * @param {string} address - The address.
   * @returns {Promise<object>} The snapshot.
   */
  async function snapshotOf(address) {
    const client = clientOf(address);
    const known = store.data.addresses[address];
    if (known) {
      try {
        return await READERS[known](client);
      } catch (err) {
        // Unreachable: the same model, later. Another answer: look again.
        if (err.kind !== 'invalid' && err.kind !== 'http') throw err;
      }
    }
    let last = null;
    for (const model of MODELS) {
      if (model === known) continue;
      try {
        const snapshot = await READERS[model](client);
        store.data.addresses[address] = model;
        logger.info(`Solar router found: ${model} at ${address}`);
        return snapshot;
      } catch (err) {
        if (err.kind === 'unreachable') throw err;
        last = err;
      }
    }
    delete store.data.addresses[address];
    throw Object.assign(last ?? new Error('not a router'), { kind: 'invalid' });
  }

  /**
   * @description Read one address.
   * @param {string} address - The address.
   * @param {Set<string>} done - The routers already read this round.
   * @param {Array} events - Where the scene events go.
   * @returns {Promise<{ id: string|null, changed: boolean, error: object|null }>} What happened.
   */
  async function readAddress(address, done, events) {
    let snapshot;
    try {
      snapshot = await snapshotOf(address);
    } catch (err) {
      err.address = address;
      noteError(err, address);
      if (err.kind === 'invalid' && !routers().some((router) => router.address === address)) {
        notRouter.set(address, now() + RETRY_UNKNOWN_MS);
      }
      return { id: null, changed: false, error: err };
    }
    if (done.has(snapshot.id)) {
      return { id: snapshot.id, changed: false, error: null };
    }
    done.add(snapshot.id);
    const known = Boolean(store.data.routers[snapshot.id]);
    const router = (store.data.routers[snapshot.id] ??= { id: snapshot.id, outputs: [] });
    const before = router.outputs ?? [];
    router.address = address;
    const changed = mergeSnapshot(router, snapshot, now());
    if (known && router.model === 'f1atb') {
      const ours = new Set(
        [...commanded.entries()]
          .filter(([key, until]) => key.startsWith(`${router.id}|`) && until > now())
          .map(([key]) => key.split('|')[1]),
      );
      for (const ended of endedForcings(before, router.outputs, ours)) {
        const output = router.outputs.find((entry) => entry.key === ended.key);
        const lang = textLanguage();
        events.push({
          key: TRIGGERS.FORCING_ENDED,
          data: {
            router: routerIds(gladys, router.id).device,
            router_name: nameOfRouter(router).slice(0, 200),
            output: outputIds(gladys, router.id, output.key).device,
            output_name: nameOfOutput(router, output).slice(0, 200),
            previous_mode: ended.previous,
            message: t('event_forcing_ended', lang, { name: nameOfOutput(router, output) }).slice(
              0,
              1000,
            ),
          },
        });
      }
    }
    if (!known) {
      logger.info(`Solar router ${router.model} ${router.id} at ${address}`);
    }
    return { id: snapshot.id, changed: changed || !known, error: null };
  }

  /**
   * @description One reading round of every router.
   * @returns {Promise<{ found: string[], errors: object[] }>} The routers read and the errors.
   */
  async function runReading() {
    const done = new Set();
    const errors = [];
    const events = [];
    let changed = false;
    const lang = textLanguage();
    const typed = config.hosts.filter((address) => !(notRouter.get(address) > now()));
    for (const address of typed) {
      const result = await readAddress(address, done, events);
      if (result.error) errors.push(result.error);
      changed = changed || result.changed;
    }
    // Reachability and restarts, once per router of a typed address.
    for (const router of routers()) {
      if (!config.hosts.includes(router.address)) continue;
      const ok = done.has(router.id);
      const found = detectRouter(router.seen, {
        ok,
        uptimeHours: ok ? (router.values?.uptimeHours ?? null) : null,
        now: now(),
      });
      const wasDown = Boolean(router.seen?.down);
      router.seen = found.next;
      if (wasDown !== Boolean(router.seen.down)) changed = true;
      for (const event of found.events) {
        events.push({
          key: event.key,
          data: {
            router: routerIds(gladys, router.id).device,
            router_name: nameOfRouter(router).slice(0, 200),
            model: router.model,
            address: router.address ?? '',
            ...event.data,
            message: t(`event_${event.key}`, lang, { name: nameOfRouter(router) }).slice(0, 1000),
          },
        });
      }
    }
    for (const [key, until] of commanded) {
      if (until <= now()) commanded.delete(key);
    }
    if (done.size && !errors.length) store.data.lastError = null;
    await store.save();
    if (changed) {
      await publishDiscoveredDevices().catch((err) =>
        logger.warn(`Unable to offer the devices: ${err.message}`),
      );
    }
    await publishAllStates();
    if (events.length) await publishEvents(events);
    refreshWidgets();
    await refreshStatus();
    return { found: [...done], errors };
  }

  /**
   * @description One round of the timer (never two at once).
   * @returns {Promise<void>}
   */
  function tick() {
    if (!running) {
      running = runReading()
        .catch((err) => logger.error('Readings', err))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /**
   * @description (Re)arm the reading timer.
   */
  function schedule() {
    clearInterval(timer);
    clearTimeout(startTimer);
    if (!timers || stopped) {
      return;
    }
    startTimer = setTimeout(tick, STARTUP_DELAY_MS);
    startTimer.unref?.();
    timer = setInterval(tick, config.interval * 1000);
    timer.unref?.();
  }

  /**
   * @description Offer the devices, publish what is known, arm the timer.
   * @returns {Promise<void>}
   */
  async function applyConfig() {
    await store.save();
    await publishDiscoveredDevices().catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    await publishAllStates();
    await refreshStatus();
    schedule();
  }

  // --- Commands ----------------------------------------------------------------------

  /**
   * @description Set the mode of an output, then read the router again.
   * @param {object} router - The stored router.
   * @param {object} output - The output.
   * @param {string} mode - `on`, `off` or `auto`.
   * @param {number} minutes - The forcing duration (F1ATB).
   * @returns {Promise<number|null>} The minutes of an F1ATB forcing, null otherwise.
   */
  async function setOutputMode(router, output, mode, minutes) {
    if (router.seen?.down) {
      throw new Error(t('errDown', textLanguage(), { name: nameOfRouter(router) }));
    }
    const client = clientOf(router.address);
    let forced = null;
    // Two readings at most see the change: ignore it as an "ended" forcing.
    commanded.set(`${router.id}|${output.key}`, now() + 3 * config.interval * 1000);
    if (router.model === 'f1atb') {
      forced = Math.abs(await forceF1atb(client, output.index, mode, minutes));
    } else {
      await setMsunpvMode(client, output.key, mode);
    }
    logger.info(`Solar router ${router.id}: ${output.key} -> ${mode}`);
    output.mode = mode;
    output.forceMinutes = mode === 'auto' ? 0 : (forced ?? 0);
    await tick();
    return forced;
  }

  gladys.onSetValue(async (device, deviceFeature, value) => {
    const featureId = deviceFeature?.external_id ?? '';
    const target = targetOf(featureId);
    const { router, output } = resolve(featureId);
    if (!target || target.type !== 'output' || !router || !output || router.id !== target.id) {
      throw new Error(t('errNoOutput', textLanguage()));
    }
    if (!featureId.endsWith(':forced')) {
      throw new Error(`${featureId} is read only`);
    }
    await setOutputMode(router, output, Number(value) >= 1 ? 'on' : 'auto', config.forceMinutes);
  });

  // --- Dashboard widgets -------------------------------------------------------------

  /**
   * @description The message a widget shows when there is no router.
   * @param {string} lang - The language.
   * @returns {object|null} The content, null when there are routers.
   */
  function widgetMessage(lang) {
    if (routers().length) return null;
    if (!config.hosts.length) return messageContent(t('statusNoHosts', lang));
    const error = store.data.lastError;
    return messageContent(error ? errorText(error, lang) : t('statusNoRouter', lang));
  }

  gladys.onWidgetGet(WIDGETS.OVERVIEW, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) return message;
    const { router } = resolve(settings.router);
    return buildOverviewWidget({
      router,
      name: nameOfRouter(router, lang),
      outputName: (output) => nameOfOutput(router, output, lang),
      language: lang,
      now: now(),
    });
  });

  gladys.onWidgetGet(WIDGETS.POWER, async ({ settings = {}, language: lang } = {}) => {
    rememberLanguage(lang);
    const message = widgetMessage(lang);
    if (message) return message;
    const { router } = resolve(settings.router);
    return buildPowerWidget({ router, name: nameOfRouter(router, lang), language: lang });
  });

  gladys.onWidgetAction(WIDGETS.OVERVIEW, async (actionKey, params = {}) => {
    const lang = textLanguage();
    if (!String(actionKey).startsWith(`${WIDGET_ACTIONS.SET_MODE}_`)) {
      throw new Error(`unknown action ${actionKey}`);
    }
    const router = store.data.routers[params.router];
    const output = router?.outputs?.find((entry) => entry.key === params.output);
    const mode = MODES.includes(params.mode) ? params.mode : null;
    if (!router || !output || !mode) {
      throw new Error(t('errNoOutput', lang));
    }
    await setOutputMode(router, output, mode, config.forceMinutes);
    return all((l) =>
      t('toastMode', l, {
        name: nameOfOutput(router, output, l),
        mode: modeText(mode, router.model, l),
      }).slice(0, 200),
    );
  });

  // --- Scene actions -----------------------------------------------------------------

  gladys.onSceneAction(SCENE_ACTIONS.SET_OUTPUT_MODE, async (fields = {}) => {
    const lang = textLanguage();
    const target = targetOf(fields.output);
    const { router, output } = resolve(fields.output);
    if (!router) throw new Error(t('errNoRouter', lang));
    if (!output || target?.type !== 'output') throw new Error(t('errNoOutput', lang));
    const mode = MODES.includes(fields.mode) ? fields.mode : 'auto';
    const wanted = Number(fields.minutes);
    const minutes = Number.isFinite(wanted) && wanted >= 1 ? wanted : DEFAULT_MINUTES;
    const forced = await setOutputMode(router, output, mode, minutes);
    const name = nameOfOutput(router, output);
    const modeLabel = modeText(mode, router.model, lang);
    return pick(
      {
        output_name: name,
        mode,
        minutes: mode === 'auto' ? 0 : forced,
        summary: (forced && mode !== 'auto'
          ? t('summarySetModeFor', lang, { name, mode: modeLabel, minutes: forced })
          : t('summarySetMode', lang, { name, mode: modeLabel })
        ).slice(0, 1000),
      },
      SET_MODE_OUTPUTS,
    );
  });

  gladys.onSceneAction(SCENE_ACTIONS.GET_TODAY, async (fields = {}) => {
    const lang = textLanguage();
    const { router } = resolve(fields.router);
    if (!router) throw new Error(t('errNoRouter', lang));
    const values = router.values ?? {};
    const kwh = (wh) => (Number.isFinite(wh) ? rounded(wh / 1000, 3) : null);
    const imported = kwh(values.importTodayWh);
    const exported = kwh(values.exportTodayWh);
    const routed = kwh(values.routedTodayWh);
    const produced = kwh(values.producedTodayWh);
    const name = nameOfRouter(router);
    const format = (value) => (Number.isFinite(value) ? formatNumber(value, lang, 2) : '–');
    const extra = [
      ...(Number.isFinite(routed) ? [t('summaryRouted', lang, { kwh: format(routed) })] : []),
      ...(Number.isFinite(produced) ? [t('summaryProduced', lang, { kwh: format(produced) })] : []),
    ].join('');
    const grid = gridOf(values);
    return pick(
      {
        router_name: name,
        imported_kwh: imported,
        exported_kwh: exported,
        routed_kwh: routed,
        produced_kwh: produced,
        grid_watts: Number.isFinite(grid) ? Math.round(grid) : null,
        summary: t('summaryToday', lang, {
          name,
          imported: format(imported),
          exported: format(exported),
          extra,
        }).slice(0, 1000),
      },
      TODAY_OUTPUTS,
    );
  });

  // --- Configuration screen actions --------------------------------------------------

  gladys.onAction(ACTIONS.SEARCH, async () => {
    notRouter.clear();
    const { found, errors } = await runReading();
    lastStatus = null;
    await refreshStatus();
    await publishDiscoveredDevices(true).catch((err) =>
      logger.warn(`Unable to offer the devices: ${err.message}`),
    );
    if (!config.hosts.length) return all('statusNoHosts');
    if (!found.length) {
      const error = errors[0];
      return all((lang) =>
        (error ? errorText(error, lang) : t('statusNoRouter', lang)).slice(0, 1000),
      );
    }
    return all((lang) => {
      const names = found.map((id) => nameOfRouter(store.data.routers[id], lang)).join(', ');
      const problems = errors.map((err) => errorText(err, lang));
      return [t('searchOk', lang, { count: found.length, names }), ...problems]
        .join(' ')
        .slice(0, 1000);
    });
  });

  gladys.onAction(ACTIONS.DIAGNOSTIC, async () => {
    const iso = (value) => (Number.isFinite(value) && value ? new Date(value).toISOString() : null);
    const report = {
      version: VERSION,
      timeZone,
      hosts: config.hosts,
      interval: config.interval,
      forceMinutes: config.forceMinutes,
      language: config.language,
      addresses: store.data.addresses,
      lastError: store.data.lastError,
      clients: Object.fromEntries(
        [...clients].map(([address, client]) => [address, client.counts()]),
      ),
      routers: routers().map((router) => ({
        id: router.id,
        model: router.model,
        modelName: router.modelName,
        firmware: router.firmware ?? null,
        address: router.address,
        name: router.name,
        readAt: iso(router.readAt),
        seen: router.seen,
        values: router.values,
        present: router.present,
        counters: router.counters,
        historyPoints: router.history?.length ?? 0,
        created: createdNames.has(routerIds(gladys, router.id).device),
        outputs: (router.outputs ?? []).map((output) => ({
          ...output,
          created: createdNames.has(outputIds(gladys, router.id, output.key).device),
        })),
      })),
    };
    const json = JSON.stringify(report);
    const count = Math.max(1, Math.ceil(json.length / DIAGNOSTIC_CHUNK));
    for (let chunk = 0; chunk < count; chunk += 1) {
      logger.info(
        `Solar router diagnostic ${chunk + 1}/${count}: ${json.slice(chunk * DIAGNOSTIC_CHUNK, (chunk + 1) * DIAGNOSTIC_CHUNK)}`,
      );
    }
    return all('diagnosticDone', { count });
  });

  // --- Devices -----------------------------------------------------------------------
  gladys.onScanRequest(async () => {
    notRouter.clear();
    await runReading();
    const count = await publishDiscoveredDevices(true);
    logger.info(`Scan: ${count} device(s) offered`);
  });

  gladys.onDeviceCreated(async () => {
    await refreshCreatedDevices();
    // States sent before the device existed were dropped by Gladys, and the SDK
    // forgot what it sent for this device: send everything known again.
    await publishAllStates();
    refreshWidgets();
  });

  gladys.onDeviceUpdated(refreshCreatedDevices);
  gladys.onDeviceDeleted(refreshCreatedDevices);

  // --- Configuration -----------------------------------------------------------------

  /**
   * @description Reload the whole config (internal keys included).
   * @param {object} [fallback] - Raw values to use when the read fails.
   * @returns {Promise<void>}
   */
  async function loadConfig(fallback) {
    try {
      const raw = await gladys.getConfig();
      config = normalizeConfig(raw);
      language = readLanguage(raw, language);
    } catch (err) {
      if (fallback) {
        config = normalizeConfig(fallback);
      }
      logger.error('Unable to read the configuration', err);
    }
  }

  gladys.onConfigUpdated(async (rawConfig) => {
    const previous = config;
    await loadConfig(rawConfig);
    logger.info('Configuration updated');
    lastStatus = null;
    lastDiscovery = null;
    if (previous.hosts.join() !== config.hosts.join()) {
      notRouter.clear();
    }
    await applyConfig();
  });

  // --- Connection lifecycle ----------------------------------------------------------
  // Each (re)connection resynchronizes; the promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await store.load();
      await loadConfig();
      await refreshCreatedDevices();
      lastStatus = null;
      lastDiscovery = null;
      await applyConfig();
    })().catch((err) => logger.error('Startup', err));
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    stopped = true;
    clearInterval(timer);
    clearTimeout(startTimer);
    await running?.catch(() => {});
    await store.save();
  });

  return {
    store,
    tick,
    runReading,
    resolve,
    setOutputMode,
    getConfig: () => config,
    whenReady: () => startup,
  };
}

export { createApp, ACTIONS, HEARTBEAT_MS, RETRY_UNKNOWN_MS };
