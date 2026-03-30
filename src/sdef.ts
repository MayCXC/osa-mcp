/**
 * sdef.ts: Parse Apple Scripting Definition (sdef) XML into structured data.
 *
 * sdef files describe an app's scriptable API: suites, commands, classes,
 * properties, parameters, enumerations. This parser extracts what we need
 * to generate MCP tools.
 */

import { XMLParser } from "fast-xml-parser";

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

/** Ensure a value is an array (fast-xml-parser returns single items as objects). */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
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
    isArray: (tagName) =>
      ["suite", "command", "class", "property", "element", "parameter",
       "enumeration", "enumerator", "direct-parameter"].includes(tagName),
  });

  const doc = parser.parse(xml);
  const dict = doc.dictionary;

  const title = dict?.["@_title"] ?? "";
  const commands: SdefCommand[] = [];
  const classes: SdefClass[] = [];
  const enums: SdefEnum[] = [];

  for (const suite of asArray(dict?.suite)) {
    const suiteName = suite["@_name"] ?? "";

    for (const cmd of asArray(suite.command)) {
      if (cmd["@_hidden"] === "yes") continue;

      const command: SdefCommand = {
        suite: suiteName,
        name: cmd["@_name"] ?? "",
        code: cmd["@_code"] ?? "",
        description: cmd["@_description"] ?? "",
        params: [],
      };

      for (const dp of asArray(cmd["direct-parameter"])) {
        command.directParam = {
          type: dp["@_type"] ?? "specifier",
          description: dp["@_description"] ?? "",
          optional: dp["@_optional"] === "yes",
        };
      }

      for (const p of asArray(cmd.parameter)) {
        command.params.push({
          name: p["@_name"] ?? "",
          code: p["@_code"] ?? "",
          type: p["@_type"] ?? "text",
          description: p["@_description"] ?? "",
          optional: p["@_optional"] === "yes",
        });
      }

      commands.push(command);
    }

    for (const cls of asArray(suite["class"])) {
      if (cls["@_hidden"] === "yes") continue;

      const klass: SdefClass = {
        suite: suiteName,
        name: cls["@_name"] ?? "",
        code: cls["@_code"] ?? "",
        description: cls["@_description"] ?? "",
        inherits: cls["@_inherits"] || undefined,
        plural: cls["@_plural"] || undefined,
        properties: [],
        elements: [],
      };

      for (const p of asArray(cls.property)) {
        if (p["@_hidden"] === "yes") continue;
        klass.properties.push({
          name: p["@_name"] ?? "",
          code: p["@_code"] ?? "",
          type: p["@_type"] ?? "text",
          description: p["@_description"] ?? "",
          access: parseAccess(p["@_access"]),
        });
      }

      for (const e of asArray(cls.element)) {
        klass.elements.push({
          type: e["@_type"] ?? "",
          access: parseAccess(e["@_access"]),
        });
      }

      classes.push(klass);
    }

    for (const en of asArray(suite.enumeration)) {
      const values: SdefEnumValue[] = [];
      for (const v of asArray(en.enumerator)) {
        values.push({
          name: v["@_name"] ?? "",
          code: v["@_code"] ?? "",
          description: v["@_description"] ?? "",
        });
      }
      enums.push({
        name: en["@_name"] ?? "",
        code: en["@_code"] ?? "",
        values,
      });
    }
  }

  return { title, commands, classes, enums };
}
