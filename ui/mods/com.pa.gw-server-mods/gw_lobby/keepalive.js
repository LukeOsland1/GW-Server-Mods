/* gw_lobby: hold the mounts through co-op lobby setup. */
(function () {
  try {
    window.GwServerMods.hooks.install();
    window.GwServerMods.mount.run();
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})();
