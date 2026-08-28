"use strict";

// shared/manifest.js: Community Mods' records as the rest of the mod reads
// them, and the client-relevance classification the gate depends on.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { fakeSessionStorage } = require("../scripts/lib/scene-loader.js");
const { rejected, resolved } = require("../scripts/lib/fake-jquery.js");

const RELEVANCE_KEY = "gw_server_mods_relevance";

function scene(options) {
  return sharedScene(options);
}

describe("manifest.normalizeIdentifier", () => {
  it("lower-cases and trims, and turns anything else into an empty string", () => {
    const { ns } = scene();

    assert.equal(
      ns.manifest.normalizeIdentifier(" Com.Example.A "),
      "com.example.a"
    );
    assert.equal(ns.manifest.normalizeIdentifier("   "), "");
    assert.equal(ns.manifest.normalizeIdentifier(undefined), "");
    assert.equal(ns.manifest.normalizeIdentifier(42), "");
  });
});

describe("manifest.normalizeVersion", () => {
  it("stringifies and trims, with nothing for null or undefined", () => {
    const { ns } = scene();

    assert.equal(ns.manifest.normalizeVersion(" 1.2.3 "), "1.2.3");
    assert.equal(ns.manifest.normalizeVersion(1.5), "1.5");
    assert.equal(ns.manifest.normalizeVersion(null), "");
    assert.equal(ns.manifest.normalizeVersion(undefined), "");
  });
});

describe("manifest.available", () => {
  it("needs Community Mods with both the listing and the mount", () => {
    assert.equal(scene({ cmm: null }).ns.manifest.available(), false);
    assert.equal(
      scene({
        cmm: { activeServerModsToMount: () => [] },
      }).ns.manifest.available(),
      false
    );
    assert.equal(scene().ns.manifest.available(), true);
  });
});

describe("manifest.activeServerMods", () => {
  it("raises cmm_unavailable and returns nothing without Community Mods", () => {
    const fixture = scene({ cmm: null });

    assert.deepEqual(fixture.ns.manifest.activeServerMods(), []);
    assert.deepEqual(fixture.alarm("cmm_unavailable")[0].detail, {
      where: "manifest.activeServerMods",
    });
  });

  it("describes each record with normalised and raw identifiers", () => {
    const { ns } = scene({
      cmmOptions: {
        serverMods: [
          mod({
            identifier: " Com.Example.Server ",
            display_name: "Example",
            version: 2,
            fileSystem: 1,
            galacticWarMod: true,
          }),
        ],
      },
    });

    assert.deepEqual(ns.manifest.activeServerMods(), [
      {
        identifier: "com.example.server",
        rawIdentifier: " Com.Example.Server ",
        displayName: "Example",
        version: "2",
        installedPath: "/download/com.example.server.zip",
        fileSystem: true,
        galacticWarMod: true,
      },
    ]);
  });

  it("falls back to the identifier as display name and treats a non-boolean GW flag as off", () => {
    const { ns } = scene({
      cmmOptions: {
        serverMods: [
          mod({ identifier: "com.a", display_name: "", galacticWarMod: "yes" }),
          mod({ identifier: "com.b", display_name: null, version: null }),
        ],
      },
    });

    const mods = ns.manifest.activeServerMods();

    assert.equal(mods[0].displayName, "com.a");
    assert.equal(mods[0].galacticWarMod, false);
    assert.equal(mods[1].displayName, "com.b");
    assert.equal(mods[1].version, "");
  });

  it("drops the generated aggregate and records with no identifier", () => {
    const { ns } = scene({
      cmmOptions: {
        serverMods: [
          mod({ identifier: "community-mods-server" }),
          mod({ identifier: "" }),
          null,
          mod({ identifier: "com.keep" }),
        ],
      },
    });

    assert.deepEqual(ns.manifest.identifiers(), ["com.keep"]);
  });

  it("exposes both identifier forms as lists", () => {
    const { ns } = scene({
      cmmOptions: { serverMods: [mod({ identifier: "Com.Mixed" })] },
    });

    assert.deepEqual(ns.manifest.identifiers(), ["com.mixed"]);
    assert.deepEqual(ns.manifest.rawIdentifiers(), ["Com.Mixed"]);
  });
});

describe("manifest.modRoot", () => {
  it("is the install folder for a folder mod and the zip mount for the rest", () => {
    const { ns } = scene();

    assert.equal(
      ns.manifest.modRoot({ fileSystem: true, installedPath: "/mods/x/" }),
      "/mods/x/"
    );
    assert.equal(
      ns.manifest.modRoot({ fileSystem: false, rawIdentifier: "Com.X" }),
      "/server_mods/Com.X/"
    );
  });
});

describe("manifest.pairedClientMods", () => {
  it("is empty without a client mod listing or without companions", () => {
    assert.deepEqual(
      scene({
        cmmOptions: { serverMods: [mod({ companions: ["com.c"] })] },
      }).ns.manifest.pairedClientMods(),
      []
    );
    assert.deepEqual(
      scene({
        cmmOptions: { serverMods: [mod()], clientMods: [mod()] },
      }).ns.manifest.pairedClientMods(),
      []
    );
  });

  it("returns the active client mods a server mod names, matched case-insensitively", () => {
    const { ns } = scene({
      cmmOptions: {
        serverMods: [
          mod({ companions: ["Com.Faction.Client"] }),
          mod({ identifier: "com.other", companions: "not-a-list" }),
        ],
        clientMods: [
          mod({ identifier: "com.faction.client", display_name: "Faction" }),
          mod({ identifier: "com.unrelated" }),
        ],
      },
    });

    const paired = ns.manifest.pairedClientMods();

    assert.equal(paired.length, 1);
    assert.equal(paired[0].identifier, "com.faction.client");
    assert.equal(paired[0].displayName, "Faction");
  });

  it("logs when a companion is not active", () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod({ companions: ["com.present", "com.missing"] })],
        clientMods: [mod({ identifier: "com.present" })],
      },
    });

    assert.equal(fixture.ns.manifest.pairedClientMods().length, 1);
    assert.equal(
      fixture.console.lines.log[0],
      '[GW-SM] companion client mods not all active {"wanted":["com.present","com.missing"],"mounted":["com.present"]}'
    );
  });
});

