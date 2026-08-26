/* live_game: last chance to restore the mounts before the battle reads specs. */
(function () {
  try {
    window.GwServerMods.hooks.install();
    window.GwServerMods.mount.run();
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})();
