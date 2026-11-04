// Original synthetic cases; no upstream source or examples are redistributed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import fs from 'node:fs'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { BRIAN_JSON_PROVIDER, PROVIDER, extractTable, parseBrian, importStored, parseJson, renderSnapshot } from '../dist/test-api.mjs'

const ref = { workflow_id: 'w', phase_id: 'p', step_id: 's', node_id: 'n' }
const predicate = (group, index) => ({ path: ['parameters', 'sensor', index % 2 ? 'quality' : 'value'], op: 'eq', value: index % 2 ? 'KNOWN' : group })
function model(groups = 1, width = 2) {
  return { profile: 'service-decision-table-v1', version: '1.0.0', hit_policy: 'FIRST', parameters: { sensor: { type: 'number', nullable: false, record_required: true, allowed_quality: ['KNOWN'] } },
    result_templates: { yes: { state: 'PASS', data: { result: { literal: { value: 'synthetic' } } }, actions: [] }, no: { state: 'NO_MATCH', data: {}, actions: [] } }, on_no_match: 'RESULT_TEMPLATE', empty_template_ref: 'no',
    rules: [{ rule_id: 'first', when_any: Array.from({ length: groups }, (_, g) => Array.from({ length: width }, (_, i) => predicate(g, i))), output_template_ref: 'yes' }] }
}
function bundle(m) {
  return { schema_version: 'service-decision-dsl.node-architecture.v2', models: { 'synthetic@1.0.0': m }, workflows: [{ workflow_id: 'w', phases: [{ phase_id: 'p', steps: [{ step_id: 's', graph: { nodes: [{ node_id: 'n', kind: 'DECISION', model_ref: 'synthetic@1.0.0' }] } }] }] }] }
}
function snapshot(m, object = true) {
  const b = bundle(m)
  return extractTable({ type: 'tool', provider_type: 'builtin', provider_id: BRIAN_JSON_PROVIDER, tool_name: 'evaluate_decision', tool_configurations: {
    definition_bundle_json: { type: 'constant', value: object ? b : JSON.stringify(b) }, node_ref: { type: 'constant', value: ref },
  } }, 'synthetic-node')
}
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : x && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x)
function sign(doc) {
  const content = doc.models ? { owner: doc.owner, models: doc.models } : { owner: doc.owner, model_ref: doc.model_ref, model: doc.model }
  doc.content_sha256 = createHash('sha256').update(canonical(content)).digest('hex')
  return doc
}
const appId = '00000000-0000-4000-8000-000000000019'
const saved = m => sign({ schema: 'dmn-json.decision-table/v1', table: `p2.${appId}`, owner: { app_id: appId, team: 'SYNTHETIC', name: 'SYNTHETIC' }, version: 7, model_ref: 'synthetic@1.0.0', model: m })
const storageRef = { table: `p2.${appId}`, format: 'decision-table/v1', version: '7' }
const load = (doc, ref = storageRef) => importStored(JSON.stringify(doc), ref, 'synthetic.json')

