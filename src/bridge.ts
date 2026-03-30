/**
 * bridge.ts: JXA scripts for macOS introspection.
 *
 * All macOS interaction happens through osascript -l JavaScript.
 * These scripts use ObjC bridge to query Launch Services and
 * load sdef files with XInclude resolution.
 */

/** JXA script to discover all scriptable apps on the system. */
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
  var bundleId = bundle.bundleIdentifier;
  result.push({
    name: displayName
      ? displayName.js.replace(/\\.app$/, "")
      : "unknown",
    bundleId: bundleId ? bundleId.js : null,
    sdefName: sdefKey ? sdefKey.js : null,
    path: path.js,
  });
}
JSON.stringify(result);
`;

/** Build a JXA script to load an app's sdef with XInclude resolution. */
export function buildLoadSdefJxa(appPath: string, sdefName: string): string {
  return `
ObjC.import("Foundation");
var sdefPath = "${appPath}/Contents/Resources/${sdefName}";
var url = $.NSURL.fileURLWithPath(sdefPath);
var error = $();
var xmlDoc = $.NSXMLDocument.alloc.initWithContentsOfURLOptionsError(
  url,
  $.NSXMLDocumentXInclude,
  error
);
if (error[0]) {
  JSON.stringify({error: error[0].localizedDescription.js});
} else {
  xmlDoc.XMLString.js;
}
`;
}

/** Build a JXA script to find an app's path by name (also launches it). */
export function buildFindAppJxa(appName: string): string {
  return `
ObjC.import("Cocoa");
var ws = $.NSWorkspace.sharedWorkspace;
var url = ws.URLForApplicationWithBundleIdentifier("${appName}");
if (!url) {
  // Try by name via running apps or full path search
  var encoded = $.NSString.stringWithString("${appName}");
  url = ws.fullPathForApplication(encoded);
  if (url) {
    JSON.stringify({path: url.js});
  } else {
    JSON.stringify({error: "App not found: ${appName}"});
  }
} else {
  JSON.stringify({path: url.path.js});
}
`;
}
