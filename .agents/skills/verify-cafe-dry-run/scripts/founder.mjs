import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export const founderInputs = {
  spot: "Near Indiranagar Metro",
  hourly: { low: 45, base: 55, high: 75 },
  hours: { opens: "08:00", closes: "14:30" },
  cash: 510000,
  rent: 58000,
  weekdays: 23,
  weekends: 5,
  weekdayBase: 83,
  weekdayStaff: 2,
  weekdayHours: 5,
  wage: 125,
  seed: 1,
  runCount: 1,
  extraGrinder: 30000,
  shift: { starts: "10:00", ends: "12:00" },
  pedestrian: { count: 600, conversionPercent: 10 },
  widths: [1440, 390],
  reducedMotion: "reduce",
};

const base = founderInputs;
const exact = (scope, label) => scope.getByLabel(label, { exact: true });
const select = (scope, label) => scope.getByRole("combobox", { name: label, exact: true });
const button = (scope, name) => scope.getByRole("button", { name, exact: true });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const signedCash = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", signDisplay: "exceptZero" });
const count = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const signedCount = new Intl.NumberFormat("en-IN", { signDisplay: "exceptZero", maximumFractionDigits: 2 });
const waitDelta = (seconds) => seconds === null ? "Unavailable" : `${seconds > 0 ? "+" : ""}${count.format(seconds / 60)} min`;
const ledgerCash = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const money = (value) => Math.round(value * 100);

