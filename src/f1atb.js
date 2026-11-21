// -----------------------------------------------------------------------------
// The F1ATB solar router (https://f1atb.fr, firmware on an ESP32), through the
// pages its own web interface reads. Facts taken from the firmware sources
// (https://github.com/F1ATB/Solar-Router-F1ATB, Server.ino, V17): none of its
// code is used. The answers are text, split by ASCII control characters:
//   GS = \x1d (group), RS = \x1e (record), US = \x1f (unit), FS = \x1c.
//
// GET /ajax_data
//   "Deb" RS date RS source RS tariff RS tempo RS "t1|t2|t3|t4|" RS pva_valid
//   GS house: PwS RS PwI RS PVAS RS PVAI RS EJS RS EJI RS ES RS EI
//   GS probe "T" (same fields) or "Fake" when the router has no second probe
//   GS FS voltages and currents … FS "Fin"
//   (W drawn from / sent to the grid, Wh today, Wh since the beginning)
// GET /ajax_etatActions
//   temperatures GS source GS external router GS count GS
//   then per active action: index RS title RS "On"|"Off"|opening RS
//   force minutes RS hours×100 RS GS
// GET /ajax_dataESP32
//   uptime h RS board RS RSSI RS BSSID RS channel RS MAC RS SSID RS
//   ip US hostname US ipv6 RS gateway RS mask …
// GET /ForceAction?NumAction=<n>&Force=<minutes>
//   > 0 forced on for that many minutes, < 0 forced off, 0 back to automatic
//   (the firmware counts one down every minute).
// -----------------------------------------------------------------------------

import { RouterError } from './router-api.js';

const GS = '\x1d';
const RS = '\x1e';
const US = '\x1f';
const MAX_FORCE_MINUTES = 24 * 60;
const MAX_TEMPERATURES = 4;

/**
 * @description A number of the firmware; anything else is null.
 * @param {unknown} value - The field.
 * @returns {number|null} The number.
 */
