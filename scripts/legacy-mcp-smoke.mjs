import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/difywf.js',import.meta.url)),'mcp'],stderr:'pipe'});
const client=new Client({name:'legacy-smoke',version:'1.0'});
try {
 await client.connect(transport);
 const list=await client.listTools();assert.deepEqual(list.tools.map(t=>t.name),['dify_workbench']);
 const result=await client.callTool({name:'dify_workbench',arguments:{action:'capabilities'}});assert.equal(JSON.parse(result.content[0].text).profile,'dify-1.11.1');
 const denied=await client.callTool({name:'app_delete',arguments:{app_id:'synthetic'}});assert.equal(denied.isError,true);
 const action=await client.callTool({name:'dify_workbench',arguments:{action:'delete'}});assert.equal(action.isError,true);
 console.log(JSON.stringify({ok:true,profile:'dify-1.11.1',single_tool:true,call_gate:true}));
} finally {await client.close();}
