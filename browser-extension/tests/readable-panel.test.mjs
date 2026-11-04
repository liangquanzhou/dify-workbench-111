import fs from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { conditions, outputs, jsonValue, parseTable, parseBrian, parseXml, importStored, renderSnapshot, resizePanel } from '../dist/test-api.mjs'
const document = () => new JSDOM('<main></main>', {url:'http://localhost/app/synthetic/workflow',pretendToBeVisual:true}).window.document
const predicate = (path, op, value) => ({kind:'predicate',atom:{id:'A',field:JSON.stringify(path),path,operator:op,value,label:'unused'}})
test('structured conditions retain nested AND/OR, order, duplicate paths and distinct typed values',()=>{
 const d=document(),tree={kind:'any',children:[{kind:'all',children:[predicate(['a.b'],'eq',true),predicate(['a','b'],'in',[1,'1',false,null])]},{kind:'constant',value:false}]}
 const e=conditions(d,tree);assert.match(e.textContent,/OR/);assert.match(e.textContent,/AND/)
 assert.deepEqual([...e.querySelectorAll('.dmnp-field')].map(x=>x.title),['["a.b"]','["a","b"]'])
 assert.match(e.textContent,/等于以下候选值中的任一项/);assert.match(e.textContent,/数值1/);assert.match(e.textContent,/字符串"1"/);assert.match(e.textContent,/布尔值false/);assert.match(e.textContent,/始终不成立/)
 d.defaultView.close()
})
test('exists and is_null preserve false and do not claim missing is null or empty',()=>{
 const d=document();assert.match(conditions(d,predicate(['x'],'exists',false)).textContent,/路径不存在/)
 assert.match(conditions(d,predicate(['x'],'is_null',false)).textContent,/不为 null/)
 assert.doesNotMatch(conditions(d,predicate(['x'],'is_null',false)).textContent,/不为空/)
 assert.match(conditions(d,{kind:'all',children:[]}).textContent,/始终成立/);assert.match(conditions(d,{kind:'any',children:[]}).textContent,/始终不成立/);d.defaultView.close()
})
test('templates distinguish fixed literal objects from runtime from references; all fields retained',()=>{
 const d=document(),row={rule:{id:'r',when:true},atoms:[],logic:'',fullLogic:'',templateRef:'yes',template:{state:'PASS',data:{fixed:{literal:{from:'not-a-reference',nested:['<img src=x onerror=alert(1)>']}},binding:{from:'PARAMETER',path:['sensor','value']}},actions:[{name:'notify',args:{value:1}}]}}
 const e=outputs(d,row);assert.equal(e.querySelectorAll('.dmnp-reference').length,1);assert.match(e.textContent,/not-a-reference/);assert.match(e.textContent,/动作未执行/);assert.match(e.textContent,/notify/);assert(!e.querySelector('img'))
 assert.match(e.textContent,/尚未解析/);d.defaultView.close()
})
test('large groups are lazy but complete when opened; long and deep JSON remains accessible',async()=>{
 const d=document(),children=Array.from({length:128},(_,i)=>predicate(['value'],'eq',i)),e=conditions(d,{kind:'any',children});d.body.append(e)
 assert.equal(e.querySelectorAll('.dmnp-predicate').length,0);const details=e.querySelector('details');details.open=true;details.dispatchEvent(new d.defaultView.Event('toggle'))
 assert.equal(e.querySelectorAll('.dmnp-predicate').length,128);assert.match(e.textContent,/127/)
 const long='x'.repeat(10000);assert.equal(jsonValue(d,long).querySelector('pre').textContent,JSON.stringify(long));d.defaultView.close()
})
test('reading default retains exact source and layout widths across paging/view switches',()=>{
 const d=document(),c=d.querySelector('main'),raw=JSON.stringify({id:'table',hit_policy:'FIRST',rules:Array.from({length:51},(_,i)=>({id:'r'+i,when:{any:[{all:[{eq:['a',1]},{eq:['b',{ref:'other'}]}]},false]},output:{result:'ok'}}))})
 const parsed=parseTable(raw);assert.equal(parsed.kind,'ready');assert.equal(parsed.matrix.rows[0].tree.kind,'any');assert.equal(parsed.matrix.rows[0].tree.children[0].kind,'all')
 renderSnapshot(c,{status:'ready',raw});assert.equal(c.querySelector('table').dataset.view,'reading');assert.equal(c.querySelectorAll('thead th').length,3)
 assert([...c.querySelectorAll('pre')].some(p=>p.textContent===raw));assert.match(c.textContent,/引用\("other"\)/)
 const click=name=>[...c.querySelectorAll('button')].find(b=>b.textContent===name).click()
 c.querySelectorAll('[role=separator]')[1].dispatchEvent(new d.defaultView.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))
 click('下一页');assert.equal(c.querySelectorAll('col')[1].style.width,'490px');click('矩阵视图');click('阅读视图');assert.equal(c.querySelectorAll('col')[1].style.width,'490px');d.defaultView.close()
})
function panel(){
 const d=document(),w=d.defaultView,root=d.createElement('section'),grow=d.createElement('button');d.body.append(root);root.append(grow)
 Object.defineProperty(w,'innerWidth',{value:1200,writable:true});Object.defineProperty(w,'innerHeight',{value:900,writable:true})
 let n=0;const frames=new Map();w.requestAnimationFrame=f=>{frames.set(++n,f);return n};w.cancelAnimationFrame=id=>frames.delete(id)
 const dispose=resizePanel(root,grow),rect=()=>['left','top','width','height'].map(k=>parseFloat(root.style[k])),flush=()=>{const fs=[...frames.values()];frames.clear();fs.forEach(f=>f())}
 const pointer=(target,type,x,y)=>{const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(e,'pointerId',{value:1});target.dispatchEvent(e)}
 return {d,w,root,grow,frames,dispose,rect,flush,pointer}
}
test('panel resizes in one frame, remains in viewport, expand/restore retains custom size',()=>{
 const s=panel(),h=s.root.querySelector('.dmnp-edge-se'),before=s.rect();s.pointer(h,'pointerdown',0,0)
 for(let i=0;i<100;i++)s.pointer(s.w,'pointermove',100+i,50+i)
 assert.equal(s.frames.size,1);s.flush();s.pointer(s.w,'pointerup',200,100)
 const custom=s.rect();assert.equal(custom[2],before[2]+200);assert(custom[1]+custom[3]<=892)
 s.grow.click();assert.deepEqual(s.rect(),[8,8,1184,884]);s.grow.click();assert.deepEqual(s.rect(),custom)
 s.dispose();assert.equal(s.root.querySelectorAll('.dmnp-panel-resize').length,0);s.w.close()
})
test('panel minimum, Escape, pointer cancellation, keyboard and viewport shrink work',()=>{
 const s=panel(),h=s.root.querySelector('.dmnp-edge-nw'),before=s.rect();s.pointer(h,'pointerdown',0,0);s.pointer(s.w,'pointermove',9999,9999);s.flush()
 assert.equal(s.rect()[2],420);assert.equal(s.rect()[3],220);s.w.dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'Escape',cancelable:true}));assert.deepEqual(s.rect(),before)
 s.pointer(h,'pointerdown',0,0);s.pointer(s.w,'pointermove',40,40);s.pointer(s.w,'pointercancel',40,40);assert.deepEqual(s.rect(),before)
 s.root.querySelector('.dmnp-edge-e').dispatchEvent(new s.w.KeyboardEvent('keydown',{key:'ArrowRight',shiftKey:true,bubbles:true,cancelable:true}));assert.equal(s.rect()[2],before[2]+50)
 s.w.innerWidth=340;s.w.innerHeight=200;s.w.dispatchEvent(new s.w.Event('resize'));assert.deepEqual(s.rect(),[8,8,324,184]);s.dispose();s.w.close()
})
test('cleanup cancels pending drag and removes viewport handler',()=>{
 const s=panel(),h=s.root.querySelector('.dmnp-edge-se'),before=s.rect();s.pointer(h,'pointerdown',0,0);s.pointer(s.w,'pointermove',30,30);assert.equal(s.frames.size,1);s.dispose();assert.equal(s.frames.size,0)
 s.pointer(s.w,'pointerup',100,100);assert.deepEqual(s.rect(),before);s.w.close()
})

