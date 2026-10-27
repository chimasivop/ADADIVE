/**
 * Schema tests: the assessment contract and the JSON Schema handed to the model.
 *
 * The point of these is that the two cannot drift. The JSON Schema is written by
 * hand (so the bytes the model is constrained by are reviewable), and the Zod
 * schema is what validates the reply; if one gains a field the other lacks, a
 * model that follows the JSON Schema would be rejected by Zod. The last test
 * pins them together.
 */

import { assert } from "chai";
import { z } from "zod";

import {
  ASSESSMENT_JSON_SCHEMA,
  RISK_LEVELS,
  assessmentSchema,
  unknownAssessment,
} from "../src/schema";

const VALID = {
  risk_level: "high" as const,
  reasons: ["heartbeat is stale"],
  evidence_cited: ["heartbeatAgeMs=1800000"],
  uncertain: ["whether the node is offline or just not advertising"],
  recommended_action: "Contact the provider before assigning new deals.",
};

describe("assessmentSchema", () => {
  it("accepts a well-formed assessment", () => {
    assert.deepEqual(assessmentSchema.parse(VALID), VALID);
  });

  it("accepts every documented risk level", () => {
    for (const level of RISK_LEVELS) {
      assert.equal(assessmentSchema.parse({ ...VALID, risk_level: level }).risk_level, level);
    }
  });

  it("rejects an unknown risk level", () => {
    assert.throws(() => assessmentSchema.parse({ ...VALID, risk_level: "critical" }));
  });

  it("rejects a missing required field", () => {
    const { reasons: _reasons, ...missing } = VALID;
    assert.throws(() => assessmentSchema.parse(missing));
  });

  it("rejects a non-string entry in reasons", () => {
    assert.throws(() => assessmentSchema.parse({ ...VALID, reasons: [42] }));
  });

  it("rejects a top-level array or scalar", () => {
    assert.throws(() => assessmentSchema.parse([]));
    assert.throws(() => assessmentSchema.parse("low"));
    assert.throws(() => assessmentSchema.parse(null));
  });

  it("does not silently accept extra fields (strict parse via safeParse is the caller's job)", () => {
    // Zod's default object mode strips unknown keys rather than failing, so a
    // model that adds a field still validates — that is intended. What must not
    // happen is a *missing* or mistyped required field passing.
    const parsed = assessmentSchema.parse({ ...VALID, extra: "ignored" });
    assert.notProperty(parsed, "extra");
  });
});

describe("unknownAssessment", () => {
  it("always reports risk_level unknown and cites the reason", () => {
    const a = unknownAssessment("the model returned nothing");
    assert.equal(a.risk_level, "unknown");
    assert.deepEqual(a.reasons, ["the model returned nothing"]);
    assert.deepEqual(a.uncertain, ["the model returned nothing"]);
    assert.isString(a.recommended_action);
  });

  it("produces an assessment the schema accepts", () => {
    assert.doesNotThrow(() => assessmentSchema.parse(unknownAssessment("inconclusive")));
  });
});

describe("ASSESSMENT_JSON_SCHEMA", () => {
  it("declares the same properties as the Zod schema", () => {
    const zodKeys = Object.keys(assessmentSchema.shape).sort();
    const jsonKeys = Object.keys(ASSESSMENT_JSON_SCHEMA.properties).sort();
    assert.deepEqual(jsonKeys, zodKeys);
  });

  it("requires every property", () => {
    assert.deepEqual(
      [...ASSESSMENT_JSON_SCHEMA.required].sort(),
      Object.keys(ASSESSMENT_JSON_SCHEMA.properties).sort()
    );
  });

  it("forbids additional properties", () => {
    assert.isFalse(ASSESSMENT_JSON_SCHEMA.additionalProperties);
  });

  it("satisfies the Meta Model API strict subset (plain-object root, full required)", () => {
    // The request sets response_format.json_schema.strict = true, so the server
    // validates the schema against its strict subset (docs:
    // /docs/structured-output): root must be a plain object with no top-level
    // combinators, every object must set additionalProperties: false, and
    // `required` must list every key in `properties`. A violation would be a 400
    // at request time, so assert the shape here instead of discovering it live.
    assert.equal(ASSESSMENT_JSON_SCHEMA.type, "object");
    for (const combinator of ["anyOf", "oneOf", "allOf", "not", "enum"] as const) {
      assert.notProperty(ASSESSMENT_JSON_SCHEMA, combinator);
    }
    assert.isFalse(ASSESSMENT_JSON_SCHEMA.additionalProperties);
    assert.deepEqual(
      [...ASSESSMENT_JSON_SCHEMA.required].sort(),
      Object.keys(ASSESSMENT_JSON_SCHEMA.properties).sort()
    );
  });

  it("constrains risk_level to exactly the documented levels", () => {
    assert.deepEqual(
      [...ASSESSMENT_JSON_SCHEMA.properties.risk_level.enum],
      [...RISK_LEVELS]
    );
  });

  it("is a valid JSON Schema object (compiles under a reference validator)", () => {
    // A tiny structural check rather than pulling in ajv: the schema is a flat
    // object of arrays/strings, and every nested type must be one of the JSON
    // Schema primitives. This catches a typo like `type: "string[]"`.
    const allowed = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
    const walk = (node: unknown, path: string): void => {
      if (typeof node !== "object" || node === null) return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.type === "string") {
        assert.isTrue(allowed.has(obj.type), `${path}: bad type ${obj.type}`);
      }
      for (const [key, value] of Object.entries(obj)) {
        if (key === "properties" && typeof value === "object" && value !== null) {
          for (const [prop, sub] of Object.entries(value as Record<string, unknown>)) {
            walk(sub, `${path}.properties.${prop}`);
          }
        } else if (key === "items") {
          walk(value, `${path}.items`);
        }
      }
    };
    walk(ASSESSMENT_JSON_SCHEMA, "root");
  });
});
