import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const inputPaths = [
  'cafe-app',
  'cafe-dry-run-statechart.html',
  'DESIGN.md',
  'design-reference',
  'AGENTS.md',
  '.gitignore',
  'scripts',
  '.agents/skills/verify-cafe-dry-run',
];
const shaPattern = /^[a-f0-9]{64}$/;
const gitId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const hasText = (text) => typeof text === 'string' && text.trim().length > 0;
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitInputs(root, commit) {
  if (!gitId.test(commit) || git(root, 'rev-parse', '--verify', `${commit}^{commit}`) !== commit) {
    throw new Error('Evidence must identify a commit available in this repository.');
  }
  return Object.fromEntries(inputPaths.map((path) => [
    path, git(root, 'rev-parse', '--verify', `${commit}:${path}`),
  ]));
}

export function candidateIdentity(root) {
  const commit = git(root, 'rev-parse', '--verify', 'HEAD');
  const dirty = git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none', '--', ...inputPaths);
  if (dirty) throw new Error('Commit changed app or verification inputs before using judgment evidence.');
  return { commit, inputs: gitInputs(root, commit) };
}

function checkArtifact(artifact, directory) {
  if (!isRecord(artifact) || !hasText(artifact.path) || isAbsolute(artifact.path) || !shaPattern.test(artifact.sha256)) {
    throw new Error('Artifact needs a relative path and SHA-256.');
  }
  const path = resolve(directory, artifact.path);
  const inside = relative(directory, path);
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside) || realpathSync(path) !== path) {
    throw new Error('Artifact must be a file within .artifacts without symlinks.');
  }
  const stats = statSync(path);
  if (!stats.isFile() || stats.size === 0) throw new Error('Artifact is empty or is not a file.');
  if (sha256(readFileSync(path)) !== artifact.sha256) throw new Error('Artifact SHA-256 changed.');
}

export function readEvidence(root, candidate, rowIds) {
  const directory = join(root, '.artifacts');
  const index = join(directory, 'predicate-evidence.json');
  let receipt;
  try {
    const stats = lstatSync(index);
    if (!stats.isFile() || realpathSync(index) !== join(realpathSync(root), '.artifacts', 'predicate-evidence.json')) {
      throw new Error('Evidence index must be a regular file in .artifacts without symlinks.');
    }
    receipt = JSON.parse(readFileSync(index, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }

  if (receipt?.version !== 1 || !isRecord(receipt.inputs) || !isRecord(receipt.requirements)
      || typeof receipt.testedCommit !== 'string' || !hasText(receipt.reviewer)) {
    throw new Error('Invalid judgment index. Expected version, testedCommit, inputs, reviewer and requirements.');
  }
  const recordedInputs = gitInputs(root, receipt.testedCommit);
  if (Object.keys(receipt.inputs).length !== inputPaths.length || inputPaths.some((path) => (
    receipt.inputs[path] !== recordedInputs[path] || recordedInputs[path] !== candidate.inputs[path]
  ))) {
    throw new Error('Judgment evidence is stale or identifies different inputs than its tested commit.');
  }

  const results = new Map();
  const realDirectory = realpathSync(directory);
  for (const [id, evidence] of Object.entries(receipt.requirements)) {
    if (!rowIds.has(id)) throw new Error(`Judgment evidence refers to unknown requirement ${id}.`);
    try {
      if (!isRecord(evidence) || !['VERIFIED', 'NOT VERIFIED', 'INCONCLUSIVE'].includes(evidence.status)
          || !hasText(evidence.command) || !hasText(evidence.inputs) || !hasText(evidence.observed)
          || !Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) {
        throw new Error('Record status, command or journey, test inputs, observed result and at least one artifact.');
      }
      for (const artifact of evidence.artifacts) checkArtifact(artifact, realDirectory);
      results.set(id, {
        status: evidence.status,
        detail: `Judgment by ${receipt.reviewer} at ${receipt.testedCommit.slice(0, 12)}. ${evidence.observed} [${evidence.artifacts.map(({ path }) => path).join(', ')}]`,
      });
    } catch (error) {
      results.set(id, { status: 'NOT VERIFIED', detail: `Invalid judgment evidence. ${error.message}` });
    }
  }
  return results;
}
