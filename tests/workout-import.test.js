import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalWorkoutRepository } from '../src/lib/repositories/localWorkoutRepository.js'
import { applyWorkoutImport, previewWorkoutImport, validateWorkoutImport } from '../src/lib/workoutImport.js'

const date = '2031-02-03', dayId = 'sample-a', id = `${date}:${dayId}`
const input = () => ({ format: 'yongho-performance-workout', version: 1, requestId: 'synthetic-import', session: { date, dayId, status: 'completed', journal: 'Synthetic note', durationSec: 600, durationSource: 'estimated', condition: {}, exerciseNotes: {}, coachReview: { source: 'gpt-chat', generatedAt: '2031-02-04T00:00:00Z', headline: 'Synthetic review', observations: ['Sample observation'], uncertainties: ['One session only'], confidence: 'low', nextActions: [{ exerciseId: 'sample-press', action: 'Compare next session', check: 'Record repetitions', basis: 'Synthetic evidence' }] } }, sets: [0, 1, 2].map((setIndex) => ({ id: `${id}:sample-press:${setIndex}`, date, dayId, exerciseId: 'sample-press', setIndex, weight: 20, reps: 10, rir: '', completed: true, setType: setIndex === 0 ? 'warmup' : 'work' })) })
const repo = () => createLocalWorkoutRepository({ name: crypto.randomUUID() })

test('session replacement is atomic, preserves prior copies and unrelated sessions, syncs tombstones, and repeated file is idempotent', async () => {
  const r = repo()
  await r.mutate('sessions', id, () => ({ date, dayId, status: 'started', journal: 'Old synthetic note', routineSnapshot: { id: dayId } }))
  await r.mutate('sets', `${id}:sample-press:0`, () => ({ ...input().sets[0], reps: 8 }))
  await r.mutate('sets', `${id}:sample-press:9`, () => ({ ...input().sets[0], id: `${id}:sample-press:9`, setIndex: 9 }))
  await r.mutate('sessions', '2031-02-05:sample-b', () => ({ date: '2031-02-05', dayId: 'sample-b', status: 'completed' }))
  const preview = await previewWorkoutImport(r, input())
  assert.equal(preview.previousCompleted, 2)
  await applyWorkoutImport(r, preview)
  const snapshot = await r.snapshot()
  assert.equal(snapshot.sessions.length, 2)
  assert.equal(snapshot.sets.filter((s) => !s.deletedAt).length, 3)
  assert.ok(snapshot.sets.find((s) => s.setIndex === 9).deletedAt)
  assert.equal(snapshot.conflicts.length, 3)
  assert.equal(snapshot.conflicts.find((c) => c.kind === 'sets' && c.local.setIndex === 0).local.reps, 8)
  const saved = await r.get('sessions', id)
  assert.deepEqual(saved.journalEntries.map((e) => e.text), ['Old synthetic note', 'Synthetic note'])
  assert.deepEqual(saved.routineSnapshot, { id: dayId })
  assert.equal(saved.coachReview.sourceRevisions.length, 3)
  assert.equal(snapshot.outbox.length, 6)
  assert.equal((await applyWorkoutImport(r, await previewWorkoutImport(r, input()))).duplicate, true)
  assert.equal((await r.snapshot()).conflicts.length, 3)
  await r.close()
})

test('changes after preview abort without partial writes; request ID reuse with different payload is rejected', async () => {
  const r = repo(), data = input()
  const preview = await previewWorkoutImport(r, data)
  await r.mutate('sessions', id, () => ({ date, dayId, journal: 'Concurrent edit' }))
  await assert.rejects(applyWorkoutImport(r, preview), /기록이 바뀌었어/)
  assert.equal((await r.list('sets')).length, 0)
  assert.equal((await r.snapshot()).conflicts.length, 0)
  await applyWorkoutImport(r, await previewWorkoutImport(r, data))
  const changed = structuredClone(data); changed.sets[0].reps = 9
  await assert.rejects(applyWorkoutImport(r, await previewWorkoutImport(r, changed)), /같은 가져오기 번호/)
  assert.equal((await r.get('sets', data.sets[0].id)).reps, 10)
  await r.close()
})

test('reject invalid cross-session, duplicate, and fabricated numeric fields before writing', () => {
  const data = input(); data.sets[1].date = '2031-02-04'
  assert.throws(() => validateWorkoutImport(data), /날짜/)
  const duplicate = input(); duplicate.sets[1] = duplicate.sets[0]
  assert.throws(() => validateWorkoutImport(duplicate), /중복/)
  const invalid = input(); invalid.sets[0].reps = 'ten'
  assert.throws(() => validateWorkoutImport(invalid), /숫자/)
})
