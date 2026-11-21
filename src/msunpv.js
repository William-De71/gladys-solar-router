// -----------------------------------------------------------------------------
// The MSunPV solar router (Ard-Tek, models 2x2d and 4x4d), through the
// status.xml page of its Wi-Fi board, the page its own web interface polls.
// Facts taken from the Home Assistant integration pvergezac/MSunPVIntegration
// (MIT) and the shapes it documents; none of its code is used.
//
// GET /status.xml
//   <xml>
//     <inAns>1157,6;1,0; 0; 0;215,0;61,8;0,0;0,0;…</inAns>    16 measures, comma decimals:
//        0 grid power W (import > 0, export < 0), 1 PV power W (negative),
//        2 water heater output, 3 radiator output (W on a 4x4d, 0..400 on a 2x2d),
//        5 water heater temperature, 6 bathroom, 7 ambient (°C)
//     <paramSys>20:59:45;17/03/2025;On;01:00;0,0;MS_PV2_2d;5.0.1;0000200;104b;104b;…</paramSys>
//        time; date; SD; interval; -; model; version; serial number; Wi-Fi fw; router fw
//     <cmdPos>a;0;0;0;0;0;0;2;</cmdPos>   8 commands, hexadecimal: command 0 bits
//        0 water heater forced, 1 water heater automatic, 2 radiator forced, 3 radiator automatic
//     <cptVals>9702;ffffc0d9;fffe0040;fffff37c;0;0;0;0;</cptVals>   counters, signed hex:
//        0 drawn today, 1 exported today, 2 produced today (tenths of Wh),
//        3 produced since the beginning (tenths of kWh), 4/5 water heater /
//        radiator today on a 4x4d (tenths of Wh)
//     <rssi>…;-62;</rssi>  (firmware 104 and later)
//   </xml>
// POST /index.xml  parS=<cmd0>;<cmd1>;…;<cmd7>;  (decimal values) sets the commands.
// Both bits of an output cleared: the output is off.
// -----------------------------------------------------------------------------

import { RouterError } from './router-api.js';

const OUTPUTS = {
  water_heater: { input: 2, counter: 4, forced: 0x01, auto: 0x02 },
  heater: { input: 3, counter: 5, forced: 0x04, auto: 0x08 },
};
const COMMANDS = 8;

/**
 * @description The text of a tag of status.xml.
 * @param {string} xml - The answer.
 * @param {string} tag - The tag.
 * @returns {string|null} The text, null when absent.
 */
function tagOf(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match ? match[1] : null;
}

/**
 * @description The values of a tag, split on ";" (comma decimals made dots).
 * @param {string|null} text - The text of the tag.
 * @returns {string[]} The trimmed values.
 */
function valuesOf(text) {
  return String(text ?? '')
    .split(';')
    .map((value) => value.trim().replace(',', '.'));
}

/**
 * @description A decimal value; anything else is null.
 * @param {string} value - The value.
 * @returns {number|null} The number.
 */
function num(value) {
  if (!/^-?\d+(\.\d+)?$/.test(String(value ?? ''))) return null;
  return Number(value);
}

/**
 * @description A signed 32-bit hexadecimal counter.
 * @param {string} value - "ffffc0d9".
 * @returns {number|null} The number.
 */
function signedHex(value) {
  const text = String(value ?? '').trim();
  if (!/^[0-9a-f]{1,8}$/i.test(text)) return null;
  const parsed = parseInt(text, 16);
  return text.length === 8 && parsed >= 0x80000000 ? parsed - 0x100000000 : parsed;
}

/**
 * @description The mode of an output from its two command bits.
 * @param {number} command - Command 0.
 * @param {object} output - An OUTPUTS entry.
 * @returns {string} `on` (forced), `auto` or `off`.
 */
function modeOf(command, output) {
  if (command & output.forced) return 'on';
  if (command & output.auto) return 'auto';
  return 'off';
}

/**
 * @description Read status.xml.
 * @param {string} body - The answer.
 * @returns {object} The router state.
 * @throws {RouterError} When it is not the answer of an MSunPV.
 */
