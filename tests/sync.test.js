import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalWorkoutRepository, recordKey } from '../src/lib/repositories/localWorkoutRepository.js'
import { createSyncEngine } from '../src/lib/sync/syncEngine.js'

const base = { id: '2030-02-01:sample-b', date: '2030-02-01', dayId: 'sample-b', status: 'completed', journal: 'Synthetic note' }
const localRepo = () => createLocalWorkoutRepository({ name: crypto.randomUUID() })
function mockRemote() {
  const rows = new Map(); let account = 'account-a'; let fail = false; let beforeWrite
  return {
    rows,
    setAccount(value) { account = value }, setFailure(value) { fail = value }, onWrite(callback) { beforeWrite = callback },
    async getAccountId() { return account },
    async list(accountId) { assert.equal(accountId, account); return structuredClone([...rows.values()]) },
    async compareAndSwap({ kind, id, payload, expectedVersion, accountId }) {
      assert.equal(accountId, account)
      if (fail) throw new Error('offline')
      if (beforeWrite) { const callback = beforeWrite; beforeWrite = null; await callback() }
      const key = recordKey(kind, id); const old = rows.get(key)
      if (old && JSON.stringify(old.payload) === JSON.stringify(payload)) return { ok: true, record: structuredClone(old) }
      if ((old?.version ?? 0) !== expectedVersion) return { ok: false, record: structuredClone(old) }
      const record = { kind, id, payload: structuredClone(payload), version: expectedVersion + 1 }
      rows.set(key, record); return { ok: true, record: structuredClone(record) }
    },
  }
}
async function save(local, patch = {}) { return local.mutate('sessions', base.id, (row) => ({ ...base, ...row, ...patch })) }

test('preview is read only, confirm uploads, second device downloads, then syncs tombstone', async () => {
  const a = localRepo(); const b = localRepo(); const remote = mockRemote()
  await save(a)
  const first = createSyncEngine({ local: a, remote }); const second = createSyncEngine({ local: b, remote })
  const before = await a.snapshot(); const preview = await first.preview()
  assert.equal(preview.counts.upload, 1); assert.deepEqual(await a.snapshot(), before); assert.equal(remote.rows.size, 0)
  assert.equal((await first.confirm(preview)).uploaded, 1)
  assert.equal((await a.snapshot()).outbox.length, 0)
  assert.equal((await second.confirm(await second.preview())).downloaded, 1)
  assert.equal((await b.get('sessions', base.id)).journal, base.journal)
  await save(a, { deletedAt: '2030-02-02T00:00:00Z' })
  await first.confirm(await first.preview()); await second.confirm(await second.preview())
  assert.equal(await b.get('sessions', base.id), undefined)
  assert.ok((await b.get('sessions', base.id, { includeDeleted: true })).deletedAt)
  await a.close(); await b.close()
})

test('offline failure and writes during transfer leave durable pending work', async () => {
  const local = localRepo(); const remote = mockRemote(); const engine = createSyncEngine({ local, remote })
  await save(local); remote.setFailure(true)
  await assert.rejects(engine.confirm(await engine.preview()), /offline/)
  assert.equal((await local.snapshot()).outbox.length, 1)
  remote.setFailure(false); remote.onWrite(() => save(local, { journal: 'Synthetic edit during transfer' }))
  assert.equal((await engine.confirm(await engine.preview())).pending, 1)
  assert.equal((await local.snapshot()).outbox.length, 1)
  await engine.confirm(await engine.preview())
  assert.equal(remote.rows.get(recordKey('sessions', base.id)).payload.journal, 'Synthetic edit during transfer')
  assert.equal((await local.snapshot()).outbox.length, 0)
  await local.close()
})

test('two-device concurrent edits preserve both copies instead of choosing by time', async () => {
  const a = localRepo(); const b = localRepo(); const remote = mockRemote()
  const first = createSyncEngine({ local: a, remote }); const second = createSyncEngine({ local: b, remote })
  await save(a); await first.confirm(await first.preview()); await second.confirm(await second.preview())
  await save(a, { journal: 'Synthetic device A' }); await save(b, { journal: 'Synthetic device B' })
  const stale = await second.preview(); await first.confirm(await first.preview())
  assert.equal((await second.confirm(stale)).conflicts, 1)
  const snapshot = await b.snapshot()
  assert.equal(snapshot.sessions[0].journal, 'Synthetic device B')
  assert.equal(snapshot.conflicts[0].incoming.journal, 'Synthetic device A')
  assert.equal(snapshot.outbox.length, 1)
  assert.equal((await second.preview()).counts.conflict, 1)
  await a.close(); await b.close()
})

test('edited previews and changed accounts are rejected without uploading records', async () => {
  const local = localRepo(); const remote = mockRemote(); const engine = createSyncEngine({ local, remote })
  await save(local); const preview = await engine.preview(); await save(local, { journal: 'Synthetic newer' })
  await assert.rejects(engine.confirm(preview), /기록이 바뀌/)
  assert.equal(remote.rows.size, 0)
  const fresh = await engine.preview(); remote.setAccount('account-b')
  await assert.rejects(engine.confirm(fresh), /계정이 변경/)
  remote.setAccount('account-a'); await engine.confirm(await engine.preview()); remote.setAccount('account-b')
  await assert.rejects(engine.preview(), /다른 계정/)
  await local.close()
})

test('initial duplicate and initial conflict do not overwrite local journals', async () => {
  const a = localRepo(); const b = localRepo(); const remote = mockRemote()
  const first = createSyncEngine({ local: a, remote }); const second = createSyncEngine({ local: b, remote })
  await save(a); await save(b); await first.confirm(await first.preview())
  assert.equal((await second.preview()).counts.duplicate, 1)
  await save(b, { journal: 'Synthetic initial conflict' })
  assert.equal((await second.preview()).counts.conflict, 1)
  await second.confirm(await second.preview())
  assert.equal((await b.get('sessions', base.id)).journal, 'Synthetic initial conflict')
  await a.close(); await b.close()
})
