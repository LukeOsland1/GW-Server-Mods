/* live_game: hold the mounts for the running battle.
 *
 * No content remount here. The battle's models are already loaded by this
 * point, and rebuilding the catalogue underneath a running game blanks the
 * scene.
 */
(function () {
  try {
    window.GwServerMods.hooks.install();
    window.GwServerMods.mount.run({ remountContent: false });
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})();
