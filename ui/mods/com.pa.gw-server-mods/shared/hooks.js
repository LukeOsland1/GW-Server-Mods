// See design.md.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.hooks) {
    return;
  }

  var MARK = "__gwServerModsWrapped";

  function remountAfter(previous) {
    if (!_.isFunction(previous) || previous[MARK]) {
      return previous;
    }

    var wrapped = function () {
      var before = ns.mount.sequence();
      var result = previous.apply(this, arguments);

      return $.when(result).then(function () {
        // The inner wrapper may already have remounted during that call.
        if (ns.mount.sequence() !== before) {
          return true;
        }

        return ns.mount.run();
      });
    };

    wrapped[MARK] = true;

    return wrapped;
  }

  function installUnmountAccessor() {
    if (!api.file || !_.isFunction(api.file.unmountAllMemoryFiles)) {
      return false;
    }

    var current = api.file.unmountAllMemoryFiles;

    if (current[MARK]) {
      return true;
    }

    var wrapped = remountAfter(current);

    Object.defineProperty(api.file, "unmountAllMemoryFiles", {
      configurable: true,
      enumerable: true,
      get: function () {
        return wrapped;
      },
      set: function (fn) {
        wrapped = remountAfter(fn);
      },
    });

    ns.log("unmountAllMemoryFiles accessor installed");

    return true;
  }

  // Community Mods is absent from some scenes; there is no remount to survive.
  function installRemountClientMods() {
    var mgr = root.CommunityModsManager;

    if (!mgr) {
      return true;
    }

    if (!_.isFunction(mgr.remountClientMods)) {
      return false;
    }

    if (mgr.remountClientMods[MARK]) {
      return true;
    }

    // Assigned once at manager construction, so a plain wrapper is enough.
    mgr.remountClientMods = remountAfter(mgr.remountClientMods);

    ns.log("remountClientMods wrapped");

    return true;
  }

  function install() {
    var unmount = installUnmountAccessor();
    var remount = installRemountClientMods();

    if (!unmount || !remount) {
      ns.alarm("hooks_unavailable", { unmount: unmount, remount: remount });
    }

    return unmount && remount;
  }

  ns.hooks = {
    install: install,
  };
})(window);
