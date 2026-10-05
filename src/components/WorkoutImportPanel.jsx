import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import routine from '../data/routine.json'
import exerciseLibrary from '../data/exercises.json'
import { repository } from '../lib/storage.js'
import { previewWorkoutImport, applyWorkoutImport } from '../lib/workoutImport.js'

export default function WorkoutImportPanel({ onDataChanged }) {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const read = async (file) => {
    setBusy(true); setPreview(null); setMessage('')
    try {
      if (file.size > 2_000_000) throw new Error('파일이 너무 커. 한 세션의 운동기록 파일을 선택해줘.')
      const value = await previewWorkoutImport(repository, JSON.parse(await file.text()))
      if (!routine.days.some((d) => d.id === value.data.session.dayId) || value.data.sets.some((s) => !exerciseLibrary[s.exerciseId])) throw new Error('앱에 없는 루틴·운동이 있어. 이름을 확인해줘.')
      setPreview(value)
    } catch (e) { setMessage(e.message) } finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setMessage('')
    try {
      const result = await applyWorkoutImport(repository, preview)
      await onDataChanged()
      setMessage(result.duplicate ? '이미 반영한 파일이야. 중복 저장하지 않았어.' : `${preview.data.session.date} · ${result.count}세트와 회고를 저장했어. 캘린더에서 날짜를 눌러 확인해줘.`)
      setPreview(null)
    } catch (e) { setMessage(e.message) } finally { setBusy(false) }
  }
  return <section className="archive-card workout-import"><h2>대화에서 정리한 운동기록</h2><p className="archive-caption">GPT에 운동 경험을 말하고 받은 운동기록 JSON을 선택해. 세트·느낌·다음 운동 체크 항목을 함께 보관해. 현재 대화에서 자동 전송되지는 않아.</p><button className="records-account-button" disabled={busy} onClick={() => fileRef.current.click()}><Upload size={18} /> GPT 운동기록 가져오기</button><input hidden ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) read(file) }} />
    {message && <p role="status" className="record-message">{message}</p>}
    {preview && <div className="workout-import-preview"><h3>{preview.data.session.date} · {routine.days.find((d) => d.id === preview.data.session.dayId)?.name}</h3><p>{preview.existing ? `기존 완료 ${preview.previousCompleted}세트 → ` : '새 운동기록 · '}{preview.data.sets.length}세트 · 운동 완료</p><p className="archive-caption">{preview.existing ? '이 날짜·루틴의 세트 전체와 일지를 수정해. 수정 전 사본은 전체 백업에 보관해.' : '다른 날짜의 기록은 그대로 보관해.'} 확인 후에만 반영하며 기준 루틴은 바뀌지 않아.</p><div className="detail-sets">{[...new Set(preview.data.sets.map((s) => s.exerciseId))].map((id) => <div key={id}><strong>{exerciseLibrary[id].name}</strong>{preview.data.sets.filter((s) => s.exerciseId === id).map((s) => <p key={s.id}><i>{{ warmup: '웜업', work: '본세트', drop: '드롭', test: '테스트' }[s.setType]}</i><span>{s.weightLabel || (s.weight == null ? '중량 미기록' : `${s.weight}kg`)} × {s.reps ?? '미기록'}{s.rir !== '' && s.rir != null ? ` · RIR ${s.rir}` : ''}</span></p>)}</div>)}</div><details className="raw-journal"><summary>일지와 회고 확인</summary><p>{preview.data.session.journal}</p>{preview.data.session.coachReview && <><strong>{preview.data.session.coachReview.headline}</strong>{preview.data.session.coachReview.nextActions.map((a, i) => <p key={i}>{a.action}<br />확인: {a.check}</p>)}</>}</details><div className="archive-actions"><button disabled={busy} onClick={save}>확인하고 {preview.existing ? '이날 기록 수정' : '저장'}</button><button disabled={busy} onClick={() => setPreview(null)}>취소</button></div></div>}
  </section>
}
