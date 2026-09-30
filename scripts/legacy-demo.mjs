// Fully synthetic HTTP/CLI integration demo. Never connects to a company server.
import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {parseDsl} from '../src/legacy/dsl.ts';
const exec=promisify(execFile),root=fs.mkdtempSync(path.join(os.tmpdir(),'dify111-demo-'));
const original=parseDsl(fs.readFileSync(new URL('../examples/legacy/echo.yml',import.meta.url),'utf8'));
let draft={...structuredClone(original.workflow),id:'synthetic-draft',hash:'h0',updated_at:0};let seq=0,lastRun,requests=[];
const server=http.createServer(async(req,res)=>{
 const p=req.url.replace('/console/api/','');requests.push({method:req.method,path:p});let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
 const json=(x,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(x));};
 if(p==='workspaces/current')return json({id:'synthetic-workspace'});
 if(p==='apps/synthetic-app')return json({id:'synthetic-app',mode:'workflow'});
 if(p==='apps/synthetic-app/workflows/draft'){
  if(req.method==='GET')return json(draft);
  if(body.hash!==draft.hash)return json({code:'draft_workflow_not_sync'},400);
  draft={...body,id:'synthetic-draft',hash:'h'+(++seq),updated_at:seq};return json({result:'success',hash:draft.hash});
 }
 if(p==='apps/synthetic-app/workflows/draft/run'){
  const failed=JSON.stringify(draft.graph).includes('RAISE_SYNTHETIC_ERROR');lastRun={id:'run-'+seq,graph:draft.graph,status:failed?'failed':'succeeded',error:failed?'Synthetic code failure':null,outputs:{result:'synthetic mock output'}};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end([{event:'workflow_started',task_id:'task-'+seq,workflow_run_id:lastRun.id,data:{id:lastRun.id}},{event:'workflow_finished',workflow_run_id:lastRun.id,data:lastRun}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));return;
 }
 if(p===`apps/synthetic-app/workflow-runs/${lastRun?.id}`)return json(lastRun);
 if(p===`apps/synthetic-app/workflow-runs/${lastRun?.id}/node-executions`)return json({data:[{node_id:'echo',status:lastRun.status,error:lastRun.error}]});
 json({error:'unsupported synthetic endpoint'},404);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const config=path.join(root,'config.json'),dslFile=path.join(root,'echo.yml');
fs.writeFileSync(config,JSON.stringify({profile:'dify-1.11.1',target:{base_url:`http://127.0.0.1:${server.address().port}`,workspace_id:'synthetic-workspace',app_id:'synthetic-app',mode:'workflow'},dsl:'echo.yml',permissions:{remote:true,sync:true,test:true,publish:false}}));fs.writeFileSync(dslFile,JSON.stringify(original));
const cli=fileURLToPath(new URL('../bin/difywf.js',import.meta.url));
const run=async(action,args=[])=>{try{const r=await exec(process.execPath,[cli,action,'--config',config,...args],{env:{...process.env,DIFY_CONSOLE_COOKIE:'__Host-access_token=DEMO_ACCESS_TOKEN_111; __Host-csrf_token=DEMO_CSRF_TOKEN_111'}});return JSON.parse(r.stdout);}catch(e){if(e.stdout)return JSON.parse(e.stdout);throw e;}};
try {
 await run('build');await run('snapshot');const results=[];
 for(const value of ['RAISE_SYNTHETIC_ERROR','fixed synthetic echo']){const local=structuredClone(original);local.workflow.graph.nodes[1].data.code=value;fs.writeFileSync(dslFile,JSON.stringify(local));const diff=await run('diff');const sync=await run('sync',['--expected-digest',diff.desired_digest]);if(!sync.ok)throw new Error(JSON.stringify(sync));const test=await run('test',['--expected-digest',sync.draft_digest,'--inputs','{"text":"synthetic"}']);results.push({app_id:sync.app_id,sync_verified:sync.readback_verified,status:test.status,node_id:test.logs?.nodes?.[0]?.node_id,error:test.error});}
 if(results[0].status!=='failed'||results[1].status!=='succeeded')throw new Error('Synthetic loop did not match expected failure/fix');
 console.log(JSON.stringify({ok:true,simulation:true,real_dify_verified:false,results,created_apps:0,publish_requests:requests.filter(r=>r.path.includes('/publish')).length},null,2));
} finally {server.close();fs.rmSync(root,{recursive:true,force:true});}
