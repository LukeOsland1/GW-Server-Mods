// Rebuilding the content catalogue under a running game blanks the scene.
(function () {
  try {
    window.GwServerMods.hooks.install({ remountContent: false });
    window.GwServerMods.mount.run({ remountContent: false });
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})();
