// -----------------------------------------------------------------------------
// Configuration of the solar router integration.
//
// Fields of the config_schema:
//   - `hosts`          the addresses of the routers (IP or name, optionally
//                      `:port`), comma separated: neither router announces
//                      itself on the network, so they are typed in. Each one
//                      is recognised by its answers (F1ATB or MSunPV);
//   - `interval`       how often the routers are read: 5, 10 (default), 30 or 60 s;
//   - `force_minutes`  how long the "forced" switch of an F1ATB output forces
//                      it on (1 to 1440 minutes, 60 by default; an MSunPV
//                      stays forced until switched back);
//   - `language`       language of the texts Gladys does not ask for in a
//                      language (feature names, modes, scene texts): `auto`
//                      follows the language of the last widget, or the timezone.
//
// Internal key, outside the config_schema (never shown in the UI):
//   - `last_language` language of the last widget request.
// -----------------------------------------------------------------------------

import { isLanguage } from './i18n.js';
import { MAX_FORCE_MINUTES } from './f1atb.js';

const AUTO_LANGUAGE = 'auto';
const INTERNAL_KEYS = { language: 'last_language' };
const INTERVALS = [5, 10, 30, 60];
const DEFAULT_INTERVAL = 10;
const DEFAULT_FORCE_MINUTES = 60;
const MAX_HOSTS = 10;

const readString = (raw) =>
  typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';

/**
 * @description The addresses typed in the configuration.
 * @param {unknown} value - "192.168.1.30, routeur.local:8080".
 * @returns {string[]} The addresses, without duplicates.
 */
function parseHosts(value) {
  const list = String(value ?? '')
    .split(/[\s,;]+/)
    .map((entry) =>
      entry
        .trim()
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, ''),
    )
    .filter((entry) => /^[A-Za-z0-9.:[\]_-]{1,253}$/.test(entry));
  return [...new Set(list.map((entry) => entry.toLowerCase()))].slice(0, MAX_HOSTS);
}

/**
 * @description Normalize the raw config object from the host API.
 * @param {object} [rawConfig] - The raw config values.
 * @returns {object} `{ hosts, interval, forceMinutes, language }`.
 * @example
 * normalizeConfig({ hosts: '192.168.1.30', interval: '5' }); // interval 5
 */
function normalizeConfig(rawConfig = {}) {
  const config = rawConfig ?? {};
  const interval = Number(readString(config.interval));
  const minutes = Math.round(Number(readString(config.force_minutes)));
  return {
    hosts: parseHosts(config.hosts),
    interval: INTERVALS.includes(interval) ? interval : DEFAULT_INTERVAL,
    forceMinutes:
      Number.isFinite(minutes) && minutes >= 1
        ? Math.min(MAX_FORCE_MINUTES, minutes)
        : DEFAULT_FORCE_MINUTES,
    language: isLanguage(config.language) ? config.language : AUTO_LANGUAGE,
  };
}

// The timezones of the countries that speak the languages of the integration:
// the automatic language before any widget was shown.
const TIMEZONE_LANGUAGES = {
  fr: [
    'Europe/Paris',
    'Europe/Monaco',
    'Europe/Brussels',
    'Europe/Luxembourg',
    'Indian/Reunion',
    'Indian/Mayotte',
    'America/Guadeloupe',
    'America/Martinique',
    'America/Cayenne',
    'America/Miquelon',
    'Pacific/Noumea',
    'Pacific/Tahiti',
    'America/Montreal',
    'Africa/Abidjan',
    'Africa/Dakar',
    'Africa/Casablanca',
    'Africa/Algiers',
    'Africa/Tunis',
  ],
  de: ['Europe/Berlin', 'Europe/Busingen', 'Europe/Vienna', 'Europe/Zurich', 'Europe/Vaduz'],
  es: [
    'Europe/Madrid',
    'Atlantic/Canary',
    'Africa/Ceuta',
    'America/Mexico_City',
    'America/Bogota',
    'America/Lima',
    'America/Santiago',
    'America/Caracas',
    'America/Montevideo',
    'America/Asuncion',
    'America/La_Paz',
    'America/Guayaquil',
    'America/Havana',
    'America/Costa_Rica',
    'America/Panama',
  ],
};

/**
 * @description The language of the texts guessed from a timezone, before
 * any widget was shown.
 * @param {string} timezone - IANA timezone of Gladys.
 * @returns {string} en, fr, de or es.
 * @example
 * guessLanguage('Europe/Paris'); // -> 'fr'
 */
function guessLanguage(timezone) {
  const zone = String(timezone ?? '');
  if (zone.startsWith('America/Argentina/')) {
    return 'es';
  }
  const found = Object.entries(TIMEZONE_LANGUAGES).find(([, zones]) => zones.includes(zone));
  return found ? found[0] : 'en';
}

/**
 * @description Read the stored language of the last widget request.
 * @param {object} [rawConfig] - The raw config values.
 * @param {string} fallback - The language to keep when nothing valid is stored.
 * @returns {string} The language.
 */
function readLanguage(rawConfig, fallback) {
  const language = (rawConfig ?? {})[INTERNAL_KEYS.language];
  return isLanguage(language) ? language : fallback;
}

export {
  AUTO_LANGUAGE,
  INTERNAL_KEYS,
  INTERVALS,
  DEFAULT_INTERVAL,
  DEFAULT_FORCE_MINUTES,
  MAX_HOSTS,
  parseHosts,
  normalizeConfig,
  guessLanguage,
  readLanguage,
};
