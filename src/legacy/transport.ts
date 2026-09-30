import {csrfValue} from '../core/cookies.ts';
import {LegacyError,requireThat,type Obj,type Mode,type RunResult} from './types.ts';
import {redact} from './util.ts';
const enc=encodeURIComponent;
export class Console111 {
  base:string; cookies:Record<string,string>; timeout:number; fetchImpl:typeof fetch;
  constructor(opts:{baseUrl:string;cookies:Record<string,string>;timeoutMs?:number;fetchImpl?:typeof fetch}) {
    const u=new URL(opts.baseUrl);
    requireThat(!u.username&&!u.password&&!u.search&&!u.hash,'INVALID_TARGET','Target URL must not contain credentials, query, or fragment');
    requireThat(u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)),'INSECURE_TARGET','Use HTTPS, or loopback HTTP for isolated tests');
    this.base=u.href.replace(/\/$/,''); this.cookies=opts.cookies;this.timeout=opts.timeoutMs??300000;this.fetchImpl=opts.fetchImpl??fetch;
  }
  private async response(path:string,body?:unknown,stream=false,method?:string):Promise<Response> {
    const headers:Record<string,string>={Accept:stream?'text/event-stream':'application/json',Cookie:Object.entries(this.cookies).map(([k,v])=>`${k}=${v}`).join('; ')};
    const csrf=csrfValue(this.cookies);if(csrf)headers['X-CSRF-Token']=csrf;
    if(body!==undefined)headers['Content-Type']='application/json';
    let r:Response;
    try {r=await this.fetchImpl(`${this.base}/console/api/${path}`,{method:method??(body!==undefined?'POST':'GET'),headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(this.timeout)});}
    catch {throw new LegacyError('REQUEST_UNCERTAIN','Request did not complete; a mutation may have taken effect. No automatic retry.');}
    if(!r.ok) {
      let code=({401:'AUTH_EXPIRED',403:'RBAC_DENIED',404:'NOT_FOUND',409:'CONFLICT',429:'RATE_LIMITED'} as Obj)[r.status]??'HTTP_ERROR';
      // Only recognize a bounded error code; never echo response data or HTML.
      if(r.status===400&&r.headers.get('content-type')?.includes('application/json')&&r.body){
        const reader=r.body.getReader();let n=0;const parts:Uint8Array[]=[];
        try{while(true){const chunk=await reader.read();if(chunk.done)break;n+=chunk.value.length;if(n>8192)break;parts.push(chunk.value);}if(n<=8192){const data=JSON.parse(Buffer.concat(parts).toString('utf8'));if(/draft.*not.*sync|workflow.*hash.*not.*equal/i.test(String(data.code??'')))code='DRAFT_CONFLICT';}}
        catch{}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      }
      // Never include a response body: it can contain credentials, HTML, or business data.
      try {await r.body?.cancel();}catch{}
      throw new LegacyError(code,r.status===401?'Console session expired. Renew it through your approved login flow; credentials are never saved.':`Console HTTP ${r.status}; no automatic retry`,{status:r.status});
    }
    const type=r.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    requireThat(stream?type==='text/event-stream':type==='application/json'||!!type?.endsWith('+json'),'INVALID_CONTENT_TYPE',`Expected ${stream?'SSE':'JSON'}; refusing a potentially redirected login page`);
    return r;
  }
  async json(path:string,body?:unknown):Promise<any> {
    const r=await this.response(path,body);let bytes=0;const chunks:Uint8Array[]=[];
    try {for await(const chunk of r.body as any){bytes+=chunk.length;if(bytes>8*1024*1024){await r.body?.cancel().catch(()=>{});throw new LegacyError('RESPONSE_TOO_LARGE','JSON response exceeds 8 MiB');}chunks.push(chunk);}}
    catch(e){if(e instanceof LegacyError)throw e;throw new LegacyError('RESPONSE_UNCERTAIN','Response interrupted; no automatic retry');}
    try {const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));requireThat(data!==null,'INVALID_RESPONSE','Console returned null instead of an object');return data;}
    catch(e){if(e instanceof LegacyError)throw e;throw new LegacyError('INVALID_JSON','Console response is not valid JSON');}
  }
  async stream(path:string,body:Obj):Promise<RunResult> {
    const r=await this.response(path,body,true);const result:RunResult={status:'unknown',events:[]};
    let buffer='',bytes=0,terminal=false,terminalConflict=false,decoder=new TextDecoder();
    const consume=(block:string)=>{
      const data=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');if(!data||data==='[DONE]')return;
      let e:Obj;try{e=JSON.parse(data);}catch{throw new LegacyError('INVALID_SSE','Invalid JSON in SSE data');}
      requireThat(e&&typeof e==='object','INVALID_SSE','SSE event must be an object');
      result.events.push(e);if(result.events.length>10000)throw new LegacyError('RESPONSE_TOO_LARGE','SSE exceeds 10000 events');
      if(e.task_id)result.task_id=e.task_id;if(e.workflow_run_id)result.workflow_run_id=e.workflow_run_id;
      if(e.event==='workflow_started'&&e.data?.id)result.workflow_run_id=e.data.id;
      if(e.event==='workflow_finished') {if(terminal)terminalConflict=true;terminal=true;result.workflow_run_id=e.workflow_run_id??e.data?.id??result.workflow_run_id;const s=e.data?.status;result.status=s==='succeeded'?'succeeded':s==='stopped'?'stopped':s==='failed'||s==='partial-succeeded'?'failed':'unknown';result.error=e.data?.error;}
      if(e.event==='error'){if(terminal)terminalConflict=true;terminal=true;result.status='failed';result.error=e.message??e.error??'SSE error';}
      if(e.event==='node_finished'&&e.data?.status==='failed') result.error=e.data?.error??result.error;
    };
    try {
      for await(const chunk of r.body as any) {
        bytes+=chunk.length;if(bytes>16*1024*1024)throw new LegacyError('RESPONSE_TOO_LARGE','SSE exceeds 16 MiB');
        buffer+=decoder.decode(chunk,{stream:true});buffer=buffer.replaceAll('\r\n','\n');
        let i;while((i=buffer.indexOf('\n\n'))>=0){consume(buffer.slice(0,i));buffer=buffer.slice(i+2);}
      }
      buffer+=decoder.decode();if(buffer.trim())consume(buffer.replaceAll('\r\n','\n'));
    } catch(e) {result.status='unknown';result.error=e instanceof LegacyError?e.code:'STREAM_INTERRUPTED';}
    if(!terminal){result.status='unknown';result.error=result.error??'NO_TERMINAL_EVENT';}
    if(terminalConflict){result.status='unknown';result.error='CONFLICTING_TERMINAL_EVENTS';}
    return redact(result,Object.values(this.cookies));
  }
  getApp(id:string){return this.json(`apps/${enc(id)}`);}
  currentWorkspace(){return this.json('workspaces/current',{});}
  getDraft(id:string){return this.json(`apps/${enc(id)}/workflows/draft`);}
  syncDraft(id:string,body:Obj){return this.json(`apps/${enc(id)}/workflows/draft`,body);}
  runDraft(id:string,mode:Mode,body:Obj){return this.stream(`apps/${enc(id)}/${mode==='advanced-chat'?'advanced-chat/':''}workflows/draft/run`,body);}
  getRun(id:string,run:string){return this.json(`apps/${enc(id)}/workflow-runs/${enc(run)}`);}
  nodeExecutions(id:string,run:string){return this.json(`apps/${enc(id)}/workflow-runs/${enc(run)}/node-executions`);}
  listRuns(id:string,q:{last_id?:string;limit?:number}={}){const s=new URLSearchParams({triggered_from:'debugging',limit:String(q.limit??20)});if(q.last_id)s.set('last_id',q.last_id);return this.json(`apps/${enc(id)}/workflow-runs?${s}`);}
  stop(id:string,task:string){return this.json(`apps/${enc(id)}/workflow-runs/tasks/${enc(task)}/stop`,{});}
  checkDependencies(id:string){return this.json(`apps/imports/${enc(id)}/check-dependencies`);}
  publish(id:string){return this.json(`apps/${enc(id)}/workflows/publish`,{});}
  getPublished(id:string){return this.json(`apps/${enc(id)}/workflows/publish`);}
  getDataset(id:string){return this.json(`datasets/${enc(id)}`);}
  nodeDefaults(id:string,type?:string){return this.json(`apps/${enc(id)}/workflows/default-workflow-block-configs${type?'/'+enc(type):''}`);}
  runNode(id:string,node:string,kind:'node'|'iteration'|'loop',body:Obj,mode:Mode='workflow'){
    const route=`apps/${enc(id)}/${kind!=='node'&&mode==='advanced-chat'?'advanced-chat/':''}workflows/draft/${kind==='node'?'':kind+'/'}nodes/${enc(node)}/run`;
    return kind==='node'?this.json(route,body):this.stream(route,body);
  }
  nodeLastRun(id:string,node:string){return this.json(`apps/${enc(id)}/workflows/draft/nodes/${enc(node)}/last-run`);}
}
