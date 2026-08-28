"use strict";

// connect_to_game/start.js: mount before a Galactic War server starts, then
// declare the server mods on the connection.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { Deferred, rejected } = require("../scripts/lib/fake-jquery.js");
const { loadFile } = require("../scripts/lib/scene-loader.js");

function observable(initial, options) {
  const opts = options || {};
  let value = initial;
  return function () {
    if (arguments.length && !opts.readOnly) {
      value = arguments[0];
    }
    return value;
  };
}

function scene(options) {
  const opts = options || {};
  const fixture = sharedScene(
    Object.assign(
      {
        model: { gameModIdentifiers: observable(["com.client"]) },
        cmmOptions: { serverMods: [mod({ identifier: "Com.Server" })] },
        ajax: (url) =>
          url.endsWith("unit_list.json") ? JSON.stringify({ units: [] }) : "",
      },
      opts
    )
  );
  const runs = [];
  const mount = fixture.ns.mount;
  fixture.ns.mount = Object.assign({}, mount, {
    run: (o) => {
      runs.push(o);
      return opts.pending ? opts.pending.promise() : mount.run(o);
    },
  });
  fixture.runs = runs;
  loadFile(fixture.ctx, "connect_to_game/start.js");
  return fixture;
}

function start(fixture, mode) {
  const outcome = { value: undefined, error: undefined };
  fixture.api.net.startGame("region", mode, { p: 1 }).then(
    (value) => {
      outcome.value = value;
    },
    (error) => {
      outcome.error = error;
    }
  );
  return outcome;
}

describe("start installation", () => {
  it("installs the hooks and patches startGame", () => {
    const fixture = scene();

    assert.equal(
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped,
      true
    );
    assert.equal(fixture.api.net.startGame.__gwServerModsPatched, true);
    assert.deepEqual(fixture.codes(), []);
    assert.equal(
      fixture.console.lines.log.includes("[GW-SM] startGame patched"),
      true
    );
  });

  it("raises start_unavailable without api.net.startGame", () => {
    const fixture = scene({ apiOptions: { startGame: false } });
    assert.deepEqual(fixture.alarm("start_unavailable")[0].detail, {
      where: "api.net.startGame",
    });

    const noNet = sharedScene();
    noNet.api.net = null;
    loadFile(noNet.ctx, "connect_to_game/start.js");
    assert.equal(noNet.alarm("start_unavailable").length, 1);
  });

  it("patches once", () => {
    const fixture = scene();
    const patched = fixture.api.net.startGame;

    loadFile(fixture.ctx, "connect_to_game/start.js");

    assert.equal(fixture.api.net.startGame, patched);
  });

  it("logs rather than throws when the shared modules are missing", () => {
    const fixture = sharedScene({ files: ["shared/alarm.js"] });

    loadFile(fixture.ctx, "connect_to_game/start.js");

    assert.match(fixture.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});

describe("the patched startGame", () => {
  it("starts other modes directly", () => {
    const fixture = scene();

    for (const mode of ["ladder", "Custom", undefined, 42]) {
      fixture.api.net.startGame("region", mode, {});
    }

    assert.equal(fixture.runs.length, 0);
    assert.equal(fixture.api.calls.startGame.length, 4);
  });

  it("starts directly when mods are disabled", () => {
    const fixture = scene({ stubs: { gNoMods: true } });

    fixture.api.net.startGame("region", "gw", {});

    assert.equal(fixture.runs.length, 0);
  });

  it("mounts first for any mode ending in gw, then declares the server mods", () => {
    for (const mode of ["gw", "GW", "coop_gw"]) {
      const fixture = scene();

      const outcome = start(fixture, mode);

      assert.deepEqual(fixture.runs, [undefined]);
      assert.deepEqual(fixture.api.calls.startGame, [
        ["region", mode, { p: 1 }],
      ]);
      assert.equal(outcome.value, "started");
      assert.deepEqual(fixture.model.gameModIdentifiers(), [
        "com.client",
        "Com.Server",
      ]);
      assert.deepEqual(fixture.codes(), []);
    }
  });

  it("waits for the mount before starting", () => {
    const pending = Deferred();
    const fixture = scene({ pending });

    start(fixture, "gw");
    assert.equal(fixture.api.calls.startGame.length, 0);

    pending.resolve(false);
    assert.equal(fixture.api.calls.startGame.length, 1);
  });

  it("starts even after a mount that failed", () => {
    const pending = Deferred();
    const fixture = scene({ pending });

    const outcome = start(fixture, "gw");
    pending.reject("mount broke");

    assert.equal(outcome.value, "started");
  });

  it("rejects when the start rejects", () => {
    const fixture = scene({
      apiOptions: { startGame: () => rejected("refused") },
    });

    const outcome = start(fixture, "gw");

    assert.equal(outcome.error, "refused");
    assert.deepEqual(fixture.model.gameModIdentifiers(), ["com.client"]);
  });

  it("accepts a start that returns a plain value", () => {
    const fixture = scene({ apiOptions: { startGame: () => "plain" } });

    assert.equal(start(fixture, "gw").value, "plain");
  });
});

describe("declaring the identifiers", () => {
  it("does nothing without the list or without server mods", () => {
    const noList = scene({ model: {} });
    assert.equal(start(noList, "gw").value, "started");

    const noModel = scene({ model: null });
    noModel.ctx.model = null;
    assert.equal(start(noModel, "gw").value, "started");

    const noMods = scene({ cmmOptions: { serverMods: [] } });
    start(noMods, "gw");
    assert.deepEqual(noMods.model.gameModIdentifiers(), ["com.client"]);
  });

  it("starts from an empty list and does not repeat an identifier", () => {
    const fixture = scene({ model: { gameModIdentifiers: observable(null) } });
    start(fixture, "gw");
    assert.deepEqual(fixture.model.gameModIdentifiers(), ["Com.Server"]);

    const already = scene({
      model: { gameModIdentifiers: observable(["Com.Server"]) },
    });
    start(already, "gw");
    assert.deepEqual(already.model.gameModIdentifiers(), ["Com.Server"]);
  });

  it("raises identifiers_lost when the list does not keep them", () => {
    const fixture = scene({
      model: {
        gameModIdentifiers: observable(["com.client"], { readOnly: true }),
      },
    });

    start(fixture, "gw");

    assert.deepEqual(fixture.alarm("identifiers_lost")[0].detail, {
      expected: ["Com.Server"],
      applied: ["com.client"],
    });
  });

  it("raises identifiers_lost when the list reads back as nothing", () => {
    let reads = 0;
    const fixture = scene({
      model: {
        gameModIdentifiers: function () {
          reads += 1;
          return reads > 2 ? null : [];
        },
      },
    });

    start(fixture, "gw");

    assert.equal(fixture.alarm("identifiers_lost")[0].detail.applied.length, 0);
  });
});
