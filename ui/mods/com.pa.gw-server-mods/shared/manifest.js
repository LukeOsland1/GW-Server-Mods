// Identifiers and versions are normalised exactly as connect_to_game.js does.
(function (root) {
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.manifest) {
    return;
  }

  // Community Mods' generated aggregate, derived from the others, so it is not
  // something a player can be missing.
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
      // The gate lower-cases; the game needs the case it was installed under.
      rawIdentifier: (mod && mod.identifier) || identifier,
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

  // A faction splits its art: models in the server mod, textures in the paired
  // client mod. See design.md.
  function pairedClientMods() {
    if (!available() || !_.isFunction(manager().activeClientZipMods)) {
      return [];
    }

    var bases = _.map(activeServerMods(), function (mod) {
      return mod.identifier.replace(/[-.]server$/, "");
    });

    var clients = _.map(manager().activeClientZipMods(), describe);

    return _.filter(clients, function (mod) {
      return _.some(bases, function (base) {
        return base.length && mod.identifier.indexOf(base) === 0;
      });
    });
  }

  function identifiers() {
    return _.map(activeServerMods(), function (mod) {
      return mod.identifier;
    });
  }

  function rawIdentifiers() {
    return _.map(activeServerMods(), function (mod) {
      return mod.rawIdentifier;
    });
  }

  ns.manifest = {
    available: available,
    activeServerMods: activeServerMods,
    pairedClientMods: pairedClientMods,
    identifiers: identifiers,
    rawIdentifiers: rawIdentifiers,
    normalizeIdentifier: normalizeIdentifier,
    normalizeVersion: normalizeVersion,
  };
})(window);
