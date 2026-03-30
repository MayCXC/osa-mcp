/**
 * generator.ts: Convert parsed sdef into FastMCP tool registrations.
 *
 * Generates JXA code for each sdef command. The JXA Application object
 * maps directly to sdef classes and commands.
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { Sdef, SdefCommand, SdefClass } from "./sdef.js";
import type { Executor } from "./executor.js";

/** Map sdef type names to Zod schemas. */
function sdefTypeToZod(type: string): z.ZodTypeAny {
  switch (type) {
    case "integer":
      return z.number().int();
    case "real":
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "text":
    case "string":
      return z.string();
    case "file":
      return z.string().describe("file path");
    case "specifier":
    case "location specifier":
      return z.string().describe("object specifier");
    case "record":
      return z.string().describe("JSON object as string");
    case "date":
      return z.string().describe("date string");
    case "list":
      return z.array(z.unknown());
    case "type":
      return z.string().describe("type name");
    default:
      return z.string();
  }
}

/** Sanitize a name for use as a tool name (lowercase, underscores). */
function toolName(prefix: string, name: string): string {
  return `${prefix}_${name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").toLowerCase()}`;
}

/** Escape a string for use in JXA. */
function jxaEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
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
    // Skip standard suite commands that aren't useful as standalone tools
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
      const paramName = p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      let s = sdefTypeToZod(p.type);
      if (p.description) s = s.describe(p.description);
      if (p.optional) s = s.optional();
      shape[paramName] = s;
    }

    const parameters = z.object(shape);

    try {
      server.addTool({
        name,
        description,
        parameters,
        execute: async (args: Record<string, any>) => {
          const jxa = buildCommandJxa(appId, cmd, args);
          try {
            return await executor.execute(jxa, "jxa");
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      });
    } catch (e: any) {
      console.error(`[osa-mcp] Failed to register command tool ${name}: ${e.message}`);
    }
  }
}

