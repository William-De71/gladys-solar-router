// -----------------------------------------------------------------------------
// Entry point of the solar router external integration.
//
// The F1ATB and MSunPV solar routers of the local network:
//   - devices: the router (grid exchange, indexes, routed power, production,
//     temperatures) and one device per output (opening or power, forced on
//     switch, mode), offered on the Discovery screen (src/device.js);
//   - scene triggers: unreachable, back online, restarted, forcing ended;
//   - scene actions: set the mode of an output, today's energy;
//   - dashboard widgets: overview (with buttons), power over 24 hours.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the solar router integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
