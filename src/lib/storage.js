import { openDB } from 'idb'

const DB_NAME = 'yongho-performance'
const SETS = 'sets'
const SESSIONS = 'sessions'

const dbPromise = openDB(DB_NAME, 2, {
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
  },
})

export async function getDayLog(date, dayId) {
  const db = await dbPromise
  return db.getAllFromIndex(SETS, 'by-date-day', IDBKeyRange.only([date, dayId]))
}

export async function saveSet(entry) {
  const db = await dbPromise
  const id = `${entry.date}:${entry.dayId}:${entry.exerciseId}:${entry.setIndex}`
  return db.put(SETS, { ...entry, id, updatedAt: new Date().toISOString() })
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
  return completed.filter((item) => item.date === lastDate).sort((a, b) => a.setIndex - b.setIndex)
}

export async function startWorkoutSession(date, dayId) {
  const db = await dbPromise
  const id = `${date}:${dayId}`
  const existing = await db.get(SESSIONS, id)
  if (existing?.status === 'completed') return existing
  const session = {
    ...existing,
    id,
    date,
    dayId,
    status: 'started',
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await db.put(SESSIONS, session)
  return session
}

export async function completeWorkoutSession(date, dayId) {
  const db = await dbPromise
  const id = `${date}:${dayId}`
  const existing = await db.get(SESSIONS, id)
  const session = {
    ...existing,
    id,
    date,
    dayId,
    status: 'completed',
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await db.put(SESSIONS, session)
  return session
}

export async function getWorkoutHistory() {
  const db = await dbPromise
  const [sessions, sets] = await Promise.all([db.getAll(SESSIONS), db.getAll(SETS)])
  const completedSets = sets.filter((item) => item.completed)
  const setCounts = new Map()
  completedSets.forEach((item) => {
    const key = `${item.date}:${item.dayId}`
    setCounts.set(key, (setCounts.get(key) ?? 0) + 1)
  })

  const sessionMap = new Map()
  sessions.forEach((session) => {
    if (session.status === 'completed') sessionMap.set(session.id, { ...session, setCount: setCounts.get(session.id) ?? 0 })
  })

  // 1차 버전의 기록에는 별도 완료 상태가 없으므로 기존 데이터도 출석으로 보존한다.
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

  return [...sessionMap.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export async function getAllCompletedSets() {
  const db = await dbPromise
  const sets = await db.getAll(SETS)
  return sets.filter((item) => item.completed)
}
