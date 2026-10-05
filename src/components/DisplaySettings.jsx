import { ArrowLeft, Check, Moon, Sun } from 'lucide-react'

export default function DisplaySettings({ preferences, onChange, onBack }) {
  const vibrationAvailable = typeof navigator.vibrate === 'function'
  return <>
    <section className="page-heading compact"><button className="settings-back" onClick={onBack}><ArrowLeft size={18} /> 돌아가기</button><h1>화면과 터치</h1><span>운동할 때 편한 화면으로 맞춰봐.</span></section>
    <section className="settings-card"><h2>화면 밝기</h2><div className="theme-options">{[{ value: 'light', label: '밝은 화면', Icon: Sun }, { value: 'dark', label: '어두운 화면', Icon: Moon }].map(({ value, label, Icon }) => <button key={value} aria-pressed={preferences.theme === value} onClick={() => onChange({ ...preferences, theme: value })}><Icon size={23} /><span>{label}</span>{preferences.theme === value && <Check size={18} />}</button>)}</div><p>이 기기에 선택한 화면을 기억해둘게.</p></section>
    <section className="settings-card"><h2>버튼 반응</h2><label className="preference-row"><span><strong>움직임 줄이기</strong><small>화면 전환과 완료 효과를 간소화해.</small></span><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => onChange({ ...preferences, reducedMotion: event.target.checked })} /></label><label className="preference-row"><span><strong>완료 시 짧은 진동</strong><small>{vibrationAvailable ? '세트 저장과 휴식 종료를 알려줘. 기기 설정에 따라 울리지 않을 수 있어.' : '이 브라우저에서는 진동을 지원하지 않아. 체크와 색상으로 완료를 알려줄게.'}</small></span><input type="checkbox" disabled={!vibrationAvailable} checked={vibrationAvailable && preferences.haptics} onChange={(event) => onChange({ ...preferences, haptics: event.target.checked })} /></label><p>휴대폰의 움직임 줄이기 설정도 함께 반영해.</p></section>
  </>
}