async function poll(label, read) {
  const deadline = Date.now() + 20_000;
  do {
    const value = await read();
    if (value) return value;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(`Timed out waiting for ${label}`);
}

async function viewportCapture(page, locator, screenshot, name) {
  await locator.evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await screenshot(page, name);
}

async function expand(page, name) {
  const summary = page.getByText(name, { exact: true });
  if (await summary.locator("..").getAttribute("open") === null) await summary.click();
}

function founderActions(page, origin) {
  async function get(name, params) {
    const response = await page.request.get(`${origin}/_agent-native/actions/${name}`, { params });
    assert.equal(response.status(), 200, `${name} read failed`);
    return response.json();
  }
  return {
    scenarios: async () => (await get("list-scenarios")).scenarios,
    service: async (id, runId) => (await get("get-simulation", {
      id, ...(runId ? { runId } : {}), includePlayback: "true",
    })).run,
    comparison: (aId, bId, receiptId) => get("get-comparison", {
      aId, ...(bId ? { bId } : {}), ...(receiptId ? { receiptId } : {}),
    }),
  };
}

async function tabState(page, origin) {
  const tab = await page.evaluate(() => sessionStorage.getItem("agent-native:browser-tab-id"));
  assert.match(tab ?? "", /^[A-Za-z0-9_-]{1,96}$/, "Agent-Native must assign the current browser tab an ID");
  const endpoint = `${origin}/_agent-native/application-state`;
  const headers = { "X-Agent-Native-Browser-Tab": tab };
  return {
    playbackKey: `cafe-playback:${tab}`,
    async read(...keys) {
      const response = await page.request.get(endpoint, { headers, params: { keys: keys.join(",") } });
      assert(response.ok(), "Agent-Native application state read failed");
      return (await response.json()).values;
    },
    async sendNavigationCommand(destination) {
      const response = await page.request.put(`${endpoint}/navigate`, {
        headers: { ...headers, "X-Request-Source": "verify-founder" },
        data: { path: destination, _writeId: `verify-founder-${Date.now()}` },
      });
      assert(response.ok(), "Tab-scoped navigation command failed");
    },
  };
}

async function verifyPublishedPlayback(page, origin, receiptId, runA, runB, second) {
  const state = await tabState(page, origin);
  return poll("current café navigation and paired playback in application_state", async () => {
    const values = await state.read("navigation", state.playbackKey);
    const navigation = values.navigation;
    const playback = values[state.playbackKey];
    if (navigation?.view !== "cafe" || navigation.scenarioId !== runA.scenarioId ||
        navigation.comparisonScenarioId !== runB.scenarioId ||
        playback?.receiptId !== receiptId || playback.second !== second) return null;
    assert.equal(playback.scenarioId, runA.scenarioId);
    assert.equal(playback.runId, runA.id);
    assert.equal(playback.comparisonScenarioId, runB.scenarioId);
    assert.equal(playback.comparisonRunId, runB.id);
    return { navigation, playback };
  });
}

async function submitRun(page, formName, action, submitName) {
  const form = page.getByRole("form", { name: formName });
  await select(form, "Demand case").selectOption("base");
  await exact(form, "Random seed").fill(String(base.seed));
  await exact(form, "Saturdays to run").fill(String(base.runCount));
  const [response] = await Promise.all([
    page.waitForResponse((reply) => reply.url().endsWith(`/actions/${action}`) && reply.request().method() === "POST"),
    form.getByRole("button", { name: submitName }).click(),
  ]);
  assert(response.ok(), `${action} returned status ${response.status()}`);
}

function timelineCounts(events, second) {
  const state = new Map();
  let arrived = 0;
  let served = 0;
  let lost = 0;
  for (const event of events) {
    if (event.at > second) break;
    switch (event.kind) {
      case "arrived":
        arrived += 1;
        state.set(event.arrivalId, "waiting");
        break;
      case "task_started":
        state.set(event.arrivalId, "active");
        break;
      case "task_queued":
      case "task_completed":
        state.set(event.arrivalId, "waiting");
        break;
      case "order_served":
        served += 1;
        state.delete(event.arrivalId);
        break;
      case "customer_lost":
        lost += 1;
        state.delete(event.arrivalId);
        break;
    }
  }
  const waiting = [...state.values()].filter((value) => value === "waiting").length;
  return { Arrived: arrived, Waiting: waiting, "In service": state.size - waiting, Served: served, Lost: lost };
}

async function boardCounts(board) {
  const rows = board.locator('dl[aria-label="Counts at the selected time"] > div');
  await rows.first().waitFor();
  return Object.fromEntries(await rows.evaluateAll((entries) => entries.map((row) => [
    row.querySelector("dt").textContent.trim(), Number(row.querySelector("dd").textContent),
  ])));
}

async function checkPlayback(page, runs, labels) {
  const slider = page.getByRole("slider", { name: "Saturday timeline" });
  await slider.waitFor();
  assert.equal(await slider.count(), 1, "Both boards must share one timeline");
  const start = Number(await slider.getAttribute("min"));
  const end = Number(await slider.getAttribute("max"));
  await slider.press("Home");
  assert.equal(Number(await slider.inputValue()), start, "Home must seek to opening");
  await slider.press("ArrowRight");
  assert.equal(Number(await slider.inputValue()), start + 1, "ArrowRight must seek one second");
  await select(page, "Playback speed").selectOption("600");
  await button(page, "Play Saturday").press("Enter");
  await poll("playhead to advance", async () => Number(await slider.inputValue()) > start + 1);
  await button(page, "Pause").press("Enter");
  const stoppedAt = await slider.inputValue();
  await delay(250);
  assert.equal(await slider.inputValue(), stoppedAt, "Pause must stop playhead movement");
  const events = runs[0].playback.timeline;
  function meaningfulFrame(second) {
    const a = timelineCounts(events, second);
    if (!(a.Waiting > 0 && a.Lost > 0 && a["In service"] > 0)) return false;
    if (runs.length === 1) return true;
    const b = timelineCounts(runs[1].playback.timeline, second);
    return a.Waiting !== b.Waiting || a.Lost !== b.Lost || a.Served !== b.Served;
  }
  await slider.press("Home");
  let second = start;
  let jumps = 0;
  while (jumps < 10 && second < end) {
    await slider.press("PageUp");
    const next = Number(await slider.inputValue());
    assert(next > second, "PageUp must advance the playhead");
    second = next;
    jumps += 1;
    if (meaningfulFrame(second)) break;
  }
  assert(meaningfulFrame(second), "Fixture must show queueing, active service and losses, with distinct counts for a paired frame");
  const frames = [];
  for (const [index, label] of labels.entries()) {
    const board = page.getByRole("region", { name: label, exact: true }).filter({
      has: page.locator('dl[aria-label="Counts at the selected time"]'),
    });
    const actual = await boardCounts(board);
    assert.deepEqual(actual, timelineCounts(runs[index].playback.timeline, second), `${label} counts must match the timeline at the shared playhead`);
    frames.push({ label, counts: actual });
  }
  await slider.press("End");
  assert.equal(Number(await slider.inputValue()), end, "End must seek to the last frame");
  await slider.press("Home");
  for (let jump = 0; jump < jumps; jump += 1) await slider.press("PageUp");
  assert.equal(Number(await slider.inputValue()), second, "Keyboard seek must be repeatable");
  return { second, frames, reducedMotion: await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches) };
}

