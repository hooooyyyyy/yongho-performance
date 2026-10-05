import { createReportArchive } from './reportArchive.js'
import { coachReviewIsStale } from './workoutImport.js'
import { createLocalWorkoutRepository, sessionId, setId, sameContent } from './repositories/localWorkoutRepository.js'

export const repository = createLocalWorkoutRepository()
export const reportArchive = createReportArchive(repository)

export async function getDayLog(date, dayId, options = {}) {
  const rows = await repository.query('sets', 'by-date-day', IDBKeyRange.only([date, dayId]), options)
  return rows.sort((a, b) => (a.exerciseOrder ?? 0) - (b.exerciseOrder ?? 0) || (a.setIndex ?? 0) - (b.setIndex ?? 0))
}

export async function saveSet(entry) {
  const row = await repository.mutate('sets', setId(entry), (existing) => {
    const next = { ...existing, ...entry, id: existing?.id ?? setId(entry), deletedAt: null, setType: entry.setType ?? existing?.setType ?? 'work' }
    return existing && sameContent(existing, next) ? null : next
  })
  return row.id
}

export async function deleteSet(entry) {
  return repository.mutate('sets', setId(entry), (existing) => ({ ...entry, ...existing, deletedAt: new Date().toISOString() }))
}

export async function getPreviousExerciseLog(exerciseId, beforeDate) {
  const all = await repository.query('sets', 'by-exercise-date', IDBKeyRange.bound([exerciseId, '0000-00-00'], [exerciseId, beforeDate], false, true))
  const completed = all.filter((item) => item.completed)
  if (!completed.length) return []
  const lastDate = completed.reduce((latest, item) => (item.date > latest ? item.date : latest), '')
  return completed.filter((item) => item.date === lastDate).sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0))
}

export async function getWorkoutSession(date, dayId) {
  return repository.get('sessions', sessionId(date, dayId))
}

export async function getPreviousExerciseReview(exerciseId, beforeDate) {
  const [sessions, sets] = await Promise.all([repository.list('sessions'), repository.list('sets')])
  const session = sessions.filter((s) => s.date < beforeDate && s.status === 'completed' && s.coachReview?.nextActions?.some((a) => a.exerciseId === exerciseId)).sort((a, b) => b.date.localeCompare(a.date))[0]
  if (!session) return null
  const sourceSets = sets.filter((s) => s.completed && (s.sessionId ?? sessionId(s.date, s.dayId)) === session.id)
  const review = session.coachReview
  return { date: session.date, action: review.nextActions.find((a) => a.exerciseId === exerciseId), stale: coachReviewIsStale(session, sourceSets) }
}

export async function startWorkoutSession(date, dayOrId) {
  const dayId = typeof dayOrId === 'string' ? dayOrId : dayOrId.id
  return repository.mutate('sessions', sessionId(date, dayId), (existing) => {
    if (existing) return null
    return { date, dayId, status: 'started', startedAt: new Date().toISOString(),
      routineSnapshot: typeof dayOrId === 'string' ? null : structuredClone(dayOrId),
      restOverrides: {}, condition: {}, journal: '', exerciseNotes: {}, aiAnalysis: '' }
  })
}

function mergeSession(existing, date, dayId, patch) {
  const result = { status: 'started', startedAt: new Date().toISOString(), ...existing, ...patch, id: sessionId(date, dayId), date, dayId }
  for (const key of ['condition', 'restOverrides', 'exerciseNotes']) {
    if (patch[key]) result[key] = { ...existing?.[key], ...patch[key] }
  }
  if (typeof patch.journal === 'string' && patch.journal !== (existing?.journal ?? '')) {
    const prior = existing?.journalEntries ?? (existing?.journal ? [{ id: crypto.randomUUID(), text: existing.journal, source: 'legacy', createdAt: existing.updatedAt ?? existing.createdAt }] : [])
    result.journalEntries = [...prior, { id: crypto.randomUUID(), text: patch.journal, source: patch.journalSource ?? 'app', createdAt: new Date().toISOString() }]
  }
  return result
}

