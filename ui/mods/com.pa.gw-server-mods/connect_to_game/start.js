// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  function isGwMode(mode) {
    return _.isString(mode) && mode.toLowerCase().indexOf("gw") !== -1;
  }

  function applyIdentifiers() {
    if (!model || !_.isFunction(model.gameModIdentifiers)) {
      return;
    }

    // This list goes back to the game, not to the gate, so case matters.
    var expected = ns.manifest.rawIdentifiers();

    if (!expected.length) {
      return;
    }

    model.gameModIdentifiers(
      _.uniq((model.gameModIdentifiers() || []).concat(expected))
    );

    var applied = model.gameModIdentifiers() || [];
    var lost = _.filter(expected, function (identifier) {
      return applied.indexOf(identifier) === -1;
    });

    if (lost.length) {
      // Something wrote over the list; the battle would start without its
      // server mods declared.
      ns.alarm("identifiers_lost", { expected: expected, applied: applied });
    }
  }

  function patchStartGame() {
    if (!api.net || !_.isFunction(api.net.startGame)) {
      return false;
    }

    if (api.net.startGame[MARK]) {
      return true;
    }

    var previous = api.net.startGame;

    api.net.startGame = function (region, mode, startParams) {
      if (root.gNoMods || !isGwMode(mode)) {
        return previous(region, mode, startParams);
      }

      var deferred = $.Deferred();

      ns.mount.run().always(function () {
        $.when(previous(region, mode, startParams)).then(
          function (data) {
            applyIdentifiers();
            deferred.resolve(data);
          },
          function (data) {
            deferred.reject(data);
          }
        );
      });

      return deferred.promise();
    };

    api.net.startGame[MARK] = true;

    ns.log("startGame patched");

    return true;
  }

  try {
    ns.hooks.install();

    if (!patchStartGame()) {
      ns.alarm("start_unavailable", { where: "api.net.startGame" });
    }
  } catch (e) {
    console.error("[GW-SM] " + ((e && (e.stack || e.message)) || e));
  }
})(window);
