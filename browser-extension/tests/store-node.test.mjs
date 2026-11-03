import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import { extractTable, previewStoreResult, lastRunUrl, readStoreLastRun, renderSnapshot } from '../dist/test-api.mjs'
const raw=fs.readFileSync(new URL('./fixtures/stored/when-any-response.json',import.meta.url),'utf8')
const doc=JSON.parse(raw).doc, table=doc.table
const url='https://dify.test/app/11111111-1111-4111-8111-111111111111/workflow'
const node='store', signal=()=>new AbortController().signal
const run=()=>({id:'synthetic-last-run',node_id:node,node_type:'tool',status:'succeeded',finished_at:1700000000,inputs:{op:'version',table,version:'3'},outputs:{status_code:200,result_json:raw}})
const request=(value=run())=>async()=>new Response(JSON.stringify(value))
const snapshot=()=>extractTable({type:'tool',provider_type:'builtin',provider_id:'hu8627/dmn_json/dmn_json',tool_name:'route_table_store',title:'路由表存取',tool_parameters:Object.fromEntries(['op','table','version','body_json'].map(k=>[k,{type:'variable',value:['start',k]}]))},node)
test('variable-bound route_table_store is recognized without pretending config is a table',()=>{
 const s=snapshot();assert.equal(s.status,'dynamic');assert.deepEqual(s.storeNode,{});assert.match(s.message,/不会执行节点/);assert.equal(s.raw,undefined)
})
test('saved result preserves when_any, templates, version and raw digest',async()=>{
 const p=await previewStoreResult(raw,{},'synthetic.json');assert.equal(p.models[0].matrix.rows.length,3);assert.match(p.models[0].matrix.rows[0].logic,/或/);assert.deepEqual(p.document,doc);assert.match(p.provenance,/不是当前存储版本/)
 for(const ref of [{table:'wrong'},{op:'version',version:'4'}])await assert.rejects(previewStoreResult(raw,ref,'synthetic.json'),/不符/)
 await assert.rejects(previewStoreResult(raw.replace('SENSOR_MATCH','TAMPERED'),{},'synthetic.json'),/摘要/)
 await assert.rejects(previewStoreResult('{"versions":[1,2,3]}',{},'history.json'),/没有完整/)
})
test('last-run uses GET only, same origin and existing session with no auth extraction',async()=>{
 const calls=[];const p=await readStoreLastRun({},url,node,signal(),[],async(u,o)=>{calls.push([u,o]);return request()()})
 assert.equal(calls.length,1);assert.equal(calls[0][0],lastRunUrl(url,node));assert.equal(calls[0][1].method,'GET');assert.equal(calls[0][1].credentials,'same-origin');assert.equal(calls[0][1].redirect,'error');assert.deepEqual(calls[0][1].headers,{Accept:'application/json'});assert.equal(calls[0][1].body,undefined)
 assert.match(p.provenance,/历史结果快照/);assert.match(p.provenance,/未执行节点/);assert.match(p.provenance,/synthetic-last-run/)
})
test('custom prefix needs an observed exact current app/node last-run route; no guessed company endpoint',()=>{
 const custom=url.replace('/app/','/v2/app/').replace('/workflow','?mode=workflow'), endpoint=lastRunUrl(url,node).replace('/console/api/','/gateway/api/')
 assert.throws(()=>lastRunUrl(custom,node),/尚未确认/)
 assert.equal(lastRunUrl(custom,node,[endpoint]),endpoint)
 for(const path of [endpoint.replace('dify.test','other.test'),endpoint.replace('/store/','/other/'),endpoint+'?token=secret',endpoint.replace('/last-run','/run'),endpoint.replace('/gateway/api/','/save/')])assert.throws(()=>lastRunUrl(custom,node,[path]))
 assert.throws(()=>lastRunUrl(custom,node,[endpoint,lastRunUrl(url,node)]),/尚未确认/)
 assert.throws(()=>lastRunUrl(url,'../run'))
})
test('failed, unrelated, missing-body or history-only runs cannot become tables',async()=>{
 for(const mutate of [r=>r.node_id='other',r=>r.status='failed',r=>r.node_type='code',r=>r.inputs.op='history',r=>r.inputs.table='wrong',r=>r.inputs.version='4',r=>r.outputs.status_code=403,r=>delete r.outputs.result_json]){
  const r=run();mutate(r);await assert.rejects(readStoreLastRun({},url,node,signal(),[],request(r)))
 }
 await assert.rejects(readStoreLastRun({op:'table'},url,node,signal(),[],request()),/操作/)
 await assert.rejects(readStoreLastRun({},url,node,signal(),[],async()=>new Response('secret body',{status:403})),e=>/HTTP 403/.test(e.message)&&!e.message.includes('secret'))
 const r=run();r.inputs.op='save';const p=await readStoreLastRun({},url,node,signal(),[],request(r));assert.match(p.provenance,/操作 save/)
})
test('byte limits and cancellation are enforced before rendering',async()=>{
 await assert.rejects(readStoreLastRun({},url,node,signal(),[],async()=>new Response('x'.repeat(8*1024*1024+1))),/8 MiB/)
 const ac=new AbortController();await assert.rejects(readStoreLastRun({},url,node,ac.signal,[],async()=>{ac.abort();return request()()}),/取消/)
})
test('UI reads only on click; switching nodes or changing URL discards late historical response',async()=>{
 const original=globalThis.fetch
 try{
  for(const action of ['switch','navigate']){
   const dom=new JSDOM('<main></main>',{url}), container=dom.window.document.querySelector('main');let resolve,calls=0
   globalThis.fetch=async()=>{calls++;return new Promise(r=>resolve=r)}
   renderSnapshot(container,snapshot());assert.equal(calls,0);assert.equal(container.querySelector('table'),null)
   container.querySelector('button').click();assert.equal(calls,1)
   if(action==='switch')renderSnapshot(container,{status:'idle',message:'another node'});else dom.reconfigure({url:url.replace('11111111','22222222')})
   resolve(new Response(JSON.stringify(run())));await new Promise(r=>setTimeout(r,10));assert.equal(container.querySelector('table'),null)
  }
 }finally{globalThis.fetch=original}
})
test('UI shows labeled historical matrix and clears it after a failed refresh',async()=>{
 const original=globalThis.fetch
 try{
  const dom=new JSDOM('<main></main>',{url}), c=dom.window.document.querySelector('main')
  globalThis.fetch=request();renderSnapshot(c,snapshot());c.querySelector('button').click();await new Promise(r=>setTimeout(r,10))
  assert.equal(c.dataset.status,'historical');assert.equal(c.querySelectorAll('tbody tr').length,3);assert.match(c.textContent,/未确认当前存储版本/)
  globalThis.fetch=async()=>new Response('{}',{status:404});c.querySelector('button').click();await new Promise(r=>setTimeout(r,10));assert.equal(c.dataset.status,'error');assert.equal(c.querySelector('table'),null)
 }finally{globalThis.fetch=original}
})
