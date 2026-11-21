# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the **F1ATB** (open firmware on
an ESP32, <https://f1atb.fr>) and **MSunPV** (Ard-Tek, models 2x2d and 4x4d)
solar routers: a Node.js service (Node 22+, ESM, no build step) in its own
sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to each router over HTTP on the local network,
through the pages the router's own web interface reads (F1ATB `/ajax_data`,
`/ajax_etatActions`, `/ajax_dataESP32`, `/ForceAction`; MSunPV `/status.xml`,
`POST /index.xml`). `type: "device"`, Gladys 5.3.0+, `transports: ["local"]`,
no `network_discovery` (neither router announces itself: the addresses are
typed). Not affiliated with F1ATB nor Ard-Tek.

**Never tested with a real router**: the F1ATB shapes come from the firmware
sources (<https://github.com/F1ATB/Solar-Router-F1ATB>, V17: `Server.ino`,
`Actions.cpp`, `Temperature.ino`, no license declared), the MSunPV ones from
the Home Assistant integration <https://github.com/pvergezac/MSunPVIntegration>
(MIT), both read for the facts only. None of their code is used.

## Commands

```bash
npm install
npm test                                  # node --test; fake F1ATB and MSunPV routers on a fake clock
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                 SDK wiring only (new GladysIntegration + createApp)
src/app.js               every handler; the timer, the recognition of each address (F1ATB then
                         MSunPV, remembered), devices and states, the commands (switch, widget
                         buttons, scene action), scene events, widgets, configuration buttons, status
src/router-api.js        HTTP client (node:http, no keep-alive, 10 s timeout): one queue per router,
                         GET and urlencoded POST, UTF-8 or latin1 answers
src/f1atb.js             the F1ATB pages (control-character separated text) and /ForceAction
src/msunpv.js            status.xml (tags, comma decimals, signed hex counters, command bits) and
                         the parS post
src/routers.js           one shape for both: snapshots merged into the stored router, the MSunPV
                         daily counters summed into indexes, the features seen, 24 h of 5-min points
src/device.js            the router device and one device per output, features and states
src/events.js            triggers (unreachable, back online, restarted, forcing ended), scene action keys
src/widgets.js           overview (with buttons), power over 24 hours
src/time.js              the timezone of Gladys (Intl only)
src/store.js             /data/solar-router.json (mode 0600)
src/config.js            addresses, interval, F1ATB forcing duration, language
src/i18n.js              helpers; src/i18n-texts.js the runtime texts, en / fr / de / es
test/helpers/fake-routers.js    the fake network (F1ATB pages like Server.ino, MSunPV status.xml and parS)
test/fixtures/discovery.baseline.json   the frozen devices and manifest keys
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: the router
  `ext:<selector>:router:<id>` (`<id>`: the 12 lowercase hexadecimal digits of
  the F1ATB MAC address, or the MSunPV serial number in lowercase), an output
  `ext:<selector>:output:<id>-a<n>` (action n of an F1ATB, 0 is the triac),
  `ext:<selector>:output:<id>-water_heater` and `…-heater` (MSunPV); features
  `…:<key>` with the keys of `FEATURES` in `src/device.js` (`grid_import_power`,
  `grid_export_power`, `grid_power`, `grid_import_index`, `grid_export_index`,
  `routed_power`, `routed_energy`, `pv_power`, `pv_energy`, `temperature_1`…`_4`,
  `temperature_water`, `temperature_bathroom`, `temperature_ambient`, `rssi`,
  `opening`, `power`, `energy`, `forced`, `mode`, `force_remaining`,
  `on_hours`); feature `category` / `type` / `unit` / `min` / `max`, the keys
  of `config_schema` and `actions`, `last_language`, widgets and settings, the
  widget action keys (`set_mode_<output>`), triggers (fields, variables), the
  scene actions (fields, options, outputs). `test/structure.test.js` compares
  them to `test/fixtures/discovery.baseline.json`: never update it to make a
  test pass without a documented migration.
- **Category pairs**: grid-sensor / input-power, output-power (W, ≥ 0, F1ATB),
  grid-sensor / power (W, signed, MSunPV: import > 0, export < 0), grid-sensor /
  input-index, output-index (kWh); energy-sensor / power, index (routed load,
  MSunPV 4x4d output); energy-production-sensor / power, index (MSunPV
  production); temperature-sensor / decimal (°C); signal / integer (dBm, no
  unit); switch / dimmer (opening 0–100, read only, no unit); switch / binary
  (`forced`, the only writable feature, `has_feedback`); text / text (mode);
  duration / integer (minutes) and decimal (hours). One grid form per router,
  never both (the core rule for grid-sensor).
- **Features appear once seen** (`router.present`): a second probe, a
  temperature probe, Wi-Fi rather than Ethernet; they then stay.
- **The pace.** A timer reads every typed address every 5, 10 (default), 30 or
  60 s. An address is recognised once (`/ajax_data` starting with `Deb` →
  F1ATB, else `/status.xml` → MSunPV) and remembered in the store; an address
  that is no router is left alone 30 minutes (or until **Search and test** /
  a scan). A command reads the router again at once.
- **One request at a time per router** (small boards that also regulate the
  power): the client queues them, no keep-alive, a short pause. Never in parallel.
- **MSunPV indexes** are summed by the integration from the daily counters:
  they start at 0 at the first reading; a counter lower than before is a
  midnight reset (all of it is added).
- **`should_poll` stays false**: the integration has its own timer.
- **Commands**: the `forced` switch (on → F1ATB `Force=+force_minutes`, MSunPV
  forced bit; off → automatic), the widget buttons, the `set_output_mode`
  scene action. A command marks the output for 3 intervals so its own change
  never fires `forcing_ended`.
- **Scene events** once per transition, never at the first reading of a
  router, never from a command: worked out after each reading round.
  Unreachable after 3 failed readings and at least a minute.
- **Names**: the router is offered as "Solar router F1ATB <hostname>" /
  "Solar router MSunPV 2x2d" (translated prefix), an output as "<title>
  (<router name>)"; the widgets and scenes use the name the user gave in
  Gladys (`getDevices`, refreshed on create / update / delete).
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, `src/i18n-texts.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted".
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- F1ATB answers are text split by ASCII control characters: GS `\x1d` (group),
  RS `\x1e` (record), US `\x1f` (unit), FS `\x1c` (file). `/ajax_data` starts
  with `Deb`, ends with `Fin`.
