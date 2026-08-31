"use strict";

// shared/mount.js: the mount sequence, the merged unit list and the probes
// that decide whether a run counts as mounted.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const {
  Deferred,
  rejected,
  resolved,
} = require("../scripts/lib/fake-jquery.js");
const {
  fakeSessionStorage,
  loadFile,
} = require("../scripts/lib/scene-loader.js");

const ROOT_LIST = "coui://pa/units/unit_list.json";
const MOD_LIST =
  "spec://server_mods/com.example.server/pa/units/unit_list.json";

// The responses a healthy install gives: a unit list wherever one is asked
// for, and an empty body for every probe.
function unitLists(byUrl) {
  return (url) => {
    if (url in byUrl) {
      return byUrl[url];
    }
    if (url.endsWith("unit_list.json")) {
      return JSON.stringify({ units: [] });
    }
    return "";
  };
}

function scene(options) {
  const opts = options || {};
  const lists = Object.assign(
    {
      [ROOT_LIST]: JSON.stringify({ units: ["/pa/units/a.json"] }),
      [MOD_LIST]: JSON.stringify({ units: ["/pa/units/b.json"] }),
    },
    opts.lists
  );
  return sharedScene(
    Object.assign(
      { ajax: opts.ajax || unitLists(lists) },
      { cmmOptions: { serverMods: [mod()] } },
      opts
    )
  );
}

function run(fixture, options) {
  let outcome;
  fixture.ns.mount.run(options).then((ok) => {
    outcome = ok;
  });
  return outcome;
}

function stages(fixture) {
  const reported = [];
  fixture.model.gwoLaunchProgress = { stage: (key) => reported.push(key) };
  return reported;
}

