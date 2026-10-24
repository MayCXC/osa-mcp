/**
 * dictionary.ts: The scripting dictionaries of the discovered apps.
 *
 * An sdef is a hierarchy: suites hold commands, classes and enumerations,
 * commands take parameters, and classes hold properties and contain other
 * classes as elements. Dictionary indexes every app's sdef, renders that
 * hierarchy at three levels of detail (the apps, one app, one term),
 * searches it across apps, and turns a command or class into the payload
 * dispatch.js runs, checking arguments against the sdef's types first.
 */

import { UserError } from "fastmcp";
import { z } from "zod";
import { parseIntrinsics, parseSdef } from "./sdef.js";
import type { IntrinsicType, Sdef, SdefClass, SdefCommand, SdefEnum, SdefParam, SdefProperty } from "./sdef.js";

/** What dispatch.js returns from discovery. */
export interface Discovery {
  apps: Array<{ name: string; bundleId: string | null; sdef: string }>;
  errors: Array<{ name: string; error: string }>;
  intrinsics: string | null;
}

/** A dispatch.js operation and its payload. */
export interface Dispatch {
  op: "command" | "list" | "get";
  data: Record<string, unknown>;
}

export type Path = Array<string | number | unknown[]>;

export interface ListValues {
  parent?: Path | undefined;
  properties?: string[] | undefined;
  limit?: number | undefined;
}

export interface GetValues {
  index?: number | undefined;
  name?: string | undefined;
  id?: number | string | undefined;
  parent?: Path | undefined;
  properties?: string[] | undefined;
}

/** Standard Suite commands that command does not run; execute reaches them. */
const UNSERVED_COMMANDS = new Set(["open", "close", "count", "exists", "make", "set", "get"]);

/** Text Suite classes that list and get do not read; execute reaches them. */
const UNSERVED_CLASSES = new Set(["rich text", "paragraph", "word", "character", "attribute run", "attachment"]);

