import GptConnection from './GptConnection.jsx'
import { useState } from 'react'
import { Cloud, Download, LogOut, ShieldCheck } from 'lucide-react'
import exerciseLibrary from '../data/exercises.json'
import routine from '../data/routine.json'
import { exportWorkoutData } from '../lib/storage.js'

const setupUrl = 'https://github.com/hooooyyyyy/yongho-performance/blob/main/docs/cloud-setup.md'
const kinds = { sessions: '세션', sets: '세트', reports: '리포트' }
export const cloudStatus = (cloud) => cloud.busy ? '동기화 중' : ({ local: '기기에 저장', loading: '연결 확인', disabled: '기기에 저장', review: '연결 확인', synced: '동기화 완료', offline: '오프라인 저장', error: '연결 확인 필요', paused: '운동 중 로컬 저장' }[cloud.phase] ?? '기기에 저장')
function authMessage(error) {
  return ({ invalid_credentials: '이메일과 앱 비밀번호를 확인해줘.', email_not_confirmed: '이메일 인증을 마친 뒤 로그인해줘.', email_address_not_authorized: 'Supabase 가입 때 사용한 이메일로 계정을 만들어줘.', over_email_send_rate_limit: '인증 메일 발송 제한에 걸렸어. 잠시 후 다시 시도해줘.', user_already_exists: '이미 만든 계정이야. 로그인해줘.' })[error.code] ?? error.message
}
function downloadBackup(data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `YP-backup-${new Date().toISOString().slice(0, 10)}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function RecordPreview({ row, kind, title }) {
  return <div className="cloud-record"><strong>{title}</strong><p>{row.date ?? row.weekStart} · {kind === 'sets' ? exerciseLibrary[row.exerciseId]?.name ?? row.exerciseId : routine.days.find((d) => d.id === row.dayId)?.name ?? row.dayId ?? '주간 리포트'}</p>{kind === 'sets' ? <p>{row.weightLabel || (row.weight == null ? '중량 미기록' : `${row.weight}kg`)} × {row.reps ?? '반복수 미기록'} · {row.setIndex + 1}세트 · RIR {row.rir || '미기록'}</p> : <p>{row.journal?.slice(0, 220) || row.report?.headline || row.condition?.note || '일지 없음'}</p>}{row.deletedAt && <p>삭제 표시된 기록</p>}<details><summary>전체 기록 확인</summary><pre>{JSON.stringify(row, null, 2)}</pre></details></div>
}

export default function CloudScreen({ cloud }) {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = async (work) => { if (busy || cloud.busy) return; setBusy(true); setMessage(''); try { await work() } catch (error) { setMessage(authMessage(error)) } finally { setBusy(false) } }
  const submit = (event) => { event.preventDefault(); run(async () => {
    let response
    if (cloud.recovery) response = await cloud.client.auth.updateUser({ password })
    else if (mode === 'signup') response = await cloud.client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}${location.pathname}` } })
    else response = await cloud.client.auth.signInWithPassword({ email: email.trim(), password })
    if (response.error) throw response.error
    setPassword('')
    if (cloud.recovery) { cloud.clearRecovery(); setMessage('앱 비밀번호를 변경했어.') }
    else if (mode === 'signup' && !response.data.session) { setMessage('인증 메일을 확인한 뒤, 아이폰 앱에서 이메일과 비밀번호로 로그인해줘.'); setMode('login') }
  }) }
  const plan = cloud.plan
  const conflictRows = plan?.actions.filter((a) => a.type === 'conflict') ?? []
  const disabled = busy || cloud.busy || !cloud.client
  return <>
    <section className="page-heading compact"><p>PRIVATE WORKOUT STORAGE</p><h1>계정과 동기화</h1><span>로그인 없이도 운동을 기록할 수 있어. 기기를 연결하면 같은 기록을 함께 볼 수 있어.</span></section>
    <section className="archive-card cloud-card"><div className="cloud-heading"><Cloud size={21} /><strong>{cloudStatus(cloud)}</strong></div>{cloud.message && <p role="status">{cloud.message}</p>}{message && <p className="record-message" role="status">{message}</p>}
      {cloud.lastSyncedAt && <small>최근 동기화 {new Date(cloud.lastSyncedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small>}
      {cloud.user && !cloud.recovery ? <><p className="cloud-email">{cloud.user.email}</p><div className="cloud-actions"><button className="primary-button" disabled={disabled} onClick={() => run(cloud.preview)}>기기와 계정 기록 비교</button>{cloud.approved && <button className="text-button" disabled={disabled} onClick={() => run(cloud.sync)}>지금 동기화</button>}<button className="text-button" disabled={disabled} onClick={() => run(async () => { const { error } = await cloud.client.auth.signOut({ scope: 'local' }); if (error) throw error; setMessage('이 기기에서 로그아웃했어. 운동 기록은 기기에 그대로 남아.') })}><LogOut size={16} /> 로그아웃</button></div></> : <form className="cloud-form" onSubmit={submit}>
        {!cloud.recovery && <label>이메일<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Supabase 가입에 사용한 이메일" /></label>}
        <label>{cloud.recovery ? '새 앱 비밀번호' : '앱 비밀번호'}<input type="password" autoComplete={mode === 'signup' || cloud.recovery ? 'new-password' : 'current-password'} minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button className="primary-button" disabled={disabled}>{busy ? '확인 중…' : cloud.recovery ? '새 비밀번호 저장' : mode === 'signup' ? '앱 계정 만들기' : '로그인'}</button>
        {!cloud.recovery && <><button type="button" className="text-button" disabled={disabled} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); setPassword('') }}>{mode === 'login' ? '처음이라면 앱 계정 만들기' : '이미 계정이 있다면 로그인'}</button><button type="button" className="text-button" disabled={disabled || !email.trim()} onClick={() => run(async () => { const { error } = await cloud.client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${location.origin}${location.pathname}` }); if (error) throw error; setMessage('비밀번호 재설정 메일을 확인해줘.') })}>비밀번호 재설정 메일 받기</button><small>Supabase 관리자 계정과 별도의 운동 앱 계정이야. 기본 메일 설정에서는 Supabase 가입 이메일로 시작해줘.</small></>}
      </form>}
    </section>
    <GptConnection cloud={cloud} />
    {plan && <section className="archive-card cloud-card"><h2>연결 전 기록 확인</h2><p>아래 숫자는 세션·세트·리포트 각각의 개수야.</p><div className="cloud-table-wrap"><table className="cloud-merge-table"><thead><tr><th>기록</th><th>업로드</th><th>받기</th><th>중복</th><th>충돌</th></tr></thead><tbody>{Object.entries(kinds).map(([kind, label]) => <tr key={kind}><th>{label}</th>{['upload', 'download', 'duplicate', 'conflict'].map((type) => <td key={type}>{plan.actions.filter((a) => a.kind === kind && a.type === type).length}</td>)}</tr>)}</tbody></table></div>
      <details><summary>전송할 기록 목록</summary>{plan.actions.filter((a) => a.type !== 'duplicate' && a.type !== 'conflict').map((a) => <RecordPreview key={`${a.kind}:${a.id}`} row={a.local ?? a.incoming.payload} kind={a.kind} title={a.type === 'upload' ? '이 기기 → 계정' : '계정 → 이 기기'} />)}</details>
      {conflictRows.map((a) => <div className="cloud-conflict" key={`${a.kind}:${a.id}`}><h3>다른 내용 · {kinds[a.kind]}</h3><RecordPreview row={a.local} kind={a.kind} title="이 기기의 기록" /><RecordPreview row={a.incoming.payload} kind={a.kind} title="계정의 기록" /><p>선택하지 않은 내용도 충돌 백업에 보존해.</p>{a.kind === 'reports' ? <button className="text-button" disabled={disabled} onClick={() => run(() => cloud.resolve(plan, a, 'incoming'))}>두 리포트를 별도로 보존</button> : <div className="cloud-actions"><button className="text-button" disabled={disabled} onClick={() => run(() => cloud.resolve(plan, a, 'local'))}>이 기기의 내용 사용</button><button className="text-button" disabled={disabled} onClick={() => run(() => cloud.resolve(plan, a, 'incoming'))}>계정의 내용 사용</button></div>}</div>)}
      {plan.duplicateCandidates?.length > 0 && <details className="cloud-conflict"><summary>같은 세트 번호의 중복 후보 · {plan.duplicateCandidates.length}개</summary><p>서로 다른 ID의 기록이야. 연결하면 모두 보존해. 실제로 같은 세트라면 연결 후 해당 날짜에서 중복 세트를 삭제해줘.</p>{plan.duplicateCandidates.map((c) => <div key={c.key}>{c.rows.map((r) => <RecordPreview key={r.id} row={r} kind="sets" title="중복 후보" />)}</div>)}</details>}
      <button className="primary-button" disabled={disabled || conflictRows.length > 0} onClick={() => run(() => cloud.confirm(plan))}>{conflictRows.length ? '다른 내용을 먼저 확인해줘' : plan.duplicateCandidates?.length ? '중복 후보도 모두 보존하고 연결' : '확인한 기록 연결 · 자동 동기화 켜기'}</button><p className="archive-caption">연결 후에는 온라인일 때 기록을 자동 전송해. 당일 운동은 기기에 먼저 저장돼.</p>
    </section>}
    <section className="archive-card cloud-card"><div className="cloud-heading"><ShieldCheck size={20} /><strong>내 기록은 비공개로 보관</strong></div><p>로그아웃해도 이 기기의 기록은 남아. 공용 기기에서는 개인정보가 남을 수 있으니 개인 기기에서 사용해줘.</p><button className="text-button" disabled={busy} onClick={() => run(async () => downloadBackup(await exportWorkoutData()))}><Download size={16} /> 연결 전 JSON 백업 내려받기</button><a className="text-button" href={setupUrl} target="_blank" rel="noreferrer">Supabase 설정 안내</a><p className="archive-caption">GPT 연결 설정 전에는 위의 전체 기록 복사 또는 주간 기록 파일로 분석을 요청할 수 있어.</p></section>
  </>
}
