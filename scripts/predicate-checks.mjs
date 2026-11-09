import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

export const fullChecks = {
  a5: ['seeded-replay', 'ae19c330f05c51b5c18f12190f4609cc2ceaca4aeb46a8e121f4a3ba02b32fee'],
  'S4.doneWhen.1': ['seeded-replay', '2519caac9f8fb49e136a89da0bdc980b25c8c4e8453ec2eb818dc09b3ec70a5a'],
};

export const partialChecks = {
  a1: ['spot-action'],
  a3: ['cash-provenance'],
  a4: ['series-metrics', 'shared-barista'],
  a8: ['saved-customers'],
  a9: ['cash-calendar'],
  a10: ['shared-barista'],
  b4: ['framework-doctor'],
  'S1.stale': ['spot-action'],
  'action.setSpot': ['spot-action'],
  'S4.produces.3': ['series-metrics'],
  'S4.produces.4': ['series-metrics'],
  'S4.produces.5': ['shared-barista'],
  'S4.doneWhen.3': ['shared-barista'],
  'S5.doneWhen.1': ['seeded-replay'],
  'S6.doneWhen.1': ['cash-calendar'],
  'S6.doneWhen.2': ['cash-calendar'],
  'S6.doneWhen.3': ['saved-customers'],
  'action.computeRunway': ['cash-calendar', 'saved-customers'],
};

const namedTests = [
  ['seeded-replay', 'Same seed reproduces arrival records and the entire 100-run simulation result', [
    ['arrivals', 'createArrivalPlan replays the same complete arrivals for 100 runs and changes them for another seed'],
    ['simulation', 'simulateSeries reuses complete arrivals across variants and reproduces the entire 100-run result'],
  ]],
  ['shared-barista', 'Simulation engine identifies the shared worker resource as the bottleneck in the contention fixture', [
    ['simulation', 'simulateSaturday uses the same staff pool for grinding and hand-off, and names that pool as the bottleneck'],
  ]],
  ['series-metrics', 'Simulation engine returns pooled wait metrics, counts, worker utilization, and first-run playback', [
    ['simulation', 'simulateSeries pools waits across runs, averages counts, and returns the first actual run for playback'],
  ]],
  ['spot-action', 'The action returns attributed OSM places and a pin-only edit preserves demand and the saved simulation', [
    ['set-spot', 'moves only the site pin and returns attributed places without staling a saved run'],
  ]],
  ['cash-calendar', 'Cash engine separates weekday and weekend assumptions and charges startup once', [
    ['cash', 'cash ledger uses distinct weekday and weekend demand, staffing and losses, and pays startup once'],
  ]],
  ['saved-customers', 'Cash engine gates recovered revenue and names the saved-customers assumption', [
    ['cash', 'cash ledger only adds revenue when the switch is on and comparable simulation losses fell'],
  ]],
  ['cash-provenance', 'Cash engine uses the weakest actual dependency for derived values', [
    ['cash', "provenance propagates the weakest actual dependency and doesn't drag demand into break-even"],
  ]],
];

export function runChecks(root) {
  const app = join(root, 'cafe-app');
  const scratch = mkdtempSync(join(tmpdir(), 'cafe-predicate-'));
  const reportPath = join(scratch, 'vitest.json');
  const results = new Map();
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => /^(PATH|HOME|USER|LOGNAME|TMPDIR|SHELL|LANG|TERM|LC_.+)$/.test(key)));
  env.DATABASE_URL = 'pglite:memory';
  const pnpm = (args) => spawnSync('pnpm', ['exec', ...args], {
    cwd: app, env, encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024,
  });
  const status = (result) => result.error?.code ?? result.signal ?? result.status;
  const record = (id, ok, detail) => results.set(id, { ok, detail });

  try {
    for (const name of ['check-structure', 'check-no-mock']) {
      const check = spawnSync(join(root, 'scripts', name), [], {
        cwd: root, env, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      });
      record(name, status(check) === 0, (check.stdout + check.stderr).trim() || `Exit ${status(check)}.`);
    }
    const suite = pnpm(['vitest', 'run', '--reporter=json', '--outputFile', reportPath]);
    let report;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch {
      console.error(`Vitest did not write a valid test report (exit ${status(suite)}).`);
    }
    const files = Array.isArray(report?.testResults) ? report.testResults : [];
    const assertions = new Map();
    const failed = [];
    for (const file of files) {
      if (typeof file?.name !== 'string' || !Array.isArray(file.assertionResults)) continue;
      for (const test of file.assertionResults) {
        if (typeof test?.fullName !== 'string') continue;
        const label = `${relative(app, file.name)}: ${test.fullName}`;
        assertions.set(label, assertions.has(label) ? 'duplicate' : test.status);
        if (test.status === 'failed') failed.push(label);
      }
    }
    const passedCount = [...assertions.values()].filter((value) => value === 'passed').length;
    const suitePassed = status(suite) === 0 && report?.success === true && passedCount > 0 && failed.length === 0;
    record('engine-tests', suitePassed, suitePassed
      ? `Vitest passed ${passedCount} tests.`
      : `Vitest exit ${status(suite)}. ${failed.join(' | ') || 'No successful suite report.'}`);
    for (const [id, detail, tests] of namedTests) {
      const missing = tests.filter(([file, name]) => assertions.get(`server/lib/cafe/${file}.test.ts: ${name}`) !== 'passed');
      record(id, missing.length === 0, missing.length
        ? `Failed, skipped, duplicate or absent test: ${missing.map(([, name]) => name).join(' | ')}`
        : detail);
    }

    const typecheck = pnpm(['agent-native', 'typecheck']);
    record('typecheck', status(typecheck) === 0, `Agent-Native typecheck exit ${status(typecheck)}.`);
    if (status(typecheck) !== 0) console.error((typecheck.stdout + typecheck.stderr).trim());

    const doctor = pnpm(['agent-native', 'doctor', '--json']);
    let diagnosis;
    try {
      diagnosis = JSON.parse(doctor.stdout);
    } catch {
      console.error('Framework doctor did not return valid JSON.');
    }
    const guards = diagnosis?.guardsRun;
    const findings = Array.isArray(diagnosis?.findings) ? diagnosis.findings : null;
    const clean = status(doctor) === 0 && diagnosis?.ok === true && Array.isArray(guards) && guards.length > 0 && findings?.length === 0;
    record('framework-doctor', clean, clean
      ? `Agent-Native ran ${guards.length} source guards.`
      : `Agent-Native doctor exit ${status(doctor)}. ${findings?.map(({ guard, file }) => `${guard} ${file}`).join(' | ') ?? ''}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  return results;
}
