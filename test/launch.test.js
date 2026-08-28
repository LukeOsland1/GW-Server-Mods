"use strict";

// gw_play/launch.js: mount as the scene loads and again on the way into a
// battle, through model.fight.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { sharedScene } = require("../scripts/lib/shared-scene.js");
const { Deferred, resolved } = require("../scripts/lib/fake-jquery.js");
const { loadFile } = require("../scripts/lib/scene-loader.js");

function scene(options) {
  const opts = options || {};
  const fights = [];
  const fixture = sharedScene(
    Object.assign(
      {
        model: {
          fight: function () {
            fights.push({
              self: this,
              args: Array.prototype.slice.call(arguments),
            });
            return "fought";
          },
        },
      },
      opts
    )
  );
  fixture.fights = fights;
  loadFile(fixture.ctx, "gw_play/launch.js");
  return fixture;
}

describe("launch installation", () => {
  it("installs the hooks, mounts at once and patches fight", () => {
    const fixture = scene();

    assert.equal(
      fixture.api.file.unmountAllMemoryFiles.__gwServerModsWrapped,
      true
    );
    assert.equal(fixture.ns.mount.sequence(), 1);
    assert.equal(fixture.model.fight.__gwServerModsPatched, true);
    assert.equal(
      fixture.console.lines.log.includes("[GW-SM] fight patched"),
      true
    );
    assert.deepEqual(fixture.codes(), []);
  });

  it("raises launch_unavailable without model.fight", () => {
    const fixture = scene({ model: {} });
    assert.deepEqual(fixture.alarm("launch_unavailable")[0].detail, {
      fight: false,
    });

    const noModel = sharedScene({ model: null });
    noModel.ctx.model = null;
    loadFile(noModel.ctx, "gw_play/launch.js");
    assert.equal(noModel.alarm("launch_unavailable").length, 1);
  });

  it("patches once", () => {
    const fixture = scene();
    const patched = fixture.model.fight;

    loadFile(fixture.ctx, "gw_play/launch.js");

    assert.equal(fixture.model.fight, patched);
  });

  it("logs rather than throws when the shared modules are missing", () => {
    const fixture = sharedScene({ files: ["shared/alarm.js"] });

    loadFile(fixture.ctx, "gw_play/launch.js");

    assert.match(fixture.console.lines.error[0], /^\[GW-SM\] TypeError/);
  });
});

describe("the patched fight", () => {
  it("mounts, then fights with the same this and arguments", () => {
    const fixture = scene();
    const runs = [];
    fixture.ns.mount.run = () => {
      runs.push(fixture.fights.length);
      return resolved(true);
    };
    const self = {};
    let outcome;

    fixture.model.fight.call(self, 1, 2).then((value) => {
      outcome = value;
    });

    assert.deepEqual(runs, [0]);
    assert.deepEqual(fixture.fights, [{ self, args: [1, 2] }]);
    assert.equal(outcome, "fought");
  });

  it("does not fight until the mount settles", () => {
    const pending = Deferred();
    const fixture = scene();
    fixture.ns.mount.run = () => pending.promise();

    fixture.model.fight();
    assert.equal(fixture.fights.length, 0);

    pending.resolve(true);
    assert.equal(fixture.fights.length, 1);
  });
});
