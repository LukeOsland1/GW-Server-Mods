"use strict";

// The api.* surface the shipped code reaches. Every member is optional so a test
// can leave out the one whose absence it asserts (pass `false`); every call is
// recorded on `api.calls`. A handler's return goes through $.when in the code
// under test, so it may be a plain value or a Deferred; undefined resolves.

const { resolved } = require("./fake-jquery.js");

function createFakeApi(options) {
  const opts = options || {};
  const calls = {
    zipMount: [],
    list: [],
    mountMemoryFiles: [],
    unmountAllMemoryFiles: [],
    remount: [],
    startGame: [],
  };

  function record(name, handler, fallback) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      calls[name].push(args);
      const result = handler ? handler.apply(null, args) : fallback;
      return result === undefined ? resolved() : result;
    };
  }

  const api = { calls: calls, file: {}, content: {}, net: {} };

  if (opts.zipMount !== false) {
    api.file.zip = { mount: record("zipMount", opts.zipMount, resolved(true)) };
  }
  if (opts.list !== false) {
    api.file.list = record("list", opts.list, resolved([]));
  }
  if (opts.mountMemoryFiles !== false) {
    api.file.mountMemoryFiles = record(
      "mountMemoryFiles",
      opts.mountMemoryFiles
    );
  }
  if (opts.unmountAllMemoryFiles !== false) {
    api.file.unmountAllMemoryFiles = record(
      "unmountAllMemoryFiles",
      opts.unmountAllMemoryFiles
    );
  }
  if (opts.remount !== false) {
    api.content.remount = record("remount", opts.remount);
  }
  if (opts.startGame !== false) {
    api.net.startGame = record(
      "startGame",
      opts.startGame,
      resolved("started")
    );
  }

  return api;
}

module.exports = { createFakeApi };
