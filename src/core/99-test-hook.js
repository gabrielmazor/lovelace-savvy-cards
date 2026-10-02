// ---------------------------------------------------------------------------------------
// core/test-hook: test pages set window.__SAVVY_TEST__ before loading the bundle to reach
// core functions directly. Real dashboards never set it, so nothing is exposed there.
// ---------------------------------------------------------------------------------------
if (window.__SAVVY_TEST__) {
  window.__savvy = {
    Spring, Clock, MOTION, norm, title, modeLook, MODE_DICTIONARY, colorOf,
    healthSummary, healthOptions, refreshConfigEntries, resetConfigEntries, areaEntities, houseEntities, pick, rankBy, entityArea, shortName, asItems,
    isActive, isOff, runAction, defaultTapAction, toggleEntity, bindPress, bindActions,
    duration, since, relativeTime, axisLabel, momentLabel, fmtNumber, withUnit, isTimestamp,
    fetchHistory, fetchRange, fetchAttributeHistory, resample, seriesStats, stateRuns, numericPoints, linePath,
    Sheet, EntityListSheet, SavvyEditor, defineEditor, S, version: SAVVY_VERSION,
    roomBadges, roomTemperature, areaLights, houseLights, housePlaying, houseTemperature, houseSecurity, ignoring, sortRows, RowKit, SideBar, Seg, Stepper, LockTrack, ROW_KINDS, modeInfo, legacyBadges, chipState, portalRoot,
  };
}
