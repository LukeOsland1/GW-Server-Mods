/* Mounting the active server mods for a Galactic War battle.
 *
 * Two mounts per mod, and both are needed. Community Mods' own
 * mountServerMods() handles /server_mods/<id>/ plus the mods.json manifest the
 * server reads. The root mount is on top of that because Galactic War's referee
 * generates unit specs client side, reading spec://pa/units/... - and
 * /server_mods/<id>/ is not on that lookup path.
 */
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.mount) {
    return;
  }

  var state = {
    mounted: false,
    at: 0,
    mods: [],
  };

  function zipMountAvailable() {
    return !!(api.file && api.file.zip && _.isFunction(api.file.zip.mount));
  }

  function mountAtRoot(mod) {
    var deferred = $.Deferred();

    if (mod.fileSystem) {
      // An unpacked mod has no zip to mount, and does not need one: the game
      // already exposes server_mods folders at the root.
      ns.log("unpacked server mod, no zip mount needed", {
        identifier: mod.identifier,
      });
      deferred.resolve(true);
      return deferred.promise();
    }

    if (!_.isString(mod.installedPath) || !mod.installedPath.length) {
      ns.alarm("zip_missing", { identifier: mod.identifier });
      deferred.resolve(false);
      return deferred.promise();
    }

    api.file.zip.mount(mod.installedPath, "/", false).then(
      function (ok) {
        if (!ok) {
          ns.alarm("mount_failed", {
            identifier: mod.identifier,
            path: mod.installedPath,
          });
        }
        deferred.resolve(!!ok);
      },
      function () {
        ns.alarm("mount_failed", {
          identifier: mod.identifier,
          path: mod.installedPath,
        });
        deferred.resolve(false);
      }
    );

    return deferred.promise();
  }

  /* spec:// rejects a query string, so jQuery's cache-busting parameter turns
   * every spec probe into a 404. Only coui:// gets cache-busted.
   */
  /* Mounting makes files readable; it does not register models and textures
   * with the renderer. Without this a unit resolves every spec and renders as
   * nothing at all. Community Mods does the same after mounting client zips.
   */
  function remountContent() {
    if (!api.content || !_.isFunction(api.content.remount)) {
      ns.alarm("content_remount_unavailable", {});
      return $.Deferred().resolve().promise();
    }

    return api.content.remount();
  }

  function probe(path) {
    var deferred = $.Deferred();
    var bustable = path.indexOf("coui://") === 0;

    $.ajax({ url: path, dataType: "text", cache: !bustable })
      .done(function () {
        deferred.resolve(true);
      })
      .fail(function () {
        deferred.resolve(false);
      });

    return deferred.promise();
  }

  function verify(mods) {
    var deferred = $.Deferred();
    var checks = [probe("coui://server_mods/mods.json")];

    _.forEach(mods, function (mod) {
      // An unpacked mod keeps the folder name it was installed under, which is
      // not necessarily its identifier.
      var root = mod.fileSystem
        ? mod.installedPath
        : "/server_mods/" + mod.identifier + "/";

      checks.push(probe("coui:/" + root + "modinfo.json"));
    });

    // The referee's own input. If this cannot be read there is no point going on.
    checks.push(probe("spec://pa/units/unit_list.json"));

    $.when.apply($, checks).then(function () {
      var results = _.toArray(arguments);
      var ok = !_.contains(results, false);

      if (!ok) {
        ns.alarm("probe_failed", {
          manifest: results[0],
          mods: results.slice(1, results.length - 1),
          unitList: results[results.length - 1],
        });
      }

      deferred.resolve(ok);
    });

    return deferred.promise();
  }

  /* Mount every active server mod. Safe to call repeatedly - Galactic War tears
   * mounts down more than once per battle, so this runs again each time.
   *
   * options.remountContent rebuilds the renderer's catalogue afterwards, which
   * every caller wants except one: doing it during a running battle blanks the
   * scene, and by then it is too late to help anyway.
   */
  function run(options) {
    var withContent = !options || options.remountContent !== false;
    var deferred = $.Deferred();

    if (!ns.manifest.available()) {
      deferred.resolve(false);
      return deferred.promise();
    }

    if (!zipMountAvailable()) {
      ns.alarm("cmm_unavailable", { where: "api.file.zip.mount" });
      deferred.resolve(false);
      return deferred.promise();
    }

    var mods = ns.manifest.activeServerMods();

    if (!mods.length) {
      state = { mounted: true, at: Date.now(), mods: [] };
      deferred.resolve(true);
      return deferred.promise();
    }

    var rootMounts = _.map(mods, function (mod) {
      return mountAtRoot(mod);
    });

    $.when.apply($, rootMounts).always(function () {
      $.when(CommunityModsManager.mountServerMods()).always(function () {
        $.when(withContent ? remountContent() : null).always(function () {
          verify(mods).then(function (ok) {
            state = {
              mounted: ok,
              at: Date.now(),
              mods: mods,
            };

            ns.log("mounted server mods", {
              ok: ok,
              identifiers: ns.manifest.identifiers(),
            });

            deferred.resolve(ok);
          });
        });
      });
    });

    return deferred.promise();
  }

  ns.mount = {
    run: run,
    state: function () {
      return state;
    },
  };
})(window);
