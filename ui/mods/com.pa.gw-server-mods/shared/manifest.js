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

  // Trees the server reads alone. Anything else under pa/ - units, terrain and
  // its CSG models, effects, anim - has to be on the client too. Excluding the
  // known server-only trees rather than listing the rendered ones means an
  // unrecognised tree is treated as client-relevant: too strict, never too lax.
  var SERVER_ONLY = /^ai(_|$)/;

  var relevance = {};

  function modRoot(mod) {
    return mod.fileSystem
      ? mod.installedPath
      : "/server_mods/" + mod.identifier + "/";
  }

  function leafName(path) {
    var trimmed = String(path).replace(/\/$/, "");

    return trimmed.slice(trimmed.lastIndexOf("/") + 1);
  }

  function detectRelevance(mod) {
    var deferred = $.Deferred();

    if (!api.file || !_.isFunction(api.file.list)) {
      relevance[mod.identifier] = true;
      deferred.resolve();
      return deferred.promise();
    }

    api.file.list(modRoot(mod) + "pa/", false).then(
      function (listing) {
        var entries =
          listing && listing.length ? listing : _.keys(listing || {});

        relevance[mod.identifier] = _.some(entries, function (entry) {
          return !SERVER_ONLY.test(leafName(entry));
        });

        deferred.resolve();
      },
      function () {
        // Unknown shape, so assume the client needs it.
        relevance[mod.identifier] = true;
        deferred.resolve();
      }
    );

    return deferred.promise();
  }

  function detectClientRelevance(mods) {
    return $.when.apply(
      $,
      _.map(mods, function (mod) {
        return detectRelevance(mod);
      })
    );
  }

  // Only these need to match between host and viewer. Empty until a mount has
  // run, and the gate treats that as "require everything" rather than nothing.
  function clientRelevantServerMods() {
    return _.filter(activeServerMods(), function (mod) {
      return relevance[mod.identifier] === true;
    });
  }

  function relevanceKnown() {
    return _.keys(relevance).length > 0;
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
    detectClientRelevance: detectClientRelevance,
    clientRelevantServerMods: clientRelevantServerMods,
    relevanceKnown: relevanceKnown,
    identifiers: identifiers,
    rawIdentifiers: rawIdentifiers,
    normalizeIdentifier: normalizeIdentifier,
    normalizeVersion: normalizeVersion,
  };
})(window);
