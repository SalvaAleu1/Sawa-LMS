import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("SawaLearn foundation", () => {
  it("has the selected public brand and separate product positioning", () => {
    const html = readFileSync("index.html", "utf8");
    const readme = readFileSync("README.md", "utf8");
    expect(html).toContain("SawaLearn");
    expect(readme).toContain("independent of the University of Juba portal");
  });
  it("documents the no-auto-termination and access-at-capacity rules", () => {
    const rules = readFileSync("docs/PLATFORM-RULES.md", "utf8");
    expect(rules).toContain("never auto-terminate");
    expect(rules).toContain("Existing users and content remain accessible");
  });
});
