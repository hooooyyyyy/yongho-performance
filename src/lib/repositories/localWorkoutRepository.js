import { validateReport } from '../reportSchema.js'
import { openDB } from 'idb'

export const DB_NAME = 'yongho-performance'
export const DB_VERSION = 5
export const recordKinds = ['sessions', 'sets', 'reports']
const kinds = recordKinds
export const recordKey = (kind, id) => `${kind}:${id}`
export const sessionId = (date, dayId) => `${date}:${dayId}`
export const setId = (row) => row.id ?? `${row.date}:${row.dayId}:${row.exerciseId}:${row.setIndex}`
const stamp = () => new Date().toISOString()
const revision = () => crypto.randomUUID()

export function normalizeRecord(kind, row) {
  if (!row || !kinds.includes(kind)) throw new Error('기록 형식이 올바르지 않습니다.')
  if (kind === 'reports') {
    if (typeof row.id !== 'string' || !row.id || !/^\d{4}-\d{2}-\d{2}$/.test(row.weekStart) || !/^\d{4}-\d{2}-\d{2}$/.test(row.weekEnd) || !Number.isInteger(row.version) || row.version < 1 || !row.sourceSnapshot || !Array.isArray(row.sourceSnapshot.sessions) || !Array.isArray(row.sourceSnapshot.sets) || typeof row.requestId !== 'string' || !row.requestId || !row.report || !['local-rules', 'gpt'].includes(row.analysisType)) throw new Error('리포트 형식이 올바르지 않습니다.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sourceFrom) || !Array.isArray(row.sourceRevisions) || !row.sourceRevisions.every((r) => typeof r === 'string') || !Number.isFinite(Date.parse(row.generatedAt)) || !Number.isFinite(Date.parse(row.dataCutoffAt)) || !['in-progress', 'closed'].includes(row.reportStatus)) throw new Error('리포트 근거와 시점 형식을 확인해주세요.')
    validateReport(row.report)
    const createdAt = row.createdAt ?? row.generatedAt ?? stamp()
    return { ...row, createdAt, updatedAt: row.updatedAt ?? createdAt, deletedAt: row.deletedAt ?? null, revision: row.revision ?? revision() }
  }
  const id = kind === 'sessions' ? sessionId(row.date, row.dayId) : setId(row)
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || typeof row.dayId !== 'string' || !row.dayId || typeof id !== 'string' || !id) throw new Error('기록 형식이 올바르지 않습니다.')
  if (kind === 'sessions' && row.id && row.id !== id) throw new Error('세션 ID가 날짜·루틴과 일치하지 않습니다.')
  if (kind === 'sets' && (typeof row.exerciseId !== 'string' || !Number.isInteger(row.setIndex) || row.setIndex < 0)) throw new Error('세트 형식이 올바르지 않습니다.')
  const createdAt = row.createdAt ?? row.startedAt ?? row.updatedAt ?? `${row.date}T00:00:00.000Z`
  return { ...row, id, ...(kind === 'sets' ? { sessionId: sessionId(row.date, row.dayId), setType: row.setType ?? 'work' } : {}), createdAt, updatedAt: row.updatedAt ?? createdAt, deletedAt: row.deletedAt ?? null, revision: row.revision ?? revision() }
}

