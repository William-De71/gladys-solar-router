# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-11-21

### Added

- **routers:** the F1ATB and MSunPV solar routers of the local network, through the pages of their own web interface: addresses typed in the configuration, the model recognised by its answers, each router known by its MAC address or serial number
- **devices:** the router (grid exchange in the grid-sensor category, drawn and exported energy indexes, routed power and energy with a second probe, solar production, temperatures, Wi-Fi signal) and one device per output (opening or power, forced on switch, mode, forcing time left, full-power hours)
- **control:** force an output on or off, or give it back to the router, from its switch, a widget button or a scene; an F1ATB counts the minutes down by itself
- **scenes:** triggers when a router stops answering, answers again, restarted, or when an F1ATB forcing ends by itself; actions to set the mode of an output and to get today's energy
- **widgets:** one router with its grid exchange, routed or produced power, today's energy, its outputs and buttons to force them; the power over the last 24 hours
- **configuration:** addresses, reading every 5, 10, 30 or 60 seconds, F1ATB forcing duration, language, "Search and test" and "Diagnostic" buttons
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-solar-router/releases/tag/v0.1.0
