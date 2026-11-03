import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { JSDOM } from 'jsdom'
import { BRIAN_JSON_PROVIDER, BRIAN_XML_PROVIDER, extractTable, parseBrian, parseXml, renderSnapshot, snapshotDocument } from '../dist/test-api.mjs'

const fixtures = process.env.BRIAN_FIXTURES
if (!fixtures) throw Error('Set BRIAN_FIXTURES to a local upstream sample directory, or use scripts/check-upstream.py. Upstream samples are not redistributed.')
const read = name => fs.readFileSync(typeof fixtures === 'string' ? path.join(fixtures, name) : new URL(name, fixtures), 'utf8')
const json = name => JSON.parse(read(name))
const form = value => ({ type: 'constant', value })
const data = (tool_name, tool_configurations, more = {}) => ({ type: 'tool', provider_type: 'builtin', provider_id: BRIAN_JSON_PROVIDER, tool_name, tool_configurations, selected: true, ...more })
const bundle = () => json('definition-bundle.json')
const ref = json('invocation_decision.json').node_ref
const decision = (b = bundle(), r = ref) => extractTable(data('evaluate_decision', { definition_bundle_json: form(b), node_ref: form(r) }), 'D')
const inline = t => extractTable(data('evaluate_json_table', { table_json: form(t) }), 'J')
const simple = () => structuredClone(json('json-locate.json').models.gate.table)
const document = () => new JSDOM('<!doctype html><main></main>', { url: 'http://localhost/app/compat/workflow' }).window.document

