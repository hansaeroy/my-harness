import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateG1, validateG2, validateG3, sha256, extractJsonBlock, stalePathsIn } from '../scripts/check.mjs';
import { checkPatchScope, patchTargets } from '../scripts/guard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rules = JSON.parse(await readFile(path.join(ROOT, 'harness/rules.json'), 'utf8'));

function figmaState(metadata = '<FRAME id="201:1" width="390" height="844" /><FRAME id="201:2" width="390" height="844" />') {
  return {
    source: {
      type: 'figma-mcp-live',
      tool: 'mcp__codex_apps__figma_get_metadata',
      fileKey: 'file-abc',
      observedAt: '2026-09-29T00:00:00.000Z',
    },
    metadata,
  };
}

function screenSpec(overrides = {}) {
  const data = {
    schemaVersion: 1,
    figmaFileKey: 'file-abc',
    keyScreens: [
      { id: 'home', nodeId: '201:1', width: 390, height: 844 },
      { id: 'asset', nodeId: '201:2', width: 390, height: 844 },
    ],
    features: [{ id: 'asset-submit', screenIds: ['asset'] }],
    saleApplication: { allowedRoles: ['seller'], finalReviewStatus: 'approved' },
    ...overrides,
  };
  return { ...data, __sourceMarkdown: 'screen-spec contents v1' };
}

function validG2(overrides = {}) {
  const snapshot = figmaState();
  const spec = screenSpec(overrides.spec);
  const approval = {
    schemaVersion: 1,
    status: 'approved',
    approvedBy: '내부 관계자',
    approvedAt: '2026-09-29T00:00:00.000Z',
    screenSpecSha256: sha256(spec.__sourceMarkdown),
    figmaMetadataSha256: sha256(snapshot.metadata),
  };
  return {
    spec,
    approval,
    snapshot,
    liveMetadata: snapshot.metadata,
    liveFileKey: 'file-abc',
    ...overrides,
  };
}

test('G1 passes with five unique sites and all required fields', () => {
  const data = {
    schemaVersion: 1,
    references: Array.from({ length: 5 }, (_, index) => ({
      url: `https://site-${index}.example/page`,
      layoutStructure: 'Single-column hero followed by feature sections',
      mood: 'Editorial and quiet',
      applicationCandidate: 'Use the layered section transition',
    })),
  };
  assert.deepEqual(validateG1(data, rules), []);
});

test('G1 rejects duplicate hostnames, invalid URLs, and missing fields', () => {
  const data = {
    schemaVersion: 1,
    references: Array.from({ length: 5 }, (_, index) => ({
      url: index < 2 ? 'https://same.example/' : `not-a-url-${index}`,
      layoutStructure: 'layout',
      mood: 'mood',
      applicationCandidate: index === 4 ? '' : 'candidate',
    })),
  };
  const errors = validateG1(data, rules);
  assert.ok(errors.some(({ code }) => code === 'REFERENCE_SITE_COUNT'));
  assert.ok(errors.some(({ code }) => code === 'REFERENCE_URL_INVALID'));
  assert.ok(errors.some(({ code }) => code === 'REFERENCE_FIELD_REQUIRED'));
});

test('G2 passes when approved input hashes and live Figma metadata match', () => {
  assert.deepEqual(validateG2(validG2(), rules), []);
});

test('G2 invalidates an old approval when the screen specification changes', () => {
  const input = validG2();
  input.spec.__sourceMarkdown = 'screen-spec contents changed after approval';
  const errors = validateG2(input, rules);
  assert.ok(errors.some(({ code }) => code === 'STALE_SCREEN_SPEC_APPROVAL'));
});

test('G2 invalidates an old approval when live Figma state changes', () => {
  const input = validG2({ liveMetadata: '<FRAME id="201:1" width="390" height="844" /><FRAME id="201:2" width="390" height="800" />' });
  const errors = validateG2(input, rules);
  assert.ok(errors.some(({ code }) => code === 'FIGMA_STATE_CHANGED'));
  assert.ok(errors.some(({ code }) => code === 'FIGMA_SCREEN_SIZE'));
});

