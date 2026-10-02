import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'

// Exercise real React UI and IndexedDB with synthetic data; no user records.
test('completion flushes unblurred inputs, keeps original date and opens daily calendar reflection', async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost/yongho-performance/' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  globalThis.HTMLElement = dom.window.HTMLElement; globalThis.CustomEvent = dom.window.CustomEvent
  const RealBroadcastChannel = globalThis.BroadcastChannel
  // JSDOM does not implement browser BroadcastChannel; a Node channel keeps the test alive.
  globalThis.BroadcastChannel = undefined
  window.scrollTo = () => {}
  const { render, fireEvent, screen, waitFor, cleanup } = await import('@testing-library/react')
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  const RealDate = globalThis.Date
  try {
    const { default: App } = await server.ssrLoadModule('/src/App.jsx')
    const storage = await server.ssrLoadModule('/src/lib/storage.js')
    const { localDateKey } = await server.ssrLoadModule('/src/lib/reportArchive.js')
    const date = localDateKey()
    let clock = RealDate.now()
    globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])) } static now() { return clock } }
    render(React.createElement(App))
    fireEvent.click(screen.getByText('이 루틴 시작'))
    await screen.findAllByText('오늘 세트 추가')
    const kg = screen.getAllByText('KG')[0].parentElement.querySelector('input')
    const reps = screen.getAllByText('REPS')[0].parentElement.querySelector('input')
    fireEvent.change(kg, { target: { value: '23' } }); fireEvent.change(reps, { target: { value: '9' } })
    fireEvent.click(screen.getByRole('button', { name: '인클라인 스미스 벤치 1세트 완료', exact: true }))
    await waitFor(() => assert.equal(screen.getByText(/운동 완료 ·/).disabled, false))
    fireEvent.click(screen.getByText('컨디션 · 운동 일지'))
    fireEvent.change(screen.getByPlaceholderText('운동 전체 느낌을 말하듯 자유롭게 남겨도 돼.'), { target: { value: 'Synthetic full training journal' } })
    fireEvent.change(screen.getByPlaceholderText('수면 부족, 피로감, 통증이나 불편감…'), { target: { value: 'Synthetic recovery note' } })
    const note = screen.getAllByPlaceholderText('자극 위치, 자세, 통증, 다음에 바꿀 점…')[0]
    fireEvent.change(note, { target: { value: 'Synthetic range of motion note' } })
    clock += 48 * 60 * 60 * 1000
    // Change a completed set and click finish without blurring it.
    fireEvent.change(reps, { target: { value: '10' } })
    fireEvent.click(screen.getByText(/운동 완료 ·/))
    await screen.findByText('이날의 운동 회고')
    const saved = (await storage.getWorkoutHistory())[0]
    assert.equal(saved.date, date); assert.equal(saved.status, 'completed')
    assert.equal(saved.journal, 'Synthetic full training journal')
    assert.equal(saved.condition.note, 'Synthetic recovery note')
    assert.equal(saved.exerciseNotes['incline-smith'], 'Synthetic range of motion note')
    assert.equal((await storage.getAllCompletedSets())[0].reps, 10)
    assert.ok(screen.getByText('내가 남긴 원문 일지'))
    assert.ok(screen.getByText('Synthetic range of motion note'))
    fireEvent.click(screen.getByRole('tab', { name: '주간 리포트' }))
    fireEvent.click(screen.getByText('현재 로컬 요약 보관'))
    await screen.findByText('로컬 요약 · 규칙 집계')
    assert.equal((await storage.reportArchive.list()).length, 1)
    fireEvent.click(screen.getByText('현재 로컬 요약 보관'))
    await screen.findByText('v2')
    assert.equal((await storage.reportArchive.list()).length, 2)
    globalThis.Date = RealDate
    await storage.repository.close()
  } finally { globalThis.Date = RealDate; cleanup(); await server.close(); dom.window.close(); globalThis.BroadcastChannel = RealBroadcastChannel }
})
