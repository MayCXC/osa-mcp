/**
 * sdef.ts: Parse Apple Scripting Definition (sdef) XML.
 *
 * Uses fast-xml-parser with isArray config to normalize the structure,
 * then Zod to validate and type the result. The Zod schema mirrors the
 * sdef.dtd so it acts as a runtime DTD validator.
 *
 * The parsed dictionary keeps the sdef's own terms, as sdef(5) defines them:
 * https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ScriptingDefinitions/
 */

import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

// --- Zod schema mirroring sdef.dtd ---

const Synonym = z.object({
  "@_name": z.string().optional(),
  "@_code": z.string().optional(),
  "@_plural": z.string().optional(),
});

const Enumerator = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
  synonym: z.array(Synonym).default([]),
});

const Enumeration = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_hidden": z.string().optional(),
  enumerator: z.array(Enumerator).default([]),
});

const DirectParameter = z.object({
  "@_type": z.string().default("specifier"),
  "@_description": z.string().default(""),
  "@_optional": z.string().optional(),
});

const ResultType = z.object({
  "@_type": z.string().optional(),
  "@_description": z.string().default(""),
});

const Parameter = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_type": z.string().default("text"),
  "@_description": z.string().default(""),
  "@_optional": z.string().optional(),
  "@_hidden": z.string().optional(),
  synonym: z.array(Synonym).default([]),
});

const Property = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_type": z.string().default("text"),
  "@_description": z.string().default(""),
  "@_access": z.string().optional(),
  "@_hidden": z.string().optional(),
  synonym: z.array(Synonym).default([]),
});

const Element = z.object({
  "@_type": z.string(),
  "@_access": z.string().optional(),
  "@_hidden": z.string().optional(),
});

const Command = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
  "direct-parameter": z.array(DirectParameter).default([]),
  parameter: z.array(Parameter).default([]),
  result: z.array(ResultType).default([]),
  synonym: z.array(Synonym).default([]),
});

const SdefClass = z.object({
  "@_name": z.string().optional(),
  "@_extends": z.string().optional(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_inherits": z.string().optional(),
  "@_plural": z.string().optional(),
  "@_hidden": z.string().optional(),
  property: z.array(Property).default([]),
  element: z.array(Element).default([]),
  synonym: z.array(Synonym).default([]),
});

const RecordType = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
  property: z.array(Property).default([]),
  synonym: z.array(Synonym).default([]),
});

const ValueType = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_hidden": z.string().optional(),
  synonym: z.array(Synonym).default([]),
});

const Suite = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
  command: z.array(Command).default([]),
  event: z.array(Command).default([]),
  class: z.array(SdefClass).default([]),
  "class-extension": z.array(SdefClass).default([]),
  enumeration: z.array(Enumeration).default([]),
  "record-type": z.array(RecordType).default([]),
  "value-type": z.array(ValueType).default([]),
});

const SdefDocument = z.object({
  dictionary: z.object({
    "@_title": z.string().default(""),
    suite: z.array(Suite),
  }),
});

// Tags that can repeat and must always be arrays
const ARRAY_TAGS = [
  "suite", "command", "event", "class", "class-extension",
  "enumeration", "enumerator", "record-type", "value-type",
  "parameter", "direct-parameter", "result",
  "property", "element", "accessor", "responds-to",
  "synonym",
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  isArray: (name) => ARRAY_TAGS.includes(name),
});

// --- The parsed dictionary ---

export type Access = "r" | "w" | "rw";

export interface Parameter {
  name: string;
  code: string;
  type: string;
  description: string;
  optional: boolean;
  synonyms?: string[];
}

export interface Command {
  suite: string;
  name: string;
  code: string;
  description: string;
  synonyms?: string[];
  directParameter?: { type: string; description: string; optional: boolean };
  parameters: Parameter[];
  result?: { type: string; description: string };
}

export interface Property {
  name: string;
  code: string;
  type: string;
  description: string;
  access: Access;
  synonyms?: string[];
}

export interface Element {
  type: string;
  access: Access;
}

export interface Class {
  suite: string;
  name: string;
  code: string;
  description: string;
  plural?: string;
  inherits?: string;
  synonyms?: string[];
  properties: Property[];
  elements: Element[];
}

export interface RecordType {
  suite: string;
  name: string;
  code: string;
  description: string;
  synonyms?: string[];
  properties: Property[];
}

export interface ValueType {
  suite: string;
  name: string;
  code: string;
  synonyms?: string[];
}

export interface Enumerator {
  name: string;
  code: string;
  description: string;
  synonyms?: string[];
}

export interface Enumeration {
  suite: string;
  name: string;
  code: string;
  enumerators: Enumerator[];
}

export interface Dictionary {
  title: string;
  suites: Array<{ name: string; description: string }>;
  commands: Command[];
  classes: Class[];
  recordTypes: RecordType[];
  valueTypes: ValueType[];
  enumerations: Enumeration[];
}

const hidden = (node: { "@_hidden"?: string | undefined }) => node["@_hidden"] === "yes";

function parseAccess(v: string | undefined): Access {
  if (v === "r") return "r";
  if (v === "w") return "w";
  return "rw";
}

