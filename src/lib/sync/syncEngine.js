import { recordKey, sameContent, normalizeRecord } from '../repositories/localWorkoutRepository.js'

const baselineKey = (accountId, key) => `sync:${accountId}:${key}`
const ownerKey = 'sync:owner'
const now = () => new Date().toISOString()

// No timestamps decide a winner. CAS versions and local revision tokens detect concurrent edits.
export function createSyncEngine({ local, remote }) {
  async function account() {
    const id = await remote.getAccountId()
    if (!id) throw new Error('동기화하려면 로그인이 필요합니다.')
    const { meta } = await local.snapshot()
    const owner = meta.find((item) => item.key === ownerKey)?.accountId
    if (owner && owner !== id) throw new Error('이 기기의 기록은 다른 계정에 연결돼 있습니다. 계정별 저장 공간을 준비한 후 전환할 수 있습니다.')
    return id
  }
  return {
    async preview() {
      const accountId = await account()
      const incoming = await remote.list(accountId)
      for (const record of incoming) {
        if (!['sessions', 'sets'].includes(record.kind) || record.payload?.id !== record.id || !Number.isInteger(record.version) || record.version < 1) throw new Error('서버 기록 형식이 올바르지 않습니다.')
        normalizeRecord(record.kind, record.payload)
      }
      const snapshot = await local.snapshot()
      const queued = new Map(snapshot.outbox.map((item) => [item.key, item]))
      const bases = new Map(snapshot.meta.map((item) => [item.key, item.version]))
      const cloud = new Map(incoming.map((item) => [recordKey(item.kind, item.id), item]))
      const actions = []
      for (const kind of ['sessions', 'sets']) {
        for (const row of snapshot[kind]) {
          const key = recordKey(kind, row.id)
          const other = cloud.get(key)
          const baseVersion = bases.get(baselineKey(accountId, key)) ?? 0
          let type
          if (other && sameContent(row, other.payload)) type = 'duplicate'
          else if (other && queued.has(key) && other.version !== baseVersion) type = 'conflict'
          else if (queued.has(key) || !other) type = 'upload'
          else type = 'download'
          actions.push({ type, kind, id: row.id, local: row, incoming: other ?? null, expectedVersion: baseVersion })
          cloud.delete(key)
        }
      }
      for (const other of cloud.values()) actions.push({ type: 'download', kind: other.kind, id: other.id, local: null, incoming: other })
      return { accountId, createdAt: now(), actions, counts: actions.reduce((sum, item) => ({ ...sum, [item.type]: (sum[item.type] ?? 0) + 1 }), {}) }
    },
    // Call only after the user reviews preview counts and conflict records. No automatic adoption.
    async confirm(plan) {
      const accountId = await account()
      if (plan.accountId !== accountId) throw new Error('계정이 변경됐습니다. 병합 내용을 다시 확인해주세요.')
      await local.transaction(['sessions', 'sets', 'meta'], 'readwrite', async (tx) => {
        const owner = await tx.objectStore('meta').get(ownerKey)
        if (owner && owner.accountId !== accountId) throw new Error('기기에 연결된 계정이 변경됐습니다.')
        for (const action of plan.actions) {
          const current = await tx.objectStore(action.kind).get(action.id)
          if ((current?.revision ?? null) !== (action.local?.revision ?? null)) throw new Error('미리보기 이후 기록이 바뀌었습니다. 병합 내용을 다시 확인해주세요.')
        }
        await tx.objectStore('meta').put({ key: ownerKey, accountId })
      })
      const result = { uploaded: 0, downloaded: 0, duplicates: 0, conflicts: 0, pending: 0 }
      for (const action of plan.actions) {
        const key = recordKey(action.kind, action.id)
        let other = action.incoming
        if (action.type === 'upload') {
          const response = await remote.compareAndSwap({ kind: action.kind, id: action.id, payload: action.local, expectedVersion: action.expectedVersion, accountId })
          if (!response.ok) {
            await preserveConflict(action, response.record, accountId)
            result.conflicts++; continue
          }
          other = response.record
        }
        if (action.type === 'conflict') {
          await preserveConflict(action, other, accountId)
          result.conflicts++; continue
        }
        await local.transaction([action.kind, 'outbox', 'meta'], 'readwrite', async (tx) => {
          const current = await tx.objectStore(action.kind).get(action.id)
          // A local edit may arrive while awaiting the network. Leave its outbox intact.
          if ((current?.revision ?? null) !== (action.local?.revision ?? null)) {
            if (action.type === 'upload') await tx.objectStore('meta').put({ key: baselineKey(accountId, key), version: other.version })
            result.pending++; return
          }
          if (action.type === 'download') {
            await tx.objectStore(action.kind).put(normalizeRecord(action.kind, other.payload))
            result.downloaded++
          } else if (action.type === 'upload') result.uploaded++
          else result.duplicates++
          await tx.objectStore('meta').put({ key: baselineKey(accountId, key), version: other.version })
          await tx.objectStore('outbox').delete(key)
        })
      }
      return result
    },
  }
  async function preserveConflict(action, incoming, accountId) {
    await local.transaction([action.kind, 'conflicts'], 'readwrite', async (tx) => {
      const current = await tx.objectStore(action.kind).get(action.id)
      await tx.objectStore('conflicts').put({ id: `sync:${accountId}:${action.kind}:${action.id}:${current?.revision ?? action.local?.revision}:${incoming?.version ?? 0}`, source: 'sync', accountId, kind: action.kind, recordId: action.id, local: current ?? action.local, incoming: incoming?.payload ?? null, remoteVersion: incoming?.version ?? 0, createdAt: now() })
    })
  }
}
