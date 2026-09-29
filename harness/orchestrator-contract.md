# Codex 오케스트레이터 계약

## 설정 파일

- 최종 Codex 프로젝트 지침은 저장소 루트의 `AGENTS.md`로 둔다. [D20]
- 세부 파이프라인은 `harness/pipeline.md`를 따른다.
- 게이트 조건은 `harness/gates.md`와 단일 규칙 SSOT인 `harness/rules.json`을 따른다.
- 단계 산출물과 재개 규칙은 `harness/artifacts.md`를 따른다.
- 역할과 트리거는 `harness/roles.md`를 따른다.

## 실행 순서

1. 오케스트레이터가 UI Bowl에서 경쟁사 레퍼런스를 검색·수집하는 `reference-researcher`를 실행한다. [D16, D21]
2. 읽기 전용 판정자가 G1을 평가한다. [D17]
3. G1 통과 후 `screen-designer`를 실행하고, 판정자가 G2를 평가한다. [D16, D17]
4. G2에서 내부 관계자의 컨셉 승인을 한 번 받는다. 승인 전에는 다음 단계로 진행하지 않는다. [D14]
5. G2 통과 후 `design-builder`를 실행하고, 판정자가 G3를 평가한다. [D16, D17]
6. 게이트가 실패하면 지정된 복귀 단계부터 재개한다. 통과 전에는 다음 단계로 진행하지 않는다. [D06]

## 실행 명령

1. 새 실행 폴더는 `node harness/scripts/check.mjs init-run --run-id {run_id}`로 만든다. [D30]
2. 편집 역할 실행 전후에 `activate-role` / `clear-role`을 호출한다. [D27, D30]
3. G1은 `node harness/scripts/check.mjs judge --run-id {run_id} --gate G1`로 판정한다.
4. 내부 관계자가 컨셉을 승인한 뒤 `seal-approval`을 실행한다. 이후 판정자가 Figma MCP metadata를 직접 조회하고 G2 스크립트에 전달한다. [D14, D24, D25, D29]
5. G3도 판정자가 실제 Figma metadata를 직접 조회해 스크립트에 전달한다. 카테고리별 위반 수와 node ID·`docs/design.md` 근거를 기록한다. [D15, D25, D29]
6. gate JSON 출력은 `runs/{run_id}/validation-report.md`의 `harness-json` 블록에 기록한다. G2 PASS 결과에는 `sourceHashes`가 있어야 한다. [D19, D23, D24]
7. 재개 시 `node harness/scripts/check.mjs resume --run-id {run_id}`를 실행한다. 해시가 달라졌거나 라이브 G2 판정 기록이 없으면 2단계부터 다시 판정한다. [D09, D24, D29]

## 편집 및 판정 경계

- 각 편집 에이전트는 자기 소유 폴더만 수정한다. [D16]
- 읽기 전용 판정자는 산출물과 규칙을 읽고 게이트 판정만 반환한다. [D17]
- 반복되는 게이트 규칙을 `AGENTS.md`에 복사하지 않는다. SSOT와 승인된 설계 문서를 참조한다.
- 판정 데이터가 없는 일반 문장은 검사하지 않는다. 기능 범위는 `features[].id` 같은 정해진 JSON 필드에서만 판정한다. [D23, D26]
