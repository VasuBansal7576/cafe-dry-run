import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const htmlText = (s) => s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

try {
  const html = read('cafe-dry-run-statechart.html');
  const specMatch = html.match(/<script\s+type="application\/json"\s+id="spec">([\s\S]*?)<\/script>/);
  if (!specMatch) throw new Error('Missing source specification JSON');
  const spec = JSON.parse(specMatch[1]);
  const rows = [];
  const add = (id, text) => {
    if (typeof text !== 'string' || !text.trim()) throw new Error(`Missing text for ${id}`);
    rows.push({ id, text: text.trim() });
  };

  const required = spec.dod.filter((group) => group.level === 'must').flatMap((group) => group.items).filter(({ id }) => /^[ab]\d+$/.test(id));
  const expected = ['a', 'b'].flatMap((prefix) => Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`));
  if (required.length !== expected.length || expected.some((id) => required.filter((item) => item.id === id).length !== 1)) throw new Error('Expected each of a1 through a10 and b1 through b10 exactly once');
  required.forEach(({ id, text }) => add(id, text));

  if (spec.states.length !== 6 || new Set(spec.states.map((s) => s.id)).size !== 6) throw new Error('Expected six distinct states');
  for (const state of spec.states) {
    for (const field of ['human', 'agent', 'produces', 'doneWhen']) {
      if (!Array.isArray(state[field]) || !state[field].length) throw new Error(`Missing ${state.id} ${field}`);
      state[field].forEach((text, index) => add(`${state.id}.${field}.${index + 1}`, text));
    }
    add(`${state.id}.stale`, state.stale);
  }
  if (!Array.isArray(spec.transitions) || spec.transitions.length !== 7) throw new Error('Expected seven transitions');
  spec.transitions.forEach((t, i) => add(`transition.${i + 1}`, `${t.from} to ${t.to}: ${t.trigger}; ${t.actor}`));
  if (!Array.isArray(spec.actions) || spec.actions.length !== 9 || new Set(spec.actions.map((a) => a.name)).size !== 9) throw new Error('Expected nine distinct actions');
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

  for (const row of rows) console.log(`NOT VERIFIED ${row.id} ${row.text}`);
  console.log('HUMAN OWNED Group C: submission, public Clips, eligibility and consent.');
  console.log('OPTIONAL Group D: excluded from the app acceptance gate.');
  console.log(`FAIL: ${rows.length} required checks have no implemented verifier or current evidence.`);
  process.exitCode = 1;
} catch (error) {
  console.error(`FAIL: acceptance source could not be enumerated: ${error.message}`);
  process.exitCode = 1;
}
