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
      // An unpacked mod has no zip to mount, so it can reach /server_mods/<id>/
      // but never the root the referee reads from.
      ns.alarm("filesystem_mod", { identifier: mod.identifier });
      deferred.resolve(false);
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

  function probe(path) {
    var deferred = $.Deferred();

    $.ajax({ url: path, dataType: "text", cache: false })
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
      checks.push(
        probe("coui://server_mods/" + mod.identifier + "/modinfo.json")
      );
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
   */
  function run() {
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

    return deferred.promise();
  }

  ns.mount = {
    run: run,
    state: function () {
      return state;
    },
  };
})(window);