/** One name for "with properties", "with_properties" and "withProperties". */
function squash(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/** The JXA spelling of an sdef term: "check for new mail" is checkForNewMail. */
function jxaName(sdefName: string): string {
  const words = sdefName.split(/\s+/);
  return words[0]!.toLowerCase() + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

/** The key dispatch.js reads a command parameter's value from. */
function argKey(sdefName: string): string {
  return sdefName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
}

function described(text: string, description: string): string {
  return description ? `${text}: ${description}` : text;
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : plural}`;
}

/** Terms looked up by name, whatever their case, spacing or punctuation. */
class Names<T> {
  private readonly entries = new Map<string, Array<{ name: string; value: T }>>();

  add(name: string, value: T): void {
    const key = squash(name);
    const list = this.entries.get(key) ?? [];
    if (!list.some((e) => e.value === value)) list.push({ name, value });
    this.entries.set(key, list);
  }

  /** The values spelled most like name: exactly, then in another case, then with other spacing or punctuation. */
  match(name: string): T[] {
    const list = this.entries.get(squash(name)) ?? [];
    const exact = list.filter((e) => e.name === name);
    const caseless = list.filter((e) => e.name.toLowerCase() === name.toLowerCase());
    return (exact.length > 0 ? exact : caseless.length > 0 ? caseless : list).map((e) => e.value);
  }
}

interface Collection {
  cls: SdefClass;
  plural: string;
  readable: SdefProperty[];
}

class App {
  readonly sdef: Sdef;
  private readonly enums = new Map<string, SdefEnum>();
  private readonly classes = new Map<string, SdefClass>();
  private readonly containers = new Map<string, string[]>();
  private readonly allCommands = new Names<SdefCommand>();
  private readonly allClasses = new Names<SdefClass>();
  private readonly allEnums = new Names<SdefEnum>();
  private readonly commands = new Names<SdefCommand>();
  private readonly collections = new Names<Collection>();
  private readonly collectionOf = new Map<SdefClass, Collection>();

  constructor(
    readonly name: string,
    readonly appId: string,
    xml: string,
    private readonly intrinsics: Map<string, IntrinsicType>,
  ) {
    this.sdef = parseSdef(xml);
    for (const e of this.sdef.enums) {
      this.enums.set(e.name, e);
      this.allEnums.add(e.name, e);
    }
    for (const cls of this.sdef.classes) {
      this.classes.set(cls.name, cls);
      this.allClasses.add(cls.name, cls);
      if (cls.plural) this.allClasses.add(cls.plural, cls);
      for (const el of cls.elements) this.containers.set(el.type, [...(this.containers.get(el.type) ?? []), cls.name]);
    }
    for (const cmd of this.sdef.commands) {
      this.allCommands.add(cmd.name, cmd);
      if (!UNSERVED_COMMANDS.has(cmd.name)) this.commands.add(cmd.name, cmd);
    }
    // A plural names one collection: the first class to claim it keeps it.
    const plurals = new Set<string>();
    for (const cls of this.sdef.classes) {
      if (cls.record || UNSERVED_CLASSES.has(cls.name)) continue;
      const readable = this.ancestry(cls).flatMap((a) => a.properties).filter((p) => p.access !== "w");
      if (readable.length === 0) continue;
      const plural = cls.plural || `${cls.name}s`;
      if (plurals.has(squash(plural))) continue;
      plurals.add(squash(plural));
      const collection = { cls, plural, readable };
      this.collectionOf.set(cls, collection);
      this.collections.add(cls.name, collection);
      this.collections.add(plural, collection);
    }
  }

  get applicationProperties(): SdefProperty[] {
    return this.sdef.application.properties.filter((p) => p.access !== "w");
  }

  /** cls and the classes it inherits from, nearest first, each with the properties it adds. */
  private ancestry(cls: SdefClass): Array<{ from: SdefClass; properties: SdefProperty[] }> {
    const lineage = [{ from: cls, properties: cls.properties }];
    const seen = new Set(cls.properties.map((p) => p.name));
    for (let c = cls.inherits ? this.classes.get(cls.inherits) : undefined; c; c = c.inherits ? this.classes.get(c.inherits) : undefined) {
      if (lineage.some((l) => l.from === c)) break;
      const properties = c.properties.filter((p) => !seen.has(p.name));
      for (const p of properties) seen.add(p.name);
      lineage.push({ from: c, properties });
    }
    return lineage;
  }

  // --- Rendering ---

  /** The app's suites, with one line for each command and class. */
  outline(): string {
    const s = this.sdef;
    const lines = [`${this.name} (${this.appId}): ${count(s.commands.length, "command")} and ${count(s.classes.length, "class", "classes")}.`];
    if (this.applicationProperties.length > 0) {
      lines.push(`get with no class reads the application's properties: ${this.applicationProperties.map((p) => p.name).join(", ")}.`);
    }
    if (s.application.elements.length > 0) {
      lines.push(`list reads these without a parent: ${s.application.elements.map((e) => e.type).join(", ")}.`);
    }
    for (const suite of new Map(s.suites.map((x) => [x.name, x])).values()) {
      const commands = s.commands.filter((c) => c.suite === suite.name);
      const classes = s.classes.filter((c) => c.suite === suite.name);
      if (commands.length === 0 && classes.length === 0) continue;
      lines.push("", described(suite.name, suite.description));
      const unserved: string[] = [];
      for (const c of commands) {
        if (this.commands.match(c.name).includes(c)) lines.push(`  command ${described(c.name, c.description)}`);
        else unserved.push(c.name);
      }
      for (const c of classes) {
        const collection = this.collectionOf.get(c);
        if (collection) lines.push(`  class ${described(`${c.name} (${collection.plural})`, c.description)}`);
        else if (c.record) lines.push(`  record ${described(c.name, c.description)}`);
        else unserved.push(c.name);
      }
      if (unserved.length > 0) lines.push(`  only through execute: ${unserved.join(", ")}`);
    }
    if (s.enums.length > 0) lines.push("", `enumerations: ${s.enums.map((e) => e.name).join(", ")}`);
    lines.push("", `dictionary with "${this.name}" and a term gives its full definition.`);
    return lines.join("\n");
  }

  /** Every command, class and enumeration named term, in full. */
  define(term: string): string | undefined {
    const parts: string[] = [];
    if (squash(term) === "application") parts.push(this.renderApplication());
    for (const c of this.allCommands.match(term)) parts.push(this.renderCommand(c));
    for (const c of this.allClasses.match(term)) parts.push(this.renderClass(c));
    for (const e of this.allEnums.match(term)) parts.push(this.renderEnum(e));
    return parts.length > 0 ? parts.map((p) => `${this.name} ${p}`).join("\n\n") : undefined;
  }

  /** The commands, classes, properties and enumerations whose names and descriptions hold every word. */
  search(words: string[]): string[] {
    const hit = (...texts: Array<string | undefined>) => {
      const text = texts.join(" ").toLowerCase();
      return words.every((w) => text.includes(w));
    };
    const lines: string[] = [];
    for (const c of this.sdef.commands) if (hit(c.name, c.description)) lines.push(`${this.name} command ${described(c.name, c.description)}`);
    for (const c of this.sdef.classes) {
      if (hit(c.name, c.plural, c.description)) lines.push(`${this.name} ${c.record ? "record" : "class"} ${described(c.name, c.description)}`);
    }
    for (const p of this.sdef.application.properties) {
      if (hit(p.name, p.description)) lines.push(`${this.name} application property ${described(p.name, p.description)}`);
    }
    for (const c of this.sdef.classes) {
      for (const p of c.properties) if (hit(p.name, p.description)) lines.push(`${this.name} ${c.name} property ${described(p.name, p.description)}`);
    }
    for (const e of this.sdef.enums) {
      if (hit(e.name, ...e.values.map((v) => `${v.name} ${v.description}`))) lines.push(`${this.name} enumeration ${e.name}`);
    }
    return lines;
  }

  private typeText(type: string): string {
    const e = this.enums.get(type);
    if (e && e.values.length > 0) {
      return `one of ${e.values.map((v) => (v.description ? `"${v.name}" (${v.description})` : `"${v.name}"`)).join(", ")}`;
    }
    if (this.intrinsics.get(type)?.jsType === "object") return `${type}, as a JSON string`;
    return type;
  }

  private renderCommand(cmd: SdefCommand): string {
    const lines = [`command "${cmd.name}" (${cmd.suite})${cmd.description ? `: ${cmd.description}` : ""}`];
    const param = (label: string, type: string, optional: boolean, description: string) =>
      `  ${label}: ${this.typeText(type)}${optional ? ", optional" : ""}${description ? `. ${description}` : ""}`;
    if (cmd.directParam) lines.push(param("target", cmd.directParam.type, cmd.directParam.optional, cmd.directParam.description));
    for (const p of cmd.params) lines.push(param(`parameter "${p.name}"`, p.type, p.optional, p.description));
    if (cmd.result) lines.push(`  returns ${described(cmd.result.type, cmd.result.description)}`);
    lines.push(
      this.commands.match(cmd.name).includes(cmd)
        ? `Run it with command, passing target and the parameters by name.`
        : `command does not run ${cmd.name}; execute can, as Application("${this.appId}").${jxaName(cmd.name)}(...) in JXA.`,
    );
    return lines.join("\n");
  }

  private renderProperties(properties: SdefProperty[]): string[] {
    return properties.map((p) => {
      const access = p.access === "r" ? ", read only" : p.access === "w" ? ", write only" : "";
      return `    ${p.name}: ${this.typeText(p.type)}${access}${p.description ? `. ${p.description}` : ""}`;
    });
  }

  private renderClass(cls: SdefClass): string {
    if (cls.record) {
      const lines = [`record "${cls.name}" (${cls.suite})${cls.description ? `: ${cls.description}` : ""}`];
      if (cls.properties.length > 0) lines.push("  properties:", ...this.renderProperties(cls.properties));
      lines.push(`A value that commands take or return, so list and get do not read it.`);
      return lines.join("\n");
    }
    const collection = this.collectionOf.get(cls);
    const plural = collection?.plural ?? cls.plural ?? `${cls.name}s`;
    const lines = [`class "${cls.name}", plural "${plural}" (${cls.suite})${cls.description ? `: ${cls.description}` : ""}`];
    if (cls.inherits) lines.push(`  inherits ${cls.inherits}`);
    const topLevel = this.sdef.application.elements.some((e) => e.type === cls.name);
    const containers = [...(topLevel ? ["application"] : []), ...(this.containers.get(cls.name) ?? [])];
    if (containers.length > 0) lines.push(`  found in: ${containers.join(", ")}`);
    if (cls.elements.length > 0) lines.push(`  contains: ${cls.elements.map((e) => e.type).join(", ")}`);
    for (const [i, { from, properties }] of this.ancestry(cls).entries()) {
      if (properties.length > 0) lines.push(i === 0 ? "  properties:" : `  properties from ${from.name}:`, ...this.renderProperties(properties));
    }
    if (!collection) {
      lines.push(`list and get do not read ${cls.name}; execute can.`);
    } else {
      const where = topLevel ? "with no parent for the application's own, or " : "";
      lines.push(`Read it with list, or get one by index, name or id: ${where}with parent as the path from the application to its container.`);
    }
    return lines.join("\n");
  }

  private renderApplication(): string {
    const lines = [`application: get with no class reads its properties.`];
    if (this.sdef.application.properties.length > 0) {
      lines.push("  properties:", ...this.renderProperties(this.sdef.application.properties));
    }
    if (this.sdef.application.elements.length > 0) {
      lines.push(`  contains: ${this.sdef.application.elements.map((e) => e.type).join(", ")}`);
    }
    return lines.join("\n");
  }

  private renderEnum(e: SdefEnum): string {
    return [`enumeration "${e.name}":`, ...e.values.map((v) => `  ${described(`"${v.name}"`, v.description)}`)].join("\n");
  }

  // --- Dispatch payloads ---

  /** The JSON value an argument of an sdef type takes. */
  private zodType(type: string): z.ZodType {
    const intrinsic = this.intrinsics.get(type);
    if (intrinsic) {
      switch (intrinsic.jsType) {
        case "number": return intrinsic.name === "integer" ? z.number().int() : z.number();
        case "boolean": return z.boolean();
        case "array": return z.array(z.unknown());
        case "object": return z.string();
        case "any": return z.string();
        case "string": return z.string();
      }
    }
    const values = this.enums.get(type)?.values.map((v) => v.name) ?? [];
    if (values.length > 0) return z.enum(values as [string, ...string[]]);
    return z.string();
  }

  command(name: string, target: unknown, parameters: Record<string, unknown>): Dispatch {
    const cmd = this.one("command", name, this.commands.match(name), (c) => c.name);
    const definition = () => `${this.name} ${this.renderCommand(cmd)}`;
    const params = new Names<SdefParam>();
    for (const p of cmd.params) params.add(p.name, p);
    const values: Record<string, unknown> = {};
    if (target !== undefined) {
      if (!cmd.directParam) throw new UserError(`${cmd.name} takes no target.\n\n${definition()}`);
      values["target"] = target;
    }
    for (const [key, value] of Object.entries(parameters)) {
      const keys = new Set(params.match(key).map((p) => argKey(p.name)));
      const [k, ...rest] = keys;
      if (k === undefined || rest.length > 0) throw new UserError(`${cmd.name} has no parameter "${key}".\n\n${definition()}`);
      values[k] = value;
    }
    const shape: Record<string, z.ZodType> = {};
    if (cmd.directParam) {
      const s = this.zodType(cmd.directParam.type);
      shape["target"] = cmd.directParam.optional ? s.optional() : s;
    }
    for (const p of cmd.params) {
      const s = this.zodType(p.type);
      shape[argKey(p.name)] = p.optional ? s.optional() : s;
    }
    const parsed = z.object(shape).safeParse(values);
    if (!parsed.success) {
      const label = new Map(cmd.params.map((p) => [argKey(p.name), p.name]));
      const issues = parsed.error.issues.map((i) => {
        const key = String(i.path[0] ?? "");
        return `${label.get(key) ?? key}: ${i.message}`;
      });
      throw new UserError(`Invalid arguments for ${this.name} ${cmd.name}: ${issues.join(", ")}.\n\n${definition()}`);
    }
    return {
      op: "command",
      data: {
        appId: this.appId,
        method: jxaName(cmd.name),
        hasDirectParam: !!cmd.directParam,
        paramKeys: cmd.params.map((p) => ({ argKey: argKey(p.name), jxaKey: jxaName(p.name) })),
        values: parsed.data,
      },
    };
  }

  list(className: string, values: ListValues): Dispatch {
    const c = this.collection(className);
    return { op: "list", data: { appId: this.appId, ...this.reading(c.plural, c.readable), values: this.named(values, c.readable) } };
  }

  get(className: string | undefined, values: GetValues): Dispatch {
    if (className === undefined || squash(className) === "application") {
      const given = Object.entries(values).filter(([k, v]) => k !== "properties" && v !== undefined).map(([k]) => k);
      if (given.length > 0) {
        throw new UserError(`${given.join(", ")} ${given.length === 1 ? "needs" : "need"} a class; with no class, get reads the application's own properties.`);
      }
      const readable = this.applicationProperties;
      if (readable.length === 0) throw new UserError(`${this.name} has no readable application properties.`);
      return {
        op: "get",
        data: {
          appId: this.appId,
          isSingleton: true,
          propMethods: readable.map((p) => ({ name: p.name, method: jxaName(p.name) })),
          values: this.named(values, readable),
        },
      };
    }
    const c = this.collection(className);
    return { op: "get", data: { appId: this.appId, ...this.reading(c.plural, c.readable), values: this.named(values, c.readable) } };
  }

  private reading(plural: string, readable: SdefProperty[]) {
    return { pluralMethod: jxaName(plural), propMethods: readable.map((p) => ({ name: p.name, method: jxaName(p.name) })) };
  }

  private collection(name: string): Collection {
    return this.one("class", name, this.collections.match(name), (c) => c.cls.name);
  }

  /** values with each requested property under the name the sdef gives it. */
  private named<V extends { properties?: string[] | undefined }>(values: V, readable: SdefProperty[]): V {
    if (!values.properties) return values;
    const byName = new Names<string>();
    for (const p of readable) byName.add(p.name, p.name);
    const properties = values.properties.map((requested) => {
      const [name, ...rest] = new Set(byName.match(requested));
      if (name === undefined || rest.length > 0) {
        throw new UserError(`No readable property "${requested}". The readable properties: ${readable.map((p) => p.name).join(", ")}.`);
      }
      return name;
    });
    return { ...values, properties };
  }

  /** The one command or class name resolves to, or why there isn't one. */
  private one<T>(kind: "command" | "class", name: string, matches: T[], label: (t: T) => string): T {
    const [only, ...rest] = matches;
    if (only !== undefined && rest.length === 0) return only;
    const kinds = kind === "command" ? "commands" : "classes";
    if (only !== undefined) {
      throw new UserError(`"${name}" names ${matches.length} of ${this.name}'s ${kinds}: ${matches.map(label).join(", ")}; execute can reach each.`);
    }
    const defined =
      kind === "command"
        ? this.allCommands.match(name).map((c) => this.renderCommand(c))
        : this.allClasses.match(name).map((c) => this.renderClass(c));
    if (defined.length > 0) {
      const runner = kind === "command" ? "command does" : "list and get do";
      throw new UserError(`${runner} not serve this; execute can.\n\n${defined.map((d) => `${this.name} ${d}`).join("\n\n")}`);
    }
    throw new UserError(`${this.name} has no ${kind} "${name}".\n\n${this.outline()}`);
  }
}

