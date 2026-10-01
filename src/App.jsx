import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Dumbbell,
  Flame,
  History,
  Home,
  Info,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  TimerReset,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import routine from './data/routine.json'
import exerciseLibrary from './data/exercises.json'
import {
  completeWorkoutSession,
  getAllCompletedSets,
  getDayLog,
  getPreviousExerciseLog,
  getWorkoutHistory,
  saveSet,
  startWorkoutSession,
} from './lib/storage.js'

const weekdayLabels = ['월', '화', '수', '목', '금', '토', '일']

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatToday(date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date)
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00Z`)
}

function keyFromDate(date) {
  return date.toISOString().slice(0, 10)
}

function addDays(key, amount) {
  const date = dateFromKey(key)
  date.setUTCDate(date.getUTCDate() + amount)
  return keyFromDate(date)
}

function getWeekRange(reference = localDateKey()) {
  const date = dateFromKey(reference)
  const distanceFromMonday = (date.getUTCDay() + 6) % 7
  const start = addDays(reference, -distanceFromMonday)
  return { start, end: addDays(start, 6) }
}

function shiftWeek(range, weeks) {
  return { start: addDays(range.start, weeks * 7), end: addDays(range.end, weeks * 7) }
}

function inRange(date, range) {
  return date >= range.start && date <= range.end
}

function monthKey(dateKey = localDateKey()) {
  return dateKey.slice(0, 7)
}

function shiftMonth(key, amount) {
  const date = new Date(`${key}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + amount)
  return keyFromDate(date).slice(0, 7)
}

function monthLabel(key) {
  const [year, month] = key.split('-').map(Number)
  return `${year}년 ${month}월`
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds)
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

function maxWeightByExercise(sets) {
  return sets.reduce((result, set) => {
    if (Number.isFinite(set.weight) && set.weight > 0) {
      result[set.exerciseId] = Math.max(result[set.exerciseId] ?? 0, set.weight)
    }
    return result
  }, {})
}

