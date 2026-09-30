import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseAuthCookiesFromInput} from '../core/cookies.ts';
import {requireThat,type Config,type Obj} from './types.ts';
import {digest} from './util.ts';
import {readDsl} from './dsl.ts';
export type Loaded={config:Config;root:string;file:string;stateFile:string;dslFile:string};
export function loadConfig(file:string):Loaded {
  const absolute=path.resolve(file),root=path.dirname(absolute);const config=JSON.parse(fs.readFileSync(absolute,'utf8')) as Config;
  requireThat(config.profile==='dify-1.11.1','PROFILE_REQUIRED','Config profile must be dify-1.11.1');
  requireThat(config.target&&['base_url','workspace_id','app_id','mode'].every(k=>typeof (config.target as Obj)[k]==='string'&&(config.target as Obj)[k]),'INVALID_TARGET','Pin base_url, workspace_id, app_id, and mode explicitly');
  requireThat(['workflow','advanced-chat'].includes(config.target.mode),'INVALID_TARGET','Target mode must be workflow or advanced-chat');
  requireThat(typeof config.dsl==='string'&&!!config.dsl,'INVALID_CONFIG','dsl path is required');
  return {config,root,file:absolute,stateFile:path.resolve(root,config.state_file??'.dify-workbench/state.json'),dslFile:path.resolve(root,config.dsl)};
}
export function readState(l:Loaded):Obj|undefined {try {return JSON.parse(fs.readFileSync(l.stateFile,'utf8'));}catch(e:any){if(e.code==='ENOENT')return;throw e;}}
export function saveState(l:Loaded,state:Obj):void {
  fs.mkdirSync(path.dirname(l.stateFile),{recursive:true,mode:0o700});const tmp=l.stateFile+`.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{mode:0o600});fs.renameSync(tmp,l.stateFile);
}
export function targetKey(l:Loaded):string{return digest(l.config.target);}
export function cookiesFromEnv():Record<string,string> {
  const cookies=parseAuthCookiesFromInput(process.env.DIFY_CONSOLE_COOKIE??'');
  requireThat(Object.keys(cookies).some(k=>/(?:^|[-_])access_token$/i.test(k))&&Object.keys(cookies).some(k=>/csrf_token$/i.test(k)),'AUTH_REQUIRED','Set the existing Console cookie and CSRF session in DIFY_CONSOLE_COOKIE through your approved secret mechanism. No login or storage is performed.');
  return cookies;
}
export function build(l:Loaded):Obj {
  if(l.config.build){
    requireThat(l.config.permissions?.build_command===true,'BUILD_DISABLED','Review the configured generator and enable permissions.build_command first');
    const b=l.config.build;requireThat(typeof b.command==='string'&&(!b.args||b.args.every(x=>typeof x==='string')),'INVALID_BUILD','Build command must be an executable and argv array');
    // Do not pass Dify credentials to a local generator, and never echo its stdout/stderr.
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|API_KEY)/i.test(k)));
    const before=fs.existsSync(l.dslFile)?{mtime:fs.statSync(l.dslFile).mtimeMs,digest:digest(fs.readFileSync(l.dslFile,'utf8'))}:undefined;
    const r=spawnSync(b.command,b.args??[],{cwd:path.resolve(l.root,b.cwd??'.'),env,encoding:'utf8',shell:false,timeout:b.timeout_ms??120000,maxBuffer:1024*1024});
    requireThat(!r.error&&r.status===0,'BUILD_FAILED','Configured generator failed; output is intentionally withheld to avoid exposing credentials/business data');
    requireThat(fs.existsSync(l.dslFile),'BUILD_OUTPUT_MISSING','Generator did not create the configured DSL file');
    requireThat(!before||fs.statSync(l.dslFile).mtimeMs!==before.mtime||digest(fs.readFileSync(l.dslFile,'utf8'))!==before.digest,'BUILD_OUTPUT_STALE','Generator did not update its output; refusing a stale DSL artifact');
  }
  const d=readDsl(l.dslFile);return {ok:true,action:'build',profile:'dify-1.11.1',source:l.config.build?'configured-generator':'existing-dsl',dsl_file:l.dslFile,dsl_digest:digest(d),mode:d.app.mode,nodes:d.workflow.graph.nodes.length,warnings:['This adapter validates a DSL artifact; it does not compile arbitrary JSON or replace your business compiler.']};
}
