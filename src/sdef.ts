/**
 * sdef.ts: Parse Apple Scripting Definition (sdef) XML.
 *
 * Uses fast-xml-parser with isArray config to normalize the structure,
 * then Zod to validate and type the result. The Zod schema mirrors the
 * sdef.dtd so it acts as a runtime DTD validator.
 */

import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

// --- Zod schema mirroring sdef.dtd ---

const Enumerator = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
});

const Enumeration = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
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
});

const Property = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_type": z.string().default("text"),
  "@_description": z.string().default(""),
  "@_access": z.string().optional(),
  "@_hidden": z.string().optional(),
});

const Element = z.object({
  "@_type": z.string(),
  "@_access": z.string().optional(),
});

const Command = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
  "direct-parameter": z.array(DirectParameter).default([]),
  parameter: z.array(Parameter).default([]),
  result: z.array(ResultType).default([]),
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
});

const Suite = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  command: z.array(Command).default([]),
  event: z.array(Command).default([]),
  class: z.array(SdefClass).default([]),
  "class-extension": z.array(SdefClass).default([]),
  enumeration: z.array(Enumeration).default([]),
  "record-type": z.array(z.any()).default([]),
  "value-type": z.array(z.any()).default([]),
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

// --- Exported types (flattened for generator use) ---

export interface SdefParam {
  name: string;
  code: string;
  type: string;
  description: string;
  optional: boolean;
}

export interface SdefCommand {
  suite: string;
  name: string;
  code: string;
  description: string;
  directParam?: { type: string; description: string; optional: boolean };
  params: SdefParam[];
  result?: { type: string; description: string };
}

export interface SdefProperty {
  name: string;
  code: string;
  type: string;
  description: string;
  access: "r" | "w" | "rw";
}

export interface SdefElement {
  type: string;
  access: "r" | "w" | "rw";
}

export interface SdefClass {
  suite: string;
  name: string;
  code: string;
  description: string;
  inherits?: string;
  plural?: string;
  properties: SdefProperty[];
  elements: SdefElement[];
}

export interface SdefEnumValue {
  name: string;
  code: string;
  description: string;
}

export interface SdefEnum {
  name: string;
  code: string;
  values: SdefEnumValue[];
}

export interface Sdef {
  title: string;
  commands: SdefCommand[];
  classes: SdefClass[];
  enums: SdefEnum[];
}

/** A base type from ScriptingBridge intrinsics.sdef */
export interface IntrinsicType {
  name: string;
  code: string;
  jsType: "string" | "number" | "boolean" | "object" | "array" | "any";
  synonyms: string[];
}

/** Parse intrinsics.sdef into a type name -> jsType map (including synonyms). */
export function parseIntrinsics(xml: string): Map<string, IntrinsicType> {
  const intrParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
    isArray: (name) => [...ARRAY_TAGS, "value-type", "synonym"].includes(name),
  });
  const raw = intrParser.parse(xml.replace(/<!DOCTYPE[^>]*>[\s\S]*?(?=<dictionary)/, ""));
  const map = new Map<string, IntrinsicType>();

  const dict = raw.dictionary;
  if (!dict) return map;

  const suites = Array.isArray(dict.suite) ? dict.suite : [dict.suite];
  for (const suite of suites) {
    if (!suite) continue;
    for (const vt of suite["value-type"] ?? []) {
      if (!vt) continue;
      const name = vt["@_name"];
      if (!name) continue;

      // Map to JS types based on the cocoa class
      const cocoaArr = Array.isArray(vt.cocoa) ? vt.cocoa : vt.cocoa ? [vt.cocoa] : [];
      const cocoa = cocoaArr[0]?.["@_class"] ?? "";
      let jsType: IntrinsicType["jsType"] = "string";
      if (cocoa.includes("Number")) jsType = "number";
      else if (cocoa === "NSArray") jsType = "array";
      else if (cocoa === "NSDictionary") jsType = "object";
      else if (cocoa === "NSNull") jsType = "any";
      else if (cocoa === "SBObject" || cocoa === "id") jsType = "any";

      if (name === "boolean") jsType = "boolean";
      if (name === "integer" || name === "real" || name === "number" || name === "double integer") jsType = "number";

      const synonyms: string[] = [];
      for (const syn of vt.synonym ?? []) {
        if (!syn) continue;
        const synName = syn["@_name"];
        if (synName) synonyms.push(synName);
      }

      const entry: IntrinsicType = { name, code: vt["@_code"] ?? "", jsType, synonyms };
      map.set(name, entry);
      for (const syn of synonyms) map.set(syn, entry);
    }
  }

  return map;
}

