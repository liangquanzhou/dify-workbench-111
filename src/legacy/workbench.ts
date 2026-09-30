import fs from 'node:fs';
import path from 'node:path';
import {Console111} from './transport.ts';
import {build,loadConfig,readState,saveState,targetKey,cookiesFromEnv,type Loaded} from './config.ts';
import {readDsl,normalizeDsl,SUPPORTED_NODE_TYPES} from './dsl.ts';
import {digest,snapshot,diffPaths,redact} from './util.ts';
import {LegacyError,requireThat,type Obj} from './types.ts';
export const ACTIONS=['build','capabilities','snapshot','diff','sync','test','logs','runs','stop','node-defaults','node-run','node-last-run','publish'] as const;
export type Action=typeof ACTIONS[number];
function baseline(d:Obj):Obj{return {hash:d.hash,digest:digest(snapshot(d)),updated_at:d.updated_at};}
function assertBaseline(l:Loaded,state:Obj|undefined,d:Obj):asserts state is Obj {
  requireThat(state?.target_key===targetKey(l)&&state.baseline,'BASELINE_REQUIRED','Run snapshot to bind the exact target and capture the edit baseline first');
  requireThat(!state.pending_mutation,'MUTATION_UNRESOLVED','A prior write/run/publish is unresolved. Inspect the server, then explicitly snapshot --accept-current before continuing');
  requireThat(state.baseline.hash===d.hash&&state.baseline.digest===digest(snapshot(d))&&state.baseline.updated_at===d.updated_at,'DRAFT_CONFLICT','Remote draft changed since your baseline. Review and merge; no automatic overwrite or retry');
}
function logSummary(run:Obj,nodes:any,includeData:boolean):Obj {
  const list=Array.isArray(nodes)?nodes:(nodes?.data??nodes?.items??[]);
  return {run:includeData?run:{id:run.id,status:run.status,error:run.error,elapsed_time:run.elapsed_time,total_steps:run.total_steps},nodes:includeData?list:list.map((n:Obj)=>({id:n.id,node_id:n.node_id,node_type:n.node_type,title:n.title,status:n.status,error:n.error,elapsed_time:n.elapsed_time}))};
}
export async function execute(action:string,args:Obj={},options:{configFile?:string;client?:Console111}={}):Promise<Obj> {
  requireThat((ACTIONS as readonly string[]).includes(action),'UNSUPPORTED_ACTION','Action is not exposed by the dify-1.11.1 profile');
  const allowed=new Set(['action','expected_digest','confirm_publish','inputs','files','query','conversation_id','run_id','task_id','node_id','node_type','last_id','limit','accept_current','include_data']);
  for(const key of Object.keys(args))requireThat(allowed.has(key),'UNSUPPORTED_ARGUMENT',`Unsupported argument: ${key}`);
  if(args.limit!==undefined)requireThat(Number.isInteger(Number(args.limit))&&Number(args.limit)>0&&Number(args.limit)<=100,'INVALID_LIMIT','limit must be an integer between 1 and 100');
  if(action==='capabilities')return {ok:true,profile:'dify-1.11.1',dsl_version:'0.5.0',actions:ACTIONS,node_types:SUPPORTED_NODE_TYPES,remote_verified:false,unavailable:['login','create-app','native-import','delete','generate-api-key','install-plugin','RAG','trigger','agent-v2','snippet'],note:'Core path is fixture/mock tested; company SSO and real Dify deployment are not yet verified.'};
  const l=loadConfig(options.configFile??process.env.DIFYWF_CONFIG??'dify-workbench.json');
  if(action==='build')return build(l);
  requireThat(l.config.permissions?.remote===true,'REMOTE_DISABLED','Remote access is disabled. Review the exact target and explicitly enable permissions.remote');
  const client=options.client??new Console111({baseUrl:l.config.target.base_url,cookies:cookiesFromEnv(),timeoutMs:l.config.timeout_ms});
  const mutating=['sync','test','stop','node-run','publish'].includes(action);
  if(mutating){const permission=action==='sync'?'sync':action==='publish'?'publish':'test';requireThat(l.config.permissions?.[permission]===true,'ACTION_DISABLED',`Enable permissions.${permission} only after approving this target/action`);}
  // One local writer at a time. This does not prevent other Dify UI clients from editing.
  let lock:number|undefined;
  fs.mkdirSync(path.dirname(l.stateFile),{recursive:true,mode:0o700});
  try {lock=fs.openSync(l.stateFile+'.lock','wx',0o600);}catch{throw new LegacyError('LOCAL_LOCKED','Another workbench operation is active or a stale lock requires manual inspection');}
  try {
    const ws=await client.currentWorkspace();requireThat(ws.id===l.config.target.workspace_id,'WORKSPACE_MISMATCH','Authenticated workspace differs from the pinned workspace. No workspace switching is performed');
    const app=await client.getApp(l.config.target.app_id);requireThat(app.id===l.config.target.app_id&&app.mode===l.config.target.mode,'APP_MISMATCH','App identity or mode differs from the pinned target');
    const id=l.config.target.app_id;let state=readState(l);
    if(action==='runs'){requireThat(args.page===undefined,'CURSOR_REQUIRED','Dify 1.11.1 uses last_id, not page');return {ok:true,...await client.listRuns(id,{last_id:args.last_id,limit:args.limit===undefined?undefined:Number(args.limit)})};}
    if(action==='logs'){requireThat(typeof args.run_id==='string','RUN_ID_REQUIRED','Use workflow_run_id, not task_id');return {ok:true,...logSummary(await client.getRun(id,args.run_id),await client.nodeExecutions(id,args.run_id),args.include_data===true)};}
    if(action==='node-defaults')return {ok:true,data:await client.nodeDefaults(id,args.node_type)};
    if(action==='node-last-run'){requireThat(typeof args.node_id==='string','NODE_ID_REQUIRED','node_id required');const n=await client.nodeLastRun(id,args.node_id);return {ok:true,data:args.include_data===true?n:{node_id:n.node_id,status:n.status,error:n.error,elapsed_time:n.elapsed_time}};}
    if(action==='stop'){requireThat(typeof args.task_id==='string','TASK_ID_REQUIRED','Use task_id, not workflow_run_id');requireThat(state?.target_key===targetKey(l)&&state.known_tasks?.some((r:Obj)=>r.task_id===args.task_id&&r.target_key===targetKey(l)),'TASK_TARGET_UNVERIFIED','Only task IDs recorded by this workbench for the pinned target can be stopped');return {ok:true,data:await client.stop(id,args.task_id)};}
    const draft=await client.getDraft(id);requireThat(typeof draft.hash==='string'&&!!draft.hash,'INVALID_DRAFT','Remote draft must include its edit hash');
    if(action==='snapshot'){
      if(state&&(state.pending_mutation||state.baseline?.digest!==digest(snapshot(draft))))requireThat(args.accept_current===true,'BASELINE_REVIEW_REQUIRED','Existing baseline differs or a mutation is unresolved; inspect remote content before snapshot --accept-current');
      state={schema:1,target_key:targetKey(l),target:l.config.target,baseline:baseline(draft),known_tasks:state?.target_key===targetKey(l)?state.known_tasks??[]:[]};saveState(l,state);
      return {ok:true,action,app_id:id,baseline:state.baseline,warnings:['Captured current draft as edit baseline. This is not a production backup.','Secret values are masked; changes behind the mask cannot be detected.']};
    }
    assertBaseline(l,state,draft);
    if(action==='diff'||action==='sync'){
      const dsl=readDsl(l.dslFile),normalized=normalizeDsl(dsl,draft,l.config.target.mode,l.config.dataset_bindings);
      for(const dataset of normalized.datasetIds){const d=await client.getDataset(dataset);requireThat(d.id===dataset,'DATASET_BINDING','Dataset mapping could not be verified in the current workspace');}
      const wanted=digest(normalized.payload),paths=diffPaths(snapshot(draft),normalized.payload);
      if(action==='diff')return {ok:true,action,app_id:id,base_digest:state.baseline.digest,desired_digest:wanted,changed:paths.length>0,changed_paths:paths,warnings:normalized.warnings};
      requireThat(args.expected_digest===wanted,'DIGEST_CONFIRMATION_REQUIRED','Pass --expected-digest from a reviewed diff of this exact DSL');
      if(paths.length===0)return {ok:true,action,app_id:id,changed:false,draft_digest:wanted,warnings:normalized.warnings};
      // Uses the ORIGINAL edit baseline hash, never a freshly fetched hash to bless stale local work.
      state.pending_mutation={action:'sync',desired_digest:wanted,at:new Date().toISOString()};delete state.test_receipt;saveState(l,state);
      const result=await client.syncDraft(id,{...normalized.payload,hash:state.baseline.hash});
      requireThat(result.result==='success'&&typeof result.hash==='string','SYNC_UNCERTAIN','Unexpected sync acknowledgement. Inspect remote state; no retry');
      const readback=await client.getDraft(id);requireThat(digest(snapshot(readback))===wanted&&readback.hash===result.hash,'READBACK_MISMATCH','Remote draft differs from requested content; write may have occurred. Inspect, do not retry');
      state.baseline=baseline(readback);delete state.pending_mutation;saveState(l,state);
      return {ok:true,action,app_id:id,changed:true,draft_digest:wanted,hash:readback.hash,readback_verified:true,warnings:normalized.warnings};
    }
    const current=digest(snapshot(draft));
    requireThat(args.expected_digest===current,'DIGEST_CONFIRMATION_REQUIRED','Pass --expected-digest for the exact current draft');
    if(action==='test'||action==='node-run'){
      requireThat(args.inputs===undefined||(args.inputs&&typeof args.inputs==='object'&&!Array.isArray(args.inputs)),'INVALID_INPUTS','inputs must be an object');
      requireThat(args.files===undefined||Array.isArray(args.files),'INVALID_FILES','files must be an array');
      if(action==='node-run')requireThat(typeof args.node_id==='string'&&draft.graph.nodes.some((n:Obj)=>n.id===args.node_id),'NODE_NOT_FOUND','node_id must identify a node in the pinned draft');
      const body:Obj={inputs:args.inputs??{},files:args.files??[]};
      if(l.config.target.mode==='advanced-chat'){requireThat(typeof args.query==='string','QUERY_REQUIRED','advanced-chat testing needs query');body.query=args.query;if(args.conversation_id)body.conversation_id=args.conversation_id;}
      state.pending_mutation={action,at:new Date().toISOString(),draft_digest:current};delete state.test_receipt;saveState(l,state);
      if(action==='node-run'){
        requireThat(typeof args.node_id==='string','NODE_ID_REQUIRED','node_id required');const n=draft.graph.nodes.find((n:Obj)=>n.id===args.node_id);requireThat(n,'NODE_NOT_FOUND','Node not in the pinned draft');
        const kind=n.data.type==='iteration'?'iteration':n.data.type==='loop'?'loop':'node';const result=await client.runNode(id,args.node_id,kind,body,l.config.target.mode);
        if(result.task_id)state.known_tasks=[...(state.known_tasks??[]),{task_id:result.task_id,run_id:result.workflow_run_id,target_key:targetKey(l)}].slice(-100);
        if(result.status==='unknown'){state.pending_mutation={...state.pending_mutation,task_id:result.task_id,workflow_run_id:result.workflow_run_id};}else delete state.pending_mutation;saveState(l,state);return {ok:result.status==='succeeded',action,data:args.include_data===true?result:redact({status:result.status,node_id:args.node_id,error:result.error}),qualifies_for_publish:false};
      }
      const run=await client.runDraft(id,l.config.target.mode,body);
      if(run.task_id)state.known_tasks=[...(state.known_tasks??[]),{task_id:run.task_id,run_id:run.workflow_run_id,target_key:targetKey(l)}].slice(-100);
      if(run.status==='unknown'){state.pending_mutation={...state.pending_mutation,task_id:run.task_id,workflow_run_id:run.workflow_run_id};saveState(l,state);return {ok:false,action,status:run.status,task_id:run.task_id,workflow_run_id:run.workflow_run_id,error:run.error,note:'Execution outcome is unknown. Use logs/stop, inspect, then adopt a fresh baseline. Never blindly rerun.'};}
      const after=await client.getDraft(id);requireThat(digest(snapshot(after))===current&&after.hash===draft.hash&&after.updated_at===draft.updated_at,'TEST_DRAFT_CHANGED','Draft changed during test; result does not qualify for publish');
      delete state.pending_mutation;
      let logs:Obj|undefined,verifiedRun=false;
      if(run.workflow_run_id){try{const detail=await client.getRun(id,run.workflow_run_id);verifiedRun=detail.id===run.workflow_run_id&&detail.status==='succeeded'&&digest(detail.graph)===digest(draft.graph);logs=logSummary(detail,await client.nodeExecutions(id,run.workflow_run_id),args.include_data===true);}catch{logs={warning:'Run log read failed; retry the read-only logs command'};}}
      if(run.status==='succeeded'&&run.workflow_run_id&&verifiedRun)state.test_receipt={draft_digest:current,hash:after.hash,run_id:run.workflow_run_id,at:new Date().toISOString(),status:'succeeded',target_key:targetKey(l)};
      if(run.status==='succeeded'&&!verifiedRun){state.pending_mutation={action:'test',draft_digest:current,workflow_run_id:run.workflow_run_id,reason:'RUN_LOG_UNVERIFIED'};}
      saveState(l,state);
      return {ok:run.status==='succeeded'&&verifiedRun,action,status:run.status==='succeeded'&&!verifiedRun?'unknown':run.status,task_id:run.task_id,workflow_run_id:run.workflow_run_id,draft_digest:current,error:run.status==='succeeded'&&!verifiedRun?'RUN_LOG_UNVERIFIED':run.error,logs,...(args.include_data===true?{events:run.events}:{}),qualifies_for_publish:!!state.test_receipt};
    }
    if(action==='publish'){
      requireThat(args.confirm_publish===current,'PUBLISH_CONFIRMATION_REQUIRED','Publishing is separate: pass --confirm-publish with the tested draft digest');
      requireThat(state.test_receipt?.status==='succeeded'&&state.test_receipt.draft_digest===current&&state.test_receipt.target_key===targetKey(l),'UNTESTED_DRAFT','Publish requires a successful full test of this exact target and draft');
      state.pending_mutation={action:'publish',draft_digest:current,at:new Date().toISOString()};saveState(l,state);
      const result=await client.publish(id);requireThat(result.result==='success','PUBLISH_UNCERTAIN','Unexpected publish acknowledgement; no retry');
      const published=await client.getPublished(id);requireThat(digest(snapshot(published))===current,'PUBLISH_READBACK_MISMATCH','Published content differs from tested draft. Inspect; never retry publish automatically');
      state.last_publish={draft_digest:current,workflow_id:published.id,at:new Date().toISOString()};delete state.pending_mutation;delete state.test_receipt;saveState(l,state);
      return {ok:true,action,published_workflow_id:published.id,draft_digest:current,readback_verified:true,warnings:['Dify 1.11.1 publish has no content CAS. A single-writer agreement is required; readback detects, but cannot prevent, a concurrent edit.']};
    }
    throw new LegacyError('UNSUPPORTED_ACTION','Action is not implemented');
  } finally {if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(l.stateFile+'.lock');}}
}
