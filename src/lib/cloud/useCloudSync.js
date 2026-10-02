import { useEffect, useRef, useState } from 'react'
import { getCloudClient } from './client.js'
import { createSyncController } from './syncController.js'
import { createSupabaseWorkoutRepository } from '../repositories/supabaseWorkoutRepository.js'
import { repository } from '../storage.js'

export function useCloudSync(paused) {
  const [state, setState] = useState({ phase: 'loading', busy: false, user: null, message: '' })
  const [client, setClient] = useState(null)
  const [recovery, setRecovery] = useState(false)
  const controller = useRef(null)
  const pauseRef = useRef(paused); pauseRef.current = paused
  useEffect(() => {
    let mounted = true, subscription
    getCloudClient().then((supabase) => {
      if (!mounted) return
      setClient(supabase)
      if (!supabase) { setState({ phase: 'disabled', user: null, busy: false, message: '배포용 연결 설정이 아직 없어. 아래 Supabase 설정 안내에서 GitHub 배포 설정을 먼저 완료해줘. 운동은 지금처럼 기기에 기록할 수 있어.' }); return }
      const control = createSyncController({ local: repository, remote: createSupabaseWorkoutRepository(supabase), onState: setState, onChanged: () => window.dispatchEvent(new CustomEvent('yp:log-updated')), online: () => navigator.onLine !== false, serialize: (work) => navigator.locks?.request ? navigator.locks.request('yp-private-sync', work) : work() })
      controller.current = control; control.setPaused(pauseRef.current)
      subscription = supabase.auth.onAuthStateChange((_event, session) => {
        // Keep the Auth callback synchronous; network work begins outside its lock.
        control.setUser(session?.user ?? null)
        if (_event === 'PASSWORD_RECOVERY') setRecovery(true)
        if (_event === 'SIGNED_OUT') setRecovery(false)
      }).data.subscription
    }).catch((error) => { if (mounted) setState({ phase: 'error', user: null, busy: false, message: error.message }) })
    const request = () => controller.current?.request()
    const resume = () => { if (document.visibilityState === 'visible') request() }
    window.addEventListener('yp:local-write', request)
    window.addEventListener('online', request)
    window.addEventListener('focus', request)
    document.addEventListener('visibilitychange', resume)
    const interval = setInterval(resume, 60000)
    return () => { mounted = false; subscription?.unsubscribe(); controller.current?.dispose(); controller.current = null; clearInterval(interval); window.removeEventListener('yp:local-write', request); window.removeEventListener('online', request); window.removeEventListener('focus', request); document.removeEventListener('visibilitychange', resume) }
  }, [])
  useEffect(() => { controller.current?.setPaused(paused) }, [paused])
  return { ...state, recovery, client, preview: () => controller.current?.preview(), confirm: (plan) => controller.current?.confirm(plan), resolve: (plan, action, choice) => controller.current?.resolve(plan, action, choice), sync: () => controller.current?.sync(), clearRecovery: () => setRecovery(false) }
}
