import { normalizeRecord, sessionId, recordKey } from './repositories/localWorkoutRepository.js'

const lines = (value) => Array.isArray(value) && value.length <= 30 && value.every((x) => typeof x === 'string')
const sessionEvidence = (session) => JSON.stringify([session.journal, session.condition ?? {}, session.exerciseNotes ?? {}, session.durationSec ?? null])
export function coachReviewIsStale(session, sets) {
  const review = session.coachReview
  return !review || review.sourceSessionContent !== sessionEvidence(session) || review.sourceRevisions?.length !== sets.length || sets.some((s) => !review.sourceRevisions?.includes(s.revision))
}
export function validateWorkoutImport(data) {
  if (data?.format !== 'yongho-performance-workout' || data.version !== 1 || typeof data.requestId !== 'string' || !data.requestId || data.requestId.length > 120) throw new Error('GPT 운동기록 파일 형식을 확인해줘.')
  const session = normalizeRecord('sessions', data.session)
  if (!Number.isFinite(Date.parse(`${session.date}T00:00:00Z`)) || new Date(`${session.date}T00:00:00Z`).toISOString().slice(0, 10) !== session.date) throw new Error('운동 날짜를 확인해줘.')
  if (session.status !== 'completed' || typeof session.journal !== 'string' || !Array.isArray(data.sets) || !data.sets.length || data.sets.length > 200) throw new Error('완료한 운동과 원문·세트가 필요해.')
  if (session.condition && (typeof session.condition !== 'object' || Array.isArray(session.condition) || !Object.entries(session.condition).every(([key, value]) => key === 'sleepMinutes' ? value == null || (Number.isFinite(value) && value >= 0) : typeof value === 'string'))) throw new Error('컨디션 형식을 확인해줘.')
  if (session.exerciseNotes && (typeof session.exerciseNotes !== 'object' || Array.isArray(session.exerciseNotes) || !Object.values(session.exerciseNotes).every((value) => typeof value === 'string'))) throw new Error('운동별 메모 형식을 확인해줘.')
  if (session.durationSec != null && (!Number.isFinite(session.durationSec) || session.durationSec < 0 || !['estimated', 'reported', 'measured'].includes(session.durationSource))) throw new Error('운동시간과 기록 방식을 확인해줘.')
  const sets = data.sets.map((item) => {
    const row = normalizeRecord('sets', item)
    if (row.sessionId !== session.id || row.deletedAt || row.completed !== true || !['warmup', 'work', 'drop', 'test'].includes(row.setType)) throw new Error('세트 날짜·루틴·유형을 확인해줘.')
    for (const field of ['weight', 'reps']) if (row[field] != null && (!Number.isFinite(row[field]) || row[field] < 0 || (field === 'reps' && !Number.isInteger(row[field])))) throw new Error('중량·반복수는 숫자 또는 미기록이어야 해.')
    if (row.rir != null && !['string', 'number'].includes(typeof row.rir)) throw new Error('RIR 형식을 확인해줘.')
    if ((row.weightLabel != null && typeof row.weightLabel !== 'string') || (row.note != null && typeof row.note !== 'string')) throw new Error('세트 메모 형식을 확인해줘.')
    return row
  })
  if (new Set(sets.map((s) => s.id)).size !== sets.length || new Set(sets.map((s) => `${s.exerciseId}:${s.setIndex}`)).size !== sets.length) throw new Error('중복된 세트가 있어.')
  const analysis = session.coachReview
  if (analysis && (analysis.source !== 'gpt-chat' || typeof analysis.headline !== 'string' || !Number.isFinite(Date.parse(analysis.generatedAt)) || !lines(analysis.observations) || !lines(analysis.uncertainties) || !Array.isArray(analysis.nextActions) || analysis.nextActions.length > 20 || !analysis.nextActions.every((a) => typeof a.exerciseId === 'string' && typeof a.action === 'string' && typeof a.check === 'string' && typeof a.basis === 'string') || !['low', 'medium', 'high'].includes(analysis.confidence))) throw new Error('분석의 근거·체크 항목을 확인해줘.')
  return { ...data, session, sets }
}

