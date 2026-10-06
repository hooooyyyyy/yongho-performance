# 다른 GPT 대화에서 운동 기록 읽기

앱 로그인·Supabase 동기화와 ChatGPT의 접근 승인은 별도다. 공개 앱 주소만으로 비공개 기록을 읽을 수 없으며, 같은 GPT 모델도 다른 대화의 로그인 세션이나 아이폰 IndexedDB를 공유하지 않는다.

## 현재 상태

앱에는 전체 로컬 기록 복사와 OAuth 승인 화면이 있다. 이 저장소에는 본인 계정의 루틴·세션·세트·원문·컨디션·주간 아카이브를 읽는 MCP Edge Function과 수동 배포 워크플로가 있다. **GitHub Pages 배포만으로 이 서버가 배포되는 것은 아니다.** 아래 Supabase 설정과 함수 배포, ChatGPT 연결이 모두 완료되어야 실제 자동 조회가 된다. OpenAI API 키는 필요 없다.

기록을 즉시 전달하려면 앱 → 계정과 동기화 → GPT에게 줄 전체 기록 복사 → 원하는 대화에 붙여넣기. 최신 계정 기록을 받으려면 먼저 동기화를 완료한다. 복사본은 해당 기기의 기록이므로 다른 기기에서 아직 업로드하지 않은 운동까지 포함한다고 단정하지 않는다.

## 1. Supabase 설정 (휴대폰 웹에서도 가능)

1. 본인 프로젝트 `pxrunholqojmaghssfpc`의 SQL Editor에서 `supabase/migrations/202610070001_gpt_read_only.sql`을 실행한다. 기존 첫 번째 마이그레이션은 다시 실행하지 않는다. 이 SQL은 데이터를 삭제하지 않고 OAuth 클라이언트의 기존 쓰기 RPC 우회를 차단한다. 일반 운동 앱 로그인은 그대로 기록·동기화 가능하다.
2. Authentication → JWT Signing Keys에서 ES256 또는 RS256 키를 사용 중인지 확인한다. 기존 키를 지우거나 바로 폐기하지 말고 Supabase의 키 교체 절차를 따른다. MCP middleware는 HS256을 허용하지 않는다.
3. Authentication → URL Configuration의 Site URL은 `https://hooooyyyyy.github.io/yongho-performance/`로 유지한다.
4. Authentication → OAuth Server에서 OAuth 2.1 Server를 활성화한다. Authorization Path는 `/`로 설정한다. GitHub Pages의 별도 경로 404를 피하도록 앱 루트가 `authorization_id` 쿼리를 받아 승인 화면을 연다. 실제 승인 이동 주소가 `https://hooooyyyyy.github.io/yongho-performance/?authorization_id=...`인지 확인한다. 공급자 설정이 origin 기준으로 합치는 경우 Authorization Path를 `/yongho-performance/`로 지정해 이 주소에 맞춘다.
5. Dynamic Client Registration을 활성화한다. 등록만으로 기록을 읽을 수는 없고 본인이 로그인하고 승인해야 한다. 사용하지 않는 OAuth 앱의 승인은 Supabase OAuth grant 관리 또는 ChatGPT 연결 해제로 철회한다.

## 2. 서버 배포 (GitHub 웹으로 가능)

1. Supabase 계정 설정 → Access Tokens에서 배포용 개인 토큰을 만든다. **채팅에 보내지 않는다.**
2. GitHub 저장소 → Settings → Secrets and variables → Actions → Secrets → New repository secret에 이름 `SUPABASE_ACCESS_TOKEN`, 값에 그 토큰을 넣는다. 기존 공개 Publishable key용 Variables와는 다르다.
3. Actions → **Deploy private GPT connection** → Run workflow → main에서 실행한다.
4. 성공 후 주소는 `https://pxrunholqojmaghssfpc.supabase.co/functions/v1/workout-mcp`이다. 로컬 CLI를 쓰면 `supabase functions deploy workout-mcp --project-ref pxrunholqojmaghssfpc --no-verify-jwt`로 동일하게 배포한다. gateway JWT 검사는 OAuth discovery를 통과시키기 위해 끄지만 **함수 내부에서 사용자 토큰을 검증한다.** 익명 공개 데이터 서버가 아니다.
5. 인증 없는 요청이 401 및 WWW-Authenticate metadata 주소를 반환하고, `/oauth-protected-resource`에 프로젝트 Auth issuer가 있는지 확인한다. MCP Inspector로 로그인·승인 → 도구 목록 → 본인 기록 조회를 검증한다. 로그인하지 않거나 다른 계정으로는 본인 기록을 얻을 수 없어야 한다.

