"use strict";

// shared/promise.js: the two helpers that keep native promises inside the mod
// and jQuery promises at the seams stock PA reads.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createFakeJQuery } = require("../scripts/lib/fake-jquery.js");
const { createContext, loadFile } = require("../scripts/lib/scene-loader.js");

function load() {
  const ctx = createContext({ $: createFakeJQuery() });
  loadFile(ctx, "shared/promise.js");
  return ctx.GwServerMods;
}

// An engine promise: `then` and nothing else. jQuery 2.1.4 does not recognise
// one, which is the whole reason these helpers exist.
function enginePromise(settle) {
  return {
    then: function (onDone, onFail) {
      settle(onDone, onFail);
    },
  };
}

describe("ns.settled", () => {
  it("resolves with one entry per input, in order", async () => {
    const ns = load();

    assert.deepEqual(await ns.settled([1, Promise.resolve(2), 3]), [1, 2, 3]);
  });

  it("carries on past a rejection, keeping the reason in place", async () => {
    const ns = load();

    assert.deepEqual(
      await ns.settled([Promise.resolve("a"), Promise.reject("no"), "c"]),
      ["a", "no", "c"]
    );
  });

  it("adopts an engine promise, which $.when cannot", async () => {
    const ns = load();

    assert.deepEqual(
      await ns.settled([enginePromise((done) => done("registered"))]),
      ["registered"]
    );
  });

  it("resolves an empty list", async () => {
    const ns = load();

    assert.deepEqual(await ns.settled([]), []);
  });
});

describe("ns.jq", () => {
  it("gives stock code a promise it can call always, done and fail on", async () => {
    const ns = load();
    const seen = [];
    const promise = ns.jq(Promise.resolve("started"));

    promise.done((value) => seen.push(["done", value]));
    promise.fail(() => seen.push(["fail"]));
    promise.always((value) => seen.push(["always", value]));

    await promise;

    assert.deepEqual(seen, [
      ["done", "started"],
      ["always", "started"],
    ]);
  });

  it("rejects with the reason when the native promise rejects", async () => {
    const ns = load();
    const seen = [];

    ns.jq(Promise.reject("refused"))
      .fail((error) => seen.push(["fail", error]))
      .always((error) => seen.push(["always", error]));

    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(seen, [
      ["fail", "refused"],
      ["always", "refused"],
    ]);
  });

  it("is loaded once, so a second load leaves the first helpers in place", () => {
    const ctx = createContext({ $: createFakeJQuery() });
    loadFile(ctx, "shared/promise.js");
    const first = ctx.GwServerMods.settled;
    loadFile(ctx, "shared/promise.js");

    assert.equal(ctx.GwServerMods.settled, first);
  });
});