const fingerprint = (session, sets) => JSON.stringify([session?.revision ?? null, sets.map((s) => [s.id, s.revision ?? null]).sort((a, b) => a[0].localeCompare(b[0]))])
export async function previewWorkoutImport(repository, input) {
  const data = validateWorkoutImport(input)
  const snapshot = await repository.snapshot()
  const existing = snapshot.sessions.find((s) => s.id === data.session.id)
  const sets = snapshot.sets.filter((s) => (s.sessionId ?? sessionId(s.date, s.dayId)) === data.session.id)
  return { data, payload: JSON.stringify(input), fingerprint: fingerprint(existing, sets), existing, previousCompleted: sets.filter((s) => !s.deletedAt && s.completed).length }
}

// The preview is an explicit replacement of ONE session, never a database reset.
// Preserve the old rows, and write all rows and sync outbox in one transaction.
export async function applyWorkoutImport(repository, preview) {
  const data = validateWorkoutImport(preview.data)
  const result = await repository.transaction(['sessions', 'sets', 'outbox', 'conflicts', 'meta'], 'readwrite', async (tx) => {
    const key = `workout-import:${data.requestId}`
    const prior = await tx.objectStore('meta').get(key)
    const payload = preview.payload
    if (typeof payload !== 'string') throw new Error('파일 미리보기가 필요해.')
    if (prior) {
      if (prior.payload !== payload) throw new Error('같은 가져오기 번호에 다른 내용이 있어. 새 파일을 요청해줘.')
      return { duplicate: true, count: data.sets.length }
    }
    const existing = await tx.objectStore('sessions').get(data.session.id)
    const oldSets = (await tx.objectStore('sets').getAll()).filter((s) => (s.sessionId ?? sessionId(s.date, s.dayId)) === data.session.id)
    if (preview.fingerprint !== fingerprint(existing, oldSets)) throw new Error('미리보기 이후 기록이 바뀌었어. 파일을 다시 선택해서 비교해줘.')
    const now = new Date().toISOString()
    const incomingIds = new Set(data.sets.map((s) => s.id))
    for (const s of data.sets) {
      const occupied = await tx.objectStore('sets').get(s.id)
      if (occupied && (occupied.sessionId ?? sessionId(occupied.date, occupied.dayId)) !== data.session.id) throw new Error('다른 날짜의 세트 ID와 겹쳐. 파일을 수정해줘.')
    }
    const journalEntries = [...(existing?.journalEntries ?? (existing?.journal ? [{ id: crypto.randomUUID(), text: existing.journal, source: 'legacy', createdAt: existing.updatedAt }] : []))]
    if (data.session.journal !== existing?.journal) journalEntries.push({ id: crypto.randomUUID(), text: data.session.journal, source: 'gpt-chat', createdAt: now })
    const session = { ...existing, ...data.session, deletedAt: null, journalEntries, coachChecks: {}, coachReview: data.session.coachReview ? { ...data.session.coachReview, sourceRevisions: [] } : null }
    const writes = [{ kind: 'sessions', next: session, old: existing }, ...data.sets.map((s) => ({ kind: 'sets', next: s, old: oldSets.find((o) => o.id === s.id) })), ...oldSets.filter((s) => !incomingIds.has(s.id) && !s.deletedAt).map((s) => ({ kind: 'sets', next: { ...s, deletedAt: now }, old: s }))]
    const prepared = writes.map(({ kind, next, old }) => ({ kind, old, row: normalizeRecord(kind, { ...next, createdAt: old?.createdAt ?? now, updatedAt: now, revision: crypto.randomUUID() }) }))
    if (session.coachReview) {
      prepared[0].row.coachReview.sourceRevisions = prepared.filter((w) => w.kind === 'sets' && !w.row.deletedAt).map((w) => w.row.revision)
      prepared[0].row.coachReview.sourceSessionContent = sessionEvidence(prepared[0].row)
    }
    for (const { kind, row, old } of prepared) {
      if (old) await tx.objectStore('conflicts').put({ id: crypto.randomUUID(), source: 'workout-import-before', kind, recordId: row.id, local: old, incoming: row, createdAt: now })
      await tx.objectStore(kind).put(row)
      await tx.objectStore('outbox').put({ key: recordKey(kind, row.id), kind, id: row.id, revision: row.revision })
    }
    await tx.objectStore('meta').put({ key, payload })
    return { duplicate: false, count: data.sets.length }
  })
  if (!result.duplicate) repository.notifyWrite()
  return result
}
