import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  ClipboardList,
  Clock3,
  Download,
  Dumbbell,
  FileText,
  Flame,
  History,
  Home,
  Info,
  Minus,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  TimerReset,
  Trash2,
  TrendingUp,
  Trophy,
  Upload,
  X,
} from 'lucide-react'
import routine from './data/routine.json'
import exerciseLibrary from './data/exercises.json'
import { parseQuickWorkout } from './lib/quickParser.js'
import {
  completeWorkoutSession,
  deleteSet,
  exportWorkoutData,
  getAllCompletedSets,
  getDayLog,
  getPreviousExerciseLog,
  getWorkoutHistory,
  getWorkoutSession,
  importWorkoutData,
  saveSet,
  startWorkoutSession,
  updateWorkoutSession,
} from './lib/storage.js'

const weekdayLabels = ['월', '화', '수', '목', '금', '토', '일']
const setTypeLabels = { warmup: '웜업', work: '본세트', drop: '드롭', test: '테스트' }

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function formatToday(date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul',
  }).format(date)
}

function dateFromKey(key) { return new Date(`${key}T00:00:00Z`) }
function keyFromDate(date) { return date.toISOString().slice(0, 10) }
function addDays(key, amount) { const date = dateFromKey(key); date.setUTCDate(date.getUTCDate() + amount); return keyFromDate(date) }

function getWeekRange(reference = localDateKey()) {
  const date = dateFromKey(reference)
  const distanceFromMonday = (date.getUTCDay() + 6) % 7
  const start = addDays(reference, -distanceFromMonday)
  return { start, end: addDays(start, 6) }
}

function shiftWeek(range, weeks) { return { start: addDays(range.start, weeks * 7), end: addDays(range.end, weeks * 7) } }
function inRange(date, range) { return date >= range.start && date <= range.end }
function monthKey(dateKey = localDateKey()) { return dateKey.slice(0, 7) }

