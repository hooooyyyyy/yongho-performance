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
  return sets.filter((set) => set.completed && !set.deletedAt && (set.setType ?? 'work') === 'work')
}

function sessionMetrics(sets) {
  const working = workSets(sets)
  const rirValues = working.map((set) => numericRir(set.rir)).filter(Number.isFinite)
  const estimatedMaxes = working
    .filter((set) => set.weight > 0 && set.reps > 0 && set.reps <= 30)
    .map((set) => set.weight * (1 + set.reps / 30))

  return {
    setCount: working.length,
    volume: Math.round(working.reduce((sum, set) => sum + (Number.isFinite(set.weight) && Number.isFinite(set.reps) ? set.weight * set.reps : 0), 0)),
    maxWeight: working.reduce((max, set) => Math.max(max, Number.isFinite(set.weight) ? set.weight : 0), 0),
    totalReps: working.reduce((sum, set) => sum + (Number.isFinite(set.reps) ? set.reps : 0), 0),
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
  if (config?.rir === '최대 속도') return { tone: 'quality', label: '폭발력·착지 품질 확인', detail: '점프는 RIR보다 높이·속도·착지의 일관성을 기록해.' }
  if (latest.sets.some((set) => !Number.isFinite(set.reps))) return { tone: 'hold', label: '반복수 기록부터 확인', detail: '세트는 보존돼 있지만 반복수가 비어 있어. 성장·정체나 증량을 판단할 근거가 부족해.' }
  if (/(가동범위|이완|깊이|깊게|속도.*변|폼.*변)/.test(note)) return { tone: 'quality', label: '같은 수행 조건에서 다시 비교', detail: '가동범위나 수행 방식 변화가 기록돼 있어. 숫자 변화만으로 성장·정체를 단정하지 말고 같은 조건의 기록을 더 쌓아.' }
  if (latest.metrics.rirCoverage < 0.5) return { tone: 'hold', label: 'RIR 기록 보완', detail: '여유 반복 기록이 부족해. 증량 판단 전에 마지막 본세트의 RIR을 남겨줘.' }
  if (allAtTop && latest.metrics.averageRir != null && latest.metrics.averageRir >= 1.5) return { tone: 'up', label: '최소 단위 증량 후보', detail: '목표 반복 상단을 달성했고 1~2회 이상 여유가 남았어. 다음 세션에서 가장 작은 단위 증량을 검토해.' }
  if (latest.metrics.averageRir != null && latest.metrics.averageRir <= 1) return { tone: 'hold', label: '현재 중량 유지', detail: '한계에 가까운 세트가 있어. 같은 중량에서 반복수와 자세를 안정시키는 편이 좋아.' }
  if (previous && latest.metrics.estimated1rm > previous.metrics.estimated1rm * 1.02) return { tone: 'up', label: '성장 흐름 유지', detail: '중량과 반복수를 함께 본 추정 수행력이 이전 기록보다 좋아졌어.' }
  if (previous && latest.metrics.volume > previous.metrics.volume * 1.05) return { tone: 'up', label: '총 반복량 증가', detail: '기록된 같은 운동의 중량×반복수 합계이 이전 기록보다 늘었어. 급하게 증량하지 말고 한 번 더 확인해.' }
  return { tone: 'hold', label: '현재 중량 · 총 반복 +1', detail: '다음 세션은 같은 중량에서 깔끔한 반복을 한 개 더 쌓는 방향이 무난해.' }
}

export function buildExerciseInsights(sessions, sets, routine, exerciseLibrary) {
  const sessionMap = new Map(sessions.map((session) => [session.id, session]))
  const grouped = new Map()

  workSets(sets).filter((set) => sessionMap.get(`${set.date}:${set.dayId}`)?.status !== 'started').forEach((set) => {
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
    volume: Math.round(working.reduce((sum, set) => sum + (Number.isFinite(set.weight) && Number.isFinite(set.reps) ? set.weight * set.reps : 0), 0)),
    averageDurationSec: durations.length ? Math.round(durations.reduce((sum, session) => sum + session.durationSec, 0) / durations.length) : 0,
    rirCoverage: working.length ? rirValues.length / working.length : 0,
    durationByDay,
    exerciseInsights: buildExerciseInsights(sessions, sets, routine, exerciseLibrary),
  }
}