describe("mount.run", () => {
  it("resolves false without touching anything when Community Mods is absent", () => {
    const fixture = scene({ cmm: null });

    assert.equal(run(fixture), false);
    assert.deepEqual(fixture.codes(), []);
    assert.equal(fixture.ns.mount.sequence(), 0);
  });

  it("raises cmm_unavailable when zips cannot be mounted", () => {
    const fixture = scene({ apiOptions: { zipMount: false } });

    assert.equal(run(fixture), false);
    assert.deepEqual(fixture.alarm("cmm_unavailable")[0].detail, {
      where: "api.file.zip.mount",
    });
  });

  it("counts a run with no server mods as mounted", () => {
    const fixture = scene({ cmmOptions: { serverMods: [] } });

    assert.equal(run(fixture), true);
    const state = fixture.ns.mount.state();
    assert.equal(state.mounted, true);
    assert.deepEqual(state.mods, []);
    assert.equal(state.sequence, 1);
    assert.equal(typeof state.at, "number");
    assert.equal(fixture.cmm.calls.mountServerMods, 0);
  });

  it("mounts, registers, merges, classifies and verifies one zip mod", () => {
    const fixture = scene();
    const reported = stages(fixture);

    assert.equal(run(fixture), true);

    assert.deepEqual(fixture.api.calls.zipMount, [
      ["/download/com.example.server.zip", "/", false],
    ]);
    assert.equal(fixture.cmm.calls.mountServerMods, 1);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.deepEqual(reported, [
      "!LOC:Mounting server mods",
      "!LOC:Registering server mod content",
    ]);
    assert.deepEqual(
      fixture.$.ajaxCalls.map((call) => [call.url, call.cache]),
      [
        [ROOT_LIST, false],
        [MOD_LIST, true],
        ["coui://server_mods/mods.json", false],
        ["coui://server_mods/com.example.server/modinfo.json", false],
        ["spec://pa/units/unit_list.json", true],
      ]
    );
    assert.deepEqual(fixture.api.calls.mountMemoryFiles, [
      [
        {
          "/pa/units/unit_list.json": JSON.stringify({
            units: ["/pa/units/a.json", "/pa/units/b.json"],
          }),
        },
      ],
    ]);
    assert.deepEqual(fixture.codes(), []);
    const state = fixture.ns.mount.state();
    assert.equal(state.mounted, true);
    assert.equal(state.sequence, 1);
    assert.equal(state.mods[0].identifier, "com.example.server");
    assert.equal(
      fixture.console.lines.log.at(-1),
      '[GW-SM] mounted server mods {"ok":true,"count":1}'
    );
  });

  it("root-mounts the paired client mods too", () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod({ companions: ["com.client"] })],
        clientMods: [
          mod({
            identifier: "com.client",
            installedPath: "/download/client.zip",
          }),
        ],
      },
    });

    run(fixture);

    assert.deepEqual(
      fixture.api.calls.zipMount.map((call) => call[0]),
      ["/download/com.example.server.zip", "/download/client.zip"]
    );
  });

  it("leaves the renderer alone during a battle", () => {
    const fixture = scene();
    const reported = stages(fixture);

    assert.equal(run(fixture, { remountContent: false }), true);

    assert.equal(fixture.api.calls.remount.length, 0);
    assert.deepEqual(reported, ["!LOC:Mounting server mods"]);
  });

  it("raises content_remount_unavailable when the engine cannot register content", () => {
    const fixture = scene({ apiOptions: { remount: false } });

    assert.equal(run(fixture), true);
    assert.deepEqual(fixture.codes(), ["content_remount_unavailable"]);
  });

  it("raises zip_missing for an undownloaded zip and carries on", () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod({ installedPath: "" })] },
    });

    assert.equal(run(fixture), true);
    assert.deepEqual(fixture.alarm("zip_missing")[0].detail, {
      identifier: "com.example.server",
    });
    assert.equal(fixture.api.calls.zipMount.length, 0);
    assert.equal(fixture.cmm.calls.mountServerMods, 1);
  });

  it("raises mount_failed when the zip mount refuses or throws", () => {
    const refused = scene({ apiOptions: { zipMount: () => resolved(false) } });
    run(refused);
    assert.deepEqual(refused.alarm("mount_failed")[0].detail, {
      identifier: "com.example.server",
      path: "/download/com.example.server.zip",
    });

    const thrown = scene({
      apiOptions: { zipMount: () => rejected("bad zip") },
    });
    run(thrown);
    assert.equal(thrown.alarm("mount_failed").length, 1);
  });

  it("does not mount a folder mod and raises filesystem_server_mod only when the client needs it", () => {
    const folder = mod({ fileSystem: true, installedPath: "/mods/folder/" });
    const relevant = scene({
      cmmOptions: { serverMods: [folder] },
      apiOptions: { list: () => resolved(["/mods/folder/pa/units/"]) },
    });

    run(relevant);

    assert.equal(relevant.api.calls.zipMount.length, 0);
    assert.deepEqual(relevant.alarm("filesystem_server_mod")[0].detail, {
      identifier: "com.example.server",
      path: "/mods/folder/",
    });
    assert.equal(
      relevant.$.ajaxCalls.some(
        (call) => call.url === "coui://mods/folder/modinfo.json"
      ),
      true
    );
    assert.equal(relevant.api.calls.mountMemoryFiles.length, 0);

    const aiOnly = scene({
      cmmOptions: { serverMods: [folder] },
      apiOptions: { list: () => resolved(["/mods/folder/pa/ai/"]) },
    });
    run(aiOnly);
    assert.deepEqual(aiOnly.codes(), []);
  });

  it("raises probe_failed and reports not mounted when a file cannot be read back", () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === "coui://server_mods/com.example.server/modinfo.json") {
          throw new Error("404");
        }
        return url.endsWith("unit_list.json")
          ? JSON.stringify({ units: [] })
          : "";
      },
    });

    assert.equal(run(fixture), false);
    assert.deepEqual(fixture.alarm("probe_failed")[0].detail, {
      manifest: true,
      mods: [false],
      unitList: true,
    });
    assert.equal(fixture.ns.mount.state().mounted, false);
    assert.equal(fixture.ns.mount.sequence(), 1);
  });

  it("shares one run between concurrent callers and starts a new one afterwards", () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run();
    const second = fixture.ns.mount.run();
    assert.equal(first, second);
    assert.equal(fixture.ns.mount.sequence(), 0);

    pending.resolve();
    assert.equal(fixture.ns.mount.sequence(), 1);

    assert.notEqual(fixture.ns.mount.run(), first);
    assert.equal(fixture.ns.mount.sequence(), 2);
  });

  // A run with nothing to mount settles before run() returns; it must still
  // clear, or every later call would hand back that first promise.
  it("starts a fresh run after one that settled synchronously", () => {
    const fixture = scene({ cmmOptions: { serverMods: [] } });

    const first = fixture.ns.mount.run();

    assert.notEqual(fixture.ns.mount.run(), first);
    assert.equal(fixture.ns.mount.sequence(), 2);
  });

  // gw_play mounts without the remount, so the Fight click arriving while that
  // run is still open must not inherit a run that left the models unregistered.
  it("queues a content caller behind a run that skipped the remount", () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run({ remountContent: false });
    const second = fixture.ns.mount.run();

    assert.notEqual(first, second);
    assert.equal(fixture.api.calls.remount.length, 0);
    assert.equal(fixture.ns.mount.sequence(), 0);

    pending.resolve();

    assert.equal(fixture.ns.mount.sequence(), 2);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.equal(run(fixture, { remountContent: false }), true);
  });

  it("shares a run that remounts with a caller that does not need it", () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run();

    assert.equal(fixture.ns.mount.run({ remountContent: false }), first);
    assert.equal(fixture.ns.mount.run(), first);

    pending.resolve();

    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 1);
  });

  it("shares one contentless run between contentless callers", () => {
    const pending = Deferred();
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => pending.promise(),
      },
    });

    const first = fixture.ns.mount.run({ remountContent: false });

    assert.equal(fixture.ns.mount.run({ remountContent: false }), first);

    pending.resolve();

    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 0);
  });

  // The queued run supersedes the one it waits on, so the run it replaced must
  // not clear it on the way out.
  it("holds the queued run open until it settles", () => {
    const first = Deferred();
    const second = Deferred();
    const responses = [first, second];
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod()],
        mountServerMods: () => responses.shift().promise(),
      },
    });

    fixture.ns.mount.run({ remountContent: false });
    const queued = fixture.ns.mount.run();

    first.resolve();

    assert.equal(fixture.ns.mount.run(), queued);
    assert.equal(fixture.ns.mount.sequence(), 1);

    second.resolve();

    assert.equal(fixture.ns.mount.sequence(), 2);
    assert.notEqual(fixture.ns.mount.run(), queued);
  });

  it("persists the classification for the gate", () => {
    const storage = fakeSessionStorage();
    const fixture = scene({
      stubs: { sessionStorage: storage },
      apiOptions: {
        list: () => resolved(["/server_mods/com.example.server/pa/units/"]),
      },
    });

    run(fixture);

    assert.deepEqual(JSON.parse(storage.store.gw_server_mods_relevance), {
      "com.example.server": true,
    });
  });
});

