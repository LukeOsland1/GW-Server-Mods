/* Structured failure reporting shared by every GW Server Mods scene. */
(function (root) {
  var LOG = "[GW-SM]";
  var ns = root.GwServerMods || (root.GwServerMods = {});

  if (ns.alarm) {
    return;
  }

  var raised = [];

  ns.alarms = function () {
    return raised.slice();
  };

  ns.alarm = function (code, detail) {
    var record = { code: code, detail: detail || {} };
    raised.push(record);
    console.error(LOG, "ALARM", code, JSON.stringify(record.detail));
    return record;
  };

  ns.log = function (message, detail) {
    if (_.isUndefined(detail)) {
      console.log(LOG, message);
    } else {
      console.log(LOG, message, JSON.stringify(detail));
    }
  };
})(window);
