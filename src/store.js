// -----------------------------------------------------------------------------
// What the integration keeps across restarts, under /data (the only writable
// place of the container), in /data/solar-router.json (mode 0600):
//
//   - `routers`  per router, by id (MAC address of an F1ATB, serial number of
//                an MSunPV), the shape of routers.js: address, model, last
//                values, outputs, the features seen, the daily MSunPV
//                counters summed into indexes, 24 hours of 5-minute points,
//                reachability for the triggers (`seen`);
//   - `addresses` the model recognised at each typed address;
//   - `lastError` the last error (diagnostic).
// -----------------------------------------------------------------------------

import { readFile, writeFile, rename, mkdir, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_DIR = '/data';
const FILE = 'solar-router.json';
const EMPTY = () => ({ routers: {}, addresses: {}, lastError: null });

/**
 * @description Read a JSON file; an absent or broken file is null.
 * @param {string} path - The file.
 * @param {object} [logger] - Logger.
 * @returns {Promise<object|null>} The value.
 */
async function readJson(path, logger) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger?.warn(`Unable to read ${path}: ${err.message}`);
    }
    return null;
  }
}

/**
 * @description Write a JSON file atomically (a temporary file, then a
 * rename), readable by its owner only.
 * @param {string} path - The file.
 * @param {object} value - The value.
 * @param {object} [logger] - Logger.
 * @returns {Promise<void>}
 */
async function writeJson(path, value, logger) {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } catch (err) {
    logger?.warn(`Unable to write ${path}: ${err.message}`);
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * @description The store.
 * @param {object} [options] - `{ dir, logger }`.
 * @returns {object} `{ data, load, save, reset, path }`.
 */
function createStore({ dir = DEFAULT_DIR, logger } = {}) {
  const path = join(dir, FILE);
  let writing = Promise.resolve();
  const store = {
    path,
    data: EMPTY(),
    /**
     * @description Read the file.
     * @returns {Promise<void>}
     */
    async load() {
      const raw = (await readJson(path, logger)) ?? {};
      const data = EMPTY();
      if (isObject(raw.routers)) {
        for (const [id, router] of Object.entries(raw.routers)) {
          if (/^[0-9a-z]{1,32}$/.test(id) && isObject(router)) {
            data.routers[id] = {
              ...router,
              id,
              values: isObject(router.values) ? router.values : {},
              present: isObject(router.present) ? router.present : {},
              counters: isObject(router.counters) ? router.counters : {},
              outputs: Array.isArray(router.outputs) ? router.outputs.filter(isObject) : [],
              history: Array.isArray(router.history) ? router.history.filter(isObject) : [],
            };
          }
        }
      }
      if (isObject(raw.addresses)) {
        for (const [address, model] of Object.entries(raw.addresses)) {
          if (model === 'f1atb' || model === 'msunpv') data.addresses[address] = model;
        }
      }
      data.lastError = isObject(raw.lastError) ? raw.lastError : null;
      store.data = data;
    },
    /**
     * @description Forget everything.
     */
    reset() {
      store.data = EMPTY();
    },
    /**
     * @description Write the state (one write at a time).
     * @returns {Promise<void>}
     */
    save() {
      writing = writing.then(() => writeJson(path, store.data, logger));
      return writing;
    },
  };
  return store;
}

export { DEFAULT_DIR, FILE, createStore };
