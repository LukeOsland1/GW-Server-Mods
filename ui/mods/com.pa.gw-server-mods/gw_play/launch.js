/* gw_play: mount before the battle is launched from the galaxy map.
 *
 * model.fight is the entry point a battle actually goes through, and the
 * referee generates unit specs from spec://pa/units/... shortly after, so the
 * mounts have to be in place by then. restartFight is the same trip taken
 * again after a defeat.
 */
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  function patchFight(name) {
    if (!model || !_.isFunction(model[name])) {
      return false;
    }

    if (model[name][MARK]) {
      return true;
    }

    var previous = model[name];

    model[name] = function () {
      var self = this;
      var args = arguments;

      return ns.mount.run().then(function () {
        return previous.apply(self, args);
      });
    };

    model[name][MARK] = true;

    ns.log(name + " patched");

    return true;
  }

  try {
    ns.hooks.install();

    // Ready before the player can click, not only once they have.
    ns.mount.run();

    var fight = patchFight("fight");
    var restart = patchFight("restartFight");

    if (!fight || !restart) {
      ns.alarm("launch_unavailable", { fight: fight, restartFight: restart });
    }
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})(window);