for (const mode of ['inline', 'stored']) for (const groups of [1, 32, 33, 128, 129]) {
  test(`${mode}: ${groups} OR groups preserve AND, group order, rules and template references`, async () => {
    const m = model(groups)
    m.rules.push({ rule_id: 'last', when: [], output_template_ref: 'yes' })
    if (groups === 129) {
      if (mode === 'inline') assert.equal(parseBrian(snapshot(m)).kind, 'error')
      else await assert.rejects(load(saved(m)), /128/)
      return
    }
    const p = mode === 'inline' ? parseBrian(snapshot(m)) : { kind: 'ready', matrix: (await load(saved(m))).models[0].matrix }
    assert.equal(p.kind, 'ready', p.message)
    const row = p.matrix.rows[0]
    assert.equal(row.logic, Array.from({ length: groups }, (_, i) => `(组${i + 1}.A 且 组${i + 1}.B)`).join(' 或 '))
    assert.deepEqual(row.atoms.map(a => a.label), Array.from({ length: groups }, (_, i) => ['= ' + i, '= "KNOWN"']).flat())
    assert.deepEqual(p.matrix.rows.map(r => r.rule.id), ['first', 'last'])
    assert.equal(p.matrix.rows[1].logic, '始终成立')
    assert.equal(row.rule.output_template_ref, 'yes'); assert.deepEqual(row.rule.template, m.result_templates.yes)
    assert.equal(JSON.stringify(row.rule).includes('selected_combinations'), false)
  })
}
test('both modes reject ambiguous/missing/empty conditions and 33 atoms; json-table remains unchanged', async () => {
  for (const mutate of [m => m.rules[0].when = [], m => delete m.rules[0].when_any, m => m.rules[0].when_any = [], m => m.rules[0].when_any = [[]], m => m.rules[0].when_any = [Array.from({ length: 33 }, (_, i) => predicate(0, i))]]) {
    const m = model(); mutate(m)
    assert.equal(parseBrian(snapshot(m)).kind, 'error')
    await assert.rejects(load(saved(m)))
  }
  assert.equal(parseBrian({ format: 'brian-json', raw: JSON.stringify({ format: 'json-table-v1', id: 'x', version: '1', hit_policy: 'FIRST', rules: [{ id: 'x', when_any: [[]], output: {} }] }) }).kind, 'error')
})
test('128 × 32 conditions pass object/string binding, parser, digest and DOM rendering within bounded time', async t => {
  const start = performance.now(), m = model(128, 32), raw = JSON.stringify(bundle(m))
  assert(Buffer.byteLength(raw) < 512 * 1024)
  for (const object of [true, false]) {
    const s = snapshot(m, object); assert.equal(s.status, 'ready', s.message)
    const p = parseBrian(s); assert.equal(p.kind, 'ready', p.message)
    assert.equal(p.matrix.rows[0].atoms.length, 4096)
  }
  const p = await load(saved(m)); assert.equal(p.models[0].matrix.rows[0].atoms.length, 4096)
  const d = new JSDOM('<main></main>', { url: 'http://localhost/app/synthetic/workflow' }).window.document
  const c = d.querySelector('main'); renderSnapshot(c, snapshot(m))
  assert(c.querySelector('table')); assert.match(c.textContent, /组128.F1/)
  const elapsed = performance.now() - start
  t.diagnostic(JSON.stringify({ bytes: Buffer.byteLength(raw), atoms: 4096, elapsed_ms: Math.round(elapsed) }))
  assert(elapsed < 10000, 'bounded stress exceeded 10 seconds')
})
test('byte/depth/value bounds and getter protection remain active', () => {
  assert.throws(() => parseJson(JSON.stringify('x'.repeat(832 * 1024))), /KiB/)
  assert.throws(() => parseJson('['.repeat(34) + '0' + ']'.repeat(34)), /深度/)
  assert.throws(() => parseJson('{"x":1,"x":2}'), /重复/)
  const m = model(); m.tooMany = Array(524290).fill(0)
  assert.equal(snapshot(m).status, 'error')
  const large = model(); large.padding = 'x'.repeat(1024 * 1024)
  assert.equal(snapshot(large).status, 'error')
  let invoked = false
  Object.defineProperty(m, 'rules', { enumerable: true, get() { invoked = true; return [] } })
  assert.equal(snapshot(m).status, 'error'); assert.equal(invoked, false)
  const repeated = model(); repeated.padding = Array(25000).fill('x'.repeat(1000))
  // If the traversal reaches this accessor it has copied >20 MiB already.
  Object.defineProperty(repeated.padding, '24000', { get() { invoked = true; return 'late' } })
  const s = snapshot(repeated)
  assert.equal(s.status, 'error'); assert.match(s.message, /1024 KiB/); assert.equal(invoked, false)
  const multibyte = model(); multibyte.padding = '界'.repeat(350000)
  assert.match(snapshot(multibyte).message, /1024 KiB/)
})

