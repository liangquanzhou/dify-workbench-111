import {createHash} from 'node:crypto';
import {LegacyError, type Obj} from './types.ts';
export const HIDDEN = '[__HIDDEN__]';
export function stable(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(k=>(value as Obj)[k]!==undefined).map(k=>`${JSON.stringify(k)}:${stable((value as Obj)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function digest(value:unknown):string {return createHash('sha256').update(stable(value)).digest('hex');}
export function redact(value:any, secrets:string[]=[]):any {
  if(typeof value==='string') { let out=value; for(const secret of secrets.filter(Boolean)) out=out.split(secret).join('[REDACTED]'); return out.replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]'); }
  if(Array.isArray(value)) return value.map(v=>redact(v,secrets));
  if(value && typeof value==='object') {
    const out:Obj={}; const isSecret=value.value_type==='secret';
    for(const [k,v] of Object.entries(value)) out[k]= (isSecret && k==='value') || /(?:^|[-_])(password|authorization|cookie|access_token|refresh_token|csrf_token|api[-_]?key|secret|credentials|token)$/i.test(k) ? '[REDACTED]' : redact(v,secrets);
    return out;
  }
  return value;
}
export function errorResult(e:unknown,secrets:string[]=[]):Obj {
  return redact({ok:false,error:{code:e instanceof LegacyError?e.code:'INTERNAL_ERROR',message:e instanceof Error?e.message:'Unexpected failure',...(e instanceof LegacyError && e.details!==undefined?{details:e.details}:{})}},secrets);
}
export function isObject(x:unknown):x is Obj {return !!x && typeof x==='object' && !Array.isArray(x);}
export function consoleVariable(v:Obj):Obj {
  return {id:v.id,name:v.name,value_type:['integer','float'].includes(v.value_type)?'number':v.value_type,value:v.value_type==='secret'?HIDDEN:v.value,description:v.description??''};
}
export function snapshot(draft:Obj):Obj {
  return {graph:draft.graph,features:draft.features,environment_variables:(draft.environment_variables??[]).map(consoleVariable),conversation_variables:(draft.conversation_variables??[]).map(consoleVariable)};
}
export function diffPaths(a:any,b:any,path=''):string[] {
  if(stable(a)===stable(b)) return [];
  if(isObject(a)&&isObject(b)) return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>diffPaths(a[k],b[k],`${path}/${k.replaceAll('~','~0').replaceAll('/','~1')}`));
  if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length) return a.flatMap((v,i)=>diffPaths(v,b[i],`${path}/${i}`));
  return [path||'/'];
}
