import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function patchTargets(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
}

export function checkPatchScope(patch, state, roles) {
  const targets = patchTargets(patch);
  if (targets.length === 0) return { allowed: false, reason: 'apply_patch 대상 파일 경로를 읽지 못해 편집을 차단했습니다.' };
  const roleFolder = roles[state.role];
  if (!roleFolder) return { allowed: false, reason: `활성 역할 ${state.role}에는 편집 권한이 없습니다.` };
  const prefix = path.posix.join('runs', state.runId, roleFolder) + '/';
  for (const target of targets) {
    const normalized = path.posix.normalize(target.replaceAll('\\', '/'));
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../') || !normalized.startsWith(prefix)) {
      return { allowed: false, reason: `${state.role}은 ${prefix} 안의 파일만 수정할 수 있습니다. 차단 대상: ${target}` };
    }
  }
  return { allowed: true, targets };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const event = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const patch = event?.tool_input?.command;
  if (typeof patch !== 'string') return;
  const targets = patchTargets(patch);
  const runIds = new Set(targets.map((target) => target.replaceAll('\\', '/').match(/^runs\/([^/]+)\//)?.[1]).filter(Boolean));
  if (runIds.size === 0) return;
  if (runIds.size !== 1 || targets.some((target) => !target.replaceAll('\\', '/').startsWith(`runs/${[...runIds][0]}/`))) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: '하나의 실행 폴더 안에서만 수정할 수 있습니다.' } }));
    return;
  }
  const runId = [...runIds][0];
  const statePath = path.join(ROOT, 'runs', runId, '.harness-state.json');
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch { return; }
  const rules = JSON.parse(await readFile(path.join(ROOT, 'harness/rules.json'), 'utf8'));
  const result = checkPatchScope(patch, state, rules.roles);
  if (!result.allowed) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: result.reason } }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
