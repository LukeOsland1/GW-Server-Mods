/* gw_play: mount before the battle is launched from the galaxy map. */
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  function patchLaunchFight() {
    if (!model || !_.isFunction(model.launchFight)) {
      return false;
    }

    if (model.launchFight[MARK]) {
      return true;
    }

    var previous = model.launchFight;

    model.launchFight = function () {
      var self = this;
      var args = arguments;

      return ns.mount.run().then(function () {
        return previous.apply(self, args);
      });
    };

    model.launchFight[MARK] = true;

    ns.log("launchFight patched");

    return true;
  }

  try {
    ns.hooks.install();

    if (!patchLaunchFight()) {
      ns.alarm("launch_unavailable", { where: "model.launchFight" });
    }
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})(window);
