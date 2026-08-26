/* Server mods in the base game's co-op required-mod check.
 *
 * Galactic War co-op already validates client mods host-first: the host sends
 * set_required_client_mods, each viewer answers with client_mod_manifest, and
 * the server compares the two. That comparison is set and version matching on
 * opaque identifier strings - it does not care whether an identifier names a
 * client mod or a server mod - so server mods can join it, and a mismatch then
 * lands on the mod mismatch screen the game already has.
 *
 * The payloads are augmented at send_message rather than by reimplementing the
 * functions that build them, which keeps the base game's own logic intact.
 */
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});
  var MARK = "__gwServerModsPatched";

  var REQUIRED = "set_required_client_mods";
  var MANIFEST = "client_mod_manifest";

  // What the host published, as this client last saw it. Empty until the server
  // asks for a manifest, which it does once the host has published.
  var hostRequired = [];

  function addHostServerMods(payload) {
    var mods = ns.manifest.activeServerMods();

    if (!mods.length) {
      return payload;
    }

    var identifiers = _.isArray(payload.required_identifiers)
      ? payload.required_identifiers.slice()
      : [];
    var names = _.assign({}, payload.required_names_by_id);
    var versions = _.assign({}, payload.required_versions_by_id);

    _.forEach(mods, function (mod) {
      if (identifiers.indexOf(mod.identifier) === -1) {
        identifiers.push(mod.identifier);
      }

      names[mod.identifier] = mod.displayName;
      versions[mod.identifier] = mod.version;
    });

    payload.required_identifiers = identifiers;
    payload.required_names_by_id = names;
    payload.required_versions_by_id = versions;

    ns.log("published host server mods", {
      identifiers: ns.manifest.identifiers(),
    });

    return payload;
  }

  /* What a viewer reports having.
   *
   * A server mod the host is not running is deliberately left out, so a viewer
   * with extra server mods can still play - they are simply recorded as not
   * sharing them, and features can offer only what the host supports.
   *
   * The exception is galacticWarMod, which keeps its stock meaning: a mod
   * declaring it is always reported, so a host missing it blocks the viewer
   * exactly as it would for a client mod. This must not quietly soften that.
   */
  function sharedWithHost(mod) {
    return mod.galacticWarMod || hostRequired.indexOf(mod.identifier) !== -1;
  }

  function addViewerServerMods(payload) {
    var mods = _.filter(ns.manifest.activeServerMods(), sharedWithHost);

    if (!mods.length) {
      return payload;
    }

    var identifiers = _.isArray(payload.active_required_identifiers)
      ? payload.active_required_identifiers.slice()
      : [];
    var names = _.assign({}, payload.active_required_names_by_id);
    var versions = _.assign({}, payload.active_required_versions_by_id);
    var active = _.isArray(payload.active_identifiers)
      ? payload.active_identifiers.slice()
      : [];

    _.forEach(mods, function (mod) {
      if (identifiers.indexOf(mod.identifier) === -1) {
        identifiers.push(mod.identifier);
      }

      if (active.indexOf(mod.identifier) === -1) {
        active.push(mod.identifier);
      }

      names[mod.identifier] = mod.displayName;
      versions[mod.identifier] = mod.version;
    });

    payload.active_identifiers = active;
    payload.active_required_identifiers = identifiers;
    payload.active_required_names_by_id = names;
    payload.active_required_versions_by_id = versions;

    ns.log("reported shared server mods", { identifiers: identifiers });

    return payload;
  }

  /* The host's published list arrives on request_client_mod_manifest, whose
   * stock handler takes no argument and drops it.
   */
  function patchManifestRequest() {
    if (!root.handlers || !_.isFunction(handlers.request_client_mod_manifest)) {
      return false;
    }

    if (handlers.request_client_mod_manifest[MARK]) {
      return true;
    }

    var previous = handlers.request_client_mod_manifest;

    handlers.request_client_mod_manifest = function (payload) {
      if (payload && _.isArray(payload.required_identifiers)) {
        hostRequired = _.map(
          payload.required_identifiers,
          ns.manifest.normalizeIdentifier
        );

        ns.log("host required mods received", { identifiers: hostRequired });
      }

      return previous.apply(this, arguments);
    };

    handlers.request_client_mod_manifest[MARK] = true;

    return true;
  }

  function patchSendMessage() {
    if (!model || !_.isFunction(model.send_message)) {
      return false;
    }

    if (model.send_message[MARK]) {
      return true;
    }

    var previous = model.send_message;

    model.send_message = function (message, payload, respond) {
      if (message === REQUIRED && _.isObject(payload)) {
        try {
          payload = addHostServerMods(payload);
        } catch (e) {
          ns.alarm("gate_publish_failed", { error: String(e) });
        }
      } else if (message === MANIFEST && _.isObject(payload)) {
        try {
          payload = addViewerServerMods(payload);
        } catch (e) {
          ns.alarm("gate_manifest_failed", { error: String(e) });
        }
      }

      return previous.call(this, message, payload, respond);
    };

    model.send_message[MARK] = true;

    return true;
  }

  try {
    var send = patchSendMessage();
    var request = patchManifestRequest();

    if (!send || !request) {
      // Mounting still works; the co-op guard does not. Never let a partly
      // installed guard read as enforcement.
      ns.alarm("gate_unavailable", {
        send_message: send,
        request_manifest: request,
      });
    }
  } catch (e) {
    console.error("[GW-SM]", e);
  }

  ns.gate = {
    hostRequired: function () {
      return hostRequired.slice();
    },
  };
})(window);
