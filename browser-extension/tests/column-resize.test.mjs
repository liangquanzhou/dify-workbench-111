import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { renderSnapshot, cancelPreview } from '../dist/test-api.mjs'
const { JSDOM } = createRequire(import.meta.url)('jsdom')
function setup(count = 2) {
 const dom = new JSDOM('<!doctype html><div id="dmn-preview-extension-root"><div class="dmnp-body"></div></div>', {url:'http://localhost/app/synthetic/workflow',pretendToBeVisual:true})
 const {window:w}=dom,c=w.document.querySelector('.dmnp-body')
 let frame=0;const callbacks=new Map()
 w.requestAnimationFrame=fn=>{callbacks.set(++frame,fn);return frame};w.cancelAnimationFrame=id=>callbacks.delete(id)
 const snapshot={status:'ready',nodeId:'one',title:'Synthetic',raw:JSON.stringify({id:'synthetic',hit_policy:'FIRST',rules:Array.from({length:count},(_,i)=>({id:'r'+i,when:{eq:['sensor',i]},output:{result:'ok'}}))})}
 renderSnapshot(c,snapshot)
 const controls=()=>[...c.querySelectorAll('[role=separator]')]
 const prepare=h=>{let capture;h.setPointerCapture=id=>{capture=id};h.hasPointerCapture=id=>capture===id;h.releasePointerCapture=()=>{capture=undefined};return h}
 const pointer=(h,type,x,extra={})=>{const e=new w.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,button:0,...extra});Object.defineProperty(e,'pointerId',{value:1});Object.defineProperty(e,'isPrimary',{value:true});h.dispatchEvent(e)}
 const key=(h,k,extra={})=>h.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra}))
 return {dom,w,c,snapshot,controls,prepare,pointer,key,callbacks,flush:()=>{const fs=[...callbacks.values()];callbacks.clear();fs.forEach(fn=>fn())}}
}
test('column handles are labelled and colgroup controls width without rewriting rows',()=>{
 const s=setup();const t=s.c.querySelector('table'),rows=t.tBodies[0].innerHTML,handles=s.controls()
 assert.equal(handles.length,t.tHead.rows[0].cells.length);assert.equal(t.querySelectorAll('col').length,handles.length)
 const col=t.querySelectorAll('col')[1],total=parseInt(t.style.width);s.key(handles[1],'ArrowRight',{shiftKey:true})
 assert.equal(col.style.width,'230px');assert.equal(parseInt(t.style.width),total+50);assert.equal(t.tBodies[0].innerHTML,rows)
 assert.match(handles[1].getAttribute('aria-label'),/sensor/);assert.equal(handles[1].getAttribute('aria-valuenow'),'230');s.dom.window.close()
})
test('drag batches repeated moves, changes only target column and ends outside handle',()=>{
 const s=setup();const h=s.prepare(s.controls()[1]),cols=s.c.querySelectorAll('col'),table=s.c.querySelector('table');const others=[...cols].map(c=>c.style.width)
 s.pointer(h,'pointerdown',100);for(let i=0;i<100;i++)s.pointer(h,'pointermove',101+i)
 assert.equal(s.callbacks.size,1);assert.equal(cols[1].style.width,'180px');s.flush();assert.equal(cols[1].style.width,'280px')
 s.pointer(h,'pointerup',230);assert.equal(cols[1].style.width,'310px');assert.equal(s.callbacks.size,0);assert(!table.classList.contains('dmnp-resizing'))
 for(let i=0;i<cols.length;i++)if(i!==1)assert.equal(cols[i].style.width,others[i]);s.dom.window.close()
})
test('minimum, maximum, double click and Escape work without changing data',()=>{
 const s=setup(),h=s.prepare(s.controls()[1]);const col=s.c.querySelectorAll('col')[1]
 s.key(h,'Home');assert.equal(col.style.width,'100px');s.key(h,'ArrowLeft');assert.equal(col.style.width,'100px')
 s.key(h,'End');assert.equal(col.style.width,'1600px');s.key(h,'ArrowRight');assert.equal(col.style.width,'1600px')
 h.dispatchEvent(new s.w.MouseEvent('dblclick',{bubbles:true}));assert.equal(col.style.width,'180px')
 s.pointer(h,'pointerdown',200);s.pointer(h,'pointermove',600);s.flush();s.key(h,'Escape');assert.equal(col.style.width,'180px');assert.equal(s.callbacks.size,0);s.dom.window.close()
})
test('paging retains widths; switching nodes starts a new table; cancel removes active drag',()=>{
 const s=setup(51);s.key(s.controls()[1],'ArrowRight');[...s.c.querySelectorAll('button')].find(b=>b.textContent==='下一页').click()
 assert.equal(s.c.querySelectorAll('col')[1].style.width,'190px');assert.equal(s.c.querySelectorAll('tbody tr').length,1)
 const h=s.prepare(s.controls()[1]);s.pointer(h,'pointerdown',10);s.pointer(h,'pointermove',50);assert.equal(s.callbacks.size,1)
 renderSnapshot(s.c,{...s.snapshot,nodeId:'two'});assert.equal(s.callbacks.size,0);assert.equal(s.c.querySelectorAll('col')[1].style.width,'180px')
 const h2=s.prepare(s.controls()[1]);s.pointer(h2,'pointerdown',10);cancelPreview(s.c);assert(!s.c.querySelector('table').classList.contains('dmnp-resizing'));s.dom.window.close()
})
test('non-primary button cannot start a drag; pointer cancellation restores starting width',()=>{
 const s=setup(),h=s.prepare(s.controls()[0]);s.pointer(h,'pointerdown',10,{button:2});assert(!s.c.querySelector('.dmnp-resizing'))
 s.pointer(h,'pointerdown',10);s.pointer(h,'pointermove',150);s.flush();s.pointer(h,'pointercancel',150)
 assert.equal(s.c.querySelector('col').style.width,'140px');assert.equal(s.callbacks.size,0);s.dom.window.close()
})