describe("the merged unit list", () => {
  it("is skipped when Community Mods has the merge disabled", () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod()], mergeUnitServerMods: false },
    });

    run(fixture);

    assert.equal(
      fixture.$.ajaxCalls.some((call) => call.url === ROOT_LIST),
      false
    );
    assert.equal(fixture.api.calls.mountMemoryFiles.length, 0);
    assert.equal(
      fixture.console.lines.log.includes(
        "[GW-SM] unit list merge disabled by Community Mods"
      ),
      true
    );
  });

  it("still merges when Community Mods leaves the merge enabled", () => {
    const fixture = scene({
      cmmOptions: { serverMods: [mod()], mergeUnitServerMods: true },
    });

    run(fixture);

    assert.equal(fixture.api.calls.mountMemoryFiles.length, 1);
  });

  it("is not written when no mod ships a readable list", () => {
    const fixture = scene({
      lists: { [MOD_LIST]: "{not json" },
    });

    run(fixture);

    assert.equal(fixture.api.calls.mountMemoryFiles.length, 0);
    assert.deepEqual(fixture.codes(), []);
  });

  it("ignores a list without a units array and a root list that cannot be read", () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === ROOT_LIST) {
          throw new Error("missing");
        }
        if (url === MOD_LIST) {
          return JSON.stringify({ units: ["/pa/units/b.json"] });
        }
        if (url.endsWith("unit_list.json")) {
          return JSON.stringify({ nope: true });
        }
        return "";
      },
    });

    run(fixture);

    assert.deepEqual(fixture.api.calls.mountMemoryFiles, [
      [
        {
          "/pa/units/unit_list.json": JSON.stringify({
            units: ["/pa/units/b.json"],
          }),
        },
      ],
    ]);
  });

  it("dedupes across lists and accepts an already parsed response", () => {
    const fixture = scene({
      ajax: (url) => {
        if (url === ROOT_LIST) {
          return { units: ["/pa/units/a.json", "/pa/units/b.json"] };
        }
        if (url === MOD_LIST) {
          return JSON.stringify({
            units: ["/pa/units/b.json", "/pa/units/c.json"],
          });
        }
        return url.endsWith("unit_list.json")
          ? JSON.stringify({ units: [] })
          : "";
      },
    });

    run(fixture);

    assert.deepEqual(
      JSON.parse(
        fixture.api.calls.mountMemoryFiles[0][0]["/pa/units/unit_list.json"]
      ).units,
      ["/pa/units/a.json", "/pa/units/b.json", "/pa/units/c.json"]
    );
    assert.equal(
      fixture.console.lines.log.includes(
        '[GW-SM] merged unit list {"units":3,"lists":1}'
      ),
      true
    );
  });

  it("only logs when one list could not be written, but alarms for several", () => {
    const one = scene({ apiOptions: { mountMemoryFiles: false } });
    run(one);
    assert.deepEqual(one.codes(), []);
    assert.equal(
      one.console.lines.log.includes(
        '[GW-SM] unit list not merged {"units":2,"lists":1,"reason":"mountMemoryFiles unavailable"}'
      ),
      true
    );

    const secondList = "spec://server_mods/com.second/pa/units/unit_list.json";
    const two = scene({
      cmmOptions: { serverMods: [mod(), mod({ identifier: "com.second" })] },
      lists: { [secondList]: JSON.stringify({ units: ["/pa/units/c.json"] }) },
      apiOptions: { mountMemoryFiles: () => rejected("refused") },
    });
    run(two);
    assert.deepEqual(two.alarm("unit_list_unmerged")[0].detail, {
      units: 3,
      lists: 2,
      reason: "refused",
    });
  });
});

