"use strict";

// live_game/remount.js: keep the mounts through a battle without touching the
// renderer.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { mod } = require("../scripts/lib/fake-cmm.js");
const { resolved } = require("../scripts/lib/fake-jquery.js");
const {
  createContext,
  loadFile,
  loadScene,
} = require("../scripts/lib/scene-loader.js");

describe("live_game remount", () => {
  it("installs the hooks and mounts without content registration", () => {
    const fixture = sharedScene({
      cmmOptions: { serverMods: [mod()] },
      ajax: (url) =>
        url.endsWith("unit_list.json") ? JSON.stringify({ units: [] }) : "",
    });

    loadScene(fixture.ctx, "live_game");

    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.api.calls.remount.length, 0);

    const runs = [];
    fixture.ns.mount.run = (options) => {
      runs.push(options);
      return resolved(true);
    };
    fixture.api.file.unmountAllMemoryFiles();

    assert.deepEqual(runs, [{ remountContent: false }]);
    assert.deepEqual(fixture.codes(), []);
  });

  it("logs rather than throws when the shared modules did not load", () => {
    const ctx = createContext();

    loadFile(ctx, "live_game/remount.js");

    assert.match(ctx.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});
