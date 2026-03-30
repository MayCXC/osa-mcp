/**
 * bridge.ts: JXA scripts for macOS introspection.
 *
 * All macOS interaction happens through osascript -l JavaScript.
 * These scripts use ObjC bridge to query Launch Services and
 * load sdef files with XInclude resolution.
 */

/**
 * JXA script to discover all scriptable apps AND load their sdefs
 * in a single call. Uses NSMetadataQuery for discovery and
 * NSXMLDocument with XInclude for sdef resolution.
 *
 * Returns JSON: { apps: [{ name, bundleId, sdef }] }
 * where sdef is the full XInclude-resolved XML string.
 */
export const DISCOVER_AND_LOAD_JXA = `
ObjC.import("Cocoa");

var query = $.NSMetadataQuery.alloc.init;
query.setPredicate(
  $.NSPredicate.predicateWithFormat(
    "kMDItemContentType == \\"com.apple.application-bundle\\""
  )
);
query.startQuery;
$.NSRunLoop.currentRunLoop.runUntilDate(
  $.NSDate.dateWithTimeIntervalSinceNow(3)
);
query.stopQuery;

var apps = [];
for (var i = 0; i < query.resultCount; i++) {
  var item = query.resultAtIndex(i);
  var path = item.valueForAttribute("kMDItemPath");
  if (!path) continue;
  var bundle = $.NSBundle.bundleWithPath(path);
  if (!bundle || !bundle.infoDictionary) continue;
  var info = bundle.infoDictionary;
  var sdefKey = info.objectForKey("OSAScriptingDefinition");
  if (!sdefKey) continue;

  var displayName = item.valueForAttribute("kMDItemDisplayName");
  var name = displayName ? displayName.js.replace(/\\.app$/, "") : "unknown";
  var bundleId = bundle.bundleIdentifier ? bundle.bundleIdentifier.js : null;
  var sdefName;
  try { sdefName = sdefKey.js; } catch(e) { sdefName = "" + sdefKey; }
  if (!sdefName || typeof sdefName !== "string") continue;

  // Construct sdef path. Some apps omit the .sdef extension.
  if (sdefName.indexOf(".") < 0) sdefName = sdefName + ".sdef";
  var sdefPath = path.js + "/Contents/Resources/" + sdefName;

  try {
    var url = $.NSURL.fileURLWithPath(sdefPath);
    var error = $();
    var xmlDoc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(
      url, $.NSXMLDocumentXInclude, error
    );
    if (!xmlDoc || error[0]) continue;
    var xml = xmlDoc.XMLString;
    if (!xml) continue;
    apps.push({ name: name, bundleId: bundleId, sdef: xml.js ? xml.js : "" + xml });
  } catch(e) {}
}
JSON.stringify(apps);
`;

/**
 * JXA script to list all scriptable apps (discovery only, no sdef loading).
 * Faster than DISCOVER_AND_LOAD_JXA when you just need the list.
 */
export const DISCOVER_APPS_JXA = `
ObjC.import("Cocoa");

var query = $.NSMetadataQuery.alloc.init;
query.setPredicate(
  $.NSPredicate.predicateWithFormat(
    "kMDItemContentType == \\"com.apple.application-bundle\\""
  )
);
query.startQuery;
$.NSRunLoop.currentRunLoop.runUntilDate(
  $.NSDate.dateWithTimeIntervalSinceNow(3)
);
query.stopQuery;

var result = [];
for (var i = 0; i < query.resultCount; i++) {
  var item = query.resultAtIndex(i);
  var path = item.valueForAttribute("kMDItemPath");
  if (!path) continue;
  var bundle = $.NSBundle.bundleWithPath(path);
  if (!bundle || !bundle.infoDictionary) continue;
  var info = bundle.infoDictionary;
  var scriptable = info.objectForKey("NSAppleScriptEnabled");
  var sdefKey = info.objectForKey("OSAScriptingDefinition");
  if ((!scriptable || !scriptable.boolValue) && !sdefKey) continue;
  var displayName = item.valueForAttribute("kMDItemDisplayName");
  result.push({
    name: displayName ? displayName.js.replace(/\\.app$/, "") : "unknown",
    bundleId: bundle.bundleIdentifier ? bundle.bundleIdentifier.js : null,
    sdefName: sdefKey ? sdefKey.js : null,
  });
}
JSON.stringify(result);
`;