test('G2 reads explicit feature IDs and ignores negated prose outside the data block', () => {
  const input = validG2();
  input.spec.editorialText = 'MVP에서는 구매 흐름을 포함하지 않는다.';
  assert.deepEqual(validateG2(input, rules), []);
  input.spec.features = [{ id: 'purchase-flow', screenIds: ['asset'] }];
  assert.ok(validateG2(input, rules).some(({ code }) => code === 'PROHIBITED_FEATURE'));
});

test('G2 enforces seller-only application, approved final review, and actual frame sizes', () => {
  const input = validG2({ spec: { saleApplication: { allowedRoles: ['seller', 'admin'], finalReviewStatus: 'pending' } } });
  const errors = validateG2(input, rules);
  assert.ok(errors.some(({ code }) => code === 'SALE_ROLE'));
  assert.ok(errors.some(({ code }) => code === 'SALE_REVIEW_STATUS'));
});

test('G2 fails closed when a judge omits a direct live Figma result', () => {
  const input = validG2({ liveMetadata: '' });
  assert.ok(validateG2(input, rules).some(({ code }) => code === 'LIVE_FIGMA_REQUIRED'));
});

test('G3 passes with zero counts, cited guide rules, and current Figma nodes', () => {
  const snapshot = figmaState();
  const categories = Object.fromEntries(rules.gates.G3.categories.map((category) => [category, {
    violations: 0,
    checkedNodeIds: ['201:1', '201:2'],
    designRuleRefs: [`docs/design.md#${category}`],
  }]));
  const review = { schemaVersion: 1, figmaFileKey: 'file-abc', figmaMetadataSha256: sha256(snapshot.metadata), checks: categories };
  assert.deepEqual(validateG3({ review, snapshot, liveMetadata: snapshot.metadata, liveFileKey: 'file-abc' }, rules), []);
});

test('G3 fails when a violation count is nonzero or evidence points to an absent node', () => {
  const snapshot = figmaState();
  const categories = Object.fromEntries(rules.gates.G3.categories.map((category) => [category, {
    violations: category === 'color' ? 1 : 0,
    checkedNodeIds: category === 'spacing' ? ['missing:9'] : ['201:1'],
    designRuleRefs: ['docs/design.md#rule'],
  }]));
  const review = { schemaVersion: 1, figmaFileKey: 'file-abc', figmaMetadataSha256: sha256(snapshot.metadata), checks: categories };
  const errors = validateG3({ review, snapshot, liveMetadata: snapshot.metadata, liveFileKey: 'file-abc' }, rules);
  assert.ok(errors.some(({ code }) => code === 'DESIGN_VIOLATION'));
  assert.ok(errors.some(({ code }) => code === 'DESIGN_NODE_NOT_IN_FIGMA'));
});

test('artifact parser requires exactly one JSON block and stale path scan catches moved files', () => {
  assert.deepEqual(extractJsonBlock('title\n```harness-json\n{"schemaVersion":1}\n```'), { schemaVersion: 1 });
  assert.throws(() => extractJsonBlock('no data block'));
  assert.deepEqual(stalePathsIn('read docs/harness-gates.md'), ['docs/harness-gates.md']);
  assert.deepEqual(stalePathsIn('read harness/gates.md'), []);
});

test('role guard allows only the owning stage folder and denies judge edits', () => {
  const roles = rules.roles;
  const state = { runId: 'test-001', role: 'screen-designer' };
  const allowed = '*** Begin Patch\n*** Update File: runs/test-001/02-screen-design/02-screen-spec.md\n*** End Patch';
  const denied = '*** Begin Patch\n*** Update File: runs/test-001/03-design/03-design-review.md\n*** End Patch';
  assert.deepEqual(patchTargets(allowed), ['runs/test-001/02-screen-design/02-screen-spec.md']);
  assert.equal(checkPatchScope(allowed, state, roles).allowed, true);
  assert.equal(checkPatchScope(denied, state, roles).allowed, false);
  assert.equal(checkPatchScope(allowed, { ...state, role: 'judge' }, roles).allowed, false);
});