function shiftMonth(key, amount) {
  const date = new Date(`${key}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + amount)
  return keyFromDate(date).slice(0, 7)
}

function monthLabel(key) { const [year, month] = key.split('-').map(Number); return `${year}년 ${month}월` }
function formatClock(seconds) { const safe = Math.max(0, Math.round(seconds || 0)); return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}` }
function formatDuration(seconds) { if (!seconds) return '기록 없음'; const minutes = Math.round(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분` }

function maxWeightByExercise(sets) {
  return sets.reduce((result, set) => {
    if (set.setType !== 'warmup' && Number.isFinite(set.weight) && set.weight > 0) result[set.exerciseId] = Math.max(result[set.exerciseId] ?? 0, set.weight)
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
  const [importNotice, setImportNotice] = useState('')
  const selectedDay = routine.days.find((day) => day.id === selectedDayId) ?? routine.days[0]

  const refreshInsights = useCallback(async () => {
    const [sessions, sets] = await Promise.all([getWorkoutHistory(), getAllCompletedSets()])
    setHistory(sessions)
    setCompletedSets(sets)
  }, [])

  useEffect(() => {
    const initialize = async () => {
      const encoded = new URLSearchParams(window.location.hash.slice(1)).get('import')
      if (encoded) {
        try {
          const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
          const base64 = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
          const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
          let jsonText
          if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 압축된 가져오기 링크를 지원하지 않습니다.')
            const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
            jsonText = await new Response(stream).text()
          } else {
            jsonText = new TextDecoder().decode(bytes)
          }
          const data = JSON.parse(jsonText)
          const result = await importWorkoutData(data)
          setImportNotice(`${result.sessions}개 세션과 ${result.sets}개 세트를 이 기기에 가져왔어.`)
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        } catch (error) {
          setImportNotice(`기록을 가져오지 못했어: ${error.message}`)
        }
      }
      await refreshInsights()
    }
    initialize()
  }, [refreshInsights])

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
      name: 'read_week_plan', title: '이번 주 운동 계획 확인',
      description: '요일에 고정되지 않은 주 4회 루틴과 이번 주 완료 상태를 읽습니다.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute() {
        const sessions = await getWorkoutHistory()
        const week = getWeekRange()
        const done = new Set(sessions.filter((session) => inRange(session.date, week)).map((session) => session.dayId))
        return { week, completed: done.size, goal: 4, routines: routine.days.map((day) => ({ id: day.id, name: day.name, recommendedDay: day.recommendedDay, completed: done.has(day.id) })) }
      },
    })

    register({
      name: 'read_workout_history', title: '운동 기록과 일지 읽기',
      description: '누적 운동 세트, 컨디션, 운동시간, 자연어 일지를 날짜나 운동 종목으로 조회합니다.',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' }, exerciseId: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input = {}) {
        const [sessions, sets] = await Promise.all([getWorkoutHistory(), getAllCompletedSets()])
        const filteredSessions = sessions.filter((session) => (!input.from || session.date >= input.from) && (!input.to || session.date <= input.to)).slice(0, input.limit ?? 30)
        const ids = new Set(filteredSessions.map((session) => session.id))
        return {
          sessions: filteredSessions,
          sets: sets.filter((set) => ids.has(`${set.date}:${set.dayId}`) && (!input.exerciseId || set.exerciseId === input.exerciseId)),
        }
      },
    })

    register({
      name: 'record_workout_sets', title: '운동 세트 기록',
      description: '오늘 수행한 운동의 세트를 유형, 중량, 반복수, RIR과 함께 기록합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          dayId: { type: 'string' }, exerciseId: { type: 'string' },
          sets: { type: 'array', minItems: 1, items: { type: 'object', properties: {
            weight: { type: 'number', minimum: 0 }, reps: { type: 'integer', minimum: 0 }, rir: { type: 'string' },
            setType: { type: 'string', enum: ['warmup', 'work', 'drop', 'test'] },
          }, required: ['reps'], additionalProperties: false } },
        }, required: ['dayId', 'exerciseId', 'sets'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input?.dayId)
        const exercise = day?.exercises.find((item) => item.id === input?.exerciseId)
        if (!day || !exercise || !Array.isArray(input.sets)) throw new Error('루틴에 없는 운동입니다.')
        await startWorkoutSession(localDateKey(), day)
        const existing = await getDayLog(localDateKey(), day.id)
        let nextIndex = Math.max(-1, ...existing.filter((set) => set.exerciseId === exercise.id).map((set) => set.setIndex ?? -1)) + 1
        await Promise.all(input.sets.map((set) => saveSet({
          date: localDateKey(), dayId: day.id, exerciseId: exercise.id, exerciseOrder: day.exercises.findIndex((item) => item.id === exercise.id),
          setIndex: nextIndex++, weight: Number.isFinite(set.weight) ? set.weight : null, reps: set.reps, rir: set.rir ?? '', setType: set.setType ?? 'work', completed: true,
        })))
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { recorded: input.sets.length, exercise: exerciseLibrary[exercise.id].name, date: localDateKey() }
      },
    })

    register({
      name: 'save_workout_journal', title: '운동 일지 저장',
      description: '특정 날짜 세션에 자연어 운동 일지와 컨디션 메모를 저장합니다.',
      inputSchema: { type: 'object', properties: { date: { type: 'string' }, dayId: { type: 'string' }, journal: { type: 'string' }, conditionNote: { type: 'string' } }, required: ['date', 'dayId', 'journal'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input.dayId)
        if (!day) throw new Error('루틴을 찾을 수 없습니다.')
        const session = await startWorkoutSession(input.date, day)
        await updateWorkoutSession(input.date, day.id, { journal: input.journal, condition: { ...(session.condition ?? {}), note: input.conditionNote ?? session.condition?.note ?? '' } })
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { saved: true, date: input.date, day: day.name }
      },
    })

    register({
      name: 'complete_workout_session', title: '운동 완료 기록',
      description: '오늘 수행한 루틴을 완료 처리해 캘린더와 주간 리포트에 반영합니다.',
      inputSchema: { type: 'object', properties: { dayId: { type: 'string' } }, required: ['dayId'], additionalProperties: false },
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
    const interval = window.setInterval(() => setTimer((current) => {
      if (current.remaining <= 1) {
        navigator.vibrate?.([120, 80, 120])
        return { ...current, running: false, remaining: 0 }
      }
      return { ...current, remaining: current.remaining - 1 }
    }), 1000)
    return () => window.clearInterval(interval)
  }, [timer.running])

  const startDay = (dayId) => { setSelectedDayId(dayId); setActiveWorkout(true); window.scrollTo({ top: 0 }) }
  const openRoutine = (dayId) => { setSelectedDayId(dayId); setScreen('routine'); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const showScreen = (nextScreen) => { setScreen(nextScreen); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const startTimer = useCallback((seconds) => setTimer({ visible: true, running: true, remaining: seconds, total: seconds }), [])

  if (activeWorkout) return <><WorkoutScreen day={selectedDay} onBack={() => setActiveWorkout(false)} onFinish={async () => { setActiveWorkout(false); await refreshInsights(); setScreen('today') }} onStartTimer={startTimer} /><RestTimer timer={timer} setTimer={setTimer} workoutMode /></>

  return (
    <div className="app-shell">
      <header className="app-header"><div className="brand-mark" aria-hidden="true">YP</div><div className="brand-name"><span>YONGHO</span><strong>PERFORMANCE</strong></div><div className="phase-badge">PHASE 2</div></header>
      <main>
        {screen === 'today' && <TodayScreen nextDay={nextDay} history={history} importNotice={importNotice} onDismissImport={() => setImportNotice('')} onStartDay={startDay} onOpenRoutine={openRoutine} />}
        {screen === 'routine' && <RoutineScreen selectedDay={selectedDay} setSelectedDayId={setSelectedDayId} onStartDay={startDay} />}
        {screen === 'report' && <ReportScreen history={history} completedSets={completedSets} onDataChanged={refreshInsights} />}
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

function TodayScreen({ nextDay, history, importNotice, onDismissImport, onStartDay, onOpenRoutine }) {
  const today = localDateKey()
  const week = getWeekRange(today)
  const weekSessions = history.filter((session) => inRange(session.date, week))
  const monthSessions = history.filter((session) => session.date.startsWith(monthKey(today)))
  const completedIds = new Set(weekSessions.map((session) => session.dayId))
  return <>
    {importNotice && <section className="import-notice"><Check size={18} /><span>{importNotice}</span><button onClick={onDismissImport} aria-label="알림 닫기"><X size={16} /></button></section>}
    <section className="page-heading home-heading"><p>{formatToday()}</p><h1>이번 주 {weekSessions.length}<em>/4</em></h1><span>요일이 밀려도 괜찮아. 가능한 날에 다음 세션을 이어가면 돼.</span></section>
    <section className="weekly-score" aria-label={`이번 주 ${weekSessions.length}회 운동 완료`}><div className="score-copy"><span>WEEKLY GOAL</span><strong>{weekSessions.length >= 4 ? '이번 주 완료' : `${4 - weekSessions.length}회 남음`}</strong></div><div className="goal-dots">{[0, 1, 2, 3].map((index) => <i className={index < weekSessions.length ? 'done' : ''} key={index}>{index < weekSessions.length && <Check size={15} />}</i>)}</div></section>
    <section className="next-session-card"><div className="next-label"><span>NEXT SESSION</span><span>추천 {nextDay.recommendedDay}요일 · 언제든 가능</span></div><div className="next-session-title"><span>{nextDay.sessionLabel}</span><div><h2>{nextDay.name}</h2><p>{nextDay.focus}</p></div></div><div className="next-meta"><span><Clock3 size={16} /> {nextDay.duration}</span><span><Dumbbell size={16} /> {nextDay.exercises.length}개 운동</span></div><button className="primary-button" onClick={() => onStartDay(nextDay.id)}><Play size={19} fill="currentColor" /> 이 루틴 시작</button><button className="text-button" onClick={() => onOpenRoutine(nextDay.id)}>운동 구성 먼저 보기</button></section>
    <section className="section-block"><div className="section-heading"><div><span>FLEXIBLE 4-DAY</span><h2>오늘 다른 루틴을 할래?</h2></div></div><div className="routine-launcher">{routine.days.map((day) => { const completed = completedIds.has(day.id); return <button className={`routine-launch ${completed ? 'completed' : ''}`} key={day.id} onClick={() => onStartDay(day.id)}><span className="session-letter">{completed ? <Check size={20} /> : day.sessionLabel}</span><span><strong>{day.name}</strong><small>추천 {day.recommendedDay} · {day.duration}</small></span><Play size={17} fill="currentColor" /></button> })}</div></section>
    <section className="home-stats"><article><span>이번 주</span><strong>{weekSessions.length}<small>회</small></strong><p>목표 4회</p></article><article><span>이번 달</span><strong>{monthSessions.length}<small>회</small></strong><p>{monthLabel(monthKey(today))}</p></article></section>
    <section className="coach-note"><Sparkles size={20} /><div><strong>기준 루틴과 오늘 기록은 분리돼</strong><p>오늘 세트·중량·RIR을 바꿔도 다음 세션의 기준 루틴은 그대로 유지돼. 실제 컨디션에 맞게 기록하면 돼.</p></div></section>
  </>
}

function RoutineScreen({ selectedDay, setSelectedDayId, onStartDay }) {
  return <>
    <section className="page-heading compact"><p>{routine.name}</p><h1>기준 루틴</h1><span>추천값은 프로그램 기준이다. 운동을 시작한 뒤의 변경은 그날 기록에만 적용된다.</span></section>
    <div className="day-tabs" role="tablist" aria-label="루틴 선택">{routine.days.map((day) => <button role="tab" aria-selected={day.id === selectedDay.id} className={day.id === selectedDay.id ? 'active' : ''} onClick={() => setSelectedDayId(day.id)} key={day.id}><span>{day.sessionLabel}</span><strong>{day.name.replace(' + ', '+')}</strong><small>추천 {day.recommendedDay}</small></button>)}</div>
    <section className="routine-hero"><div className="routine-icon">{selectedDay.sessionLabel}</div><div className="routine-title"><span>추천 {selectedDay.recommendedDay}요일 · {selectedDay.duration}</span><h2>{selectedDay.name}</h2><p>{selectedDay.focus}</p></div><Activity size={26} /><button className="primary-button" onClick={() => onStartDay(selectedDay.id)}><Play size={18} fill="currentColor" /> 오늘 이 루틴 시작</button></section>
    <section className="routine-exercises">{selectedDay.exercises.map((exercise, index) => <ExerciseInfoCard exercise={exercise} index={index} key={`${exercise.id}-${index}`} />)}</section>
  </>
}

function ReportScreen({ history, completedSets, onDataChanged }) {
  const today = localDateKey()
  const [visibleMonth, setVisibleMonth] = useState(monthKey(today))
  const [selectedDate, setSelectedDate] = useState(today)
  const [openSessionId, setOpenSessionId] = useState(null)
  const [backupMessage, setBackupMessage] = useState('')
  const importRef = useRef(null)
  const currentWeek = getWeekRange(today)
  const previousWeek = shiftWeek(currentWeek, -1)
  const currentSessions = history.filter((session) => inRange(session.date, currentWeek))
  const previousSessions = history.filter((session) => inRange(session.date, previousWeek))
  const monthSessions = history.filter((session) => session.date.startsWith(visibleMonth))
  const selectedSessions = history.filter((session) => session.date === selectedDate)
  const durationSessions = history.filter((session) => session.durationSec > 0)
  const averageDuration = durationSessions.length ? durationSessions.reduce((sum, session) => sum + session.durationSec, 0) / durationSessions.length : 0

  const currentMax = maxWeightByExercise(completedSets.filter((set) => inRange(set.date, currentWeek)))
  const previousMax = maxWeightByExercise(completedSets.filter((set) => inRange(set.date, previousWeek)))
  const comparisons = Object.entries(currentMax).filter(([exerciseId]) => previousMax[exerciseId] != null).map(([exerciseId, weight]) => ({ exerciseId, weight, previous: previousMax[exerciseId], delta: weight - previousMax[exerciseId] })).sort((a, b) => b.delta - a.delta)
  const improved = comparisons.filter((item) => item.delta > 0.001)
  const firstOfMonth = `${visibleMonth}-01`
  const leadingDays = (dateFromKey(firstOfMonth).getUTCDay() + 6) % 7
  const gridStart = addDays(firstOfMonth, -leadingDays)
  const calendarDays = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  const attendanceDelta = currentSessions.length - previousSessions.length

  const downloadBackup = async () => {
    const data = await exportWorkoutData()
    const href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = href; anchor.download = `yongho-performance-${today}.json`; anchor.click(); URL.revokeObjectURL(href)
    setBackupMessage('백업 파일을 저장했어.')
  }

  const handleImport = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const result = await importWorkoutData(JSON.parse(await file.text()))
      setBackupMessage(`${result.sessions}개 세션과 ${result.sets}개 세트를 복원했어.`)
      await onDataChanged()
    } catch (error) { setBackupMessage(error.message) }
    event.target.value = ''
  }

  return <>
    <section className="page-heading compact"><p>TRAINING LOG</p><h1>기록과 리포트</h1><span>숫자, 운동시간, 컨디션과 자연어 일지를 한 세션으로 본다.</span></section>
    <section className="report-summary"><article className="report-main-card"><span>이번 주 출석</span><strong>{currentSessions.length}<small>/4회</small></strong><div className="attendance-bar"><i style={{ width: `${Math.min(100, (currentSessions.length / 4) * 100)}%` }} /></div><p className={attendanceDelta >= 0 ? 'positive' : ''}>{attendanceDelta === 0 ? '지난주와 같은 페이스' : `지난주보다 ${Math.abs(attendanceDelta)}회 ${attendanceDelta > 0 ? '더 운동 중' : '적게 운동 중'}`}</p></article><article className="report-side-card"><TrendingUp size={20} /><span>증량 종목</span><strong>{improved.length}<small>개</small></strong><p>웜업 제외 최고 중량</p></article></section>
    <section className="duration-card"><Clock3 size={21} /><div><span>평균 운동시간</span><strong>{formatDuration(averageDuration)}</strong></div><p>{durationSessions.length}개 세션 기준</p></section>
    <section className="calendar-card"><div className="calendar-head"><div><span>MONTHLY</span><h2>{monthLabel(visibleMonth)}</h2></div><div><button aria-label="이전 달" onClick={() => setVisibleMonth((month) => shiftMonth(month, -1))}><ChevronLeft size={20} /></button><button aria-label="다음 달" onClick={() => setVisibleMonth((month) => shiftMonth(month, 1))}><ChevronRight size={20} /></button></div></div><div className="month-total"><CalendarDays size={18} /><span>이달의 운동</span><strong>{monthSessions.length}회</strong></div><div className="calendar-weekdays">{weekdayLabels.map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{calendarDays.map((date) => { const sessions = history.filter((session) => session.date === date); const outside = !date.startsWith(visibleMonth); const selected = date === selectedDate; const isToday = date === today; return <button key={date} className={`${outside ? 'outside' : ''} ${selected ? 'selected' : ''} ${sessions.length ? 'trained' : ''}`} onClick={() => { setSelectedDate(date); setOpenSessionId(null) }} aria-label={`${date}${sessions.length ? ` 운동 ${sessions.length}회` : ''}`}><span>{Number(date.slice(-2))}</span>{isToday && <i className="today-mark">오늘</i>}{sessions.length > 0 && <i className="workout-mark">{sessions.length}</i>}</button> })}</div>
      <div className="selected-date-log"><div><span>{selectedDate.replaceAll('-', '.')}</span><strong>{selectedSessions.length ? `${selectedSessions.length}개 세션 완료` : '운동 기록 없음'}</strong></div>{selectedSessions.map((session) => { const day = routine.days.find((item) => item.id === session.dayId); if (!day) return null; const open = openSessionId === session.id; return <div key={session.id}><button className="date-session session-button" onClick={() => setOpenSessionId(open ? null : session.id)}><span>{day.sessionLabel}</span><p><strong>{day.name}</strong><small>{session.setCount ?? 0}세트 · {formatDuration(session.durationSec)}</small></p><ChevronDown className={open ? 'rotate' : ''} size={18} /></button>{open && <SessionDetail session={session} sets={completedSets.filter((set) => `${set.date}:${set.dayId}` === session.id)} />}</div> })}</div>
    </section>
    <section className="weekly-report-card"><div className="section-heading"><div><span>WEEKLY REPORT</span><h2>지난주보다 좋아진 점</h2></div><Trophy size={23} /></div>{comparisons.length === 0 ? <div className="empty-report"><TrendingUp size={24} /><strong>비교할 기록을 쌓는 중</strong><p>같은 운동을 지난주와 이번 주에 기록하면 변화가 여기에 나타나.</p></div> : <div className="progress-list">{comparisons.slice(0, 5).map((item) => <div key={item.exerciseId}><span><strong>{exerciseLibrary[item.exerciseId]?.name ?? item.exerciseId}</strong><small>{item.previous}kg → {item.weight}kg</small></span><em className={item.delta > 0 ? 'up' : item.delta < 0 ? 'down' : ''}>{item.delta > 0 ? `+${item.delta}` : item.delta}kg</em></div>)}</div>}</section>
    <section className="backup-card"><div className="section-heading"><div><span>LOCAL BACKUP</span><h2>기록 백업과 복원</h2></div><FileText size={22} /></div><p>현재는 기기 안에 저장돼. 정기적으로 백업 파일을 보관하면 앱 데이터가 지워져도 복원할 수 있어.</p><div><button onClick={downloadBackup}><Download size={17} /> 백업 저장</button><button onClick={() => importRef.current?.click()}><Upload size={17} /> 백업 불러오기</button></div><input ref={importRef} type="file" accept="application/json" hidden onChange={handleImport} />{backupMessage && <small>{backupMessage}</small>}</section>
  </>
}

function SessionDetail({ session, sets }) {
  const groups = [...new Set(sets.map((set) => set.exerciseId))].sort((a, b) => {
    const orderA = Math.min(...sets.filter((set) => set.exerciseId === a).map((set) => set.exerciseOrder ?? 999))
    const orderB = Math.min(...sets.filter((set) => set.exerciseId === b).map((set) => set.exerciseOrder ?? 999))
    return orderA - orderB
  })
  return <div className="session-detail">
    <div className="detail-meta"><span><Clock3 size={15} /> {formatDuration(session.durationSec)}{session.durationSource === 'reported' ? ' · 직접 기록' : ''}</span>{session.condition?.sleepMinutes && <span><Moon size={15} /> 수면 {Math.floor(session.condition.sleepMinutes / 60)}시간 {session.condition.sleepMinutes % 60}분</span>}</div>
    {session.condition?.tags?.length > 0 && <div className="condition-tags">{session.condition.tags.map((tag) => <i key={tag}>{tag}</i>)}</div>}
    {session.condition?.strategy && <div className="detail-note"><strong>오늘의 전략</strong><p>{session.condition.strategy}</p></div>}
    <div className="detail-sets">{groups.map((exerciseId) => <div key={exerciseId}><strong>{exerciseLibrary[exerciseId]?.name ?? exerciseId}</strong>{sets.filter((set) => set.exerciseId === exerciseId).sort((a, b) => a.setIndex - b.setIndex).map((set) => <p key={set.id}><i>{setTypeLabels[set.setType] ?? '본세트'}</i><span>{set.weightLabel || (set.weight != null ? `${set.weight}kg` : '–')} × {set.reps ?? '–'}{set.rir ? ` · RIR ${set.rir}` : ''}</span></p>)}{session.exerciseNotes?.[exerciseId] && <small>{session.exerciseNotes[exerciseId]}</small>}</div>)}</div>
    {session.journal && <div className="journal-view"><strong>오늘의 운동 일지</strong><p>{session.journal}</p></div>}
    {session.aiAnalysis && <div className="ai-view"><strong>AI 분석</strong><p>{session.aiAnalysis}</p></div>}
  </div>
}

function ExerciseInfoCard({ exercise, index }) {
  const [open, setOpen] = useState(false)
  const detail = exerciseLibrary[exercise.id]
  return <article className={`info-card ${open ? 'open' : ''}`}><button className="info-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="exercise-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{detail.name}</h3><p>{exercise.sets} × {exercise.reps} · RIR {exercise.rir} · {formatClock(exercise.rest)}</p></div><ChevronDown className="chevron" size={20} /></button><div className="cue-line"><Flame size={16} /><span>{detail.shortCue}</span></div>{open && <TipDetails detail={detail} />}</article>
}

function WorkoutScreen({ day, onBack, onFinish, onStartTimer }) {
  const date = localDateKey()
  const [logs, setLogs] = useState([])
  const [previous, setPrevious] = useState({})
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [externalRevision, setExternalRevision] = useState(0)

  const load = useCallback(async () => {
    const currentSession = await startWorkoutSession(date, day)
    const [currentLogs, ...priorRows] = await Promise.all([getDayLog(date, day.id), ...[...new Set(day.exercises.map((exercise) => exercise.id))].map((exerciseId) => getPreviousExerciseLog(exerciseId, date))])
    setLogs(currentLogs)
    setPrevious(Object.fromEntries([...new Set(day.exercises.map((exercise) => exercise.id))].map((exerciseId, index) => [exerciseId, priorRows[index]])))
    setSession(currentSession)
    setLoading(false)
  }, [date, day])

  useEffect(() => { load() }, [load])
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval) }, [])

  const updateLocalLog = (entry) => setLogs((current) => [...current.filter((item) => !(item.exerciseId === entry.exerciseId && item.setIndex === entry.setIndex)), entry])
  const handleSetSave = async (exercise, row, startRest = false, restSeconds = exercise.rest) => {
    const entry = {
      date, dayId: day.id, exerciseId: exercise.id, exerciseOrder: day.exercises.findIndex((item) => item.id === exercise.id), setIndex: row.setIndex,
      setType: row.setType, weight: row.weight === '' ? null : Number(row.weight), weightLabel: row.weightLabel ?? '', reps: row.reps === '' ? null : Number(row.reps), rir: row.rir ?? '', completed: Boolean(row.completed), note: row.note ?? '',
    }
    await saveSet(entry)
    updateLocalLog({ ...entry, id: `${date}:${day.id}:${exercise.id}:${row.setIndex}` })
    if (startRest && row.completed) onStartTimer(restSeconds)
  }
  const handleDelete = async (exercise, row) => { await deleteSet({ date, dayId: day.id, exerciseId: exercise.id, setIndex: row.setIndex }); setLogs((current) => current.filter((item) => !(item.exerciseId === exercise.id && item.setIndex === row.setIndex))) }
  const patchSession = async (patch) => { const updated = await updateWorkoutSession(date, day.id, patch); setSession(updated); return updated }
  const updateRest = async (exerciseId, seconds) => patchSession({ restOverrides: { ...(session?.restOverrides ?? {}), [exerciseId]: seconds } })
  const updateExerciseNote = async (exerciseId, note) => patchSession({ exerciseNotes: { ...(session?.exerciseNotes ?? {}), [exerciseId]: note } })

  const importQuickLog = async (groups, text) => {
    const additions = []
    for (const group of groups) {
      const exercise = day.exercises.find((item) => item.id === group.exerciseId)
      let nextIndex = Math.max(-1, ...logs.filter((item) => item.exerciseId === group.exerciseId).map((item) => item.setIndex ?? -1), ...additions.filter((item) => item.exerciseId === group.exerciseId).map((item) => item.setIndex)) + 1
      for (const row of group.sets) {
        const entry = { date, dayId: day.id, exerciseId: group.exerciseId, exerciseOrder: day.exercises.indexOf(exercise), setIndex: nextIndex++, ...row, weight: row.weight === '' ? null : Number(row.weight), reps: row.reps === '' ? null : Number(row.reps), completed: true }
        await saveSet(entry); additions.push({ ...entry, id: `${date}:${day.id}:${group.exerciseId}:${entry.setIndex}` })
      }
    }
    setLogs((current) => [...current, ...additions])
    const journal = [session?.journal, text && `[빠른 기록 원문]\n${text}`].filter(Boolean).join('\n\n')
    await patchSession({ journal })
    setExternalRevision((value) => value + 1)
  }

  const completed = logs.filter((item) => item.completed).length
  const elapsedSec = session?.durationSec ?? (session?.startedAt ? Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 1000)) : 0)
  const finishWorkout = async () => { await completeWorkoutSession(date, day.id, { durationSec: elapsedSec }); window.dispatchEvent(new CustomEvent('yp:log-updated')); onFinish() }

  return <div className="workout-shell"><header className="workout-header"><button className="icon-button" onClick={onBack} aria-label="운동 화면 닫기"><ArrowLeft size={23} /></button><div><span>{day.sessionLabel} SESSION · {formatToday()}</span><h1>{day.name}</h1></div><strong>{formatClock(elapsedSec)}</strong></header><div className="workout-progress"><span style={{ width: `${Math.min(100, (completed / Math.max(1, day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0))) * 100)}%` }} /></div>
    <main className="workout-main"><section className="session-intro"><div><Clock3 size={18} /><span>진행 {formatDuration(elapsedSec)}</span></div><p>{day.focus}</p></section>
      <section className="session-rule"><Info size={17} /><p><strong>오늘 기록만 자유롭게 변경</strong>세트와 중량을 바꿔도 기준 루틴은 그대로 유지돼.</p></section>
      {loading ? <div className="loading-card">기록을 불러오는 중…</div> : day.exercises.map((exercise, index) => <LogExerciseCard key={`${exercise.id}-${externalRevision}`} exercise={exercise} index={index} logs={logs.filter((item) => item.exerciseId === exercise.id)} previous={previous[exercise.id] ?? []} restValue={session?.restOverrides?.[exercise.id] ?? exercise.rest} exerciseNote={session?.exerciseNotes?.[exercise.id] ?? ''} onSave={handleSetSave} onDelete={handleDelete} onRestChange={updateRest} onNoteChange={updateExerciseNote} />)}
      {!loading && <QuickLogCard day={day} onImport={importQuickLog} onJournalOnly={async (text) => patchSession({ journal: [session?.journal, text].filter(Boolean).join('\n\n') })} />}
      {!loading && <SessionNotesCard session={session} onSave={patchSession} />}
      <button className="finish-button" disabled={completed === 0} onClick={finishWorkout}><Check size={20} /> {session?.status === 'completed' ? '운동 기록 업데이트' : '운동 완료'} · {formatDuration(elapsedSec)}</button><p className="storage-note"><Info size={15} /> 완료하면 캘린더·운동시간·주간 리포트에 함께 반영돼.</p>
    </main>
  </div>
}

function makeRows(exercise, logs) {
  const stored = [...logs].sort((a, b) => (a.setIndex ?? 0) - (b.setIndex ?? 0)).map((row) => ({ ...row, weight: row.weight ?? '', reps: row.reps ?? '', rir: row.rir ?? '', setType: row.setType ?? 'work' }))
  const storedIndices = new Set(stored.map((row) => row.setIndex))
  const defaults = Array.from({ length: exercise.sets }, (_, setIndex) => ({ setIndex, setType: 'work', weight: exercise.targetWeight ?? '', weightLabel: '', reps: '', rir: exercise.rir ?? '', completed: false })).filter((row) => !storedIndices.has(row.setIndex))
  return [...stored, ...defaults].sort((a, b) => a.setIndex - b.setIndex)
}

function LogExerciseCard({ exercise, index, logs, previous, restValue, exerciseNote, onSave, onDelete, onRestChange, onNoteChange }) {
  const detail = exerciseLibrary[exercise.id]
  const [tipsOpen, setTipsOpen] = useState(false)
  const [restOpen, setRestOpen] = useState(false)
  const [restSeconds, setRestSeconds] = useState(restValue)
  const [note, setNote] = useState(exerciseNote)
  const [rows, setRows] = useState(() => makeRows(exercise, logs))
  const updateRow = (setIndex, patch) => setRows((current) => current.map((row) => row.setIndex === setIndex ? { ...row, ...patch } : row))
  const persistRow = (row, patch = {}, startRest = false) => { const next = { ...row, ...patch }; updateRow(row.setIndex, patch); return onSave(exercise, next, startRest, restSeconds) }
  const addRow = () => setRows((current) => [...current, { setIndex: Math.max(-1, ...current.map((row) => row.setIndex)) + 1, setType: 'work', weight: exercise.targetWeight ?? '', weightLabel: '', reps: '', rir: exercise.rir ?? '', completed: false }])
  const removeRow = async (row) => { setRows((current) => current.filter((item) => item.setIndex !== row.setIndex)); await onDelete(exercise, row) }
  const previousText = previous.length ? previous.map((row) => `${setTypeLabels[row.setType] ? `${setTypeLabels[row.setType]} ` : ''}${row.weightLabel || (row.weight != null ? `${row.weight}kg` : '–')} × ${row.reps ?? '–'}`).join(' · ') : '첫 기록 — 오늘이 기준점이 된다'
  const changeRest = (next) => { const safe = Math.max(15, Math.min(600, next)); setRestSeconds(safe); onRestChange(exercise.id, safe) }

  return <article className="log-card"><div className="log-card-head"><span className="exercise-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{detail.name}</h2><p>기준 {exercise.sets} × {exercise.reps} · RIR {exercise.rir}</p></div><button className="rest-chip" onClick={() => setRestOpen((value) => !value)}><Clock3 size={14} /> {formatClock(restSeconds)}</button></div>
    {restOpen && <div className="rest-editor"><span>이 운동의 오늘 휴식</span><button onClick={() => changeRest(restSeconds - 15)}><Minus size={16} /></button><strong>{formatClock(restSeconds)}</strong><button onClick={() => changeRest(restSeconds + 15)}><Plus size={16} /></button><small>완료 체크 시 자동 시작</small></div>}
    <div className="last-record"><History size={16} /><span><small>지난 기록</small>{previousText}</span></div><div className="live-cue"><Flame size={17} /><strong>{detail.shortCue}</strong></div>
    <div className="set-list"><div className="set-list-head"><span>오늘 실제 수행</span><small>각 세트는 독립적으로 저장돼</small></div>{rows.map((row, displayIndex) => <div className={`set-row-v2 ${row.completed ? 'completed' : ''}`} key={row.setIndex}><div className="set-row-top"><strong>{displayIndex + 1}</strong><select value={row.setType} aria-label={`${detail.name} ${displayIndex + 1}세트 유형`} onChange={(event) => persistRow(row, { setType: event.target.value })}>{Object.entries(setTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="delete-set" onClick={() => removeRow(row)} aria-label="세트 삭제"><Trash2 size={16} /></button></div><div className="set-fields"><label><span>KG</span><input inputMode="decimal" type="number" min="0" step="0.5" value={row.weight} onChange={(event) => updateRow(row.setIndex, { weight: event.target.value, weightLabel: '' })} onBlur={() => onSave(exercise, row, false, restSeconds)} placeholder={row.weightLabel || '–'} /></label><label><span>REPS</span><input inputMode="numeric" type="number" min="0" step="1" value={row.reps} onChange={(event) => updateRow(row.setIndex, { reps: event.target.value })} onBlur={() => onSave(exercise, row, false, restSeconds)} placeholder="–" /></label><label><span>RIR</span><input inputMode="decimal" value={row.rir} onChange={(event) => updateRow(row.setIndex, { rir: event.target.value })} onBlur={() => onSave(exercise, row, false, restSeconds)} placeholder="–" /></label><button className="complete-set" onClick={() => persistRow(row, { completed: !row.completed }, !row.completed)} aria-label={`${detail.name} ${displayIndex + 1}세트 ${row.completed ? '완료 취소' : '완료'}`}>{row.completed && <Check size={20} strokeWidth={3} />}</button></div></div>)}</div>
    <button className="add-set" onClick={addRow}><Plus size={17} /> 오늘 세트 추가</button>
    <label className="exercise-note"><span>이 운동의 느낌</span><textarea value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => onNoteChange(exercise.id, note)} placeholder="자극 위치, 자세, 통증, 다음에 바꿀 점…" /></label>
    <button className="tips-toggle" onClick={() => setTipsOpen((value) => !value)} aria-expanded={tipsOpen}><span><Info size={17} /> 중량 · 자세 · 자극 · 웜업 팁</span><ChevronDown className={tipsOpen ? 'rotate' : ''} size={19} /></button>{tipsOpen && <TipDetails detail={detail} />}
  </article>
}

function QuickLogCard({ day, onImport, onJournalOnly }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState([])
  const [message, setMessage] = useState('')
  const parse = () => { const parsed = parseQuickWorkout(text, day); setPreview(parsed); setMessage(parsed.length ? '해석 결과를 확인하고 필요한 값을 고친 뒤 저장해.' : '세트 숫자는 찾지 못했어. 원문을 일지로만 저장할 수 있어.') }
  const patchPreview = (exerciseId, setIndex, patch) => setPreview((current) => current.map((group) => group.exerciseId === exerciseId ? { ...group, sets: group.sets.map((set, index) => index === setIndex ? { ...set, ...patch } : set) } : group))
  const removePreview = (exerciseId, setIndex) => setPreview((current) => current.map((group) => group.exerciseId === exerciseId ? { ...group, sets: group.sets.filter((_, index) => index !== setIndex) } : group).filter((group) => group.sets.length))
  const save = async () => { await onImport(preview, text); setText(''); setPreview([]); setMessage('오늘 세트와 원문 일지에 저장했어.') }
  const journalOnly = async () => { await onJournalOnly(text); setText(''); setMessage('원문을 오늘 일지에 저장했어.') }

  return <section className="quick-log-card"><button className="quick-log-toggle" onClick={() => setOpen((value) => !value)}><span><ClipboardList size={20} /><span><strong>말하듯 빠른 기록</strong><small>입력 → 해석 확인 → 저장</small></span></span><ChevronDown className={open ? 'rotate' : ''} size={20} /></button>{open && <div className="quick-log-body"><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="예: 랫풀은 40kg 12개 웜업, 47kg 10개, 47kg 8개 했어…" /><div className="quick-actions"><button onClick={parse} disabled={!text.trim()}><Sparkles size={17} /> 세트로 해석</button><button onClick={journalOnly} disabled={!text.trim()}><FileText size={17} /> 일지만 저장</button></div>{message && <p className="parse-message">{message}</p>}{preview.map((group) => <div className="parse-group" key={group.exerciseId}><strong>{exerciseLibrary[group.exerciseId]?.name ?? group.exerciseId}</strong>{group.sets.map((set, setIndex) => <div key={setIndex}><select value={set.setType} onChange={(event) => patchPreview(group.exerciseId, setIndex, { setType: event.target.value })}>{Object.entries(setTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input type="number" inputMode="decimal" value={set.weight} onChange={(event) => patchPreview(group.exerciseId, setIndex, { weight: event.target.value })} placeholder={set.weightLabel || 'kg'} /><input type="number" inputMode="numeric" value={set.reps} onChange={(event) => patchPreview(group.exerciseId, setIndex, { reps: event.target.value })} placeholder="회" /><input value={set.rir} onChange={(event) => patchPreview(group.exerciseId, setIndex, { rir: event.target.value })} placeholder="RIR" /><button onClick={() => removePreview(group.exerciseId, setIndex)}><X size={15} /></button></div>)}</div>)}{preview.length > 0 && <button className="save-parsed" onClick={save}><Save size={17} /> 확인한 기록 저장</button>}</div>}</section>
}

function SessionNotesCard({ session, onSave }) {
  const [open, setOpen] = useState(Boolean(session?.journal || session?.condition?.note))
  const [condition, setCondition] = useState(session?.condition ?? {})
  const [journal, setJournal] = useState(session?.journal ?? '')
  const [saved, setSaved] = useState(false)
  const save = async () => { await onSave({ condition, journal }); setSaved(true); window.setTimeout(() => setSaved(false), 1600) }
  const setField = (field, value) => setCondition((current) => ({ ...current, [field]: value }))
  return <section className="session-notes-card"><button className="quick-log-toggle" onClick={() => setOpen((value) => !value)}><span><FileText size={20} /><span><strong>컨디션 · 운동 일지</strong><small>숫자와 함께 이 세션에 보존</small></span></span><ChevronDown className={open ? 'rotate' : ''} size={20} /></button>{open && <div className="notes-body"><div className="condition-grid"><label><span>취침</span><input type="time" value={condition.bedtime ?? ''} onChange={(event) => setField('bedtime', event.target.value)} /></label><label><span>기상</span><input type="time" value={condition.wakeTime ?? ''} onChange={(event) => setField('wakeTime', event.target.value)} /></label><label><span>수면(분)</span><input type="number" inputMode="numeric" value={condition.sleepMinutes ?? ''} onChange={(event) => setField('sleepMinutes', event.target.value === '' ? '' : Number(event.target.value))} placeholder="330" /></label><label><span>컨디션</span><select value={condition.energy ?? ''} onChange={(event) => setField('energy', event.target.value)}><option value="">선택</option><option>낮음</option><option>보통</option><option>좋음</option><option>매우 좋음</option></select></label></div><label><span>오늘의 훈련 전략</span><textarea value={condition.strategy ?? ''} onChange={(event) => setField('strategy', event.target.value)} placeholder="예: 평소 강도의 70~80%, 자세와 자극 우선" /></label><label><span>컨디션 메모</span><textarea value={condition.note ?? ''} onChange={(event) => setField('note', event.target.value)} placeholder="수면 부족, 피로감, 통증이나 불편감…" /></label><label><span>오늘의 운동 일지</span><textarea className="journal-input" value={journal} onChange={(event) => setJournal(event.target.value)} placeholder="운동 전체 느낌을 말하듯 자유롭게 남겨도 돼." /></label><button className="save-notes" onClick={save}><Save size={17} /> {saved ? '저장 완료' : '컨디션과 일지 저장'}</button></div>}</section>
}

function TipDetails({ detail }) {
  return <div className="tip-details"><div><span>중량</span><p>{detail.weightTip}</p></div><div><span>자세</span><ul>{detail.form.map((item) => <li key={item}>{item}</li>)}</ul></div><div><span>정상 자극</span><p>{detail.feel}</p></div><div className="warning-tip"><span><CircleAlert size={14} /> 이상 신호</span><p>{detail.warning}</p></div><div><span>웜업</span><p>{detail.warmup}</p></div></div>
}

function RestTimer({ timer, setTimer, workoutMode = false }) {
  if (!timer.visible) return null
  const progress = timer.total ? ((timer.total - timer.remaining) / timer.total) * 100 : 100
  const adjust = (amount) => setTimer((current) => ({ ...current, remaining: Math.max(0, current.remaining + amount), total: Math.max(15, current.total + amount) }))
  return <aside className={`rest-timer ${timer.remaining === 0 ? 'done' : ''} ${workoutMode ? 'workout-mode' : ''}`} aria-live="polite"><div className="timer-ring" style={{ '--timer-progress': `${progress * 3.6}deg` }}><TimerReset size={19} /></div><div><span>{timer.remaining === 0 ? '다음 세트 준비' : '휴식 타이머'}</span><strong>{formatClock(timer.remaining)}</strong></div><button onClick={() => adjust(-15)} aria-label="15초 줄이기"><Minus size={17} /></button><button onClick={() => setTimer((current) => ({ ...current, running: !current.running }))} aria-label={timer.running ? '일시정지' : '계속'}>{timer.running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button onClick={() => adjust(15)} aria-label="15초 늘리기"><Plus size={17} /></button><button onClick={() => setTimer((current) => ({ ...current, remaining: current.total, running: true }))} aria-label="타이머 다시 시작"><RotateCcw size={18} /></button><button className="timer-close" onClick={() => setTimer((current) => ({ ...current, visible: false, running: false }))} aria-label="타이머 닫기">×</button></aside>
}

export default App
