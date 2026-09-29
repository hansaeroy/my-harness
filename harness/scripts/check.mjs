import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULES_PATH = path.join(ROOT, 'harness/rules.json');
const DECISIONS_PATH = path.join(ROOT, 'harness/decisions.md');

export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const part = rest[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    if (key === 'live-figma-stdin') options[key] = true;
    else options[key] = rest[++i];
  }
  return { command, options };
}

function issue(code, message) {
  return { code, message };
}

export function extractJsonBlock(markdown, label = 'artifact') {
  const blocks = [...markdown.matchAll(/```harness-json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) throw new Error(`${label}: harness-json 블록은 정확히 1개여야 합니다.`);
  try {
    return JSON.parse(blocks[0][1]);
  } catch (error) {
    throw new Error(`${label}: harness-json JSON 파싱 실패: ${error.message}`);
  }
}

export function replaceJsonBlock(markdown, value) {
  const blocks = [...markdown.matchAll(/```harness-json\s*\n([\s\S]*?)\n```/g)];
  if (blocks.length !== 1) throw new Error('harness-json 블록은 정확히 1개여야 합니다.');
  const replacement = `\`\`\`harness-json\n${JSON.stringify(value, null, 2)}\n\`\`\``;
  const block = blocks[0];
  return markdown.slice(0, block.index) + replacement + markdown.slice(block.index + block[0].length);
}

export function parseFigmaNodes(metadata) {
  const nodes = new Map();
  const tags = metadata.matchAll(/<([A-Za-z][\w:.-]*)\b([^>]*)>/g);
  for (const [, , rawAttributes] of tags) {
    const attributes = Object.fromEntries(
      [...rawAttributes.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key, value]),
    );
    const id = attributes.id ?? attributes.nodeId ?? attributes.guid;
    if (!id) continue;
    const width = Number(attributes.width ?? attributes.w);
    const height = Number(attributes.height ?? attributes.h);
    nodes.set(id, { id, width, height, type: attributes.type ?? attributes.nodeType ?? '' });
  }
  return nodes;
}

function validIsoDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && /^\d{4}-\d\d-\d\dT/.test(value);
}

function parseFigmaSnapshot(value, expectedTool) {
  if (!value || value.source?.type !== 'figma-mcp-live') throw new Error('Figma 상태 출처가 figma-mcp-live가 아닙니다.');
  if (value.source?.tool !== expectedTool) throw new Error(`Figma 메타데이터는 ${expectedTool} 도구에서 가져와야 합니다.`);
  if (!value.source?.fileKey || !validIsoDate(value.source?.observedAt)) throw new Error('Figma fileKey 또는 observedAt이 없습니다.');
  if (typeof value.metadata !== 'string' || value.metadata.trim() === '') throw new Error('Figma metadata가 비어 있습니다.');
  return { fileKey: value.source.fileKey, metadata: value.metadata, metadataSha256: sha256(value.metadata) };
}