test('real upstream json fixtures: every available table is rendered, ordered and unmodified', () => {
  let count = 0
  for (const file of ['json-locate.json', 'json-solve-p1-p5.json']) {
    for (const { table } of Object.values(json(file).models)) {
      const before = JSON.stringify(table)
      for (const input of [table, before]) {
        const s = inline(input), p = parseBrian(s)
        assert.equal(s.format, 'brian-json'); assert.equal(p.kind, 'ready', p.message)
        assert.deepEqual(p.matrix.rows.map(r => r.rule.id), table.rules.map(r => r.id))
        assert.deepEqual(p.matrix.rows.map(r => r.rule.output), table.rules.map(r => r.output))
        const c = document().createElement('div'); renderSnapshot(c, s)
        assert.equal(c.querySelectorAll('tbody tr').length, table.rules.length)
      }
      assert.equal(JSON.stringify(table), before); count++
    }
  }
  assert(count > 0)
})
test('plugin identity is author/name/provider, not GitHub owner; reject mismatched tool/provider', () => {
  for (const provider_id of ['binhuhu/dmn_json/dmn_json', 'hu8627/dmn_json/dmn', BRIAN_JSON_PROVIDER + ':0.5.18']) {
    assert.equal(extractTable(data('evaluate_json_table', { table_json: form(simple()) }, { provider_id }), 'X').status, 'unsupported')
  }
  assert.equal(extractTable(data('evaluate_json_table', {}, { provider_id: BRIAN_XML_PROVIDER }), 'X').status, 'unsupported')
})
test('static mixed/objects work; variable and interpolation never display guessed data', () => {
  const node = data('evaluate_json_table', { table_json: { type: 'mixed', value: JSON.stringify(simple()) } })
  assert.equal(parseBrian(extractTable(node, 'X')).kind, 'ready')
  for (const value of [{ type: 'variable', value: ['node', 'result'] }, { type: 'mixed', value: '{{#node.table#}}' }, '{{#node.table#}}']) {
    node.tool_configurations.table_json = value
    assert.equal(extractTable(node, 'X').status, 'dynamic')
  }
  const t = simple(); Object.defineProperty(t, 'rules', { enumerable: true, get() { throw Error('getter invoked') } })
  const s = inline(t); assert.equal(s.status, 'error'); assert.match(s.message, /不可读取/)
})
test('array path keys remain distinct, exists/is_null false and literal ref objects remain literal', () => {
  const t = simple(); t.rules = [{ id: 'r', when: [{ path: ['a.b'], op: 'exists', value: false }, { path: ['a', 'b'], op: 'is_null', value: false }, { path: ['x'], op: 'eq', value: { ref: 'literal' } }], output: false }]
  const p = parseBrian(inline(t)); assert.equal(p.kind, 'ready')
  assert.deepEqual(p.matrix.fields, ['$["a.b"]', '$["a"]["b"]', '$["x"]'])
  assert.match(p.matrix.rows[0].fullLogic, /存在 false/); assert.match(p.matrix.rows[0].fullLogic, /为 null false/)
  assert.match(p.matrix.rows[0].fullLogic, /\{"ref":"literal"\}/)
  assert.equal(p.matrix.rows[0].rule.output, false)
})
test('all upstream inline DECISION nodes resolve by complete node_ref and expose real templates', () => {
  const b = bundle(); let count = 0
  for (const w of b.workflows) for (const p of w.phases) for (const s of p.steps) for (const n of s.graph.nodes) if (n.kind === 'DECISION') {
    const result = parseBrian(decision(b, { workflow_id: w.workflow_id, phase_id: p.phase_id, step_id: s.step_id, node_id: n.node_id }))
    assert.equal(result.kind, 'ready', result.message)
    const m = b.models[n.model_ref]
    assert.equal(result.matrix.table.id, n.model_ref)
    assert.deepEqual(result.matrix.rows.map(r => r.rule.template), m.rules.map(r => m.result_templates[r.output_template_ref]))
    count++
  }
  assert(count > 0)
})
test('missing, ambiguous and non-DECISION references fail instead of showing the first model', () => {
  assert.equal(parseBrian(decision(bundle(), { ...ref, node_id: 'MISSING' })).kind, 'error')
  const b = bundle(); b.workflows.push(structuredClone(b.workflows.find(w => w.workflow_id === ref.workflow_id)))
  assert.equal(parseBrian(decision(b)).kind, 'error')
})
test('missing templates and unknown expression fields cannot silently disappear', () => {
  const b = bundle(), model = b.models['demo.meeting@1.0.0']
  delete model.result_templates.ask; assert.equal(parseBrian(decision(b)).kind, 'error')
  for (const field of ['when_any', 'unless']) {
    const t = simple(); t.rules[0][field] = []; assert.equal(parseBrian(inline(t)).kind, 'error')
  }
  const newer = bundle(); newer.models['demo.meeting@1.0.0'].rules[0].when_any = [[{ path: ['parameters', 'met_driver', 'value'], op: 'eq', value: true }]]
  assert.equal(parseBrian(decision(newer)).kind, 'error')
})
test('stored table nodes show reference/version/digest and clear the old table', () => {
  const c = document().createElement('div'); renderSnapshot(c, inline(simple())); assert(c.querySelector('table'))
  const s = extractTable(data('evaluate_stored_table', { format: form('decision-set/v1'), version: form('3'), content_sha256: form('a'.repeat(64)) }, { tool_parameters: { table: form('triage.example') } }), 'S')
  renderSnapshot(c, s); assert.equal(c.querySelector('table'), null)
  for (const text of ['triage.example', 'decision-set/v1', 'version: 3', '尚未读取规则']) assert(c.textContent.includes(text))
})
test('upstream PLUGIN_STORAGE bundle does not fabricate a table', () => {
  const b = json('route_table_bundle.json'); let count = 0
  for (const w of b.workflows) for (const p of w.phases) for (const s of p.steps) for (const n of s.graph.nodes) if (n.kind === 'DECISION' && b.models[n.model_ref].source) {
    const r = parseBrian(decision(b, { workflow_id: w.workflow_id, phase_id: p.phase_id, step_id: s.step_id, node_id: n.node_id }))
    assert.equal(r.kind, 'unsupported'); assert.match(r.message, /PLUGIN_STORAGE/); count++
  }
  assert(count > 0)
})
test('duplicate keys, unsupported operators and malformed paths are rejected', () => {
  const s = inline(JSON.stringify(simple()).replace('"id":"gate"', '"id":"gate","id":"other"'))
  assert.equal(parseBrian(s).kind, 'error')
  for (const c of [{ path: [], op: 'eq', value: 1 }, { path: ['x'], op: 'code', value: 1 }, { path: ['x'], op: 'exists', value: 0 }]) {
    const t = simple(); t.rules[0].when = [c]; assert.equal(parseBrian(inline(t)).kind, 'error')
  }
})
test('XML selects exact decision, renders FEEL text and rejects wrong ids / DTD / row mismatch', () => {
  const d = document()
  const s = extractTable(data('evaluate_dmn', {}, { provider_id: BRIAN_XML_PROVIDER, tool_parameters: { dmn_xml: form(read('locate-problem.dmn')), decision_id: form('locate_problem') } }), 'XML')
  const p = parseXml(s, d); assert.equal(p.kind, 'ready', p.message); assert.equal(p.matrix.rows.length, 3)
  const c = d.createElement('div'); renderSnapshot(c, s); assert.match(c.textContent, /CONFIRMED_ABSENT/); assert.doesNotMatch(c.textContent, /identify_order_r1/)
  for (const patch of [{ auxiliary: 'missing' }, { raw: '<!DOCTYPE definitions []>' + s.raw }, { raw: s.raw.replace('<inputEntry id="x7"><text>&quot;CONFIRMED_ABSENT&quot;</text></inputEntry>', '') }]) assert.equal(parseXml({ ...s, ...patch }, d).kind, 'error')
})
test('current DOM selection switches from Brian table to decision bundle and then stored reference', () => {
  const d = document(), e = d.createElement('div'); e.className = 'react-flow__node'; e.dataset.id = 'A'; d.body.append(e)
  const set = value => { e.__reactProps$test = { children: { props: { id: 'A', data: value } } } }
  const c = d.createElement('div')
  set(data('evaluate_json_table', { table_json: form(simple()) })); renderSnapshot(c, snapshotDocument(d)); assert(c.querySelector('table'))
  set(data('evaluate_decision', { definition_bundle_json: form(bundle()), node_ref: form(ref) })); renderSnapshot(c, snapshotDocument(d)); assert.match(c.textContent, /demo.meeting/)
  set(data('evaluate_stored_table', {})); renderSnapshot(c, snapshotDocument(d)); assert.equal(c.querySelector('table'), null)
})
test('XML defaults and output priority order remain visible without evaluating FEEL', () => {
  const raw = read('locate-problem.dmn').replace('<output id="x6" name="result" typeRef="Any"/>', '<output id="x6" name="result" typeRef="Any"><outputValues><text>"high", "low"</text></outputValues><defaultOutputEntry><text>"fallback"</text></defaultOutputEntry></output>')
  const s = { status: 'ready', format: 'dmn-xml', raw, auxiliary: 'locate_problem' }
  const d = document(), c = d.createElement('div'); renderSnapshot(c, s)
  assert(c.querySelector('table')); assert.match(c.textContent, /无匹配默认输出："fallback"/); assert.match(c.textContent, /输出值顺序："high", "low"/)
})
