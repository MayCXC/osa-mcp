/**
 * sdef.ts: Parse Apple Scripting Definition (sdef) XML via Zod schema.
 *
 * The Zod schema mirrors the sdef.dtd structure. fast-xml-parser produces
 * raw JSON, Zod validates and types it in one pass.
 */

import { z } from "zod";
import { XMLParser } from "fast-xml-parser";

/** Ensure a value is an array (fast-xml-parser returns single items as objects). */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// --- Zod schema matching sdef.dtd ---

const Enumerator = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
});

const Enumeration = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  enumerator: z.union([z.array(Enumerator), Enumerator]).optional(),
});

const DirectParameter = z.object({
  "@_type": z.string().optional(),
  "@_description": z.string().default(""),
  "@_optional": z.string().optional(),
  "@_requires-access": z.string().optional(),
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

const Result = z.object({
  "@_type": z.string().optional(),
  "@_description": z.string().default(""),
}).optional();

const Command = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_hidden": z.string().optional(),
  "direct-parameter": z.union([z.array(DirectParameter), DirectParameter]).optional(),
  parameter: z.union([z.array(Parameter), Parameter]).optional(),
  result: z.union([z.array(Result), Result]).optional(),
});

const SdefClass = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
  "@_inherits": z.string().optional(),
  "@_plural": z.string().optional(),
  "@_hidden": z.string().optional(),
  property: z.union([z.array(Property), Property]).optional(),
  element: z.union([z.array(Element), Element]).optional(),
  "responds-to": z.any().optional(),
  contents: z.any().optional(),
});

const Suite = z.object({
  "@_name": z.string(),
  "@_code": z.string().default(""),
  "@_description": z.string().default(""),
}).passthrough();

const Dictionary = z.object({
  "@_title": z.string().default(""),
  suite: z.union([z.array(Suite), Suite]),
});

const SdefDocument = z.object({
  dictionary: Dictionary,
}).passthrough();

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

function parseAccess(v: string | undefined): "r" | "w" | "rw" {
  if (v === "r") return "r";
  if (v === "w") return "w";
  return "rw";
}

/** Parse an sdef XML string into structured data. */
export function parseSdef(xml: string): Sdef {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    allowBooleanAttributes: true,
  });

  const raw = parser.parse(xml.replace(/<!DOCTYPE[^>]*>/i, ""));
  const doc = SdefDocument.parse(raw);
  const dict = doc.dictionary;

  const commands: SdefCommand[] = [];
  const classes: SdefClass[] = [];
  const enums: SdefEnum[] = [];

  for (const suite of asArray(dict.suite as any)) {
    const suiteName = suite["@_name"];

    // Commands and events (same structure)
    for (const cmd of [...asArray(suite.command as any), ...asArray(suite.event as any)]) {
      if (cmd["@_hidden"] === "yes") continue;

      const command: SdefCommand = {
        suite: suiteName,
        name: cmd["@_name"],
        code: cmd["@_code"],
        description: cmd["@_description"],
        params: [],
      };

      for (const dp of asArray(cmd["direct-parameter"])) {
        if (dp) {
          command.directParam = {
            type: dp["@_type"] ?? "specifier",
            description: dp["@_description"] ?? "",
            optional: dp["@_optional"] === "yes",
          };
        }
      }

      for (const p of asArray(cmd.parameter)) {
        if (p) {
          command.params.push({
            name: p["@_name"],
            code: p["@_code"],
            type: p["@_type"],
            description: p["@_description"],
            optional: p["@_optional"] === "yes",
          });
        }
      }

      for (const r of asArray(cmd.result)) {
        if (r?.["@_type"]) {
          command.result = {
            type: r["@_type"],
            description: r["@_description"] ?? "",
          };
        }
      }

      commands.push(command);
    }

    // Classes and class-extensions
    for (const cls of [...asArray(suite["class"] as any), ...asArray(suite["class-extension"] as any)]) {
      if (cls["@_hidden"] === "yes") continue;

      const klass: SdefClass = {
        suite: suiteName,
        name: cls["@_name"],
        code: cls["@_code"],
        description: cls["@_description"],
        inherits: cls["@_inherits"] || undefined,
        plural: cls["@_plural"] || undefined,
        properties: [],
        elements: [],
      };

      for (const p of asArray(cls.property)) {
        if (p && p["@_hidden"] !== "yes") {
          klass.properties.push({
            name: p["@_name"],
            code: p["@_code"],
            type: p["@_type"],
            description: p["@_description"],
            access: parseAccess(p["@_access"]),
          });
        }
      }

      for (const e of asArray(cls.element)) {
        if (e) {
          klass.elements.push({
            type: e["@_type"],
            access: parseAccess(e["@_access"]),
          });
        }
      }

      classes.push(klass);
    }

    // Enumerations
    for (const en of asArray(suite.enumeration as any)) {
      const values: SdefEnumValue[] = [];
      for (const v of asArray(en.enumerator)) {
        if (v && v["@_hidden"] !== "yes") {
          values.push({
            name: v["@_name"],
            code: v["@_code"],
            description: v["@_description"],
          });
        }
      }
      enums.push({
        name: en["@_name"],
        code: en["@_code"],
        values,
      });
    }
  }

  return { title: dict["@_title"], commands, classes, enums };
}
