import fs from 'node:fs';
import {parseDocument} from 'yaml';
import {requireThat,LegacyError,type Obj,type Mode} from './types.ts';
import {HIDDEN,isObject,snapshot,stable} from './util.ts';
const SUPPORTED=new Set(['start','end','answer','code','template-transform','if-else','llm','variable-aggregator','http-request','knowledge-retrieval','tool','iteration','iteration-start','loop','loop-start','loop-end','assigner','variable-assigner','question-classifier','parameter-extractor','document-extractor','list-operator']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseDsl(text:string):Obj {
  requireThat(Buffer.byteLength(text)<8*1024*1024,'DSL_TOO_LARGE','DSL exceeds 8 MiB');
  const doc=parseDocument(text,{uniqueKeys:true,strict:true,schema:'core'});
  requireThat(doc.errors.length===0&&doc.warnings.length===0,'INVALID_DSL','Invalid YAML, duplicate keys, or unsupported YAML syntax');
  let d:Obj;try{d=doc.toJS({maxAliasCount:0});}catch{throw new LegacyError('INVALID_DSL','YAML aliases and custom tags are not supported');}
  const checkNumbers=(x:unknown):void=>{if(typeof x==='number')requireThat(Number.isFinite(x)&&(!Number.isInteger(x)||Number.isSafeInteger(x)),'UNSAFE_NUMBER','DSL numbers must be finite and integers must fit JavaScript safe precision');else if(x&&typeof x==='object')Object.values(x).forEach(checkNumbers);};checkNumbers(d);
  requireThat(isObject(d),'INVALID_DSL','DSL root must be a mapping');
  requireThat(d.kind==='app'&&d.version==='0.5.0','DSL_VERSION','Expected native Dify DSL kind app, version 0.5.0. Renaming a newer version is not a conversion.');
  requireThat(isObject(d.app)&&['workflow','advanced-chat'].includes(d.app.mode),'APP_MODE','Only workflow and advanced-chat are supported');
  requireThat(isObject(d.workflow)&&isObject(d.workflow.graph)&&isObject(d.workflow.features),'INVALID_DSL','workflow.graph and workflow.features must be mappings');
  for(const key of Object.keys(d.workflow))requireThat(['graph','features','environment_variables','conversation_variables','rag_pipeline_variables'].includes(key),'UNSUPPORTED_FIELD',`Unsupported workflow field: ${key}`);
  requireThat(!d.workflow.rag_pipeline_variables?.length,'UNSUPPORTED_RAG','RAG pipeline synchronization is not enabled');
  validateGraph(d.workflow.graph,d.app.mode);
  return d;
}
export function readDsl(file:string):Obj {return parseDsl(fs.readFileSync(file,'utf8'));}
export function validateGraph(g:Obj,mode:Mode) {
  requireThat(Array.isArray(g.nodes)&&Array.isArray(g.edges),'INVALID_GRAPH','graph.nodes and graph.edges must be arrays');
  const ids=new Set<string>();let starts=0;
  for(const n of g.nodes){requireThat(isObject(n)&&typeof n.id==='string'&&n.id.length>0&&!ids.has(n.id),'INVALID_GRAPH','Node IDs must be nonempty and unique');ids.add(n.id);requireThat(isObject(n.data),'INVALID_GRAPH','Every node needs data');requireThat(SUPPORTED.has(n.data.type),'UNSUPPORTED_NODE',`Unsupported node type ${String(n.data.type)} at ${n.id}; no unsafe best-effort conversion`);if(n.data.type==='start')starts++;if(n.data.type==='answer')requireThat(mode==='advanced-chat','INVALID_GRAPH','answer nodes require advanced-chat');}
  requireThat(starts===1,'INVALID_GRAPH','Exactly one start node is required');
  for(const n of g.nodes){
    if(n.parentId)requireThat(ids.has(n.parentId)&&['iteration','loop'].includes(g.nodes.find((p:Obj)=>p.id===n.parentId)?.data.type),'INVALID_GRAPH','Nested node parent must be an iteration or loop');
    if(['iteration','loop'].includes(n.data.type)){
      const start=g.nodes.find((p:Obj)=>p.id===n.data.start_node_id);
      requireThat(start&&start.parentId===n.id&&start.data.type===(n.data.type==='iteration'?'iteration-start':'loop-start'),'INVALID_GRAPH',`Container ${n.id} needs its matching nested start node`);
    }
  }
  const edges=new Set<string>();
  for(const e of g.edges){requireThat(isObject(e)&&typeof e.id==='string'&&!edges.has(e.id)&&ids.has(e.source)&&ids.has(e.target),'INVALID_GRAPH','Edges need unique IDs and existing source/target nodes');edges.add(e.id);}
  const visiting=new Set<string>(),done=new Set<string>();
  const visit=(id:string)=>{if(done.has(id))return;requireThat(!visiting.has(id),'UNSUPPORTED_CYCLE','Graph cycles require a validated loop adapter');visiting.add(id);for(const e of g.edges.filter((e:Obj)=>e.source===id))visit(e.target);visiting.delete(id);done.add(id);};
  for(const id of ids)visit(id);
}
export function normalizeDsl(d:Obj,remote:Obj,mode:Mode,bindings:Record<string,string>={}):{payload:Obj;datasetIds:string[];warnings:string[]} {
  requireThat(d.app.mode===mode,'APP_MODE','DSL mode differs from pinned target mode');
  requireThat(isObject(remote.graph)&&isObject(remote.features)&&Array.isArray(remote.environment_variables)&&Array.isArray(remote.conversation_variables),'INVALID_DRAFT','Remote draft is missing required graph/features/variable fields');
  const w=structuredClone(d.workflow),oldById=new Map<string,Obj>(remote.graph.nodes.map((n:Obj)=>[n.id,n]));const datasets=new Set<string>();
  for(const n of w.graph.nodes){const data=n.data,old=oldById.get(n.id)?.data;
    if(data.type==='knowledge-retrieval'){
      requireThat(Array.isArray(data.dataset_ids),'DATASET_BINDING','Knowledge node requires dataset_ids');
      data.dataset_ids=data.dataset_ids.map((ref:unknown)=>{requireThat(typeof ref==='string','DATASET_BINDING','Dataset references must be strings');const id=bindings[ref]??ref;requireThat(UUID.test(id),'DATASET_BINDING',`Encrypted/unknown dataset reference at node ${n.id}; provide an explicit target workspace dataset mapping`);datasets.add(id);return id;});
    }
    if(data.type==='tool'){
      const fields=['provider_id','provider_type','tool_name'];
      requireThat(old?.type==='tool'&&fields.every(k=>stable(old[k])===stable(data[k])),'TOOL_BINDING',`Tool node ${n.id} must already exist with the same provider/tool identity; first binding is manual`);
      if(old.credential_id){requireThat(!data.credential_id||data.credential_id===old.credential_id,'CREDENTIAL_BINDING','Credential changes are not supported');data.credential_id=old.credential_id;}
      else requireThat(!data.credential_id,'CREDENTIAL_BINDING','New credential binding requires manual setup');
    }
    if(data.type==='http-request'&&old?.authorization){requireThat(stable(data.authorization)===stable(old.authorization),'CREDENTIAL_BINDING',`HTTP authorization for ${n.id} differs from existing Console configuration; configure it manually`);}
  }
  const previous=remote.environment_variables as Obj[];
  if(w.environment_variables===undefined)w.environment_variables=structuredClone(previous);
  requireThat(Array.isArray(w.environment_variables),'INVALID_VARIABLES','environment_variables must be an array');
  const ids=new Set<string>(),names=new Set<string>();
  for(const v of w.environment_variables){requireThat(isObject(v)&&typeof v.id==='string'&&typeof v.name==='string'&&!ids.has(v.id)&&!names.has(v.name),'INVALID_VARIABLES','Variable IDs and names must be unique');ids.add(v.id);names.add(v.name);const old=previous.find(x=>x.id===v.id);
    if(v.value_type==='secret'||old?.value_type==='secret'){
      requireThat(old?.value_type==='secret'&&v.value_type==='secret','SECRET_CHANGE_BLOCKED','New secrets or secret type changes require manual configuration');
      requireThat(v.value===''||v.value===HIDDEN||v.value===old.value,'SECRET_CHANGE_BLOCKED','Secret replacement is not supported; existing secret will be preserved');requireThat((v.description??'')===(old.description??''),'SECRET_CHANGE_BLOCKED','Secret description changes are not supported by the preservation sentinel');v.value=HIDDEN;
    }
  }
  for(const v of previous.filter(x=>x.value_type==='secret'&&!ids.has(x.id))){requireThat(!names.has(v.name),'SECRET_CHANGE_BLOCKED','An existing secret name cannot be reused');w.environment_variables.push({...v,value:HIDDEN});}
  if(w.conversation_variables===undefined)w.conversation_variables=structuredClone(remote.conversation_variables);
  requireThat(Array.isArray(w.conversation_variables),'INVALID_VARIABLES','conversation_variables must be an array');
  for(const [scope,variables] of [['env',w.environment_variables],['conversation',w.conversation_variables]] as const) for(const v of variables) {
    requireThat(isObject(v)&&typeof v.id==='string'&&typeof v.name==='string'&&typeof v.value_type==='string','INVALID_VARIABLES','Variables need id, name and value_type');
    requireThat(v.selector===undefined||(Array.isArray(v.selector)&&(v.selector.length===0||stable(v.selector)===stable([scope,v.name]))),'UNSUPPORTED_SELECTOR','Variable selector must be empty or the canonical scope/name selector');
    for(const k of Object.keys(v))requireThat(['id','name','value','value_type','description','selector'].includes(k),'UNSUPPORTED_FIELD',`Unsupported variable field: ${k}`);
  }
  const payload=snapshot(w);
  return {payload,datasetIds:[...datasets],warnings:['App metadata and dependency installations are not changed by draft sync.','Dify 1.11.1 hash covers graph/features only; variable and publish races require a single-writer test app.','Existing secret values are preserved; masked secret changes cannot be detected.']};
}
export const SUPPORTED_NODE_TYPES=[...SUPPORTED];
