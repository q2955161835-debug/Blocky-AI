import { describe, expect, it } from "vitest";
import { redactSensitiveValues, scanSensitiveValues } from "../../src/core/securityScan";

describe("sensitive value scanner", () => {
  it("scans recursively through string values with JSON paths and not key names", () => {
    const fakeToken = ["sk", "-", "test", "A".repeat(24)].join("");
    const fakePath = ["C", ":\\", "Users\\Example\\secret.txt"].join("");
    const github = ["gh", "p", "_", "a".repeat(36)].join("");
    const aws = ["AK", "IA", "A".repeat(16)].join("");
    const bearer = ["Bearer ", "x".repeat(16)].join("");
    const pem = ["-----BEGIN ", "PRIVATE KEY-----"].join("");
    const cookie = ["Cookie", ": session=", "x".repeat(12)].join("");
    const unixPath = ["/", "var", "/tmp/data.txt"].join("");
    const findings = scanSensitiveValues({
      fakeToken,
      nested: [fakePath, { github, aws, bearer, pem, cookie, unixPath }],
      [fakeToken]: "ordinary value",
    });

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "$.fakeToken", kind: "model-token" }),
      expect.objectContaining({ path: "$.nested[0]", kind: "windows-absolute-path" }),
      expect.objectContaining({ kind: "github-token" }),
      expect.objectContaining({ kind: "aws-access-key" }),
      expect.objectContaining({ kind: "bearer-token" }),
      expect.objectContaining({ kind: "pem-private-key" }),
      expect.objectContaining({ kind: "cookie" }),
      expect.objectContaining({ kind: "unix-absolute-path" }),
    ]));
    expect(findings.some((finding) => finding.path.includes(fakeToken))).toBe(false);
  });

  it("redacts sensitive values without changing ordinary values", () => {
    const fakeToken = ["sk", "-", "test", "A".repeat(24)].join("");

    expect(redactSensitiveValues({ fakeToken, safe: "projectId" })).toEqual({
      fakeToken: "[REDACTED:model-token]",
      safe: "projectId",
    });
  });
});
