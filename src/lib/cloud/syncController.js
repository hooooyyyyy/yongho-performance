import { createSyncEngine } from '../sync/syncEngine.js'

const approvalKey = (id) => `sync-approved:${id}`
export function syncError(error) {
  if (['PGRST205', 'PGRST202', '42703'].includes(error.code)) return 'Supabase 기록 보관함 설정이 아직 필요해. 설정 안내의 SQL을 실행한 뒤 다시 확인해줘.'
  if (error.code === '42501') return '기록 보관함 접근 설정을 확인해야 해. 로컬 기록은 그대로 보존돼.'
  return error.message || '연결하지 못했어. 기기에 기록을 보존하고 다시 시도할게.'
}

// Auth state never authorizes upload by itself. Approval is local and scoped to one owner.
export function createSyncController({ local, remote, onState = () => {}, onChanged = () => {}, online = () => true, serialize = (work) => work() }) {
  let user = null, generation = 0, paused = false, disposed = false, running = null, timer, failures = 0
  let state = { phase: 'local', user: null, busy: false, approved: false, plan: null, message: '', lastSyncedAt: null }
  const emit = (patch) => { if (!disposed) { state = { ...state, ...patch }; onState(state) } }
  function cancelTimer() { clearTimeout(timer); timer = undefined }
  function schedule(delay = 1200) {
    cancelTimer()
    if (disposed || !user || paused) return
    timer = setTimeout(() => run('auto'), delay)
  }
  async function run(mode = 'auto', plan = null, action = null, choice = null) {
    if (disposed || !user || paused) return
    if (running) { await running; return run(mode, plan, action, choice) }
    if (!online()) { emit({ phase: 'offline', message: '오프라인 · 기록은 기기에 저장돼. 연결되면 다시 동기화할게.' }); return }
    cancelTimer()
    const token = generation, id = user.id
    const active = () => !disposed && !paused && generation === token && user?.id === id
    const engine = createSyncEngine({ local, remote, isActive: active })
    emit({ busy: true, message: '' })
    running = serialize(async () => {
      try {
        const snapshot = await local.snapshot()
        if (!active()) return
        const approval = snapshot.meta.find((m) => m.key === approvalKey(id))
        if (mode === 'auto' && !approval) { emit({ phase: 'review', approved: false, message: '이 기기의 기록과 계정 기록을 비교한 뒤 연결해줘.' }); return }
        if (mode === 'resolve') {
          await engine.resolve(plan, action, choice)
          if (!active()) return
          onChanged()
          emit({ plan: await engine.preview(), phase: 'review', message: '선택한 내용을 기기에 반영했어. 연결 내용을 다시 확인해줘.' })
          return
        }
        const current = mode === 'confirm' ? plan : await engine.preview()
        if (!active()) return
        const unreviewed = current.duplicateCandidates?.some((c) => !approval?.duplicateSignatures?.includes(c.signature))
        if (mode === 'preview' || (mode === 'auto' && ((current.counts.conflict ?? 0) > 0 || unreviewed))) {
          emit({ phase: 'review', plan: current, approved: Boolean(approval), message: current.counts.conflict ? '서로 다른 기록이 있어. 비교 후 사용할 내용을 선택해줘.' : unreviewed ? '같은 세트 번호에 다른 기록이 있어. 중복 후보를 확인해줘.' : '자동으로 덮어쓰지 않아. 아래 내용을 확인한 뒤 연결해줘.' })
          return
        }
        const result = await engine.confirm(current)
        if (!active()) return
        const approvedAt = approval?.approvedAt ?? new Date().toISOString()
        await local.transaction(['meta'], 'readwrite', async (tx) => {
          if (!active()) throw new Error('동기화가 중단됐습니다.')
          await tx.objectStore('meta').put({ key: approvalKey(id), accountId: id, approvedAt, duplicateSignatures: [...new Set([...(approval?.duplicateSignatures ?? []), ...(current.duplicateCandidates ?? []).map((c) => c.signature)])] })
        })
        failures = 0
        onChanged()
        emit({ phase: result.conflicts ? 'review' : 'synced', approved: true, plan: null, lastSyncedAt: new Date().toISOString(), message: result.conflicts ? '전송 중 충돌한 기록은 양쪽 모두 보존했어. 다시 비교해줘.' : result.pending ? '최근 수정한 기록을 이어서 전송할게.' : '이 기기와 계정 기록을 동기화했어.' })
        if (result.pending) schedule(1200)
      } catch (error) {
        if (!active()) return
        emit({ phase: 'error', plan: null, message: syncError(error) })
        if (mode === 'auto' && !['PGRST205', 'PGRST202', '42703', '42501'].includes(error.code)) schedule(Math.min(60000, 5000 * 2 ** failures++))
      } finally {
        if (active()) emit({ busy: false })
      }
    })
    try { await running } finally { running = null }
  }
  return {
    getState: () => state,
    setUser(next) {
      if (disposed) return
      if (user?.id === next?.id) { user = next; emit({ user }); return }
      generation++; cancelTimer(); user = next; failures = 0
      emit({ user, busy: false, approved: false, plan: null, phase: next ? 'review' : 'local', lastSyncedAt: null, message: next ? '처음 연결할 기록을 확인해줘.' : '로그아웃 상태 · 이 기기에 저장해.' })
      if (next) schedule(0)
    },
    setPaused(value) {
      if (paused === value) return
      paused = value; generation++; cancelTimer()
      emit({ busy: false, plan: null, phase: value && user ? 'paused' : user ? 'review' : 'local', message: value && user ? '운동 중에는 기기에 먼저 저장해. 운동 화면을 닫으면 동기화할게.' : '' })
      if (!value) schedule(0)
    },
    request: schedule,
    preview: () => run('preview'),
    confirm: (plan) => run('confirm', plan),
    resolve: (plan, action, choice) => run('resolve', plan, action, choice),
    sync: () => run('auto'),
    dispose() { generation++; disposed = true; cancelTimer() },
  }
}
