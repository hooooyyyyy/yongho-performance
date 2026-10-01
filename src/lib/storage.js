import { openDB } from 'idb'

const DB_NAME = 'yongho-performance'
const SETS = 'sets'
const SESSIONS = 'sessions'
const META = 'meta'

const dbPromise = openDB(DB_NAME, 3, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const setStore = db.createObjectStore(SETS, { keyPath: 'id' })
      setStore.createIndex('by-date-day', ['date', 'dayId'])
      setStore.createIndex('by-exercise-date', ['exerciseId', 'date'])
    }
    if (oldVersion < 2) {
      const sessionStore = db.createObjectStore(SESSIONS, { keyPath: 'id' })
      sessionStore.createIndex('by-date', 'date')
      sessionStore.createIndex('by-status', 'status')
    }
    if (oldVersion < 3) db.createObjectStore(META, { keyPath: 'key' })
  },
})

function sessionId(date, dayId) {
  return `${date}:${dayId}`
}

function setId(entry) {
  return entry.id ?? `${entry.date}:${entry.dayId}:${entry.exerciseId}:${entry.setIndex}`
}

export async function getDayLog(date, dayId) {
  const db = await dbPromise
  const rows = await db.getAllFromIndex(SETS, 'by-date-day', IDBKeyRange.only([date, dayId]))
  return rows.sort((a, b) => (a.exerciseOrder ?? 0) - (b.exerciseOrder ?? 0) || (a.setIndex ?? 0) - (b.setIndex ?? 0))
}

export async function saveSet(entry) {
  const db = await dbPromise
  const id = setId(entry)
  const existing = await db.get(SETS, id)
  return db.put(SETS, {
    ...existing,
    ...entry,
    id,
    setType: entry.setType ?? existing?.setType ?? 'work',
    updatedAt: new Date().toISOString(),
  })
}

export async function deleteSet(entry) {
  const db = await dbPromise
  return db.delete(SETS, setId(entry))
}

export async function getPreviousExerciseLog(exerciseId, beforeDate) {
  const db = await dbPromise
  const all = await db.getAllFromIndex(
    SETS,
    'by-exercise-date',
    IDBKeyRange.bound([exerciseId, '0000-00-00'], [exerciseId, beforeDate], false, true),
  )
  const completed = all.filter((item) => item.completed)
  if (!completed.length) return []
  const lastDate = completed.reduce((latest, item) => (item.date > latest ? item.date : latest), '')
  return completed.filter((item) => item.date === lastDate).sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0))
}

export async function getWorkoutSession(date, dayId) {
  return (await dbPromise).get(SESSIONS, sessionId(date, dayId))
}

export async function startWorkoutSession(date, dayOrId) {
  const db = await dbPromise
  const dayId = typeof dayOrId === 'string' ? dayOrId : dayOrId.id
  const id = sessionId(date, dayId)
  const existing = await db.get(SESSIONS, id)
  if (existing) return existing
  const session = {
    id,
    date,
    dayId,
    status: 'started',
    startedAt: new Date().toISOString(),
    routineSnapshot: typeof dayOrId === 'string' ? null : JSON.parse(JSON.stringify(dayOrId)),
    restOverrides: {},
    condition: {},
    journal: '',
    exerciseNotes: {},
    aiAnalysis: '',
    updatedAt: new Date().toISOString(),
  }
  await db.put(SESSIONS, session)
  return session
}

export async function updateWorkoutSession(date, dayId, patch) {
  const db = await dbPromise
  const id = sessionId(date, dayId)
  const existing = await db.get(SESSIONS, id)
  const session = {
    id,
    date,
    dayId,
    status: existing?.status ?? 'started',
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
  await db.put(SESSIONS, session)
  return session
}

export async function completeWorkoutSession(date, dayId, patch = {}) {
  const db = await dbPromise
  const id = sessionId(date, dayId)
  const existing = await db.get(SESSIONS, id)
  const completedAt = new Date().toISOString()
  const startedAt = existing?.startedAt ?? completedAt
  const durationSec = patch.durationSec ?? existing?.durationSec ?? Math.max(0, Math.round((new Date(completedAt) - new Date(startedAt)) / 1000))
  const session = {
    id,
    date,
    dayId,
    ...existing,
    ...patch,
    status: 'completed',
    startedAt,
    completedAt,
    durationSec,
    updatedAt: completedAt,
  }
  await db.put(SESSIONS, session)
  return session
}

export async function getWorkoutHistory({ includeStarted = false } = {}) {
  const db = await dbPromise
  const [sessions, sets] = await Promise.all([db.getAll(SESSIONS), db.getAll(SETS)])
  const completedSets = sets.filter((item) => item.completed)
  const setCounts = new Map()
  completedSets.forEach((item) => {
    const key = sessionId(item.date, item.dayId)
    setCounts.set(key, (setCounts.get(key) ?? 0) + 1)
  })

  const sessionMap = new Map()
  sessions.forEach((session) => {
    if (includeStarted || session.status === 'completed') {
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
  const sets = await (await dbPromise).getAll(SETS)
  return sets.filter((item) => item.completed)
}

export async function exportWorkoutData() {
  const db = await dbPromise
  const [sessions, sets] = await Promise.all([db.getAll(SESSIONS), db.getAll(SETS)])
  return {
    format: 'yongho-performance-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    sets,
  }
}

export async function importWorkoutData(data) {
  if (data?.format !== 'yongho-performance-backup' || !Array.isArray(data.sessions) || !Array.isArray(data.sets)) {
    throw new Error('YONGHO PERFORMANCE 백업 파일이 아닙니다.')
  }
  const db = await dbPromise
  const tx = db.transaction([SESSIONS, SETS], 'readwrite')
  await Promise.all([
    ...data.sessions.map((session) => tx.objectStore(SESSIONS).put(session)),
    ...data.sets.map((set) => tx.objectStore(SETS).put(set)),
  ])
  await tx.done
  return { sessions: data.sessions.length, sets: data.sets.length }
}

export async function seedWorkoutSession(seed) {
  const db = await dbPromise
  const markerKey = `seed:${seed.version}`
  if (await db.get(META, markerKey)) return false

  const id = sessionId(seed.session.date, seed.session.dayId)
  const existing = await db.get(SESSIONS, id)
  const tx = db.transaction([SESSIONS, SETS, META], 'readwrite')
  if (!existing || existing.status !== 'completed') {
    await tx.objectStore(SESSIONS).put({ ...existing, ...seed.session, id, updatedAt: new Date().toISOString() })
    for (const set of seed.sets) {
      const entry = { ...set, date: seed.session.date, dayId: seed.session.dayId }
      await tx.objectStore(SETS).put({ ...entry, id: setId(entry), updatedAt: new Date().toISOString() })
    }
  }
  await tx.objectStore(META).put({ key: markerKey, seededAt: new Date().toISOString() })
  await tx.done
  return true
}
