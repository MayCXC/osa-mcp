/**
 * tools.ts: The MCP tools, search and execute.
 *
 * Cloudflare's API server serves its API in two tools the same way: search
 * runs code over the spec, and execute runs code against the API:
 * https://github.com/cloudflare/mcp/blob/550e1be82b2227818e6b98fc32a313a59403ae3f/src/tools/search.ts
 * https://github.com/cloudflare/mcp/blob/550e1be82b2227818e6b98fc32a313a59403ae3f/src/tools/execute.ts
 * Here the spec is the apps' scripting dictionaries, read from the Mac on
 * every search, and the code execute runs is JXA or AppleScript.
 */

import type { McpServer, RegisteredTool } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { App, Dictionaries } from "./dictionaries.js";
import type { Executor } from "./executor.js";
import { runSearch } from "./sandbox.js";

/** A tool's failure, as the model reads it:
 *  https://github.com/cloudflare/mcp/blob/550e1be82b2227818e6b98fc32a313a59403ae3f/src/utils/errors.ts */
function formatError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** A string as it is, any other value as JSON. */
function formatResult(content: unknown): string {
  if (typeof content === "string") return content;
  return JSON.stringify(content, null, 2) ?? String(content);
}

/** The apps' dictionaries as search code sees them, from sdef.ts and dictionaries.ts. */
const TYPES = `
interface Parameter { name: string; code: string; type: string; description: string; optional: boolean; synonyms?: string[] }

interface Command {
  suite: string;
  name: string;
  code: string;
  description: string;
  synonyms?: string[];
  directParameter?: { type: string; description: string; optional: boolean };
  parameters: Parameter[];
  result?: { type: string; description: string };
}

interface Property { name: string; code: string; type: string; description: string; access: "r" | "w" | "rw"; synonyms?: string[] }

interface Class {
  suite: string;
  name: string;
  code: string;
  description: string;
  plural?: string; // when it is not the name with an s
  inherits?: string; // the class whose properties and elements it also has
  synonyms?: string[];
  properties: Property[];
  elements: Array<{ type: string; access: "r" | "w" | "rw" }>; // the classes it contains
}

interface RecordType { suite: string; name: string; code: string; description: string; synonyms?: string[]; properties: Property[] }

interface Enumeration {
  suite: string;
  name: string;
  code: string;
  enumerators: Array<{ name: string; code: string; description: string; synonyms?: string[] }>;
}

interface App {
  name: string;
  bundleId: string | null;
  path: string;
  title: string;
  suites: Array<{ name: string; description: string }>;
  commands: Command[];
  classes: Class[]; // the application class among them
  recordTypes: RecordType[];
  valueTypes: Array<{ suite: string; name: string; code: string; synonyms?: string[] }>;
  enumerations: Enumeration[];
}

declare const apps: App[];
`;

function searchDescription(apps: App[]): string {
  return `Search the AppleScript dictionaries of the scriptable apps on the Mac, read from it on every search.

Apps: ${[...new Set(apps.map((a) => a.name))].join(", ")}

Types:
${TYPES}
Examples:

// Find commands by a word in their description
async () => {
  const results = [];
  for (const app of apps) {
    for (const command of app.commands) {
      if (command.description.toLowerCase().includes('mailbox')) {
        results.push({ app: app.name, command: command.name, description: command.description });
      }
    }
  }
  return results;
}

// Get a command with its parameters
async () => {
  const mail = apps.find(a => a.name === 'Mail');
  return mail.commands.find(c => c.name === 'send');
}

// Get a class's properties, with those it inherits
async () => {
  const finder = apps.find(a => a.name === 'Finder');
  const lineage = [];
  for (let cls = finder.classes.find(c => c.name === 'file'); cls; cls = finder.classes.find(c => c.name === cls.inherits)) {
    lineage.push({ class: cls.name, properties: cls.properties.map(p => p.name) });
  }
  return lineage;
}`;
}

/** search: code over the apps' dictionaries, after reading them from the Mac. */
export function registerSearchTool(server: McpServer, dictionaries: Dictionaries, apps: App[]): void {
  const tool: RegisteredTool = server.registerTool(
    "search",
    {
      title: "Scripting Dictionary Search",
      description: searchDescription(apps),
      inputSchema: z.object({
        code: z.string().describe("JavaScript async arrow function to search the dictionaries"),
      }),
      annotations: {
        title: "Scripting Dictionary Search",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ code }, ctx) => {
      try {
        // The SDK aborts the signal when the client cancels the call:
        // docs/servers/logging-progress-cancellation.md, "Pass the signal to your own I/O".
        const { apps, changed } = await dictionaries.load(ctx.mcpReq.signal);
        // The apps the description names change with the Mac's; the handle
        // tells the client: docs/servers/notifications.md, "Let registration
        // changes notify for you", in the TypeScript SDK.
        if (changed) tool.update({ description: searchDescription(apps) });
        return { content: [{ type: "text", text: formatResult(await runSearch(code, apps)) }] };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}

/** How JXA spells an app's dictionary:
 *  https://developer.apple.com/library/archive/releasenotes/InterapplicationCommunication/RN-JavaScriptForAutomation/Articles/OSX10-10.html */
const EXECUTE_DESCRIPTION = `Execute JXA (JavaScript for Automation) or AppleScript code on the Mac, which can read and change whatever its scriptable apps expose. First use the 'search' tool to find the right commands, classes and properties, then write code using them.

In JXA, Application(name) is an app by its name, bundle id or path, and its dictionary's terms are camelCased: a property is read by calling it (Application("Mail").inbox.messages[0].subject()), elements are reached by the plural of their class (Application("Mail").accounts), and a command takes its direct parameter first and its named parameters in an object.

The result is the value of the code's last expression: a string as it is, any other value as source text, which keeps lists, records and object specifiers whole.

Example:
Application("Mail").accounts.name()`;

/** execute: JXA or AppleScript on the Mac. */
export function registerExecuteTool(server: McpServer, executor: Executor): void {
  server.registerTool(
    "execute",
    {
      title: "Script Executor",
      description: EXECUTE_DESCRIPTION,
      inputSchema: z.object({
        code: z.string().describe("Script code to execute"),
        language: z.enum(["applescript", "jxa"]).optional().describe("Scripting language (default: jxa)"),
      }),
      annotations: {
        title: "Script Executor",
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      },
    },
    async ({ code, language }, ctx) => {
      try {
        const output = await executor.dispatch("execute", { code, language: language ?? "jxa" }, { signal: ctx.mcpReq.signal });
        return { content: [{ type: "text", text: output }] };
      } catch (error) {
        return formatError(error);
      }
    },
  );
}
