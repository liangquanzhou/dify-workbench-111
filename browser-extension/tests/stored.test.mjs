import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import { importStored, renderSnapshot, extractTable, BRIAN_JSON_PROVIDER, parseBrian } from '../dist/test-api.mjs'
const read = name => fs.readFileSync(new URL(`./fixtures/stored/${name}`, import.meta.url), 'utf8')
const raw = read('when-any-response.json')
const doc = () => JSON.parse(raw).doc
const ref = { table: 'triage.synthetic-sensors', format: 'decision-table/v1', version: '3' }
const snapshot = () => ({ status: 'unsupported', nodeId: 'stored-A', title: '存储决策', message: '尚未读取规则', storage: ref })
const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v)
const withDigest = d => { d.content_sha256 = createHash('sha256').update(canonical({ owner: d.owner, model_ref: d.model_ref, model: d.model })).digest('hex'); return JSON.stringify(d) }
const dom = () => new JSDOM('<!doctype html><main></main>', { url: 'http://localhost/app/import/workflow' }).window.document
async function settled(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)) } assert.fail('async import did not settle') }
function upload(input, content, name = 'saved.json') {
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name, size: typeof content === 'string' ? Buffer.byteLength(content) : 10, text: () => typeof content === 'string' ? Promise.resolve(content) : content }] })
  input.dispatchEvent(new input.ownerDocument.defaultView.Event('change'))
}

