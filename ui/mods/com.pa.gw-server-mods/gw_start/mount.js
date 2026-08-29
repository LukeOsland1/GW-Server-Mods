/* gw_start: root mounts only, so a mod's commanders can be shown before a war
   exists. Community Mods is absent here; see design.md. */
(function () {
  try {
    window.GwServerMods.mount.run({ rootOnly: true });
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
