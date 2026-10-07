import 'fake-indexeddb/auto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'
test('OAuth consent waits for verified details and explicit approval; export preserves source and blanks', async () => {
  const dom = new JSDOM('<html><body></body></html>', { url: 'https://example.test/?authorization_id=synthetic-request' })
  globalThis.window=dom.window; globalThis.document=dom.window.document; globalThis.location=dom.window.location
  Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true})
  globalThis.HTMLElement=dom.window.HTMLElement
  const {render,screen,fireEvent,cleanup}=await import('@testing-library/react')
  const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,entries:[]},plugins:[react()],server:{middlewareMode:true,hmr:false},appType:'custom'})
  try {
    const {default:Panel}=await server.ssrLoadModule('/src/components/GptConnection.jsx')
    let approved=0, requested
    const cloud={user:{id:'synthetic-user'},client:{auth:{oauth:{async getAuthorizationDetails(id){requested=id;return {data:{client:{id:'client-id',name:'Synthetic client'},user:{id:'synthetic-user'},scope:'',redirect_uri:'https://example.test/callback'}}},async approveAuthorization(){approved++;return {error:new Error('synthetic failure')}}}}}}
    render(React.createElement(Panel,{cloud}))
    await screen.findByText('Synthetic client')
    assert.equal(requested,'synthetic-request');assert.equal(approved,0)
    fireEvent.click(screen.getByRole('button',{name:'내 기록 조회 허용'}))
    await screen.findByText(/승인을 완료하지 못/);assert.equal(approved,1)
    const {formatGptRecords}=await server.ssrLoadModule('/src/lib/gptExport.js')
    const output=formatGptRecords({sessions:[{date:'2030-01-01',dayId:'synthetic',status:'started',journal:'Synthetic journal'}],sets:[{date:'2030-01-01',dayId:'synthetic',exerciseId:'synthetic',setIndex:0,weight:0,reps:null,rir:0,completed:false}]})
    assert.match(output,/로컬 저장/);assert.match(output,/0kg × 반복수 미기록 · RIR 0 · 미완료/);assert.match(output,/Synthetic journal/)
    const {repository}=await server.ssrLoadModule('/src/lib/storage.js');await repository.close()
  } finally {cleanup();await server.close();dom.window.close()}
})