async function visibleDeltas(page, delta) {
  const deltas = exact(page, "B minus A");
  for (const [name, value] of [
    ["Median wait", waitDelta(delta.waitP50Seconds.value)],
    ["Long wait · p90", waitDelta(delta.waitP90Seconds.value)],
    ["Lost per Saturday", signedCount.format(delta.customersLostPerSaturday.value)],
    ["Monthly staff cost", signedCash.format(delta.staffPerMonth.value)],
    ["Monthly cash change", signedCash.format(delta.monthlyCash.value)],
  ]) {
    await deltas.locator("div").filter({ has: page.getByText(name, { exact: true }) })
      .getByText(value, { exact: true }).waitFor();
  }
}

function checkCalendar(side, weekendDemand, served, staffHours) {
  const { costs, assumptions, outcomes } = side.cash;
  const result = outcomes.base;
  assert.equal(assumptions.weekdayDays.value, base.weekdays, "Use the entered weekday calendar");
  assert.equal(assumptions.weekendDays.value, base.weekends, "Use the entered weekend calendar");
  assert.equal(result.weekdayOrdersPerDay.value, base.weekdayBase, "Weekday sales must use the separate weekday input");
  assert(Math.abs(result.weekendOrdersPerDay.value - weekendDemand * served) < 1e-7, "Weekend sales must use its sample completion share");
  const monthlyOrders = base.weekdayBase * base.weekdays + result.weekendOrdersPerDay.value * base.weekends;
  assert(Math.abs(result.monthlyOrders.value - monthlyOrders) < 1e-7, "Monthly orders must use separate weekday and weekend projections");
  assert.equal(costs.weekdayStaff.value, base.wage * base.weekdayStaff * base.weekdayHours * base.weekdays);
  assert.equal(costs.weekendStaff.value, base.wage * staffHours * base.weekends);
  assert.equal(costs.recurring.value, base.rent + side.finance.otherRecurring.value);
  assert.equal(money(result.monthlyCash.value), money(result.monthlyRevenue.value) - money(result.monthlyIngredientCost.value) - money(costs.recurring.value) - money(costs.staff.value));
  assert.equal(money(result.closingCash[0].value), money(base.cash) - money(costs.startup.value));
  assert.equal(money(result.closingCash[1].value), money(result.closingCash[0].value) + money(result.monthlyCash.value));
}

