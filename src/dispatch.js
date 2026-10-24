// dispatch.js: The JXA script behind every osa-mcp operation.
// Run as: osascript -l JavaScript - [BASE64_OP BASE64_ARGS], with this script on stdin.
// With no arguments it discovers the scriptable apps; otherwise the arguments
// are base64: the operation name, then its JSON payload.
//
// JXA bridges a nil return as an object, so a nil check is isNil(), and an
// error out-parameter passed as $() becomes the error object itself:
// https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html#//apple_ref/doc/uid/TP40014508-CH109-SW26
// https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html#//apple_ref/doc/uid/TP40014508-CH109-SW27

ObjC.import("Foundation");
ObjC.import("AppKit");
ObjC.import("ScriptingBridge");
ObjC.import("OSAKit");

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
  const doc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(url, 0, $());
  if (doc.isNil()) return null;
  return doc.rootElement.XMLString.js;
}

function discover() {
  const query = $.NSMetadataQuery.alloc.init;
  query.setPredicate(
    $.NSPredicate.predicateWithFormat(
      'kMDItemContentType == "com.apple.application-bundle"'
    )
  );
  query.startQuery;
  // Spotlight's initial results are in once isGathering is false:
  // https://developer.apple.com/documentation/foundation/nsmetadataquery/isgathering
  // runUntilDate returns only at its date, so the loop runs in 10 ms steps
  // between checks, for at most 3 s.
  const deadline = $.NSDate.dateWithTimeIntervalSinceNow(3);
  while (query.isGathering && deadline.timeIntervalSinceNow > 0) {
    $.NSRunLoop.currentRunLoop.runUntilDate(
      $.NSDate.dateWithTimeIntervalSinceNow(0.01)
    );
  }
  query.stopQuery;

  const apps = [];
  const errors = [];
  for (let i = 0; i < query.resultCount; i++) {
    const item = query.resultAtIndex(i);
    const path = item.valueForAttribute("kMDItemPath");
    if (path.isNil()) continue;
    const bundle = $.NSBundle.bundleWithPath(path);
    if (bundle.isNil()) continue;
    const sdefObj = bundle.infoDictionary.objectForKey("OSAScriptingDefinition");
    if (sdefObj.isNil()) continue;
    let sn;
    try { sn = sdefObj.js; } catch(e) { sn = "" + sdefObj; }
    if (!sn || typeof sn !== "string") continue;
    if (sn.indexOf(".") < 0) sn = sn + ".sdef";

    const displayName = item.valueForAttribute("kMDItemDisplayName");
    const name = displayName.isNil() ? path.lastPathComponent.stringByDeletingPathExtension.js : displayName.js.replace(/\.app$/, "");
    const bundleId = bundle.bundleIdentifier.isNil() ? null : bundle.bundleIdentifier.js;

    const url = $.NSURL.fileURLWithPath(path.js + "/Contents/Resources/" + sn);
    const error = $();
    const xmlDoc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(
      url, $.NSXMLDocumentXInclude, error
    );
    if (xmlDoc.isNil()) {
      errors.push({ name: name, error: error.localizedDescription.js });
      continue;
    }
    // The dictionary element without the DTD: iWork's DTDs declare
    // parameter entities, which fast-xml-parser rejects.
    apps.push({ name: name, bundleId: bundleId, sdef: xmlDoc.rootElement.XMLString.js });
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

// A string result is returned as it is; any other value as its source text,
// as osascript -s s prints it, which keeps lists, records and object
// specifiers whole: Automation.getDisplayString for JXA, the display value
// Script Editor shows for AppleScript.
// https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html#//apple_ref/doc/uid/TP40014508-CH109-SW54
// and OSAScript's -executeAndReturnDisplayValue:error: in the macOS SDK's
// OSAKit.framework/Headers/OSAScript.h.
function execute(a) {
  switch (a.language) {
    case "applescript": {
      const script = $.OSAScript.alloc.initWithSourceLanguage(a.code, $.OSALanguage.languageForName("AppleScript"));
      const display = $();
      const error = $();
      const result = script.executeAndReturnDisplayValueError(display, error);
      if (result.isNil()) {
        throw new Error(error.objectForKey($.OSAScriptErrorMessageKey).js + " (" + error.objectForKey($.OSAScriptErrorNumberKey).js + ")");
      }
      // The bridge gives the type constant as a string and descriptorType as a number.
      return result.descriptorType === Number($.typeUnicodeText) ? result.stringValue.js : display.string.js;
    }
    case "jxa": {
      const value = eval(a.code);
      return typeof value === "string" ? value : Automation.getDisplayString(value);
    }
    default:
      throw new Error("unknown language: " + a.language);
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
    default:         throw new Error("unknown operation: " + op);
  }
}
