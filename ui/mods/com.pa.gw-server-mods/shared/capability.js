/* What the host is running, for features that have to offer less without it.
 *
 * The answer is the required-mod list the host published for this game: on the
 * host its own, on a viewer the copy the server sent. Asking it about a server
 * mod identifier is unambiguous even though the list also holds client mods,
 * which is why no attempt is made to tell the two apart.
 *
 * Held in sessionStorage so it survives the scene changes between the lobby and
 * the battle, with an in-memory copy for when storage is unavailable.
 */
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.capability) {
    return;
  }

  var KEY = "gw_server_mods_host_identifiers";
  var cached = null;

  function empty() {
    return { identifiers: [], namesById: {}, versionsById: {} };
  }

  function read() {
    if (cached) {
      return cached;
    }

    try {
      cached = JSON.parse(sessionStorage.getItem(KEY) || "null") || empty();
    } catch (e) {
      cached = empty();
    }

    return cached;
  }

  function remember(identifiers, namesById, versionsById) {
    cached = {
      identifiers: _.map(identifiers || [], ns.manifest.normalizeIdentifier),
      namesById: namesById || {},
      versionsById: versionsById || {},
    };

    try {
      sessionStorage.setItem(KEY, JSON.stringify(cached));
    } catch (e) {
      // In-memory only for the rest of this scene.
      ns.log("host mod set not persisted");
    }

    return cached;
  }

  function forget() {
    cached = null;

    try {
      sessionStorage.removeItem(KEY);
    } catch (e) {
      // Nothing to do; the in-memory copy is already cleared.
    }
  }

  function hostHasServerMod(identifier) {
    var wanted = ns.manifest.normalizeIdentifier(identifier);

    return !!wanted.length && read().identifiers.indexOf(wanted) !== -1;
  }

  function hostServerMods() {
    var host = read();

    return _.map(host.identifiers, function (identifier) {
      return {
        identifier: identifier,
        displayName: host.namesById[identifier] || identifier,
        version: host.versionsById[identifier] || "",
      };
    });
  }

  ns.capability = {
    remember: remember,
    forget: forget,
  };

  ns.hostHasServerMod = hostHasServerMod;
  ns.hostServerMods = hostServerMods;
})(window);