export class Dictionary {
  readonly apps: App[] = [];
  readonly errors: Array<{ name: string; error: string }>;
  private readonly byName = new Names<App>();

  constructor(discovery: Discovery) {
    const intrinsics = discovery.intrinsics ? parseIntrinsics(discovery.intrinsics) : new Map<string, IntrinsicType>();
    this.errors = [...discovery.errors];
    for (const a of discovery.apps) {
      // Spotlight can find two copies of an app; the first one found serves the name.
      if (this.byName.match(a.name).length > 0) continue;
      try {
        const app = new App(a.name, a.bundleId ?? a.name, a.sdef, intrinsics);
        this.apps.push(app);
        this.byName.add(app.name, app);
        if (a.bundleId) this.byName.add(a.bundleId, app);
      } catch (e: any) {
        this.errors.push({ name: a.name, error: e.message });
      }
    }
  }

  app(name: string): App {
    const [app] = this.byName.match(name);
    if (app) return app;
    throw new UserError(`No scriptable app "${name}".\n\n${this.overview()}`);
  }

  /** What the server tells the model about itself before any tool call. */
  instructions(): string {
    return (
      `The AppleScript dictionaries of the scriptable apps on this Mac: ${this.apps.map((a) => a.name).join(", ")}. ` +
      `dictionary browses them: no arguments lists the apps, app outlines one app's commands and classes, ` +
      `app and term define one in full, and query searches every app. command runs a command, list and get read ` +
      `the elements and properties of a class, and execute runs any JXA or AppleScript.`
    );
  }

