/**
 * generator.ts: Convert parsed sdef into FastMCP tool registrations.
 *
 * All user input is passed via __args (JSON data payload) to JXA.
 * No user strings are ever interpolated into JXA code.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { Sdef, SdefCommand, SdefClass } from "./sdef.js";
import type { Executor } from "./executor.js";

/** Sanitize a name for use as a tool name. */
function toolName(prefix: string, name: string): string {
  return `${prefix}_${name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase()}`;
}

/** Convert sdef name to JXA camelCase method name. */
function jxaMethodName(sdefName: string): string {
  const words = sdefName.split(/\s+/);
  return words[0].toLowerCase() + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

/** Build enum/class-aware Zod type. */
function sdefTypeToZod(
  type: string,
  enums: Map<string, string[]>,
  classes: Map<string, SdefClass>
): z.ZodTypeAny {
  switch (type) {
    case "integer": return z.number().int();
    case "real": case "number": return z.number();
    case "boolean": return z.boolean();
    case "text": case "string": return z.string();
    case "date": return z.string().describe("ISO date string");
    case "file": return z.string().describe("POSIX file path");
    default: {
      const enumValues = enums.get(type);
      if (enumValues && enumValues.length > 0) {
        return z.enum(enumValues as [string, ...string[]]);
      }
      const cls = classes.get(type);
      if (cls) return z.string().describe(`${type} specifier`);
      return z.string();
    }
  }
}

function buildEnumMap(sdef: Sdef): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of sdef.enums) map.set(e.name, e.values.map((v) => v.name));
  return map;
}

function buildClassMap(sdef: Sdef): Map<string, SdefClass> {
  const map = new Map<string, SdefClass>();
  for (const cls of sdef.classes) map.set(cls.name, cls);
  return map;
}

function buildContainment(sdef: Sdef): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const cls of sdef.classes) {
    for (const el of cls.elements) {
      if (!map.has(el.type)) map.set(el.type, []);
      map.get(el.type)!.push(cls.name);
    }
  }
  return map;
}

// --- Static JXA templates ---
// Each is a complete self-contained script with function run(argv).
// __meta is baked in at registration time (from sdef, safe).
// argv[0] is base64-encoded JSON from the user (decoded at runtime).

const DECODE_PREAMBLE = `ObjC.import("Foundation");
function __decode(b64) {
  var d = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return JSON.parse($.NSString.alloc.initWithDataEncoding(d, 4).js);
}`;

const COMMAND_JXA = `${DECODE_PREAMBLE}
function run(argv) {
  var __args = __decode(argv[0]);
  var app = Application(__meta.appId);
  var method = __meta.method;
  var paramKeys = __meta.paramKeys;
  var namedArgs = {};
  for (var i = 0; i < paramKeys.length; i++) {
    var pk = paramKeys[i];
    if (__args[pk.argKey] !== undefined) namedArgs[pk.jxaKey] = __args[pk.argKey];
  }
  var hasNamed = Object.keys(namedArgs).length > 0;
  var result;
  if (__meta.hasDirectParam && __args.target !== undefined) {
    result = hasNamed ? app[method](__args.target, namedArgs) : app[method](__args.target);
  } else if (hasNamed) {
    result = app[method](namedArgs);
  } else {
    result = app[method]();
  }
  return JSON.stringify(result);
}`;

const LIST_JXA = `${DECODE_PREAMBLE}
function run(argv) {
  var __args = __decode(argv[0]);
  var app = Application(__meta.appId);
  var limit = __args.limit || 25;
  var parent = __args.parent || "";
  var propMethods = __meta.propMethods;
  var pluralMethod = __meta.pluralMethod;
  var container = parent ? eval("app." + parent)[pluralMethod]() : app[pluralMethod]();
  var count = Math.min(container.length, limit);
  var result = [];
  for (var i = 0; i < count; i++) {
    var item = container[i];
    var obj = {_index: i};
    for (var j = 0; j < propMethods.length; j++) {
      var pm = propMethods[j];
      if (__args.properties && __args.properties.indexOf(pm.name) < 0) continue;
      try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
    }
    result.push(obj);
  }
  return JSON.stringify(result);
}`;

const GET_JXA = `${DECODE_PREAMBLE}
function run(argv) {
  var __args = __decode(argv[0]);
  var app = Application(__meta.appId);
  var parent = __args.parent || "";
  var propMethods = __meta.propMethods;
  var pluralMethod = __meta.pluralMethod;
  var base = parent ? eval("app." + parent)[pluralMethod] : app[pluralMethod];
  var item;
  if (__args.id !== undefined) {
    item = base.byId(__args.id);
  } else if (__args.name !== undefined) {
    item = base.byName(__args.name);
  } else {
    item = base[__args.index || 0];
  }
  var obj = {};
  for (var j = 0; j < propMethods.length; j++) {
    var pm = propMethods[j];
    if (__args.properties && __args.properties.indexOf(pm.name) < 0) continue;
    try { obj[pm.name] = item[pm.method](); } catch(e) { obj[pm.name] = null; }
  }
  return JSON.stringify(obj);
}`;

