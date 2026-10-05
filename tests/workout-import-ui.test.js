import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'

test('file preview does not write; confirm saves sets and reflection, checklist persists and edited evidence is marked stale', async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/yongho-performance/' })
  globalThis.window = dom.window; globalThis.document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
  globalThis.HTMLElement = dom.window.HTMLElement
  const { render, fireEvent, screen, cleanup, waitFor } = await import('@testing-library/react')
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, entries: [] }, plugins: [react()], server: { middlewareMode: true, hmr: false }, appType: 'custom' })
  let storage
  try {
    const { default: Panel } = await server.ssrLoadModule('/src/components/WorkoutImportPanel.jsx')
    const { DailyReflection } = await server.ssrLoadModule('/src/components/RecordsScreen.jsx')
    storage = await server.ssrLoadModule('/src/lib/storage.js')
    const date = '2031-02-03', dayId = 'upper-a'
    const data = { format: 'yongho-performance-workout', version: 1, requestId: 'synthetic-ui', session: { date, dayId, status: 'completed', journal: 'Synthetic original text', condition: {}, coachReview: { source: 'gpt-chat', generatedAt: '2031-02-04T00:00:00Z', headline: 'Synthetic insight', observations: ['Synthetic fact'], nextActions: [{ exerciseId: 'incline-smith', action: 'Synthetic action', check: 'Synthetic check', basis: 'Synthetic basis' }], uncertainties: ['Synthetic uncertainty'], confidence: 'low' } }, sets: [{ id: `${date}:${dayId}:incline-smith:0`, date, dayId, exerciseId: 'incline-smith', setIndex: 0, weight: 20, reps: 10, setType: 'work', completed: true }] }
    let changed = 0
    const view = render(React.createElement(Panel, { onDataChanged: async () => { changed++ } }))
    fireEvent.change(document.querySelector('input[type=file]'), { target: { files: [{ size: 1000, text: async () => JSON.stringify(data) }] } })
    await screen.findByText('2031-02-03 · Upper A')
    assert.equal((await storage.repository.list('sessions')).length, 0)
    fireEvent.click(screen.getByText('확인하고 저장'))
    await screen.findByText(/1세트와 회고를 저장했어/)
    assert.equal(changed, 1)
    let session = await storage.getWorkoutSession(date, dayId)
    let sets = await storage.getAllCompletedSets()
    view.rerender(React.createElement(DailyReflection, { session, sets }))
    assert.ok(screen.getByText('Synthetic insight'))
    const checkbox = screen.getByRole('button', { name: /확인할 항목.*Synthetic check/ })
    fireEvent.click(checkbox)
    await waitFor(() => assert.equal(checkbox.getAttribute('aria-pressed'), 'true'))
    assert.equal((await storage.getWorkoutSession(date, dayId)).coachChecks[0], true)
    assert.equal((await storage.getAllCompletedSets())[0].reps, 10)
    await storage.saveSet({ ...sets[0], reps: 11 })
    session = await storage.getWorkoutSession(date, dayId); sets = await storage.getAllCompletedSets()
    view.rerender(React.createElement(DailyReflection, { session, sets }))
    assert.ok(screen.getByText(/회고 이후 운동기록이 수정됐어/))
    assert.equal((await storage.getPreviousExerciseReview('incline-smith', '2031-02-05')).stale, true)
  } finally { cleanup(); if (storage) await storage.repository.close(); await server.close(); dom.window.close() }
})
