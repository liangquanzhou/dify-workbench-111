import {parseAuthCookiesFromInput} from '../core/cookies.ts';
import fs from 'node:fs';
import {execute,ACTIONS} from './workbench.ts';
import {errorResult,redact} from './util.ts';
import {LegacyError,type Obj} from './types.ts';
const BOOL=new Set(['help','accept-current','include-data']);
export async function main111(argv:string[]=process.argv.slice(2)):Promise<void> {
  const args:Obj={};let action:string|undefined,configFile:string|undefined;
  try {
    for(let i=0;i<argv.length;i++){
      const a=argv[i];if(!a.startsWith('--')){if(action)throw new LegacyError('USAGE_ERROR','Unexpected positional argument');action=a;continue;}
      const [raw,...value]=a.slice(2).split('=');const key=raw.replaceAll('-','_');
      const v=value.length?value.join('='):BOOL.has(raw)?true:argv[++i];if(v===undefined||typeof v==='string'&&v.startsWith('--'))throw new LegacyError('USAGE_ERROR',`Missing value for --${raw}`);
      if(raw==='config'){configFile=String(v);continue;}if(raw==='profile'){if(v!=='dify-1.11.1')throw new LegacyError('PROFILE_REQUIRED','Invalid legacy profile');continue;}
      if(['inputs','files'].includes(raw)){const text=String(v);args[key]=JSON.parse(text.startsWith('@')?fs.readFileSync(text.slice(1),'utf8'):text);}else args[key]=v;
    }
    if(!action||args.help){process.stdout.write(JSON.stringify({ok:true,name:'difywf',profile:'dify-1.11.1',usage:'difywf <action> --config file.json [flags]',actions:[...ACTIONS,'mcp'],flags:['--expected-digest SHA256','--inputs @inputs.json','--query TEXT','--run-id UUID','--task-id UUID','--confirm-publish SHA256','--accept-current','--include-data'],note:'JSON-only output. Remote and mutation permissions default off. Existing upstream tools require explicit --profile upstream.'},null,2)+'\n');return;}
    if(action==='mcp'){const {serve}=await import('./mcp.ts');await serve(configFile);return;}
    const result=await execute(action,args,{configFile});process.stdout.write(JSON.stringify(redact(result,Object.values(parseAuthCookiesFromInput(process.env.DIFY_CONSOLE_COOKIE??''))),null,2)+'\n');if(!result.ok)process.exitCode=1;
  }catch(e){process.stdout.write(JSON.stringify(errorResult(e,Object.values(parseAuthCookiesFromInput(process.env.DIFY_CONSOLE_COOKIE??''))),null,2)+'\n');process.exitCode=1;}
}