/** Register sdef commands as MCP tools. */
export function registerCommands(
  server: FastMCP,
  sdef: Sdef,
  appName: string,
  appId: string,
  executor: Executor
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");
  const enums = buildEnumMap(sdef);
  const classes = buildClassMap(sdef);

  for (const cmd of sdef.commands) {
    if (["open", "close", "count", "exists", "make", "set", "get"].includes(cmd.name)) continue;

    const name = toolName(prefix, cmd.name);
    const description = `[${appName}] ${cmd.description || cmd.name}`.slice(0, 500);

    const shape: Record<string, z.ZodTypeAny> = {};
    if (cmd.directParam) {
      let s = sdefTypeToZod(cmd.directParam.type, enums, classes);
      if (cmd.directParam.description) s = s.describe(cmd.directParam.description);
      if (cmd.directParam.optional) s = s.optional();
      shape["target"] = s;
    }
    for (const p of cmd.params) {
      const paramKey = p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      let s = sdefTypeToZod(p.type, enums, classes);
      if (p.description) s = s.describe(p.description);
      if (p.optional) s = s.optional();
      shape[paramKey] = s;
    }

    // Pre-compute sdef-derived constants (safe, not from user input)
    const meta = {
      appId,
      method: jxaMethodName(cmd.name),
      hasDirectParam: !!cmd.directParam,
      paramKeys: cmd.params.map((p) => ({
        argKey: p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, ""),
        jxaKey: jxaMethodName(p.name),
      })),
    };

    server.addTool({
      name,
      description,
      parameters: z.object(shape),
      execute: async (args: Record<string, any>) => {
        const jxa = `var __meta = ${JSON.stringify(meta)};\n${COMMAND_JXA}`;
        try {
          return await executor.execute(jxa, "jxa", args);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });
  }
}

/** Register sdef classes as list/get tools. */
export function registerClasses(
  server: FastMCP,
  sdef: Sdef,
  appName: string,
  appId: string,
  executor: Executor
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");
  const containment = buildContainment(sdef);
  const enums = buildEnumMap(sdef);
  const classes = buildClassMap(sdef);
  const skip = new Set(["rich text", "paragraph", "word", "character", "attribute run", "attachment"]);

  for (const cls of sdef.classes) {
    if (skip.has(cls.name)) continue;
    const readableProps = cls.properties.filter((p) => p.access !== "w");
    if (readableProps.length === 0) continue;

    const plural = cls.plural || `${cls.name}s`;
    const propNames = readableProps.map((p) => p.name);
    const parents = containment.get(cls.name) ?? [];
    const children = cls.elements.map((e) => e.type);
    const parentHint = parents.length > 0 ? ` Found inside: ${parents.join(", ")}.` : "";
    const childHint = children.length > 0 ? ` Contains: ${children.join(", ")}.` : "";

    // Pre-compute sdef-derived constants
    const meta = {
      appId,
      pluralMethod: jxaMethodName(plural),
      propMethods: readableProps.map((p) => ({
        name: p.name,
        method: jxaMethodName(p.name),
      })),
    };

    const listName = toolName(prefix, `list_${plural}`);
    server.addTool({
      name: listName,
      description: `[${appName}] List ${plural}.${parentHint}${childHint} Properties: ${propNames.join(", ")}`.slice(0, 500),
      parameters: z.object({
        limit: z.number().int().optional().describe("Max items (default 25)"),
        parent: z.string().optional().describe("Parent object path, e.g. 'inbox' or 'accounts[0].mailboxes[0]'"),
        properties: z.array(z.string()).optional().describe(`Filter properties. Available: ${propNames.join(", ")}`),
      }),
      execute: async (args: Record<string, any>) => {
        const jxa = `var __meta = ${JSON.stringify(meta)};\n${LIST_JXA}`;
        try {
          return await executor.execute(jxa, "jxa", args);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    const getName = toolName(prefix, `get_${cls.name}`);
    server.addTool({
      name: getName,
      description: `[${appName}] Get a ${cls.name} by index or name.${parentHint} Properties: ${propNames.join(", ")}`.slice(0, 500),
      parameters: z.object({
        index: z.number().int().optional().describe("0-based index"),
        name: z.string().optional().describe("Name to match"),
        id: z.number().int().optional().describe("ID to match"),
        parent: z.string().optional().describe("Parent object path"),
        properties: z.array(z.string()).optional().describe(`Filter properties. Available: ${propNames.join(", ")}`),
      }),
      execute: async (args: Record<string, any>) => {
        const jxa = `var __meta = ${JSON.stringify(meta)};\n${GET_JXA}`;
        try {
          return await executor.execute(jxa, "jxa", args);
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });
  }
}
