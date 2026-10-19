import { describe, expect, it } from "vitest";
import { loginSchema, passwordRules, recoverySchema, signupSchema } from "../authSchema";

const firstError = (result: { success: boolean; error?: { issues: Array<{ message: string; path: PropertyKey[] }> } }) =>
  result.error?.issues[0];

describe("auth schemas", () => {
  it("requires a non-blank username", () => {
    expect(firstError(loginSchema.safeParse({ username: "   ", password: "x" }))?.message).toBe("Username is required.");
  });

  it("trims the username", () => {
    expect(loginSchema.parse({ username: "  ada ", password: "x" }).username).toBe("ada");
  });

  it.each([
    ["short1!", false],
    ["longenough!", false],
    ["longenough1", false],
    ["longenough1!", true]
  ])("signup password %s valid=%s", (password, valid) => {
    const result = signupSchema.safeParse({ username: "ada", password, confirmPassword: password });
    expect(result.success).toBe(valid);
  });

  it("matches the old client's password rule exactly", () => {
    const oldRule = /^(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
    for (const sample of ["abc", "abcdefg1!", "abcdefgh1", "abcdefgh!", "12345678!", "pass word1", "ü1234567"]) {
      expect(passwordRules.every((rule) => rule.test(sample))).toBe(oldRule.test(sample));
    }
  });

  it("reports mismatched confirmation on the confirm field", () => {
    const issue = firstError(signupSchema.safeParse({ username: "ada", password: "longenough1!", confirmPassword: "nope" }));
    expect(issue?.path).toEqual(["confirmPassword"]);
    expect(issue?.message).toBe("Passwords do not match.");
  });

  it("requires a recovery code", () => {
    expect(firstError(recoverySchema.safeParse({ username: "ada", recoveryCode: " " }))?.message).toBe("Recovery code is required.");
  });
});
