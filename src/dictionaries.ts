/**
 * dictionaries.ts: The scriptable apps on the Mac, with their dictionaries.
 *
 * Every load discovers the apps on the Mac again, and parses their
 * dictionaries only when what it read differs from the last load: FastMCP's
 * tool search hashes its catalog on every search the same way, and rebuilds
 * its index when the hash changes:
 * https://github.com/PrefectHQ/fastmcp/blob/adfb6a6ed5384895d3b1eaa7a314ea2f30b2663e/fastmcp_slim/fastmcp/server/transforms/search/bm25.py#L83-L86
 * https://github.com/PrefectHQ/fastmcp/blob/adfb6a6ed5384895d3b1eaa7a314ea2f30b2663e/fastmcp_slim/fastmcp/server/transforms/search/bm25.py#L134-L144
 */

import { createHash } from "node:crypto";
import type { Executor } from "./executor.js";
import { parseSdef, type Dictionary } from "./sdef.js";

/** What dispatch.js returns from discovery. */
interface Discovery {
  apps: Array<{ name: string; bundleId: string | null; path: string; sdef: string }>;
  errors: Array<{ name: string; error: string }>;
}

/** A scriptable app and its dictionary. */
export interface App extends Dictionary {
  name: string;
  bundleId: string | null;
  path: string;
}

/** By name, then path: Spotlight returns the apps in no fixed order. */
function byName(a: { name: string; path?: string }, b: { name: string; path?: string }): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return (a.path ?? "") < (b.path ?? "") ? -1 : (a.path ?? "") > (b.path ?? "") ? 1 : 0;
}

export class Dictionaries {
  private hash = "";
  private apps: App[] = [];

  constructor(private readonly executor: Executor) {}

  /** The apps as the Mac has them now, and whether they differ from the last load's. */
  async load(signal?: AbortSignal): Promise<{ apps: App[]; changed: boolean }> {
    const discovery = JSON.parse(await this.executor.dispatch(undefined, undefined, { signal })) as Discovery;
    const found = discovery.apps.sort(byName);
    const errors = discovery.errors.sort(byName);
    const hash = createHash("sha256").update(JSON.stringify([found, errors])).digest("hex");
    if (hash === this.hash) return { apps: this.apps, changed: false };

    const apps: App[] = [];
    for (const { name, bundleId, path, sdef } of found) {
      try {
        apps.push({ name, bundleId, path, ...parseSdef(sdef) });
      } catch (e) {
        errors.push({ name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    console.error(`[osa-mcp] ${apps.length} scriptable apps`);
    for (const e of errors) console.error(`[osa-mcp] ${e.name}: dictionary not loaded (${e.error})`);
    this.hash = hash;
    this.apps = apps;
    return { apps, changed: true };
  }
}
