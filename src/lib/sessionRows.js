export function makeRows(exercise, logs) {
  const ordered = [...logs].sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0))
  const stored = ordered.filter((row) => !row.deletedAt).map((row) => ({ ...row, weight: row.weight ?? '', reps: row.reps ?? '', rir: row.rir ?? '', setType: row.setType ?? 'work' }))
  // Deleted default rows must not reappear after reopening a session.
  const storedIndices = new Set(ordered.map((row) => row.setIndex))
  const defaults = Array.from({ length: exercise.sets }, (_, setIndex) => ({ setIndex, setType: 'work', weight: exercise.targetWeight ?? '', weightLabel: '', reps: '', rir: exercise.rir ?? '', completed: false })).filter((row) => !storedIndices.has(row.setIndex))
  return [...stored, ...defaults].sort((a, b) => a.setIndex - b.setIndex)
}
