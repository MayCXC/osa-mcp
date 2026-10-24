/**
 * tools.ts: The MCP tools.
 *
 * execute runs any JXA or AppleScript. With a dictionary, dictionary
 * browses every app's sdef at the level of detail its arguments ask for,
 * and command, list and get resolve an app and a term by name and run
 * them through dispatch.js, so the tool list stays the same size however
 * many apps there are: progressive disclosure, a search tool with a
 * detail level, as in
 * https://www.anthropic.com/engineering/code-execution-with-mcp
 */

import type { FastMCP } from "fastmcp";
import { z } from "zod";
import type { Dictionary, Dispatch } from "./dictionary.js";
import type { Executor } from "./executor.js";

const app = z.string().describe("App name or bundle id, e.g. Mail");

const parent = z
  .array(z.union([z.string(), z.number(), z.array(z.any())]))
  .optional()
  .describe(
    "Path from the application to the container: 'key' reads a property, 0 indexes, [] calls, ['arg'] calls with arguments. e.g. ['inbox'] or ['calendars','byName',['US Holidays']]",
  );

const properties = z.array(z.string()).optional().describe("Properties to read, by the names the dictionary gives (default: all readable ones)");

export function addTools(server: FastMCP, executor: Executor, dictionary?: Dictionary): void {
  async function run({ op, data }: Dispatch): Promise<string> {
    try {
      return await executor.dispatch(op, data);
    } catch (e: any) {
      return `Error: ${e.message}`;
    }
  }

  server.addTool({
    name: "execute",
    description: "Execute AppleScript or JXA (JavaScript for Automation) code on the macOS host.",
    parameters: z.object({
      code: z.string().describe("Script code to execute"),
      language: z.enum(["applescript", "jxa"]).optional().describe("Scripting language (default: jxa)"),
    }),
    execute: async (args) => {
      try {
        return await executor.dispatch("execute", { code: args.code, language: args.language ?? "jxa" });
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },
  });

  if (!dictionary) return;

  server.addTool({
    name: "dictionary",
    description:
      "Browse the scripting dictionaries of the Mac's scriptable apps. No arguments: the apps. app: that app's suites, " +
      "with one line per command and class. app and term: the full definition of a command, class or enumeration " +
      "(parameters, properties, where it is found). query: commands, classes and properties matching every word, in every app or in app.",
    annotations: { readOnlyHint: true },
    parameters: z.object({
      app: app.optional(),
      term: z.string().optional().describe("A command, class or enumeration name"),
      query: z.string().optional().describe("Words to find in names and descriptions"),
    }),
    execute: async ({ app, term, query }) => dictionary.browse(app, term, query),
  });

  server.addTool({
    name: "command",
    description: "Run a command from an app's scripting dictionary. dictionary with the app and command gives its target and parameters.",
    parameters: z.object({
      app,
      command: z.string().describe("Command name, e.g. check for new mail"),
      target: z.unknown().optional().describe("The command's direct parameter"),
      parameters: z.record(z.string(), z.unknown()).optional().describe("Named parameters, keyed by the names the dictionary gives"),
    }),
    execute: async (args) => run(dictionary.app(args.app).command(args.command, args.target, args.parameters ?? {})),
  });

  server.addTool({
    name: "list",
    description: "List the elements of a class with their properties: an app's top-level ones, or those inside the object at parent.",
    annotations: { readOnlyHint: true },
    parameters: z.object({
      app,
      class: z.string().describe("Class name or plural, e.g. message"),
      parent,
      properties,
      limit: z.number().int().optional().describe("Max items (default 25)"),
    }),
    execute: async ({ app, class: name, ...values }) => run(dictionary.app(app).list(name, values)),
  });

  server.addTool({
    name: "get",
    description: "Get one element of a class by index, name or id, with its properties. With no class, the application's own properties.",
    annotations: { readOnlyHint: true },
    parameters: z.object({
      app,
      class: z.string().optional().describe("Class name or plural, e.g. message"),
      index: z.number().int().optional().describe("0-based index"),
      name: z.string().optional().describe("Name to match"),
      id: z.union([z.number().int(), z.string()]).optional().describe("ID to match"),
      parent,
      properties,
    }),
    execute: async ({ app, class: name, ...values }) => run(dictionary.app(app).get(name, values)),
  });
}
