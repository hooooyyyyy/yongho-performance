import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  Clock3,
  Cloud,
  Dumbbell,
  FileText,
  Flame,
  History,
  Home,
  Info,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  TimerReset,
  Trash2,
  X,
} from 'lucide-react'
import DisplaySettings from './components/DisplaySettings.jsx'
import { readPreferences, applyPreferences, tactileFeedback } from './lib/uiPreferences.js'
import RecordsScreen from './components/RecordsScreen.jsx'
import CloudScreen, { cloudStatus } from './components/CloudScreen.jsx'
import { useCloudSync } from './lib/cloud/useCloudSync.js'
import { createWorkoutWrites } from './lib/workoutWrites.js'
import { makeRows } from './lib/sessionRows.js'
import routine from './data/routine.json'
import exerciseLibrary from './data/exercises.json'
import { parseQuickWorkout } from './lib/quickParser.js'
import { buildExerciseInsights, buildTrainingSummary } from './lib/insights.js'
import {
  completeWorkoutSession,
  cancelEmptyWorkoutSession,
  isEmptyWorkoutSession,
  reportArchive,
  deleteSet,
  getAllCompletedSets,
  getDayLog,
  getPreviousExerciseLog,
  getPreviousExerciseReview,
  getWorkoutHistory,
  getWorkoutSession,
  importWorkoutData,
  saveSet,
  startWorkoutSession,
  updateWorkoutSession,
} from './lib/storage.js'

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

function inRange(date, range) { return date >= range.start && date <= range.end }
function monthKey(dateKey = localDateKey()) { return dateKey.slice(0, 7) }