/** Register sdef classes as read/list tools. */
export function registerClasses(
  server: FastMCP,
  sdef: Sdef,
  appName: string,
  appId: string,
  executor: Executor
): void {
  const prefix = appName.toLowerCase().replace(/\s+/g, "_");

  for (const cls of sdef.classes) {
    // Only create tools for classes with readable properties
    const readableProps = cls.properties.filter((p) => p.access !== "w");
    if (readableProps.length === 0) continue;

    // Skip generic/text classes
    if (["rich text", "paragraph", "word", "character", "attribute run", "attachment"].includes(cls.name)) continue;

    const plural = cls.plural || `${cls.name}s`;
    const listName = toolName(prefix, `list_${plural}`);
    const getName = toolName(prefix, `get_${cls.name}`);

    try {
      // List tool: get all instances with key properties
      server.addTool({
        name: listName,
        description: `[${appName}] List all ${plural}. ${cls.description || ""}`.trim().slice(0, 500),
        parameters: z.object({
          limit: z.number().int().optional().describe("Max items to return"),
          properties: z.array(z.string()).optional().describe(`Properties to include. Available: ${readableProps.map((p) => p.name).join(", ")}`),
        }),
        execute: async (args: Record<string, any>) => {
          const props = (args.properties as string[] | undefined) ?? readableProps.slice(0, 5).map((p) => p.name);
          const limit = (args.limit as number | undefined) ?? 50;
          const jxa = buildListJxa(appId, cls, props, limit);
          try {
            return await executor.execute(jxa, "jxa");
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      });

      // Get tool: get a specific instance by index or name
      server.addTool({
        name: getName,
        description: `[${appName}] Get a specific ${cls.name}. ${cls.description || ""}`.trim().slice(0, 500),
        parameters: z.object({
          index: z.number().int().optional().describe("1-based index"),
          name: z.string().optional().describe("Name to match"),
          properties: z.array(z.string()).optional().describe(`Properties to include. Available: ${readableProps.map((p) => p.name).join(", ")}`),
        }),
        execute: async (args: Record<string, any>) => {
          const props = (args.properties as string[] | undefined) ?? readableProps.map((p) => p.name);
          const jxa = buildGetJxa(appId, cls, args, props);
          try {
            return await executor.execute(jxa, "jxa");
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        },
      });
    } catch (e: any) {
      console.error(`[osa-mcp] Failed to register class tools for ${cls.name}: ${e.message}`);
    }
  }
}

/** Build JXA for executing a command. */
function buildCommandJxa(
  appId: string,
  cmd: SdefCommand,
  args: Record<string, any>
): string {
  const methodName = cmd.name.replace(/\s+/g, "");
  // JXA method names are camelCase versions of the sdef command name
  const jxaMethod = methodName.charAt(0).toLowerCase() + methodName.slice(1);

  const parts: string[] = [`const app = Application("${jxaEscape(appId)}");`];

  // Build the call
  if (cmd.directParam && args.target !== undefined) {
    if (cmd.params.length > 0) {
      const paramObj = buildParamObject(cmd, args);
      parts.push(`const result = app.${jxaMethod}("${jxaEscape(String(args.target))}", ${paramObj});`);
    } else {
      parts.push(`const result = app.${jxaMethod}("${jxaEscape(String(args.target))}");`);
    }
  } else if (cmd.params.length > 0) {
    const paramObj = buildParamObject(cmd, args);
    parts.push(`const result = app.${jxaMethod}(${paramObj});`);
  } else {
    parts.push(`const result = app.${jxaMethod}();`);
  }

  parts.push("JSON.stringify(result);");
  return parts.join("\n");
}

/** Build a JXA parameter object from sdef params and user args. */
function buildParamObject(cmd: SdefCommand, args: Record<string, any>): string {
  const entries: string[] = [];
  for (const p of cmd.params) {
    const argName = p.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    if (args[argName] === undefined) continue;
    const jxaKey = p.name.replace(/\s+/g, "");
    const camelKey = jxaKey.charAt(0).toLowerCase() + jxaKey.slice(1);
    const val = typeof args[argName] === "string"
      ? `"${jxaEscape(args[argName])}"`
      : JSON.stringify(args[argName]);
    entries.push(`${camelKey}: ${val}`);
  }
  return `{${entries.join(", ")}}`;
}

/** Build JXA for listing class instances. */
function buildListJxa(
  appId: string,
  cls: SdefClass,
  props: string[],
  limit: number
): string {
  const plural = cls.plural || `${cls.name}s`;
  const jxaPlural = plural.replace(/\s+/g, "");
  const jxaPluralMethod = jxaPlural.charAt(0).toLowerCase() + jxaPlural.slice(1);

  const propAccessors = props.map((p) => {
    const jxaP = p.replace(/\s+/g, "");
    const method = jxaP.charAt(0).toLowerCase() + jxaP.slice(1);
    return `try { obj["${jxaEscape(p)}"] = item.${method}(); } catch(e) {}`;
  });

  return `
const app = Application("${jxaEscape(appId)}");
const items = app.${jxaPluralMethod}();
const count = Math.min(items.length, ${limit});
const result = [];
for (let i = 0; i < count; i++) {
  const item = items[i];
  const obj = {};
  ${propAccessors.join("\n  ")}
  result.push(obj);
}
JSON.stringify(result);
`.trim();
}

/** Build JXA for getting a specific class instance. */
function buildGetJxa(
  appId: string,
  cls: SdefClass,
  args: Record<string, any>,
  props: string[]
): string {
  const plural = cls.plural || `${cls.name}s`;
  const jxaPlural = plural.replace(/\s+/g, "");
  const jxaPluralMethod = jxaPlural.charAt(0).toLowerCase() + jxaPlural.slice(1);

  let accessor: string;
  if (args.name) {
    accessor = `app.${jxaPluralMethod}.byName("${jxaEscape(args.name)}")`;
  } else if (args.index) {
    accessor = `app.${jxaPluralMethod}[${args.index - 1}]`;
  } else {
    accessor = `app.${jxaPluralMethod}[0]`;
  }

  const propAccessors = props.map((p) => {
    const jxaP = p.replace(/\s+/g, "");
    const method = jxaP.charAt(0).toLowerCase() + jxaP.slice(1);
    return `try { obj["${jxaEscape(p)}"] = item.${method}(); } catch(e) {}`;
  });

  return `
const app = Application("${jxaEscape(appId)}");
const item = ${accessor};
const obj = {};
${propAccessors.join("\n")}
JSON.stringify(obj);
`.trim();
}
