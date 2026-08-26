/* The active server mod set, normalised to match the base game's mod gate.
 *
 * Community Mods already computes this; the identifiers and versions are
 * normalised exactly as connect_to_game.js does so a value this mod publishes
 * can never disagree with one the base game compares it against.
 */
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.manifest) {
    return;
  }

  // Community Mods' own generated aggregate. It is mounted with the rest but is
  // derived from the others, so it is not something a player can be missing.
  var GENERATED_SERVER_MOD = "community-mods-server";

  function normalizeIdentifier(identifier) {
    if (!_.isString(identifier)) {
      return "";
    }

    var trimmed = identifier.trim();
    if (!trimmed.length) {
      return "";
    }

    return trimmed.toLowerCase();
  }

  function normalizeVersion(version) {
    if (_.isUndefined(version) || version === null) {
      return "";
    }

    return String(version).trim();
  }

  function manager() {
    return root.CommunityModsManager;
  }

  function available() {
    var mgr = manager();

    return !!(
      mgr &&
      _.isFunction(mgr.activeServerModsToMount) &&
      _.isFunction(mgr.mountServerMods)
    );
  }

  function describe(mod) {
    var identifier = normalizeIdentifier(mod && mod.identifier);

    return {
      identifier: identifier,
      displayName:
        _.isString(mod.display_name) && mod.display_name.length
          ? mod.display_name
          : identifier,
      version: normalizeVersion(mod && mod.version),
      installedPath: mod && mod.installedPath,
      fileSystem: !!(mod && mod.fileSystem),
      galacticWarMod: !!(mod && mod.galacticWarMod === true),
    };
  }

  // Every active server mod, generated aggregate excluded. Used both for
  // mounting and for what the host publishes to the co-op gate.
  function activeServerMods() {
    if (!available()) {
      ns.alarm("cmm_unavailable", { where: "manifest.activeServerMods" });
      return [];
    }

    var described = _.map(manager().activeServerModsToMount(), describe);

    return _.filter(described, function (mod) {
      return mod.identifier.length && mod.identifier !== GENERATED_SERVER_MOD;
    });
  }

  function identifiers() {
    return _.map(activeServerMods(), function (mod) {
      return mod.identifier;
    });
  }

  ns.manifest = {
    available: available,
    activeServerMods: activeServerMods,
    identifiers: identifiers,
    normalizeIdentifier: normalizeIdentifier,
    normalizeVersion: normalizeVersion,
  };
})(window);