export async function updateWorkoutSession(date, dayId, patch) {
  return repository.mutate('sessions', sessionId(date, dayId), (existing) => {
    const next = mergeSession(existing, date, dayId, patch)
    return existing && sameContent(existing, next) ? null : next
  })
}

export async function completeWorkoutSession(date, dayId, patch = {}) {
  return repository.mutate('sessions', sessionId(date, dayId), (existing) => {
    const completedAt = existing?.completedAt ?? new Date().toISOString()
    const startedAt = existing?.startedAt ?? completedAt
    const durationSec = patch.durationSec ?? existing?.durationSec ?? Math.max(0, Math.round((new Date(completedAt) - new Date(startedAt)) / 1000))
    const next = { ...mergeSession(existing, date, dayId, patch), status: 'completed', startedAt, completedAt, durationSec, durationSource: patch.durationSource ?? existing?.durationSource ?? 'measured' }
    return existing && sameContent(existing, next) ? null : next
  })
}

export async function getWorkoutHistory({ includeStarted = false } = {}) {
  const [sessions, sets] = await Promise.all([repository.list('sessions', { includeDeleted: true }), repository.list('sets')])
  const deletedParents = new Set(sessions.filter((s) => s.deletedAt).map((s) => s.id))
  const completedSets = sets.filter((item) => item.completed && !deletedParents.has(item.sessionId ?? sessionId(item.date, item.dayId)))
  const setCounts = new Map()
  completedSets.forEach((item) => {
    const key = sessionId(item.date, item.dayId)
    setCounts.set(key, (setCounts.get(key) ?? 0) + 1)
  })

  const sessionMap = new Map()
  sessions.forEach((session) => {
    if (!session.deletedAt && (includeStarted || session.status === 'completed')) {
      sessionMap.set(session.id, { ...session, setCount: setCounts.get(session.id) ?? 0 })
    }
  })

  // 1차 버전 기록도 출석으로 보존한다.
  setCounts.forEach((setCount, id) => {
    const explicit = sessions.find((session) => session.id === id)
    if (!explicit && !sessionMap.has(id)) {
      const separator = id.indexOf(':')
      sessionMap.set(id, {
        id,
        date: id.slice(0, separator),
        dayId: id.slice(separator + 1),
        status: 'legacy',
        setCount,
      })
    }
  })

  return [...sessionMap.values()].sort((a, b) => (b.completedAt ?? b.date).localeCompare(a.completedAt ?? a.date))
}

export async function getAllCompletedSets() {
  const [sets, sessions] = await Promise.all([repository.list('sets'), repository.list('sessions', { includeDeleted: true })])
  const deletedParents = new Set(sessions.filter((s) => s.deletedAt).map((s) => s.id))
  return sets.filter((item) => item.completed && !deletedParents.has(item.sessionId ?? sessionId(item.date, item.dayId)))
}

export async function exportWorkoutData() {
  const { sessions, sets, reports, conflicts, meta } = await repository.snapshot()
  return { format: 'yongho-performance-backup', version: 3, exportedAt: new Date().toISOString(), sessions, sets, reports, conflicts, reportContexts: meta.filter((m) => m.key.startsWith('report-context:')).map((m) => m.context) }
}

export async function importWorkoutData(data) {
  if (data?.format !== 'yongho-performance-backup' || ![1, 2, 3].includes(data.version ?? 1) || !Array.isArray(data.sessions) || !Array.isArray(data.sets) || (data.conflicts && !Array.isArray(data.conflicts)) || (data.reports && !Array.isArray(data.reports)) || (data.reportContexts && !Array.isArray(data.reportContexts))) {
    throw new Error('YONGHO PERFORMANCE 백업 파일이 아닙니다.')
  }
  return repository.importRecords(data)
}
