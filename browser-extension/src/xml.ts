import { buildMatrix } from './model'
import type { Matrix, Rule, Table } from './model'
import type { Snapshot } from './binding'

// Display FEEL text verbatim; this does not evaluate FEEL or fetch imports.
export function parseXml(snapshot: Snapshot, document: Document): { kind: 'ready'; matrix: Matrix } | { kind: 'error'; message: string } {
  try {
    const raw = snapshot.raw || ''
    if (new TextEncoder().encode(raw).length > 512 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error('XML 超过预览限制或包含 DTD / ENTITY')
    const doc = new document.defaultView!.DOMParser().parseFromString(raw, 'application/xml')
    if (doc.querySelector('parsererror')) throw Error('DMN XML 格式错误')
    const ns = doc.documentElement.namespaceURI
    if (doc.documentElement.localName !== 'definitions' || !['https://www.omg.org/spec/DMN/20191111/MODEL/', 'https://www.omg.org/spec/DMN/20211108/MODEL/', 'https://www.omg.org/spec/DMN/20230324/MODEL/', 'http://www.omg.org/spec/DMN/20180521/MODEL/'].includes(ns || '')) throw Error('不支持的 DMN 命名空间')
    const children = (e: Element, name: string) => Array.from(e.children).filter(x => x.namespaceURI === ns && x.localName === name)
    const only = (e: Element, name: string) => {
      const found = children(e, name)
      if (found.length !== 1) throw Error(`DMN ${name} 缺失或不唯一`)
      return found[0]
    }
    const decisions = children(doc.documentElement, 'decision').filter(e => e.getAttribute('id') === snapshot.auxiliary)
    if (decisions.length !== 1) throw Error('decision_id 未找到或不唯一')
    const table = only(decisions[0], 'decisionTable')
    const policy = table.getAttribute('hitPolicy') || 'UNIQUE'
    if (!['UNIQUE', 'FIRST', 'COLLECT', 'ANY', 'PRIORITY', 'RULE ORDER', 'OUTPUT ORDER'].includes(policy)) throw Error('不支持的 DMN 命中策略')
    const inputs = children(table, 'input')
    const outputs = children(table, 'output')
    const rules = children(table, 'rule')
    if (rules.length > 1000 || inputs.length + outputs.length > 126) throw Error('DMN 表格超过预览限制')
    const fields = inputs.map((e, i) => `${i + 1}. ${only(only(e, 'inputExpression'), 'text').textContent || ''}`)
    const ids = new Set<string>()
    const normalized: Rule[] = rules.map((r, i) => {
      const id = r.getAttribute('id') || `规则 ${i + 1}`
      if (ids.has(id)) throw Error('DMN 规则 ID 重复')
      ids.add(id)
      const entries = children(r, 'outputEntry')
      if (entries.length !== outputs.length || children(r, 'inputEntry').length !== inputs.length) throw Error('DMN 条件或输出单元格数不匹配')
      const output = Object.fromEntries(entries.map((entry, j) => [`${j + 1}. ${outputs[j].getAttribute('name') || outputs[j].getAttribute('label') || '输出'}`, only(entry, 'text').textContent || '']))
      return { id, when: true, output }
    })
    const matrix = buildMatrix({ id: snapshot.auxiliary!, hit_policy: policy as Table['hit_policy'], rules: normalized })
    matrix.fields = fields
    rules.forEach((r, i) => {
      const atoms = children(r, 'inputEntry').map((entry, j) => ({ id: String(j + 1), field: fields[j], label: only(entry, 'text').textContent || '' }))
      matrix.rows[i].atoms = atoms
      matrix.rows[i].logic = 'FEEL 条件（且）'
      matrix.rows[i].fullLogic = atoms.map(a => `${a.field}: ${a.label}`).join(' 且 ')
    })
    matrix.note = `DMN XML · FEEL 原文（输出以 JSON 字符串展示）· 不执行表达式或依赖决策${table.hasAttribute('aggregation') ? ` · aggregation=${table.getAttribute('aggregation')}` : ''}`
    outputs.forEach((output, i) => {
      for (const [name, label] of [['defaultOutputEntry', '无匹配默认输出'], ['outputValues', '输出值顺序']]) {
        const entries = children(output, name)
        if (entries.length > 1) throw Error(`DMN ${name} 不唯一`)
        if (entries.length) matrix.note += ` · 输出 ${i + 1} ${label}：${only(entries[0], 'text').textContent || ''}`
      }
    })
    return { kind: 'ready', matrix }
  } catch (e) { return { kind: 'error', message: e instanceof Error ? e.message : '无法读取 XML' } }
}