describe("the launch progress report", () => {
  it("is a no-op without GWO's progress model and survives a throwing stage", () => {
    const silent = scene({ model: null });
    assert.equal(run(silent), true);

    const broken = scene();
    broken.model.gwoLaunchProgress = {
      stage: () => {
        throw new Error("no screen");
      },
    };
    assert.equal(run(broken), true);
    assert.equal(
      broken.console.lines.log.includes(
        "[GW-SM] progress report failed no screen"
      ),
      true
    );
  });
});

describe("mount module", () => {
  it("does not load twice into one scope", () => {
    const { ctx, ns } = scene();
    const first = ns.mount;

    loadFile(ctx, "shared/mount.js");

    assert.equal(ctx.GwServerMods.mount, first);
  });
});

describe("mount.run rootOnly", () => {
  function fakeKo(records) {
    return {
      observableArray: () => {
        const store = () => records;
        store.extend = () => {
          store.ready = resolved(records);
          return store;
        };
        return store;
      },
    };
  }

  function startScene(records, options) {
    return scene(
      Object.assign(
        {
          cmm: null,
          stubs: {
            ko: fakeKo(records),
            localStorage: { installedModsDB: "1" },
          },
        },
        options
      )
    );
  }

  it("mounts the enabled server zips and their companions at the root without Community Mods", () => {
    const fixture = startScene([
      mod({
        identifier: "com.faction",
        context: "server",
        enabled: true,
        companions: ["com.faction-client"],
        scenes: { live_game: ["coui://ui/mods/com.faction/live_game.js"] },
      }),
      mod({
        identifier: "com.faction-client",
        context: "client",
        enabled: true,
        installedPath: "/download/com.faction-client.zip",
      }),
    ]);
    const storage = fixture.ctx.sessionStorage;

    assert.equal(run(fixture, { rootOnly: true }), true);

    assert.deepEqual(fixture.api.calls.zipMount, [
      ["/download/com.example.server.zip", "/", false],
      ["/download/com.faction-client.zip", "/", false],
    ]);
    assert.equal(fixture.api.calls.remount.length, 1);
    assert.deepEqual(fixture.api.calls.mountMemoryFiles, []);
    assert.deepEqual(fixture.$.ajaxCalls, []);
    assert.deepEqual(JSON.parse(storage.store.gw_server_mods_scenes), {
      live_game: ["coui://ui/mods/com.faction/live_game.js"],
    });
    assert.deepEqual(fixture.codes(), []);
    const state = fixture.ns.mount.state();
    assert.equal(state.mounted, true);
    assert.equal(state.mods[0].identifier, "com.faction");
  });

  it("counts a failed root mount against the run", () => {
    const fixture = startScene([mod({ context: "server", enabled: true })], {
      apiOptions: { zipMount: () => resolved(false) },
    });

    assert.equal(run(fixture, { rootOnly: true }), false);
    assert.equal(fixture.alarm("mount_failed").length, 1);
  });

  it("settles as mounted with nothing to mount", () => {
    const fixture = startScene([]);

    assert.equal(run(fixture, { rootOnly: true }), true);
    assert.deepEqual(fixture.ns.mount.state().mods, []);
  });

  it("still refuses a battle mount without Community Mods", () => {
    const fixture = startScene([mod({ context: "server", enabled: true })]);

    assert.equal(run(fixture), false);
    assert.equal(fixture.ns.mount.sequence(), 0);
  });

  it("records the scene lists on a battle mount", () => {
    const fixture = scene({
      cmmOptions: {
        serverMods: [mod({ scenes: { live_game: ["coui://ui/mods/x.js"] } })],
      },
    });

    assert.equal(run(fixture), true);
    assert.deepEqual(
      JSON.parse(fixture.ctx.sessionStorage.store.gw_server_mods_scenes),
      { live_game: ["coui://ui/mods/x.js"] }
    );
  });
});