test('stored routing configuration keeps raw records without invented executable conditions',async()=>{
 const raw=fs.readFileSync(new URL('./fixtures/stored/route-v2.json',import.meta.url),'utf8'),doc=JSON.parse(raw)
 const preview=await importStored(raw,{table:doc.table,format:'routing-table/v2',version:String(doc.version)},'synthetic.json')
 const d=document();assert(preview.models.length>0)
 for(const {matrix} of preview.models) for(const row of matrix.rows){assert.equal(row.tree,undefined);assert.deepEqual(row.sourceRule,row.rule.record);assert.deepEqual(row.record,row.rule.record);assert.doesNotMatch(outputs(d,row).textContent,/始终成立/)}
 const c=d.querySelector('main');renderSnapshot(c,{status:'unsupported',nodeId:'route',storage:{table:doc.table,format:'routing-table/v2',version:String(doc.version)}})
 const input=c.querySelector('input[type=file]');Object.defineProperty(input,'files',{value:[{name:'route.json',size:Buffer.byteLength(raw),text:async()=>raw}]});input.dispatchEvent(new d.defaultView.Event('change'))
 for(let i=0;i<50&&!c.querySelector('table');i++)await new Promise(r=>setTimeout(r,5))
 assert(c.querySelector('table'));assert.match(c.textContent,/配置记录 · 未编译为执行规则/);assert.doesNotMatch(c.textContent,/无条件（始终成立）|源规则 JSON/);d.defaultView.close()
})

test('FEEL remains an expression, not a decoded JSON literal or computed value',()=>{
 const d=document(),raw='<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"><decision id="d"><decisionTable><input><inputExpression><text>score</text></inputExpression></input><output name="result"/><rule id="r"><inputEntry><text>&gt;= 10</text></inputEntry><outputEntry><text>string(score)</text></outputEntry></rule></decisionTable></decision></definitions>'
 const p=parseXml({raw,auxiliary:'d'},d);assert.equal(p.kind,'ready');const row=p.matrix.rows[0]
 assert.match(conditions(d,row.tree).textContent,/FEEL 表达式原文>= 10/);assert.match(outputs(d,row).textContent,/string\(score\)/);assert.doesNotMatch(outputs(d,row).textContent,/字符串/);assert.match(row.sourceRule,/<rule/);d.defaultView.close()
})
test('large structured outputs stay bounded with complete raw JSON available',()=>{
 const d=document(),value=Object.fromEntries(Array.from({length:24},(_,i)=>['k'+i,Array.from({length:24},(_,j)=>({id:j,text:'x'.repeat(40)}))]))
 const e=jsonValue(d,value);assert(e.querySelectorAll('*').length<5);assert.deepEqual(JSON.parse(e.querySelector('pre').textContent),value);d.defaultView.close()
})
