// See design.md.
(function (root) {
  var LOG = "[GW-SM]";
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.alarm) {
    return;
  }

  var raised = [];

  var WORDING = {
    cmm_unavailable:
      "Community Mods is not available, so server mods cannot be mounted.",
    content_remount_unavailable:
      "Server mod models and textures could not be registered, so modded units may be invisible.",
    filesystem_server_mod:
      "A server mod installed as a folder cannot be used in Galactic War; install it as a zip.",
    gate_manifest_failed: "Your server mods could not be reported to the host.",
    gate_publish_failed:
      "Your server mods could not be published to the other players.",
    gate_unavailable:
      "Server mods are mounted, but co-op cannot check them between players.",
    hooks_unavailable:
      "Server mods are mounted, but the mounts may be dropped before the battle starts.",
    identifiers_lost: "The battle may start without its server mods declared.",
    launch_unavailable:
      "Server mods may not be mounted when a battle is launched.",
    mount_failed: "A server mod failed to mount.",
    probe_failed: "Server mods mounted but their files cannot be read.",
    start_unavailable:
      "Server mods may not be mounted when the battle connects.",
    zip_missing: "A server mod is enabled but not downloaded.",
  };

  function describe(record) {
    var wording = WORDING[record.code] || record.code;
    var identifier = record.detail && record.detail.identifier;

    return identifier ? wording + " (" + identifier + ")" : wording;
  }

  // Not every scene composites its root document, live_game in particular.
  function banner() {
    var existing = document.getElementById("gw-sm-alarm");

    if (existing) {
      return existing;
    }

    if (!document.body) {
      return null;
    }

    var element = document.createElement("div");
    element.id = "gw-sm-alarm";
    element.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:2147483647;" +
      "max-width:560px;padding:8px 10px;" +
      "font:12px/1.35 Consolas,monospace;color:#e8f0ff;" +
      "background:rgba(10,24,40,0.94);border:1px solid #c92a2a;" +
      "pointer-events:none;word-break:break-word;";
    document.body.appendChild(element);

    return element;
  }

  function show() {
    var element = banner();

    if (!element) {
      return;
    }

    element.textContent =
      "GW Server Mods: " +
      _.map(_.uniq(raised, "code"), describe).join("  |  ");
  }

  ns.alarms = function () {
    return raised.slice();
  };

  ns.alarm = function (code, detail) {
    var record = { code: code, detail: detail || {} };
    raised.push(record);
    console.error(LOG + " ALARM " + code + " " + JSON.stringify(record.detail));

    try {
      show();
    } catch (e) {
      console.error(LOG + " alarm banner failed " + (e && e.message));
    }

    return record;
  };

  // PA's log file keeps only the first console argument, so build one string.
  ns.log = function (message, detail) {
    console.log(
      LOG +
        " " +
        message +
        (_.isUndefined(detail) ? "" : " " + JSON.stringify(detail))
    );
  };
})(window);
