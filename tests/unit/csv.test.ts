import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { csvTests, guessMapping, parseCsv } from "../../src/core/lib/csv.ts";

const FIELDS = ["Action", "Data", "Expected Result", "Exigence"];
const fixture = readFileSync(new URL("../fixtures/csv/sectionneur-traction-l92.csv", import.meta.url), "utf8");

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, embedded separators and newlines, CRLF and a BOM", () => {
    const t = parseCsv('﻿a,b,c\r\n1,"x, ""y""",z\r\n2,"multi\r\nline",\r\n\r\n');
    expect(t.separator).toBe(",");
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([
      ["1", 'x, "y"', "z"],
      ["2", "multi\nline", ""],
    ]);
  });

  it("detects a semicolon separator", () => {
    const t = parseCsv("Step;Action;Expected Result\n1;Ouvrir, puis fermer;ok\n");
    expect(t.separator).toBe(";");
    expect(t.rows[0]).toEqual(["1", "Ouvrir, puis fermer", "ok"]);
  });
});

describe("the team's CSV", () => {
  const table = parseCsv(fixture);
  const mapping = guessMapping(table.headers, FIELDS);

  it("maps its columns to step fields and drops Source Reference", () => {
    expect(mapping).toEqual({
      Step: "#step",
      Action: "Action",
      "Expected Result": "Expected Result",
      Exigence: "Exigence",
      "Source Reference": "#ignore",
    });
  });

  it("groups its five rows into one test named after the file, with a warning for each dropped column", () => {
    const { tests, warnings } = csvTests(table, mapping, {
      name: "sectionneur-traction-l92",
      folder: "/Traction/Sectionneurs",
      fieldNames: FIELDS,
    });
    expect(tests).toHaveLength(1);
    expect(tests[0].summary).toBe("sectionneur-traction-l92");
    expect(tests[0].folder).toBe("/Traction/Sectionneurs");
    expect(tests[0].steps).toHaveLength(5);
    expect(tests[0].steps[1].fields).toEqual({
      Action:
        "Naviguer dans l'espace inférieur dédié à la schématique de traction à l'aide de la souris (cliquer-glisser pour se déplacer, molette pour zoomer) et repérer visuellement un objet de type « Sectionneur (S) ».",
      "Expected Result":
        "La navigation est fluide et le Sectionneur (S) est clairement visible et identifiable sur la schématique avec son état visuel par défaut.",
      Exigence: "EXI_MOP_SPF_511_A_1650, EXI_MOP_SPF_511_A_1660",
    });
    expect(warnings).toEqual([
      'Column "Source Reference" dropped: its numbers point to nothing outside the tool that made them — keep the claims in ### Sources instead.',
      'No summary column — the tests are named after the file ("sectionneur-traction-l92").',
    ]);
  });
});

describe("csvTests", () => {
  it("starts a new test at step 1 and when the step number goes back, and names them", () => {
    const table = parseCsv("Step,Action,Expected Result\n1,a,r\n2,b,\n1,c,r\n3,d,r\n2,e,r\n");
    const { tests, warnings } = csvTests(table, guessMapping(table.headers, FIELDS), {
      name: "f",
      folder: "",
      fieldNames: FIELDS,
    });
    expect(tests.map((t) => [t.summary, t.steps.map((s) => s.fields.Action)])).toEqual([
      ["f (1)", ["a", "b"]],
      ["f (2)", ["c", "d"]],
      ["f (3)", ["e"]],
    ]);
    expect(warnings).toContain('"f (1)" step 2 has no Expected Result.');
  });

  it("splits by a summary column and reads folder and labels", () => {
    const table = parseCsv(
      "Summary;Folder;Labels;Action;Résultat attendu;Exigence\nT1;/A;x y;a;r;E1\n;;;b;r2;\nT2;/B;;c;r3;E2\n",
    );
    const mapping = guessMapping(table.headers, FIELDS);
    expect(mapping["Résultat attendu"]).toBe("Expected Result");
    const { tests, warnings } = csvTests(table, mapping, { name: "f", folder: "/Default", fieldNames: FIELDS });
    expect(tests.map((t) => [t.summary, t.folder, t.labels, t.steps.length])).toEqual([
      ["T1", "/A", ["x", "y"], 2],
      ["T2", "/B", [], 1],
    ]);
    expect(tests[0].steps[0].fields).toEqual({ Action: "a", "Expected Result": "r", Exigence: "E1" });
    expect(warnings).toEqual([]);
  });

  it("warns about a column mapped to a field the project does not have", () => {
    const table = parseCsv("Action,Expected Result,Priority\na,r,high\n");
    const { warnings } = csvTests(
      table,
      { Action: "Action", "Expected Result": "Expected Result", Priority: "Priority" },
      { name: "f", folder: "", fieldNames: FIELDS },
    );
    expect(warnings[0]).toContain('"Priority", which is not a step field');
  });
});
