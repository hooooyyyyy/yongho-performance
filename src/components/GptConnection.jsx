import { useEffect, useState } from 'react'
import { exportWorkoutData } from '../lib/storage.js'
import { formatGptRecords } from '../lib/gptExport.js'
import publicConfig from '../data/cloud.json'
const guide = 'https://github.com/hooooyyyyy/yongho-performance/blob/main/docs/gpt-connection.md'
export default function GptConnection({ cloud }) {
  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id')
  const [details, setDetails] = useState(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!authorizationId || !cloud.user || !cloud.client) return
    let cancelled = false
    setDetails(null); setMessage('접근 요청을 확인하고 있어…')
    cloud.client.auth.oauth.getAuthorizationDetails(authorizationId).then(({ data, error }) => {
      if (cancelled) return
      if (error) throw error
      if (data?.redirect_url) { setMessage('이미 승인한 요청이야. GPT로 돌아가기를 눌러줘.'); setDetails(data); return }
      if (!data?.client || data.user?.id !== cloud.user.id) throw new Error('계정 또는 접근 요청을 확인하지 못했어.')
      setDetails(data); setMessage('')
    }).catch(() => { if (!cancelled) setMessage('요청이 만료됐거나 연결 설정이 완료되지 않았어. GPT에서 연결을 다시 시작해줘.') })
    return () => { cancelled = true }
  }, [authorizationId, cloud.user?.id, cloud.client, retry])
  const redirect = (url) => { const target = new URL(url); if (target.protocol !== 'https:') throw new Error('안전한 연결 주소가 아니야.'); location.assign(target.href) }
  const consent = async (approve) => {
    setBusy(true); setMessage('')
    try {
      const method = approve ? 'approveAuthorization' : 'denyAuthorization'
      const { data, error } = await cloud.client.auth.oauth[method](authorizationId, { skipBrowserRedirect: true })
      if (error || !data?.redirect_url) throw new Error()
      redirect(data.redirect_url)
    } catch { setMessage('승인을 완료하지 못했어. GPT에서 연결을 다시 시작해줘.') }
    finally { setBusy(false) }
  }
  const copy = async () => {
    setBusy(true); setMessage('')
    try {
      const value = formatGptRecords(await exportWorkoutData()); setText(value)
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); setMessage('기록을 복사했어. 다른 GPT 대화에 붙여넣어줘.') }
      else setMessage('아래 내용을 길게 눌러 전체 선택 후 복사해줘.')
    } catch { setMessage('아래 기록을 길게 눌러 전체 선택 후 복사해줘. 기록이 없으면 다시 눌러줘.') }
    finally { setBusy(false) }
  }
  return <section className="archive-card cloud-card gpt-connection"><h2>GPT에서 내 기록 보기</h2><p>앱 동기화와 GPT 연결은 별도야. 연결 후 새 대화에서 YONGHO PERFORMANCE를 선택하면 본인 계정에 동기화된 기록을 조회할 수 있어.</p>
    {authorizationId && <div className="cloud-conflict"><h3>기록 접근 승인</h3>{!cloud.user ? <p>위에서 운동 앱 계정으로 로그인한 뒤 여기서 승인해줘. Supabase 관리자 계정과는 별도야.</p> : details?.redirect_url ? <button className="primary-button" onClick={() => redirect(details.redirect_url)}>GPT로 돌아가기</button> : <><p>요청한 앱: <strong>{details?.client?.name || '확인 중'}</strong></p>{details?.client && <><p>클라이언트 ID: {details.client.id}</p><p>돌아갈 주소: {details.redirect_uri}</p><p>요청 범위: {details.scope || '기본 계정 접근'}</p><p>운동 기록·일지·컨디션·주간 리포트를 읽고 평가할 수 있어. 이 연결에서는 기록 저장·삭제와 기준 루틴 변경을 허용하지 않아.</p></>}<div className="cloud-actions"><button className="primary-button" disabled={busy || !details?.client} onClick={() => consent(true)}>내 기록 조회 허용</button><button className="text-button" disabled={busy || !details?.client} onClick={() => consent(false)}>거절</button><button className="text-button" disabled={busy} onClick={() => setRetry((n) => n + 1)}>요청 다시 확인</button></div></> }</div>}
    <button className="primary-button" disabled={busy} onClick={copy}>{busy ? '준비 중…' : 'GPT에게 줄 전체 기록 복사'}</button>{message && <p role="status">{message}</p>}{text && <details open><summary>복사할 기록</summary><textarea aria-label="GPT에게 줄 전체 기록" readOnly rows={12} value={text} onFocus={(e) => e.target.select()} /></details>}
    <details><summary>다른 대화에서 연결하는 방법</summary><p>먼저 서버 배포와 Supabase 접근 승인 설정이 필요해. 설정을 마치기 전에는 주소만 붙여도 기록을 읽을 수 없어.</p><p>ChatGPT 웹에서 맞춤 MCP 연결을 추가하고 운동 앱 계정으로 승인한 뒤, 새 대화의 @ 메뉴에서 연결을 선택해줘. 사용 중인 ChatGPT 환경에 따라 지원 여부가 다를 수 있어.</p><p>연결 주소</p><input aria-label="GPT 연결 주소" readOnly value={`${publicConfig.url}/functions/v1/workout-mcp`} onFocus={(e) => e.target.select()} /><a href={guide} className="text-button" target="_blank" rel="noreferrer">설정 순서 보기</a></details>
  </section>
}
