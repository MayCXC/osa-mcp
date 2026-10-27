/**
 * sandbox.ts: Run a search's code over the apps' dictionaries.
 *
 * The code is an async arrow function, called with the dictionaries
 * declared as a constant beside it, as Cloudflare's API server runs search
 * code over its spec:
 * https://github.com/cloudflare/mcp/blob/550e1be82b2227818e6b98fc32a313a59403ae3f/src/tools/search.ts#L21-L57
 * It runs in this process, in a node:vm context of its own, as mcp-use's
 * VM executor runs an agent's code:
 * https://github.com/mcp-use/mcp-use/blob/e6ce060a1b693ac1840b85098133f48eaa3f1b13/libraries/typescript/packages/client/src/code-mode/executor-vm.ts#L121-L185
 * The timeout stops code while it runs synchronously; what runs after an
 * await is outside it, as the Node.js documentation describes:
 * https://nodejs.org/api/vm.html#timeout-interactions-with-asynchronous-tasks-and-promises
 * The context has built-ins of its own, so an error the code throws is no
 * instance of the server's Error:
 * https://nodejs.org/api/vm.html#vmcreatecontextcontextobject-options
 * A failure leaves as the server's Error carrying the message, as
 * Cloudflare's search throws the message its isolate returns:
 * https://github.com/cloudflare/mcp/blob/550e1be82b2227818e6b98fc32a313a59403ae3f/src/tools/search.ts#L52-L54
 * and the message is read as mcp-use's VM executor reads it:
 * https://github.com/mcp-use/mcp-use/blob/e6ce060a1b693ac1840b85098133f48eaa3f1b13/libraries/typescript/packages/client/src/code-mode/executor-vm.ts#L164-L165
 */

import { Console } from "node:console";
import vm from "node:vm";

const TIMEOUT_MS = 30_000;

/** The value code returns, given apps as the constant `apps`. */
export async function runSearch(code: string, apps: unknown): Promise<unknown> {
  // stdout carries the protocol, so the code's console writes to the server's log.
  const context = vm.createContext({ console: new Console(process.stderr) });
  const script = new vm.Script(`const apps = ${JSON.stringify(apps)};\n(${code})()`, { filename: "search.js" });
  try {
    return await script.runInNewContext(context, { timeout: TIMEOUT_MS, displayErrors: true });
  } catch (e: any) {
    throw new Error(e.message || String(e));
  }
}
