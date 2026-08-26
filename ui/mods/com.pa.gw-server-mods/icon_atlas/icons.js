/* Strategic icons for units the base game has never heard of.
 *
 * The atlas is built once, at startup: icon_atlas.js holds a hardcoded list of
 * names, mods extend it through this scene, and sendIconList() hands the result
 * to the engine. Nothing rebuilds it afterwards - a name pushed later is
 * accepted and ignored, which is why a modded unit shows the fallback dot.
 *
 * The icon files themselves are already there. A mod shipping strategic icons
 * shadows them into ui/main/atlas/icon_atlas/img/strategic_icons/, and client
 * mods are mounted before this scene runs. So the fix is not to mount anything,
 * it is to name every icon on disk rather than only the ones the base game
 * knows.
 *
 * Enumerating is async and the scene sends its list as soon as this file
 * returns, so sendIconList is wrapped rather than raced: the scene's own call
 * is what triggers the enumeration, and the list goes out once, complete.
 */
(function () {
  var ICON_DIR = "/ui/main/atlas/icon_atlas/img/strategic_icons/";
  var MARK = "__gwServerModsPatched";

  function nameOf(path) {
    return String(path)
      .replace(/^.*icon_si_/, "")
      .replace(/\.png$/i, "");
  }

  function addMissingIcons() {
    var deferred = $.Deferred();

    if (!api.file || !_.isFunction(api.file.list)) {
      deferred.resolve(0);
      return deferred.promise();
    }

    api.file.list(ICON_DIR, false).then(
      function (listing) {
        var files = listing && listing.length ? listing : _.keys(listing || {});
        var known = model.strategicIcons();
        var added = 0;

        _.forEach(files, function (file) {
          if (String(file).indexOf("icon_si_") === -1) {
            return;
          }

          var name = nameOf(file);

          if (name.length && known.indexOf(name) === -1) {
            model.strategicIcons.push(name);
            ++added;
          }
        });

        console.log("[GW-SM] strategic icons added=" + added);
        deferred.resolve(added);
      },
      function () {
        console.error("[GW-SM] could not list " + ICON_DIR);
        deferred.resolve(0);
      }
    );

    return deferred.promise();
  }

  function patchSendIconList() {
    if (!model || !_.isFunction(model.sendIconList)) {
      return false;
    }

    if (model.sendIconList[MARK]) {
      return true;
    }

    var previous = model.sendIconList;

    model.sendIconList = function () {
      var self = this;

      return addMissingIcons().always(function () {
        previous.call(self);
      });
    };

    model.sendIconList[MARK] = true;

    return true;
  }

  try {
    if (!patchSendIconList()) {
      console.error(
        "[GW-SM] sendIconList unavailable; modded icons will be dots"
      );
    }
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})();
