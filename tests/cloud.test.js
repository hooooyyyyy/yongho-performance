import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalWorkoutRepository, recordKey } from '../src/lib/repositories/localWorkoutRepository.js'
import { createSyncEngine } from '../src/lib/sync/syncEngine.js'
import { createSyncController } from '../src/lib/cloud/syncController.js'

const base = { id: '2031-02-04:synthetic', date: '2031-02-04', dayId: 'synthetic', status: 'completed', journal: 'Synthetic journal' }
const makeLocal = () => createLocalWorkoutRepository({ name: crypto.randomUUID() })
const save = (local, patch = {}) => local.mutate('sessions', base.id, (r) => ({ ...base, ...r, ...patch }))
function makeRemote() {
  const rows = new Map(); let account = 'owner-a', writes = 0, beforeList
  return {
    rows, get writes() { return writes },
    setAccount(id) { account = id }, onList(fn) { beforeList = fn },
    async getAccountId() { return account },
    async list(expected) { assert.equal(expected, account); if (beforeList) { const fn = beforeList; beforeList = null; await fn() } return structuredClone([...rows.values()]) },
    async compareAndSwap({ kind, id, payload, expectedVersion, accountId }) {
      assert.equal(accountId, account)
      const key = recordKey(kind, id), prior = rows.get(key)
      if ((prior?.version ?? 0) !== expectedVersion) return { ok: false, record: prior }
      writes++; const record = { kind, id, payload: structuredClone(payload), version: expectedVersion + 1 }
      rows.set(key, record); return { ok: true, record }
    },
  }
}

test('sign-in and preview never upload; approval survives remount, logout keeps data and stops sends', async () => {
  const local = makeLocal(), remote = makeRemote()
  await save(local)
  const control = createSyncController({ local, remote })
  control.setUser({ id: 'owner-a' }); await control.sync()
  assert.equal(remote.writes, 0)
  await control.preview(); assert.equal(remote.writes, 0)
  await control.confirm(control.getState().plan)
  assert.equal(remote.writes, 1); assert.equal(control.getState().approved, true)
  control.dispose()
  const second = createSyncController({ local, remote })
  await save(local, { journal: 'Synthetic offline edit' })
  second.setUser({ id: 'owner-a' }); await second.sync()
  assert.equal(remote.writes, 2)
  second.setUser(null); await save(local, { journal: 'Synthetic signed-out edit' }); await second.sync()
  assert.equal(remote.writes, 2); assert.equal((await local.get('sessions', base.id)).journal, 'Synthetic signed-out edit')
  remote.setAccount('owner-b'); second.setUser({ id: 'owner-b' }); await second.preview()
  assert.match(second.getState().message, /다른 계정/); assert.equal(remote.writes, 2)
  second.dispose(); await local.close()
})

test('auth change or entering workout during network read prevents stale preview and writes', async () => {
  const local = makeLocal(), remote = makeRemote()
  await save(local)
  const control = createSyncController({ local, remote })
  control.setUser({ id: 'owner-a' })
  remote.onList(() => control.setUser(null)); await control.preview()
  assert.equal(remote.writes, 0); assert.equal(control.getState().user, null); assert.equal(control.getState().plan, null)
  control.setUser({ id: 'owner-a' }); remote.onList(() => control.setPaused(true)); await control.preview()
  assert.equal(control.getState().phase, 'paused'); assert.equal(control.getState().plan, null); assert.equal(remote.writes, 0)
  await control.confirm({ accountId: 'owner-a', actions: [] }); assert.equal(remote.writes, 0)
  control.dispose(); await local.close()
})

test('conflict resolution preserves both copies and rechecks device and server revisions', async () => {
  const a = makeLocal(), b = makeLocal(), remote = makeRemote()
  const first = createSyncEngine({ local: a, remote }), second = createSyncEngine({ local: b, remote })
  await save(a); await first.confirm(await first.preview()); await second.confirm(await second.preview())
  await save(a, { journal: 'Synthetic A' }); await save(b, { journal: 'Synthetic B' }); await first.confirm(await first.preview())
  const plan = await second.preview(), action = plan.actions[0]
  assert.equal(action.type, 'conflict')
  await second.resolve(plan, action, 'local')
  const preserved = (await b.snapshot()).conflicts[0]
  assert.equal(preserved.local.journal, 'Synthetic B'); assert.equal(preserved.incoming.journal, 'Synthetic A'); assert.equal(preserved.choice, 'local')
  await second.confirm(await second.preview())
  assert.equal(remote.rows.get(recordKey('sessions', base.id)).payload.journal, 'Synthetic B')
  await save(a, { journal: 'Synthetic A2' }); const stale = await first.preview()
  await save(b, { journal: 'Synthetic B2' }); await second.confirm(await second.preview())
  await assert.rejects(first.resolve(stale, stale.actions[0], 'incoming'), /サーバ|서버/)
  const fresh = await first.preview(); await save(a, { journal: 'Synthetic changed after review' })
  await assert.rejects(first.resolve(fresh, fresh.actions[0], 'incoming'), /기기 기록/)
  await a.close(); await b.close()
})

test('different IDs at the same set position require explicit review; all copies are retained', async () => {
  const a = makeLocal(), b = makeLocal(), remote = makeRemote()
  const set = { date: base.date, dayId: base.dayId, exerciseId: 'synthetic-press', setIndex: 0, reps: null, weight: 10, completed: true }
  await a.mutate('sets', 'device-a', () => ({ ...set, id: 'device-a' }))
  const first = createSyncEngine({ local: a, remote }); await first.confirm(await first.preview())
  const control = createSyncController({ local: b, remote }); control.setUser({ id: 'owner-a' })
  await control.preview(); await control.confirm(control.getState().plan)
  await b.mutate('sets', 'device-b', () => ({ ...set, id: 'device-b' }))
  const before = remote.writes; await control.sync()
  assert.equal(remote.writes, before); assert.equal(control.getState().plan.duplicateCandidates.length, 1)
  await control.confirm(control.getState().plan)
  assert.equal((await b.list('sets')).length, 2); assert.equal(remote.rows.size, 2)
  await control.sync(); assert.equal(control.getState().phase, 'synced')
  control.dispose(); await a.close(); await b.close()
})

test('offline sync keeps outbox and original data available', async () => {
  const local = makeLocal(), remote = makeRemote()
  await save(local)
  const control = createSyncController({ local, remote, online: () => false })
  control.setUser({ id: 'owner-a' }); await control.preview()
  assert.equal(control.getState().phase, 'offline'); assert.equal(remote.writes, 0); assert.equal((await local.snapshot()).outbox.length, 1)
  control.dispose(); await local.close()
})
