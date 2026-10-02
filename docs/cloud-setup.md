# 내 운동 기록 연결하기

앱은 로그인 없이도 기기에 기록한다. 아래 설정은 여러 기기에서 같은 비공개 기록을 보기 위한 첫 설정이다. GPT 대화의 직접 저장·조회 연결은 별도 다음 단계다.

## 0. 공개용 키를 배포 설정에 추가

API 키를 공개 저장소에 커밋하지 않는 원칙에 따라, 전달한 Publishable key는 GitHub 배포 변수로 넣는다. URL은 코드에 연결했고 키는 커밋하지 않았다.

1. [GitHub → Settings → Secrets and variables → Actions → Variables](https://github.com/hooooyyyyy/yongho-performance/settings/variables/actions)를 연다.
2. **New repository variable**을 누른다.
3. Name은 `VITE_SUPABASE_PUBLISHABLE_KEY`, Value는 전달했던 **`sb_publishable_`로 시작하는 전체 공개용 키**를 넣고 Add variable을 누른다. Secret key/DB 비밀번호는 넣지 않는다.
4. [Deploy PWA to GitHub Pages](https://github.com/hooooyyyyy/yongho-performance/actions/workflows/deploy.yml)에서 **Run workflow → main → Run workflow**를 누른다. 완료되면 앱에 로그인 버튼이 활성화된다.

프로젝트 URL은 이미 설정되어 있으므로 별도 변수 없이 사용할 수 있다. 이후 프로젝트를 바꿀 때만 `VITE_SUPABASE_URL` 변수로 덮어쓸 수 있다.

## 1. 기록 보관함 만들기 — 처음 한 번

1. [내 Supabase 프로젝트의 SQL Editor](https://supabase.com/dashboard/project/pxrunholqojmaghssfpc/sql/new)를 연다.
2. [설정 SQL 원문](https://raw.githubusercontent.com/hooooyyyyy/yongho-performance/main/supabase/migrations/202610020001_workout_sync.sql)을 열어 **전체 복사**한다.
3. SQL Editor에 붙여 넣고 **Run**을 누른다. `Success. No rows returned`가 나오면 적용됐다.

이 SQL은 운동 기록·리포트 보관함과 계정별 접근 제한을 만든다. 실제 운동 기록이나 비밀번호는 포함하지 않는다. 새 프로젝트에 한 번만 실행한다. 이미 적용했다면 재실행하지 않는다. `already exists` 오류를 보고 테이블을 삭제하면 안 된다. 실패하면 오류 문구를 확인한다.

4. [접근 제한 확인 SQL](https://raw.githubusercontent.com/hooooyyyyy/yongho-performance/main/supabase/tests/workout_rls.sql)도 새 SQL 창에 전체 복사해 Run한다. 두 계정·익명 접근·동시 수정·리포트 보존을 확인하고, 테스트 기록은 마지막 `rollback`으로 모두 되돌린다. 성공하면 이 결과를 확인한다.

앱은 동기화 전에 비공개 접근 제한이 켜져 있고 직접 쓰기가 차단됐는지 서버에서 확인한다. 설정이 불완전하면 동기화를 멈추며 기기의 기록을 보존한다.

## 2. 이메일 인증이 돌아올 주소 설정

[Authentication → URL Configuration](https://supabase.com/dashboard/project/pxrunholqojmaghssfpc/auth/url-configuration)에서 아래 값을 설정하고 Save한다.

| 항목 | 값 |
| --- | --- |
| Site URL | `https://hooooyyyyy.github.io/yongho-performance/` |
| Redirect URLs에 추가 | `https://hooooyyyyy.github.io/yongho-performance/` |

이메일 로그인은 활성화하고 **Confirm email은 켜둔다.** 기본 메일 서비스는 Supabase 프로젝트 팀에 등록된 이메일로만 발송하며 시간당 발송 제한이 있다. 개인용 첫 연결은 **Supabase 가입에 사용한 이메일**로 진행한다. 다른 이메일을 쓰려면 별도 SMTP 설정이 필요하다. [공식 메일 설정 안내](https://supabase.com/docs/guides/auth/auth-smtp)

## 3. 아이폰의 기존 기록을 계정에 연결

1. 기존 기록이 있는 아이폰 홈 화면 앱을 열고 날짜별 기록이 그대로 보이는지 확인한다.
2. 오른쪽 위 **기기에 저장 → 계정과 동기화**를 연다.
3. **연결 전 JSON 백업 내려받기**로 사본을 저장한다.
4. **처음이라면 앱 계정 만들기**를 누른다. 위 이메일과 새 앱 비밀번호를 입력한다. Supabase 관리자 로그인과 별개의 앱 계정이며 DB 비밀번호를 입력하는 곳이 아니다.
5. 인증 메일을 확인한 뒤 아이폰 홈 화면 앱으로 돌아와 이메일·앱 비밀번호로 로그인한다. 메일 링크가 Safari를 열어도 홈 화면 앱에서 다시 로그인하면 된다.
6. **기기와 계정 기록 비교**에서 업로드·받기·중복·충돌 개수와 실제 내용을 확인한다.
7. 다른 내용은 사용할 쪽을 선택한다. 선택하지 않은 내용도 충돌 백업에 보존한다. 리포트 충돌은 두 사본을 별도로 보존한다.
8. **확인한 기록 연결 · 자동 동기화 켜기**를 누른다. 이 승인은 기기별로 한 번 필요하다.

다른 기기에서는 같은 앱 계정으로 로그인하고 비교 후 연결한다. 기존 기록을 내려받으며, 빈 기기가 계정 기록을 지우지 않는다. 다른 ID로 저장된 같은 세트 번호는 중복 후보로 표시하고 사용자가 확인하기 전 자동으로 합치지 않는다. 모두 보존하고 연결했다면 실제 중복인 세트만 해당 날짜에서 직접 삭제한다.

## 평소 사용

- 운동 중에는 기기에 먼저 저장한다. 운동 화면을 닫으면 동기화한다. 운동 화면이 열려 있는 동안 다른 기기의 변경을 내려받지 않는다.
- 온라인 상태에서 저장 후·앱 복귀·약 1분마다 연결된 계정을 확인한다. 아이폰 앱이 종료되거나 백그라운드에서 정지된 동안에는 전송을 보장하지 않는다. 앱을 다시 열면 이어서 전송한다.
- 연결이 끊겨도 기록을 계속 남길 수 있다. 실패한 전송은 기기에 보존하고 재시도한다.
- **지금 동기화**로 수동 확인할 수 있다. **동기화 완료**는 해당 조회 시점 기준이다.
- 로그아웃은 이 기기의 기록을 지우지 않는다. 한번 연결한 기록은 다른 계정으로 자동 전송할 수 없다. 현재는 개인 기기·한 계정 사용을 지원한다.
- 충돌을 시간만 보고 자동으로 덮어쓰지 않는다. 충돌 사본은 JSON 백업에도 남는다.
- 여러 기기에서 만든 리포트는 원본을 유지한다. 업로드 시 같은 주의 계정 공통 번호를 부여한다. 연결 전 번호는 **이 기기 번호**, 연결 후에는 **계정 공통 번호**로 표시한다.

브라우저에는 프로젝트 URL과 공개 Publishable key만 포함된다. API 키 자체는 GitHub 배포 변수에 두고 소스에 커밋하지 않는다. 개인 기록·로그인 토큰·비밀번호·서버 비밀키는 공개 저장소에 넣지 않는다. Publishable key는 프로젝트를 식별하며, 실제 기록 접근은 인증과 계정별 권한으로 제한한다. [공식 API key 안내](https://supabase.com/docs/guides/getting-started/api-keys)

GPT에서 직접 기록하려면 별도의 인증된 서버 도구 연결이 추가로 필요하다. 지금은 기록 화면의 주간 기록 내려받기·GPT 리포트 가져오기를 사용할 수 있다. 별도 OpenAI API 키는 이 연결에 필요하지 않다.
