// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.mount) {
    return;
  }

  var state = {
    mounted: false,
    at: 0,
    mods: [],
    sequence: 0,
  };

  var running = null;

  function zipMountAvailable() {
    return !!(api.file && api.file.zip && _.isFunction(api.file.zip.mount));
  }

  function mountAtRoot(mod) {
    var deferred = $.Deferred();

    // Nothing can mount a folder at the root: zip.mount rejects one and there is
    // no directory equivalent. Whether that matters is decided once the mod has
    // been classified, in reportUnmountableMods.
    if (mod.fileSystem) {
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

  // spec:// rejects a query string, so cache-busting it returns 404.
  // Mounting alone leaves models and textures unregistered with the renderer.
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

  // A folder-installed server mod the client has to render cannot be made
  // visible to it. An AI-only one is unaffected, so this waits for the
  // classification rather than warning about every folder mod.
  function reportUnmountableMods() {
    var stranded = _.filter(
      ns.manifest.clientRelevantServerMods(),
      function (mod) {
        return mod.fileSystem;
      }
    );

    _.forEach(stranded, function (mod) {
      ns.alarm("filesystem_server_mod", {
        identifier: mod.identifier,
        path: mod.installedPath,
      });
    });
  }

  function verify(mods) {
    var deferred = $.Deferred();
    var checks = [probe("coui://server_mods/mods.json")];

    _.forEach(mods, function (mod) {
      checks.push(probe("coui:/" + ns.manifest.modRoot(mod) + "modinfo.json"));
    });

    // The referee's own input.
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

  // Repeatable: Galactic War tears the mounts down more than once per battle.
  // remountContent is false only for a running battle, where it blanks the scene.
  function runOnce(options) {
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
      state = {
        mounted: true,
        at: Date.now(),
        mods: [],
        sequence: state.sequence + 1,
      };
      deferred.resolve(true);
      return deferred.promise();
    }

    var rootMounts = _.map(
      mods.concat(ns.manifest.pairedClientMods()),
      function (mod) {
        return mountAtRoot(mod);
      }
    );

    $.when.apply($, rootMounts).always(function () {
      $.when(CommunityModsManager.mountServerMods()).always(function () {
        $.when(
          withContent ? remountContent() : null,
          ns.manifest.detectClientRelevance(mods)
        ).always(function () {
          reportUnmountableMods();

          verify(mods).then(function (ok) {
            state = {
              mounted: ok,
              at: Date.now(),
              mods: mods,
              sequence: state.sequence + 1,
            };

            ns.log("mounted server mods", {
              ok: ok,
              count: mods.length,
            });

            deferred.resolve(ok);
          });
        });
      });
    });

    return deferred.promise();
  }

  // A single unmount reaches here through two wrappers, and a full cycle costs
  // seconds, so concurrent callers share one run.
  function run(options) {
    if (running) {
      return running;
    }

    running = runOnce(options).always(function () {
      running = null;
    });

    return running;
  }

  ns.mount = {
    run: run,
    sequence: function () {
      return state.sequence;
    },
    state: function () {
      return state;
    },
  };
})(window);
