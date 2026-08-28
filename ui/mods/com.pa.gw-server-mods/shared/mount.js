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

  function readUnitList(url) {
    var deferred = $.Deferred();

    $.ajax({ url: url, dataType: "text", cache: url.indexOf("coui://") !== 0 })
      .done(function (data) {
        var parsed = data;

        if (_.isString(data)) {
          try {
            parsed = JSON.parse(data);
          } catch (e) {
            parsed = null;
          }
        }

        deferred.resolve(
          parsed && _.isArray(parsed.units) ? parsed.units : null
        );
      })
      .fail(function () {
        deferred.resolve(null);
      });

    return deferred.promise();
  }

  function reportUnmerged(detail, reason) {
    detail.reason = reason;

    if (detail.lists > 1) {
      ns.alarm("unit_list_unmerged", detail);
    } else {
      ns.log("unit list not merged", detail);
    }
  }

  // Every faction ships its own unit_list.json and the root mounts shadow each
  // other, so the referee would only see the last one. See design.md.
  function mergeUnitList(mods) {
    var deferred = $.Deferred();
    var mgr = CommunityModsManager;

    if (
      _.isFunction(mgr.mergeUnitServerMods) &&
      mgr.mergeUnitServerMods() === false
    ) {
      ns.log("unit list merge disabled by Community Mods");
      deferred.resolve();
      return deferred.promise();
    }

    // The root list is read through coui://, never spec://: the engine caches a
    // spec:// path after its first read, and the referee reads this one through
    // spec://, so a spec:// read here would pin the unmerged list for the whole
    // process. See design.md.
    var reads = [readUnitList("coui://pa/units/unit_list.json")].concat(
      _.map(
        _.filter(mods, function (mod) {
          return !mod.fileSystem;
        }),
        function (mod) {
          return readUnitList(
            "spec:/" + ns.manifest.modRoot(mod) + "pa/units/unit_list.json"
          );
        }
      )
    );

    $.when.apply($, reads).then(function () {
      var lists = _.toArray(arguments);
      var modLists = _.filter(lists.slice(1), _.isArray);

      if (!modLists.length) {
        deferred.resolve();
        return;
      }

      var merged = _.union.apply(_, [lists[0] || []].concat(modLists));
      var detail = { units: merged.length, lists: modLists.length };

      if (!api.file || !_.isFunction(api.file.mountMemoryFiles)) {
        reportUnmerged(detail, "mountMemoryFiles unavailable");
        deferred.resolve();
        return;
      }

      $.when(
        api.file.mountMemoryFiles({
          "/pa/units/unit_list.json": JSON.stringify({ units: merged }),
        })
      ).then(
        function () {
          ns.log("merged unit list", detail);
          deferred.resolve();
        },
        function (error) {
          reportUnmerged(detail, String(error));
          deferred.resolve();
        }
      );
    });

    return deferred.promise();
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
          mergeUnitList(mods),
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
