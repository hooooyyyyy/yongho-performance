import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDB } from 'idb'
import { createLocalWorkoutRepository } from '../src/lib/repositories/localWorkoutRepository.js'
import { createReportArchive, localWeeklyReport, summarizeWeek } from '../src/lib/reportArchive.js'
import { createWorkoutWrites } from '../src/lib/workoutWrites.js'
import * as storage from '../src/lib/storage.js'

const date = '2031-03-03'
const dayId = 'synthetic-a'
const id = `${date}:${dayId}`
const session = { id, date, dayId, status: 'completed', condition: { sleepMinutes: 420 } }
const local = () => createLocalWorkoutRepository({ name: crypto.randomUUID() })

test('v4 upgrade adds report store without changing records, pending writes or conflicts', async () => {
  const name = crypto.randomUUID()
  const old = await openDB(name, 4, { upgrade(db) { for (const kind of ['sessions', 'sets', 'conflicts']) db.createObjectStore(kind, { keyPath: 'id' }); for (const kind of ['meta', 'outbox']) db.createObjectStore(kind, { keyPath: 'key' }) } })
  await old.put('sessions', { ...session, revision: 'stable' })
  await old.put('outbox', { key: `sessions:${id}`, kind: 'sessions', id, revision: 'stable' })
  await old.put('conflicts', { id: 'conflict', local: 'synthetic', incoming: 'synthetic other' }); old.close()
  const repo = createLocalWorkoutRepository({ name }); const snapshot = await repo.snapshot()
  assert.deepEqual(snapshot.sessions, [{ ...session, revision: 'stable' }]); assert.equal(snapshot.outbox[0].revision, 'stable'); assert.equal(snapshot.conflicts.length, 1); assert.deepEqual(snapshot.reports, []); await repo.close()
})

test('archive preserves snapshots and versions; retry deduplicates, edits/additions mark old reports stale', async () => {
  const repo = local(); const archive = createReportArchive(repo)
  await repo.mutate('sessions', id, () => session)
  const context = await archive.prepare(date)
  const report = localWeeklyReport(context)
  const first = await archive.save({ contextId: context.contextId, requestId: 'request-one', report, analysisType: 'local-rules' })
  const retry = await archive.save({ contextId: context.contextId, requestId: 'request-one', report, analysisType: 'local-rules' })
  assert.equal(first.id, retry.id); assert.equal(first.version, 1); assert.equal((await archive.list())[0].stale, false)
  await assert.rejects(archive.save({ contextId: context.contextId, requestId: 'request-one', report: { ...report, headline: 'different' }, analysisType: 'local-rules' }), /다른 리포트/)
  await repo.mutate('sessions', id, (row) => ({ ...row, journal: 'Synthetic later edit' }))
  assert.equal((await archive.list())[0].stale, true)
  assert.equal((await archive.list())[0].sourceSnapshot.sessions[0].journal, undefined)
  const secondContext = await archive.prepare(date)
  const second = await archive.save({ contextId: secondContext.contextId, requestId: 'request-two', report: localWeeklyReport(secondContext), analysisType: 'local-rules' })
  assert.equal(second.version, 2); assert.equal((await archive.list())[0].stale, false)
  await repo.mutate('sets', 'new-set', () => ({ id: 'new-set', date, dayId, exerciseId: 'synthetic-press', setIndex: 0, reps: null, completed: true }))
  assert.equal((await archive.list())[0].stale, true)
  const copied = local(); await copied.importRecords(await repo.snapshot())
  assert.equal((await createReportArchive(copied).list()).length, 2)
  await copied.close(); await repo.close()
})

test('weekly counts include blank repetitions, separate set types, exclude started/deleted and deduplicate sleep days', () => {
  const snapshot = { sessions: [session, { ...session, id: `${date}:synthetic-b`, dayId: 'synthetic-b', condition: { sleepMinutes: 420 } }, { ...session, id: `${date}:started`, dayId: 'started', status: 'started' }], sets: ['work', 'warmup', 'drop', 'test'].map((setType, n) => ({ id: `set-${n}`, sessionId: id, date, dayId, completed: true, setType, reps: null, weight: null, rir: '' })) }
  snapshot.sets.push({ ...snapshot.sets[0], id: 'started-set', sessionId: `${date}:started`, dayId: 'started' }, { ...snapshot.sets[0], id: 'deleted-set', deletedAt: 'synthetic' })
  const summary = summarizeWeek(snapshot, { start: date, end: date })
  assert.equal(summary.sessionCount, 2); assert.deepEqual(summary.counts, { work: 1, warmup: 1, drop: 1, test: 1 }); assert.equal(summary.workMissingReps, 1); assert.equal(summary.sleepDays, 1); assert.equal(summary.averageSleep, 420); assert.equal(summary.rirCount, 0)
})

