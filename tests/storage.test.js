import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalWorkoutRepository, sessionId } from '../src/lib/repositories/localWorkoutRepository.js'
import * as storage from '../src/lib/storage.js'

const date = '2030-01-03'
const dayId = 'sample-a'
const row = { date, dayId, exerciseId: 'sample-press', setIndex: 0, weight: 20, reps: null, rir: '', completed: true }
const repo = () => createLocalWorkoutRepository({ name: crypto.randomUUID() })

test('v3 migration preserves IDs, unknown fields, blank repetitions, snapshot and meta', async () => {
  const name = crypto.randomUUID()
  const old = await openDB(name, 3, { upgrade(db) {
    const sets = db.createObjectStore('sets', { keyPath: 'id' }); sets.createIndex('by-date-day', ['date', 'dayId']); sets.createIndex('by-exercise-date', ['exerciseId', 'date'])
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' }); sessions.createIndex('by-date', 'date'); sessions.createIndex('by-status', 'status')
    db.createObjectStore('meta', { keyPath: 'key' })
  } })
  const session = { id: sessionId(date, dayId), date, dayId, status: 'completed', journal: 'Synthetic training note', routineSnapshot: { exercises: [{ id: 'sample-press', sets: 2 }] }, condition: { score: 'sample' }, customField: [1, 2] }
  const set = { ...row, id: 'legacy-stable-id', updatedAt: '2030-01-03T12:00:00Z' }
  await old.put('sessions', session); await old.put('sets', set); await old.put('meta', { key: 'existing-marker', value: 7 }); old.close()
  const local = createLocalWorkoutRepository({ name })
  const snapshot = await local.snapshot()
  for (const [key, value] of Object.entries(session)) assert.deepEqual(snapshot.sessions[0][key], value)
  for (const [key, value] of Object.entries(set)) assert.deepEqual(snapshot.sets[0][key], value)
  assert.equal(snapshot.sets[0].sessionId, session.id)
  assert.equal(snapshot.outbox.length, 2)
  assert.equal(snapshot.meta[0].value, 7)
  await local.close()
  const reopened = createLocalWorkoutRepository({ name }); assert.deepEqual((await reopened.snapshot()).sets, snapshot.sets); await reopened.close()
})

test('atomic concurrent session updates preserve independent notes and stable creation time', async () => {
  await storage.startWorkoutSession(date, { id: dayId, exercises: [] })
  const before = await storage.getWorkoutSession(date, dayId)
  await Promise.all([
    storage.updateWorkoutSession(date, dayId, { exerciseNotes: { one: 'sample one' } }),
    storage.updateWorkoutSession(date, dayId, { exerciseNotes: { two: 'sample two' } }),
  ])
  const after = await storage.getWorkoutSession(date, dayId)
  assert.deepEqual(after.exerciseNotes, { one: 'sample one', two: 'sample two' })
  assert.equal(after.createdAt, before.createdAt); assert.notEqual(after.revision, before.revision)
  assert.deepEqual(after.routineSnapshot, before.routineSnapshot)
})

test('tombstones stay out of day logs, attendance and completed sets, and survive backup', async () => {
  await storage.saveSet(row)
  await storage.completeWorkoutSession(date, dayId, { durationSec: 100 })
  assert.equal((await storage.getDayLog(date, dayId)).length, 1)
  await storage.deleteSet(row)
  assert.equal((await storage.getDayLog(date, dayId)).length, 0)
  assert.equal((await storage.getAllCompletedSets()).length, 0)
  assert.equal((await storage.getWorkoutHistory())[0].setCount, 0)
  const backup = await storage.exportWorkoutData()
  assert.equal(backup.version, 2); assert.ok(backup.sets[0].deletedAt)
  await storage.saveSet(row)
  assert.equal((await storage.getDayLog(date, dayId))[0].reps, null)
})

test('backup import deduplicates v1, preserves conflicting versions and rolls back malformed data', async () => {
  const local = repo()
  const session = { id: sessionId(date, dayId), date, dayId, status: 'completed', journal: 'Synthetic original' }
  const data = { sessions: [session], sets: [{ ...row, id: 'example-set' }] }
  assert.equal((await local.importRecords(data)).imported, 2)
  assert.equal((await local.importRecords(data)).duplicates, 2)
  const conflict = await local.importRecords({ sessions: [{ ...session, journal: 'Synthetic different' }], sets: [] })
  assert.equal(conflict.conflicts, 1)
  const snapshot = await local.snapshot()
  assert.equal(snapshot.sessions[0].journal, session.journal)
  assert.equal(snapshot.conflicts[0].incoming.journal, 'Synthetic different')
  const target = repo(); await target.importRecords(snapshot)
  assert.equal((await target.snapshot()).conflicts.length, 1)
  await assert.rejects(local.importRecords({ sessions: [{ ...session, date: 'invalid' }], sets: [] }))
  assert.deepEqual(await local.snapshot(), snapshot)
  await assert.rejects(local.importRecords({ sessions: [], sets: [{ ...row, id: 'new-row' }], conflicts: [{ id: 'invalid' }] }))
  assert.deepEqual(await local.snapshot(), snapshot)
  await local.close(); await target.close()
})

test('legacy sets without sessions still appear in workout history', async () => {
  await storage.saveSet({ ...row, date: '2030-01-04' })
  const history = await storage.getWorkoutHistory()
  assert.equal(history.find((item) => item.date === '2030-01-04').status, 'legacy')
  assert.equal((await storage.getPreviousExerciseLog(row.exerciseId, '2030-01-05')).length, 1)
})

test('deleted defaults stay deleted after reopen and arbitrary legacy IDs remain stable', async () => {
  const { makeRows } = await import('../src/lib/sessionRows.js')
  const exercise = { sets: 2, targetWeight: 25, rir: '2' }
  const entry = { ...row, date: '2030-01-06', id: 'custom-stable-id' }
  await storage.saveSet(entry)
  await storage.deleteSet(entry)
  const all = await storage.getDayLog(entry.date, dayId, { includeDeleted: true })
  assert.equal(all[0].id, entry.id)
  assert.deepEqual(makeRows(exercise, all).map((item) => item.setIndex), [1])
  await storage.deleteSet({ ...row, date: entry.date, setIndex: 1, completed: false })
  assert.equal(makeRows(exercise, await storage.getDayLog(entry.date, dayId, { includeDeleted: true })).length, 0)
  await storage.saveSet({ ...entry, weight: 30 })
  assert.equal((await storage.getDayLog(entry.date, dayId)).length, 1)
  assert.equal((await storage.getDayLog(entry.date, dayId))[0].id, entry.id)
})