function parseAccess(v: string | undefined): "r" | "w" | "rw" {
  if (v === "r") return "r";
  if (v === "w") return "w";
  return "rw";
}

/** Deduplication key from name + code. */
function dedupKey(name: string, code: string): string {
  return `${name}\0${code}`;
}

/** Extract synonyms with names (ignore code-only synonyms per appscript). */
function parseSynonyms(node: any): Array<{ name: string; code: string; plural?: string }> {
  const result: Array<{ name: string; code: string; plural?: string }> = [];
  for (const syn of node.synonym ?? []) {
    if (!syn) continue;
    const name = syn["@_name"];
    if (!name) continue; // code-only synonyms are for decompiling old scripts
    result.push({
      name,
      code: syn["@_code"] ?? node["@_code"] ?? "",
      plural: syn["@_plural"] || undefined,
    });
  }
  return result;
}

/** Parse an sdef XML string into structured data.
 *  Follows appscript's parsing logic: deduplication, synonyms,
 *  record-type/value-type as classes, command overlap handling. */
export function parseSdef(xml: string): Sdef {
  const raw = xmlParser.parse(xml.replace(/<!DOCTYPE[^>]*>/i, ""));
  const doc = SdefDocument.parse(raw);

  // Deduplication sets (appscript pattern)
  const foundCommands = new Map<string, SdefCommand>();
  const foundClasses = new Set<string>();
  const foundEnums = new Set<string>();

  const commands: SdefCommand[] = [];
  const classes: SdefClass[] = [];
  const enums: SdefEnum[] = [];

  for (const suite of doc.dictionary.suite) {
    const suiteName = suite["@_name"];

    // Commands and events
    for (const cmd of [...suite.command, ...suite.event]) {
      if (cmd["@_hidden"] === "yes") continue;
      const name = cmd["@_name"];
      const code = cmd["@_code"];

      // Dedup: same name + same code = last wins; same name + diff code = first wins
      const existing = foundCommands.get(name);
      if (existing && existing.code !== code) continue;

      const params: SdefParam[] = [];
      for (const p of cmd.parameter) {
        params.push({
          name: p["@_name"],
          code: p["@_code"],
          type: p["@_type"],
          description: p["@_description"],
          optional: p["@_optional"] === "yes",
        });
        // Parameter synonyms
        const paramSeen = new Set<string>();
        for (const syn of parseSynonyms(p)) {
          const pk = dedupKey(syn.name, syn.code);
          if (!paramSeen.has(pk)) {
            paramSeen.add(pk);
            params.push({ name: syn.name, code: syn.code, type: p["@_type"], description: p["@_description"], optional: p["@_optional"] === "yes" });
          }
        }
      }

      const command: SdefCommand = { suite: suiteName, name, code, description: cmd["@_description"], params };

      const dp = cmd["direct-parameter"][0];
      if (dp) {
        command.directParam = { type: dp["@_type"], description: dp["@_description"], optional: dp["@_optional"] === "yes" };
      }

      const res = cmd.result[0];
      if (res?.["@_type"]) {
        command.result = { type: res["@_type"], description: res["@_description"] };
      }

      foundCommands.set(name, command);

      // Command synonyms
      for (const syn of parseSynonyms(cmd)) {
        const synExisting = foundCommands.get(syn.name);
        if (!synExisting || synExisting.code === (syn.code || code)) {
          foundCommands.set(syn.name, { ...command, name: syn.name, code: syn.code || code });
        }
      }
    }

    // Classes, class-extensions, and record-types
    for (const cls of [...suite["class"], ...suite["class-extension"], ...(suite["record-type"] ?? [])]) {
      if (!cls || cls["@_hidden"] === "yes") continue;
      const name = cls["@_name"] ?? cls["@_extends"];
      if (!name) continue;
      const code = cls["@_code"] ?? "";
      const key = dedupKey(name, code);

      if (!foundClasses.has(key)) {
        foundClasses.add(key);

        const properties: SdefProperty[] = [];
        const classProps = new Set<string>(); // per-class dedup
        for (const p of cls.property ?? []) {
          if (p["@_hidden"] === "yes") continue;
          const propKey = dedupKey(p["@_name"], p["@_code"]);
          if (!classProps.has(propKey)) {
            classProps.add(propKey);
            properties.push({
              name: p["@_name"], code: p["@_code"], type: p["@_type"],
              description: p["@_description"], access: parseAccess(p["@_access"]),
            });
          }
          // Property synonyms
          for (const syn of parseSynonyms(p)) {
            const synKey = dedupKey(syn.name, syn.code);
            if (!classProps.has(synKey)) {
              classProps.add(synKey);
              properties.push({
                name: syn.name, code: syn.code, type: p["@_type"],
                description: p["@_description"], access: parseAccess(p["@_access"]),
              });
            }
          }
        }

        classes.push({
          suite: suiteName, name, code,
          description: cls["@_description"] ?? "",
          inherits: cls["@_inherits"] || undefined,
          plural: cls["@_plural"] || undefined,
          properties,
          elements: (cls.element ?? []).map((e: any) => ({
            type: e["@_type"], access: parseAccess(e["@_access"]),
          })),
        });
      }

      // Class synonyms register as additional class entries
      for (const syn of parseSynonyms(cls)) {
        const synKey = dedupKey(syn.name, syn.code);
        if (!foundClasses.has(synKey)) {
          foundClasses.add(synKey);
          classes.push({
            suite: suiteName, name: syn.name, code: syn.code,
            description: cls["@_description"] ?? "",
            plural: syn.plural || `${syn.name}s`,
            properties: [], elements: [],
          });
        }
      }
    }

    // Value-types (treated as class entries, per appscript)
    for (const vt of suite["value-type"] ?? []) {
      if (!vt) continue;
      const name = vt["@_name"];
      if (!name) continue;
      const code = vt["@_code"] ?? "";
      const key = dedupKey(name, code);
      if (!foundClasses.has(key)) {
        foundClasses.add(key);
        classes.push({
          suite: suiteName, name, code,
          description: "", properties: [], elements: [],
        });
      }
      for (const syn of parseSynonyms(vt)) {
        const synKey = dedupKey(syn.name, syn.code);
        if (!foundClasses.has(synKey)) {
          foundClasses.add(synKey);
          classes.push({
            suite: suiteName, name: syn.name, code: syn.code,
            description: "", properties: [], elements: [],
          });
        }
      }
    }

    // Enumerations
    for (const en of suite.enumeration) {
      const values: SdefEnumValue[] = [];
      for (const v of en.enumerator) {
        if (v["@_hidden"] === "yes") continue;
        const vKey = dedupKey(v["@_name"], v["@_code"]);
        if (!foundEnums.has(vKey)) {
          foundEnums.add(vKey);
          values.push({ name: v["@_name"], code: v["@_code"], description: v["@_description"] });
        }
        // Enumerator synonyms
        for (const syn of parseSynonyms(v)) {
          const synKey = dedupKey(syn.name, syn.code);
          if (!foundEnums.has(synKey)) {
            foundEnums.add(synKey);
            values.push({ name: syn.name, code: syn.code, description: v["@_description"] });
          }
        }
      }
      enums.push({ name: en["@_name"], code: en["@_code"], values });
    }
  }

  // Convert command map to array
  commands.push(...foundCommands.values());

  return { title: doc.dictionary["@_title"], commands, classes, enums };
}