이 워크플로는 SQL을 자동 실행하거나 프로젝트 Auth 설정을 덮어쓰지 않는다. 운영 SQL과 설정은 위 단계에서 직접 적용한다. service-role 키는 필요 없다.

## 3. ChatGPT 연결

ChatGPT **웹**의 맞춤 MCP 서버 연결 기능을 사용한다. 현재 공식 문서의 경로는 Plugins → + → Add custom MCP server이며, 환경에 따라 개발자 모드·설정에서 표시될 수 있다. 사용 중인 계정/워크스페이스에 기능이 없다면 모바일 앱에서 같은 메뉴가 있다고 가정하지 말고 웹에서 지원 여부를 확인한다.

이름은 `YONGHO PERFORMANCE`, Server URL은 위 함수 주소, 인증은 OAuth로 선택한다. Supabase의 Dynamic Client Registration을 사용하며 본인의 **운동 앱 계정**으로 로그인하고 표시된 요청 앱·돌아갈 주소를 확인한 뒤 내 기록 조회 허용을 누른다. 관리용 Supabase/GitHub 비밀번호를 운동 앱 로그인에 사용하지 않는다.

새 대화에서 `@`로 설치한 연결을 선택한 뒤 다음처럼 요청한다:

> YONGHO PERFORMANCE 연결로 지난 8주 운동 기록과 원문 일지, 현재 루틴을 읽어줘. 페이지가 더 있으면 끝까지 조회해줘. 수행 품질·회복·축구 일정을 함께 고려해서 이번 주 평가와 다음 행동 3개를 제안해줘. 미기록은 추측하지 말고, 루틴은 승인 없이 바꾸지 마.

연결은 사용자 계정/워크스페이스의 기능이다. 모든 GPT 대화·모바일 클라이언트·다른 사람의 GPT에 무조건 자동 접근이 생기는 것은 아니다. 연결을 사용할 수 있는 대화에서 선택해야 한다.

## 권한과 데이터 보존

서버 도구는 `read_week_plan`, `read_workout_history`, `read_training_summary`, `read_report_archive` 4개이며 모두 읽기 전용이다. 본인의 RLS 클라이언트로 조회하고 userId를 입력받거나 관리자 권한으로 읽지 않는다. 기록·원문은 공개 저장소와 에러 로그에 넣지 않는다. 요약은 로컬 규칙의 숫자 집계이며 AI 판단은 GPT가 원문을 읽고 별도로 한다.

조회는 안정적인 kind/id 순서와 nextOffset을 제공한다. 조회 중 다른 기기가 수정하면 페이지 간 최신 상태가 달라질 수 있으므로 시점이 중요한 분석은 동기화 완료 후 다시 조회한다. 10,000행을 넘는 요약은 incomplete로 표시하며 전체라고 주장하지 않는다. 서버는 아직 동기화되지 않은 아이폰 기록을 읽지 못한다.

OAuth 토큰을 통한 기존 write_workout_record RPC 호출도 SQL에서 거부한다. 기록 저장·분석 아카이브 저장·루틴 변경은 이 연결에서 수행하지 않는다. 다음 단계의 쓰기는 미리보기·명시 승인·원자적 저장·요청 중복 방지·충돌 보존을 먼저 구현해야 한다. 현재는 기존 JSON 가져오기 기능으로 기록 및 리포트를 보관한다.

IndexedDB 버전·백업 형식·루틴 구성은 바꾸지 않는다. 앱의 원래 로컬 기록·오프라인 저장·동기화는 계속 사용한다.

참고: https://developers.openai.com/api/docs/guides/custom-mcp-server · https://developers.openai.com/plugins/build/auth · https://supabase.com/docs/guides/ai-tools/byo-mcp · https://supabase.com/docs/guides/auth/oauth-server/getting-started
