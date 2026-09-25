import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const requiredChecks = [
  'Verify',
  'Durable workspace (macos-latest)',
  'Durable workspace (windows-latest)',
  'Analyze JavaScript/TypeScript',
];

export const GITHUB_ACTIONS_APP_ID = 15368;

export function parseStableVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  return match ? match.slice(1).map(BigInt) : null;
}

export function compareStableVersions(left, right) {
  const a = parseStableVersion(left);
  const b = parseStableVersion(right);
  if (!a || !b) throw new Error(`Invalid stable version: ${!a ? left : right}`);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function candidateTag(basePackage, packageJson, lockfile) {
  if (basePackage.version === packageJson.version) return null;
  const version = packageJson.version;
  if (!parseStableVersion(version)) throw new Error(`Invalid stable version: ${version}`);
  if (lockfile.version !== version) throw new Error('Lockfile version does not match package version');
  if (lockfile.packages?.['']?.version !== version) throw new Error('Root lockfile version does not match package version');
  if (compareStableVersions(version, basePackage.version) <= 0) {
    throw new Error(`Version ${version} is not newer than base version ${basePackage.version}`);
  }
  return { version, tag: `v${version}` };
}

function run(command, args) {
  // ponytail: cap CLI output at 16 MiB; narrow API responses if release history outgrows it.
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trim();
}

function ghApi(endpoint, paginate = false) {
  const args = ['api'];
  if (paginate) args.push('--paginate', '--slurp');
  args.push(endpoint);
  const result = JSON.parse(run('gh', args));
  return paginate ? result.flat() : result;
}

function validatePublicationState(repo, tag, version) {
  const releases = ghApi(`${repo}/releases?per_page=100`, true);
  if (releases.some((release) => release.tag_name === tag)) throw new Error(`Release already exists: ${tag}`);
  for (const release of releases) {
    if (release.draft || release.prerelease || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name ?? '')) continue;
    if (compareStableVersions(version, release.tag_name.slice(1)) <= 0) {
      throw new Error(`Version ${version} is not newer than ${release.tag_name.slice(1)}`);
    }
  }
  const refs = ghApi(`${repo}/git/matching-refs/tags/${tag}`);
  if (refs.some((ref) => ref.ref === `refs/tags/${tag}`)) throw new Error(`Tag already exists: ${tag}`);
}

export function selectRequiredChecks(runs) {
  const latest = new Map();
  for (const check of runs) {
    if (Number(check.app?.id) !== GITHUB_ACTIONS_APP_ID) continue;
    if (!latest.has(check.name) || Number(check.id) > Number(latest.get(check.name).id)) latest.set(check.name, check);
  }
  return requiredChecks.map((name) => latest.get(name));
}

function waitForRequiredChecks(repo, sha) {
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const runs = ghApi(`${repo}/commits/${sha}/check-runs?per_page=100`, true)
      .flatMap((page) => page.check_runs ?? page);
    const selected = selectRequiredChecks(runs);
    const failed = selected.find((check) => check?.status === 'completed' && check.conclusion !== 'success');
    if (failed) throw new Error(`Required check failed: ${failed.name} (${failed.conclusion})`);
    if (selected.every((check) => check?.conclusion === 'success')) return;
    run('node', ['-e', 'setTimeout(() => {}, 15000)']);
  }
  throw new Error('Timed out waiting for required checks on the merged commit');
}

export function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const mergeSha = process.env.MERGE_SHA;
  if (!mergeSha || !repository) throw new Error('Missing release handoff context');
  const labels = JSON.parse(process.env.LABELS_JSON || '[]');
  if (!labels.some((label) => label.name === 'release')) return;

  const repo = `repos/${repository}`;
  run('git', ['fetch', 'origin', 'main:refs/remotes/origin/main', '--no-tags']);
  run('git', ['merge-base', '--is-ancestor', mergeSha, 'origin/main']);
  const baseSha = run('git', ['rev-parse', `${mergeSha}^1`]);
  const basePackage = JSON.parse(run('git', ['show', `${baseSha}:package.json`]));
  const packageJson = JSON.parse(run('git', ['show', `${mergeSha}:package.json`]));
  const lockfile = JSON.parse(run('git', ['show', `${mergeSha}:package-lock.json`]));
  const candidate = candidateTag(basePackage, packageJson, lockfile);
  if (!candidate) return;

  validatePublicationState(repo, candidate.tag, candidate.version);
  waitForRequiredChecks(repo, mergeSha);
  validatePublicationState(repo, candidate.tag, candidate.version);
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['tag', '-a', candidate.tag, mergeSha, '-m', `Release ${candidate.tag}`]);
  run('git', ['push', 'origin', `refs/tags/${candidate.tag}`]);
  run('gh', ['workflow', 'run', 'release.yml', '--repo', repository, '--ref', 'main', '-f', `tag=${candidate.tag}`]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
