# Codex 하네스 산출물과 재개 규칙

## 단계별 산출물

### 1. 레퍼런스 검색·분석

- `01-reference-analysis.md` [D07]

### 2. 화면 설계·컨셉 확정

- `02-screen-spec.md` [D07]
- `02-concept-approval.md` [D07]
- Figma 키스크린 2~3개 [D07, D12]

### 3. 디자인 제작·검토

- `03-design-system.md` [D07]
- `03-design-review.md` [D07]
- Figma 최종 화면 [D07]

## 규칙 SSOT

- 단일 규칙 파일: `harness/rules.json` [D08]
- Markdown 판정 산출물은 `harness-json` fenced block을 정확히 1개 포함하고, 기계 판정 데이터는 그 블록에 둔다. [D23]
- 화면설계 단계와 디자인 단계에 각각 `figma-state.json`을 두고 실제 Figma MCP metadata, 도구명, fileKey, 관측 시각을 기록한다. [D24, D25]
- 컨셉 승인 데이터는 `approvedBy`, ISO 8601 `approvedAt`, `screenSpecSha256`, `figmaMetadataSha256`를 가진다. `seal-approval`은 사람 승인 뒤 현재 입력 해시를 기록한다. [D24]
- `runs/{run_id}/validation-report.md`의 JSON 블록은 gate별 status, errors, returnTo, sourceHashes를 기록한다. G2 PASS 항목에는 화면설계 파일·Figma metadata 해시가 있어야 재개 시 승인 입력이 그대로인지 확인할 수 있다. [D19, D23, D24]

## 재개 규칙

- 완료된 단계의 필수 산출물이 있으면 해당 단계를 건너뛴다. [D09]
- 게이트가 실패하면 해당 게이트의 복귀 단계부터 시작한다. [D09]
- 필수 산출물이 없으면 가장 먼저 누락된 단계부터 다시 시작한다. [D09]
- `resume`은 G1을 재판정하고 G2 승인 입력 해시를 이전 라이브 판정 기록과 대조한다. 기록이 없거나 해시가 다르면 G2부터 판정한다. [D24, D25, D29]
- G2 통과 뒤 디자인 단계에서 Figma를 변경할 수 있으므로, 컨셉 승인용 2단계 snapshot과 최종 디자인용 3단계 snapshot을 별도로 보존한다. [D24, D25]

## JSON 블록 구조

- G1: `{ "schemaVersion": 1, "references": [{ "url", "layoutStructure", "mood", "applicationCandidate" }] }`
- G2 화면설계: `{ "schemaVersion": 1, "figmaFileKey", "keyScreens": [{ "id", "nodeId", "width", "height" }], "features": [{ "id", "screenIds" }], "saleApplication": { "allowedRoles", "finalReviewStatus" } }`
- G2 승인: `{ "schemaVersion": 1, "status", "approvedBy", "approvedAt", "screenSpecSha256", "figmaMetadataSha256" }`
- G3 검토: `{ "schemaVersion": 1, "figmaFileKey", "figmaMetadataSha256", "checks": { "color", "typography", "spacing", "radius", "components" } }`; 각 category 값은 `violations`, `checkedNodeIds`, `designRuleRefs`를 가진다.
- `figma-state.json`: `{ "source": { "type", "tool", "fileKey", "observedAt" }, "metadata" }`; metadata는 도구가 반환한 원문 문자열이다.
