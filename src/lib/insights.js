function numericRir(value) {
  if (value == null || value === '') return null
  const matches = String(value).match(/\d+(?:\.\d+)?/g)
  if (!matches?.length) return null
  return matches.map(Number).reduce((sum, item) => sum + item, 0) / matches.length
}

function repRange(value = '') {
  const matches = String(value).match(/\d+/g)?.map(Number) ?? []
  return { low: matches[0] ?? null, high: matches[1] ?? matches[0] ?? null }
}

function workSets(sets) {
  return sets.filter((set) => set.completed && set.setType !== 'warmup' && Number.isFinite(set.weight) && Number.isFinite(set.reps))
}

function sessionMetrics(sets) {
  const working = workSets(sets)
  const rirValues = working.map((set) => numericRir(set.rir)).filter(Number.isFinite)
  const estimatedMaxes = working
    .filter((set) => set.weight > 0 && set.reps > 0 && set.reps <= 30)
    .map((set) => set.weight * (1 + set.reps / 30))

  return {
    setCount: working.length,
    volume: Math.round(working.reduce((sum, set) => sum + set.weight * set.reps, 0)),
    maxWeight: working.reduce((max, set) => Math.max(max, set.weight), 0),
    totalReps: working.reduce((sum, set) => sum + set.reps, 0),
    estimated1rm: estimatedMaxes.length ? Math.max(...estimatedMaxes) : 0,
    averageRir: rirValues.length ? rirValues.reduce((sum, value) => sum + value, 0) / rirValues.length : null,
    rirCoverage: working.length ? rirValues.length / working.length : 0,
  }
}

function exerciseConfig(exerciseId, routine) {
  for (const day of routine.days) {
    const exercise = day.exercises.find((item) => item.id === exerciseId)
    if (exercise) return exercise
  }
  return null
}

function sessionNote(session, exerciseId) {
  return session?.exerciseNotes?.[exerciseId] ?? ''
}

function makeDirection({ latest, previous, config, note }) {
  const range = repRange(config?.reps)
  const qualityConcern = /(통증|불편|애매|어색|무너|빨라|반동)/.test(note)
  const allAtTop = range.high != null && latest.sets.length > 0 && latest.sets.every((set) => set.reps >= range.high)

  if (/(통증|불편)/.test(note)) return { tone: 'caution', label: '불편감 우선 확인', detail: '중량보다 통증 없는 가동범위와 동작 선택을 먼저 확인해.' }
  if (qualityConcern) return { tone: 'quality', label: '현재 중량 · 수행 품질 우선', detail: '메모에 자세나 자극의 불확실성이 있어. 증량보다 같은 조건에서 더 안정적으로 반복하는 게 우선이야.' }
  if (allAtTop && latest.metrics.averageRir != null && latest.metrics.averageRir >= 1.5) return { tone: 'up', label: '최소 단위 증량 후보', detail: '목표 반복 상단을 달성했고 1~2회 이상 여유가 남았어. 다음 세션에서 가장 작은 단위 증량을 검토해.' }
  if (latest.metrics.averageRir != null && latest.metrics.averageRir <= 1) return { tone: 'hold', label: '현재 중량 유지', detail: '한계에 가까운 세트가 있어. 같은 중량에서 반복수와 자세를 안정시키는 편이 좋아.' }
  if (previous && latest.metrics.estimated1rm > previous.metrics.estimated1rm * 1.02) return { tone: 'up', label: '성장 흐름 유지', detail: '중량과 반복수를 함께 본 추정 수행력이 이전 기록보다 좋아졌어.' }
  if (previous && latest.metrics.volume > previous.metrics.volume * 1.05) return { tone: 'up', label: '총 반복량 증가', detail: '같은 운동의 유효 훈련량이 이전 기록보다 늘었어. 급하게 증량하지 말고 한 번 더 확인해.' }
  return { tone: 'hold', label: '현재 중량 · 총 반복 +1', detail: '다음 세션은 같은 중량에서 깔끔한 반복을 한 개 더 쌓는 방향이 무난해.' }
}

export function buildExerciseInsights(sessions, sets, routine, exerciseLibrary) {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]))
  const grouped = new Map()

  workSets(sets).forEach((set) => {
    const key = `${set.date}:${set.dayId}:${set.exerciseId}`
    if (!grouped.has(key)) grouped.set(key, { date: set.date, dayId: set.dayId, exerciseId: set.exerciseId, sets: [] })
    grouped.get(key).sets.push(set)
  })

  const byExercise = new Map()
  grouped.forEach((entry) => {
    entry.metrics = sessionMetrics(entry.sets)
    entry.session = sessionMap.get(`${entry.date}:${entry.dayId}`)
    if (!byExercise.has(entry.exerciseId)) byExercise.set(entry.exerciseId, [])
    byExercise.get(entry.exerciseId).push(entry)
  })

  return [...byExercise.entries()].map(([exerciseId, entries]) => {
    entries.sort((a, b) => b.date.localeCompare(a.date))
    const latest = entries[0]
    const previous = entries[1] ?? null
    const config = exerciseConfig(exerciseId, routine)
    const note = sessionNote(latest.session, exerciseId)
    const direction = makeDirection({ latest, previous, config, note })
    const scoreDelta = previous?.metrics.estimated1rm
      ? ((latest.metrics.estimated1rm - previous.metrics.estimated1rm) / previous.metrics.estimated1rm) * 100
      : null

    return {
      exerciseId,
      name: exerciseLibrary[exerciseId]?.name ?? exerciseId,
      latestDate: latest.date,
      sessions: entries.length,
      maxWeight: latest.metrics.maxWeight,
      totalReps: latest.metrics.totalReps,
      averageRir: latest.metrics.averageRir,
      rirCoverage: latest.metrics.rirCoverage,
      volume: latest.metrics.volume,
      scoreDelta,
      note,
      direction,
    }
  }).sort((a, b) => b.latestDate.localeCompare(a.latestDate) || a.name.localeCompare(b.name, 'ko'))
}

export function buildTrainingSummary(sessions, sets, routine, exerciseLibrary, range = null) {
  const rangedSessions = range ? sessions.filter((session) => session.date >= range.start && session.date <= range.end) : sessions
  const sessionIds = new Set(rangedSessions.map((session) => session.id))
  const rangedSets = range ? sets.filter((set) => sessionIds.has(`${set.date}:${set.dayId}`)) : sets
  const working = workSets(rangedSets)
  const durations = rangedSessions.filter((session) => session.durationSec > 0)
  const rirValues = working.map((set) => numericRir(set.rir)).filter(Number.isFinite)

  const durationByDay = routine.days.map((day) => {
    const rows = durations.filter((session) => session.dayId === day.id)
    return {
      dayId: day.id,
      name: day.name,
      count: rows.length,
      averageSec: rows.length ? Math.round(rows.reduce((sum, session) => sum + session.durationSec, 0) / rows.length) : 0,
    }
  }).filter((item) => item.count)

  return {
    sessionCount: rangedSessions.length,
    workingSetCount: working.length,
    volume: Math.round(working.reduce((sum, set) => sum + set.weight * set.reps, 0)),
    averageDurationSec: durations.length ? Math.round(durations.reduce((sum, session) => sum + session.durationSec, 0) / durations.length) : 0,
    rirCoverage: working.length ? rirValues.length / working.length : 0,
    durationByDay,
    exerciseInsights: buildExerciseInsights(sessions, sets, routine, exerciseLibrary),
  }
}
