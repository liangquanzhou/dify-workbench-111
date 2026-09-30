import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Console111} from '../src/legacy/transport.ts';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const sse=(events:unknown[],end=true)=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join('')+(end?'':''),{headers:{'content-type':'text/event-stream'}});
function client(fn:typeof fetch){return new Console111({baseUrl:'https://dify.example.test',cookies:{'__Host-access_token':'SYNTHETIC_ACCESS','__Host-csrf_token':'SYNTHETIC_CSRF'},fetchImpl:fn});}
test('111 cookie + CSRF, workflow/chat routes, no redirect/retry',async()=>{
 const seen:any[]=[];const c=client(async(u,o)=>{seen.push({u:String(u),o});return sse([{event:'workflow_started',task_id:'task',data:{id:'run'}},{event:'workflow_finished',data:{id:'run',status:'succeeded'}}]);});
 const r=await c.runDraft('app','workflow',{inputs:{},files:[]});assert.equal(r.status,'succeeded');assert.equal(r.task_id,'task');assert.equal(r.workflow_run_id,'run');
 await c.runDraft('app','advanced-chat',{inputs:{},query:'synthetic'});assert.match(seen[1].u,/advanced-chat\/workflows\/draft\/run$/);assert.equal(seen[0].o.redirect,'error');assert.equal(seen[0].o.headers['X-CSRF-Token'],'SYNTHETIC_CSRF');assert.match(seen[0].o.headers.Cookie,/__Host-access_token/);
});
test('111 HTTP HTML 200, bad JSON, 401 and 403 fail, never retried',async()=>{
 for(const response of [new Response('<html>SSO</html>',{headers:{'content-type':'text/html'}}),new Response('nope',{headers:{'content-type':'application/json'}}),json({},401),json({},403)]){let n=0;const c=client(async()=>{n++;return response;});await assert.rejects(c.syncDraft('app',{}));assert.equal(n,1);}
});
test('111 SSE failed/stopped/error/partial/incomplete/conflicting never succeed',async()=>{
 for(const [events,status] of [ [[{event:'workflow_finished',data:{status:'failed',error:'bad'}}],'failed'], [[{event:'workflow_finished',data:{status:'stopped'}}],'stopped'], [[{event:'workflow_finished',data:{status:'partial-succeeded'}}],'failed'], [[{event:'error',message:'bad'}],'failed'], [[{event:'workflow_started',task_id:'t'}],'unknown'], [[{event:'error'},{event:'workflow_finished',data:{status:'succeeded'}}],'unknown'] ] as const){const r=await client(async()=>sse([...events])).runDraft('app','workflow',{});assert.equal(r.status,status);}
});
test('111 SSE CRLF boundaries, multiline data, UTF8 chunks and cookie redaction',async()=>{
 const raw='data: {"event":"workflow_finished",\r\ndata: "data":{"status":"succeeded","error":"SYNTHETIC_ACCESS 中文"}}\r\n\r\n';const b=new TextEncoder().encode(raw);
 const stream=new ReadableStream({start(c){for(const byte of b)c.enqueue(Uint8Array.of(byte));c.close();}});
 const r=await client(async()=>new Response(stream,{headers:{'content-type':'text/event-stream'}})).runDraft('app','workflow',{});assert.equal(r.status,'succeeded');assert.equal(r.error,'[REDACTED] 中文');
});
test('111 SSE abort is unknown even after started, retains IDs',async()=>{
 let n=0;const stream=new ReadableStream({pull(c){if(n++===0)c.enqueue(new TextEncoder().encode('data: {"event":"workflow_started","task_id":"t","workflow_run_id":"r"}\n\n'));else c.error(new Error('aborted'));}});
 const r=await client(async()=>new Response(stream,{headers:{'content-type':'text/event-stream'}})).runDraft('app','workflow',{});assert.equal(r.status,'unknown');assert.equal(r.task_id,'t');assert.equal(r.workflow_run_id,'r');
});
test('111 logs and dependency paths use run ID and last_id cursor',async()=>{
 const paths:string[]=[];const c=client(async(u)=>{paths.push(String(u));return json({});});await c.currentWorkspace();await c.checkDependencies('app');await c.listRuns('app',{last_id:'cursor'});await c.getRun('app','run');await c.nodeExecutions('app','run');
 assert.match(paths[1],/apps\/imports\/app\/check-dependencies$/);assert.match(paths[2],/triggered_from=debugging/);assert.match(paths[2],/last_id=cursor/);assert.doesNotMatch(paths[2],/page=/);assert.match(paths[3],/workflow-runs\/run$/);assert.match(paths[4],/workflow-runs\/run\/node-executions$/);
});
test('111 insecure external URLs are rejected',()=>{assert.throws(()=>new Console111({baseUrl:'http://company.example',cookies:{}}));assert.throws(()=>new Console111({baseUrl:'https://user:pw@company.example',cookies:{}}));});
test('111 server-side hash conflict is classified without echoing error body',async()=>{const c=client(async()=>json({code:'draft_workflow_not_sync',message:'SYNTHETIC_ACCESS'},400));await assert.rejects(c.syncDraft('app',{}),(e:any)=>e.code==='DRAFT_CONFLICT'&&!JSON.stringify(e).includes('SYNTHETIC_ACCESS'));});