function parseStatus(body) {
  const xml = String(body ?? '');
  const inputs = valuesOf(tagOf(xml, 'inAns'));
  const system = valuesOf(tagOf(xml, 'paramSys'));
  if (inputs.length < 8 || system.length < 8 || num(inputs[0]) === null) {
    throw new RouterError('invalid', 'not the answer of an MSunPV router (/status.xml)');
  }
  const serial = system[7].replace(/[^0-9A-Za-z]/g, '');
  if (!serial) {
    throw new RouterError('invalid', 'MSunPV router: no serial number in /status.xml');
  }
  const model = system[5] || null;
  // A 4x4d gives the outputs in W; a 2x2d from 0 to 400 (0..100 %).
  const fourByFour = /4\s*[x_]\s*4/i.test(model ?? '');
  const commands = valuesOf(tagOf(xml, 'cmdPos')).slice(0, COMMANDS);
  const command0 = parseInt(commands[0], 16);
  const counters = valuesOf(tagOf(xml, 'cptVals')).map(signedHex);
  const tenthWh = (value) => (value === null || value === undefined ? null : Math.abs(value) / 10);
  const rssi = num(valuesOf(tagOf(xml, 'rssi'))[1]);
  const temperature = (index) => num(inputs[index]);
  const outputs = Object.fromEntries(
    Object.entries(OUTPUTS).map(([key, output]) => {
      const raw = num(inputs[output.input]);
      return [
        key,
        {
          key,
          powerW: fourByFour ? raw : null,
          opening:
            !fourByFour && raw !== null ? Math.min(100, Math.max(0, Math.round(raw / 4))) : null,
          mode: Number.isInteger(command0) ? modeOf(command0, output) : null,
          todayWh: fourByFour ? tenthWh(counters[output.counter]) : null,
        },
      ];
    }),
  );
  const pv = num(inputs[1]);
  return {
    serial,
    model,
    fourByFour,
    version: system[6] || null,
    firmware: system[9] || system[8] || null,
    gridW: num(inputs[0]),
    pvW: pv === null ? null : Math.max(0, -pv),
    temperatures: { water: temperature(5), bathroom: temperature(6), ambient: temperature(7) },
    importTodayWh: tenthWh(counters[0]),
    exportTodayWh: tenthWh(counters[1]),
    producedTodayWh: tenthWh(counters[2]),
    producedTotalWh:
      counters[3] === null || counters[3] === undefined ? null : Math.abs(counters[3]) * 100,
    commands,
    outputs,
    rssi: rssi !== null && rssi < 0 ? rssi : null,
  };
}

/**
 * @description Read one MSunPV router.
 * @param {object} client - A router client.
 * @returns {Promise<object>} `{ model, id, name, status }`.
 */
async function readMsunpv(client) {
  const status = parseStatus(await client.get('/status.xml'));
  return { model: 'msunpv', id: status.serial.toLowerCase(), name: status.model, status };
}

/**
 * @description The commands to post to set the mode of an output.
 * @param {string[]} commands - The current commands (hexadecimal).
 * @param {string} outputKey - `water_heater` or `heater`.
 * @param {string} mode - `on`, `off` or `auto`.
 * @returns {string} The parS value: "<c0>;<c1>;…;" in decimal.
 */
function commandsFor(commands, outputKey, mode) {
  const output = OUTPUTS[outputKey];
  if (!output) throw new Error(`unknown MSunPV output ${outputKey}`);
  const values = Array.from({ length: COMMANDS }, (_, index) => {
    const value = parseInt(commands[index], 16);
    return Number.isInteger(value) ? value : 0;
  });
  const cleared = values[0] & ~(output.forced | output.auto);
  values[0] =
    mode === 'on' ? cleared | output.forced : mode === 'auto' ? cleared | output.auto : cleared;
  return `${values.join(';')};`;
}

/**
 * @description Set the mode of an MSunPV output (the commands are read first:
 * only the bits of that output change).
 * @param {object} client - A router client.
 * @param {string} outputKey - `water_heater` or `heater`.
 * @param {string} mode - `on`, `off` or `auto`.
 * @returns {Promise<string>} The parS sent.
 */
async function setMsunpvMode(client, outputKey, mode) {
  const { commands } = parseStatus(await client.get('/status.xml'));
  const parS = commandsFor(commands, outputKey, mode);
  await client.postForm('/index.xml', { parS });
  return parS;
}

export { OUTPUTS, tagOf, signedHex, modeOf, parseStatus, readMsunpv, commandsFor, setMsunpvMode };