async function readText(file) {
  return readFile(file, 'utf8');
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

export function validateG1(data, rules) {
  const errors = [];
  if (data?.schemaVersion !== rules.artifactFormat.schemaVersion) errors.push(issue('ARTIFACT_VERSION', '산출물 schemaVersion이 규칙과 다릅니다.'));
  const references = data?.references;
  if (!Array.isArray(references)) return [issue('REFERENCES_REQUIRED', 'references 배열이 없습니다.')];
  const sites = new Set();
  for (const [index, reference] of references.entries()) {
    const label = `references[${index}]`;
    for (const field of rules.gates.G1.requiredReferenceFields) {
      if (typeof reference?.[field] !== 'string' || reference[field].trim() === '') errors.push(issue('REFERENCE_FIELD_REQUIRED', `${label}.${field}가 비어 있습니다.`));
    }
    try {
      const url = new URL(reference.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
      sites.add(url.hostname.toLowerCase());
    } catch {
      errors.push(issue('REFERENCE_URL_INVALID', `${label}.url은 http 또는 https URL이어야 합니다.`));
    }
  }
  if (sites.size < rules.gates.G1.minimumUniqueSites) errors.push(issue('REFERENCE_SITE_COUNT', `서로 다른 사이트 ${rules.gates.G1.minimumUniqueSites}개 이상이 필요합니다. 현재 ${sites.size}개입니다.`));
  return errors;
}

function validateScreenNodes(screens, metadata, rules) {
  const errors = [];
  const nodes = parseFigmaNodes(metadata);
  const seenIds = new Set();
  const seenNodes = new Set();
  for (const [index, screen] of screens.entries()) {
    const label = `keyScreens[${index}]`;
    if (typeof screen?.id !== 'string' || !screen.id.trim()) errors.push(issue('SCREEN_ID_REQUIRED', `${label}.id가 없습니다.`));
    if (typeof screen?.nodeId !== 'string' || !screen.nodeId.trim()) errors.push(issue('SCREEN_NODE_REQUIRED', `${label}.nodeId가 없습니다.`));
    if (seenIds.has(screen?.id)) errors.push(issue('SCREEN_ID_DUPLICATE', `화면 ID ${screen.id}가 중복됩니다.`));
    if (seenNodes.has(screen?.nodeId)) errors.push(issue('SCREEN_NODE_DUPLICATE', `Figma nodeId ${screen.nodeId}가 중복됩니다.`));
    seenIds.add(screen?.id);
    seenNodes.add(screen?.nodeId);
    if (screen?.width !== rules.gates.G2.screenWidth || screen?.height !== rules.gates.G2.screenHeight) errors.push(issue('SCREEN_SIZE', `${label}은 ${rules.gates.G2.screenWidth}×${rules.gates.G2.screenHeight}이어야 합니다.`));
    const actual = nodes.get(screen?.nodeId);
    if (!actual) errors.push(issue('FIGMA_NODE_MISSING', `실제 Figma metadata에서 node ${screen?.nodeId}를 찾지 못했습니다.`));
    else if (actual.width !== rules.gates.G2.screenWidth || actual.height !== rules.gates.G2.screenHeight) errors.push(issue('FIGMA_SCREEN_SIZE', `Figma node ${screen.nodeId} 크기가 ${rules.gates.G2.screenWidth}×${rules.gates.G2.screenHeight}가 아닙니다.`));
  }
  return errors;
}

export function validateG2({ spec, approval, snapshot, liveMetadata, liveFileKey }, rules) {
  const errors = [];
  const gate = rules.gates.G2;
  if (spec?.schemaVersion !== rules.artifactFormat.schemaVersion) errors.push(issue('ARTIFACT_VERSION', '화면 설계 산출물 schemaVersion이 규칙과 다릅니다.'));
  if (!Array.isArray(spec?.keyScreens) || spec.keyScreens.length < gate.minimumScreens || spec.keyScreens.length > gate.maximumScreens) errors.push(issue('SCREEN_COUNT', `키스크린은 ${gate.minimumScreens}~${gate.maximumScreens}개여야 합니다.`));
  const specHash = sha256(spec.__sourceMarkdown ?? '');
  let savedFigma;
  let liveFigma;
  try { savedFigma = parseFigmaSnapshot(snapshot, rules.figmaSnapshot.metadataTool); }
  catch (error) { errors.push(issue('FIGMA_SNAPSHOT_INVALID', error.message)); }
  if (typeof liveMetadata !== 'string' || liveMetadata.trim() === '') errors.push(issue('LIVE_FIGMA_REQUIRED', '판정자가 실제 Figma MCP metadata를 직접 조회해 --live-figma-stdin으로 전달해야 합니다.'));
  else {
    liveFigma = { metadata: liveMetadata, metadataSha256: sha256(liveMetadata) };
    if (!liveFileKey) errors.push(issue('LIVE_FIGMA_FILE_KEY_REQUIRED', '실제 MCP 호출에 사용한 Figma fileKey가 필요합니다.'));
  }
  if (savedFigma && liveFigma && savedFigma.metadataSha256 !== liveFigma.metadataSha256) errors.push(issue('FIGMA_STATE_CHANGED', '실제 Figma metadata가 승인 시점 스냅샷과 달라 이전 컨셉 승인을 재사용할 수 없습니다.'));
  if (savedFigma && liveFileKey && savedFigma.fileKey !== liveFileKey) errors.push(issue('FIGMA_FILE_CHANGED', '실제 MCP 조회 파일과 승인 당시 Figma fileKey가 다릅니다.'));
  if (savedFigma && spec?.figmaFileKey !== savedFigma.fileKey) errors.push(issue('FIGMA_FILE_KEY_MISMATCH', '화면설계서와 Figma 상태 파일의 fileKey가 다릅니다.'));
  if (liveFigma) errors.push(...validateScreenNodes(spec?.keyScreens ?? [], liveMetadata, rules));

  if (approval?.schemaVersion !== rules.artifactFormat.schemaVersion) errors.push(issue('ARTIFACT_VERSION', '컨셉 승인 산출물 schemaVersion이 규칙과 다릅니다.'));
  if (approval?.status !== gate.approval.requiredStatus) errors.push(issue('HUMAN_APPROVAL_REQUIRED', '내부 관계자의 컨셉 승인 상태가 approved가 아닙니다.'));
  for (const field of gate.approval.requiredFields) {
    if (typeof approval?.[field] !== 'string' || !approval[field].trim()) errors.push(issue('APPROVAL_FIELD_REQUIRED', `컨셉 승인 ${field} 값이 없습니다.`));
  }
  if (approval?.approvedAt && !validIsoDate(approval.approvedAt)) errors.push(issue('APPROVAL_DATE_INVALID', 'approvedAt은 ISO 8601 날짜여야 합니다.'));
  if (approval?.screenSpecSha256 !== specHash) errors.push(issue('STALE_SCREEN_SPEC_APPROVAL', '화면설계서가 승인 후 변경되어 기존 승인이 무효입니다.'));
  if (savedFigma && approval?.figmaMetadataSha256 !== savedFigma.metadataSha256) errors.push(issue('STALE_FIGMA_APPROVAL', 'Figma 컨셉이 승인 후 변경되어 기존 승인이 무효입니다.'));

  const features = spec?.features;
  if (!Array.isArray(features) || features.length === 0) errors.push(issue('FEATURES_REQUIRED', 'features 배열에 화면 기능을 구조화해 적어야 합니다.'));
  const prohibited = new Set(gate.prohibitedFeatureIds);
  for (const feature of features ?? []) {
    if (typeof feature?.id !== 'string' || !feature.id.trim()) errors.push(issue('FEATURE_ID_REQUIRED', '각 features 항목에는 표준 id가 필요합니다.'));
    if (prohibited.has(feature?.id)) errors.push(issue('PROHIBITED_FEATURE', `MVP 금지 기능 ID가 포함되어 있습니다: ${feature.id}`));
    if (!Array.isArray(feature?.screenIds) || feature.screenIds.length === 0 || feature.screenIds.some((id) => !spec.keyScreens?.some((screen) => screen.id === id))) errors.push(issue('FEATURE_SCREEN_REFERENCE', `기능 ${feature?.id ?? '(id 없음)'}의 screenIds가 키스크린과 연결되지 않았습니다.`));
  }
  const roles = spec?.saleApplication?.allowedRoles;
  if (!Array.isArray(roles) || roles.length !== 1 || roles[0] !== gate.saleApplication.allowedRoles[0]) errors.push(issue('SALE_ROLE', '판매 신청 허용 역할은 seller 하나여야 합니다.'));
  if (spec?.saleApplication?.finalReviewStatus !== gate.saleApplication.finalReviewStatus) errors.push(issue('SALE_REVIEW_STATUS', '판매 신청의 최종 검수 상태는 approved여야 합니다.'));
  return errors;
}

export function validateG3({ review, snapshot, liveMetadata, liveFileKey }, rules) {
  const errors = [];
  const gate = rules.gates.G3;
  if (review?.schemaVersion !== rules.artifactFormat.schemaVersion) errors.push(issue('ARTIFACT_VERSION', '디자인 검토 산출물 schemaVersion이 규칙과 다릅니다.'));
  let savedFigma;
  try { savedFigma = parseFigmaSnapshot(snapshot, rules.figmaSnapshot.metadataTool); }
  catch (error) { errors.push(issue('FIGMA_SNAPSHOT_INVALID', error.message)); }
  if (typeof liveMetadata !== 'string' || liveMetadata.trim() === '') errors.push(issue('LIVE_FIGMA_REQUIRED', '판정자가 실제 Figma MCP metadata를 직접 조회해 --live-figma-stdin으로 전달해야 합니다.'));
  else if (savedFigma && sha256(liveMetadata) !== savedFigma.metadataSha256) errors.push(issue('FIGMA_STATE_CHANGED', '실제 Figma 상태와 검토 대상 스냅샷이 다릅니다.'));
  if (savedFigma && liveFileKey !== savedFigma.fileKey) errors.push(issue('FIGMA_FILE_CHANGED', '실제 MCP 조회 파일과 검토 스냅샷의 fileKey가 다릅니다.'));
  if (review?.figmaFileKey !== savedFigma?.fileKey) errors.push(issue('REVIEW_FILE_KEY_MISMATCH', '검토서와 Figma 스냅샷의 fileKey가 다릅니다.'));
  if (review?.figmaMetadataSha256 !== savedFigma?.metadataSha256) errors.push(issue('REVIEW_FINGERPRINT_MISMATCH', '검토서의 Figma fingerprint가 검증된 metadata와 다릅니다.'));
  const nodes = parseFigmaNodes(liveMetadata ?? '');
  for (const category of gate.categories) {
    const check = review?.checks?.[category];
    if (!check || !Number.isInteger(check.violations) || check.violations < 0) {
      errors.push(issue('DESIGN_COUNT_INVALID', `${category}.violations는 0 이상의 정수여야 합니다.`));
      continue;
    }
    if (check.violations > gate.maximumViolations) errors.push(issue('DESIGN_VIOLATION', `${category} 위반 ${check.violations}건이 있습니다.`));
    for (const field of gate.requiredEvidenceFields) {
      if (!Array.isArray(check[field]) || check[field].length === 0 || check[field].some((value) => typeof value !== 'string' || !value.trim())) errors.push(issue('DESIGN_EVIDENCE_REQUIRED', `${category}.${field} 근거가 비어 있습니다.`));
    }
    for (const nodeId of check.checkedNodeIds ?? []) if (!nodes.has(nodeId)) errors.push(issue('DESIGN_NODE_NOT_IN_FIGMA', `${category}에서 검토했다고 한 node ${nodeId}가 현재 Figma metadata에 없습니다.`));
  }
  return errors;
}

export function stalePathsIn(text) {
  const oldPaths = [
    'docs/harness-purpose.md', 'docs/harness-pipeline.md', 'docs/harness-artifacts.md',
    'docs/harness-gates.md', 'docs/harness-roles.md', 'docs/harness-orchestrator-contract.md',
    'docs/harness-validation.md', 'docs/harness-decisions.md',
  ];
  return oldPaths.filter((oldPath) => text.includes(oldPath));
}

async function checkRules() {
  const rules = await readJson(RULES_PATH);
  const decisionsText = await readText(DECISIONS_PATH);
  const known = new Set([...decisionsText.matchAll(/\| (D\d{2}) \|/g)].map((match) => match[1]));
  const ids = new Set();
  const collect = (value) => {
    if (Array.isArray(value)) return value.forEach(collect);
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.sourceDecisionIds)) value.sourceDecisionIds.forEach((id) => ids.add(id));
    Object.values(value).forEach(collect);
  };
  collect(rules);
  const missing = [...ids].filter((id) => !known.has(id));
  const invalidPaths = [];
  const gatherPaths = (value) => {
    if (Array.isArray(value)) return value.forEach(gatherPaths);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith('Artifact') && typeof item === 'string' && !item.includes('{')) {
        const parent = key === 'artifact' ? (value === rules.gates.G1 ? '01-reference' : '') : '';
        void parent;
      }
      gatherPaths(item);
    }
  };
  gatherPaths(rules);
  if (rules.schemaVersion !== 1) invalidPaths.push('schemaVersion must be 1');
  if (!existsSync(path.join(ROOT, rules.provenanceLedger))) invalidPaths.push(`missing ${rules.provenanceLedger}`);
  const inputs = [
    'AGENTS.md', '.codex/hooks.json', 'harness/rules.json', 'harness/decisions.md',
    'docs/PRD.md', 'docs/design.md', 'docs/story-service.md', 'docs/story-work.md',
    '.codex/agents/reference-researcher.toml', '.codex/agents/screen-designer.toml',
    '.codex/agents/design-builder.toml', '.codex/agents/judge.toml', 'harness/roles.md',
    'harness/pipeline.md', 'harness/artifacts.md', 'harness/orchestrator-contract.md', 'harness/validation.md',
  ];
  const stale = [];
  for (const relative of inputs) {
    const file = path.join(ROOT, relative);
    if (!existsSync(file)) { invalidPaths.push(`missing ${relative}`); continue; }
    stale.push(...stalePathsIn(await readText(file)).map((value) => `${relative}: ${value}`));
  }
  const errors = [...missing.map((id) => `unknown source decision ${id}`), ...invalidPaths, ...stale.map((value) => `stale path ${value}`)];
  return { ok: errors.length === 0, errors, sourceDecisionIds: [...ids].sort() };
}

