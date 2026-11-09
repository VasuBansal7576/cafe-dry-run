#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { founderInputs, runFounder, verifyFounderRestart } from "./founder.mjs";

const [mode, repo = process.cwd(), portText = "8189"] = process.argv.slice(2);
const port = Number(portText);
if (!["doctor", "pilot", "live", "founder", "demo"].includes(mode) || !Number.isInteger(port) || port < 1024 || port > 65535 || port === 8080) {
  console.error("Usage: verify.mjs <doctor|pilot|live|founder|demo> [repo-root] [isolated-port, default 8189]");
  process.exit(2);
}

const founderMode = mode === "founder" || mode === "demo";
const origin = `http://127.0.0.1:${port}`;
const appPath = "/cafe";
const scenariosPath = "/_agent-native/actions/list-scenarios";
const outputRoot = resolve(process.env.CAFE_EVIDENCE_DIR ?? join(repo, ".artifacts", "verify-cafe-dry-run"));
mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
const output = mkdtempSync(join(outputRoot, `${mode}-`));
const scratch = mkdtempSync(join(tmpdir(), "cafe-verification-"));
const app = join(scratch, "cafe-app");
const database = join(scratch, "pglite");
const file = (name) => join(output, name);
const evidence = {
  mode,
  startedAt: new Date().toISOString(),
  port,
  command: ["verify.mjs", mode, repo, portText],
  scope: founderMode ? ["S1–S6 founder paths", "deterministic portions of demo steps 1–6", "restart persistence", "responsive captures"] : mode === "doctor" ? ["empty database", "local authentication", "framework doctor"] : ["S2 base demand pilot", "b4 framework use in pilot", "b10 persisted scenario pilot", ...(mode === "live" ? ["b1 shared demand action", "b2 demand sync", "b8 real chat demand edit"] : [])],
  checks: [],
  artifacts: [],
};
const runtimeEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => /^(PATH|HOME|USER|LOGNAME|TMPDIR|SHELL|LANG|TERM|LC_.+)$/.test(key)),
);
Object.assign(runtimeEnv, {
  APP_URL: origin,
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  DATABASE_URL: `pglite:${database}`,
});

let server;
let browser;
let page;
let phase = "preflight";
const check = (name, observed) => evidence.checks.push({ name, observed });
function capture(name, value) {
  writeFileSync(file(name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  evidence.artifacts.push(name);
}
const interrupt = new AbortController();
process.once("SIGINT", () => interrupt.abort());
process.once("SIGTERM", () => interrupt.abort());

function exec(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: 180_000,
    ...options,
  });
  assert.equal(result.error?.code ?? result.status, 0, `${command} failed (${result.error?.code ?? result.status})`);
  return result.stdout;
}