test('original synthetic when_any fixture retains one row per conclusion, OR groups and AND atoms', async () => {
  const p = await importStored(raw, ref, 'saved.json'), m = p.models[0].matrix
  assert.equal(m.rows.length, 3)
  assert.equal(m.rows[0].rule.id, 'SENSOR_MATCH')
  assert.equal(m.rows[0].logic, '(组1.A 且 组1.B) 或 (组2.A 且 组2.B) 或 (组3.A 且 组3.B)')
  assert.equal(m.rows[0].atoms.length, 6)
  assert.match(m.rows[0].fullLogic, /sensor_a.*且.*或.*sensor_b.*或.*sensor_c/)
  assert.deepEqual(m.rows[0].rule.template, doc().model.result_templates.signal)
  assert.match(p.provenance, /已保存版本 3/); assert.match(p.provenance, /已核对节点版本/)
})
test('successful read envelope and direct saved doc both import; execution receipt is not a document', async () => {
  assert.equal((await importStored(JSON.stringify(doc()), ref, 'doc.json')).models.length, 1)
  assert.equal((await importStored(JSON.stringify({ status_code: 200, result: JSON.parse(raw) }), ref, 'tool.json')).models.length, 1)
  for (const value of [{ status_code: 401, result: JSON.parse(raw) }, { table: ref.table, doc: null }, { schema_version: 'dmn-json.stored-table-result/v1', status: 'SUCCEEDED', table: ref.table, result: { output: {} } }]) await assert.rejects(importStored(JSON.stringify(value), ref, 'receipt.json'))
})
test('table/schema/version/digest mismatch and missing saved version fail before rendering', async () => {
  for (const wrong of [{ table: 'triage.other' }, { format: 'decision-set/v1' }, { version: '4' }, { digest: '0'.repeat(64) }]) await assert.rejects(importStored(raw, { ...ref, ...wrong }, 'wrong.json'))
  const d = doc(); delete d.version; await assert.rejects(importStored(JSON.stringify(d), ref, 'draft.json'), /已保存版本/)
  const changed = doc(); changed.model.rules[0].when_any[0][0].value = false
  await assert.rejects(importStored(JSON.stringify(changed), ref, 'changed.json'), /摘要核对失败/)
})
test('stored malformed OR, ambiguous when/when_any and missing templates never silently downgrade', async () => {
  for (const change of [d => d.model.rules[0].when_any = [], d => d.model.rules[0].when_any = [[]], d => d.model.rules[0].when = [], d => delete d.model.result_templates.signal]) {
    const d = doc(); change(d); await assert.rejects(importStored(withDigest(d), ref, 'invalid.json'))
  }
})
test('table parameter state/result paths display literally; unknown parameter path is rejected', async () => {
  const d = doc(); d.model.parameters.previous = { type: 'table', nullable: false, record_required: true, allowed_quality: ['KNOWN'] }
  d.model.rules[0].when_any[0] = [{ path: ['parameters', 'previous', 'state'], op: 'eq', value: 'PASS' }, { path: ['parameters', 'previous', 'result', 'decision'], op: 'eq', value: 'ACCEPTED' }]
  const p = await importStored(withDigest(d), ref, 'chain.json')
  assert(p.models[0].matrix.fields.includes('$["parameters"]["previous"]["state"]'))
  assert(p.models[0].matrix.fields.includes('$["parameters"]["previous"]["result"]["decision"]'))
  d.model.rules[0].when_any[0][0].path[1] = 'undeclared'; await assert.rejects(importStored(withDigest(d), ref, 'wrong.json'))
})
test('decision set imports all models without pretending requested runtime model selection', async () => {
  const p = await importStored(read('decision-set.json'), { table: 'triage.synthetic-set', format: 'decision-set/v1' }, 'set.json')
  assert.deepEqual(p.models.map(x => x.key), ['first', 'collect'])
  assert.deepEqual(p.models.map(x => x.matrix.table.hit_policy), ['FIRST', 'COLLECT'])
  assert.match(p.provenance, /是否为线上最新版未知/)
})
test('PLUGIN_STORAGE routing table imports original rows and dictionaries without fake compiled rules', async () => {
  const route = JSON.parse(read('route-v2.json'))
  const p = await importStored(read('route-v2.json'), { table: 'dispatch.route', format: 'routing-table/v2' }, 'route.json')
  assert.deepEqual(p.models[0].matrix.rows.map(x => x.rule.record), route.routes)
  assert.equal(p.models[0].matrix.table.hit_policy, '配置原文')
  assert.deepEqual(p.document.solutions, route.solutions)
})
test('Python-hashed float token types and Unicode key order are verified against saved fixture', async () => {
  const p = await importStored(read('python-numbers.json'), ref, 'python.json')
  assert.equal(p.models.length, 1)
  const respelled = JSON.stringify(JSON.parse(read('python-numbers.json')))
  await assert.rejects(importStored(respelled, ref, 'js-reserialized.json'), /摘要核对失败/)
})
test('file import UI renders matrix, OR groups, provenance and complete source as text', async () => {
  const d = dom(), c = d.createElement('div'); d.body.append(c); renderSnapshot(c, snapshot())
  assert.equal(c.querySelector('table'), null)
  upload(c.querySelector('input[type=file]'), raw, '<img src=x onerror=alert(1)>.json')
  await settled(() => c.querySelector('table'))
  assert.equal(c.querySelectorAll('tbody tr').length, 3)
  assert.match(c.textContent, /组1.A 且 组1.B/); assert.match(c.textContent, /content_sha256/)
  assert.match(c.textContent, /完整导入文档/); assert.equal(c.querySelector('img'), null)
  upload(c.querySelector('input[type=file]'), '{broken')
  await settled(() => c.querySelector('[role=alert]'))
  assert.equal(c.querySelector('table'), null)
})
test('late import cannot repopulate another selected node and dynamic refs offer no import', async () => {
  const d = dom(), c = d.createElement('div'); d.body.append(c); renderSnapshot(c, snapshot())
  let resolve; const pending = new Promise(r => resolve = r)
  upload(c.querySelector('input'), pending)
  renderSnapshot(c, { status: 'idle', message: '其他节点' }); resolve(raw)
  await new Promise(r => setTimeout(r, 30)); assert.equal(c.querySelector('table'), null); assert.match(c.textContent, /其他节点/)
  const s = extractTable({ type: 'tool', provider_type: 'builtin', provider_id: BRIAN_JSON_PROVIDER, tool_name: 'evaluate_stored_table', tool_parameters: { table: { type: 'variable', value: ['start', 'name'] } }, tool_configurations: { format: 'decision-table/v1' } }, 'A')
  renderSnapshot(c, s); assert.equal(c.querySelector('input'), null)
})
test('decision-set model selector switches visible model and preserves its provenance', async () => {
  const d = dom(), c = d.createElement('div'); d.body.append(c)
  renderSnapshot(c, { ...snapshot(), storage: { table: 'triage.synthetic-set', format: 'decision-set/v1' } })
  upload(c.querySelector('input'), read('decision-set.json'))
  await settled(() => c.querySelector('select'))
  const select = c.querySelector('select'); select.value = '1'; select.dispatchEvent(new d.defaultView.Event('change'))
  assert.match(c.textContent, /collect@1.0.0 · COLLECT/); assert.match(c.textContent, /已保存版本 3/)
})
