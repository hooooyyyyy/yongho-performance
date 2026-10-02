import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'

test('account UI signs up through Auth, clears password, separates local use and blocks unresolved merge', async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/yongho-performance/' })
  globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.location = dom.window.location
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  globalThis.HTMLElement = dom.window.HTMLElement
  const { render, fireEvent, screen, cleanup } = await import('@testing-library/react')
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  try {
    const { default: CloudScreen } = await server.ssrLoadModule('/src/components/CloudScreen.jsx')
    const { validateCloudConfig } = await server.ssrLoadModule('/src/lib/cloud/client.js')
    assert.throws(() => validateCloudConfig({ url: 'https://example.supabase.co', publishableKey: 'sb_secret_test' }))
    let request, confirmed = 0, resolved
    const cloud = { phase: 'local', busy: false, user: null, client: { auth: { async signUp(input) { request = input; return { data: { session: null }, error: null } } } }, confirm() { confirmed++ }, resolve(...args) { resolved = args } }
    const view = render(React.createElement(CloudScreen, { cloud }))
    assert.ok(screen.getByText(/로그인 없이도 운동을 기록/))
    fireEvent.click(screen.getByText('처음이라면 앱 계정 만들기'))
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'synthetic@example.test' } })
    fireEvent.change(screen.getByLabelText('앱 비밀번호'), { target: { value: 'synthetic-password' } })
    fireEvent.submit(screen.getByRole('button', { name: '앱 계정 만들기', exact: true }).closest('form'))
    await screen.findByText(/인증 메일을 확인한 뒤/)
    assert.equal(request.email, 'synthetic@example.test'); assert.equal(request.options.emailRedirectTo, 'https://example.test/yongho-performance/')
    assert.equal(screen.getByLabelText('앱 비밀번호').value, '')
    const local = { id: '2030-01-01:synthetic', date: '2030-01-01', dayId: 'synthetic', journal: 'Synthetic device journal' }
    const action = { type: 'conflict', kind: 'sessions', id: local.id, local, incoming: { payload: { ...local, journal: 'Synthetic remote journal' }, version: 2 } }
    const plan = { actions: [action], duplicateCandidates: [] }
    view.rerender(React.createElement(CloudScreen, { cloud: { ...cloud, user: { id: 'synthetic-owner', email: 'synthetic@example.test' }, phase: 'review', plan } }))
    assert.equal(screen.getByText('다른 내용을 먼저 확인해줘').disabled, true); assert.equal(confirmed, 0)
    assert.ok(screen.getByText('Synthetic device journal')); assert.ok(screen.getByText('Synthetic remote journal'))
    fireEvent.click(screen.getByText('계정의 내용 사용'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(resolved[0], plan); assert.equal(resolved[1], action); assert.equal(resolved[2], 'incoming')
    const { repository } = await server.ssrLoadModule('/src/lib/storage.js'); await repository.close()
  } finally { cleanup(); await server.close(); dom.window.close() }
})
