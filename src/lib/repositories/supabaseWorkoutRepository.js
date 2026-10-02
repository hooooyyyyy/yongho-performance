// Inject an authenticated Supabase client after configuring Auth. No client or network is created on import.
export function createSupabaseWorkoutRepository(client) {
  async function getAccountId() {
    const { data, error } = await client.auth.getUser()
    if (error) throw error
    return data.user?.id ?? null
  }
  return {
    getAccountId,
    async list(expectedAccountId) {
      const accountId = await getAccountId()
      if (!accountId || accountId !== expectedAccountId) throw new Error('로그인 계정이 변경됐습니다.')
      const { data: readiness, error: setupError } = await client.rpc('workout_sync_status')
      if (setupError) throw setupError
      if (!readiness?.ready || readiness.contractVersion !== 1) throw new Error('Supabase 기록 보관함의 비공개 접근 설정을 확인해주세요. 동기화를 중단했습니다.')
      const records = []
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('workout_records').select('kind,id,payload,version,report_version').eq('user_id', accountId).order('kind').order('id').range(offset, offset + 499)
        if (error) throw error
        records.push(...data.map(({ report_version, ...row }) => ({ ...row, reportVersion: report_version })))
        if (data.length < 500) return records
      }
    },
    async compareAndSwap({ kind, id, payload, expectedVersion, accountId }) {
      const { data, error } = await client.rpc('write_workout_record', { p_account_id: accountId, p_kind: kind, p_id: id, p_payload: payload, p_expected_version: expectedVersion })
      if (error) throw error
      return data
    },
  }
}