  /** The apps, one app's outline, a term's definitions, or search results, by which arguments are given. */
  browse(appName?: string, term?: string, query?: string): string {
    const app = appName === undefined ? undefined : this.app(appName);
    if (query !== undefined) return this.search(query, app);
    if (term === undefined) return app ? app.outline() : this.overview();
    if (!app) return this.define(term);
    const definition = app.define(term);
    if (definition === undefined) throw new UserError(`${app.name} defines no "${term}".\n\n${app.outline()}`);
    return definition;
  }

  overview(): string {
    const lines = [`${this.apps.length} scriptable apps. dictionary with an app outlines its commands and classes.`];
    for (const a of this.apps) {
      lines.push(`${a.name} (${a.appId}): ${count(a.sdef.commands.length, "command")}, ${count(a.sdef.classes.length, "class", "classes")}`);
    }
    for (const e of this.errors) lines.push(`${e.name}: dictionary not loaded (${e.error})`);
    return lines.join("\n");
  }

  /** term's definitions in every app that defines it. */
  define(term: string): string {
    const parts = this.apps.map((a) => a.define(term)).filter((d): d is string => d !== undefined);
    if (parts.length === 0) throw new UserError(`No app defines "${term}". dictionary with query searches descriptions too.`);
    return parts.join("\n\n");
  }

  search(query: string, app?: App): string {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const lines = (app ? [app] : this.apps).flatMap((a) => a.search(words));
    return lines.length > 0 ? lines.join("\n") : `Nothing in ${app ? `${app.name}'s dictionary` : "any dictionary"} matches "${query}".`;
  }
}