function num(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @description The temperatures of the "t1|t2|t3|t4|" field (absent probe: null).
 * @param {string} field - The field.
 * @returns {Array<number|null>} Four values.
 */
function parseTemperatures(field) {
  const parts = String(field ?? '').split('|');
  return Array.from({ length: MAX_TEMPERATURES }, (_, index) => {
    const value = num(parts[index]);
    // The firmware says -127 for a missing probe and ignores anything at or
    // below -50 itself (its history only keeps values above -50).
    return value === null || value <= -50 ? null : value;
  });
}

/**
 * @description The energy group of /ajax_data (house or probe "T").
 * @param {string} group - The group.
 * @returns {object|null} `{ importW, exportW, importTodayWh, exportTodayWh, importWh, exportWh }`.
 */
function parseEnergyGroup(group) {
  const fields = String(group ?? '').split(RS);
  if (fields.length < 8 || num(fields[0]) === null) return null;
  return {
    importW: num(fields[0]),
    exportW: num(fields[1]),
    importTodayWh: num(fields[4]),
    exportTodayWh: num(fields[5]),
    importWh: num(fields[6]),
    exportWh: num(fields[7]),
  };
}

/**
 * @description Read /ajax_data.
 * @param {string} body - The answer.
 * @returns {object} `{ date, source, temperatures, house, probe }`.
 * @throws {RouterError} When it is not the answer of an F1ATB router.
 */
function parseData(body) {
  const text = String(body ?? '');
  if (!text.startsWith(`Deb${RS}`)) {
    throw new RouterError('invalid', 'not the answer of an F1ATB router (/ajax_data)');
  }
  const groups = text.split(GS);
  const head = groups[0].split(RS);
  const house = parseEnergyGroup(groups[1]);
  if (!house) {
    throw new RouterError('invalid', 'F1ATB router: no power values in /ajax_data');
  }
  return {
    date: head[1]?.trim() || null,
    source: head[2]?.trim() || null,
    temperatures: parseTemperatures(head[5]),
    house,
    // "Fake" when the router measures the house only.
    probe: parseEnergyGroup(groups[2]),
  };
}

/**
 * @description Read /ajax_etatActions.
 * @param {string} body - The answer.
 * @returns {Array<{ index: number, title: string, opening: number|null, forceMinutes: number, onHours: number|null }>} The active actions.
 */
function parseActions(body) {
  const groups = String(body ?? '').split(GS);
  const actions = [];
  for (const record of groups.slice(4)) {
    const fields = record.split(RS);
    const index = num(fields[0]);
    if (fields.length < 4 || index === null || !Number.isInteger(index) || index < 0) continue;
    const raw = String(fields[2] ?? '').trim();
    let opening = null;
    if (/^on$/i.test(raw)) opening = 100;
    else if (/^off$/i.test(raw)) opening = 0;
    else if (num(raw) !== null) opening = Math.min(100, Math.max(0, num(raw)));
    const hours = num(fields[4]);
    actions.push({
      index,
      title: String(fields[1] ?? '').trim() || `Action ${index}`,
      opening,
      forceMinutes: Math.trunc(num(fields[3]) ?? 0),
      onHours: hours === null ? null : Math.max(0, hours / 100),
    });
  }
  return actions;
}

/**
 * @description Read /ajax_dataESP32.
 * @param {string} body - The answer.
 * @returns {object} `{ mac, hostname, ip, rssi, uptimeHours }`; mac is 12 lowercase hex digits or null.
 */
function parseSystem(body) {
  const fields = String(body ?? '')
    .split(GS)[0]
    .split(RS);
  const mac = String(fields[5] ?? '')
    .toLowerCase()
    .replace(/[^0-9a-f]/g, '');
  const address = String(fields[7] ?? '').split(US);
  const rssi = num(fields[2]);
  return {
    mac: /^[0-9a-f]{12}$/.test(mac) && mac !== '000000000000' ? mac : null,
    hostname: address[1]?.trim() || null,
    ip: address[0]?.trim() || null,
    // Ethernet boards send a blank RSSI.
    rssi: rssi !== null && rssi < 0 ? rssi : null,
    uptimeHours: num(fields[0]),
  };
}

/**
 * @description The Force value of a mode.
 * @param {string} mode - `on`, `off` or `auto`.
 * @param {number} minutes - The duration of a forced mode.
 * @returns {number} The value of /ForceAction.
 */
function forceValue(mode, minutes) {
  if (mode === 'auto') return 0;
  const duration = Math.min(MAX_FORCE_MINUTES, Math.max(1, Math.round(Number(minutes) || 60)));
  return mode === 'off' ? -duration : duration;
}

/**
 * @description Read everything of one F1ATB router.
 * @param {object} client - A router client.
 * @returns {Promise<object>} `{ model, id, name, system, data, actions }`.
 */
async function readF1atb(client) {
  const data = parseData(await client.get('/ajax_data'));
  const system = parseSystem(await client.get('/ajax_dataESP32'));
  if (!system.mac) {
    throw new RouterError('invalid', `${client.address}: the F1ATB router gave no MAC address`);
  }
  const actions = parseActions(await client.get('/ajax_etatActions'));
  return {
    model: 'f1atb',
    id: system.mac,
    name: system.hostname,
    system,
    data,
    actions,
  };
}

/**
 * @description Force an action of an F1ATB router.
 * @param {object} client - A router client.
 * @param {number} index - The action number.
 * @param {string} mode - `on`, `off` or `auto`.
 * @param {number} minutes - The duration of a forced mode.
 * @returns {Promise<number>} The Force value sent.
 */
async function forceF1atb(client, index, mode, minutes) {
  const force = forceValue(mode, minutes);
  await client.get(`/ForceAction?NumAction=${Number(index)}&Force=${force}`);
  return force;
}

export {
  GS,
  RS,
  US,
  MAX_FORCE_MINUTES,
  parseTemperatures,
  parseData,
  parseActions,
  parseSystem,
  forceValue,
  readF1atb,
  forceF1atb,
};
