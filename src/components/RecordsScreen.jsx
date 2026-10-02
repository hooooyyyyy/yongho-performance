import { countTargets } from '../lib/trainingDistribution.js'
import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Download, FileText, Moon, Sparkles, Upload } from 'lucide-react'
import routine from '../data/routine.json'
import exerciseLibrary from '../data/exercises.json'
import { exportWorkoutData, importWorkoutData, reportArchive, repository } from '../lib/storage.js'
import { addDays, inRange, localDateKey, localWeeklyReport, summarizeWeek, weekRange } from '../lib/reportArchive.js'
import { buildExerciseInsights } from '../lib/insights.js'

const labels = { work: '본세트', warmup: '웜업', drop: '드롭', test: '테스트' }
const weekdays = ['월', '화', '수', '목', '금', '토', '일']
const complete = (s) => ['completed', 'legacy'].includes(s.status)
const minutes = (sec) => sec == null ? '미기록' : `${Math.round(sec / 60)}분`
const sleepLabel = (min) => min == null ? '미기록' : `${Math.floor(min / 60)}시간 ${Math.round(min % 60)}분`
const shiftMonth = (key, n) => { const date = new Date(`${key}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + n); return date.toISOString().slice(0, 7) }
function download(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function RecordsScreen({ history, completedSets, focusDate, focusSessionId, onDataChanged, onResume }) {
  const today = localDateKey()
  const [tab, setTab] = useState('calendar')
  const [selectedDate, setSelectedDate] = useState(focusDate ?? today)
  const [month, setMonth] = useState((focusDate ?? today).slice(0, 7))
  const [openId, setOpenId] = useState(focusSessionId ?? null)
  const [week, setWeek] = useState(weekRange(focusDate ?? today))
  const [reports, setReports] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const backupRef = useRef(null)
  const reportRef = useRef(null)
  const [summary, setSummary] = useState(null)
  const [distribution, setDistribution] = useState([])
  const refresh = async () => { setReports(await reportArchive.list()); const snapshot = await repository.snapshot(); setSummary(summarizeWeek(snapshot, week)); setDistribution(Array.from({ length: 4 }, (_, i) => { const start = addDays(week.start, -7 * i); return { start, targets: countTargets(summarizeWeek(snapshot, { start, end: addDays(start, 6) }).sets) } })) }
  useEffect(() => { refresh().catch((e) => setMessage(e.message)) }, [history, completedSets, week])
  useEffect(() => { if (focusDate) { setSelectedDate(focusDate); setMonth(focusDate.slice(0, 7)); setOpenId(focusSessionId); setTab('calendar') } }, [focusDate, focusSessionId])
  const run = async (work) => { if (busy) return; setBusy(true); setMessage(''); try { await work() } catch (e) { setMessage(`처리하지 못했어: ${e.message}`) } finally { setBusy(false) } }
  const selected = history.filter((s) => s.date === selectedDate)
  const first = `${month}-01`
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()
  const days = Array.from({ length: Math.ceil((offset + daysInMonth) / 7) * 7 }, (_, i) => addDays(first, i - offset))
  const archived = reports.filter((r) => r.weekStart === week.start)
  const monthly = history.filter((s) => complete(s) && s.date.startsWith(month)).length
  const insights = buildExerciseInsights(history, completedSets, routine, exerciseLibrary)

  return <>
    <section className="page-heading compact"><p>TRAINING ARCHIVE</p><h1>기록과 회고</h1><span>그날의 경험부터 다음 주의 방향까지.</span></section>
    <div className="records-tabs" role="tablist" aria-label="기록 보기">{[['calendar', '캘린더'], ['weekly', '주간 리포트']].map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{name}</button>)}</div>
    {message && <p className="record-message" role="status">{message}</p>}
    {tab === 'calendar' ? <>
      <section className="calendar-card"><div className="calendar-head"><div><span>MONTHLY</span><h2>{month.replace('-', '년 ')}월</h2></div><div><button aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={20} /></button><button aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={20} /></button></div></div>
        <div className="month-total"><CalendarDays size={18} /><span>이달의 완료 운동</span><strong>{monthly}회</strong></div><div className="calendar-weekdays">{weekdays.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calendar-grid">{days.map((date) => { const rows = history.filter((s) => s.date === date); const done = rows.filter(complete).length; const status = done ? `완료 ${done}회` : rows.length ? rows.some((s) => s.setCount > 0) ? '진행 중' : '일지·시작 기록' : '기록 없음'; return <button key={date} className={`${date.slice(0, 7) !== month ? 'outside' : ''} ${date === selectedDate ? 'selected' : ''} ${done ? 'trained' : ''} ${rows.length && !done ? 'started-day' : ''}`} aria-label={`${date} ${status}`} aria-pressed={date === selectedDate} onClick={() => { setSelectedDate(date); setOpenId(rows[0]?.id ?? null) }}><span>{Number(date.slice(-2))}</span>{date === today && <i className="today-mark">오늘</i>}{done > 0 ? <i className="workout-mark">{done}</i> : rows.length > 0 ? <i className="pending-mark">·</i> : null}</button> })}</div>
        <p className="calendar-legend">● 완료 · ◦ 진행 중 / 일지만 기록</p>
        <div className="selected-date-log"><div><span>{selectedDate.replaceAll('-', '.')}</span><strong>{selected.length ? '이날의 운동 회고' : '저장된 기록 없음'}</strong></div>{selected.map((s) => { const day = s.routineSnapshot ?? routine.days.find((d) => d.id === s.dayId); return <div key={s.id}><button className="date-session session-button" aria-expanded={openId === s.id || selected.length === 1} onClick={() => setOpenId(openId === s.id ? null : s.id)}><span>{day?.sessionLabel ?? '·'}</span><p><strong>{day?.name ?? s.dayId}</strong><small>{complete(s) ? '완료' : s.setCount ? '진행 중' : '일지·시작 기록'} · {s.setCount}세트 · {minutes(s.durationSec)}</small></p><FileText size={18} /></button>{(openId === s.id || selected.length === 1) && <DailyReflection session={s} sets={completedSets.filter((set) => (set.sessionId ?? `${set.date}:${set.dayId}`) === s.id)} onResume={day ? () => onResume(s.dayId, s.date) : null} />}</div> })}</div>
      </section>
    </> : <>
      <section className="archive-card"><div className="week-picker"><button aria-label="이전 주" onClick={() => setWeek(weekRange(addDays(week.start, -7)))}><ChevronLeft size={20} /></button><div><strong>{week.start.replaceAll('-', '.')} — {week.end.slice(5).replace('-', '.')}</strong><small>{today <= week.end ? '작성 중인 주 · 현재 저장 기록 기준' : '지난 주 기록'}</small></div><button aria-label="다음 주" onClick={() => setWeek(weekRange(addDays(week.start, 7)))}><ChevronRight size={20} /></button></div>
        {summary && <><div className="load-summary"><article><span>완료 운동</span><strong>{summary.sessionCount}<small>회</small></strong></article><article><span>본세트</span><strong>{summary.counts.work}<small>세트</small></strong></article><article><span>RIR 기록</span><strong>{summary.rirCount}<small>/{summary.rirTotal}</small></strong></article></div><p className="archive-caption">웜업 {summary.counts.warmup} · 드롭 {summary.counts.drop} · 테스트 {summary.counts.test}세트{summary.workMissingReps > 0 && ` · 반복수 미기록 본세트 ${summary.workMissingReps}개`}</p><div className="recovery-grid"><div><Moon size={17} /><span>평균 수면</span><strong>{sleepLabel(summary.averageSleep)}</strong><small>{summary.sleepDays}일 기록 기준</small></div><div><Clock3 size={17} /><span>평균 운동시간</span><strong>{minutes(summary.averageDuration)}</strong><small>{summary.durationCount}회 · 직접/추정 기록 {summary.reportedDurationCount}회 포함</small></div></div></>}
        <div className="archive-actions"><button disabled={busy} onClick={() => run(async () => { const context = await reportArchive.prepare(week.start, { routine, exerciseLibrary }); download(context, `YP-GPT-${context.weekStart}.json`); setMessage('이 파일을 GPT 대화에 첨부해 주간 분석을 요청해. 리포트 JSON을 받으면 아래에서 가져올 수 있어.') })}><Download size={17} /> GPT에 줄 기록 내려받기</button><button disabled={busy} onClick={() => reportRef.current.click()}><Upload size={17} /> GPT 리포트 가져오기</button><button disabled={busy} onClick={() => run(async () => { const context = await reportArchive.prepare(week.start); await reportArchive.save({ contextId: context.contextId, requestId: crypto.randomUUID(), report: localWeeklyReport(context), analysisType: 'local-rules' }); await refresh(); setMessage('이 주의 로컬 요약을 보관했어.') })}><FileText size={17} /> 현재 로컬 요약 보관</button></div>
        <input hidden type="file" accept="application/json,.json" ref={reportRef} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(async () => { const input = JSON.parse(await file.text()); const saved = await reportArchive.save({ contextId: input.contextId, requestId: input.requestId, report: input.report, analysisType: 'gpt' }); setWeek(weekRange(saved.weekStart)); await refresh(); setMessage(`GPT 리포트 v${saved.version}를 보관했어. 이전 버전도 그대로 있어.`) }) }} />
        <p className="archive-caption">지금은 이 기기에 저장돼. GPT 대화창과의 자동 조회·저장은 아직 연결되지 않았어. GPT 리포트는 첨부한 기록을 분석한 결과를 가져오는 방식이야.</p>
      </section>
      <details className="archive-card"><summary>최근 4주 훈련 분배</summary><p className="archive-caption">주요 목표 부위별 본세트야. 복합운동 보조근을 추가 세트로 환산하지 않아. 점프는 파워 항목으로 구분해.</p><div className="distribution-scroll"><table className="distribution-table"><thead><tr><th>목표 부위</th>{[...distribution].reverse().map((w) => <th key={w.start}>{w.start.slice(5)} 주</th>)}</tr></thead><tbody>{[...new Set(distribution.flatMap((w) => Object.keys(w.targets)))].map((target) => <tr key={target}><th>{target}</th>{[...distribution].reverse().map((w) => <td key={w.start}>{w.targets[target] ?? 0}</td>)}</tr>)}</tbody></table></div><p className="archive-caption">0은 이 주에 저장된 해당 본세트가 없다는 뜻이야. 실제 훈련을 하지 않았다고 단정하지 않아.</p></details>
      {archived.length === 0 ? <section className="archive-card empty-report"><Sparkles size={24} /><strong>이 주의 리포트를 보관해봐</strong><p>분석을 요청한 주에만 저장하면 돼. 재분석은 새 버전으로 쌓여.</p></section> : archived.map((report) => <ArchivedReport key={report.id} row={report} />)}
      <details className="archive-card"><summary>이전 주 아카이브 · {new Set(reports.filter((r) => r.weekStart !== week.start).map((r) => r.weekStart)).size}주</summary><div className="archive-list">{[...new Set(reports.filter((r) => r.weekStart !== week.start).map((r) => r.weekStart))].map((start) => <button key={start} onClick={() => setWeek(weekRange(start))}><span>{start} 주</span><small>{reports.filter((r) => r.weekStart === start).length}개 버전</small></button>)}</div></details>
      <details className="archive-card"><summary>운동별 다음 방향 · 로컬 규칙</summary><p className="archive-caption">반복수·RIR·메모에 따른 참고 방향이야. 기준 루틴은 바뀌지 않아.</p>{insights.map((item) => <div className="rule-insight" key={item.exerciseId}><strong>{item.name}</strong><p>{item.direction?.label}</p><small>{item.direction?.detail}</small></div>)}</details>
    </>}
    <details className="archive-card backup-panel"><summary>내 기록 백업·복원</summary><p className="archive-caption">기록·원문 이력·리포트와 충돌 사본을 함께 보관해. 같은 ID의 다른 내용은 현재 기록을 덮어쓰지 않고 별도로 보존해.</p><div className="archive-actions"><button disabled={busy} onClick={() => run(async () => download(await exportWorkoutData(), `YP-backup-${today}.json`))}><Download size={17} /> 전체 백업</button><button disabled={busy} onClick={() => backupRef.current.click()}><Upload size={17} /> 백업 복원</button></div><input hidden type="file" accept="application/json,.json" ref={backupRef} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) run(async () => { const result = await importWorkoutData(JSON.parse(await file.text())); await onDataChanged(); await refresh(); setMessage(`새 기록 ${result.imported} · 중복 ${result.duplicates} · 충돌 ${result.conflicts}개. 충돌 사본은 전체 백업에 보존했어.`) }) }} /></details>
  </>
}

export function DailyReflection({ session, sets, onResume }) {
  const condition = session.condition ?? {}
  const groups = [...new Set([...sets.map((s) => s.exerciseId), ...Object.keys(session.exerciseNotes ?? {}).filter((id) => session.exerciseNotes[id])])].sort((a, b) => (sets.find((s) => s.exerciseId === a)?.exerciseOrder ?? 999) - (sets.find((s) => s.exerciseId === b)?.exerciseOrder ?? 999))
  return <div className="daily-reflection"><div className="detail-meta"><span><Clock3 size={15} /> {minutes(session.durationSec)} · {session.durationSource === 'estimated' ? '추정' : session.durationSource === 'reported' ? '직접 입력' : session.durationSec != null ? '측정/기존 기록' : '시간 미기록'}</span><span><Moon size={15} /> 수면 {sleepLabel(condition.sleepMinutes)}</span></div><div className="condition-tags"><i>컨디션 {condition.energy || '미기록'}</i>{condition.bedtime && <i>취침 {condition.bedtime}</i>}{condition.wakeTime && <i>기상 {condition.wakeTime}</i>}</div>
    <div className="detail-note"><strong>오늘의 회고 · 직접 기록</strong><p>{condition.strategy || condition.note || (groups.length ? `${groups.length}개 운동 · 완료 ${sets.length}세트. 아래에서 운동별 느낌을 확인해.` : '아직 세트 기록이 없어. 일지를 먼저 남겨도 돼.')}</p>{condition.strategy && condition.note && <p>{condition.note}</p>}</div>
    <div className="detail-sets">{groups.map((id) => { const rows = sets.filter((s) => s.exerciseId === id).sort((a, b) => a.setIndex - b.setIndex); return <div key={id}><strong>{exerciseLibrary[id]?.name ?? id}</strong><small>본세트 {rows.filter((s) => (s.setType ?? 'work') === 'work').length} · 총 {rows.length}세트</small>{rows.map((s) => <p key={s.id}><i>{labels[s.setType] ?? '본세트'}</i><span>{s.weightLabel || (s.weight == null ? '중량 미기록' : `${s.weight}kg`)} × {s.reps ?? '반복수 미기록'}{String(s.rir ?? '').trim() && ` · RIR ${s.rir}`}</span></p>)}{session.exerciseNotes?.[id] && <div className="exercise-reflection-note">{session.exerciseNotes[id]}</div>}</div> })}</div>
    {session.journal && <details className="raw-journal"><summary>내가 남긴 원문 일지</summary><p>{session.journal}</p></details>}
    {session.journalEntries?.length > 1 && <details className="raw-journal"><summary>원문 수정 이력 · {session.journalEntries.length}개</summary>{session.journalEntries.map((entry) => <div key={entry.id}><small>{entry.createdAt ? new Date(entry.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기존 기록'} · {entry.source}</small><p>{entry.text || '(빈 일지로 수정)'}</p></div>)}</details>}
    {session.aiAnalysis && <details className="raw-journal"><summary>별도로 저장된 분석</summary><p>{typeof session.aiAnalysis === 'string' ? session.aiAnalysis : JSON.stringify(session.aiAnalysis, null, 2)}</p><small>직접 기록과 구분해 확인해.</small></details>}
    {onResume && <button className="text-button" onClick={onResume}>{complete(session) ? '이날 기록 수정' : '이날 운동 이어서 기록'}</button>}
  </div>
}
function ReportLines({ title, rows }) { return rows?.length ? <div className="report-lines"><strong>{title}</strong><ul>{rows.map((line, i) => <li key={i}>{line}</li>)}</ul></div> : null }
function ArchivedReport({ row }) {
  const report = row.report
  return <article className="archive-card saved-report"><div className="report-badges"><span>{row.analysisType === 'gpt' ? 'GPT 분석 · 가져온 리포트' : '로컬 요약 · 규칙 집계'}</span><span>v{row.version}</span><span>{row.reportStatus === 'in-progress' ? '작성 중인 주 기준' : '마감 주 기준'}</span></div>{row.stale && <p className="stale-report">분석 이후 원본 기록이 바뀌었어. 이 리포트는 저장 당시 기록 기준이야.</p>}<h2>{report.headline}</h2><ReportLines title="잘한 점" rows={report.wins} /><ReportLines title="아쉬운 점·제약" rows={report.constraints} /><ReportLines title="주요 변화" rows={report.changes?.slice(0, 3)} />
    <div className="report-lines"><strong>다음 세션에서 할 일</strong><ol>{report.nextActions.map((item, i) => <li key={i}>{item.action}<small>확인: {item.check}</small></li>)}</ol></div>
    <details><summary>전체 분석·판단 근거</summary><ReportLines title="운동별 추세" rows={report.exerciseTrends} /><ReportLines title="최근 훈련 분배" rows={report.trainingDistribution} /><ReportLines title="피로·회복 신호" rows={report.recovery} /><ReportLines title="관찰된 사실·근거" rows={report.evidence} /><p className="archive-caption">확신도: {{ low: '낮음', medium: '보통', high: '높음' }[report.confidence] ?? '평가하지 않음'}</p><ReportLines title="미확인 사항·확신도" rows={report.uncertainties} />{report.narrative && <p className="report-narrative">{report.narrative}</p>}</details>
    <details><summary>이 분석에 사용한 기록</summary><p className="archive-caption">기록 범위 {row.sourceFrom} ~ {row.weekEnd}<br />조회 시점 {new Date(row.dataCutoffAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}<br />리포트 저장 {new Date(row.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p><button className="text-button" onClick={() => download({ reportId: row.id, weekStart: row.weekStart, weekEnd: row.weekEnd, sourceRevisions: row.sourceRevisions, sourceSnapshot: row.sourceSnapshot }, `YP-report-source-${row.id}.json`)}>근거 기록 내려받기</button></details><p className="archive-caption">제안은 기준 루틴을 변경하지 않아.</p>
  </article>
}