function sizedModel(bytes, unit = 'x') {
  const m = model(); m.result_templates.yes.data.result.literal.value = ''
  const remaining = bytes - Buffer.byteLength(JSON.stringify(bundle(m)))
  const width = Buffer.byteLength(unit)
  m.result_templates.yes.data.result.literal.value = unit.repeat(Math.floor(remaining / width)) + 'x'.repeat(remaining % width)
  assert.equal(Buffer.byteLength(JSON.stringify(bundle(m))), bytes)
  return m
}
test('inline 512 KiB + 1, 832 KiB + 1 and exact 1 MiB pass; 1 MiB + 1 rejects for objects and UTF-8 strings', () => {
  for (const size of [512 * 1024 + 1, 832 * 1024 + 1, 1024 * 1024, 1024 * 1024 + 1]) for (const unit of ['x', '界']) for (const object of [true, false]) {
    const m = sizedModel(size, unit), s = snapshot(m, object)
    if (size > 1024 * 1024) {
      assert.equal(s.status, 'error')
      assert.equal(parseBrian({ format: 'brian-decision', raw: JSON.stringify(bundle(m)), auxiliary: JSON.stringify(ref) }).kind, 'error')
    } else {
      assert.equal(s.status, 'ready', s.message)
      const p = parseBrian(s); assert.equal(p.kind, 'ready', p.message)
      assert.deepEqual(p.matrix.rows[0].rule.template, m.result_templates.yes)
    }
  }
})
test('compiled page bridge renders a 1 MiB inline bundle and enforces the smaller JSON-table budget', () => {
  const start = performance.now()
  const d = new JSDOM('<main></main>', { url: 'http://localhost/app/synthetic/workflow', runScripts: 'outside-only' }), w = d.window
  w.TextEncoder = TextEncoder; w.chrome = { runtime: { sendMessage: () => Promise.resolve() } }; w.setInterval = () => 1; w.clearInterval = () => {}
  vm.runInContext(fs.readFileSync(new URL('../dist/extension/content.js', import.meta.url), 'utf8'), d.getInternalVMContext())
  const send = s => w.document.dispatchEvent(new w.CustomEvent('dmn-preview:snapshot:v1', { detail: JSON.stringify(s) }))
  const m = sizedModel(1024 * 1024, '界'); send(snapshot(m))
  assert(w.document.querySelector('#dmn-preview-extension-root table'))
  assert(w.document.querySelector('#dmn-preview-extension-root').textContent.includes(m.result_templates.yes.data.result.literal.value))
  send({ status: 'idle', message: 'cleared' })
  send({ ...snapshot(m), raw: JSON.stringify(bundle(m)) + ' ' })
  assert.equal(w.document.querySelector('#dmn-preview-extension-root table'), null)
  const table = { format: 'json-table-v1', id: 'large', version: '1', hit_policy: 'FIRST', rules: [{ id: 'r', when: [], output: 'x'.repeat(512 * 1024) }] }
  const s = extractTable({ type: 'tool', provider_type: 'builtin', provider_id: BRIAN_JSON_PROVIDER, tool_name: 'evaluate_json_table', tool_configurations: { table_json: { type: 'constant', value: table } } }, 'j')
  assert.equal(s.status, 'error'); assert.match(s.message, /512 KiB/)
  send({ status: 'ready', format: 'brian-json', raw: JSON.stringify(table) })
  assert.equal(w.document.querySelector('#dmn-preview-extension-root table'), null)
  assert(performance.now() - start < 10000)
  w.close()
})
test('legacy UTF-8 over-limit node clears the previous table immediately through the compiled bridge', () => {
  const d = new JSDOM('<main></main>', { url: 'http://localhost/app/synthetic/workflow', runScripts: 'outside-only' }), w = d.window
  w.TextEncoder = TextEncoder; w.chrome = { runtime: { sendMessage: () => Promise.resolve() } }; w.setInterval = () => 1; w.clearInterval = () => {}
  vm.runInContext(fs.readFileSync(new URL('../dist/extension/content.js', import.meta.url), 'utf8'), d.getInternalVMContext())
  const send = value => {
    const snapshot = extractTable({ type: 'tool', provider_type: 'builtin', provider_id: PROVIDER, tool_name: 'evaluate', tool_configurations: { table_json: JSON.stringify(value) } }, value.id)
    w.document.dispatchEvent(new w.CustomEvent('dmn-preview:snapshot:v1', { detail: JSON.stringify(snapshot) }))
    return snapshot
  }
  send({ id: 'OLD', hit_policy: 'FIRST', rules: [{ id: 'r', when: true }] })
  assert(w.document.querySelector('table'))
  const result = send({ id: 'NEW', hit_policy: 'FIRST', rules: [{ id: 'r', when: true, output: '界'.repeat(180000) }] })
  assert.equal(result.status, 'error'); assert.match(result.message, /512 KiB/)
  assert.equal(w.document.querySelector('table'), null)
  assert.doesNotMatch(w.document.querySelector('#dmn-preview-extension-root').textContent, /OLD/)
  w.close()
})
for (const set of [false, true]) test(`${set ? 'decision-set' : 'decision-table'}: from_table changes hash, declare does not; pins never fall back`, async () => {
  const m = model()
  m.parameters.previous = { type: 'table', nullable: false, record_required: true, allowed_quality: ['KNOWN'], from_table: 'triage.source-a' }
  m.rules[0].when_any = [[{ path: ['parameters', 'previous', 'state'], op: 'eq', value: 'PASS' }]]
  let doc = saved(m)
  if (set) { doc.schema = 'dmn-json.decision-set/v1'; doc.models = { first: { model_ref: doc.model_ref, model: doc.model } }; delete doc.model; delete doc.model_ref; sign(doc) }
  const ref = { ...storageRef, format: set ? 'decision-set/v1' : storageRef.format, digest: doc.content_sha256 }
  const p = await load(doc, ref)
  assert.match(p.models[0].matrix.note, /previous.*triage.source-a/)
  const hashes = new Set([doc.content_sha256])
  for (const source of ['triage.source-b', undefined]) {
    const changed = structuredClone(doc), target = set ? changed.models.first.model : changed.model
    if (source) target.parameters.previous.from_table = source
    else delete target.parameters.previous.from_table
    await assert.rejects(load(changed, ref), /摘要核对失败/)
    sign(changed); hashes.add(changed.content_sha256)
    await assert.rejects(load(changed, ref), /钉住/)
    await load(changed, { ...ref, digest: changed.content_sha256 })
  }
  assert.equal(hashes.size, 3)
  // Deliberately incomplete STANDARD metadata: reading old docs is not a save validator.
  doc.declare = { level: 'STANDARD', parameters: { previous: { source: 'table:triage.different', unit: 'items' } }, rows: { first: { split_of: 'legacy', split_reason: 'synthetic' } }, coexist: [['r1', 'r2']] }
  const declared = await load(doc, ref)
  assert.deepEqual(declared.document.declare, doc.declare)
  assert.match(declared.provenance, /declare 不在 content_sha256/)
  assert.match(declared.provenance, /未执行 STANDARD 保存校验/)
  assert.match(declared.models[0].matrix.note, /triage.source-a/)
  delete doc.declare; await load(doc, ref)
  await assert.rejects(load(doc, { ...ref, version: '8' }), /版本/)
})
