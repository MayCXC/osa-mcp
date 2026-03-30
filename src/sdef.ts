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

/** Parse an sdef XML string into structured data. */
export function parseSdef(xml: string): Sdef {
  const raw = xmlParser.parse(xml.replace(/<!DOCTYPE[^>]*>/i, ""));
  const doc = SdefDocument.parse(raw);

  const commands: SdefCommand[] = [];
  const classes: SdefClass[] = [];
  const enums: SdefEnum[] = [];

  for (const suite of doc.dictionary.suite) {
    const suiteName = suite["@_name"];

    for (const cmd of [...suite.command, ...suite.event]) {
      if (cmd["@_hidden"] === "yes") continue;

      const command: SdefCommand = {
        suite: suiteName,
        name: cmd["@_name"],
        code: cmd["@_code"],
        description: cmd["@_description"],
        params: cmd.parameter.map((p) => ({
          name: p["@_name"],
          code: p["@_code"],
          type: p["@_type"],
          description: p["@_description"],
          optional: p["@_optional"] === "yes",
        })),
      };

      const dp = cmd["direct-parameter"][0];
      if (dp) {
        command.directParam = {
          type: dp["@_type"],
          description: dp["@_description"],
          optional: dp["@_optional"] === "yes",
        };
      }

      const res = cmd.result[0];
      if (res?.["@_type"]) {
        command.result = {
          type: res["@_type"],
          description: res["@_description"],
        };
      }

      commands.push(command);
    }

    for (const cls of [...suite["class"], ...suite["class-extension"]]) {
      if (cls["@_hidden"] === "yes") continue;
      const name = cls["@_name"] ?? cls["@_extends"];
      if (!name) continue;

      classes.push({
        suite: suiteName,
        name,
        code: cls["@_code"],
        description: cls["@_description"],
        inherits: cls["@_inherits"] || undefined,
        plural: cls["@_plural"] || undefined,
        properties: cls.property
          .filter((p) => p["@_hidden"] !== "yes")
          .map((p) => ({
            name: p["@_name"],
            code: p["@_code"],
            type: p["@_type"],
            description: p["@_description"],
            access: parseAccess(p["@_access"]),
          })),
        elements: cls.element.map((e) => ({
          type: e["@_type"],
          access: parseAccess(e["@_access"]),
        })),
      });
    }

    for (const en of suite.enumeration) {
      enums.push({
        name: en["@_name"],
        code: en["@_code"],
        values: en.enumerator
          .filter((v) => v["@_hidden"] !== "yes")
          .map((v) => ({
            name: v["@_name"],
            code: v["@_code"],
            description: v["@_description"],
          })),
      });
    }
  }

  return { title: doc.dictionary["@_title"], commands, classes, enums };
}