export async function runFounder({ context, page, origin, map, record, section, screenshot, capture }) {
  const { scenarios, service, comparison } = founderActions(page, origin);
  const find = async (id) => (await scenarios()).find((row) => row.id === id);
  const decision = async (a, b, id) => (await comparison(a, b, id)).decision;
  const compare = (target = page) => submitRun(target, "Comparison settings", "compare-scenarios", /^(Compare Saturdays|Rerun comparison)$/);
  const solo = () => submitRun(page, "Run settings", "run-simulation", /^(Run simulation|Rerun simulation)$/);
  const receiptPanel = page.getByRole("article", { name: "Cash runway receipt" });
  const workspace = (a, b) => `${origin}/cafe?scenario=${a}&compare=${b}`;
  const labels = { low: "Low", base: "Base", high: "High" };

  section("S1 sourced map", ["S1", "a1", "demo.1"]);
  await button(page, "Start a scenario").click();
  await page.getByText("Current base demand: 20 customers per hour · Illustrative").waitFor();
  const [original] = await scenarios();
  const id = original.id;
  const anchor = map.anchors.find(({ label }) => label === base.spot);
  await select(page, "Preloaded spots").selectOption({ label: base.spot });
  await button(page, "Save spot").click();
  const pinned = await poll("saved preloaded spot", async () => {
    const row = await find(id);
    return row.spot.label === base.spot && row;
  });
  assert.deepEqual(pinned.spot, { label: anchor.label, lat: anchor.lat, lon: anchor.lon });
  await page.getByText(base.spot, { exact: true }).filter({ visible: true }).last().waitFor();
  const mapRegion = page.getByRole("region", { name: map.name });
  await mapRegion.getByRole("link", { name: "ODbL 1.0" }).waitFor();
  assert.equal(await mapRegion.getByRole("link", { name: map.attribution }).getAttribute("href"), map.attributionUrl);
  assert.equal(await mapRegion.getByRole("link", { name: /^Snapshot / }).getAttribute("href"), map.sourceUrl);
  await mapRegion.getByText(/Coverage is limited to the displayed area/).waitFor();
  await mapRegion.getByText(/No mapped results|extends beyond this snapshot/).first().waitFor();
  const nearby = await mapRegion.locator('ol a[href^="https://www.openstreetmap.org/"]').evaluateAll((links) => links.map((link) => ({
    url: link.getAttribute("href"),
    name: link.querySelector("span:nth-child(2)").childNodes[0].textContent.trim(),
  })));
  assert(nearby.length > 0, "The selected spot must render nearby places");
  for (const { url, name } of nearby) {
    assert(map.places.some((entry) => url.endsWith(`/${entry.osmType}/${entry.osmId}`) && name === entry.name), "Rendered place must match the committed OSM record");
  }
  await screenshot(mapRegion, "sourced-map.png");
  record("founder picked sourced spot", { spot: pinned.spot, nearby, demandUnchanged: pinned.revision === original.revision });

  section("S2 tagged demand and S3 inputs", ["S2", "S3", "a2", "a3", "demo.2"]);
  const demandForm = page.getByRole("form", { name: "Saturday demand", exact: true });
  for (const [key, label] of Object.entries(labels)) {
    const name = `${label} customers per hour`;
    assert.equal(await exact(demandForm, `${name} source`).inputValue(), "illustrative");
    await exact(demandForm, name).fill(String(base.hourly[key]));
    assert.equal(await exact(demandForm, `${name} source`).inputValue(), "estimate");
  }
  await exact(demandForm, "Saturday opens source").selectOption("estimate");
  await exact(demandForm, "Saturday closes").fill(base.hours.closes);
  await button(demandForm, "Save demand").click();
  await demandForm.getByText("Current base demand: 55 customers per hour · Estimate").waitFor();
  const savedDemand = (await find(id)).demand;
  for (const [key, value] of Object.entries(base.hourly)) assert.deepEqual(savedDemand.hourly[key], { value, source: { tag: "estimate" } });
  assert.deepEqual(savedDemand.opensAt, { value: 28800, source: { tag: "estimate" } });
  assert.deepEqual(savedDemand.closesAt, { value: 52200, source: { tag: "estimate" } });

  const shop = page.getByRole("form", { name: "Staff & equipment", exact: true });
  await exact(shop, "Barista 1 ends").fill(base.hours.closes);
  await expand(page, "Menu mix, prices & service times");
  await exact(shop, "Espresso price (₹)").fill("150");
  await exact(shop, "Espresso price (₹) source").selectOption("observed");
  await exact(shop, "Espresso ingredient cost (₹)").fill("30");
  await exact(shop, "Espresso · Order staff seconds").fill("36");
  await exact(shop, "Group heads").fill("2");
  await button(shop, "Save shop").click();
  const configured = await poll("saved shop inputs", async () => {
    const row = await find(id);
    return row.shop.menu[0].tasks[0].staffSeconds.value === 36 && row;
  });
  assert.deepEqual(configured.shop.menu[0].economics.price, { value: 150, source: { tag: "observed" } });
  assert.deepEqual(configured.shop.equipment.groupHead, { value: 2, source: { tag: "estimate" } });
  assert.deepEqual(configured.shop.menu[0].tasks[0].staffSeconds, { value: 36, source: { tag: "estimate" } });
  const finance = page.locator("#cash-ledger").getByRole("form");
  await expand(page, "Money & demand assumptions");
  for (const [name, value] of [
    ["Opening cash (₹)", base.cash], ["Rent per month (₹)", base.rent],
    ["Open weekdays per month", base.weekdays], ["Open weekend days per month", base.weekends],
    ["Base weekday arrivals", base.weekdayBase], ["Weekday staff count", base.weekdayStaff],
    ["Paid hours per weekday worker", base.weekdayHours], ["Wage per staff hour (₹)", base.wage],
  ]) {
    await exact(finance, name).fill(String(value));
    assert.equal(await exact(finance, `${name} source`).inputValue(), "estimate");
  }
  await button(finance, "Save money inputs").click();
  const financed = await poll("saved opening cash and rent", async () => {
    const row = await find(id);
    return row.finance.cash.value === base.cash && row.finance.rent.value === base.rent && row;
  });
  record("founder entered tagged demand, shop and finance", {
    demand: savedDemand, serviceSeconds: configured.shop.menu[0].tasks[0].staffSeconds,
    cash: financed.finance.cash, rent: financed.finance.rent,
  });

  section("S4 seeded Saturday and keyboard playback", ["S4", "a4", "a5", "a10", "demo.3"]);
  await solo();
  const first = await poll("saved solo service run", () => service(id));
  const results = page.getByRole("region", { name: "Service test" });
  await results.getByRole("heading", { name: "Saturday results" }).waitFor();
  assert.equal(first.summary.provenance, "illustrative", "An illustrative service assumption must keep the result illustrative");
  assert.equal(first.summary.stats.bottleneck.resource, "staff", "Shared barista time must be named the bottleneck");
  await results.getByText(first.summary.stats.bottleneck.label, { exact: false }).first().waitFor();
  const totals = exact(results, "Metrics across all simulated Saturdays");
  for (const [name, value] of [
    ["Median wait · p50", `${number.format(first.summary.stats.waitP50Seconds / 60)} min`],
    ["Long wait · p90", `${number.format(first.summary.stats.waitP90Seconds / 60)} min`],
    ["Average orders served", number.format(first.summary.stats.meanOrdersServed)],
    ["Average customers lost", number.format(first.summary.stats.meanCustomersLost)],
  ]) {
    await totals.locator("div").filter({ has: page.getByText(name, { exact: true }) }).getByText(value, { exact: true }).waitFor();
  }
  await expand(page, "Staff & equipment utilization");
  await results.getByText("Barista 1", { exact: false }).last().waitFor();
  const soloFrame = await checkPlayback(page, [first], ["Saturday board"]);
  await solo();
  const repeated = await service(id);
  assert.deepEqual(repeated, first, "Identical seed and scenario must reproduce full playback and metrics");
  record("repeatable service and synchronized solo playback", {
    runId: first.id, arrivals: first.playback.arrivals.length, summary: first.summary, ...soloFrame,
  });
  for (const width of base.widths) {
    await page.setViewportSize({ width, height: 900 });
    await viewportCapture(page, page.getByRole("heading", { name: "Saturday results" }), screenshot, `solo-service-${width}.png`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  section("S6 solo receipt and spot-only change", ["S1", "S2", "S6", "a9", "demo.6"]);
  await button(page, "Compute runway").click();
  const soloReceipt = await poll("saved solo runway", () => decision(id));
  await receiptPanel.getByText("Break-even orders per open day").waitFor();
  await expand(page, "Break-even capture rates");
  await receiptPanel.getByText(/% of 100 passers-by/).first().waitFor();
  const pin = mapRegion.getByRole("button", { name: "Place site pin" });
  await pin.press("ArrowRight");
  await pin.press("Enter");
  const moved = await poll("keyboard moved and saved the map pin", async () => {
    const row = await find(id);
    return row.spotRevision > pinned.spotRevision && row;
  });
  assert.notDeepEqual(moved.spot, pinned.spot, "Keyboard placement must change the pin");
  assert.equal(moved.revision, financed.revision, "Moving the pin must preserve the service input revision");
  assert.deepEqual(moved.demand, savedDemand, "Moving the pin must preserve the demand");
  assert.equal((await service(id, first.id)).stale, false, "Moving the pin must preserve the run");
  assert.equal((await decision(id, undefined, soloReceipt.receipt.id)).cashStale, false, "Moving the pin must preserve the cash receipt");
  record("pin-only edit leaves demand and results fresh", { spot: moved.spot, runId: first.id, receiptId: soloReceipt.receipt.id });

  section("S5 variants and manual 10:00 to 12:00 shift", ["S3", "S5", "a7", "demo.4", "demo.5"]);
  await expand(page, "Create a variant");
  await button(page, "Add barista variant").click();
  const barista = await poll("barista variant", async () => (await scenarios()).find((row) => row.label === "Two baristas"));
  const pairPicker = select(page, "Scenario B");
  await poll("barista selected as B", async () => await pairPicker.inputValue() === barista.id);
  await compare();
  const beforeShift = await poll("original versus barista receipt", () => decision(id, barista.id));
  await expand(page, "Edit B · Two baristas");
  const shopB = page.getByRole("form", { name: "B · Two baristas staff & equipment" });
  await exact(shopB, "Barista 2 starts").fill(base.shift.starts);
  await exact(shopB, "Barista 2 ends").fill(base.shift.ends);
  await button(shopB, "Save shop").click();
  const afterShift = await poll("fresh comparison after the manual shift save", async () => {
    const result = await decision(id, barista.id);
    return result && !result.serviceStale && result.receipt.id !== beforeShift.receipt.id && result;
  });
  const shifted = await find(barista.id);
  const shift = shifted.shop.workers[1].shifts[0];
  assert.deepEqual(shift, {
    startsAt: { value: 36000, source: { tag: "estimate" } },
    endsAt: { value: 43200, source: { tag: "estimate" } },
  }, "Founder shift must save as 10:00 to 12:00");
  assert.equal(afterShift.receipt.b.service.scenarioRevision, shifted.revision);
  assert.equal(afterShift.receipt.delta.staffPerMonth.value, 2 * base.wage * base.weekends);
  assert.notEqual(afterShift.receipt.delta.waitP50Seconds.value, beforeShift.receipt.delta.waitP50Seconds.value);
  assert.notEqual(afterShift.receipt.delta.monthlyCash.value, beforeShift.receipt.delta.monthlyCash.value);
  await visibleDeltas(page, afterShift.receipt.delta);
  assert.equal((await decision(id, barista.id, beforeShift.receipt.id)).serviceStale, true, "The old shift receipt must become stale");

  await expand(page, "Create a variant");
  await page.getByLabel(/Extra grinder price \(₹\)/).fill(String(base.extraGrinder));
  await button(page, "Add grinder variant").click();
  const grinder = await poll("grinder variant", async () => (await scenarios()).find((row) => row.label === "Extra grinder"));
  await poll("grinder selected as B", async () => await pairPicker.inputValue() === grinder.id);
  await compare();
  const versusGrinder = await poll("original versus grinder receipt", () => decision(id, grinder.id));
  assert.deepEqual((await find(id)).shop, configured.shop, "The original shop must stay unchanged");
  assert.equal(versusGrinder.receipt.b.cash.costs.startup.value - versusGrinder.receipt.a.cash.costs.startup.value, base.extraGrinder);
  record("manual shift auto-reruns and shows deltas", {
    baselineId: id, baristaId: barista.id, grinderId: grinder.id, shift,
    oldReceipt: beforeShift.receipt.id, newReceipt: afterShift.receipt.id, delta: afterShift.receipt.delta,
  });

  section("S5 matched arrival records and paired playback", ["S4", "S5", "a4", "b6", "demo.4"]);
  await select(page, "Scenario").selectOption(barista.id);
  await page.waitForURL((url) => url.origin === origin && url.pathname === "/cafe" && url.searchParams.get("scenario") === barista.id);
  await results.getByText("A · Two baristas", { exact: true }).waitFor();
  await pairPicker.selectOption(grinder.id);
  await page.waitForURL(workspace(barista.id, grinder.id));
  const shared = page.getByRole("form", { name: "Shared Saturday demand" });
  await shared.getByText(/Both shops use demand from/).waitFor();
  assert.match(await shared.innerText(), /One barista/);
  assert.equal((await comparison(barista.id, grinder.id)).arrivalSource.id, id, "Sibling pair must use the original as its demand source");
  await compare();
  const direct = await poll("sibling comparison receipt", () => decision(barista.id, grinder.id));
  const { a, b, weekend } = direct.receipt;
  const [runA, runB] = await Promise.all([service(barista.id, a.service.id), service(grinder.id, b.service.id)]);
  assert(runA.playback.arrivals.length > 0, "Paired fixture must have actual arrivals");
  assert.deepEqual(runA.playback.arrivals, runB.playback.arrivals, "Both runs must store identical ordered arrival IDs, times and drinks");
  assert.equal(runA.playback.arrivals.length, weekend.base.arrivals);
  capture("matched-arrivals.json", { receiptId: direct.receipt.id, runs: [runA, runB].map(({ id, playback }) => ({ id, arrivals: playback.arrivals })) });
  const pairedFrame = await checkPlayback(page, [runA, runB], ["A · Two baristas", "B · Extra grinder"]);
  assert.equal(pairedFrame.reducedMotion, true);
  const applicationState = await verifyPublishedPlayback(page, origin, direct.receipt.id, runA, runB, pairedFrame.second);
  record("matched run records and shared keyboard playhead", {
    receiptId: direct.receipt.id, runIds: [runA.id, runB.id], arrivals: weekend.base.arrivals, ...pairedFrame, applicationState,
  });

  section("S6 saved-customers switch and calendar", ["S5", "S6", "a8", "a9", "demo.6"]);
  assert.equal(direct.receipt.savedCustomers.enabled, false);
  assert.equal(direct.receipt.cashBaseline.id, id);
  const share = (lost) => (weekend.base.arrivals - Math.max(lost, weekend.base.lostBaseline)) / weekend.base.arrivals;
  checkCalendar(a, direct.receipt.weekendDemand.base.value, share(weekend.base.lostA), 8.5);
  checkCalendar(b, direct.receipt.weekendDemand.base.value, share(weekend.base.lostB), 6.5);
  assert.equal(a.cash.outcomes.base.recoveredOrdersPerMonth.value, 0, "Switch off must exclude recovered orders");
  await page.getByRole("heading", { name: "Assumption that can change the decision" }).waitFor();
  const assumption = exact(page, "Count weekend customers who would have left but now place an order");
  await assumption.click();
  const on = await poll("cash receipt with saved customers on", async () => {
    const next = await decision(barista.id, grinder.id);
    return next?.receipt.savedCustomers.enabled && next;
  });
  await poll("saved-customers switch visibly on", () => assumption.isChecked());
  const off = await decision(barista.id, grinder.id, direct.receipt.id);
  assert.equal(off.historical, true);
  assert.equal(off.assumptionStale, true);
  assert.equal(off.serviceStale, false, "Switch change must preserve service freshness");
  assert.deepEqual([on.receipt.a.service.id, on.receipt.b.service.id], [runA.id, runB.id], "Cash switch must reuse the same service runs");
  assert(on.receipt.a.cash.outcomes.base.recoveredOrdersPerMonth.value > 0, "Switch on must count recovered customers in the faster fixture");
  assert(on.receipt.a.cash.outcomes.base.monthlyRevenue.value > a.cash.outcomes.base.monthlyRevenue.value, "Faster service revenue must increase only after enabling the assumption");
  assert.equal(on.receipt.a.cash.outcomes.base.weekdayOrdersPerDay.value, a.cash.outcomes.base.weekdayOrdersPerDay.value);
  assert.notEqual(on.receipt.delta.higherMonthlyCash.on, on.receipt.delta.higherMonthlyCash.off, "Fixture must reverse the higher-monthly-cash option");
  await visibleDeltas(page, on.receipt.delta);
  const ledgerValue = receiptPanel.getByRole("row", { name: /Monthly cash change/ })
    .getByRole("cell").filter({ hasText: ledgerCash.format(on.receipt.a.cash.outcomes.base.monthlyCash.value) });
  await ledgerValue.waitFor();
  for (const name of [
    "Break-even orders per open day", "Startup costs", "Recurring costs excluding staff",
    "Weekday wages per month", "Weekend wages per month", "Weekday arrivals per open day", "Weekend arrivals per open day",
  ]) await receiptPanel.getByRole("row", { name: new RegExp(name) }).waitFor();
  assert.equal(on.receipt.a.cash.outcomes.base.monthlyCash.tag, "illustrative", "Weakest input must propagate into cash");
  record("calendar and reversing assumption", {
    offReceipt: direct.receipt.id, onReceipt: on.receipt.id,
    weekdayOrders: a.cash.outcomes.base.weekdayOrdersPerDay, weekendOrders: a.cash.outcomes.base.weekendOrdersPerDay,
    costs: a.cash.costs, breakEven: a.cash.breakEvenOrdersPerDay, delta: on.receipt.delta,
  });

  section("S2 shared source edit and stale results", ["S2", "S4", "S5", "S6", "b10"]);
  const second = await context.newPage();
  await second.goto(workspace(grinder.id, barista.id), { waitUntil: "domcontentloaded", timeout: 60_000 });
  const reverseDemand = second.getByRole("form", { name: "Shared Saturday demand" });
  await reverseDemand.getByText(/Both shops use demand from/).waitFor();
  assert.equal((await comparison(grinder.id, barista.id)).arrivalSource.id, id);
  await exact(reverseDemand, "Use a Saturday pedestrian count").check();
  await exact(reverseDemand, "People counted on Saturday").fill(String(base.pedestrian.count));
  await exact(reverseDemand, "Expected conversion (%)").fill(String(base.pedestrian.conversionPercent));
  await exact(reverseDemand, "Expected conversion (%) source").selectOption("estimate");
  await button(reverseDemand, "Save demand").click();
  await reverseDemand.getByText("Expected Saturday arrivals · 60 · Estimate").waitFor();
  const edited = await find(id);
  assert.deepEqual(edited.demand.pedestrian, {
    count: { value: base.pedestrian.count, source: { tag: "observed" } },
    conversionPercent: { value: base.pedestrian.conversionPercent, source: { tag: "estimate" } },
  });
  assert.equal((await find(barista.id)).demand.pedestrian, null);
  assert.equal((await find(grinder.id)).demand.pedestrian, null);
  await page.getByText("Stale service result.").waitFor();
  await receiptPanel.getByText("Stale cash receipt.").waitFor();
  assert.equal((await service(barista.id, runA.id)).stale, true);
  assert.equal((await service(grinder.id, runB.id)).stale, true);
  await screenshot(results, "stale-comparison.png");
  await compare();
  const current = await poll("fresh rerun using 600 pedestrians at 10 percent", async () => {
    const result = await decision(barista.id, grinder.id);
    return !result?.serviceStale && result?.receipt.pedestrian?.count.value === base.pedestrian.count && result;
  });
  assert.equal(current.receipt.weekendDemand.base.value, 60);
  assert.equal(current.receipt.a.cash.outcomes.base.weekdayOrdersPerDay.value, base.weekdayBase);
  assert.equal(current.receipt.savedCustomers.enabled, true);
  await expand(page, "Break-even capture rates");
  await receiptPanel.getByText(/600 counted Saturday passers-by/).first().waitFor();
  await expand(page, "Exact monthly balances");
  await receiptPanel.getByRole("img", { name: /case closing cash projection/ }).first().waitFor();
  record("sibling demand edit invalidates both runs and refreshes the receipt", {
    sourceId: id, revision: edited.revision, pedestrian: edited.demand.pedestrian,
    priorReceipt: on.receipt.id, currentReceipt: current.receipt.id,
  });
  await second.close();

  section("responsive founder captures", ["design"]);
  for (const width of base.widths) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    assert.equal(dimensions.document, dimensions.viewport, `No document overflow at ${width} px`);
    for (const [name, selector] of [
      ["cover", "#opening-file"],
      ["site-demand", "#site-demand"],
      ["service", "#service-test .cafe-paired-heading"],
      ["cash", "#cash-ledger .cafe-receipt"],
      ["cash-chart", "#cash-ledger .cafe-cash-chart"],
    ]) await viewportCapture(page, page.locator(selector), screenshot, `${name}-${width}.png`);
    record("founder viewport", dimensions);
  }
  return {
    originalId: id, baristaId: barista.id, grinderId: grinder.id, shift, sourceRevision: edited.revision,
    oldShiftReceiptId: beforeShift.receipt.id, staleReceiptId: on.receipt.id, staleRunId: runA.id,
    currentReceiptId: current.receipt.id,
    currentRunIds: [current.receipt.a.service.id, current.receipt.b.service.id],
  };
}

export async function verifyFounderRestart({ context, page, origin, expected, record, section, screenshot }) {
  const { scenarios, service, comparison } = founderActions(page, origin);
  const { originalId, baristaId, grinderId } = expected;
  await page.goto(`${origin}/cafe?scenario=${baristaId}&compare=${grinderId}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Matched Saturday results" }).waitFor();
  await page.getByRole("article", { name: "Cash runway receipt" }).waitFor();
  const rows = await scenarios();
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.id === originalId).revision, expected.sourceRevision);
  assert.deepEqual(rows.find((row) => row.id === baristaId).shop.workers[1].shifts[0], expected.shift);
  const { decision } = await comparison(baristaId, grinderId);
  assert.equal(decision.receipt.id, expected.currentReceiptId);
  assert.equal(decision.receipt.pedestrian.count.value, base.pedestrian.count);
  assert.equal(decision.receipt.savedCustomers.enabled, true);
  assert.equal(decision.serviceStale, false);
  assert.equal(decision.cashStale, false);
  assert.equal((await comparison(baristaId, grinderId, expected.staleReceiptId)).decision.serviceStale, true);
  assert.equal((await comparison(originalId, baristaId, expected.oldShiftReceiptId)).decision.serviceStale, true);
  assert.equal((await service(baristaId, expected.staleRunId)).stale, true);
  await screenshot(page.locator("#cash-ledger"), "restarted-cash.png");
  record("same scenarios, old stale runs and current receipt after restart", expected);

  section("framework navigation command receiver", ["b6"]);
  const state = await tabState(page, origin);
  const destination = `/cafe?scenario=${originalId}#site-demand`;
  await state.sendNavigationCommand(destination);
  await page.waitForURL(origin + destination);
  await poll("consumed navigation command and updated view", async () => {
    const { navigation, navigate } = await state.read("navigation", "navigate");
    return !navigate && navigation?.view === "cafe" && navigation.scenarioId === originalId && !navigation.comparisonScenarioId;
  });
  record("open tab follows and clears a framework navigation command", { destination, liveNavigateAction: "NOT VERIFIED" });

  section("isolated chat precondition", []);
  const chat = await context.newPage();
  await chat.goto(`${origin}/chat`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const editor = chat.locator('[data-agent-composer-slot="editor-input"]');
  await editor.waitFor({ state: "visible" });
  const composerEditable = await editor.isEditable();
  await chat.close();
  record("chat composer availability only", { composerEditable });
  return { composerEditable };
}