function listeners() {
  const result = spawnSync("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  assert(!result.error && !result.stderr && [0, 1].includes(result.status), "Could not inspect loopback listeners with lsof");
  return result.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
}

function verifyOwnership() {
  const pids = listeners();
  assert(pids.length > 0, "No process owns the requested port");
  for (const pid of pids) {
    const group = Number(exec("ps", ["-o", "pgid=", "-p", String(pid)]).trim());
    assert.equal(group, server.pid, "Loopback listener belongs to a different process group");
  }
  return pids;
}

async function startServer() {
  assert.deepEqual(listeners(), [], "Port is occupied. Choose an unused port");
  server = spawn("pnpm", ["exec", "agent-native", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: app, env: runtimeEnv, detached: true, stdio: "ignore",
  });
  evidence.processGroups ??= [];
  if (server.pid) evidence.processGroups.push(server.pid);
  let startupError;
  server.once("error", (error) => { startupError = error.code; });
  for (let attempt = 0; attempt < 180; attempt += 1) {
    interrupt.signal.throwIfAborted();
    assert(!startupError && server.exitCode === null && server.signalCode === null, `Dev server exited before readiness (${startupError ?? server.exitCode})`);
    const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
    if (response?.ok) {
      await response.body?.cancel();
      return verifyOwnership();
    }
    await delay(500, null, { signal: interrupt.signal });
  }
  throw new Error("Dev server did not respond successfully on the requested port");
}

async function stopServer() {
  if (!server?.pid) return;
  const group = -server.pid;
  try {
    process.kill(group, "SIGTERM");
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (!listeners().length && (server.exitCode !== null || server.signalCode !== null)) break;
      await delay(250);
    }
    try {
      process.kill(group, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  for (let attempt = 0; listeners().length && attempt < 20; attempt += 1) await delay(250);
  assert.deepEqual(listeners(), [], "Loopback port is still occupied after stopping the owned process group");
  server = undefined;
}

async function screenshot(locator, name) {
  await locator.screenshot({ path: file(name), animations: "disabled" });
  evidence.artifacts.push(name);
}

async function openCafe(page) {
  await page.goto(origin + appPath, { waitUntil: "domcontentloaded" });
  const localLogin = page.getByRole("button", { name: "Continue as local dev", exact: true });
  const cover = page.getByRole("heading", { name: "Open on paper.", exact: true });
  await localLogin.or(cover).first().waitFor({ state: "visible" });
  if (await localLogin.isVisible()) {
    await localLogin.click();
    await localLogin.waitFor({ state: "hidden" });
    await page.goto(origin + appPath, { waitUntil: "domcontentloaded" });
  }
  await cover.waitFor({ state: "visible" });
}

async function readScenarios(page) {
  const response = await page.request.get(origin + scenariosPath);
  assert.equal(response.status(), 200, "Authenticated list-scenarios did not succeed");
  const { scenarios } = await response.json();
  assert(Array.isArray(scenarios), "Expected a scenario list from the public action transport");
  return scenarios.map(({ id, baseHourlyDemand, revision }) => ({ id, baseHourlyDemand, revision }));
}

function demand(page, count, tag = "Illustrative") {
  return page.getByRole("region", { name: "Your scenario" }).getByText(
    `Current base demand: ${count} customers per hour · ${tag}`,
    { exact: true },
  );
}

async function readDatabase(project) {
  const requireFromApp = createRequire(join(app, "package.json"));
  const { PGlite } = requireFromApp("@electric-sql/pglite");
  const db = await PGlite.create(database);
  try {
    return await project(async (sql) => (await db.query(sql)).rows);
  } finally {
    await db.close();
  }
}

const readRows = () => readDatabase((query) => query(
  'SELECT id, base_hourly_demand AS "baseHourlyDemand", revision FROM cafe_scenarios ORDER BY id',
));

async function verifyFounderDatabase(expected) {
  const records = await readDatabase(async (query) => ({
    scenarios: await query('SELECT id, revision, shop, demand FROM cafe_scenarios ORDER BY id'),
    runs: await query('SELECT id, scenario_id, arrival_source_id, arrival_source_revision FROM cafe_service_runs ORDER BY id'),
    receipts: await query('SELECT id, a_scenario_id, b_scenario_id FROM cafe_decision_runs ORDER BY id'),
  }));
  assert.equal(records.scenarios.length, 3);
  const original = records.scenarios.find((row) => row.id === expected.originalId);
  assert.equal(original.revision, expected.sourceRevision);
  assert.equal(original.demand.pedestrian.count.value, founderInputs.pedestrian.count);
  assert.deepEqual(records.scenarios.find((row) => row.id === expected.baristaId).shop.workers[1].shifts[0], expected.shift);
  const latestRuns = expected.currentRunIds.map((id) => records.runs.find((row) => row.id === id));
  assert.deepEqual(latestRuns.map((row) => row.scenario_id), [expected.baristaId, expected.grinderId]);
  for (const row of latestRuns) {
    assert.equal(row.arrival_source_id, expected.originalId);
    assert.equal(row.arrival_source_revision, expected.sourceRevision);
  }
  assert(records.runs.some((row) => row.id === expected.staleRunId && row.arrival_source_revision < expected.sourceRevision));
  for (const id of [expected.currentReceiptId, expected.staleReceiptId, expected.oldShiftReceiptId]) {
    assert(records.receipts.some((row) => row.id === id), "PGlite must preserve current and historical receipts");
  }
  capture("persisted-records.json", {
    scenarios: records.scenarios.map(({ id, revision }) => ({ id, revision })),
    runs: records.runs,
    receipts: records.receipts,
  });
}

function identifyFounderInputs() {
  const hash = (contents) => createHash("sha256").update(contents).digest("hex");
  const committed = (path) => exec("git", ["-C", repo, "show", `${evidence.commit}:${path}`], { encoding: "buffer" });
  const html = committed("cafe-dry-run-statechart.html");
  const spec = JSON.parse(html.toString().match(/<script type="application\/json" id="spec">([\s\S]*?)<\/script>/)[1]);
  const demo = html.toString().match(/Demo script for the public Clips recording<\/h3>\s*<ol[^>]*>([\s\S]*?)<\/ol>/)[1];
  assert.equal([...demo.matchAll(/<li>/g)].length, 6, "Expected six demo steps in the source HTML");
  const verifier = ".agents/skills/verify-cafe-dry-run/scripts";
  const verify = committed(`${verifier}/verify.mjs`);
  const founder = committed(`${verifier}/founder.mjs`);
  assert.equal(hash(verify), hash(readFileSync(fileURLToPath(import.meta.url))), "Run the verifier from the exact candidate's committed script");
  assert.equal(hash(founder), hash(readFileSync(new URL("./founder.mjs", import.meta.url))), "Run the founder journey from the exact candidate's committed script");
  evidence.inputs = {
    founder: founderInputs,
    sha256: { statechart: hash(html), design: hash(committed("DESIGN.md")), verify: hash(verify), founder: hash(founder) },
  };
  evidence.sourceRequirements = [...spec.states.map(({ id }) => id), ...spec.dod.filter(({ level }) => level === "must").flatMap(({ items }) => items.map(({ id }) => id))];
}

async function liveEdit(context, cafePage, expected) {
  const chat = await context.newPage();
  await chat.goto(origin + "/chat");
  const editor = chat.locator('[data-agent-composer-slot="editor-input"]');
  await editor.waitFor({ state: "visible" });
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    await terminal.question("Connect the authorized model in the scratch app Settings, return to Chat, then press Enter. ", { signal: interrupt.signal });
  } finally {
    terminal.close();
  }
  assert(await editor.isEditable(), "Connect an authorized provider before starting a live chat");
  const prompt = "Use list-scenarios to read the current cafe scenario. Use set-demand to change that same scenario's base hourly demand to 35 customers per hour. Confirm the saved change.";
  const toolsSeen = new Set();
  await editor.fill(prompt);
  const send = chat.locator('[data-agent-composer-slot="send-button"]');
  assert(await send.isEnabled(), "The scratch app has no enabled chat composer. Connect a provider first");
  await send.click();
  check("live chat submitted", { prompt });
  const completedLabels = chat.locator('[data-activity-kind][data-status="completed"] .agentkit-disclosure-label');
  const labels = completedLabels.filter({ hasText: /^(list[- ]scenarios|set[- ]demand)$/i });
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    interrupt.signal.throwIfAborted();
    const closedWork = chat.locator('.agentkit-activities[data-expandable="true"][data-open="false"]').getByRole("button");
    for (const disclosure of await closedWork.all()) {
      if (await disclosure.isVisible()) await disclosure.click({ timeout: 2_000 }).catch(() => {});
    }
    for (const label of await labels.allTextContents()) toolsSeen.add(label.trim().toLowerCase().replace(/ /g, "-"));
    if (await demand(cafePage, 35).isVisible() && toolsSeen.has("list-scenarios") && toolsSeen.has("set-demand")) break;
    await delay(500, null, { signal: interrupt.signal });
  }
  assert(toolsSeen.has("list-scenarios") && toolsSeen.has("set-demand"), "Chat must display both real action calls");
  assert(await demand(cafePage, 35).isVisible(), "Café UI did not receive the agent mutation without navigation");
  const row = { ...expected, baseHourlyDemand: 35, revision: expected.revision + 1 };
  assert.deepEqual(await readScenarios(cafePage), [row]);
  await screenshot(demand(cafePage, 35), "agent-synced-demand.png");
  check("agent shared action and live sync", { tools: [...toolsSeen], row });
  return row;
}

try {
  assert.deepEqual(listeners(), [], "Port is occupied. Choose an unused port");
  assert(mode !== "live" || process.env.CAFE_PROVIDER_SETUP === "manual" && process.stdin.isTTY,
    "Live mode requires CAFE_PROVIDER_SETUP=manual and an interactive terminal for provider setup");
  assert(process.env.CAFE_PLAYWRIGHT, "Set CAFE_PLAYWRIGHT to the installed Playwright index.mjs path");
  const { chromium } = await import(pathToFileURL(resolve(process.env.CAFE_PLAYWRIGHT)).href);
  evidence.commit = exec("git", ["-C", repo, "rev-parse", "HEAD"]).trim();
  evidence.appTree = exec("git", ["-C", repo, "rev-parse", "HEAD:cafe-app"]).trim();
  if (founderMode) identifyFounderInputs();
  phase = "archive committed app";
  const archive = exec("git", ["-C", repo, "archive", evidence.commit, "cafe-app"], { encoding: "buffer" });
  exec("tar", ["-xf", "-", "-C", scratch], { input: archive });
  assert(readdirSync(app).every((name) => !name.startsWith(".env") || name === ".env.example"), "Committed app has an unexpected environment file");
  phase = "install frozen dependencies";
  exec("pnpm", ["install", "--frozen-lockfile"], { cwd: app });
  evidence.coreVersion = JSON.parse(readFileSync(join(app, "node_modules/@agent-native/core/package.json"), "utf8")).version;
  phase = "launch";
  assert(!existsSync(database), "Verification database must start empty");
  check("owned server launched", { pids: await startServer(), emptyDatabaseAtStart: true });
  const launchOptions = { headless: process.env.CAFE_PROVIDER_SETUP !== "manual" };
  if (process.env.CAFE_CHROME) launchOptions.executablePath = process.env.CAFE_CHROME;
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "en-US", ...(founderMode ? { reducedMotion: founderInputs.reducedMotion } : {}) });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(60_000);
  phase = "doctor";
  await openCafe(page);
  assert.deepEqual(await readScenarios(page), [], "An isolated database must have zero scenarios after sign-in");
  await page.getByRole("button", { name: "Start a scenario", exact: true }).waitFor({ state: "visible" });
  check("authenticated doctor", { ownedListeners: verifyOwnership(), migratedEmptyScenarios: true, route: appPath });
  const doctor = JSON.parse(exec("pnpm", ["exec", "agent-native", "doctor", "--json"], { cwd: app, env: runtimeEnv }));
  assert.equal(doctor.ok, true, "Framework doctor reported source findings");
  check("framework doctor", { ok: doctor.ok, guardsRun: doctor.guardsRun });

  if (founderMode) {
    evidence.journeys = [];
    function section(name, requirements) {
      const previous = evidence.journeys.at(-1);
      if (previous) previous.status = "VERIFIED";
      phase = name;
      evidence.journeys.push({ name, requirements, status: "NOT VERIFIED", observations: [], artifacts: [] });
    }
    const record = (name, observed) => evidence.journeys.at(-1).observations.push({ name, observed });
    const attach = (name) => evidence.journeys.at(-1).artifacts.push(name);
    const saveImage = async (locator, name) => {
      await screenshot(locator, name);
      attach(name);
    };
    const saveJson = (name, value) => {
      capture(name, value);
      attach(name);
    };
    const map = JSON.parse(readFileSync(join(app, "shared/cafe/indiranagar.json"), "utf8"));
    const expected = await runFounder({ context, page, origin, map, record, section, screenshot: saveImage, capture: saveJson });
    section("stopped database readback and restart", ["b10"]);
    await stopServer();
    await verifyFounderDatabase(expected);
    attach("persisted-records.json");
    check("owned server restarted", { pids: await startServer() });
    const { composerEditable } = await verifyFounderRestart({ context, page, origin, expected, record, section, screenshot: saveImage });
    evidence.journeys.at(-1).status = "VERIFIED";
    evidence.founder = "VERIFIED";
    evidence.liveDemo = {
      status: "NOT VERIFIED",
      requirements: ["a6", "b1", "b2", "b3", "b6", "b8", "b9", "demo.4", "demo.5", "demo.6"],
      observed: { composerEditable, providerActionsExercised: false },
    };
    if (mode === "demo") {
      phase = "live demo requirements";
      assert.fail("Full demo requires real provider tool calls and the model's recommendation. Founder portions passed.");
    }
  } else if (mode !== "doctor") {
    phase = "founder creation";
    await page.getByRole("button", { name: "Start a scenario", exact: true }).click();
    await demand(page, 20).waitFor({ state: "visible" });
    const createdRows = await readScenarios(page);
    assert.equal(createdRows.length, 1, "The founder action must create exactly one row");
    const [created] = createdRows;
    assert.deepEqual(created, { id: created.id, baseHourlyDemand: 20, revision: 0 });
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    await screenshot(demand(page, 20), "created-demand.png");
    check("founder creates illustrative demand", created);
    phase = "founder edit";
    const input = page.getByRole("spinbutton", { name: "Base customers per hour", exact: true });
    await input.fill("28");
    await screenshot(page.getByRole("region", { name: "Your scenario" }), "demand-edit-input.png");
    await page.getByRole("button", { name: "Save demand", exact: true }).click();
    await demand(page, 28, "Estimate").waitFor({ state: "visible" });
    let expected = { ...created, baseHourlyDemand: 28, revision: 1 };
    assert.deepEqual(await readScenarios(page), [expected]);
    await screenshot(demand(page, 28, "Estimate"), "founder-saved-demand.png");
    check("founder saves demand on same scenario", expected);
    if (mode === "live") {
      phase = "real provider chat edit";
      expected = await liveEdit(context, page, expected);
    }
    phase = "database readback";
    await stopServer();
    const rows = await readRows();
    assert.deepEqual(rows, [expected]);
    writeFileSync(file("scenario-row.json"), JSON.stringify(rows, null, 2) + "\n", { mode: 0o600 });
    evidence.artifacts.push("scenario-row.json");
    check("PGlite persisted a single expected row after server stop", rows);
    phase = "restart and browser readback";
    check("owned server restarted", { pids: await startServer() });
    await openCafe(page);
    await demand(page, expected.baseHourlyDemand, mode === "live" ? "Illustrative" : "Estimate").waitFor({ state: "visible" });
    assert.deepEqual(await readScenarios(page), [expected]);
    await screenshot(demand(page, expected.baseHourlyDemand, mode === "live" ? "Illustrative" : "Estimate"), "restarted-demand.png");
    check("same row and revision after restart", expected);
  }

  evidence.verdict = "VERIFIED";
} catch (error) {
  evidence.verdict = "NOT VERIFIED";
  evidence.failedPhase = phase;
  // Error objects from HTTP clients and provider tools can contain secrets.
  evidence.failure = error.code ?? error.name;
  const safeMessage = error.code === "ERR_ASSERTION"
    ? error.message.split("\n")[0]
    : founderMode && /^(?:locator|page)\./.test(error.message)
      ? stripVTControlCharacters(error.message).split("\n").slice(0, 4).join(" ")
      : error.name;
  if (founderMode) {
    evidence.detail = safeMessage;
    if (page && evidence.journeys?.length && phase !== "live demo requirements") {
      await screenshot(page, "failure.png").catch(() => {});
    }
  }
  console.error(`NOT VERIFIED in ${phase}. ${safeMessage}`);
  process.exitCode = 1;
} finally {
  try {
    await browser?.close();
    await stopServer();
    rmSync(scratch, { recursive: true, force: true });
    assert(!existsSync(scratch), "Scratch directory still exists");
    assert(evidence.artifacts.every((name) => existsSync(file(name))), "Cleanup lost an evidence file");
    check("cleanup", { scratchRemoved: true, evidenceFilesSurvived: true });
  } catch {
    evidence.verdict = "NOT VERIFIED";
    evidence.failedPhase = "cleanup";
    process.exitCode = 1;
    console.error(`Cleanup incomplete. Check the recorded owned process and scratch directory ${scratch}.`);
  }
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(file("index.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(`${evidence.verdict} ${file("index.json")}`);
}
