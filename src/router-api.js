// -----------------------------------------------------------------------------
// HTTP client of a solar router on the local network.
//
// Both routers are small web servers (an ESP32 for the F1ATB, the Wi-Fi board
// of the MSunPV) with no authentication on the pages this integration uses:
//   F1ATB  GET /ajax_data, /ajax_etatActions, /ajax_dataESP32, /ForceAction?…
//   MSunPV GET /status.xml, POST /index.xml (parS=…)
// One request at a time per router (a queue), no keep-alive, a 10-second
// timeout, a short pause between requests: these boards serve their own web
// page and regulate the power every few hundred milliseconds.
// -----------------------------------------------------------------------------

import http from 'node:http';

const TIMEOUT_MS = 10000;
const SPACING_MS = 100;
const MAX_BODY = 256 * 1024;

/**
 * @description An error of a router.
 */
class RouterError extends Error {
  /**
   * @param {string} kind - `unreachable` (no answer, timeout), `http` (a
   * status other than 200), `invalid` (not the answer of a known router).
   * @param {string} message - What went wrong.
   * @param {object} [extra] - `{ status }`.
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'RouterError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/**
 * @description One HTTP request with node:http, without keep-alive.
 * @param {object} options - `{ host, port, method, path, headers, body, timeout }`.
 * @returns {Promise<{ status: number, body: string }>} The answer (latin1 kept as is).
 */
function httpRequest({ host, port, method = 'GET', path, headers = {}, body, timeout }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host, port, path, method, headers, agent: false, timeout },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY) {
            request.destroy(new Error('answer too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // The F1ATB answers UTF-8, the MSunPV ISO-8859-1: decode UTF-8 when
          // it is valid, latin1 otherwise (the names of the outputs).
          const text = buffer.toString('utf8');
          resolve({
            status: response.statusCode,
            body: text.includes('�') ? buffer.toString('latin1') : text,
          });
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

/**
 * @description Split "192.168.1.20", "routeur.local:8080" or "[fe80::1]:80".
 * @param {string} address - The address.
 * @returns {{ host: string, port: number }} The host and the port (80 by default).
 */
function splitAddress(address) {
  const text = String(address ?? '').trim();
  const bracket = text.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracket) {
    return { host: bracket[1], port: Number(bracket[2] ?? 80) };
  }
  const colon = text.match(/^([^:]+):(\d+)$/);
  if (colon) {
    return { host: colon[1], port: Number(colon[2]) };
  }
  return { host: text, port: 80 };
}

/**
 * @description The client of one router address.
 * @param {object} options - Options.
 * @param {string} options.address - IP address or name (optionally `:port`).
 * @param {Function} [options.request] - Transport (tests): `({ host, port, method, path, headers, body, timeout }) => answer`.
 * @param {Function} [options.sleep] - `(ms) => Promise` (tests).
 * @returns {object} `{ address, get, postForm, counts }`.
 */
function createRouterClient({ address, request = httpRequest, sleep }) {
  const { host, port } = splitAddress(address);
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let queue = Promise.resolve();
  const counts = { requests: 0, failures: 0 };

  /**
   * @description One request, queued behind the others to this router.
   * @param {object} options - `{ method, path, headers, body }`.
   * @returns {Promise<string>} The body of a 200 answer.
   */
  function send({ method = 'GET', path, headers = {}, body }) {
    const run = queue.then(async () => {
      counts.requests += 1;
      try {
        let answer;
        try {
          answer = await request({
            host,
            port,
            method,
            path,
            headers: { Connection: 'close', ...headers },
            body,
            timeout: TIMEOUT_MS,
          });
        } catch (err) {
          counts.failures += 1;
          throw new RouterError('unreachable', `${address}: ${err.message}`);
        }
        if (answer.status !== 200) {
          counts.failures += 1;
          throw new RouterError('http', `${address}${path}: HTTP ${answer.status}`, {
            status: answer.status,
          });
        }
        return String(answer.body ?? '');
      } finally {
        await wait(SPACING_MS);
      }
    });
    // A failure never blocks the next request.
    queue = run.catch(() => {});
    return run;
  }

  return {
    address,
    host,
    port,
    /**
     * @description A GET.
     * @param {string} path - The path and query.
     * @returns {Promise<string>} The body.
     */
    get: (path) => send({ path }),
    /**
     * @description A POST of an urlencoded form.
     * @param {string} path - The path.
     * @param {object} fields - The fields.
     * @returns {Promise<string>} The body.
     */
    postForm: (path, fields) => {
      const body = new URLSearchParams(fields).toString();
      return send({
        method: 'POST',
        path,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        body,
      });
    },
    counts: () => ({ ...counts }),
  };
}

export { RouterError, TIMEOUT_MS, SPACING_MS, httpRequest, splitAddress, createRouterClient };
