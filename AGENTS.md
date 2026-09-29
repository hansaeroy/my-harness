# Codex 디자인 하네스

## 작업 맥락

- `docs/story-service.md`는 이 일이 무엇을 위한 것인지와 서비스 불변 기준을 설명한다.
- `docs/story-work.md`는 사람이 실제로 작업했던 순서를 설명한다.
- 두 문서를 하나의 기준으로 섞지 않는다.
- 파이프라인은 `harness/pipeline.md`, 단계별 산출물과 재개 규칙은 `harness/artifacts.md`를 따른다.
- 에이전트 역할과 트리거는 `harness/roles.md`를 따른다.
- 게이트 조건의 실행 기준은 `harness/rules.json`이다. 문서와 충돌하면 JSON 규칙을 따른다.
- 모든 기본값과 그 출처 유형은 `harness/decisions.md`에서 확인한다. 근거가 없는 제안값을 문서 근거처럼 표현하지 않는다. [D22]

## 자연어 트리거

- `디자인 하네스 시작: [서비스 또는 PRD 경로]`는 전체 파이프라인을 시작한다. [D18]
- `디자인 하네스 재개: [run_id]`는 유효한 완료 산출물을 보존하고 필요한 복귀 단계부터 재개한다. [D18]
- `게이트 재판정: [run_id]`는 기존 산출물만 읽어 게이트를 다시 판정한다. [D18]

## 실행 명령

- 새 실행은 `node harness/scripts/check.mjs create-run`으로 시작하고 출력된 `run_id`를 사용한다. [D31]
- 각 편집 역할은 작업 전 `activate-role --run-id {run_id} --role {role}`로 활성화하고, 작업 후 `clear-role --run-id {run_id}`로 해제한다. [D27, D30]
- 각 게이트는 `node harness/scripts/check.mjs judge --run-id {run_id} --gate G1|G2|G3`로 판정한다. G2와 G3는 판정자가 Figma MCP에서 현재 메타데이터를 직접 조회해 stdin으로 전달해야 한다. [D25, D29]
- 내부 관계자가 컨셉 승인 후 `seal-approval`을 실행해 화면설계와 Figma 상태 해시를 승인에 묶는다. [D14, D24]
- 판정 JSON과 실패 조건·복귀 단계를 `runs/{run_id}/validation-report.md`의 `harness-json` 블록에 기록한다. [D19, D23]
- 재개는 `node harness/scripts/check.mjs resume --run-id {run_id}`를 사용한다. 이전 G2 승인 해시가 바뀌었거나 유효한 판정 기록이 없으면 화면 설계 단계부터 재실행한다. [D09, D24]

## 실행 순서

1. `reference-researcher`가 UI Bowl에서 경쟁사 레퍼런스를 수집·분석하고 `runs/{run_id}/01-reference/01-reference-analysis.md`를 작성한다. [D04, D07, D16, D21]
2. 읽기 전용 판정자가 G1을 판정한다. 실패하면 레퍼런스 검색·분석 단계로 돌아간다. [D06, D17]
3. G1 통과 후 `screen-designer`가 `runs/{run_id}/02-screen-design/`에 화면 설계서와 컨셉 승인 자료를 작성하고 Figma 키스크린 2~3개를 만든다. [D04, D07, D12, D16]
4. 판정자가 G2 기계 조건을 확인한다. 내부 관계자가 컨셉을 확정하는 유일한 사람 승인도 G2에서 받는다. 승인 전에는 디자인 제작으로 넘어가지 않는다. 실패하면 화면 설계 단계로 돌아간다. [D06, D14, D17]
5. G2 통과 후 `design-builder`가 `runs/{run_id}/03-design/`에 디자인 토큰·컴포넌트와 검토 자료를 작성하고 Figma 최종 화면을 만든다. [D04, D07, D16]
6. 읽기 전용 판정자가 G3를 판정한다. 실패하면 디자인 제작 단계에서 수정 후 재검토한다. [D06, D15, D17]
7. 각 단계의 필수 산출물이 유효하면 재개 시 해당 단계를 건너뛴다. 필수 산출물이 없으면 가장 먼저 누락된 단계부터 실행한다. [D09]

## 게이트 조건

- G1: 서로 다른 사이트 레퍼런스 5개 이상. 각 레퍼런스에 URL, 레이아웃 구조, 분위기, 서비스 반영 후보가 모두 있어야 한다. [D10, D11]
- G2: 키스크린은 2~3개이고 각 프레임은 390×844다. MVP 제외 항목인 마켓 노출·구매·결제·정산·판매 중·판매 중지 상태는 없어야 한다. 판매 신청 허용 역할은 `seller`만이고 최종 검수 상태는 `approved`다. [D12, D13]
- G3: `docs/design.md` 기준 색상·타이포그래피·간격·모서리·컴포넌트 위반 수가 각각 0이어야 한다. [D15]
- 세부 실패 조건과 복귀 지점은 `harness/gates.md` 및 `harness/rules.json`을 따른다.

## 서비스 불변 기준

- 판매 신청은 `seller` 역할만 할 수 있다. [D13]
- MVP 1차에는 구매 흐름, 마켓 노출, 판매 중·판매 중지 상태, 결제, 정산을 포함하지 않는다. [D13]
- 화면 설계 단계에서 위 범위 위반을 검사하고, 위반이 있으면 G2를 통과시키지 않는다. [D13]

## 역할과 편집 경계

- `reference-researcher`는 `runs/{run_id}/01-reference/`만 편집한다. [D16]
- `screen-designer`는 `runs/{run_id}/02-screen-design/`만 편집한다. [D16]
- `design-builder`는 `runs/{run_id}/03-design/`만 편집한다. [D16]
- 읽기 전용 판정자는 산출물과 규칙 파일을 읽고 게이트 ID, `PASS`/`FAIL`, 실패 조건, 복귀 단계만 반환한다. [D17]
- 게이트 판정 결과와 실행 증거는 오케스트레이터가 `runs/{run_id}/validation-report.md`에 기록한다. [D19]

## 검증

- 판정 스크립트 회귀 검증 명령은 `npm test`다. 제출 전 실행 여부는 사용자의 요청에 따른다. [D19, D26]
- G1~G3 전체 통과 사례를 확인한다. [D19]
- 레퍼런스 수·필수 필드, 키스크린 수·크기·MVP 범위·역할·최종 검수 상태, 디자인 기준별 위반 사례를 각각 실패 입력으로 확인한다. [D19]
- 실패 시 지정된 단계로 돌아가고 다음 단계로 진행하지 않는지 확인한다. [D19]
- 재개 시 유효한 산출물은 건너뛰고 복귀 단계부터 시작하는지 확인한다. [D19]
- 판정자는 파일을 수정하지 않는다.
