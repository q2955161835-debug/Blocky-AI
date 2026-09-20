import patterns from "./credential-patterns.json";
const credentials = patterns.map((source) => new RegExp(source, "i"));
export function containsCredential(text: string) {
  return credentials.some((pattern) => pattern.test(text));
}