test('journal edits preserve original entries and unchanged completion preserves timestamps/revisions', async () => {
  await storage.startWorkoutSession(date, dayId)
  await storage.updateWorkoutSession(date, dayId, { journal: 'Synthetic original journal' })
  await storage.updateWorkoutSession(date, dayId, { journal: 'Synthetic revised journal' })
  const row = await storage.getWorkoutSession(date, dayId)
  assert.deepEqual(row.journalEntries.map((e) => e.text), ['Synthetic original journal', 'Synthetic revised journal'])
  await storage.completeWorkoutSession(date, dayId, { durationSec: 120 })
  const completed = await storage.getWorkoutSession(date, dayId)
  await storage.completeWorkoutSession(date, dayId, { durationSec: 120 })
  assert.deepEqual(await storage.getWorkoutSession(date, dayId), completed)
  const backup = await storage.exportWorkoutData(); assert.equal(backup.version, 3); assert.ok(Array.isArray(backup.reports))
  assert.equal((await storage.importWorkoutData(backup)).conflicts, 0)
})

test('serialized completion waits for blur then latest inputs; duplicate finish and failed flush never complete', async () => {
  const writes = createWorkoutWrites(); const calls = []
  let release
  const first = writes.enqueue(() => new Promise((resolve) => { release = () => { calls.push('blur'); resolve() } }))
  await Promise.resolve()
  const finishing = writes.finish(async () => { await writes.enqueue(() => { calls.push('latest') }) }, () => { calls.push('complete') })
  assert.equal(await writes.finish(() => {}, () => { calls.push('duplicate') }), false)
  release(); await first; await finishing
  assert.deepEqual(calls, ['blur', 'latest', 'complete'])
  await assert.rejects(writes.finish(() => { throw new Error('quota') }, () => { calls.push('bad-complete') }), /quota/)
  assert.ok(!calls.includes('bad-complete'))
})

test('restored contexts accept later GPT report and immutable report rejects edits', async () => {
  const repo = local(); const archive = createReportArchive(repo)
  await repo.mutate('sessions', id, () => session)
  const context = await archive.prepare(date)
  const copy = local()
  await copy.importRecords({ sessions: [], sets: [], reportContexts: [context] })
  const saved = await createReportArchive(copy).save({ contextId: context.contextId, requestId: 'restored-context', report: localWeeklyReport(context), analysisType: 'gpt' })
  await assert.rejects(copy.mutate('reports', saved.id, (r) => ({ ...r, report: { ...r.report, headline: 'changed' } })), /수정/)
  const snapshot = await copy.snapshot()
  await assert.rejects(copy.importRecords({ sessions: [], sets: [], reports: [{ ...saved, sourceSnapshot: null }] }))
  assert.deepEqual(await copy.snapshot(), snapshot)
  await repo.close(); await copy.close()
})

test('local directions distinguish missing repetitions, changed technique and test sets', async () => {
  const { buildExerciseInsights } = await import('../src/lib/insights.js')
  const routine = { days: [{ exercises: [{ id: 'synthetic-press', reps: '8–12', rir: '2' }] }] }
  const set = { id: 'synthetic-set', date, dayId, exerciseId: 'synthetic-press', setIndex: 0, completed: true, setType: 'work', weight: 23, reps: null, rir: '2' }
  assert.equal(buildExerciseInsights([session], [set], routine, {})[0].direction.label, '반복수 기록부터 확인')
  const note = { ...session, exerciseNotes: { 'synthetic-press': '가동범위 변경' } }
  assert.equal(buildExerciseInsights([note], [{ ...set, reps: 12 }], routine, {})[0].direction.label, '같은 수행 조건에서 다시 비교')
  assert.deepEqual(buildExerciseInsights([session], [{ ...set, reps: 12, setType: 'test' }], routine, {}), [])
})
