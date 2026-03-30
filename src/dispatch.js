// dispatch.js: Single JXA script that handles all osa-mcp operations.
// Called as: osascript -l JavaScript dispatch.js BASE64_OP [BASE64_ARGS...]
// All argv are base64-encoded. First is the operation name, rest are JSON payloads.

ObjC.import("Foundation");
ObjC.import("AppKit");

function decode(b64) {
  var d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return JSON.parse($.NSString.alloc.initWithDataEncoding(d, 4).js);
}

function decodeStr(b64) {
  var d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return $.NSString.alloc.initWithDataEncoding(d, 4).js;
}

function discover() {
  var query = $.NSMetadataQuery.alloc.init;
  query.setPredicate(
    $.NSPredicate.predicateWithFormat(
      'kMDItemContentType == "com.apple.application-bundle"'
    )
  );
  query.startQuery;
  $.NSRunLoop.currentRunLoop.runUntilDate(
    $.NSDate.dateWithTimeIntervalSinceNow(3)
  );
  query.stopQuery;

  var apps = [];
  var errors = [];
  for (var i = 0; i < query.resultCount; i++) {
    var item = query.resultAtIndex(i);
    var path = item.valueForAttribute("kMDItemPath");
    if (!path) continue;
    var bundle = $.NSBundle.bundleWithPath(path);
    if (!bundle || !bundle.infoDictionary) continue;
    var sdefObj = bundle.infoDictionary.objectForKey("OSAScriptingDefinition");
    if (!sdefObj) continue;

    var displayName = item.valueForAttribute("kMDItemDisplayName");
    var name = displayName ? displayName.js.replace(/\.app$/, "") : "unknown";
    var bundleId = bundle.bundleIdentifier ? bundle.bundleIdentifier.js : null;
    var sn;
    try { sn = sdefObj.js; } catch(e) { sn = "" + sdefObj; }
    if (!sn || typeof sn !== "string") continue;
    if (sn.indexOf(".") < 0) sn = sn + ".sdef";

    var url = $.NSURL.fileURLWithPath(path.js + "/Contents/Resources/" + sn);
    var error = $();
    var xmlDoc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(
      url, $.NSXMLDocumentXInclude, error
    );
    if (!xmlDoc || error[0]) {
      errors.push({ name: name, error: error[0] ? "" + error[0].localizedDescription : "load failed" });
      continue;
    }
    var xml = xmlDoc.XMLString;
    if (!xml) {
      errors.push({ name: name, error: "XMLString nil" });
      continue;
    }
    apps.push({ name: name, bundleId: bundleId, sdef: xml.js ? xml.js : "" + xml });
  }
  return JSON.stringify({ apps: apps, errors: errors });
}

function command(a) {
  var app = Application(a.appId);
  var namedArgs = {};
  for (var i = 0; i < a.paramKeys.length; i++) {
    var pk = a.paramKeys[i];
    if (a.values[pk.argKey] !== undefined) namedArgs[pk.jxaKey] = a.values[pk.argKey];
  }
  var hasNamed = Object.keys(namedArgs).length > 0;
  if (a.hasDirectParam && a.values.target !== undefined) {
    return JSON.stringify(hasNamed ? app[a.method](a.values.target, namedArgs) : app[a.method](a.values.target));
  }
  if (hasNamed) return JSON.stringify(app[a.method](namedArgs));
  return JSON.stringify(app[a.method]());
}

function list(a) {
  var app = Application(a.appId);
  var limit = a.values.limit || 25;
  var parent = a.values.parent || "";
  var container = parent ? eval("app." + parent)[a.pluralMethod]() : app[a.pluralMethod]();
  var count = Math.min(container.length, limit);
  var result = [];
  for (var i = 0; i < count; i++) {
    var item = container[i];
    var obj = { _index: i };
    for (var j = 0; j < a.propMethods.length; j++) {
      var pm = a.propMethods[j];
      if (a.values.properties && a.values.properties.indexOf(pm.name) < 0) continue;
      try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
    }
    result.push(obj);
  }
  return JSON.stringify(result);
}

function get(a) {
  var app = Application(a.appId);
  var parent = a.values.parent || "";
  var base = parent ? eval("app." + parent)[a.pluralMethod] : app[a.pluralMethod];
  var item;
  if (a.values.id !== undefined) item = base.byId(a.values.id);
  else if (a.values.name !== undefined) item = base.byName(a.values.name);
  else item = base[a.values.index || 0];
  var obj = {};
  for (var j = 0; j < a.propMethods.length; j++) {
    var pm = a.propMethods[j];
    if (a.values.properties && a.values.properties.indexOf(pm.name) < 0) continue;
    try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
  }
  return JSON.stringify(obj);
}

function run(argv) {
  if (!argv.length) return discover();
  var op = decodeStr(argv[0]);
  switch (op) {
    case "command":  return command(decode(argv[1]));
    case "list":     return list(decode(argv[1]));
    case "get":      return get(decode(argv[1]));
    case "execute":  return eval(decode(argv[1]).code);
    default:         return JSON.stringify({ error: "unknown: " + op });
  }
}
