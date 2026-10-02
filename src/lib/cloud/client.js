import publicConfig from '../../data/cloud.json'

export function validateCloudConfig(config) {
  if (!config.url && !config.publishableKey) return null
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(config.url) || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) throw new Error('프로젝트 주소와 공개 Publishable key 설정을 확인해주세요.')
  return config
}
const configuredKey = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''
export const cloudConfig = configuredKey ? validateCloudConfig({
  url: import.meta.env?.VITE_SUPABASE_URL || publicConfig.url,
  publishableKey: configuredKey,
}) : null
let pending
export function getCloudClient() {
  if (!cloudConfig) return Promise.resolve(null)
  pending ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(cloudConfig.url, cloudConfig.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'yp-private-auth' },
    global: { fetch: async (url, options) => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 20000)
      try { return await fetch(url, { ...options, signal: options?.signal ?? controller.signal }) }
      finally { clearTimeout(timeout) }
    } },
  })).catch((error) => { pending = null; throw error })
  return pending
}