export function createLocalWorkoutRepository({ name = DB_NAME } = {}) {
  const dbPromise = openDB(name, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        const store = db.createObjectStore('sets', { keyPath: 'id' })
        store.createIndex('by-date-day', ['date', 'dayId'])
        store.createIndex('by-exercise-date', ['exerciseId', 'date'])
      }
      if (oldVersion < 2) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' })
        store.createIndex('by-date', 'date')
        store.createIndex('by-status', 'status')
      }
      if (oldVersion < 3) db.createObjectStore('meta', { keyPath: 'key' })
      if (oldVersion < 4) {
        db.createObjectStore('outbox', { keyPath: 'key' })
        db.createObjectStore('conflicts', { keyPath: 'id' })
        // Add metadata in the same upgrade transaction. No records or indexes are removed.
        for (const kind of ['sessions', 'sets']) {
          const request = tx.objectStore(kind).openCursor()
          request.then(async function migrate(cursor) {
            if (!cursor) return
            const row = normalizeRecord(kind, cursor.value)
            await cursor.update(row)
            await tx.objectStore('outbox').put({ key: recordKey(kind, row.id), kind, id: row.id, revision: row.revision })
            return cursor.continue().then(migrate)
          }).catch(() => tx.abort())
        }
      }
      if (oldVersion < 5) {
        const reports = db.createObjectStore('reports', { keyPath: 'id' })
        reports.createIndex('by-week', 'weekStart')
        reports.createIndex('by-request', 'requestId')
      }
    },
    blocked() { globalThis.dispatchEvent?.(new Event('yp:storage-blocked')) },
    blocking() { dbPromise.then((db) => db.close()) },
  })
  async function transaction(stores, mode, work) {
    const db = await dbPromise
    const tx = db.transaction(stores, mode)
    try { const result = await work(tx); await tx.done; return result }
    catch (error) { try { tx.abort() } catch { /* already aborted */ } await tx.done.catch(() => {}); throw error }
  }
  const notifyWrite = () => globalThis.window?.dispatchEvent(new window.CustomEvent('yp:local-write'))
  return {
    async get(kind, id, { includeDeleted = false } = {}) {
      const row = await (await dbPromise).get(kind, id)
      return row && (includeDeleted || !row.deletedAt) ? row : undefined
    },
    async list(kind, { includeDeleted = false } = {}) {
      const rows = await (await dbPromise).getAll(kind)
      return includeDeleted ? rows : rows.filter((row) => !row.deletedAt)
    },
    async query(kind, index, range, { includeDeleted = false } = {}) {
      const rows = await (await dbPromise).getAllFromIndex(kind, index, range)
      return includeDeleted ? rows : rows.filter((row) => !row.deletedAt)
    },
    async mutate(kind, id, change) {
      let changed = false
      const result = await transaction([kind, 'outbox'], 'readwrite', async (tx) => {
        const existing = await tx.objectStore(kind).get(id)
        const next = change(existing)
        if (!next) return existing
        if (kind === 'reports' && existing && !sameContent(existing, next)) throw new Error('저장된 리포트는 수정할 수 없습니다. 새 버전을 저장해주세요.')
        const now = stamp()
        const row = normalizeRecord(kind, { ...next, id, createdAt: existing?.createdAt ?? now, updatedAt: now, revision: revision() })
        await tx.objectStore(kind).put(row)
        await tx.objectStore('outbox').put({ key: recordKey(kind, id), kind, id, revision: row.revision })
        changed = true
        return row
      })
      if (changed) notifyWrite()
      return result
    },
    async snapshot() {
      return transaction([...kinds, 'outbox', 'meta', 'conflicts'], 'readonly', async (tx) => {
        const [sessions, sets, reports, outbox, meta, conflicts] = await Promise.all([...kinds, 'outbox', 'meta', 'conflicts'].map((kind) => tx.objectStore(kind).getAll()))
        return { sessions, sets, reports, outbox, meta, conflicts }
      })
    },
    async importRecords(data) {
      const rows = kinds.flatMap((kind) => (data[kind] ?? []).map((row) => ({ kind, row: normalizeRecord(kind, row) })))
      const keys = rows.map(({ kind, row }) => recordKey(kind, row.id))
      if (new Set(keys).size !== keys.length) throw new Error('백업에 중복된 ID가 있습니다.')
      const result = await transaction([...kinds, 'outbox', 'conflicts', 'meta'], 'readwrite', async (tx) => {
        let imported = 0; let duplicates = 0; let conflicts = 0
        for (const { kind, row } of rows) {
          const existing = await tx.objectStore(kind).get(row.id)
          if (existing && sameContent(existing, row)) { duplicates++; continue }
          if (existing) {
            await tx.objectStore('conflicts').put({ id: revision(), source: 'backup', kind, recordId: row.id, local: existing, incoming: row, createdAt: stamp() })
            conflicts++; continue
          }
          const saved = row
          await tx.objectStore(kind).put(saved)
          await tx.objectStore('outbox').put({ key: recordKey(kind, row.id), kind, id: row.id, revision: saved.revision })
          imported++
        }
        for (const conflict of data.conflicts ?? []) {
          if (!conflict || typeof conflict.id !== 'string' || !kinds.includes(conflict.kind) || !conflict.local || !conflict.incoming) throw new Error('충돌 백업 형식이 올바르지 않습니다.')
          // Never overwrite an already preserved conflict.
          if (!await tx.objectStore('conflicts').get(conflict.id)) await tx.objectStore('conflicts').put(conflict)
        }
        for (const context of data.reportContexts ?? []) {
          if (typeof context?.contextId !== 'string' || !context.contextId || !Array.isArray(context.sourceSnapshot?.sessions) || !Array.isArray(context.sourceSnapshot?.sets)) throw new Error('리포트 입력 백업 형식이 올바르지 않습니다.')
          const key = `report-context:${context.contextId}`
          const existing = await tx.objectStore('meta').get(key)
          if (!existing) await tx.objectStore('meta').put({ key, context })
        }
        return { sessions: data.sessions.length, sets: data.sets.length, imported, duplicates, conflicts }
      })
      if (result.imported) notifyWrite()
      return result
    },
    transaction,
    notifyWrite,
    async close() { (await dbPromise).close() },
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  return value
}
export function sameContent(a, b) {
  const clean = ({ revision, createdAt, updatedAt, ...row }) => row
  return JSON.stringify(canonical(clean(a))) === JSON.stringify(canonical(clean(b)))
}
