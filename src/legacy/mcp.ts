import {parseAuthCookiesFromInput} from '../core/cookies.ts';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {execute,ACTIONS} from './workbench.ts';
import {errorResult,redact} from './util.ts';
export async function serve(configFile?:string):Promise<void>{
  const server=new Server({name:'dify-workbench-111',version:'0.1.0'},{capabilities:{tools:{}}});
  server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'dify_workbench',description:'Pinned Dify 1.11.1 build/diff/sync/test/logs workflow. Config and permissions are fixed at server launch; no login, creation, deletion, key generation, or automatic publish.',inputSchema:{type:'object',properties:{action:{type:'string',enum:ACTIONS},expected_digest:{type:'string'},confirm_publish:{type:'string'},inputs:{type:'object'},files:{type:'array',items:{type:'object'}},query:{type:'string'},conversation_id:{type:'string'},run_id:{type:'string'},task_id:{type:'string'},node_id:{type:'string'},node_type:{type:'string'},last_id:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},accept_current:{type:'boolean'},include_data:{type:'boolean'}},required:['action'],additionalProperties:false}}]}));
  server.setRequestHandler(CallToolRequestSchema,async(req)=>{
    let result;
    try {if(req.params.name!=='dify_workbench')result={ok:false,error:{code:'UNSUPPORTED_TOOL',message:'This profile exposes only dify_workbench'}};else{const args=req.params.arguments??{};result=await execute(String(args.action),args,{configFile});}}
    catch(e){result=errorResult(e,Object.values(parseAuthCookiesFromInput(process.env.DIFY_CONSOLE_COOKIE??'')));}
    return {content:[{type:'text' as const,text:JSON.stringify(redact(result,Object.values(parseAuthCookiesFromInput(process.env.DIFY_CONSOLE_COOKIE??''))))}],isError:!result.ok};
  });
  await server.connect(new StdioServerTransport());
}
