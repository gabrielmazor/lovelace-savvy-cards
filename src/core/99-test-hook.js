// ---------------------------------------------------------------------------------------
// core/test-hook: test pages set window.__SAVVY_TEST__ before loading the bundle to reach
// core functions directly. Real dashboards never set it, so nothing is exposed there.
// ---------------------------------------------------------------------------------------
if (window.__SAVVY_TEST__) {
  window.__savvy = {
    Spring, Clock, MOTION, Motion, attr, text, put, place, norm, title, modeLook, MODE_DICTIONARY, colorOf,
    healthSummary, healthOptions, dismissStore, ensureDismissed, resetDismissed, dismissAdd, dismissRestore, isAdminUser, adminOnlyItems, hiddenFromUser, refreshConfigEntries, resetConfigEntries, areaEntities, houseEntities, pick, rankBy, entityArea, shortName, asItems,
    isActive, isOff, runAction, defaultTapAction, toggleEntity, bindPress, bindActions,
    duration, since, relativeTime, axisLabel, momentLabel, fmtNumber, withUnit, isTimestamp,
    fetchHistory, fetchRange, fetchAttributeHistory, resample, seriesStats, stateRuns, numericPoints, linePath,
    entityIcon, fallbackIcon, NEUTRAL_ICON, offLast, Sheet, EntityListSheet, SavvyEditor, defineEditor, S, version: SAVVY_VERSION,
    SettingsStore, SETTINGS_RULES, resolveSettings, findSettingsCards, normalizeSettings, countDefaults, dashboardPath, SavvyCard, roomBadges, roomTemperature, areaLights, houseLights, housePlaying, houseTemperature, houseSecurity, ignoring, sortRows, RowKit, SideBar, Seg, Stepper, LockSlide, aggregateHass, aggKinds, AGG_TARGET, ROW_KINDS, modeInfo, legacyBadges, chipState, portalRoot, navigate, samePage, securityAlertWord,
  };
}
