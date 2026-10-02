# 서버 측 AI 분석 인터페이스 v1

이번 단계는 API 계약만 준비한다. 실제 함수 배포·AI 호출·AI 자동 분석 UI는 없다. 현재 리포트의 분석은 계속 로컬 규칙 기반이다.

`src/lib/analysisContract.js`는 주입된 인증 Supabase 클라이언트로 `analyze-workouts` 함수에 요청하며, JSON 출력 스키마를 제공한다. routine.json/기준 루틴/운동 기록을 수정하는 메서드는 없다.

## 요청

POST `/functions/v1/analyze-workouts`

Authorization: 사용자 access token. 본문: contractVersion=1, sessionIds(1~100개), from/to(4~8주 범위), soccerSchedule(선택).

userId나 전체 개인 기록을 브라우저에서 받아서 신뢰하지 않는다. 함수는 JWT를 검증해 UID를 얻고 그 사용자의 workout_records에서 세션·세트·최근 동일 운동·주간 볼륨을 읽는다. 다른 계정의 session ID나 삭제된 기록은 거부한다. 요청 범위·길이·이용 한도를 검증한다.

## 서버 처리 순서

1. 허용 origin과 OPTIONS를 처리한다. CORS는 인증의 대체 수단이 아니다.
2. Supabase Auth로 access token을 검증하고 UID를 확정한다.
3. 사용자 토큰이 있는 DB 클라이언트로 RLS를 적용해 입력을 읽는다. 분석 저장용 service-role 클라이언트는 서버 내부에서만 사용한다.
4. 데이터 없는 값은 unknown으로 유지한다. 빈 반복수/RIR을 임의 보충하지 않는다. 입력의 일지와 메모는 신뢰하지 않는 데이터로 표시하며 모델에게 지시로 수행하지 않게 한다.
5. 입력 revision 목록과 범위, 계약 버전을 보관한다. 같은 입력 재요청은 캐시/중복 방지한다.
6. 서버 secret OPENAI_API_KEY로 호출한다. 분석 지침에는 애슬레틱 체형·축구 퍼포먼스·회복·근거 우선순위를 적용한다. 수면 부족·복귀·수행 품질·불편감·축구 일정·하체 피로를 함께 검토한다.
7. `analysisOutputSchema`로 출력 검증 후 workout_analyses에 구조화된 result와 narrative를 함께 저장한다. 모델명·입력 revision도 저장하며 근거와 확신도를 표시한다.
8. 202는 pending ID, 200은 completed ID/결과, 오류는 코드(unauthenticated/invalid_request/quota_exceeded/provider_unavailable)를 반환한다. 원문 운동일지·토큰·키를 에러 로그에 남기지 않는다.

workout_analyses의 client 권한은 본인 SELECT만 허용한다. 생성·갱신은 UID 검증을 마친 서버가 담당한다. 오래된 입력 revision 분석은 UI에서 오래된 결과로 표시한다. 일지에 있는 축구 일정이 없으면 없는 것으로 단정하지 않는다.

## 출력

observations, progress, recoverySignals, nextSessionSuggestions, routineProposals, evidence, confidence(low/medium/high), narrative. 출처가 없는 연구 결과를 지어내지 않고 관찰과 추론을 분리한다.

AI 분석 → 제안 표시 → 사용자 명시 승인 → 별도 루틴 변경 흐름만 허용한다. 이 함수는 루틴 변경을 실행하지 않는다. 향후 루틴 수정 기능은 별도 endpoint/UI/변경 이력/명시 승인으로 만들고 공개 routine.json에 개인 건강 기록을 넣지 않는다.
