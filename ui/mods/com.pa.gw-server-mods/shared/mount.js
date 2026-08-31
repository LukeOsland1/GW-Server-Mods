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
  var runningWithContent = false;

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

  // The base game's own unit list, captured before anything shadows it.
  //
  // Every faction server mod ships pa/units/unit_list.json, and mountAtRoot puts
  // them all at "/", so from the first root mount onwards a read of that path
  // returns whichever faction mounted last. This mod is the only thing that
  // mounts at the root - Community Mods mounts under /server_mods/<id>/ and
  // /client_mods/<id>/ - so a read taken before the first mountAtRoot of the
  // process is the unshadowed base list, and it is worth keeping. There is no
  // pa_ex1 path to read instead: pa_ex1 is mounted onto pa before mods are.
  // See design.md.
  var VANILLA_KEY = "gw_server_mods_vanilla_units";
  var vanillaUnits;

  function loadVanillaUnits() {
    if (vanillaUnits) {
      return vanillaUnits;
    }

    try {
      var stored = JSON.parse(sessionStorage.getItem(VANILLA_KEY) || "null");
      if (_.isArray(stored)) {
        vanillaUnits = stored;
      }
    } catch (e) {
      vanillaUnits = undefined;
    }

    return vanillaUnits;
  }

  // Called before the first mount of a run, so the read still sees the base
  // game. Resolves either way: a base list that cannot be read costs four units
  // in one faction combination, and must never cost a battle.
  function captureVanillaUnits() {
    if (loadVanillaUnits()) {
      return $.Deferred().resolve(vanillaUnits).promise();
    }

    return readUnitList("coui://pa/units/unit_list.json").then(
      function (units) {
        if (!_.isArray(units)) {
          ns.log("base unit list not read");
          return undefined;
        }

        vanillaUnits = units;

        try {
          sessionStorage.setItem(VANILLA_KEY, JSON.stringify(units));
        } catch (e) {
          // In-memory only for the rest of this scene.
          ns.log("base unit list not persisted");
        }

        return units;
      }
    );
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

    // Every read is through coui://, never spec://: the engine caches a spec://
    // path after its first read, and the referee reads the merged list through
    // spec://, so a spec:// read here would pin the unmerged list for the whole
    // process. The base list comes from captureVanillaUnits rather than a read
    // taken now, which the root mounts would shadow. See design.md.
    var reads = [$.Deferred().resolve(loadVanillaUnits()).promise()].concat(
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

  // GWO's battle-preparation screen, when present. Resolved at call time:
  // GWO loads after this mod, and outside a launch the call is a no-op there.
  // See design.md.
  function report(key) {
    var progress = root.model && root.model.gwoLaunchProgress;

    if (!progress || !_.isFunction(progress.stage)) {
      return;
    }

    try {
      progress.stage(loc(key));
    } catch (e) {
      ns.log("progress report failed " + ((e && e.message) || e));
    }
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

  function settle(ok, mods) {
    state = {
      mounted: ok,
      at: Date.now(),
      mods: mods,
      sequence: state.sequence + 1,
    };

    ns.log("mounted server mods", { ok: ok, count: mods.length });
  }

  // gw_start has no Community Mods and no battle to prepare: only the root
  // mounts, so the mods' specs and images are readable there. See design.md.
  function mountRootOnly(mods, withContent, deferred) {
    var rootMounts = _.map(
      mods.concat(ns.manifest.pairedClientMods()),
      mountAtRoot
    );

    $.when.apply($, rootMounts).always(function () {
      var ok = !_.contains(_.toArray(arguments), false);

      $.when(withContent ? remountContent() : null).always(function () {
        settle(ok, mods);
        deferred.resolve(ok);
      });
    });
  }

  function mountForBattle(mods, withContent, deferred) {
    report("!LOC:Mounting server mods");

    var rootMounts = _.map(
      mods.concat(ns.manifest.pairedClientMods()),
      mountAtRoot
    );

    $.when.apply($, rootMounts).always(function () {
      $.when(CommunityModsManager.mountServerMods()).always(function () {
        if (withContent) {
          report("!LOC:Registering server mod content");
        }

        $.when(
          withContent ? remountContent() : null,
          mergeUnitList(mods),
          ns.manifest.detectClientRelevance(mods)
        ).always(function () {
          reportUnmountableMods();

          verify(mods).then(function (ok) {
            settle(ok, mods);
            deferred.resolve(ok);
          });
        });
      });
    });
  }

  // Repeatable: Galactic War tears the mounts down more than once per battle.
  // remountContent is false only for a running battle, where it blanks the scene.
  function runOnce(options) {
    var withContent = !options || options.remountContent !== false;
    var rootOnly = !!(options && options.rootOnly);
    var deferred = $.Deferred();

    if (!rootOnly && !ns.manifest.available()) {
      deferred.resolve(false);
      return deferred.promise();
    }

    if (!zipMountAvailable()) {
      ns.alarm("cmm_unavailable", { where: "api.file.zip.mount" });
      deferred.resolve(false);
      return deferred.promise();
    }

    ns.manifest.load().then(function () {
      var mods = ns.manifest.activeServerMods();

      ns.manifest.rememberScenes(mods);

      if (!mods.length) {
        settle(true, []);
        deferred.resolve(true);
        return;
      }

      // Before the first mountAtRoot, while the base list is still readable.
      captureVanillaUnits().always(function () {
        if (rootOnly) {
          mountRootOnly(mods, withContent, deferred);
        } else {
          mountForBattle(mods, withContent, deferred);
        }
      });
    });

    return deferred.promise();
  }

  // A single unmount reaches here through two wrappers, and a full cycle costs
  // seconds, so concurrent callers share one run. A caller that needs the
  // content remount is the exception: a run that skipped it leaves the models
  // unregistered, so sharing one would start the battle with every unit
  // invisible. That caller waits for the run in flight and then gets its own -
  // queued rather than started, since two runs must not overlap their mounts.
  function run(options) {
    var withContent = !options || options.remountContent !== false;

    if (running && (runningWithContent || !withContent)) {
      return running;
    }

    var previous = running;
    var current;

    if (previous) {
      var queued = $.Deferred();

      previous.always(function () {
        runOnce(options).always(function (ok) {
          queued.resolve(ok);
        });
      });

      current = queued.promise();
    } else {
      current = runOnce(options);
    }

    // A run with nothing to mount settles at once, so the clear can fire
    // before this function returns; neither the assignment nor the return
    // may come after it. The queued run supersedes the one it waits on, so
    // only the run still current may clear.
    running = current;
    runningWithContent = withContent;
    current.always(function () {
      if (running === current) {
        running = null;
      }
    });

    return current;
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