describe("manifest.detectClientRelevance", () => {
  function detect(fixture, mods) {
    let settled = false;
    fixture.ns.manifest.detectClientRelevance(mods).always(() => {
      settled = true;
    });
    assert.equal(settled, true);
    return JSON.parse(fixture.ctx.sessionStorage.store[RELEVANCE_KEY]);
  }

  const zipMod = {
    identifier: "com.zip",
    rawIdentifier: "Com.Zip",
    fileSystem: false,
  };
  const folderMod = {
    identifier: "com.folder",
    fileSystem: true,
    installedPath: "/mods/folder/",
  };

  it("lists each mod's pa/ tree under its own root", () => {
    const fixture = scene();

    detect(fixture, [zipMod, folderMod]);

    assert.deepEqual(fixture.api.calls.list, [
      ["/server_mods/Com.Zip/pa/", false],
      ["/mods/folder/pa/", false],
    ]);
  });

  it("treats a tree of only ai directories as server-only", () => {
    const fixture = scene({
      apiOptions: {
        list: () =>
          resolved([
            "/server_mods/Com.Zip/pa/ai/",
            "/server_mods/Com.Zip/pa/ai_personalities",
          ]),
      },
    });

    assert.deepEqual(detect(fixture, [zipMod]), { "com.zip": false });
    assert.equal(fixture.ns.manifest.relevanceKnown(), true);
  });

  it("treats anything else under pa/ as something the client renders", () => {
    const fixture = scene({
      apiOptions: {
        list: () =>
          resolved([
            "/server_mods/Com.Zip/pa/ai/",
            "/server_mods/Com.Zip/pa/units/",
          ]),
      },
    });

    assert.deepEqual(detect(fixture, [zipMod]), { "com.zip": true });
  });

  it("reads an object listing by its keys", () => {
    const fixture = scene({
      apiOptions: {
        list: () => resolved({ "/server_mods/Com.Zip/pa/aircraft": {} }),
      },
    });

    assert.deepEqual(detect(fixture, [zipMod]), { "com.zip": true });
  });

  it("assumes relevance when the listing fails or cannot be requested", () => {
    const failing = scene({ apiOptions: { list: () => rejected("boom") } });
    assert.deepEqual(detect(failing, [zipMod]), { "com.zip": true });

    const noList = scene({ apiOptions: { list: false } });
    assert.deepEqual(detect(noList, [zipMod]), { "com.zip": true });

    const noFile = scene();
    noFile.api.file = null;
    assert.deepEqual(detect(noFile, [zipMod]), { "com.zip": true });
  });

  it("keeps the classification in memory when it cannot be persisted", () => {
    const fixture = scene({
      stubs: {
        sessionStorage: fakeSessionStorage({}, { setItemThrows: true }),
      },
      cmmOptions: { serverMods: [mod({ identifier: "com.zip" })] },
      apiOptions: { list: () => resolved(["/server_mods/Com.Zip/pa/units/"]) },
    });

    fixture.ns.manifest.detectClientRelevance([zipMod]);

    assert.equal(fixture.ns.manifest.relevanceKnown(), true);
    assert.equal(
      fixture.ns.manifest.clientRelevantServerMods()[0].identifier,
      "com.zip"
    );
    assert.equal(
      fixture.console.lines.log[0],
      "[GW-SM] server mod classification not persisted"
    );
  });

  it("settles with nothing to classify", () => {
    const fixture = scene();

    assert.deepEqual(detect(fixture, []), {});
    assert.equal(fixture.ns.manifest.relevanceKnown(), false);
  });
});

describe("manifest.clientRelevantServerMods", () => {
  it("reads the classification another scene persisted", () => {
    const { ns } = scene({
      stubs: {
        sessionStorage: fakeSessionStorage({
          [RELEVANCE_KEY]: JSON.stringify({ "com.a": true, "com.b": false }),
        }),
      },
      cmmOptions: {
        serverMods: [
          mod({ identifier: "com.a" }),
          mod({ identifier: "com.b" }),
          mod({ identifier: "com.c" }),
        ],
      },
    });

    assert.equal(ns.manifest.relevanceKnown(), true);
    assert.deepEqual(
      ns.manifest.clientRelevantServerMods().map((m) => m.identifier),
      ["com.a"]
    );
  });

  it("treats a corrupt persisted classification as unknown", () => {
    const { ns } = scene({
      stubs: {
        sessionStorage: fakeSessionStorage({ [RELEVANCE_KEY]: "{oops" }),
      },
      cmmOptions: { serverMods: [mod()] },
    });

    assert.equal(ns.manifest.relevanceKnown(), false);
    assert.deepEqual(ns.manifest.clientRelevantServerMods(), []);
  });
});

describe("manifest module", () => {
  it("does not load twice into one scope", () => {
    const { ctx, ns } = scene();
    const first = ns.manifest;

    require("../scripts/lib/scene-loader.js").loadFile(
      ctx,
      "shared/manifest.js"
    );

    assert.equal(ctx.GwServerMods.manifest, first);
  });
});
