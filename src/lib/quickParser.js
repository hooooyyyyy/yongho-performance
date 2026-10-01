const aliases = [
  ['incline-smith', /(인클라인[^\n.]*스미스|스미스[^\n.]*인클라인)/i],
  ['mag-lat-pulldown', /(맥\s*그립[^\n.]*랫풀|맥그립|랫\s*풀다운|랫풀)/i],
  ['chest-press', /(체스트\s*프레스)/i],
  ['cable-lateral', /(케이블[^\n.]*레터럴|레터럴\s*레이즈|레터럴)/i],
  ['overhead-triceps', /(오버헤드[^\n.]*익스텐션|오버헤드[^\n.]*삼두)/i],
  ['shoulder-press', /(숄더\s*프레스|어깨\s*프레스)/i],
  ['incline-machine-press', /(인클라인[^\n.]*머신\s*프레스)/i],
  ['chest-supported-row', /(체스트\s*서포티드\s*로우|체스트서포티드)/i],
  ['one-arm-lat-pulldown', /(원암[^\n.]*랫풀)/i],
  ['cable-curl', /(케이블\s*컬)/i],
  ['triceps-pushdown', /(푸시다운|프레스다운)/i],
  ['leg-press', /(레그\s*프레스)/i],
  ['seated-leg-curl', /(시티드[^\n.]*레그\s*컬|레그\s*컬)/i],
]

const koreanCounts = { 한: 1, 한개: 1, 두: 2, 두개: 2, 세: 3, 세개: 3, 네: 4, 네개: 4, 다섯: 5 }

function setTypeFromText(text) {
  if (/웜업|워밍업|빈\s*봉/i.test(text)) return 'warmup'
  if (/드롭/i.test(text)) return 'drop'
  if (/테스트|시험/i.test(text)) return 'test'
  return 'work'
}

function repetitionCount(text) {
  const match = text.match(/(?:씩\s*)?(\d+|한|두|세|네|다섯)(?:\s*개)?\s*세트/i)
  if (!match) return 1
  return Number(match[1]) || koreanCounts[match[1]] || 1
}

export function parseQuickWorkout(text, day) {
  const groups = new Map()
  let currentExerciseId = null
  const fragments = text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const fragment of fragments) {
    const alias = aliases.find(([, pattern]) => pattern.test(fragment))
    if (alias) currentExerciseId = alias[0]
    if (!currentExerciseId || !day.exercises.some((exercise) => exercise.id === currentExerciseId)) continue

    const found = []
    const setPattern = /(빈\s*봉|맨몸|\d+(?:\.\d+)?\s*kg)\s*(?:으로|로|에)?\s*(\d+)\s*(?:개|회)/gi
    const matches = [...fragment.matchAll(setPattern)]
    matches.forEach((match, matchIndex) => {
      const load = match[1].replace(/\s+/g, '')
      const end = match.index + match[0].length
      const nextStart = matches[matchIndex + 1]?.index ?? fragment.length
      const after = fragment.slice(end, nextStart)
      const before = fragment.slice(Math.max(0, match.index - 14), match.index)
      const count = repetitionCount(after)
      const explicitPrefix = /(웜업|워밍업|드롭|테스트|시험)\s*[:\-]?\s*$/i.test(before) ? before : ''
      const type = setTypeFromText(`${explicitPrefix} ${after} ${/빈봉/.test(load) ? '빈 봉' : ''}`)
      for (let index = 0; index < count; index += 1) {
        found.push({
          weight: /빈봉|맨몸/.test(load) ? '' : Number(load.replace(/kg/i, '')),
          weightLabel: /빈봉/.test(load) ? '빈 봉' : /맨몸/.test(load) ? '맨몸' : '',
          reps: Number(match[2]),
          rir: '',
          setType: type,
          completed: true,
        })
      }
    })

    // “60kg으로 본세트 3세트”처럼 반복수가 생략된 표현도 기록한다.
    if (!found.length) {
      const noRep = fragment.match(/(\d+(?:\.\d+)?)\s*kg[^\n.]{0,24}?(\d+|두|세|네)\s*세트/i)
      if (noRep) {
        const count = Number(noRep[2]) || koreanCounts[noRep[2]] || 1
        for (let index = 0; index < count; index += 1) {
          found.push({ weight: Number(noRep[1]), weightLabel: '', reps: '', rir: '', setType: setTypeFromText(fragment), completed: true })
        }
      }
    }

    if (found.length) groups.set(currentExerciseId, [...(groups.get(currentExerciseId) ?? []), ...found])
  }

  return day.exercises
    .filter((exercise) => groups.has(exercise.id))
    .map((exercise) => ({ exerciseId: exercise.id, sets: groups.get(exercise.id) }))
}
