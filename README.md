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
- 지난주 대비 최고 중량 변화 리포트
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
