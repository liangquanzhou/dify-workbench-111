import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { connectReaders, readerConnected, clearReaderConnections, readFromApp } from '../dist/test-api.mjs'
const id='11111111-1111-4111-8111-111111111111',wid='22222222-2222-4222-8222-222222222222'
const url=`https://dify.test/app/${id}/workflow`
const raw=fs.readFileSync(new URL('./fixtures/stored/when-any-response.json',import.meta.url),'utf8')
const ref={table:'triage.synthetic-sensors',format:'decision-table/v1',version:'3'}
const config=()=>({schema:'dmn-preview.reader-apps/v1',origin:'https://dify.test',editorAppId:id,readers:[{table:ref.table,mode:'version',appCode:'testreadercode',readAppId:id,publishedWorkflowId:wid}]})
const signal=()=>new AbortController().signal
const final=(change={})=>({event:'workflow_finished',data:{id:'synthetic-run',workflow_id:wid,status:'succeeded',finished_at:123,outputs:{status_code:200,result_json:raw},...change}})
function requestFor(event=final()) {
 const calls=[]
 const request=async(u,opts)=>{calls.push([u,opts]);return new Response(u.endsWith('/passport')?JSON.stringify({access_token:'app-only-test-passport'}):'data: '+JSON.stringify(event)+'\n\n',{status:200})}
 return {request,calls}
}
afterEach(clearReaderConnections)
test('approved reader runs only fixed same-origin routes; sends version, no op/table/body override or console credentials',async()=>{
 connectReaders(JSON.stringify(config()),url);const {request,calls}=requestFor();const p=await readFromApp(ref,url,signal(),request)
 assert.equal(p.models[0].matrix.rows[0].rule.id,'SENSOR_MATCH');assert.match(p.provenance,/查询响应快照/);assert.match(p.provenance,/运行 synthetic-run/)
 assert.deepEqual(calls.map(([u,o])=>[u,o.method]),[['https://dify.test/api/passport','GET'],['https://dify.test/api/workflows/run','POST']])
 assert.deepEqual(JSON.parse(calls[1][1].body),{inputs:{version:'3'},files:[]})
 for(const[,o]of calls){assert.equal(o.redirect,'error');assert.equal(o.credentials,'same-origin');assert.equal(o.cache,'no-store');assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers['X-CSRF-Token'],undefined)}
 assert.equal(calls[1][1].headers['X-App-Passport'],'app-only-test-passport')
})
test('configuration scope changes, duplicate bindings, arbitrary app code and HTTP remote origins are refused',()=>{
 for(const mutate of [c=>c.origin='https://other.test',c=>c.editorAppId=wid,c=>c.readers.push(c.readers[0]),c=>c.readers[0].appCode='../../console',c=>c.readers[0].mode='save']){const c=config();mutate(c);assert.throws(()=>connectReaders(JSON.stringify(c),url));assert.equal(readerConnected(url),false)}
 assert.throws(()=>connectReaders(JSON.stringify(config()),url.replace('https:','http:')))
 connectReaders(JSON.stringify(config()),url);assert.equal(readerConnected(url),true);assert.equal(readerConnected(url.replace(id,wid)),false);assert.equal(readerConnected(url),false)
})
test('pinned version has no fallback to latest; absent binding causes zero requests',async()=>{
 const c=config();c.readers[0].mode='latest';connectReaders(JSON.stringify(c),url);const {request,calls}=requestFor();await assert.rejects(readFromApp(ref,url,signal(),request),/未回退/);assert.equal(calls.length,0)
 await readFromApp({...ref,version:undefined},url,signal(),request);assert.deepEqual(JSON.parse(calls[1][1].body).inputs,{})
})
test('failed run, changed published workflow, missing version, missing body, duplicate finish never render a table',async()=>{
 connectReaders(JSON.stringify(config()),url)
 for(const change of [{status:'failed'},{workflow_id:id},{outputs:{status_code:404,result_json:raw}},{outputs:{status_code:200}},{outputs:{status_code:200,result_json:'{}'}}]){const {request}=requestFor(final(change));await assert.rejects(readFromApp(ref,url,signal(),request))}
 let n=0;const request=async()=>new Response(++n===1?'{"access_token":"x"}':('data: '+JSON.stringify(final())+'\n').repeat(2));await assert.rejects(readFromApp(ref,url,signal(),request),/结束事件/)
})
test('valid response still rejects table/version/digest mismatch',async()=>{
 connectReaders(JSON.stringify(config()),url)
 for(const wrong of [{version:'4'},{digest:'0'.repeat(64)}]){const {request}=requestFor();await assert.rejects(readFromApp({...ref,...wrong},url,signal(),request),/不符/)}
})
test('connection replacement and request cancellation discard returned data',async()=>{
 connectReaders(JSON.stringify(config()),url)
 const {request}=requestFor();let calls=0
 const replaced=async(...args)=>{if(++calls===2)connectReaders(JSON.stringify(config()),url);return request(...args)}
 await assert.rejects(readFromApp(ref,url,signal(),replaced),/连接已切换/)
 const ac=new AbortController();const cancelled=async(...args)=>{const r=await request(...args);ac.abort();return r}
 await assert.rejects(readFromApp(ref,url,ac.signal,cancelled),/连接已切换/)
})
test('unauthorized interface fails without exposing server body or passport',async()=>{
 connectReaders(JSON.stringify(config()),url)
 await assert.rejects(readFromApp(ref,url,signal(),async()=>new Response('secret token',{status:403})),e=>e.message.includes('HTTP 403')&&!e.message.includes('secret'))
})

test('late connection file cannot re-enable after disconnect or node switch',async()=>{
 const {JSDOM}=await import('jsdom');const {renderSnapshot}=await import('../dist/test-api.mjs')
 for(const action of ['disconnect','switch']){
  const document=new JSDOM('<main></main>',{url}).window.document,container=document.querySelector('main')
  renderSnapshot(container,{status:'unsupported',nodeId:'A',message:'存储引用',storage:ref})
  let resolve;const text=new Promise(r=>resolve=r)
  const file=container.querySelector('input[aria-label="选择维护者提供的查询连接 JSON"]')
  Object.defineProperty(file,'files',{value:[{size:100,text:()=>text}]})
  ;[...container.querySelectorAll('button')].find(b=>b.textContent==='启用查询与自动读取').click()
  if(action==='disconnect')[...container.querySelectorAll('button')].find(b=>b.textContent==='断开查询').click()
  else renderSnapshot(container,{status:'unsupported',nodeId:'B',message:'其他节点'})
  resolve(JSON.stringify(config()));await new Promise(r=>setTimeout(r,5))
  assert.equal(readerConnected(url),false)
  assert.equal(container.querySelector('table'),null)
 }
})


test('AgentHub v2 workflow URL preserves query scope; chat mode cannot reuse connection',()=>{
 const agentHub=url.replace('/app/', '/v2/app/').replace('/workflow','?mode=workflow')
 connectReaders(JSON.stringify(config()),agentHub)
 assert.equal(readerConnected(agentHub),true)
 assert.equal(readerConnected(agentHub.replace('mode=workflow','mode=chat')),false)
 assert.equal(readerConnected(agentHub),false)
})
