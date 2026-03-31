/**
 * generator.ts: Convert parsed sdef into FastMCP tool registrations.
 *
 * Each tool calls executor.dispatch() with an operation name and
 * a data payload. No JXA code is generated here. dispatch.js handles
 * all execution logic.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { Sdef, SdefClass, IntrinsicType } from "./sdef.js";
import type { Executor } from "./executor.js";

function toolName(prefix: string, name: string): string {
  return `${prefix}_${name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase()}`;
}

function jxaMethodName(sdefName: string): string {
  const words = sdefName.split(/\s+/);
  return words[0]!.toLowerCase() + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

function sdefTypeToZod(
  type: string,
  enums: Map<string, EnumInfo>,
  classes: Map<string, SdefClass>,
  intrinsics: Map<string, IntrinsicType>
): z.ZodTypeAny {
  // Check intrinsics first (canonical Apple type mapping)
  const intrinsic = intrinsics.get(type);
  if (intrinsic) {
    switch (intrinsic.jsType) {
      case "number": return intrinsic.name === "integer" ? z.number().int() : z.number();
      case "boolean": return z.boolean();
      case "array": return z.array(z.unknown());
      case "object": return z.string().describe("JSON object as string");
      case "any": return z.string();
      case "string": return z.string();
    }
  }

  // Check enums (include value descriptions)
  const enumInfo = enums.get(type);
  if (enumInfo && enumInfo.values.length > 0) {
    const e = z.enum(enumInfo.values as [string, ...string[]]);
    const descs = [...enumInfo.descriptions.entries()];
    if (descs.length > 0) {
      return e.describe(descs.map(([k, v]) => `${k}: ${v}`).join(". "));
    }
    return e;
  }

  // Check class references
  const cls = classes.get(type);
  if (cls) {
    const desc = cls.description ? `${type}: ${cls.description}` : `${type} specifier`;
    return z.string().describe(desc);
  }

  // Fallback
  return z.string();
}

interface EnumInfo {
  values: string[];
  descriptions: Map<string, string>;
}

function buildEnumMap(sdef: Sdef): Map<string, EnumInfo> {
  const map = new Map<string, EnumInfo>();
  for (const e of sdef.enums) {
    const descriptions = new Map<string, string>();
    for (const v of e.values) {
      if (v.description) descriptions.set(v.name, v.description);
    }
    map.set(e.name, { values: e.values.map((v) => v.name), descriptions });
  }
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

// Track all registered tool names to avoid collisions
const registeredTools = new Set<string>();

export function registerCommands(
  server: FastMCP, sdef: Sdef, appName: string, appId: string, executor: Executor,
  intrinsics: Map<string, IntrinsicType> = new Map()
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");
  const enums = buildEnumMap(sdef);
  const classes = buildClassMap(sdef);

  for (const cmd of sdef.commands) {
    if (["open", "close", "count", "exists", "make", "set", "get"].includes(cmd.name)) continue;

    const name = toolName(prefix, cmd.name);
    if (registeredTools.has(name)) continue;
    let description = `[${appName}] ${cmd.description || cmd.name}`;
    if (cmd.result) {
      description += ` Returns: ${cmd.result.description || cmd.result.type}.`;
    }

    const shape: Record<string, z.ZodTypeAny> = {};
    if (cmd.directParam) {
      let s = sdefTypeToZod(cmd.directParam.type, enums, classes, intrinsics);
      if (cmd.directParam.description) s = s.describe(cmd.directParam.description);
      if (cmd.directParam.optional) s = s.optional();
      shape["target"] = s;
    }
    for (const p of cmd.params) {
      const paramKey = p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      let s = sdefTypeToZod(p.type, enums, classes, intrinsics);
      if (p.description) s = s.describe(p.description);
      if (p.optional) s = s.optional();
      shape[paramKey] = s;
    }

    const meta = {
      appId,
      method: jxaMethodName(cmd.name),
      hasDirectParam: !!cmd.directParam,
      paramKeys: cmd.params.map((p) => ({
        argKey: p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, ""),
        jxaKey: jxaMethodName(p.name),
      })),
    };

    registeredTools.add(name);
    server.addTool({
      name,
      description,
      parameters: z.object(shape),
      execute: async (args: Record<string, any>) => {
        try {
          return await executor.dispatch("command", { ...meta, values: args });
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });
  }
}

export function registerClasses(
  server: FastMCP, sdef: Sdef, appName: string, appId: string, executor: Executor,
  intrinsics: Map<string, IntrinsicType> = new Map()
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");
  const containment = buildContainment(sdef);
  const skip = new Set(["rich text", "paragraph", "word", "character", "attribute run", "attachment"]);

  // Register root application properties tool
  const appProps = sdef.application.properties.filter((p) => p.access !== "w");
  if (appProps.length > 0) {
    const appToolName = toolName(prefix, "get_application");
    if (!registeredTools.has(appToolName)) {
      const appPropDescs = appProps.map((p) => p.description ? `${p.name} (${p.description})` : p.name);
      const appPropNames = appProps.map((p) => p.name);
      const appChildren = sdef.application.elements.map((e) => e.type);
      const childHint = appChildren.length > 0 ? ` Contains: ${appChildren.join(", ")}.` : "";
      const appMeta = {
        appId,
        isSingleton: true,
        propMethods: appProps.map((p) => ({ name: p.name, method: jxaMethodName(p.name) })),
      };
      registeredTools.add(appToolName);
      server.addTool({
        name: appToolName,
        description: `[${appName}] Get ${appName} application properties.${childHint} Properties: ${appPropDescs.join(", ")}`,
        parameters: z.object({
          properties: z.array(z.string()).optional().describe(`Filter properties. Available: ${appPropDescs.join(", ")}`),
        }),
        execute: async (args: Record<string, any>) => {
          try {
            return await executor.dispatch("get", { ...appMeta, values: args });
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      });
    }
  }

  // Register collection classes (list + get tools)
  for (const cls of sdef.classes) {
    if (skip.has(cls.name)) continue;
    const readableProps = cls.properties.filter((p) => p.access !== "w");
    if (readableProps.length === 0) continue;

    const plural = cls.plural || `${cls.name}s`;
    const propDescs = readableProps.map((p) => p.description ? `${p.name} (${p.description})` : p.name);
    const propNames = readableProps.map((p) => p.name);
    const parents = containment.get(cls.name) ?? [];
    const children = cls.elements.map((e) => e.type);
    const classDesc = cls.description ? ` ${cls.description}` : "";
    const parentHint = parents.length > 0 ? ` Found inside: ${parents.join(", ")}.` : "";
    const childHint = children.length > 0 ? ` Contains: ${children.join(", ")}.` : "";

    const listName = toolName(prefix, `list_${plural}`);
    const getName = toolName(prefix, `get_${cls.name}`);
    if (registeredTools.has(listName)) continue;

    const meta = {
      appId,
      pluralMethod: jxaMethodName(plural),
      propMethods: readableProps.map((p) => ({ name: p.name, method: jxaMethodName(p.name) })),
    };

    registeredTools.add(listName);
    registeredTools.add(getName);
    server.addTool({
      name: listName,
      description: `[${appName}] List ${plural}.${classDesc}${parentHint}${childHint} Properties: ${propDescs.join(", ")}`,
      parameters: z.object({
        limit: z.number().int().optional().describe("Max items (default 25)"),
        parent: z.array(z.union([z.string(), z.number(), z.array(z.any())])).optional().describe("Parent path steps: 'key'=property, 0=index, []=call, ['arg']=call with args. e.g. ['inbox'] or ['calendars','byName',['US Holidays']]"),
        properties: z.array(z.string()).optional().describe(`Filter properties. Available: ${propDescs.join(", ")}`),
      }),
      execute: async (args: Record<string, any>) => {
        try {
          return await executor.dispatch("list", { ...meta, values: args });
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    server.addTool({
      name: getName,
      description: `[${appName}] Get a ${cls.name} by index or name.${classDesc}${parentHint} Properties: ${propDescs.join(", ")}`,
      parameters: z.object({
        index: z.number().int().optional().describe("0-based index"),
        name: z.string().optional().describe("Name to match"),
        id: z.number().int().optional().describe("ID to match"),
        parent: z.array(z.union([z.string(), z.number(), z.array(z.any())])).optional().describe("Parent path steps"),
        properties: z.array(z.string()).optional().describe(`Filter properties. Available: ${propDescs.join(", ")}`),
      }),
      execute: async (args: Record<string, any>) => {
        try {
          return await executor.dispatch("get", { ...meta, values: args });
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });
  }
}
