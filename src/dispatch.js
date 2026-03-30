// dispatch.js: Single JXA script that handles all osa-mcp operations.
// Called as: osascript -l JavaScript dispatch.js OPERATION BASE64_ARGS
//
// Operations:
//   discover     - find all scriptable apps and load sdefs
//   command      - execute an sdef command
//   list         - list class instances
//   get          - get a single class instance
//   execute      - run arbitrary code

ObjC.import("Foundation");
ObjC.import("AppKit");

function decode(b64) {
  var d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return JSON.parse($.NSString.alloc.initWithDataEncoding(d, 4).js);
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
    var info = bundle.infoDictionary;
    var sdefObj = info.objectForKey("OSAScriptingDefinition");
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

function command(args) {
  var app = Application(args.appId);
  var namedArgs = {};
  var paramKeys = args.paramKeys;
  for (var i = 0; i < paramKeys.length; i++) {
    var pk = paramKeys[i];
    if (args.values[pk.argKey] !== undefined) namedArgs[pk.jxaKey] = args.values[pk.argKey];
  }
  var hasNamed = Object.keys(namedArgs).length > 0;
  var result;
  if (args.hasDirectParam && args.values.target !== undefined) {
    result = hasNamed ? app[args.method](args.values.target, namedArgs) : app[args.method](args.values.target);
  } else if (hasNamed) {
    result = app[args.method](namedArgs);
  } else {
    result = app[args.method]();
  }
  return JSON.stringify(result);
}

function list(args) {
  var app = Application(args.appId);
  var limit = args.values.limit || 25;
  var parent = args.values.parent || "";
  var container = parent ? eval("app." + parent)[args.pluralMethod]() : app[args.pluralMethod]();
  var count = Math.min(container.length, limit);
  var result = [];
  for (var i = 0; i < count; i++) {
    var item = container[i];
    var obj = {_index: i};
    for (var j = 0; j < args.propMethods.length; j++) {
      var pm = args.propMethods[j];
      if (args.values.properties && args.values.properties.indexOf(pm.name) < 0) continue;
      try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
    }
    result.push(obj);
  }
  return JSON.stringify(result);
}

function get(args) {
  var app = Application(args.appId);
  var parent = args.values.parent || "";
  var base = parent ? eval("app." + parent)[args.pluralMethod] : app[args.pluralMethod];
  var item;
  if (args.values.id !== undefined) {
    item = base.byId(args.values.id);
  } else if (args.values.name !== undefined) {
    item = base.byName(args.values.name);
  } else {
    item = base[args.values.index || 0];
  }
  var obj = {};
  for (var j = 0; j < args.propMethods.length; j++) {
    var pm = args.propMethods[j];
    if (args.values.properties && args.values.properties.indexOf(pm.name) < 0) continue;
    try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
  }
  return JSON.stringify(obj);
}

function run(argv) {
  var op = argv[0];
  if (op === "discover") return discover();
  var args = decode(argv[1]);
  if (op === "command") return command(args);
  if (op === "list") return list(args);
  if (op === "get") return get(args);
  if (op === "execute") {
    // For arbitrary code, we eval it. The code is from the MCP user.
    var lang = args.language || "jxa";
    if (lang === "jxa") return eval(args.code);
    // AppleScript would need a different execution path
    return "Error: use osascript directly for AppleScript";
  }
  return JSON.stringify({error: "unknown operation: " + op});
}
