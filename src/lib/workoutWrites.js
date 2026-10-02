// Serialize IndexedDB writes so a blur cannot finish after a newer completion value.
export function createWorkoutWrites() {
  let tail = Promise.resolve()
  let finishing = false
  return {
    enqueue(work) {
      const pending = tail.catch(() => {}).then(work)
      tail = pending
      return pending
    },
    async finish(flush, complete) {
      if (finishing) return false
      finishing = true
      try { await tail.catch(() => {}); await flush(); await tail; await complete(); return true }
      finally { finishing = false }
    },
  }
}
