import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@2.3.1'
import { pipeline } from 'npm:@supabase/middleware@1.0.0'
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@1.9.1'
import { z } from 'npm:zod@4.3.6'
import { readRecords, readSummary } from './queries.js'
import routine from '../../../src/data/routine.json' with { type: 'json' }
import exercises from '../../../src/data/exercises.json' with { type: 'json' }

const range = z.object({ from: z.string(), to: z.string(), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100) }).strict()
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
// No service-role key. Middleware validates user JWTs; every database read uses RLS.
Deno.serve(pipeline([withOAuthProtectedResource(), withSupabase({ auth: 'user', audience: 'authenticated', issuer: `${Deno.env.get('SUPABASE_URL')}/auth/v1` })], async (req, { supabase }) => {
  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: 'YONGHO PERFORMANCE', version: '1.0.0' })
    const register = (name: string, description: string, inputSchema: any, run: (args: any) => Promise<unknown>) => {
      server.registerTool(name, { description, inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: { securitySchemes: [{ type: 'oauth2', scopes: [] }] },
      }, async (args: any) => {
        try { return result(await run(args)) }
        catch { return { isError: true, content: [{ type: 'text' as const, text: '조회에 실패했어. 날짜 범위와 연결을 확인해줘. 실패한 조회를 근거로 기록이 없다고 판단하지 마.' }] } }
      })
    }
    register('read_week_plan', '현재 앱 기준 루틴과 운동 설명 조회. 추천 중량은 실제 수행 기록이 아니다. 평가와 변경 제안만 가능하며 이 도구는 루틴을 수정하지 않는다.', z.object({}).strict(), async () => ({ routine, exercises }))
    register('read_workout_history', '로그인한 본인의 날짜 범위별 세션·세트·원문 일지·운동별 메모·컨디션·리포트 해석 조회. nextOffset이 있으면 그 위치로 계속 조회한다. 빈 값은 추측하지 않는다.', range, (args) => readRecords(supabase, args))
    register('read_training_summary', '본인 동기화 기록의 숫자 집계. 평가 전에 같은 기간의 원문을 read_workout_history로 읽는다. incomplete가 true이면 전체 집계라고 말하지 않는다.', range, (args) => readSummary(supabase, args))
    register('read_report_archive', '본인의 보관된 주간 리포트 조회. from/to는 주 시작일 범위. 과거 리포트의 sourceSnapshot은 당시 기록이며 현재 기록과 다를 수 있다. nextOffset을 끝까지 조회한다.', range, (args) => readRecords(supabase, args, true))
    return server
  })
  return handler.fetch(req)
}))
