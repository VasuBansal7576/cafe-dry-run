import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fullChecks, partialChecks, runChecks } from './predicate-checks.mjs';
import { candidateIdentity, readEvidence, sha256 } from './predicate-evidence.mjs';

const root = resolve(process.argv[2] || '.');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const htmlText = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function readRows() {
  const html = read('cafe-dry-run-statechart.html');
  const specMatch = html.match(/<script\s+type="application\/json"\s+id="spec">([\s\S]*?)<\/script>/);
  if (!specMatch) throw new Error('Missing source specification JSON');
  const spec = JSON.parse(specMatch[1]);
  const rows = [];
  const add = (id, text, group = 'required') => {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`Missing text for ${id}`);
    if (rows.some((row) => row.id === id)) throw new Error(`Duplicate requirement ID ${id}`);
    rows.push({ id, text: text.trim(), group });
  };

  for (const { group, level, items } of spec.dod) {
    const ownership = group.startsWith('C.') ? 'human' : level === 'must' ? 'required' : 'optional';
    for (const { id, text } of items) add(id, text, ownership);
  }
  const expected = ['a', 'b'].flatMap((prefix) => Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`));
  if (expected.some((id) => !rows.some((row) => row.id === id && row.group === 'required'))) {
    throw new Error('Expected each of a1 through a10 and b1 through b10 in the required gate');
  }

  if (Array.from({ length: 6 }, (_, i) => `S${i + 1}`).some((id) => !spec.states.some((state) => state.id === id))) {
    throw new Error('Expected each of S1 through S6');
  }
  for (const state of spec.states) {
    for (const field of ['human', 'agent', 'produces', 'doneWhen']) {
      if (!Array.isArray(state[field]) || !state[field].length) throw new Error(`Missing ${state.id} ${field}`);
      state[field].forEach((text, index) => add(`${state.id}.${field}.${index + 1}`, text));
    }
    add(`${state.id}.stale`, state.stale);
  }
  if (!Array.isArray(spec.transitions) || spec.transitions.length < 7) throw new Error('Expected at least seven transitions');
  spec.transitions.forEach((t, i) => {
    if (![t.from, t.to, t.trigger, t.actor].every((part) => typeof part === 'string' && part.trim())) {
      throw new Error(`Missing transition details for transition.${i + 1}`);
    }
    add(`transition.${i + 1}`, `${t.from} to ${t.to} | ${t.trigger} | ${t.actor}`);
  });
  if (!Array.isArray(spec.actions) || spec.actions.length < 9) throw new Error('Expected at least nine actions');
  if (spec.actions.some((action) => !action.name || !action.does || !action.state)) throw new Error('Missing action details');
  spec.actions.forEach((a) => add(`action.${a.name}`, `${a.does} (${a.state})`));

  const demo = html.match(/<h3[^>]*>Demo script for the public Clips recording<\/h3>\s*<ol[^>]*>([\s\S]*?)<\/ol>/);
  if (!demo) throw new Error('Missing six-step demo');
  const steps = [...demo[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => htmlText(m[1]));
  if (steps.length !== 6) throw new Error('Expected six demo steps');
  steps.forEach((text, index) => add(`demo.${index + 1}`, text));

  const design = read('DESIGN.md');
  const designLines = design.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !/^\|\s*[-:]+/.test(line));
  if (!designLines.length) throw new Error('Missing design requirements');
  designLines.forEach((text, index) => add(`design.${index + 1}`, text));
  for (const [id, text] of [
    ['framework.shared-actions', 'Real Agent-Native scaffold, shared UI and agent actions and live sync'],
    ['persistence.restart', 'Scenario, run and stale flags persist across restart'],
    ['startup.clean-clone', 'Clean clone starts using the documented command and an empty runtime data directory'],
    ['presentation.viewports', 'Inspect all five reference states at 1440 px and 390 px'],
    ['presentation.accessibility', 'Check accessible controls and reduced motion'],
  ]) add(id, text);

  return rows;
}

let identityAtStart;
let identityFailure;
try {
  identityAtStart = candidateIdentity(root);
} catch (error) {
  identityFailure = error.message;
}

try {
  const checks = runChecks(root);
  let failed = 0;
  for (const [id, check] of checks) {
    if (!check.ok) failed++;
    console.log(`CHECK ${check.ok ? 'VERIFIED' : 'NOT VERIFIED'} ${id} | ${check.detail}`);
  }

  const rows = readRows();
  const requiredIds = new Set(rows.filter(({ group }) => group === 'required').map(({ id }) => id));
  for (const id of [...Object.keys(fullChecks), ...Object.keys(partialChecks)]) {
    if (requiredIds.has(id)) continue;
    console.error(`NOT VERIFIED acceptance.mapping | Required source row ${id} is missing.`);
    failed++;
  }

  let evidence = new Map();
  try {
    if (identityFailure) throw new Error(identityFailure);
    const candidate = candidateIdentity(root);
    if (JSON.stringify(candidate) !== JSON.stringify(identityAtStart)) throw new Error('Candidate changed while checks were running.');
    console.log(`CANDIDATE ${JSON.stringify(candidate)}`);
    evidence = readEvidence(root, candidate, requiredIds);
  } catch (error) {
    console.error(`NOT VERIFIED acceptance.evidence | ${error.message}`);
    failed++;
  }

  let open = 0;
  for (const { id, text, group } of rows) {
    if (group !== 'required') {
      console.log(`${group === 'human' ? 'HUMAN OWNED' : 'OPTIONAL'} ${id} ${text}`);
      continue;
    }

    const judgment = evidence.get(id);
    let result = judgment ?? { status: 'NOT VERIFIED', detail: 'No full check mapped and no current judgment evidence.' };
    const full = Object.hasOwn(fullChecks, id) ? fullChecks[id] : null;
    if (full) {
      const [checkId, textHash] = full;
      const check = checks.get(checkId);
      if (sha256(text) !== textHash) {
        result = { status: 'NOT VERIFIED', detail: 'Source wording changed. Review the executable mapping.' };
      } else if (!check?.ok || !judgment || judgment.status === 'VERIFIED') {
        result = {
          status: check?.ok ? 'VERIFIED' : 'NOT VERIFIED',
          detail: `Executable check ${checkId}. ${check?.detail ?? 'Missing check.'}`,
        };
      }
    }
    const partial = Object.hasOwn(partialChecks, id) ? partialChecks[id] : [];
    if (partial.some((checkId) => !checks.get(checkId)?.ok)) {
      result = { status: 'NOT VERIFIED', detail: 'A mapped partial check failed or is missing.' };
    }
    if (result.status !== 'VERIFIED') open++;
    const support = partial.filter((checkId) => checks.get(checkId)?.ok).join(', ');
    console.log(`${result.status} ${id} ${text} | ${result.detail}${support ? ` Partial checks passed: ${support}.` : ''}`);
  }
  console.log(open || failed
    ? `FAIL | ${open} required rows remain open and ${failed} checks or evidence gates failed.`
    : `PASS | All ${requiredIds.size} required rows and executable checks verified.`);
  if (open || failed) process.exitCode = 1;
} catch (error) {
  console.error(`FAIL | Acceptance predicate could not run. ${error.message}`);
  process.exitCode = 1;
}
