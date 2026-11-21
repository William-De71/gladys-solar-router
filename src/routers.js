// -----------------------------------------------------------------------------
// One shape for both routers. A reading of an F1ATB or an MSunPV becomes a
// "snapshot" (what the router says now), merged into the stored router:
//
//   router = {
//     id, model ('f1atb' | 'msunpv'), address, name, modelName, fourByFour,
//     values: {
//       gridImportW, gridExportW      F1ATB (two values, each >= 0)
//       gridW                         MSunPV (signed: import > 0, export < 0)
//       gridImportWh, gridExportWh    indexes (F1ATB: its own; MSunPV: summed here)
//       routedW, routedWh             F1ATB with a second probe on the routed load
//       pvW, pvWh                     MSunPV production
//       importTodayWh, exportTodayWh, routedTodayWh, producedTodayWh
//       temperatures: { key: °C }     only the probes that exist
//       rssi, uptimeHours
//     },
//     present: { feature key: true }  the features seen once stay offered
//     outputs: [{ key, title, opening, powerW, mode, forceMinutes, onHours, todayWh, indexWh }],
//     counters: { name: { last, totalWh } }   daily MSunPV counters summed into indexes
//     history: [{ t, grid, routed, pv }]       5-minute points, 24 hours
//   }
// -----------------------------------------------------------------------------

const HISTORY_STEP_MS = 5 * 60 * 1000;
const HISTORY_POINTS = 288;
const F1ATB_TEMPERATURES = ['temperature_1', 'temperature_2', 'temperature_3', 'temperature_4'];
const MSUNPV_TEMPERATURES = {
  water: 'temperature_water',
  bathroom: 'temperature_bathroom',
  ambient: 'temperature_ambient',
};

const finite = (value) => (Number.isFinite(value) ? value : null);

/**
 * @description The snapshot of an F1ATB reading.
 * @param {object} reading - readF1atb().
 * @returns {object} The snapshot.
 */
function fromF1atb(reading) {
  const { data, system, actions } = reading;
  const temperatures = {};
  data.temperatures.forEach((value, index) => {
    if (value !== null) temperatures[F1ATB_TEMPERATURES[index]] = value;
  });
  return {
    id: reading.id,
    model: 'f1atb',
    name: reading.name,
    modelName: 'F1ATB',
    values: {
      gridImportW: finite(data.house.importW),
      gridExportW: finite(data.house.exportW),
      gridImportWh: finite(data.house.importWh),
      gridExportWh: finite(data.house.exportWh),
      importTodayWh: finite(data.house.importTodayWh),
      exportTodayWh: finite(data.house.exportTodayWh),
      routedW: data.probe ? finite(data.probe.importW) : null,
      routedWh: data.probe ? finite(data.probe.importWh) : null,
      routedTodayWh: data.probe ? finite(data.probe.importTodayWh) : null,
      temperatures,
      rssi: system.rssi,
      uptimeHours: finite(system.uptimeHours),
    },
    outputs: actions.map((action) => ({
      key: `a${action.index}`,
      index: action.index,
      title: action.title,
      opening: action.opening,
      powerW: null,
      mode: action.forceMinutes > 0 ? 'on' : action.forceMinutes < 0 ? 'off' : 'auto',
      forceMinutes: Math.abs(action.forceMinutes),
      onHours: action.onHours,
      todayWh: null,
    })),
  };
}

/**
 * @description The snapshot of an MSunPV reading.
 * @param {object} reading - readMsunpv().
 * @returns {object} The snapshot.
 */
function fromMsunpv(reading) {
  const { status } = reading;
  const temperatures = {};
  for (const [name, key] of Object.entries(MSUNPV_TEMPERATURES)) {
    const value = status.temperatures[name];
    // An unplugged probe reads 0 (or less): offered once it measured something.
    if (Number.isFinite(value) && value > -50 && value !== 0) temperatures[key] = value;
  }
  const outputs = Object.values(status.outputs).map((output) => ({
    key: output.key,
    index: null,
    title: output.key,
    opening: output.opening,
    powerW: output.powerW,
    mode: output.mode,
    forceMinutes: 0,
    onHours: null,
    todayWh: output.todayWh,
  }));
  return {
    id: reading.id,
    model: 'msunpv',
    name: null,
    modelName: status.model ?? 'MSunPV',
    fourByFour: status.fourByFour,
    values: {
      gridW: finite(status.gridW),
      importTodayWh: finite(status.importTodayWh),
      exportTodayWh: finite(status.exportTodayWh),
      pvW: finite(status.pvW),
      pvWh: finite(status.producedTotalWh),
      producedTodayWh: finite(status.producedTodayWh),
      routedTodayWh: status.fourByFour
        ? outputs.reduce((sum, output) => sum + (output.todayWh ?? 0), 0)
        : null,
      temperatures,
      rssi: status.rssi,
      uptimeHours: null,
    },
    outputs,
    firmware: status.firmware,
  };
}

