import { isRecord, literal } from './model'
import type { Json, ConditionTree, MatrixRow } from './model'
const node = (d: Document, tag: string, text = '', cls = '') => {
  const e = d.createElement(tag); e.textContent = text; e.className = cls; return e
}
export function rawDetails(d: Document, title: string, text: string): HTMLDetailsElement {
  const details = d.createElement('details'); details.className = 'dmnp-raw'
  details.append(node(d, 'summary', title), node(d, 'pre', text)); return details
}
// Preserve literal types and property names. Never interpret a key inside a fixed object as a reference.
export function jsonValue(d: Document, value: Json, depth = 0): HTMLElement {
  if (depth === 0 && value !== null && typeof value === 'object' && JSON.stringify(value).length > 16000) return rawDetails(d, '大型结构（完整 JSON）', JSON.stringify(value, null, 2))
  if (value === null || typeof value !== 'object') {
    const type = value === null ? 'null' : typeof value === 'string' ? '字符串' : typeof value === 'boolean' ? '布尔值' : '数值'
    const e = node(d, 'span', '', 'dmnp-value'); e.append(node(d, 'small', type), node(d, 'code', literal(value)))
    return typeof value === 'string' && value.length > 180 ? rawDetails(d, `完整字符串 · ${value.length} 字符`, literal(value)) : e
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  if (!entries.length) return node(d, 'code', Array.isArray(value) ? '[]（空数组）' : '{}（空对象）')
  if (depth >= 4 || entries.length > 24) return rawDetails(d, `${Array.isArray(value) ? '数组' : '对象'} · ${entries.length} 项（完整 JSON）`, JSON.stringify(value, null, 2))
  const list = node(d, 'dl', '', 'dmnp-json')
  for (const [key, child] of entries) { const dd = node(d, 'dd'); dd.append(jsonValue(d, child, depth + 1)); list.append(node(d, 'dt', Array.isArray(value) ? `第 ${Number(key) + 1} 项` : key), dd) }
  return list
}
const operators: Record<string, string> = {eq:'等于',ne:'不等于',lt:'小于',lte:'小于或等于',gt:'大于',gte:'大于或等于',in:'等于以下候选值中的任一项'}
export function conditions(d: Document, tree: ConditionTree): HTMLElement {
  if (tree.kind === 'constant') return node(d, 'p', tree.value ? '无条件（始终成立）' : '始终不成立')
  if (tree.kind === 'predicate') {
    const a = tree.atom, e = node(d, 'div', '', 'dmnp-predicate')
    const field = node(d, 'div', '', 'dmnp-field')
    if (a.path) {
      for (const [i, part] of a.path.entries()) {
        if (i) field.append(node(d, 'span', ' › ', 'dmnp-path-separator'))
        field.append(node(d, 'code', literal(part)))
      }
      field.title = a.field
    } else field.append(node(d, 'span', `条件 · ${literal(a.field)}`))
    e.append(field)
    if (a.feel) e.append(node(d, 'small', 'FEEL 表达式原文'), node(d, 'pre', a.label))
    else if (a.operator) {
      const unary = a.operator === 'exists' ? (a.value ? '路径存在' : '路径不存在') : a.operator === 'is_null' ? (a.value ? '为 null' : '不为 null') : undefined
      e.append(node(d, 'strong', unary ?? operators[a.operator] ?? a.operator))
      if (!unary) e.append(jsonValue(d, a.value!))
      e.append(node(d, 'small', `${a.id} · ${a.operator}${unary ? `: ${literal(a.value!)}` : ''}`, 'dmnp-atom-id'))
    } else e.append(node(d, 'span', a.label), node(d, 'small', ` · ${a.id}`, 'dmnp-atom-id'))
    return e
  }
  if (!tree.children.length) return node(d, 'p', tree.kind === 'all' ? '空 AND 组：始终成立' : '空 OR 组：始终不成立')
  const group = node(d, 'section', '', `dmnp-condition-group dmnp-${tree.kind}`)
  const title = `${tree.kind === 'all' ? '同时满足（AND）' : '满足任意一项／组（OR）'} · ${tree.children.length} 项`
  const list = node(d, 'div')
  const fill = () => { if (!list.childNodes.length) tree.children.forEach(child => list.append(conditions(d, child))) }
  if (tree.children.length > 6) {
    const details = d.createElement('details'); details.append(node(d, 'summary', title + ' · 展开全部'), list)
    details.addEventListener('toggle', () => { if (details.open) fill() }); group.append(details)
  } else { group.append(node(d, 'div', title, 'dmnp-group-label'), list); fill() }
  return group
}
function templateValue(d: Document, value: Json): HTMLElement {
  if (isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, 'literal')) {
    const e = node(d, 'div'); e.append(node(d, 'small', '固定值（literal）'), jsonValue(d, value.literal)); return e
  }
  // Only a template-value wrapper, never recursively classify arbitrary literal objects.
  if (isRecord(value) && Object.hasOwn(value, 'from')) {
    const e = node(d, 'div', '', 'dmnp-reference'); e.append(node(d, 'strong', '运行时引用（尚未解析）'), jsonValue(d, value)); return e
  }
  return jsonValue(d, value)
}
export function outputs(d: Document, row: MatrixRow): HTMLElement {
  const e = node(d, 'div', '', 'dmnp-readable-output')
  if (row.record !== undefined) { e.append(jsonValue(d, row.record)); return e }
  if (row.templateRef !== undefined && isRecord(row.template)) {
    e.append(node(d, 'div', `模板：${row.templateRef}`, 'dmnp-template-ref'), node(d, 'small', '输出声明 · 未求值，动作未执行'))
    for (const [key, value] of Object.entries(row.template)) {
      const title = ({state:'状态（state）',data:'数据（data）',actions:'动作声明（actions）'} as Record<string,string>)[key] ?? key
      const section = node(d, 'section'); section.append(node(d, 'strong', title))
      if (key === 'data' && isRecord(value)) {
        for (const [name, v] of Object.entries(value)) { const item = node(d, 'div', '', 'dmnp-output-item'); item.append(node(d, 'div', name, 'dmnp-output-key'), templateValue(d, v)); section.append(item) }
        if (!Object.keys(value).length) section.append(jsonValue(d, value))
      } else section.append(jsonValue(d, value))
      e.append(section)
    }
  } else {
    if (row.feel) e.append(node(d, 'small', 'FEEL 输出表达式原文 · 未求值'))
    const values = Object.fromEntries(Object.entries(row.rule).filter(([k]) => k !== 'id' && k !== 'when'))
    if (row.feel) {
      for (const [key, value] of Object.entries(isRecord(values.output) ? values.output : values)) { const section = node(d, 'section'); section.append(node(d, 'strong', key), node(d, 'pre', typeof value === 'string' ? value : JSON.stringify(value))); e.append(section) }
    } else e.append(Object.keys(values).length ? jsonValue(d, values) : node(d, 'span', '未定义输出'))
  }
  return e
}