function assertSafeRunId(runId) {
  if (typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runId)) throw new Error('run_id는 영문자·숫자·하이픈·밑줄만 사용할 수 있습니다.');
}

function runDir(runId) {
  assertSafeRunId(runId);
  return path.join(ROOT, 'runs', runId);
}

async function readArtifactBlock(file) {
  return { markdown: await readText(file), data: extractJsonBlock(await readText(file), path.relative(ROOT, file)) };
}

async function readLiveMetadata(stdinEnabled) {
  if (!stdinEnabled) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function judge(runId, gateName, options = {}) {
  const rules = await readJson(RULES_PATH);
  const directory = runDir(runId);
  const liveMetadata = options.liveMetadata ?? '';
  const liveFileKey = options.liveFileKey ?? '';
  let errors = [];
  let sourceHashes = {};
  try {
    if (gateName === 'G1') {
      const { data } = await readArtifactBlock(path.join(directory, '01-reference', rules.gates.G1.artifact));
      errors = validateG1(data, rules);
    } else if (gateName === 'G2') {
      const stage = path.join(directory, '02-screen-design');
      const specDoc = await readArtifactBlock(path.join(stage, rules.gates.G2.screenSpecArtifact));
      const approvalDoc = await readArtifactBlock(path.join(stage, rules.gates.G2.approvalArtifact));
      const snapshot = await readJson(path.join(stage, rules.gates.G2.figmaStateArtifact));
      sourceHashes = { screenSpecSha256: sha256(specDoc.markdown), figmaMetadataSha256: sha256(snapshot.metadata ?? '') };
      errors = validateG2({ spec: { ...specDoc.data, __sourceMarkdown: specDoc.markdown }, approval: approvalDoc.data, snapshot, liveMetadata, liveFileKey }, rules);
    } else if (gateName === 'G3') {
      const stage = path.join(directory, '03-design');
      const reviewDoc = await readArtifactBlock(path.join(stage, rules.gates.G3.reviewArtifact));
      const snapshot = await readJson(path.join(stage, rules.gates.G3.figmaStateArtifact));
      sourceHashes = { figmaMetadataSha256: sha256(snapshot.metadata ?? '') };
      errors = validateG3({ review: reviewDoc.data, snapshot, liveMetadata, liveFileKey }, rules);
    } else throw new Error(`알 수 없는 게이트: ${gateName}`);
  } catch (error) {
    errors.push(issue('ARTIFACT_READ_ERROR', error.message));
  }
  const returnTo = errors.length ? rules.gates[gateName].returnTo : null;
  return { gate: gateName, status: errors.length ? 'FAIL' : 'PASS', errors, returnTo, runId, sourceHashes };
}

async function sealApproval(runId) {
  const rules = await readJson(RULES_PATH);
  const stage = path.join(runDir(runId), '02-screen-design');
  const specPath = path.join(stage, rules.gates.G2.screenSpecArtifact);
  const approvalPath = path.join(stage, rules.gates.G2.approvalArtifact);
  const snapshotPath = path.join(stage, rules.gates.G2.figmaStateArtifact);
  const specDoc = await readArtifactBlock(specPath);
  const approvalDoc = await readArtifactBlock(approvalPath);
  const snapshot = parseFigmaSnapshot(await readJson(snapshotPath), rules.figmaSnapshot.metadataTool);
  if (approvalDoc.data.status !== 'approved') throw new Error('사람이 컨셉 승인 상태를 approved로 기록한 뒤에만 해시를 봉인할 수 있습니다.');
  if (!approvalDoc.data.approvedBy || !validIsoDate(approvalDoc.data.approvedAt)) throw new Error('approvedBy와 ISO 8601 approvedAt을 기록해야 합니다.');
  const next = { ...approvalDoc.data, screenSpecSha256: sha256(specDoc.markdown), figmaMetadataSha256: snapshot.metadataSha256 };
  await writeFile(approvalPath, replaceJsonBlock(approvalDoc.markdown, next), 'utf8');
  return { status: 'SEALED', runId, screenSpecSha256: next.screenSpecSha256, figmaMetadataSha256: next.figmaMetadataSha256 };
}

async function setRole(runId, role) {
  const rules = await readJson(RULES_PATH);
  if (!(role in rules.roles)) throw new Error(`정의되지 않은 역할: ${role}`);
  const directory = runDir(runId);
  if (!existsSync(directory)) throw new Error(`실행 폴더가 없습니다: runs/${runId}`);
  if (role === 'judge') throw new Error('judge는 읽기 전용 역할이므로 활성 편집 역할로 설정할 수 없습니다.');
  const state = { runId, role, activatedAt: new Date().toISOString() };
  await writeFile(path.join(directory, '.harness-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { status: 'ACTIVE', ...state };
}

async function clearRole(runId) {
  const statePath = path.join(runDir(runId), '.harness-state.json');
  await rm(statePath, { force: true });
  return { status: 'CLEARED', runId };
}

async function initRun(runId) {
  const directory = runDir(runId);
  if (existsSync(directory)) throw new Error(`이미 존재하는 실행 폴더입니다: runs/${runId}`);
  for (const stage of ['01-reference', '02-screen-design', '03-design']) await mkdir(path.join(directory, stage), { recursive: true });
  return { status: 'INITIALIZED', runId, directory: path.relative(ROOT, directory) };
}

async function createRun() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const runId = `run-${timestamp}-${randomUUID().slice(0, 8)}`;
  return initRun(runId);
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  let result;
  if (command === 'check-rules') result = await checkRules();
  else if (command === 'create-run') result = await createRun();
  else if (command === 'init-run') result = await initRun(options['run-id']);
  else if (command === 'seal-approval') result = await sealApproval(options['run-id']);
  else if (command === 'activate-role') result = await setRole(options['run-id'], options.role);
  else if (command === 'clear-role') result = await clearRole(options['run-id']);
  else if (command === 'fingerprint') result = { sha256: sha256(await readLiveMetadata(true)) };
  else if (command === 'judge') {
    const liveMetadata = await readLiveMetadata(options['live-figma-stdin']);
    result = await judge(options['run-id'], options.gate, { liveMetadata, liveFileKey: options['live-figma-file-key'] });
  } else if (command === 'resume') {
    const runId = options['run-id'];
    const g1 = await judge(runId, 'G1');
    if (g1.status === 'FAIL') result = { runId, startAt: '01-reference', results: [g1] };
    else {
      const stage2 = path.join(runDir(runId), '02-screen-design');
      const rules = await readJson(RULES_PATH);
      const specPath = path.join(stage2, rules.gates.G2.screenSpecArtifact);
      const approvalPath = path.join(stage2, rules.gates.G2.approvalArtifact);
      const snapshotPath = path.join(stage2, rules.gates.G2.figmaStateArtifact);
      if (![specPath, approvalPath, snapshotPath].every(existsSync)) result = { runId, startAt: '02-screen-design', results: [g1] };
      else {
        const specDoc = await readArtifactBlock(specPath);
        const approvalDoc = await readArtifactBlock(approvalPath);
        const snapshot = parseFigmaSnapshot(await readJson(snapshotPath), rules.figmaSnapshot.metadataTool);
        const errors = [];
        const currentHashes = { screenSpecSha256: sha256(specDoc.markdown), figmaMetadataSha256: snapshot.metadataSha256 };
        if (approvalDoc.data.status !== 'approved' || approvalDoc.data.screenSpecSha256 !== currentHashes.screenSpecSha256 || approvalDoc.data.figmaMetadataSha256 !== currentHashes.figmaMetadataSha256) errors.push(issue('STALE_OR_MISSING_G2_APPROVAL', '승인 이후 입력 파일이 바뀌었거나 승인 해시가 없습니다. G2를 다시 판정하고 필요하면 사람 승인을 받으세요.'));
        const reportPath = path.join(runDir(runId), 'validation-report.md');
        if (!existsSync(reportPath)) errors.push(issue('G2_RESULT_MISSING', '라이브 Figma 확인을 포함한 G2 PASS 기록이 없어 재개 전에 G2를 다시 판정해야 합니다.'));
        else {
          const report = extractJsonBlock(await readText(reportPath), 'validation-report.md');
          const priorG2 = report?.gates?.G2;
          if (priorG2?.status !== 'PASS' || priorG2?.sourceHashes?.screenSpecSha256 !== currentHashes.screenSpecSha256 || priorG2?.sourceHashes?.figmaMetadataSha256 !== currentHashes.figmaMetadataSha256) errors.push(issue('G2_RESULT_STALE', '이전 G2 PASS가 현재 승인 입력 해시와 일치하지 않습니다. 라이브 Figma를 다시 조회하세요.'));
        }
        if (errors.length) result = { runId, startAt: '02-screen-design', results: [g1, { gate: 'G2', status: 'FAIL', errors, returnTo: '02-screen-design', runId }] };
        else {
          const designDir = path.join(runDir(runId), '03-design');
          void designDir;
          result = { runId, startAt: '03-design', results: [g1, { gate: 'G2', status: 'PASS', errors: [], returnTo: null, runId, sourceHashes: currentHashes }] };
        }
      }
    }
  } else throw new Error('명령: check-rules | create-run | init-run | activate-role | clear-role | seal-approval | fingerprint | judge | resume');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result?.ok === false || result?.status === 'FAIL') process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

export { checkRules, judge, sealApproval };
