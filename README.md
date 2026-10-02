# YONGHO PERFORMANCE

개인용 운동 루틴·기록 PWA입니다. 아이폰 홈 화면에 설치해 오늘의 운동을 확인하고, 세트별 중량과 반복수를 빠르게 기록할 수 있습니다.

## 현재 기능

- Sustain Build Phase 2 주 4회 루틴
- 요일에 고정되지 않는 주 4회 루틴과 추천 배치
- 어느 날이든 원하는 루틴 바로 시작
- 세트별 중량·반복수 기록
- 지난 운동 기록 자동 표시
- 세트 완료 시 휴식 타이머 자동 시작
- 운동별 중량·자세·자극·웜업 팁
- 월간 운동 캘린더와 주·월 출석 횟수
- 날짜별 운동 회고·운동 메모·접힌 원문과 수정 이력
- 완료 전 입력 저장과 해당 날짜 캘린더 이동
- 주간 리포트 버전별 아카이브·근거 기록 보존
- 주간 본세트·웜업/드롭/테스트·수면·시간 집계와 최근 4주 분배
- GPT에 줄 기록 내보내기와 GPT 리포트 JSON 가져오기
- IndexedDB 기반 기기 내부 저장
- 오프라인 실행과 홈 화면 설치

## 로컬 실행

```bash
pnpm install
pnpm dev
```

## 루틴 수정 위치

- `src/data/routine.json`: 요일, 운동 순서, 세트, 반복수, RIR, 휴식
- `src/data/exercises.json`: 운동 이름, 자세, 자극, 웜업, 중량 팁

`main` 브랜치에 반영하면 GitHub Actions가 앱을 빌드해 GitHub Pages로 자동 배포합니다. 저장소의 Settings → Pages에서 Source를 **GitHub Actions**로 한 번 지정해야 합니다.


## 데이터 계층과 클라우드 준비

현재 로그인 없이 사용하는 로컬 앱을 유지하며 IndexedDB v3 기록을 v5로 보존 이전합니다. 백업은 v1/v2를 읽고 v3로 내보냅니다. 충돌한 기록을 자동으로 덮어쓰지 않습니다.

- [캘린더 회고·리포트·GPT 연결 경계와 사용법](docs/records-and-gpt.md)
- [데이터 스키마·이전·동기화 정책·Supabase 설정](docs/data-and-sync.md)
- [서버 측 AI 분석 인터페이스](docs/ai-server-interface.md)
- `supabase/migrations/202610020001_workout_sync.sql`: 비공개 테이블·RLS·버전 충돌 감지 RPC
- `supabase/tests/workout_rls.sql`: 두 계정·익명 접근 검증(롤백 fixture)

로그인/실제 클라우드 연결/AI 호출은 아직 활성화되지 않았습니다. Supabase 클라이언트를 주입하는 어댑터와 병합 미리보기·확인 엔진만 준비돼 있습니다. 공개 저장소에 개인 기록이나 서버 비밀키를 넣지 않습니다.

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

테스트는 익명 예시 데이터로 기존 DB 이전, 삭제·백업·동시 수정과 네트워크 실패를 검증합니다. PostgreSQL 테스트는 PGlite에서 Supabase Auth 역할을 재현해 실행하며, 실제 프로젝트 연결 뒤에도 해당 프로젝트에서 권한 검증이 필요합니다.