function App() {
  const [screen, setScreen] = useState('today')
  const [selectedDayId, setSelectedDayId] = useState(routine.days[0].id)
  const [activeWorkout, setActiveWorkout] = useState(false)
  const [timer, setTimer] = useState({ visible: false, running: false, remaining: 0, total: 0 })
  const [history, setHistory] = useState([])
  const [completedSets, setCompletedSets] = useState([])
  const selectedDay = routine.days.find((day) => day.id === selectedDayId) ?? routine.days[0]

  const refreshInsights = useCallback(async () => {
    const [sessions, sets] = await Promise.all([getWorkoutHistory(), getAllCompletedSets()])
    setHistory(sessions)
    setCompletedSets(sets)
  }, [])

  useEffect(() => { refreshInsights() }, [refreshInsights])

  useEffect(() => {
    const handleUpdate = () => refreshInsights()
    window.addEventListener('yp:log-updated', handleUpdate)
    return () => window.removeEventListener('yp:log-updated', handleUpdate)
  }, [refreshInsights])

  const currentWeek = getWeekRange()
  const completedThisWeek = history.filter((session) => inRange(session.date, currentWeek))
  const completedIds = new Set(completedThisWeek.map((session) => session.dayId))
  const nextDay = routine.days.find((day) => !completedIds.has(day.id)) ?? routine.days[0]

  useEffect(() => {
    const context = typeof document === 'undefined' ? undefined : document.modelContext
    if (!context?.registerTool) return undefined
    const lifecycle = new AbortController()
    const register = (tool) => Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {})

    register({
      name: 'read_week_plan',
      title: '이번 주 운동 계획 확인',
      description: '요일에 고정되지 않은 주 4회 루틴과 이번 주 완료 상태를 읽습니다.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute() {
        const sessions = await getWorkoutHistory()
        const week = getWeekRange()
        const done = new Set(sessions.filter((session) => inRange(session.date, week)).map((session) => session.dayId))
        return {
          week,
          completed: done.size,
          goal: 4,
          routines: routine.days.map((day) => ({
            id: day.id,
            label: day.sessionLabel,
            name: day.name,
            recommendedDay: day.recommendedDay,
            completed: done.has(day.id),
          })),
        }
      },
    })

    register({
      name: 'record_workout_sets',
      title: '운동 세트 기록',
      description: '오늘 수행한 한 운동의 여러 세트를 중량과 반복수로 기록합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          dayId: { type: 'string' },
          exerciseId: { type: 'string' },
          sets: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              properties: {
                set: { type: 'integer', minimum: 1 },
                weight: { type: 'number', minimum: 0 },
                reps: { type: 'integer', minimum: 0 },
              },
              required: ['set', 'reps'],
              additionalProperties: false,
            },
          },
        },
        required: ['dayId', 'exerciseId', 'sets'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input?.dayId)
        const exercise = day?.exercises.find((item) => item.id === input?.exerciseId)
        if (!day || !exercise || !Array.isArray(input.sets)) throw new Error('루틴에 없는 운동입니다.')
        input.sets.forEach((set) => {
          if (!Number.isInteger(set.set) || set.set < 1 || set.set > exercise.sets || !Number.isInteger(set.reps) || set.reps < 0) {
            throw new Error('세트 번호 또는 반복수가 올바르지 않습니다.')
          }
        })
        await startWorkoutSession(localDateKey(), day.id)
        await Promise.all(input.sets.map((set) => saveSet({
          date: localDateKey(),
          dayId: day.id,
          exerciseId: exercise.id,
          setIndex: set.set - 1,
          weight: Number.isFinite(set.weight) ? set.weight : null,
          reps: set.reps,
          completed: true,
        })))
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { recorded: input.sets.length, exercise: exerciseLibrary[exercise.id].name, date: localDateKey() }
      },
    })

    register({
      name: 'complete_workout_session',
      title: '운동 완료 기록',
      description: '오늘 수행한 루틴을 완료 처리해 캘린더와 주간 리포트에 반영합니다.',
      inputSchema: {
        type: 'object',
        properties: { dayId: { type: 'string' } },
        required: ['dayId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input?.dayId)
        if (!day) throw new Error('루틴을 찾을 수 없습니다.')
        await completeWorkoutSession(localDateKey(), day.id)
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { completed: true, day: day.name, date: localDateKey() }
      },
    })

    return () => lifecycle.abort()
  }, [])

  useEffect(() => {
    if (!timer.running) return undefined
    const interval = window.setInterval(() => {
      setTimer((current) => {
        if (current.remaining <= 1) {
          navigator.vibrate?.([120, 80, 120])
          return { ...current, running: false, remaining: 0 }
        }
        return { ...current, remaining: current.remaining - 1 }
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [timer.running])

  const startDay = (dayId) => {
    setSelectedDayId(dayId)
    setActiveWorkout(true)
    window.scrollTo({ top: 0 })
  }

  const openRoutine = (dayId) => {
    setSelectedDayId(dayId)
    setScreen('routine')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const showScreen = (nextScreen) => {
    setScreen(nextScreen)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startTimer = useCallback((seconds) => {
    setTimer({ visible: true, running: true, remaining: seconds, total: seconds })
  }, [])

  if (activeWorkout) {
    return (
      <>
        <WorkoutScreen
          day={selectedDay}
          onBack={() => setActiveWorkout(false)}
          onFinish={async () => {
            setActiveWorkout(false)
            await refreshInsights()
            setScreen('today')
          }}
          onStartTimer={startTimer}
        />
        <RestTimer timer={timer} setTimer={setTimer} workoutMode />
      </>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">YP</div>
        <div className="brand-name"><span>YONGHO</span><strong>PERFORMANCE</strong></div>
        <div className="phase-badge">PHASE 2</div>
      </header>

      <main>
        {screen === 'today' && (
          <TodayScreen
            nextDay={nextDay}
            history={history}
            onStartDay={startDay}
            onOpenRoutine={openRoutine}
          />
        )}
        {screen === 'routine' && (
          <RoutineScreen
            selectedDay={selectedDay}
            setSelectedDayId={setSelectedDayId}
            onStartDay={startDay}
          />
        )}
        {screen === 'report' && <ReportScreen history={history} completedSets={completedSets} />}
      </main>

      <nav className="bottom-nav" aria-label="주요 메뉴">
        <button className={screen === 'today' ? 'active' : ''} onClick={() => showScreen('today')}><Home size={21} /><span>오늘</span></button>
        <button className={screen === 'routine' ? 'active' : ''} onClick={() => showScreen('routine')}><Dumbbell size={21} /><span>루틴</span></button>
        <button className={screen === 'report' ? 'active' : ''} onClick={() => showScreen('report')}><BarChart3 size={21} /><span>기록</span></button>
      </nav>
      <RestTimer timer={timer} setTimer={setTimer} />
    </div>
  )
}

function TodayScreen({ nextDay, history, onStartDay, onOpenRoutine }) {
  const today = localDateKey()
  const week = getWeekRange(today)
  const weekSessions = history.filter((session) => inRange(session.date, week))
  const monthSessions = history.filter((session) => session.date.startsWith(monthKey(today)))
  const completedIds = new Set(weekSessions.map((session) => session.dayId))

  return (
    <>
      <section className="page-heading home-heading">
        <p>{formatToday()}</p>
        <h1>이번 주 {weekSessions.length}<em>/4</em></h1>
        <span>요일이 밀려도 괜찮아. 가능한 날에 다음 세션을 이어가면 돼.</span>
      </section>

      <section className="weekly-score" aria-label={`이번 주 ${weekSessions.length}회 운동 완료`}>
        <div className="score-copy"><span>WEEKLY GOAL</span><strong>{weekSessions.length === 4 ? '이번 주 완료' : `${4 - Math.min(weekSessions.length, 4)}회 남음`}</strong></div>
        <div className="goal-dots">
          {[0, 1, 2, 3].map((index) => <i className={index < weekSessions.length ? 'done' : ''} key={index}>{index < weekSessions.length && <Check size={15} />}</i>)}
        </div>
      </section>

      <section className="next-session-card">
        <div className="next-label"><span>NEXT SESSION</span><span>추천 {nextDay.recommendedDay}요일 · 언제든 가능</span></div>
        <div className="next-session-title"><span>{nextDay.sessionLabel}</span><div><h2>{nextDay.name}</h2><p>{nextDay.focus}</p></div></div>
        <div className="next-meta"><span><Clock3 size={16} /> {nextDay.duration}</span><span><Dumbbell size={16} /> {nextDay.exercises.length}개 운동</span></div>
        <button className="primary-button" onClick={() => onStartDay(nextDay.id)}><Play size={19} fill="currentColor" /> 이 루틴 시작</button>
        <button className="text-button" onClick={() => onOpenRoutine(nextDay.id)}>운동 구성 먼저 보기</button>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span>FLEXIBLE 4-DAY</span><h2>오늘 다른 루틴을 할래?</h2></div></div>
        <div className="routine-launcher">
          {routine.days.map((day) => {
            const completed = completedIds.has(day.id)
            return (
              <button className={`routine-launch ${completed ? 'completed' : ''}`} key={day.id} onClick={() => onStartDay(day.id)}>
                <span className="session-letter">{completed ? <Check size={20} /> : day.sessionLabel}</span>
                <span><strong>{day.name}</strong><small>추천 {day.recommendedDay} · {day.duration}</small></span>
                <Play size={17} fill="currentColor" />
              </button>
            )
          })}
        </div>
      </section>

      <section className="home-stats">
        <article><span>이번 주</span><strong>{weekSessions.length}<small>회</small></strong><p>목표 4회</p></article>
        <article><span>이번 달</span><strong>{monthSessions.length}<small>회</small></strong><p>{monthLabel(monthKey(today))}</p></article>
      </section>

      <section className="coach-note">
        <Sparkles size={20} />
        <div><strong>운영 기준</strong><p>A→B→C→D는 추천 흐름일 뿐이야. 일정이 밀리면 가능한 루틴을 선택하고, 하체 세션과 축구 사이만 2–3일 확보해.</p></div>
      </section>
    </>
  )
}

function RoutineScreen({ selectedDay, setSelectedDayId, onStartDay }) {
  return (
    <>
      <section className="page-heading compact"><p>{routine.name}</p><h1>4개의 세션</h1><span>요일 고정 없이 주 4회를 채운다. 표시된 요일은 회복을 고려한 추천 배치다.</span></section>

      <div className="day-tabs" role="tablist" aria-label="루틴 선택">
        {routine.days.map((day) => (
          <button role="tab" aria-selected={day.id === selectedDay.id} className={day.id === selectedDay.id ? 'active' : ''} onClick={() => setSelectedDayId(day.id)} key={day.id}>
            <span>{day.sessionLabel}</span><strong>{day.name.replace(' + ', '+')}</strong><small>추천 {day.recommendedDay}</small>
          </button>
        ))}
      </div>

      <section className="routine-hero">
        <div className="routine-icon">{selectedDay.sessionLabel}</div>
        <div className="routine-title"><span>추천 {selectedDay.recommendedDay}요일 · {selectedDay.duration}</span><h2>{selectedDay.name}</h2><p>{selectedDay.focus}</p></div>
        <Activity size={26} />
        <button className="primary-button" onClick={() => onStartDay(selectedDay.id)}><Play size={18} fill="currentColor" /> 오늘 이 루틴 시작</button>
      </section>

      <section className="routine-exercises">
        {selectedDay.exercises.map((exercise, index) => <ExerciseInfoCard exercise={exercise} index={index} key={`${exercise.id}-${index}`} />)}
      </section>
    </>
  )
}

function ReportScreen({ history, completedSets }) {
  const today = localDateKey()
  const [visibleMonth, setVisibleMonth] = useState(monthKey(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const currentWeek = getWeekRange(today)
  const previousWeek = shiftWeek(currentWeek, -1)
  const currentSessions = history.filter((session) => inRange(session.date, currentWeek))
  const previousSessions = history.filter((session) => inRange(session.date, previousWeek))
  const monthSessions = history.filter((session) => session.date.startsWith(visibleMonth))
  const selectedSessions = history.filter((session) => session.date === selectedDate)

  const currentMax = maxWeightByExercise(completedSets.filter((set) => inRange(set.date, currentWeek)))
  const previousMax = maxWeightByExercise(completedSets.filter((set) => inRange(set.date, previousWeek)))
  const comparisons = Object.entries(currentMax)
    .filter(([exerciseId]) => previousMax[exerciseId] != null)
    .map(([exerciseId, weight]) => ({ exerciseId, weight, previous: previousMax[exerciseId], delta: weight - previousMax[exerciseId] }))
    .sort((a, b) => b.delta - a.delta)
  const improved = comparisons.filter((item) => item.delta > 0.001)

  const firstOfMonth = `${visibleMonth}-01`
  const firstDate = dateFromKey(firstOfMonth)
  const leadingDays = (firstDate.getUTCDay() + 6) % 7
  const gridStart = addDays(firstOfMonth, -leadingDays)
  const calendarDays = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  const attendanceDelta = currentSessions.length - previousSessions.length

  return (
    <>
      <section className="page-heading compact"><p>TRAINING LOG</p><h1>기록과 리포트</h1><span>출석과 실제 증량만 간단히 본다.</span></section>

      <section className="report-summary">
        <article className="report-main-card">
          <span>이번 주 출석</span><strong>{currentSessions.length}<small>/4회</small></strong>
          <div className="attendance-bar"><i style={{ width: `${Math.min(100, (currentSessions.length / 4) * 100)}%` }} /></div>
          <p className={attendanceDelta >= 0 ? 'positive' : ''}>{attendanceDelta === 0 ? '지난주와 같은 페이스' : `지난주보다 ${Math.abs(attendanceDelta)}회 ${attendanceDelta > 0 ? '더 운동 중' : '적게 운동 중'}`}</p>
        </article>
        <article className="report-side-card"><TrendingUp size={20} /><span>증량 종목</span><strong>{improved.length}<small>개</small></strong><p>지난주 대비 최고 중량</p></article>
      </section>

      <section className="calendar-card">
        <div className="calendar-head">
          <div><span>MONTHLY</span><h2>{monthLabel(visibleMonth)}</h2></div>
          <div><button aria-label="이전 달" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}><ChevronLeft size={20} /></button><button aria-label="다음 달" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}><ChevronRight size={20} /></button></div>
        </div>
        <div className="month-total"><CalendarDays size={18} /><span>이달의 운동</span><strong>{monthSessions.length}회</strong></div>
        <div className="calendar-weekdays">{weekdayLabels.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">
          {calendarDays.map((date) => {
            const sessions = history.filter((session) => session.date === date)
            const outside = !date.startsWith(visibleMonth)
            const selected = date === selectedDate
            const isToday = date === today
            return (
              <button key={date} className={`${outside ? 'outside' : ''} ${selected ? 'selected' : ''} ${sessions.length ? 'trained' : ''}`} onClick={() => setSelectedDate(date)} aria-label={`${date}${sessions.length ? ` 운동 ${sessions.length}회` : ''}`}>
                <span>{Number(date.slice(-2))}</span>{isToday && <i className="today-mark">오늘</i>}{sessions.length > 0 && <i className="workout-mark">{sessions.length}</i>}
              </button>
            )
          })}
        </div>
        <div className="selected-date-log">
          <div><span>{selectedDate.replaceAll('-', '.')}</span><strong>{selectedSessions.length ? `${selectedSessions.length}개 세션 완료` : '운동 기록 없음'}</strong></div>
          {selectedSessions.map((session) => {
            const day = routine.days.find((item) => item.id === session.dayId)
            return day ? <div className="date-session" key={session.id}><span>{day.sessionLabel}</span><p><strong>{day.name}</strong><small>{session.setCount ?? 0}세트 기록</small></p><Check size={18} /></div> : null
          })}
        </div>
      </section>

      <section className="weekly-report-card">
        <div className="section-heading"><div><span>WEEKLY REPORT</span><h2>지난주보다 좋아진 점</h2></div><Trophy size={23} /></div>
        {comparisons.length === 0 ? (
          <div className="empty-report"><TrendingUp size={24} /><strong>비교할 기록을 쌓는 중</strong><p>같은 운동을 지난주와 이번 주에 기록하면 증량 변화가 여기에 나타나.</p></div>
        ) : (
          <div className="progress-list">
            {comparisons.slice(0, 5).map((item) => (
              <div key={item.exerciseId}><span><strong>{exerciseLibrary[item.exerciseId]?.name ?? item.exerciseId}</strong><small>{item.previous}kg → {item.weight}kg</small></span><em className={item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : ''}>{item.delta > 0 ? `+${item.delta}` : item.delta}kg</em></div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function ExerciseInfoCard({ exercise, index }) {
  const [open, setOpen] = useState(false)
  const detail = exerciseLibrary[exercise.id]
  return (
    <article className={`info-card ${open ? 'open' : ''}`}>
      <button className="info-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="exercise-number">{String(index + 1).padStart(2, '0')}</span>
        <div><h3>{detail.name}</h3><p>{exercise.sets} × {exercise.reps} · RIR {exercise.rir} · {formatClock(exercise.rest)}</p></div>
        <ChevronDown className="chevron" size={20} />
      </button>
      <div className="cue-line"><Flame size={16} /><span>{detail.shortCue}</span></div>
      {open && <TipDetails detail={detail} />}
    </article>
  )
}

function WorkoutScreen({ day, onBack, onFinish, onStartTimer }) {
  const date = localDateKey()
  const [logs, setLogs] = useState([])
  const [previous, setPrevious] = useState({})
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const currentLogs = await getDayLog(date, day.id)
    const priorPairs = await Promise.all([...new Set(day.exercises.map((exercise) => exercise.id))].map(async (exerciseId) => [exerciseId, await getPreviousExerciseLog(exerciseId, date)]))
    setLogs(currentLogs)
    setPrevious(Object.fromEntries(priorPairs))
    setLoading(false)
  }, [date, day])

  useEffect(() => {
    startWorkoutSession(date, day.id).then(refresh)
  }, [date, day.id, refresh])

  useEffect(() => {
    const handleUpdate = () => refresh()
    window.addEventListener('yp:log-updated', handleUpdate)
    return () => window.removeEventListener('yp:log-updated', handleUpdate)
  }, [refresh])

  const handleSetSave = async (exercise, setIndex, values, completed) => {
    await saveSet({
      date,
      dayId: day.id,
      exerciseId: exercise.id,
      setIndex,
      weight: values.weight === '' ? null : Number(values.weight),
      reps: values.reps === '' ? null : Number(values.reps),
      completed,
    })
    await refresh()
    if (completed) onStartTimer(exercise.rest)
  }

  const completed = logs.filter((item) => item.completed).length
  const total = day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0)

  const finishWorkout = async () => {
    await completeWorkoutSession(date, day.id)
    window.dispatchEvent(new CustomEvent('yp:log-updated'))
    onFinish()
  }

  return (
    <div className="workout-shell">
      <header className="workout-header">
        <button className="icon-button" onClick={onBack} aria-label="운동 화면 닫기"><ArrowLeft size={23} /></button>
        <div><span>{day.sessionLabel} SESSION · {formatToday()}</span><h1>{day.name}</h1></div>
        <strong>{completed}/{total}</strong>
      </header>
      <div className="workout-progress"><span style={{ width: `${total ? (completed / total) * 100 : 0}%` }} /></div>

      <main className="workout-main">
        <section className="session-intro"><div><Clock3 size={18} /><span>{day.duration}</span></div><p>{day.focus}</p></section>
        {loading ? <div className="loading-card">기록을 불러오는 중…</div> : day.exercises.map((exercise, index) => (
          <LogExerciseCard key={`${exercise.id}-${index}`} exercise={exercise} index={index} logs={logs.filter((item) => item.exerciseId === exercise.id)} previous={previous[exercise.id] ?? []} onSave={handleSetSave} />
        ))}
        <button className="finish-button" disabled={completed === 0} onClick={finishWorkout}><Check size={20} /> 운동 완료 · 캘린더에 기록</button>
        <p className="storage-note"><Info size={15} /> 완료 버튼을 눌러야 주간 출석에 포함돼.</p>
      </main>
    </div>
  )
}

function LogExerciseCard({ exercise, index, logs, previous, onSave }) {
  const detail = exerciseLibrary[exercise.id]
  const [tipsOpen, setTipsOpen] = useState(false)
  const [rows, setRows] = useState(() => Array.from({ length: exercise.sets }, (_, setIndex) => ({ weight: exercise.targetWeight ?? '', reps: '', completed: false, setIndex })))

  useEffect(() => {
    setRows(Array.from({ length: exercise.sets }, (_, setIndex) => {
      const stored = logs.find((item) => item.setIndex === setIndex)
      const prior = previous.find((item) => item.setIndex === setIndex)
      return { weight: stored?.weight ?? prior?.weight ?? exercise.targetWeight ?? '', reps: stored?.reps ?? '', completed: Boolean(stored?.completed), setIndex }
    }))
  }, [exercise.sets, exercise.targetWeight, logs, previous])

  const updateRow = (setIndex, field, value) => setRows((current) => current.map((row) => row.setIndex === setIndex ? { ...row, [field]: value } : row))
  const toggleComplete = async (row) => {
    const nextCompleted = !row.completed
    updateRow(row.setIndex, 'completed', nextCompleted)
    await onSave(exercise, row.setIndex, row, nextCompleted)
  }
  const previousText = previous.length ? previous.map((row) => `${row.weight ?? '–'}kg × ${row.reps ?? '–'}`).join(' · ') : '첫 기록 — 오늘이 기준점이 된다'

  return (
    <article className="log-card">
      <div className="log-card-head"><span className="exercise-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{detail.name}</h2><p>{exercise.sets} × {exercise.reps} · RIR {exercise.rir}</p></div><span className="rest-chip"><Clock3 size={14} /> {formatClock(exercise.rest)}</span></div>
      <div className="last-record"><History size={16} /><span><small>지난 기록</small>{previousText}</span></div>
      <div className="live-cue"><Flame size={17} /><strong>{detail.shortCue}</strong></div>
      <div className="set-table">
        <div className="set-table-head"><span>SET</span><span>KG</span><span>REPS</span><span>완료</span></div>
        {rows.map((row) => (
          <div className={`set-row ${row.completed ? 'completed' : ''}`} key={row.setIndex}>
            <strong>{row.setIndex + 1}</strong>
            <input inputMode="decimal" type="number" min="0" step="0.5" value={row.weight} aria-label={`${detail.name} ${row.setIndex + 1}세트 중량`} onChange={(event) => updateRow(row.setIndex, 'weight', event.target.value)} onBlur={() => onSave(exercise, row.setIndex, row, row.completed)} placeholder="–" />
            <input inputMode="numeric" type="number" min="0" step="1" value={row.reps} aria-label={`${detail.name} ${row.setIndex + 1}세트 반복수`} onChange={(event) => updateRow(row.setIndex, 'reps', event.target.value)} onBlur={() => onSave(exercise, row.setIndex, row, row.completed)} placeholder="–" />
            <button className="complete-set" onClick={() => toggleComplete(row)} aria-label={`${detail.name} ${row.setIndex + 1}세트 ${row.completed ? '완료 취소' : '완료'}`}>{row.completed && <Check size={20} strokeWidth={3} />}</button>
          </div>
        ))}
      </div>
      <button className="tips-toggle" onClick={() => setTipsOpen((value) => !value)} aria-expanded={tipsOpen}><span><Info size={17} /> 중량 · 자세 · 자극 · 웜업 팁</span><ChevronDown className={tipsOpen ? 'rotate' : ''} size={19} /></button>
      {tipsOpen && <TipDetails detail={detail} />}
    </article>
  )
}

function TipDetails({ detail }) {
  return (
    <div className="tip-details">
      <div><span>중량</span><p>{detail.weightTip}</p></div>
      <div><span>자세</span><ul>{detail.form.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div><span>정상 자극</span><p>{detail.feel}</p></div>
      <div className="warning-tip"><span><CircleAlert size={14} /> 이상 신호</span><p>{detail.warning}</p></div>
      <div><span>웜업</span><p>{detail.warmup}</p></div>
    </div>
  )
}

function RestTimer({ timer, setTimer, workoutMode = false }) {
  if (!timer.visible) return null
  const progress = timer.total ? ((timer.total - timer.remaining) / timer.total) * 100 : 100
  return (
    <aside className={`rest-timer ${timer.remaining === 0 ? 'done' : ''} ${workoutMode ? 'workout-mode' : ''}`} aria-live="polite">
      <div className="timer-ring" style={{ '--timer-progress': `${progress * 3.6}deg` }}><TimerReset size={19} /></div>
      <div><span>{timer.remaining === 0 ? '다음 세트 준비' : '휴식 타이머'}</span><strong>{formatClock(timer.remaining)}</strong></div>
      <button onClick={() => setTimer((current) => ({ ...current, running: !current.running }))} aria-label={timer.running ? '일시정지' : '계속'}>{timer.running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button>
      <button onClick={() => setTimer((current) => ({ ...current, remaining: current.total, running: true }))} aria-label="타이머 다시 시작"><RotateCcw size={18} /></button>
      <button className="timer-close" onClick={() => setTimer((current) => ({ ...current, visible: false, running: false }))} aria-label="타이머 닫기">×</button>
    </aside>
  )
}

export default App
