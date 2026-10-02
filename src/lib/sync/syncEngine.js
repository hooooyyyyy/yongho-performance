import { recordKey, sameContent, normalizeRecord, recordKinds } from '../repositories/localWorkoutRepository.js'

const baselineKey = (accountId, key) => `sync:${accountId}:${key}`
const ownerKey = 'sync:owner'
const now = () => new Date().toISOString()

// No timestamps decide a winner. CAS versions and local revision tokens detect concurrent edits.
export function createSyncEngine({ local, remote, isActive = () => true }) {
  function guard() { if (!isActive()) throw new Error('동기화가 중단됐습니다.') }
  async function account() {
    guard()
    const id = await remote.getAccountId()
    guard()
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
      guard()
      for (const record of incoming) {
        if (!recordKinds.includes(record.kind) || record.payload?.id !== record.id || !Number.isInteger(record.version) || record.version < 1) throw new Error('서버 기록 형식이 올바르지 않습니다.')
        normalizeRecord(record.kind, record.payload)
      }
      const snapshot = await local.snapshot()
      const queued = new Map(snapshot.outbox.map((item) => [item.key, item]))
      const bases = new Map(snapshot.meta.map((item) => [item.key, item.version]))
      const cloud = new Map(incoming.map((item) => [recordKey(item.kind, item.id), item]))
      const actions = []
      for (const kind of recordKinds) {
        for (const row of snapshot[kind]) {
          const key = recordKey(kind, row.id)
          const other = cloud.get(key)
          const baseVersion = bases.get(baselineKey(accountId, key)) ?? 0
          let type
          if (other && sameContent(row, other.payload)) type = 'duplicate'
          else if (other && (kind === 'reports' || queued.has(key)) && other.version !== baseVersion) type = 'conflict'
          else if (queued.has(key) || !other) type = 'upload'
          else type = 'download'
          actions.push({ type, kind, id: row.id, local: row, incoming: other ?? null, expectedVersion: baseVersion })
          cloud.delete(key)
        }
      }
      for (const other of cloud.values()) actions.push({ type: 'download', kind: other.kind, id: other.id, local: null, incoming: other })
      const logicalSets = new Map()
      for (const row of [...snapshot.sets, ...incoming.filter((r) => r.kind === 'sets').map((r) => r.payload)]) {
        if (row.deletedAt) continue
        const key = `${row.date}:${row.dayId}:${row.exerciseId}:${row.setIndex}`
        if (!logicalSets.has(key)) logicalSets.set(key, new Map())
        logicalSets.get(key).set(row.id, row)
      }
      const duplicateCandidates = [...logicalSets.entries()].filter(([, rows]) => rows.size > 1).map(([key, rows]) => ({ key, signature: JSON.stringify([...rows.keys()].sort()), rows: [...rows.values()] }))
      return { accountId, createdAt: now(), actions, duplicateCandidates, counts: actions.reduce((sum, item) => ({ ...sum, [item.type]: (sum[item.type] ?? 0) + 1 }), {}) }
    },
    // Call only after the user reviews preview counts and conflict records. No automatic adoption.
    async confirm(plan) {
      const accountId = await account()
      if (plan.accountId !== accountId) throw new Error('계정이 변경됐습니다. 병합 내용을 다시 확인해주세요.')
      await local.transaction([...recordKinds, 'meta'], 'readwrite', async (tx) => {
        guard()
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
        guard()
        const key = recordKey(action.kind, action.id)
        let other = action.incoming
        if (action.type === 'upload') {
          const response = await remote.compareAndSwap({ kind: action.kind, id: action.id, payload: action.local, expectedVersion: action.expectedVersion, accountId })
          guard()
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
          guard()
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
          if (action.kind === 'reports' && Number.isInteger(other.reportVersion)) await tx.objectStore('meta').put({ key: `sync-report-version:${action.id}`, version: other.reportVersion })
          await tx.objectStore('outbox').delete(key)
        })
      }
      return result
    },
    async resolve(plan, action, choice) {
      if (!['local', 'incoming'].includes(choice) || action.type !== 'conflict' || !action.incoming || !action.local) throw new Error('해결할 충돌을 다시 확인해주세요.')
      const accountId = await account()
      if (plan.accountId !== accountId) throw new Error('계정이 변경됐습니다.')
      const remoteRows = await remote.list(accountId)
      guard()
      const latest = remoteRows.find((r) => r.kind === action.kind && r.id === action.id)
      if (!latest || latest.version !== action.incoming.version || !sameContent(latest.payload, action.incoming.payload)) throw new Error('서버 기록이 바뀌었습니다. 다시 비교해주세요.')
      await local.transaction([action.kind, 'outbox', 'meta', 'conflicts'], 'readwrite', async (tx) => {
        guard()
        const current = await tx.objectStore(action.kind).get(action.id)
        if (current?.revision !== action.local.revision) throw new Error('기기 기록이 바뀌었습니다. 다시 비교해주세요.')
        const owner = await tx.objectStore('meta').get(ownerKey)
        if (owner && owner.accountId !== accountId) throw new Error('연결된 계정이 변경됐습니다.')
        await tx.objectStore('meta').put({ key: ownerKey, accountId })
        await tx.objectStore('conflicts').put({ id: crypto.randomUUID(), source: 'sync', accountId, kind: action.kind, recordId: action.id, local: current, incoming: latest.payload, remoteVersion: latest.version, choice, resolvedAt: now(), createdAt: now() })
        // A divergent immutable report is preserved under a new ID; its contents stay unchanged.
        if (action.kind === 'reports') {
          const id = crypto.randomUUID()
          const copy = { ...current, id, requestId: `conflict-copy:${id}`, revision: crypto.randomUUID(), conflictOf: current.id }
          await tx.objectStore('reports').put(copy)
          await tx.objectStore('outbox').put({ key: recordKey('reports', id), kind: 'reports', id, revision: copy.revision })
        }
        const useIncoming = choice === 'incoming' || action.kind === 'reports'
        const chosen = normalizeRecord(action.kind, useIncoming ? latest.payload : { ...current, revision: crypto.randomUUID(), updatedAt: now() })
        await tx.objectStore(action.kind).put(chosen)
        const key = recordKey(action.kind, action.id)
        if (useIncoming) await tx.objectStore('outbox').delete(key)
        else await tx.objectStore('outbox').put({ key, kind: action.kind, id: action.id, revision: chosen.revision })
        await tx.objectStore('meta').put({ key: baselineKey(accountId, key), version: latest.version })
        if (action.kind === 'reports' && Number.isInteger(latest.reportVersion)) await tx.objectStore('meta').put({ key: `sync-report-version:${action.id}`, version: latest.reportVersion })
      })
    },
  }
  async function preserveConflict(action, incoming, accountId) {
    await local.transaction([action.kind, 'conflicts'], 'readwrite', async (tx) => {
      guard()
      const current = await tx.objectStore(action.kind).get(action.id)
      await tx.objectStore('conflicts').put({ id: `sync:${accountId}:${action.kind}:${action.id}:${current?.revision ?? action.local?.revision}:${incoming?.version ?? 0}`, source: 'sync', accountId, kind: action.kind, recordId: action.id, local: current ?? action.local, incoming: incoming?.payload ?? null, remoteVersion: incoming?.version ?? 0, createdAt: now() })
    })
  }
}