/**
 * @description Add a daily counter to its index: what it grew by since the
 * last reading, or all of it after its midnight reset.
 * @param {object} counters - The stored counters.
 * @param {string} name - The counter.
 * @param {number|null} value - Today's value (Wh).
 * @returns {number|null} The index (Wh), null while the counter is unknown.
 */
function accumulate(counters, name, value) {
  const counter = counters[name];
  if (!Number.isFinite(value)) return counter?.totalWh ?? null;
  if (!counter) {
    // The index starts at 0 now: Gladys only uses its increases.
    counters[name] = { last: value, totalWh: 0 };
    return 0;
  }
  counter.totalWh += value >= counter.last ? value - counter.last : value;
  counter.last = value;
  return counter.totalWh;
}

/**
 * @description Note a history point (one per 5 minutes, 24 hours).
 * @param {object} router - The stored router.
 * @param {number} now - Now, in ms.
 */
function addHistory(router, now) {
  const values = router.values ?? {};
  const grid = Number.isFinite(values.gridW)
    ? values.gridW
    : Number.isFinite(values.gridImportW) || Number.isFinite(values.gridExportW)
      ? (values.gridImportW ?? 0) - (values.gridExportW ?? 0)
      : null;
  const slot = Math.floor(now / HISTORY_STEP_MS) * HISTORY_STEP_MS;
  const history = (router.history ??= []);
  const point = { t: slot, grid, routed: values.routedW ?? null, pv: values.pvW ?? null };
  if (history.length && history[history.length - 1].t === slot) {
    history[history.length - 1] = point;
  } else {
    history.push(point);
  }
  const oldest = slot - HISTORY_POINTS * HISTORY_STEP_MS;
  while (history.length && (history[0].t <= oldest || history.length > HISTORY_POINTS)) {
    history.shift();
  }
}

/**
 * @description Merge a snapshot into the stored router.
 * @param {object} router - The stored router (changed in place).
 * @param {object} snapshot - fromF1atb() or fromMsunpv().
 * @param {number} now - Now, in ms.
 * @returns {boolean} Whether the devices offered to Gladys change.
 */
function mergeSnapshot(router, snapshot, now) {
  const before = JSON.stringify([
    router.name,
    router.present,
    (router.outputs ?? []).map((output) => [output.key, output.title]),
  ]);
  router.model = snapshot.model;
  router.name = snapshot.name ?? router.name ?? null;
  router.modelName = snapshot.modelName;
  router.fourByFour = Boolean(snapshot.fourByFour);
  router.firmware = snapshot.firmware ?? router.firmware ?? null;
  router.counters ??= {};
  router.present ??= {};
  const values = { ...snapshot.values };
  if (snapshot.model === 'msunpv') {
    values.gridImportWh = accumulate(router.counters, 'import', values.importTodayWh);
    values.gridExportWh = accumulate(router.counters, 'export', values.exportTodayWh);
  }
  router.values = values;
  const present = router.present;
  const mark = (key, value) => {
    if (value !== null && value !== undefined) present[key] = true;
  };
  mark('grid_import_power', values.gridImportW);
  mark('grid_export_power', values.gridExportW);
  mark('grid_power', values.gridW);
  mark('grid_import_index', values.gridImportWh);
  mark('grid_export_index', values.gridExportWh);
  mark('routed_power', values.routedW);
  mark('routed_energy', values.routedWh);
  mark('pv_power', values.pvW);
  mark('pv_energy', values.pvWh);
  mark('rssi', values.rssi);
  for (const key of Object.keys(values.temperatures ?? {})) present[key] = true;
  router.outputs = snapshot.outputs.map((output) => ({
    ...output,
    indexWh:
      snapshot.model === 'msunpv' && router.fourByFour
        ? accumulate(router.counters, `output_${output.key}`, output.todayWh)
        : null,
  }));
  router.readAt = now;
  addHistory(router, now);
  return (
    JSON.stringify([
      router.name,
      router.present,
      router.outputs.map((output) => [output.key, output.title]),
    ]) !== before
  );
}

export {
  HISTORY_STEP_MS,
  HISTORY_POINTS,
  F1ATB_TEMPERATURES,
  MSUNPV_TEMPERATURES,
  fromF1atb,
  fromMsunpv,
  accumulate,
  addHistory,
  mergeSnapshot,
};
