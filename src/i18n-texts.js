// -----------------------------------------------------------------------------
// Runtime texts in English, French, German ("du") and Spanish ("usted").
// `{name}` placeholders are filled by t() (i18n.js).
// -----------------------------------------------------------------------------

const TEXTS = {
  // --- Time ----------------------------------------------------------------------------
  never: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: { en: '{n} d ago', fr: 'il y a {n} j', de: 'vor {n} T.', es: 'hace {n} d' },
  minutesLeft: {
    en: '{n} min left',
    fr: 'encore {n} min',
    de: 'noch {n} Min.',
    es: 'quedan {n} min',
  },

  // --- Devices -------------------------------------------------------------------------
  routerPrefix: {
    en: 'Solar router',
    fr: 'Routeur solaire',
    de: 'Solarrouter',
    es: 'Router solar',
  },
  output_water_heater: {
    en: 'Water heater',
    fr: 'Chauffe-eau',
    de: 'Warmwasserspeicher',
    es: 'Termo eléctrico',
  },
  output_heater: { en: 'Radiator', fr: 'Radiateur', de: 'Heizkörper', es: 'Radiador' },
  feature_grid_import_power: {
    en: 'Power drawn from the grid',
    fr: 'Puissance soutirée au réseau',
    de: 'Bezug aus dem Netz',
    es: 'Potencia consumida de la red',
  },
  feature_grid_export_power: {
    en: 'Power sent to the grid',
    fr: 'Puissance injectée sur le réseau',
    de: 'Einspeisung ins Netz',
    es: 'Potencia vertida a la red',
  },
  feature_grid_power: {
    en: 'Grid exchange',
    fr: 'Échange avec le réseau',
    de: 'Netzaustausch',
    es: 'Intercambio con la red',
  },
  feature_grid_import_index: {
    en: 'Energy drawn from the grid',
    fr: 'Énergie soutirée',
    de: 'Bezogene Energie',
    es: 'Energía consumida de la red',
  },
  feature_grid_export_index: {
    en: 'Energy sent to the grid',
    fr: 'Énergie injectée',
    de: 'Eingespeiste Energie',
    es: 'Energía vertida a la red',
  },
  feature_routed_power: {
    en: 'Routed power',
    fr: 'Puissance routée',
    de: 'Umgeleitete Leistung',
    es: 'Potencia derivada',
  },
  feature_routed_energy: {
    en: 'Routed energy',
    fr: 'Énergie routée',
    de: 'Umgeleitete Energie',
    es: 'Energía derivada',
  },
  feature_pv_power: {
    en: 'Solar production',
    fr: 'Production solaire',
    de: 'Solarerzeugung',
    es: 'Producción solar',
  },
  feature_pv_energy: {
    en: 'Energy produced',
    fr: 'Énergie produite',
    de: 'Erzeugte Energie',
    es: 'Energía producida',
  },
  feature_temperature_1: {
    en: 'Temperature 1',
    fr: 'Température 1',
    de: 'Temperatur 1',
    es: 'Temperatura 1',
  },
  feature_temperature_2: {
    en: 'Temperature 2',
    fr: 'Température 2',
    de: 'Temperatur 2',
    es: 'Temperatura 2',
  },
  feature_temperature_3: {
    en: 'Temperature 3',
    fr: 'Température 3',
    de: 'Temperatur 3',
    es: 'Temperatura 3',
  },
  feature_temperature_4: {
    en: 'Temperature 4',
    fr: 'Température 4',
    de: 'Temperatur 4',
    es: 'Temperatura 4',
  },
  feature_temperature_water: {
    en: 'Water heater temperature',
    fr: 'Température du ballon',
    de: 'Speichertemperatur',
    es: 'Temperatura del termo',
  },
  feature_temperature_bathroom: {
    en: 'Bathroom temperature',
    fr: 'Température salle de bains',
    de: 'Badtemperatur',
    es: 'Temperatura del baño',
  },
  feature_temperature_ambient: {
    en: 'Ambient temperature',
    fr: 'Température ambiante',
    de: 'Raumtemperatur',
    es: 'Temperatura ambiente',
  },
  feature_rssi: { en: 'Wi-Fi signal', fr: 'Signal Wi-Fi', de: 'WLAN-Signal', es: 'Señal Wi-Fi' },
  feature_opening: { en: 'Opening', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  feature_power: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  feature_energy: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },
  feature_forced: {
    en: 'Forced on',
    fr: 'Marche forcée',
    de: 'Zwangsbetrieb',
    es: 'Marcha forzada',
  },
  feature_mode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  feature_force_remaining: {
    en: 'Forcing time left',
    fr: 'Forçage restant',
    de: 'Restzeit Zwangsbetrieb',
    es: 'Tiempo de forzado restante',
  },
  feature_on_hours: {
    en: 'Full-power hours today',
    fr: 'Heures pleine puissance du jour',
    de: 'Volllaststunden heute',
    es: 'Horas a plena potencia hoy',
  },
  mode_auto: { en: 'Automatic', fr: 'Automatique', de: 'Automatik', es: 'Automático' },
  mode_forced_on: {
    en: 'Forced on',
    fr: 'Marche forcée',
    de: 'Zwangsbetrieb',
    es: 'Marcha forzada',
  },
  mode_forced_off: {
    en: 'Forced off',
    fr: 'Arrêt forcé',
    de: 'Zwangsabschaltung',
    es: 'Parada forzada',
  },
  mode_off: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },

  // --- Widgets -------------------------------------------------------------------------
  tileImport: { en: 'Drawing', fr: 'Soutirage', de: 'Bezug', es: 'Consumo de red' },
  tileExport: { en: 'Exporting', fr: 'Injection', de: 'Einspeisung', es: 'Vertido' },
  tileGrid: { en: 'Grid', fr: 'Réseau', de: 'Netz', es: 'Red' },
  tileProduction: { en: 'Production', fr: 'Production', de: 'Erzeugung', es: 'Producción' },
  tileRouted: { en: 'Routed', fr: 'Routé', de: 'Umgeleitet', es: 'Derivado' },
  tileExportedToday: {
    en: 'Exported today',
    fr: 'Injecté ce jour',
    de: 'Heute eingespeist',
    es: 'Vertido hoy',
  },
  tileRoutedToday: {
    en: 'Routed today',
    fr: 'Routé ce jour',
    de: 'Heute umgeleitet',
    es: 'Derivado hoy',
  },
  rowState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  stateUnreachable: {
    en: 'Not answering',
    fr: 'Ne répond plus',
    de: 'Antwortet nicht',
    es: 'No responde',
  },
  rowLastReading: {
    en: 'Last reading',
    fr: 'Dernière lecture',
    de: 'Letzte Abfrage',
    es: 'Última lectura',
  },
  buttonForce: { en: 'Force {name}', fr: 'Forcer {name}', de: '{name} an', es: 'Forzar {name}' },
  buttonAuto: { en: 'Auto {name}', fr: 'Auto {name}', de: '{name} Auto', es: 'Auto {name}' },
  chartPowerDay: {
    en: 'Power over 24 hours',
    fr: 'Puissance sur 24 heures',
    de: 'Leistung über 24 Stunden',
    es: 'Potencia en 24 horas',
  },
  widgetNoHistory: {
    en: 'The chart fills in as the router is read.',
    fr: 'Le graphique se remplit au fil des lectures.',
    de: 'Das Diagramm füllt sich mit den Abfragen.',
    es: 'El gráfico se completa con las lecturas.',
  },
  widgetDown: {
    en: 'The router is not answering: the values are those of the last reading.',
    fr: 'Le routeur ne répond plus : les valeurs sont celles de la dernière lecture.',
    de: 'Der Router antwortet nicht: Die Werte stammen von der letzten Abfrage.',
    es: 'El router no responde: los valores son los de la última lectura.',
  },
  toastMode: {
    en: '{name}: {mode}.',
    fr: '{name} : {mode}.',
    de: '{name}: {mode}.',
    es: '{name}: {mode}.',
  },

  // --- Status and errors ---------------------------------------------------------------
  statusNoHosts: {
    en: 'Type the address of your solar router in the configuration.',
    fr: 'Saisissez l’adresse de votre routeur solaire dans la configuration.',
    de: 'Gib die Adresse deines Solarrouters in der Konfiguration ein.',
    es: 'Introduzca la dirección de su router solar en la configuración.',
  },
  statusNoRouter: {
    en: 'No solar router answers at the addresses typed.',
    fr: 'Aucun routeur solaire ne répond aux adresses saisies.',
    de: 'Unter den eingegebenen Adressen antwortet kein Solarrouter.',
    es: 'Ningún router solar responde en las direcciones introducidas.',
  },
  statusOk: {
    en: '{count} router(s) read: {names}.',
    fr: '{count} routeur(s) lu(s) : {names}.',
    de: '{count} Router gelesen: {names}.',
    es: '{count} router(s) leído(s): {names}.',
  },
  statusSomeDown: {
    en: 'Not answering: {names}.',
    fr: 'Ne répond plus : {names}.',
    de: 'Antwortet nicht: {names}.',
    es: 'No responde: {names}.',
  },
  statusDown: {
    en: 'The routers are not answering: {names}.',
    fr: 'Les routeurs ne répondent plus : {names}.',
    de: 'Die Router antworten nicht: {names}.',
    es: 'Los routers no responden: {names}.',
  },
  errUnreachable: {
    en: 'No answer from {address}: check the address and that the router is on.',
    fr: 'Pas de réponse de {address} : vérifiez l’adresse et que le routeur est allumé.',
    de: 'Keine Antwort von {address}: Prüfe die Adresse und ob der Router eingeschaltet ist.',
    es: 'Sin respuesta de {address}: compruebe la dirección y que el router esté encendido.',
  },
  errNotRouter: {
    en: '{address} answers, but it is neither an F1ATB nor an MSunPV router.',
    fr: '{address} répond, mais ce n’est ni un routeur F1ATB ni un MSunPV.',
    de: '{address} antwortet, ist aber weder ein F1ATB- noch ein MSunPV-Router.',
    es: '{address} responde, pero no es un router F1ATB ni MSunPV.',
  },
  errFailed: {
    en: 'The router did not do it: {detail}',
    fr: 'Le routeur ne l’a pas fait : {detail}',
    de: 'Der Router hat es nicht ausgeführt: {detail}',
    es: 'El router no lo ha hecho: {detail}',
  },
  errNoRouter: {
    en: 'No solar router known yet.',
    fr: 'Aucun routeur solaire connu pour l’instant.',
    de: 'Noch kein Solarrouter bekannt.',
    es: 'Todavía no se conoce ningún router solar.',
  },
  errNoOutput: {
    en: 'Choose an output of a solar router (a load, not the router itself).',
    fr: 'Choisissez une sortie d’un routeur solaire (une charge, pas le routeur lui-même).',
    de: 'Wähle einen Ausgang eines Solarrouters (einen Verbraucher, nicht den Router selbst).',
    es: 'Elija una salida de un router solar (una carga, no el propio router).',
  },
  errDown: {
    en: '{name} is not answering.',
    fr: '{name} ne répond plus.',
    de: '{name} antwortet nicht.',
    es: '{name} no responde.',
  },
  searchOk: {
    en: '{count} router(s) found: {names}. Their devices are on the Discover screen.',
    fr: '{count} routeur(s) trouvé(s) : {names}. Leurs appareils sont dans l’écran Découverte.',
    de: '{count} Router gefunden: {names}. Ihre Geräte stehen im Bildschirm Entdecken.',
    es: '{count} router(s) encontrado(s): {names}. Sus dispositivos están en la pantalla Descubrir.',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the logs ({count} line(s)).',
    fr: 'Diagnostic écrit dans les journaux ({count} ligne(s)).',
    de: 'Diagnose in die Protokolle geschrieben ({count} Zeile(n)).',
    es: 'Diagnóstico escrito en los registros ({count} línea(s)).',
  },

  // --- Scenes --------------------------------------------------------------------------
  event_router_unreachable: {
    en: '{name} is not answering any more.',
    fr: '{name} ne répond plus.',
    de: '{name} antwortet nicht mehr.',
    es: '{name} ya no responde.',
  },
  event_router_back_online: {
    en: '{name} answers again.',
    fr: '{name} répond de nouveau.',
    de: '{name} antwortet wieder.',
    es: '{name} vuelve a responder.',
  },
  event_router_restarted: {
    en: '{name} restarted.',
    fr: '{name} a redémarré.',
    de: '{name} wurde neu gestartet.',
    es: '{name} se ha reiniciado.',
  },
  event_forcing_ended: {
    en: '{name}: the forcing ended, the router decides again.',
    fr: '{name} : le forçage est terminé, le routeur reprend la main.',
    de: '{name}: Der Zwangsbetrieb ist beendet, der Router regelt wieder.',
    es: '{name}: el forzado ha terminado, el router vuelve a decidir.',
  },
  summarySetMode: {
    en: '{name}: {mode}.',
    fr: '{name} : {mode}.',
    de: '{name}: {mode}.',
    es: '{name}: {mode}.',
  },
  summarySetModeFor: {
    en: '{name}: {mode} for {minutes} min.',
    fr: '{name} : {mode} pendant {minutes} min.',
    de: '{name}: {mode} für {minutes} Min.',
    es: '{name}: {mode} durante {minutes} min.',
  },
  summaryToday: {
    en: '{name} today: {imported} kWh drawn, {exported} kWh exported{extra}.',
    fr: '{name} aujourd’hui : {imported} kWh soutirés, {exported} kWh injectés{extra}.',
    de: '{name} heute: {imported} kWh bezogen, {exported} kWh eingespeist{extra}.',
    es: '{name} hoy: {imported} kWh consumidos de la red, {exported} kWh vertidos{extra}.',
  },
  summaryRouted: {
    en: ', {kwh} kWh routed',
    fr: ', {kwh} kWh routés',
    de: ', {kwh} kWh umgeleitet',
    es: ', {kwh} kWh derivados',
  },
  summaryProduced: {
    en: ', {kwh} kWh produced',
    fr: ', {kwh} kWh produits',
    de: ', {kwh} kWh erzeugt',
    es: ', {kwh} kWh producidos',
  },
};

export { TEXTS };
