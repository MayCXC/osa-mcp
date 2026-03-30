/**
 * generator.ts: Convert parsed sdef into FastMCP tool registrations.
 *
 * Strategy: keep it simple like echochat's OpenAPI -> fetch approach.
 * Every tool maps to a single JXA expression. No complex code generation.
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

/** Map sdef type to Zod. Keep it simple: everything that isn't a primitive becomes a string. */
function sdefTypeToZod(type: string): z.ZodTypeAny {
  switch (type) {
    case "integer":
      return z.number().int();
    case "real":
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default:
      return z.string();
  }
}

/** Escape a value for embedding in JXA code. */
function jxaValue(val: unknown): string {
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return JSON.stringify(String(val));
}

/** Register sdef commands as MCP tools. */
export function registerCommands(
  server: FastMCP,
  sdef: Sdef,
  appName: string,
  appId: string,
  executor: Executor
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");

  for (const cmd of sdef.commands) {
    // Skip generic CRUD that need object specifiers to be useful
    if (["open", "close", "count", "exists", "make", "set", "get"].includes(cmd.name)) continue;

    const name = toolName(prefix, cmd.name);
    const description = `[${appName}] ${cmd.description || cmd.name}`.slice(0, 500);

    // Build parameter schema
    const shape: Record<string, z.ZodTypeAny> = {};
    if (cmd.directParam) {
      let s = sdefTypeToZod(cmd.directParam.type);
      if (cmd.directParam.description) s = s.describe(cmd.directParam.description);
      if (cmd.directParam.optional) s = s.optional();
      shape["target"] = s;
    }
    for (const p of cmd.params) {
      const paramKey = p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      let s = sdefTypeToZod(p.type);
      if (p.description) s = s.describe(p.description);
      if (p.optional) s = s.optional();
      shape[paramKey] = s;
    }

    const parameters = z.object(shape);

    server.addTool({
      name,
      description,
      parameters,
      execute: async (args: Record<string, any>) => {
        const method = jxaMethodName(cmd.name);
        const parts: string[] = [];
        parts.push(`const app = Application(${JSON.stringify(appId)});`);

        // Build args object for named parameters
        const namedArgs: string[] = [];
        for (const p of cmd.params) {
          const paramKey = p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
          if (args[paramKey] === undefined) continue;
          namedArgs.push(`${jxaMethodName(p.name)}: ${jxaValue(args[paramKey])}`);
        }

        if (cmd.directParam && args.target !== undefined) {
          if (namedArgs.length > 0) {
            parts.push(`const result = app.${method}(${jxaValue(args.target)}, {${namedArgs.join(", ")}});`);
          } else {
            parts.push(`const result = app.${method}(${jxaValue(args.target)});`);
          }
        } else if (namedArgs.length > 0) {
          parts.push(`const result = app.${method}({${namedArgs.join(", ")}});`);
        } else {
          parts.push(`const result = app.${method}();`);
        }

        parts.push(`JSON.stringify(result);`);
        const jxa = parts.join("\n");

        try {
          return await executor.execute(jxa, "jxa");
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });
  }
}

/** Build the containment map from sdef classes (which classes contain which elements). */
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

/** Register sdef classes as read tools. */
export function registerClasses(
  server: FastMCP,
  sdef: Sdef,
  appName: string,
  appId: string,
  executor: Executor
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");
  const containment = buildContainment(sdef);

  // Skip text/formatting classes
  const skip = new Set(["rich text", "paragraph", "word", "character", "attribute run", "attachment"]);

  for (const cls of sdef.classes) {
    if (skip.has(cls.name)) continue;
    const readableProps = cls.properties.filter((p) => p.access !== "w");
    if (readableProps.length === 0) continue;

    const plural = cls.plural || `${cls.name}s`;
    const propNames = readableProps.map((p) => p.name);

    // List tool
    const listName = toolName(prefix, `list_${plural}`);
    server.addTool({
      name: listName,
      description: `[${appName}] List ${plural}. Properties: ${propNames.join(", ")}`.slice(0, 500),
      parameters: z.object({
        limit: z.number().int().optional().describe("Max items (default 25)"),
        parent: z.string().optional().describe("Parent object path in JXA dot notation, e.g. 'inbox' or 'accounts[0].mailboxes[0]'"),
        properties: z.array(z.string()).optional().describe(`Properties to return. Available: ${propNames.join(", ")}`),
      }),
      execute: async (args: Record<string, any>) => {
        const limit = args.limit ?? 25;
        const props = args.properties ?? propNames.slice(0, 5);
        const parent = args.parent ?? "";
        const jxaPlural = jxaMethodName(plural);
        const accessor = parent ? `app.${parent}.${jxaPlural}` : `app.${jxaPlural}`;

        const propLines = (props as string[]).map((p: string) => {
          const method = jxaMethodName(p);
          return `    try { obj[${JSON.stringify(p)}] = item.${method}(); } catch(e) { obj[${JSON.stringify(p)}] = null; }`;
        });

        const jxa = `const app = Application(${JSON.stringify(appId)});
const items = ${accessor}();
const count = Math.min(items.length, ${limit});
const result = [];
for (let i = 0; i < count; i++) {
  const item = items[i];
  const obj = {_index: i};
${propLines.join("\n")}
  result.push(obj);
}
JSON.stringify(result);`;

        try {
          return await executor.execute(jxa, "jxa");
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });

    // Get tool
    const getName = toolName(prefix, `get_${cls.name}`);
    server.addTool({
      name: getName,
      description: `[${appName}] Get a ${cls.name} by index or name. Properties: ${propNames.join(", ")}`.slice(0, 500),
      parameters: z.object({
        index: z.number().int().optional().describe("0-based index"),
        name: z.string().optional().describe("Name to match"),
        id: z.number().int().optional().describe("ID to match"),
        parent: z.string().optional().describe("Parent object path in JXA dot notation"),
        properties: z.array(z.string()).optional().describe(`Properties to return. Available: ${propNames.join(", ")}`),
      }),
      execute: async (args: Record<string, any>) => {
        const props = args.properties ?? propNames;
        const parent = args.parent ?? "";
        const jxaPlural = jxaMethodName(plural);
        const base = parent ? `app.${parent}.${jxaPlural}` : `app.${jxaPlural}`;

        let accessor: string;
        if (args.id !== undefined) {
          accessor = `${base}.byId(${args.id})`;
        } else if (args.name !== undefined) {
          accessor = `${base}.byName(${JSON.stringify(args.name)})`;
        } else {
          accessor = `${base}[${args.index ?? 0}]`;
        }

        const propLines = (props as string[]).map((p: string) => {
          const method = jxaMethodName(p);
          return `  try { obj[${JSON.stringify(p)}] = item.${method}(); } catch(e) { obj[${JSON.stringify(p)}] = null; }`;
        });

        const jxa = `const app = Application(${JSON.stringify(appId)});
const item = ${accessor};
const obj = {};
${propLines.join("\n")}
JSON.stringify(obj);`;

        try {
          return await executor.execute(jxa, "jxa");
        } catch (e: any) {
          return `Error: ${e.message}`;
        }
      },
    });
  }
}
