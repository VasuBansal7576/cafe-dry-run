import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.argv[2] ?? path.join(root, "cafe-dry-run-statechart.html"));
const destination = path.resolve(process.argv[3] ?? root);
const html = await readFile(source, "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bid=["']spec["'][^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, "Expected exactly one script#spec JSON block");
const spec = JSON.parse(scripts[0][1]);
assert.deepEqual(spec.states.map(state => state.id), ["S1", "S2", "S3", "S4", "S5", "S6"]);
assert.ok(Array.isArray(spec.actions) && spec.actions.length > 0, "Action contracts are missing");
for (const prefix of ["A.", "B."]) {
  const group = spec.dod.find(item => item.group.startsWith(prefix));
  assert.ok(group?.level === "must" && group.items.length > 0, `Required DoD group ${prefix} is missing`);
}

const demo = html.match(/<h3\b[^>]*>\s*Demo script for the public Clips recording\s*<\/h3>\s*<ol\b[^>]*>([\s\S]*?)<\/ol>/i);
assert.ok(demo, "The separate HTML demo script is missing");
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const steps = [...demo[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(([, item]) => item
  .replace(/<[^>]*>/g, "")
  .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => entities[name])
  .replace(/\s+/g, " ")
  .trim());
assert.equal(steps.length, 6, "Expected all six demo steps");
assert.ok(steps.every(Boolean), "Demo steps must not be empty");
const markdown = [
  "# Cafe Dry Run demo",
  "",
  "Generated from cafe-dry-run-statechart.html. Edit the source, then run `node scripts/extract-spec.mjs`.",
  "",
  "The agent rehearses these steps in the real app. The human records and publishes the Clips demonstration.",
  "",
  ...steps.map((step, index) => `${index + 1}. ${step}`),
  "",
].join("\n");

await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, "SPEC.json"), JSON.stringify(spec, null, 2) + "\n");
await writeFile(path.join(destination, "DEMO.md"), markdown);
console.log(`Extracted ${spec.states.length} states, ${spec.actions.length} actions, and ${steps.length} demo steps.`);
