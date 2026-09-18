import type { SourceFile } from "./snapshot";
export type LicenseEvidence = {
  file: string;
  sha256: string;
  detected: string;
  text: string;
};
export const licenseFile = (path: string) =>
  /(^|\/)(licen[cs]e|copying|notice)(\.[^/]*)?$/i.test(path);
export const dependencyFile = (path: string) =>
  /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|uv\.lock|Cargo\.(toml|lock)|go\.(mod|sum))$/i.test(
    path,
  );
export function inspectLicense(file: SourceFile): LicenseEvidence {
  const body = file.content;
  const normalized = body.replace(/\s+/g, " ");
  const detected = [
    "Permission is hereby granted, free of charge",
    "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
    "The above copyright notice and this permission notice shall be included",
    'THE SOFTWARE IS PROVIDED "AS IS"',
    "IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE",
  ].every((part) => normalized.toLowerCase().includes(part.toLowerCase()))
    ? "MIT"
    : /Apache License\s+Version 2\.0, January 2004[\s\S]*END OF TERMS AND CONDITIONS/i.test(
          body,
        )
      ? "Apache-2.0"
      : "unverified";
  return {
    file: file.path,
    sha256: file.sha256,
    detected,
    text: body.slice(0, 24000),
  };
}
