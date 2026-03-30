// dispatch.js: Single JXA script that handles all osa-mcp operations.
// Called as: osascript -l JavaScript dispatch.js BASE64_OP [BASE64_ARGS...]
// All argv are base64-encoded. First is the operation name, rest are JSON payloads.

ObjC.import("Foundation");
ObjC.import("AppKit");
ObjC.import("ScriptingBridge");

function decode(b64) {
  const d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return JSON.parse($.NSString.alloc.initWithDataEncoding(d, 4).js);
}

function decodeStr(b64) {
  const d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return $.NSString.alloc.initWithDataEncoding(d, 4).js;
}

function loadIntrinsics() {
  const bundle = $.NSBundle.bundleForClass($.SBApplication);
  const url = $.NSURL.fileURLWithPath(bundle.resourcePath.js + "/intrinsics.sdef");
  const error = $();
  const doc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(url, 0, error);
  if (!doc || error[0]) return null;
  return doc.XMLString.js;
}

function discover() {
  const query = $.NSMetadataQuery.alloc.init;
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

  const apps = [];
  const errors = [];
  for (let i = 0; i < query.resultCount; i++) {
    const item = query.resultAtIndex(i);
    const path = item.valueForAttribute("kMDItemPath");
    if (!path) continue;
    const bundle = $.NSBundle.bundleWithPath(path);
    if (!bundle || !bundle.infoDictionary) continue;
    const sdefObj = bundle.infoDictionary.objectForKey("OSAScriptingDefinition");
    if (!sdefObj) continue;

    const displayName = item.valueForAttribute("kMDItemDisplayName");
    const name = displayName ? displayName.js.replace(/\.app$/, "") : "unknown";
    const bundleId = bundle.bundleIdentifier ? bundle.bundleIdentifier.js : null;
    let sn;
    try { sn = sdefObj.js; } catch(e) { sn = "" + sdefObj; }
    if (!sn || typeof sn !== "string") continue;
    if (sn.indexOf(".") < 0) sn = sn + ".sdef";

    const url = $.NSURL.fileURLWithPath(path.js + "/Contents/Resources/" + sn);
    const error = $();
    const xmlDoc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(
      url, $.NSXMLDocumentXInclude, error
    );
    if (!xmlDoc || error[0]) {
      errors.push({ name: name, error: error[0] ? "" + error[0].localizedDescription : "load failed" });
      continue;
    }
    const xml = xmlDoc.XMLString;
    if (!xml) {
      errors.push({ name: name, error: "XMLString nil" });
      continue;
    }
    apps.push({ name: name, bundleId: bundleId, sdef: xml.js });
  }
  return JSON.stringify({ apps: apps, errors: errors, intrinsics: loadIntrinsics() });
}

function command(a) {
  const app = Application(a.appId);
  const namedArgs = {};
  for (let i = 0; i < a.paramKeys.length; i++) {
    const pk = a.paramKeys[i];
    if (a.values[pk.argKey] !== undefined) namedArgs[pk.jxaKey] = a.values[pk.argKey];
  }
  const hasNamed = Object.keys(namedArgs).length > 0;
  if (a.hasDirectParam && a.values.target !== undefined) {
    return JSON.stringify(hasNamed ? app[a.method](a.values.target, namedArgs) : app[a.method](a.values.target));
  }
  if (hasNamed) return JSON.stringify(app[a.method](namedArgs));
  return JSON.stringify(app[a.method]());
}

// Resolve a parent path. Each step:
//   "key"          -> obj.key
//   0              -> obj[0]
//   []             -> obj()
//   ["a1", "a2"]   -> obj("a1","a2")
// JXA proxy methods need their parent as `this`, so array steps
// use apply on the previous object.
function resolve(app, path) {
  let parent = null;
  let obj = app;
  for (const step of path) {
    if (Array.isArray(step)) {
      obj = obj.apply(parent, step);
      parent = null;
    } else {
      parent = obj;
      obj = obj[step];
    }
  }
  return obj;
}

function list(a) {
  const app = Application(a.appId);
  const limit = a.values.limit || 25;
  const parent = a.values.parent || [];
  const base = parent.length ? resolve(app, parent) : app;
  const container = base[a.pluralMethod]();
  const count = Math.min(container.length, limit);
  const result = [];
  for (let i = 0; i < count; i++) {
    let item = container[i];
    let obj = { _index: i };
    for (let j = 0; j < a.propMethods.length; j++) {
      const pm = a.propMethods[j];
      if (a.values.properties && a.values.properties.indexOf(pm.name) < 0) continue;
      try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
    }
    result.push(obj);
  }
  return JSON.stringify(result);
}

function get(a) {
  const app = Application(a.appId);
  const parent = a.values.parent || [];
  const base = parent.length ? resolve(app, parent) : app;
  var item;
  if (a.isSingleton) {
    item = base;
  } else {
    var collection = base[a.pluralMethod];
    if (a.values.id !== undefined) item = collection.byId(a.values.id);
    else if (a.values.name !== undefined) item = collection.byName(a.values.name);
    else item = collection[a.values.index || 0];
  }
  var obj = {};
  for (var j = 0; j < a.propMethods.length; j++) {
    var pm = a.propMethods[j];
    if (a.values.properties && a.values.properties.indexOf(pm.name) < 0) continue;
    try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
  }
  return JSON.stringify(obj);
}

function execute(a) {
  switch (a.language) {
    case "applescript": {
      const script = $.NSAppleScript.alloc.initWithSource(a.code);
      const error = $();
      const result = script.executeAndReturnError(error);
      if (error[0]) return JSON.stringify({ error: error[0].objectForKey($.NSAppleScriptErrorMessage).js });
      return result.stringValue ? result.stringValue.js : "";
    }
    case "jxa":
      return eval(a.code);
    default:
      return JSON.stringify({ error: "unknown language: " + a.language });
  }
}

function run(argv) {
  if (!argv.length) return discover();
  const op = decodeStr(argv[0]);
  switch (op) {
    case "command":  return command(decode(argv[1]));
    case "list":     return list(decode(argv[1]));
    case "get":      return get(decode(argv[1]));
    case "execute":  return execute(decode(argv[1]));
    default:         return JSON.stringify({ error: "unknown: " + op });
  }
}