function monthLabel(key) { const [year, month] = key.split('-').map(Number); return `${year}년 ${month}월` }
function formatClock(seconds) { const safe = Math.max(0, Math.round(seconds || 0)); return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}` }
function formatDuration(seconds) { if (!seconds) return '기록 없음'; const minutes = Math.round(seconds / 60); return minutes >= 60 ? `${Math.floor(minutes / 60)}시간 ${minutes % 60}분` : `${minutes}분` }

function App() {
  const [screen, setScreen] = useState(() => new URLSearchParams(window.location.search).has('authorization_id') ? 'cloud' : 'today')
  const [preferences, setPreferences] = useState(readPreferences)
  useEffect(() => { applyPreferences(preferences) }, [preferences])
  const [selectedDayId, setSelectedDayId] = useState(routine.days[0].id)
  const [activeWorkout, setActiveWorkout] = useState(false)
  const [workoutDate, setWorkoutDate] = useState(localDateKey)
  const [recordFocus, setRecordFocus] = useState({})
  const [timer, setTimer] = useState({ visible: false, running: false, remaining: 0, total: 0 })
  const [history, setHistory] = useState([])
  const [completedSets, setCompletedSets] = useState([])
  const [importNotice, setImportNotice] = useState('')
  const cloud = useCloudSync(activeWorkout)
  useEffect(() => { if (cloud.recovery) setScreen('cloud') }, [cloud.recovery])
  const selectedDay = routine.days.find((day) => day.id === selectedDayId) ?? routine.days[0]

  const refreshInsights = useCallback(async () => {
    const [sessions, sets] = await Promise.all([getWorkoutHistory({ includeStarted: true }), getAllCompletedSets()])
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
          setImportNotice(`새 기록 ${result.imported}개 · 중복 ${result.duplicates}개 · 충돌 ${result.conflicts}개. 충돌 기록은 기존 내용을 유지하고 백업에 별도로 보존했어.`)
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
        } catch (error) {
          setImportNotice(`기록을 가져오지 못했어: ${error.message}`)
        }
      }
      await refreshInsights()
    }
    const onBlocked = () => setImportNotice('기록 업데이트를 위해 다른 탭이나 열려 있는 앱을 닫고 다시 열어주세요.')
    window.addEventListener('yp:storage-blocked', onBlocked)
    initialize().catch((error) => setImportNotice(`기록을 열지 못했어: ${error.message}. 데이터는 삭제하지 않았어.`))
    return () => window.removeEventListener('yp:storage-blocked', onBlocked)
  }, [refreshInsights])

  useEffect(() => {
    const handleUpdate = () => refreshInsights().catch((error) => setImportNotice(`기록을 읽지 못했어: ${error.message}`))
    window.addEventListener('yp:log-updated', handleUpdate)
    return () => window.removeEventListener('yp:log-updated', handleUpdate)
  }, [refreshInsights])

  const currentWeek = getWeekRange()
  const completedThisWeek = history.filter((session) => session.status !== 'started' && inRange(session.date, currentWeek))
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
      name: 'read_training_summary', title: '성장 추세와 다음 운동 방향 읽기',
      description: '누적 세트, 반복수, RIR, 운동시간과 수행 메모를 함께 계산한 운동별 추세와 다음 세션 방향을 읽습니다.',
      inputSchema: {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      async execute(input = {}) {
        const [sessions, sets] = await Promise.all([getWorkoutHistory(), getAllCompletedSets()])
        const range = input.from || input.to ? { start: input.from ?? '0000-00-00', end: input.to ?? '9999-12-31' } : null
        return buildTrainingSummary(sessions, sets, routine, exerciseLibrary, range)
      },
    })

    register({
      name: 'record_workout_sets', title: '운동 세트 기록',
      description: '지정 날짜(생략 시 오늘)의 세트를 추가합니다. 미기록 반복수는 null로 보존합니다. 동일 요청을 반복하면 세트가 추가되므로 재시도 전 조회하세요.',
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string' }, dayId: { type: 'string' }, exerciseId: { type: 'string' },
          sets: { type: 'array', minItems: 1, items: { type: 'object', properties: {
            weight: { type: ['number', 'null'], minimum: 0 }, reps: { type: ['integer', 'null'], minimum: 0 }, rir: { type: 'string' },
            setType: { type: 'string', enum: ['warmup', 'work', 'drop', 'test'] },
          }, required: ['reps'], additionalProperties: false } },
        }, required: ['dayId', 'exerciseId', 'sets'], additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input?.dayId)
        const exercise = day?.exercises.find((item) => item.id === input?.exerciseId)
        if (!day || !exercise || !Array.isArray(input.sets)) throw new Error('루틴에 없는 운동입니다.')
        const date = input.date ?? localDateKey()
        await startWorkoutSession(date, day)
        const existing = await getDayLog(date, day.id, { includeDeleted: true })
        let nextIndex = Math.max(-1, ...existing.filter((set) => set.exerciseId === exercise.id).map((set) => set.setIndex ?? -1)) + 1
        await Promise.all(input.sets.map((set) => saveSet({
          date, dayId: day.id, exerciseId: exercise.id, exerciseOrder: day.exercises.findIndex((item) => item.id === exercise.id),
          setIndex: nextIndex++, weight: Number.isFinite(set.weight) ? set.weight : null, reps: set.reps, rir: set.rir ?? '', setType: set.setType ?? 'work', completed: true,
        })))
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { recorded: input.sets.length, exercise: exerciseLibrary[exercise.id].name, date }
      },
    })

    register({
      name: 'save_workout_journal', title: '운동 일지 저장',
      description: '특정 날짜 세션에 자연어 운동 일지와 컨디션 메모를 저장합니다.',
      inputSchema: { type: 'object', properties: { date: { type: 'string' }, dayId: { type: 'string' }, journal: { type: 'string' }, conditionNote: { type: 'string' }, condition: { type: 'object', properties: { bedtime: { type: 'string' }, wakeTime: { type: 'string' }, sleepMinutes: { type: 'number', minimum: 0 }, energy: { type: 'string' }, strategy: { type: 'string' }, note: { type: 'string' }, soccerScheduleNote: { type: 'string' }, lowerBodyFatigue: { type: 'string' } }, additionalProperties: false }, exerciseNotes: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['date', 'dayId', 'journal'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input.dayId)
        if (!day) throw new Error('루틴을 찾을 수 없습니다.')
        const session = await startWorkoutSession(input.date, day)
        await updateWorkoutSession(input.date, day.id, { journal: input.journal, journalSource: 'webmcp', exerciseNotes: input.exerciseNotes ?? {}, condition: { ...(input.condition ?? {}), note: input.conditionNote ?? input.condition?.note ?? session.condition?.note ?? '' } })
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { saved: true, date: input.date, day: day.name }
      },
    })

    register({
      name: 'complete_workout_session', title: '운동 완료 기록',
      description: '지정 날짜(생략 시 오늘)의 루틴을 완료 처리합니다. 직접 알려준 운동시간과 측정/추정 여부를 함께 저장할 수 있습니다.',
      inputSchema: { type: 'object', properties: { date: { type: 'string' }, dayId: { type: 'string' }, durationSec: { type: 'number', minimum: 0 }, durationSource: { type: 'string', enum: ['reported', 'estimated'] } }, required: ['dayId'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        const day = routine.days.find((item) => item.id === input?.dayId)
        if (!day) throw new Error('루틴을 찾을 수 없습니다.')
        const date = input.date ?? localDateKey()
        await completeWorkoutSession(date, day.id, input.durationSec == null ? {} : { durationSec: input.durationSec, durationSource: input.durationSource ?? 'reported' })
        window.dispatchEvent(new CustomEvent('yp:log-updated'))
        return { completed: true, day: day.name, date }
      },
    })

    register({
      name: 'prepare_weekly_report', title: '주간 분석에 사용할 기록 묶음 준비',
      description: '최근 4주와 선택 주의 실제 기록·원문·기존 리포트를 반환하고 분석 근거를 로컬에 보존합니다. GPT 대화창과의 원격 연결을 의미하지 않습니다.',
      inputSchema: { type: 'object', properties: { date: { type: 'string' } }, additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input = {}) { return reportArchive.prepare(input.date ?? localDateKey(), { routine, exerciseLibrary }) },
    })
    register({
      name: 'save_weekly_report', title: '주간 분석 리포트 아카이브 저장',
      description: '준비한 기록 묶음의 contextId와 고유 requestId를 받아 새 버전을 저장합니다. 기존 버전과 기준 루틴은 변경하지 않습니다.',
      inputSchema: { type: 'object', properties: { contextId: { type: 'string' }, requestId: { type: 'string' }, report: { type: 'object', properties: { headline: { type: 'string' }, wins: { type: 'array', items: { type: 'string' } }, constraints: { type: 'array', items: { type: 'string' } }, changes: { type: 'array', items: { type: 'string' } }, nextActions: { type: 'array', maxItems: 3, items: { type: 'object', properties: { action: { type: 'string' }, check: { type: 'string' } }, required: ['action', 'check'] } }, exerciseTrends: { type: 'array', items: { type: 'string' } }, trainingDistribution: { type: 'array', items: { type: 'string' } }, recovery: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } }, uncertainties: { type: 'array', items: { type: 'string' } }, narrative: { type: 'string' } }, required: ['headline', 'wins', 'constraints', 'changes', 'nextActions'] } }, required: ['contextId', 'requestId', 'report'], additionalProperties: false },
      annotations: { readOnlyHint: false },
      async execute(input) { const saved = await reportArchive.save(input); window.dispatchEvent(new CustomEvent('yp:log-updated')); return { saved: true, id: saved.id, version: saved.version } },
    })

    return () => lifecycle.abort()
  }, [])

  useEffect(() => {
    if (!timer.running) return undefined
    const interval = window.setInterval(() => setTimer((current) => {
      if (current.remaining <= 1) {
        tactileFeedback([120, 80, 120])
        return { ...current, running: false, remaining: 0 }
      }
      return { ...current, remaining: current.remaining - 1 }
    }), 1000)
    return () => window.clearInterval(interval)
  }, [timer.running])

  const startDay = (dayId, date = localDateKey()) => { const other = history.find((s) => s.date === date && s.status === 'started' && s.dayId !== dayId); if (other && !window.confirm(`이 날짜에 ${routine.days.find((d) => d.id === other.dayId)?.name ?? other.dayId} 기록이 열려 있어. 별도로 다른 루틴을 시작할까? 기존 기록은 유지돼.`)) return; setWorkoutDate(date); setSelectedDayId(dayId); setActiveWorkout(true); window.scrollTo({ top: 0 }) }
  const openRoutine = (dayId) => { setSelectedDayId(dayId); setScreen('routine'); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const showScreen = (nextScreen) => { setScreen(nextScreen); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const startTimer = useCallback((seconds) => setTimer({ visible: true, running: true, remaining: seconds, total: seconds }), [])

  if (activeWorkout) return <><WorkoutScreen key={`${workoutDate}:${selectedDay.id}`} dateKey={workoutDate} day={selectedDay} onBack={() => setActiveWorkout(false)} onFinish={async (date, dayId) => { await refreshInsights(); setRecordFocus({ date, sessionId: `${date}:${dayId}` }); setActiveWorkout(false); setTimer((current) => ({ ...current, visible: false, running: false })); setScreen('report'); window.scrollTo({ top: 0 }) }} onStartTimer={startTimer} /><RestTimer timer={timer} setTimer={setTimer} workoutMode /></>

  return (
    <div className="app-shell">
      <header className="app-header"><div className="brand-mark" aria-hidden="true">YP</div><div className="brand-name"><span>YONGHO</span><strong>PERFORMANCE</strong></div><button className="cloud-status-button" aria-label="계정과 동기화" onClick={() => showScreen('cloud')}><Cloud size={16} /><span>{cloudStatus(cloud)}</span></button><button className="display-settings-button" aria-label="화면과 터치 설정" onClick={() => showScreen('settings')}><SlidersHorizontal size={20} /></button></header>
      <main key={screen} className="page-content">
        {screen === 'today' && <TodayScreen nextDay={nextDay} history={history.filter((session) => session.status !== 'started')} pending={history.filter((session) => session.status === 'started' && session.date === localDateKey())} importNotice={importNotice} onDismissImport={() => setImportNotice('')} onStartDay={startDay} onOpenRoutine={openRoutine} />}
        {screen === 'routine' && <RoutineScreen selectedDay={selectedDay} setSelectedDayId={setSelectedDayId} onStartDay={startDay} />}
        {screen === 'report' && <RecordsScreen history={history} completedSets={completedSets} focusDate={recordFocus.date} focusSessionId={recordFocus.sessionId} onDataChanged={refreshInsights} onResume={startDay} onOpenCloud={() => showScreen('cloud')} />}
        {screen === 'cloud' && <CloudScreen cloud={cloud} />}
        {screen === 'settings' && <DisplaySettings preferences={preferences} onChange={setPreferences} onBack={() => showScreen('today')} />}
      </main>
      <nav className="bottom-nav" aria-label="주요 메뉴">
        <button aria-current={screen === 'today' ? 'page' : undefined} className={screen === 'today' ? 'active' : ''} onClick={() => showScreen('today')}><Home size={21} /><span>오늘</span></button>
        <button aria-current={screen === 'routine' ? 'page' : undefined} className={screen === 'routine' ? 'active' : ''} onClick={() => showScreen('routine')}><Dumbbell size={21} /><span>루틴</span></button>
        <button aria-current={screen === 'report' ? 'page' : undefined} className={screen === 'report' ? 'active' : ''} onClick={() => showScreen('report')}><BarChart3 size={21} /><span>기록</span></button>
      </nav>
      <RestTimer timer={timer} setTimer={setTimer} />
    </div>
  )
}

function TodayScreen({ nextDay, history, pending = [], importNotice, onDismissImport, onStartDay, onOpenRoutine }) {
  const today = localDateKey()
  const week = getWeekRange(today)
  const weekSessions = history.filter((session) => inRange(session.date, week))
  const monthSessions = history.filter((session) => session.date.startsWith(monthKey(today)))
  const completedIds = new Set(weekSessions.map((session) => session.dayId))
  return <>
    {importNotice && <section className="import-notice"><Check size={18} /><span>{importNotice}</span><button onClick={onDismissImport} aria-label="알림 닫기"><X size={16} /></button></section>}
    <section className="page-heading home-heading"><p>{formatToday()}</p><h1>이번 주 {weekSessions.length}<em>/4</em></h1><span>요일이 밀려도 괜찮아. 가능한 날에 다음 세션을 이어가면 돼.</span></section>
    {pending.map((s) => <section className="next-session-card" key={s.id}><span>오늘 저장 중인 운동 · {s.setCount}세트 완료</span><h2>{routine.days.find((d) => d.id === s.dayId)?.name ?? s.dayId}</h2><button className="primary-button" onClick={() => onStartDay(s.dayId, s.date)}>이 운동 이어서 기록</button></section>)}
    <section className="weekly-score" aria-label={`이번 주 ${weekSessions.length}회 운동 완료`}><div className="score-copy"><span>이번 주 목표</span><strong>{weekSessions.length >= 4 ? '이번 주 완료' : `${4 - weekSessions.length}회 남음`}</strong></div><div className="goal-dots">{[0, 1, 2, 3].map((index) => <i className={index < weekSessions.length ? 'done' : ''} key={index}>{index < weekSessions.length && <Check size={15} />}</i>)}</div></section>
    <section className="next-session-card"><div className="next-label"><span>다음 운동</span><span>추천 {nextDay.recommendedDay}요일 · 언제든 가능</span></div><div className="next-session-title"><span>{nextDay.sessionLabel}</span><div><h2>{nextDay.name}</h2><p>{nextDay.focus}</p></div></div><div className="next-meta"><span><Clock3 size={16} /> {nextDay.duration}</span><span><Dumbbell size={16} /> {nextDay.exercises.length}개 운동</span></div><button className="primary-button" onClick={() => onStartDay(nextDay.id)}><Play size={19} fill="currentColor" /> 이 루틴 시작</button><button className="text-button" onClick={() => onOpenRoutine(nextDay.id)}>운동 구성 먼저 보기</button></section>
    <section className="section-block"><div className="section-heading"><div><span>원하는 날, 원하는 루틴</span><h2>오늘 다른 루틴을 할래?</h2></div></div><div className="routine-launcher">{routine.days.map((day) => { const completed = completedIds.has(day.id); return <button className={`routine-launch ${completed ? 'completed' : ''}`} key={day.id} onClick={() => onStartDay(day.id)}><span className="session-letter">{completed ? <Check size={20} /> : day.sessionLabel}</span><span><strong>{day.name}</strong><small>추천 {day.recommendedDay} · {day.duration}</small></span><Play size={17} fill="currentColor" /></button> })}</div></section>
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

function ExerciseInfoCard({ exercise, index }) {
  const [open, setOpen] = useState(false)
  const detail = exerciseLibrary[exercise.id]
  return <article className={`info-card ${open ? 'open' : ''}`}><button className="info-summary" onClick={() => setOpen((value) => !value)} aria-expanded={open}><span className="exercise-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{detail.name}</h3><p>{exercise.sets} × {exercise.reps} · RIR {exercise.rir} · {formatClock(exercise.rest)}</p></div><ChevronDown className="chevron" size={20} /></button><div className="cue-line"><Flame size={16} /><span>{detail.shortCue}</span></div>{open && <TipDetails detail={detail} />}</article>
}

function WorkoutScreen({ day: baselineDay, dateKey, onBack, onFinish, onStartTimer }) {
  const [date] = useState(() => dateKey ?? localDateKey())
  const [logs, setLogs] = useState([])
  const [previous, setPrevious] = useState({})
  const [previousReview, setPreviousReview] = useState({})
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())
  const [externalRevision, setExternalRevision] = useState(0)
  const [finishing, setFinishing] = useState(false)
  const [saveError, setSaveError] = useState('')
  const writes = useRef(createWorkoutWrites())
  const flushers = useRef(new Map())
  const day = session?.routineSnapshot ?? baselineDay
  const registerFlush = useCallback((key, flush) => { flushers.current.set(key, flush); return () => flushers.current.delete(key) }, [])
  const write = (work) => writes.current.enqueue(work).catch((error) => { setSaveError(`저장하지 못했어: ${error.message}. 입력을 유지했어. 다시 저장해줘.`); throw error })

  const load = useCallback(async () => {
    const currentSession = await startWorkoutSession(date, baselineDay)
    const sessionDay = currentSession.routineSnapshot ?? baselineDay
    const [currentLogs, ...priorRows] = await Promise.all([getDayLog(date, day.id, { includeDeleted: true }), ...[...new Set(sessionDay.exercises.map((exercise) => exercise.id))].map((exerciseId) => getPreviousExerciseLog(exerciseId, date))])
    setLogs(currentLogs)
    setPrevious(Object.fromEntries([...new Set(sessionDay.exercises.map((exercise) => exercise.id))].map((exerciseId, index) => [exerciseId, priorRows[index]])))
    const reviewIds = [...new Set(sessionDay.exercises.map((exercise) => exercise.id))]
    const reviews = await Promise.all(reviewIds.map((id) => getPreviousExerciseReview(id, date)))
    setPreviousReview(Object.fromEntries(reviewIds.map((id, index) => [id, reviews[index]])))
    setSession(currentSession)
    setLoading(false)
  }, [date, baselineDay])

  useEffect(() => { load().catch((e) => setSaveError(`기록을 불러오지 못했어: ${e.message}`)) }, [load])
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval) }, [])

  const updateLocalLog = (entry) => setLogs((current) => [...current.filter((item) => !(item.exerciseId === entry.exerciseId && item.setIndex === entry.setIndex)), entry])
  const handleSetSave = (exercise, row, startRest = false, restSeconds = exercise.rest) => write(async () => {
    const entry = {
      id: row.id, date, dayId: day.id, exerciseId: exercise.id, exerciseOrder: day.exercises.findIndex((item) => item.id === exercise.id), setIndex: row.setIndex,
      setType: row.setType, weight: row.weight === '' ? null : Number(row.weight), weightLabel: row.weightLabel ?? '', reps: row.reps === '' ? null : Number(row.reps), rir: row.rir ?? '', completed: Boolean(row.completed), note: row.note ?? '',
    }
    const id = await saveSet(entry)
    updateLocalLog({ ...entry, id, deletedAt: null })
    if (startRest && row.completed) { tactileFeedback(); onStartTimer(restSeconds) }
  })
  const handleDelete = (exercise, row) => write(async () => {
    const deleted = await deleteSet({ ...row, date, dayId: day.id, exerciseId: exercise.id, setIndex: row.setIndex })
    updateLocalLog(deleted)
  })
  const patchSession = (patch) => write(async () => { const updated = await updateWorkoutSession(date, day.id, patch); setSession(updated); return updated })
  const updateRest = async (exerciseId, seconds) => patchSession({ restOverrides: { [exerciseId]: seconds } })
  const updateExerciseNote = async (exerciseId, note) => patchSession({ exerciseNotes: { [exerciseId]: note } })

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

  const completed = logs.filter((item) => item.completed && !item.deletedAt).length
  const elapsedSec = session?.status === 'completed' || session?.pausedAt ? session?.durationSec ?? 0 : (session?.durationSec ?? 0) + ((session?.activeStartedAt ?? session?.startedAt) ? Math.max(0, Math.floor((now - new Date(session.activeStartedAt ?? session.startedAt).getTime()) / 1000)) : 0)
  const flushInputs = async () => { for (const flush of [...flushers.current.values()]) await flush() }
  const finishWorkout = async () => {
    if (finishing) return
    setFinishing(true); setSaveError('')
    try { await writes.current.finish(flushInputs, async () => { await completeWorkoutSession(date, day.id, { durationSec: elapsedSec }); window.dispatchEvent(new CustomEvent('yp:log-updated')); await onFinish(date, day.id) }) }
    catch (error) { setSaveError(`완료하지 못했어: ${error.message}. 입력은 유지돼. 다시 시도해줘.`) }
    finally { setFinishing(false) }
  }
  const closeWorkout = async () => { if (finishing) return; setFinishing(true); try { await writes.current.finish(flushInputs, async () => { const latest = await getWorkoutSession(date, day.id); const rows = await getDayLog(date, day.id, { includeDeleted: true }); if (isEmptyWorkoutSession(latest, rows)) await cancelEmptyWorkoutSession(date, day.id); else if (latest?.status === 'started') await updateWorkoutSession(date, day.id, { durationSec: elapsedSec, pausedAt: new Date().toISOString(), activeStartedAt: null }); window.dispatchEvent(new CustomEvent('yp:log-updated')); onBack() }) } catch (error) { setSaveError(`저장하지 못했어: ${error.message}`) } finally { setFinishing(false) } }

  return <div className="workout-shell"><header className="workout-header"><button className="icon-button" disabled={finishing} onClick={closeWorkout} aria-label="운동 화면 닫기"><ArrowLeft size={23} /></button><div><span>{day.sessionLabel} SESSION · {date.replaceAll('-', '.')}</span><h1>{day.name}</h1></div><strong>{formatClock(elapsedSec)}</strong></header><div className="workout-progress"><span style={{ width: `${Math.min(100, (completed / Math.max(1, day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0))) * 100)}%` }} /></div>
    <main className="workout-main">{saveError && <p className="record-message" role="alert">{saveError}</p>}<fieldset className="workout-fields" disabled={finishing || loading}><section className="session-intro"><div><Clock3 size={18} /><span>진행 {formatDuration(elapsedSec)}</span></div><p>{day.focus}</p></section>
      <section className="session-rule"><Info size={17} /><p><strong>오늘 기록만 자유롭게 변경</strong>세트와 중량을 바꿔도 기준 루틴은 그대로 유지돼.</p></section>
      {loading ? <div className="loading-card">기록을 불러오는 중…</div> : day.exercises.map((exercise, index) => <LogExerciseCard key={`${exercise.id}-${externalRevision}`} exercise={exercise} index={index} logs={logs.filter((item) => item.exerciseId === exercise.id)} previous={previous[exercise.id] ?? []} previousReview={previousReview[exercise.id]} restValue={session?.restOverrides?.[exercise.id] ?? exercise.rest} exerciseNote={session?.exerciseNotes?.[exercise.id] ?? ''} onSave={handleSetSave} onDelete={handleDelete} onRestChange={updateRest} onNoteChange={updateExerciseNote} registerFlush={registerFlush} />)}
      {!loading && <QuickLogCard day={day} onImport={importQuickLog} onJournalOnly={async (text) => patchSession({ journal: [session?.journal, text].filter(Boolean).join('\n\n') })} />}
      {!loading && <SessionNotesCard key={`notes-${externalRevision}`} session={session} onSave={patchSession} registerFlush={registerFlush} />}
      </fieldset><button className="finish-button" disabled={completed === 0 || loading || finishing} onClick={finishWorkout}><Check size={20} /> {finishing ? '입력을 저장하는 중…' : session?.status === 'completed' ? '운동 기록 업데이트' : '운동 완료'} · {formatDuration(elapsedSec)}</button><button className="text-button" disabled={loading || finishing} onClick={closeWorkout}>{session?.status === 'completed' ? '저장하고 닫기' : '저장하고 잠시 나가기'}</button><p className="storage-note">입력이 없는 시작 기록은 나갈 때 취소돼. 입력이 있으면 보존하고 시간을 멈춰.</p><p className="storage-note"><Info size={15} /> 완료하면 이 날짜의 캘린더 회고로 이동해. 주간 리포트는 원하는 때 따로 보관할 수 있어.</p>
    </main>
  </div>
}

function LogExerciseCard({ exercise, index, logs, previous, previousReview, restValue, exerciseNote, onSave, onDelete, onRestChange, onNoteChange, registerFlush }) {
  const detail = exerciseLibrary[exercise.id]
  const [tipsOpen, setTipsOpen] = useState(false)
  const [restOpen, setRestOpen] = useState(false)
  const [restSeconds, setRestSeconds] = useState(restValue)
  const [note, setNote] = useState(exerciseNote)
  const [rows, setRows] = useState(() => makeRows(exercise, logs))
  const [savingRows, setSavingRows] = useState(new Set())
  const nextRowIndex = rows.find((row) => !row.completed)?.setIndex
  const savedCompleted = logs.filter((row) => row.completed && !row.deletedAt).length
  const latest = useRef({ rows, note, restSeconds }); latest.current = { rows, note, restSeconds }
  useEffect(() => registerFlush(exercise.id, async () => {
    for (const row of latest.current.rows) await onSave(exercise, row, false, latest.current.restSeconds)
    await onNoteChange(exercise.id, latest.current.note)
  }), [registerFlush, exercise, onSave, onNoteChange])
  const updateRow = (setIndex, patch) => setRows((current) => current.map((row) => row.setIndex === setIndex ? { ...row, ...patch } : row))
  const persistRow = async (row, patch = {}, startRest = false) => {
    const next = { ...row, ...patch }; updateRow(row.setIndex, patch)
    setSavingRows((current) => new Set([...current, row.setIndex]))
    try { await onSave(exercise, next, startRest, restSeconds) } catch {
      if ('completed' in patch) updateRow(row.setIndex, { completed: row.completed })
      // Keep numeric input; the parent displays the failed save.
    }
    finally { setSavingRows((current) => { const next = new Set(current); next.delete(row.setIndex); return next }) }
  }
  const addRow = () => setRows((current) => [...current, { setIndex: Math.max(-1, ...current.map((row) => row.setIndex), ...logs.map((row) => row.setIndex)) + 1, setType: 'work', weight: exercise.targetWeight ?? '', weightLabel: '', reps: '', rir: exercise.rir ?? '', completed: false }])
  const removeRow = async (row) => { try { await onDelete(exercise, row); setRows((current) => current.filter((item) => item.setIndex !== row.setIndex)) } catch { /* Parent shows the error; keep the input. */ } }
  const previousText = previous.length ? previous.map((row) => `${setTypeLabels[row.setType] ? `${setTypeLabels[row.setType]} ` : ''}${row.weightLabel || (row.weight != null ? `${row.weight}kg` : '–')} × ${row.reps ?? '–'}`).join(' · ') : '첫 기록 — 오늘이 기준점이 된다'
  const changeRest = (next) => { const safe = Math.max(15, Math.min(600, next)); setRestSeconds(safe); onRestChange(exercise.id, safe).catch(() => {}) }

  return <article className="log-card"><div className="log-card-head"><span className="exercise-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{detail.name}</h2><p>기준 {exercise.sets} × {exercise.reps} · RIR {exercise.rir}</p></div><button className="rest-chip" onClick={() => setRestOpen((value) => !value)}><Clock3 size={14} /> {formatClock(restSeconds)}</button></div>
    {restOpen && <div className="rest-editor"><span>이 운동의 오늘 휴식</span><button aria-label="휴식 15초 줄이기" onClick={() => changeRest(restSeconds - 15)}><Minus size={16} /></button><strong>{formatClock(restSeconds)}</strong><button aria-label="휴식 15초 늘리기" onClick={() => changeRest(restSeconds + 15)}><Plus size={16} /></button><small>완료 체크 시 자동 시작</small></div>}
    <div className="last-record"><History size={16} /><span><small>지난 기록</small>{previousText}</span></div><div className="live-cue"><Flame size={17} /><strong>{detail.shortCue}</strong></div>
    {previousReview && <details className="previous-coach-note"><summary>지난 회고 · 이번에 확인할 것</summary><p>{previousReview.action.action}</p><p>확인: {previousReview.action.check}</p><small>{previousReview.date} GPT 회고{previousReview.stale ? " · 원본 수정 전 분석" : ""} · 제안이며 기준값은 그대로야.</small></details>}
    <div className="set-list"><div className="set-list-head"><span>오늘 실제 수행</span><small>{savedCompleted} / {rows.length}세트 저장</small></div>{rows.map((row, displayIndex) => <div className={`set-row-v2 ${row.completed ? 'completed' : ''} ${row.setIndex === nextRowIndex ? 'current-set' : ''}`} key={row.setIndex}><div className="set-row-top"><strong>{displayIndex + 1}<span>세트</span></strong>{row.setIndex === nextRowIndex && <small className="current-set-label">다음 세트</small>}<select value={row.setType} aria-label={`${detail.name} ${displayIndex + 1}세트 유형`} onChange={(event) => persistRow(row, { setType: event.target.value })}>{Object.entries(setTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="delete-set" onClick={() => removeRow(row)} aria-label="세트 삭제"><Trash2 size={16} /></button></div><div className="set-fields"><label><span>KG</span><input aria-label={`${detail.name} ${displayIndex + 1}세트 중량`} inputMode="decimal" type="number" min="0" step="0.5" value={row.weight} onChange={(event) => updateRow(row.setIndex, { weight: event.target.value, weightLabel: '' })} onBlur={() => onSave(exercise, row, false, restSeconds).catch(() => {})} placeholder={row.weightLabel || '–'} /></label><label><span>REPS</span><input aria-label={`${detail.name} ${displayIndex + 1}세트 반복수`} inputMode="numeric" type="number" min="0" step="1" value={row.reps} onChange={(event) => updateRow(row.setIndex, { reps: event.target.value })} onBlur={() => onSave(exercise, row, false, restSeconds).catch(() => {})} placeholder="–" /></label><label><span>RIR</span><input aria-label={`${detail.name} ${displayIndex + 1}세트 RIR`} inputMode="decimal" value={row.rir} onChange={(event) => updateRow(row.setIndex, { rir: event.target.value })} onBlur={() => onSave(exercise, row, false, restSeconds).catch(() => {})} placeholder="–" /></label><button className="complete-set" aria-pressed={row.completed} disabled={savingRows.has(row.setIndex)} onClick={() => persistRow(row, { completed: !row.completed }, !row.completed)} aria-label={`${detail.name} ${displayIndex + 1}세트 ${row.completed ? '완료 취소' : '완료'}`}>{savingRows.has(row.setIndex) ? <span className="set-saving">저장</span> : row.completed ? <Check size={20} strokeWidth={3} /> : <Check size={20} />}<span className="sr-only">{row.completed ? '완료됨' : '완료 체크'}</span></button></div></div>)}</div>
    <button className="add-set" onClick={addRow}><Plus size={17} /> 오늘 세트 추가</button>
    <label className="exercise-note"><span>이 운동의 느낌</span><textarea value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => onNoteChange(exercise.id, note).catch(() => {})} placeholder="자극 위치, 자세, 통증, 다음에 바꿀 점…" /></label>
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
  const [saving, setSaving] = useState(false)
  const save = async () => { if (saving) return; setSaving(true); try { await onImport(preview, text); setText(''); setPreview([]); setMessage('오늘 세트와 원문 일지에 저장했어.') } catch (error) { setMessage(`저장하지 못했어: ${error.message}. 입력은 유지했어.`) } finally { setSaving(false) } }
  const journalOnly = async () => { if (saving) return; setSaving(true); try { await onJournalOnly(text); setText(''); setMessage('원문을 오늘 일지에 저장했어.') } catch (error) { setMessage(`저장하지 못했어: ${error.message}. 입력은 유지했어.`) } finally { setSaving(false) } }

  return <section className="quick-log-card"><button className="quick-log-toggle" onClick={() => setOpen((value) => !value)}><span><ClipboardList size={20} /><span><strong>말하듯 빠른 기록</strong><small>입력 → 해석 확인 → 저장</small></span></span><ChevronDown className={open ? 'rotate' : ''} size={20} /></button>{open && <div className="quick-log-body"><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="예: 랫풀은 40kg 12개 웜업, 47kg 10개, 47kg 8개 했어…" /><div className="quick-actions"><button onClick={parse} disabled={saving || !text.trim()}><Sparkles size={17} /> 세트로 해석</button><button onClick={journalOnly} disabled={saving || !text.trim()}><FileText size={17} /> 일지만 저장</button></div>{message && <p className="parse-message">{message}</p>}{preview.map((group) => <div className="parse-group" key={group.exerciseId}><strong>{exerciseLibrary[group.exerciseId]?.name ?? group.exerciseId}</strong>{group.sets.map((set, setIndex) => <div key={setIndex}><select value={set.setType} onChange={(event) => patchPreview(group.exerciseId, setIndex, { setType: event.target.value })}>{Object.entries(setTypeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input type="number" inputMode="decimal" value={set.weight} onChange={(event) => patchPreview(group.exerciseId, setIndex, { weight: event.target.value })} placeholder={set.weightLabel || 'kg'} /><input type="number" inputMode="numeric" value={set.reps} onChange={(event) => patchPreview(group.exerciseId, setIndex, { reps: event.target.value })} placeholder="회" /><input value={set.rir} onChange={(event) => patchPreview(group.exerciseId, setIndex, { rir: event.target.value })} placeholder="RIR" /><button onClick={() => removePreview(group.exerciseId, setIndex)}><X size={15} /></button></div>)}</div>)}{preview.length > 0 && <button className="save-parsed" disabled={saving} onClick={save}><Save size={17} /> 확인한 기록 저장</button>}</div>}</section>
}

function SessionNotesCard({ session, onSave, registerFlush }) {
  const [open, setOpen] = useState(Boolean(session?.journal || session?.condition?.note))
  const [condition, setCondition] = useState(session?.condition ?? {})
  const [journal, setJournal] = useState(session?.journal ?? '')
  const [saved, setSaved] = useState(false)
  const latest = useRef({ condition, journal }); latest.current = { condition, journal }
  const saveRef = useRef(onSave); saveRef.current = onSave
  useEffect(() => { const timeout = window.setTimeout(() => saveRef.current({ condition, journal }).catch(() => {}), 500); return () => window.clearTimeout(timeout) }, [condition, journal])
  useEffect(() => registerFlush('session-notes', () => onSave(latest.current)), [registerFlush, onSave])
  const save = async () => { try { await onSave({ condition, journal }); setSaved(true); window.setTimeout(() => setSaved(false), 1600) } catch { /* Parent retains inputs and displays error. */ } }
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
  return <aside className={`rest-timer ${timer.remaining === 0 ? 'done' : ''} ${workoutMode ? 'workout-mode' : ''}`} aria-label="휴식 타이머"><div className="timer-ring" style={{ '--timer-progress': `${progress * 3.6}deg` }}><TimerReset size={19} /></div><div><span role="status">{timer.remaining === 0 ? '다음 세트 준비' : '휴식 타이머'}</span><strong role="timer">{formatClock(timer.remaining)}</strong></div><div className="timer-controls"><button onClick={() => adjust(-15)} aria-label="15초 줄이기"><Minus size={17} /></button><button onClick={() => setTimer((current) => ({ ...current, running: !current.running }))} aria-label={timer.running ? '일시정지' : '계속'}>{timer.running ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button onClick={() => adjust(15)} aria-label="15초 늘리기"><Plus size={17} /></button><button onClick={() => setTimer((current) => ({ ...current, remaining: current.total, running: true }))} aria-label="타이머 다시 시작"><RotateCcw size={18} /></button></div><button className="timer-close" onClick={() => setTimer((current) => ({ ...current, visible: false, running: false }))} aria-label="타이머 닫기">×</button></aside>
}

export default App
