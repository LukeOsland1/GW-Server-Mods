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
      }

      return previous.call(this, message, payload, respond);
    };

    model.send_message[MARK] = true;

    return true;
  }

  try {
    if (!patchSendMessage()) {
      // Mounting still works; the co-op guard does not. Never let a partly
      // installed guard read as enforcement.
      ns.alarm("gate_unavailable", { where: "model.send_message" });
    }
  } catch (e) {
    console.error("[GW-SM]", e);
  }
})(window);