- `/ajax_data` gives the second probe ("T", the routed load) only with `UxIx2`
  or a single-phase Shelly with two probes; otherwise the group is `Fake`.
- A missing DS18B20 reads `-127`; the firmware ignores anything at or below
  `-50`, so does the integration.
- An Ethernet F1ATB sends a blank RSSI in `/ajax_dataESP32`; the MAC is field
  5, `ip US hostname US ipv6` field 7.
- `/ajax_etatActions` lists only the active actions; the triac (action 0) only
  when the router is synchronised on the mains. The state is `On` / `Off` for a
  relay in on/off mode, an opening percentage otherwise.
- `/ForceAction` is not protected by the access key of the F1ATB (unlike
  `/ajax_etatActions?Force`). `tOnOff` > 0 forced on, < 0 forced off, 0
  automatic; the firmware counts it down by one every minute.
- MSunPV `status.xml`: comma decimals, `;`-separated values, counters in
  signed 32-bit hexadecimal (tenths of Wh, the total in tenths of kWh, the
  exported and produced ones negative); PV power negative in `inAns`; outputs
  0..400 on a 2x2d (= 0..100 %), W on a 4x4d.
- MSunPV `cmdPos` command 0: bit 0 water heater forced, bit 1 automatic, bit 2
  radiator forced, bit 3 automatic; both bits cleared = off. Read the commands
  first, change only the bits of one output, post `parS` in **decimal**
  (`10;0;0;0;0;0;0;2;`).
- The MSunPV answers ISO-8859-1: the client falls back to latin1 when the
  answer is not valid UTF-8.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