/** The names a term's synonym elements give it; code-only synonyms are for decompiling old scripts. */
function synonyms(node: { synonym: Array<{ "@_name"?: string | undefined }> }): { synonyms?: string[] } {
  const names = node.synonym.flatMap((s) => (s["@_name"] ? [s["@_name"]] : []));
  return names.length > 0 ? { synonyms: names } : {};
}

function properties(nodes: Array<z.infer<typeof Property>>, into: Property[] = []): Property[] {
  for (const p of nodes) {
    if (hidden(p) || into.some((q) => q.name === p["@_name"] && q.code === p["@_code"])) continue;
    into.push({
      name: p["@_name"], code: p["@_code"], type: p["@_type"],
      description: p["@_description"], access: parseAccess(p["@_access"]),
      ...synonyms(p),
    });
  }
  return into;
}

/** Parse an sdef XML string into its dictionary.
 *  Follows appscript's parsing logic where terms collide: a command defined
 *  again with another code keeps its first definition, and a class's
 *  definitions and extensions across suites are merged into one class. */
export function parseSdef(xml: string): Dictionary {
  const doc = SdefDocument.parse(xmlParser.parse(xml));
  const dictionary: Dictionary = {
    title: doc.dictionary["@_title"],
    suites: [], commands: [], classes: [], recordTypes: [], valueTypes: [], enumerations: [],
  };
  const commands = new Map<string, Command>();
  const classes = new Map<string, Class>();

  for (const suite of doc.dictionary.suite) {
    if (hidden(suite)) continue;
    const suiteName = suite["@_name"];
    dictionary.suites.push({ name: suiteName, description: suite["@_description"] });

    for (const cmd of [...suite.command, ...suite.event]) {
      if (hidden(cmd)) continue;
      const existing = commands.get(cmd["@_name"]);
      if (existing && existing.code !== cmd["@_code"]) continue;
      const command: Command = {
        suite: suiteName, name: cmd["@_name"], code: cmd["@_code"], description: cmd["@_description"],
        ...synonyms(cmd),
        parameters: cmd.parameter.filter((p) => !hidden(p)).map((p) => ({
          name: p["@_name"], code: p["@_code"], type: p["@_type"],
          description: p["@_description"], optional: p["@_optional"] === "yes",
          ...synonyms(p),
        })),
      };
      const dp = cmd["direct-parameter"][0];
      if (dp) command.directParameter = { type: dp["@_type"], description: dp["@_description"], optional: dp["@_optional"] === "yes" };
      const res = cmd.result[0];
      if (res?.["@_type"]) command.result = { type: res["@_type"], description: res["@_description"] };
      commands.set(command.name, command);
    }

    for (const cls of [...suite.class, ...suite["class-extension"]]) {
      const name = cls["@_name"] ?? cls["@_extends"];
      if (!name || hidden(cls)) continue;
      const elements = cls.element.filter((e) => !hidden(e)).map((e) => ({ type: e["@_type"], access: parseAccess(e["@_access"]) }));
      const existing = classes.get(name);
      if (existing) {
        properties(cls.property, existing.properties);
        for (const el of elements) if (!existing.elements.some((e) => e.type === el.type)) existing.elements.push(el);
        if (!existing.code && cls["@_code"]) existing.code = cls["@_code"];
        if (!existing.description && cls["@_description"]) existing.description = cls["@_description"];
        if (!existing.inherits && cls["@_inherits"]) existing.inherits = cls["@_inherits"];
        if (!existing.plural && cls["@_plural"]) existing.plural = cls["@_plural"];
        const more = synonyms(cls).synonyms ?? [];
        if (more.length > 0) existing.synonyms = [...(existing.synonyms ?? []), ...more];
        continue;
      }
      const entry: Class = {
        suite: suiteName, name, code: cls["@_code"], description: cls["@_description"],
        ...(cls["@_plural"] ? { plural: cls["@_plural"] } : {}),
        ...(cls["@_inherits"] ? { inherits: cls["@_inherits"] } : {}),
        ...synonyms(cls),
        properties: properties(cls.property),
        elements,
      };
      classes.set(name, entry);
    }

    for (const rt of suite["record-type"]) {
      if (hidden(rt)) continue;
      dictionary.recordTypes.push({
        suite: suiteName, name: rt["@_name"], code: rt["@_code"], description: rt["@_description"],
        ...synonyms(rt),
        properties: properties(rt.property),
      });
    }

    for (const vt of suite["value-type"]) {
      if (hidden(vt)) continue;
      dictionary.valueTypes.push({ suite: suiteName, name: vt["@_name"], code: vt["@_code"], ...synonyms(vt) });
    }

    for (const en of suite.enumeration) {
      if (hidden(en)) continue;
      const enumerators: Enumerator[] = [];
      for (const v of en.enumerator) {
        if (hidden(v) || enumerators.some((e) => e.name === v["@_name"] && e.code === v["@_code"])) continue;
        enumerators.push({ name: v["@_name"], code: v["@_code"], description: v["@_description"], ...synonyms(v) });
      }
      dictionary.enumerations.push({ suite: suiteName, name: en["@_name"], code: en["@_code"], enumerators });
    }
  }

  dictionary.commands = [...commands.values()];
  dictionary.classes = [...classes.values()];
  return dictionary;
}
