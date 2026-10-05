# 대화에서 정리한 운동기록 가져오기

현재 일반 GPT 대화는 앱의 IndexedDB나 로그인한 Supabase 계정에 자동 접근하지 않는다. 계정 동기화와 대화 연결은 서로 다른 기능이다. 공개 URL·publishable key만으로 개인 기록을 읽거나 저장해서는 안 된다.

## 휴대폰 사용 흐름

1. GPT에 날짜, 루틴과 운동 경험을 말한다. 미확인 중량·반복수·RIR은 비워 둔다.
2. GPT가 세트와 메모, 관찰·다음 행동·확인 기준·불확실성을 정리한 아래 형식의 JSON 파일을 제공한다.
3. 파일을 저장하고 앱 → 기록 → GPT 운동기록 가져오기에서 선택한다.
4. 날짜·루틴·기존/새 완료 세트 수·각 세트·일지를 검토한 후 확인한다.
5. 캘린더에서 날짜를 눌러 실제 기록과 별도의 GPT 회고를 확인한다. 확인 체크는 수행 기록이나 기준 루틴을 변경하지 않는다.
6. 다음 날짜의 운동 화면에는 해당 운동의 최근 GPT 회고를 접힌 상태로 표시한다. 세트가 수정되면 이전 분석임을 표시한다.

## 데이터 계약 v1

```json
{
  "format": "yongho-performance-workout",
  "version": 1,
  "requestId": "unique-per-file",
  "session": {
    "date": "2031-02-03",
    "dayId": "upper-a",
    "status": "completed",
    "journal": "익명 예시 원문",
    "condition": {},
    "exerciseNotes": {},
    "durationSec": 600,
    "durationSource": "estimated",
    "coachReview": {
      "source": "gpt-chat",
      "generatedAt": "2031-02-04T00:00:00Z",
      "headline": "이번 기록에서 다음 비교 기준 만들기",
      "observations": ["관찰된 사실"],
      "nextActions": [{"exerciseId": "incline-smith", "action": "다음 행동", "check": "확인 기준", "basis": "원문 근거와 판단 이유"}],
      "uncertainties": ["한 번의 기록으로 장기 추세는 판단하지 않음"],
      "confidence": "low"
    }
  },
  "sets": [{"id": "2031-02-03:upper-a:incline-smith:0", "date": "2031-02-03", "dayId": "upper-a", "exerciseId": "incline-smith", "exerciseOrder": 0, "setIndex": 0, "setType": "work", "weight": 20, "weightLabel": "", "reps": 10, "rir": "", "completed": true, "note": ""}]
}
```

빈봉의 실제 무게를 모르면 weight:null, weightLabel:"빈봉"으로 둔다. 시간은 실제 시작·종료 시각을 지어내지 않고 durationSec와 estimated/reported 표시로 남긴다. 웜업·테스트 분류를 해석으로 정했으면 note와 uncertainties에 표시한다. 제안은 사실이 아니며 확신도와 근거를 함께 쓴다. 동일 파일 반복 입력은 requestId와 원본 payload로 중복 차단한다. 수정된 파일에는 새로운 requestId를 쓴다.

## 보존과 동기화

IndexedDB 버전과 기존 백업 형식은 그대로 유지한다. 미리보기 이후 세션·세트 revision이 바뀌면 중단한다. 승인한 한 세션의 세트 전체만 교체하고 제외된 기존 세트는 tombstone으로 남긴다. 수정 전 행들은 conflicts에 source:workout-import-before로 보존하며 전체 백업에 포함된다. 새 세트·세션·tombstone·outbox·중복방지 marker는 단일 트랜잭션이다. 원문 이력과 routineSnapshot은 보존한다. 저장 후 기존 동기화 정책에 따라 비공개 계정으로 전송한다. 로그인 없이도 가져오기가 가능하다. 다른 기기에서 동시에 편집한 경우 기존 CAS 충돌 검토 절차를 따른다.

일별 coachReview와 확인 체크는 세션에 포함되어 계정 동기화·백업·주간 리포트 입력 snapshot에 보존된다. 실제 기록을 수정하면 일별 분석은 과거 근거 기준으로 표시한다. 주간 리포트 가져오기·버전 보관 기능은 기존 방식을 유지한다. 개인 일지나 복구 파일을 이 공개 저장소에 넣지 않는다.

## 후속 직접 대화 연결

파일 선택을 없애려면 ChatGPT에서 접근 가능한 인증된 서버 도구와 사용자의 명시적인 계정 연결이 필요하다. 사용자별 토큰 검증, 날짜/루틴별 미리보기, 요청별 중복 방지, CAS와 원본 보존을 서버에서도 구현해야 한다. 서버 도구는 루틴 수정 권한을 별도로 분리하며 서비스 키·OpenAI 키는 서버에만 둔다. 이 변경에는 원격 대화 도구나 자동 AI 호출을 포함하지 않는다.
