# Codex 하네스 역할과 자연어 트리거

## 편집 에이전트

| 에이전트 | 책임 | 편집 가능한 폴더 |
|---|---|---|
| `reference-researcher` | UI Bowl에서 경쟁사 레퍼런스를 검색·수집하고 분석 및 반영 후보 작성 | `runs/{run_id}/01-reference/` [D16, D21] |
| `screen-designer` | 화면 설계, 키스크린, 컨셉 승인 산출물 작성 | `runs/{run_id}/02-screen-design/` [D16] |
| `design-builder` | 토큰·컴포넌트·완성 화면 및 검토 자료 작성 | `runs/{run_id}/03-design/` [D16] |

각 편집 에이전트는 자기 폴더 하나만 수정한다. [D16]

## Codex 등록과 편집 guard

- 프로젝트 에이전트는 `.codex/agents/*.toml`에 등록하고 `name`, `description`, `developer_instructions`를 둔다. 판정자는 `sandbox_mode = "read-only"`다. [D28]
- 편집 에이전트를 시작하기 전 `node harness/scripts/check.mjs activate-role --run-id {run_id} --role {role}`를 실행하고, 종료 후 `clear-role`을 실행한다. [D27, D30]
- `.codex/hooks.json`의 PreToolUse hook은 `apply_patch` 대상 경로를 검사한다. 역할 상태는 `runs/{run_id}/.harness-state.json`에 두고 Git에서 제외한다. [D27, D30]
- hook은 apply_patch의 경로 가드다. 셸이나 일부 특수 도구의 모든 쓰기를 차단하지는 않으므로 역할 지침과 판정 리뷰를 함께 적용한다. [D27]

## 판정자

- 모든 단계 산출물과 `harness/rules.json`을 읽는다. [D17]
- 파일을 수정하지 않는다. [D17]
- 게이트 ID, `PASS`/`FAIL`, 실패 조건, 복귀 단계를 반환한다. [D17]
- G2·G3는 Figma MCP `get_metadata`를 직접 호출한다. 저장된 export만으로 판정하지 않고 실제 도구 metadata를 `--live-figma-stdin`으로 스크립트에 전달한다. [D25, D29]

## 자연어 트리거

- `디자인 하네스 시작: [서비스 또는 PRD 경로]` [D18]
- `디자인 하네스 재개: [run_id]` [D18]
- `게이트 재판정: [run_id]` [D18]
