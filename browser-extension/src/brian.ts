import { buildMatrix, isRecord, literal, own, parseJson, MAX_DEFINITION_BYTES } from './model'
import type { Json, Matrix, Rule } from './model'
import type { Snapshot, StoredReference } from './binding'

const operators: Record<string, string> = { eq: '=', ne: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥', in: '属于', exists: '存在', is_null: '为 null' }
function requireShape(ok: unknown, message: string): asserts ok {
  if (!ok) throw Error(message)
}
function object(raw: string | undefined, name: string, maxBytes = 512 * 1024): Record<string, Json> {
  requireShape(typeof raw === 'string' && raw.length <= maxBytes && new TextEncoder().encode(raw).length <= maxBytes, `${name} 缺失或超过 ${maxBytes / 1024} KiB`)
  const value = parseJson(raw, maxBytes)
  requireShape(isRecord(value), `${name} 必须为 JSON 对象`)
  return value
}
function exact(value: Record<string, Json>, keys: string[], name: string) {
  requireShape(Object.keys(value).sort().join(',') === keys.sort().join(','), `${name} 含缺失或不支持的字段`)
}
function one(items: Json | undefined, field: string, id: Json | undefined): Record<string, Json> {
  requireShape(Array.isArray(items) && typeof id === 'string' && id.length, `node_ref.${field} 或定义结构无效`)
  const matches = items.filter(x => isRecord(x) && x[field] === id)
  requireShape(matches.length === 1 && isRecord(matches[0]), `${field} 未找到或不唯一：${id}`)
  return matches[0]
}
export function matrixFor(model: Record<string, Json>, id: string, service: boolean, stored = false): Matrix {
  requireShape(['FIRST', 'COLLECT', ...(service ? ['UNIQUE'] : [])].includes(String(model.hit_policy)), '不支持的命中策略')
  requireShape(typeof model.version === 'string' && model.version.length, '模型缺少 version')
  requireShape(Array.isArray(model.rules) && model.rules.length <= (stored ? 512 : 128) && model.rules.length > 0, '规则数量超出当前格式限制')
  const templates = model.result_templates
  if (service) requireShape(isRecord(templates) && isRecord(model.parameters), '模型缺少 parameters / result_templates')
  const ids = new Set<string>()
  const rules: Rule[] = model.rules.map((r): Rule => {
    requireShape(isRecord(r), '规则必须为对象')
    // v0.5.19 permits OR groups in both service modes. Exact keys enforce
    // when/when_any exclusivity; json-table-v1 still accepts only when.
    exact(r, service ? ['rule_id', own(r, 'when_any') ? 'when_any' : 'when', 'output_template_ref'] : ['id', 'when', 'output'], '规则（when 与 when_any 只能有一个）')
    const rid = service ? r.rule_id : r.id
    requireShape(typeof rid === 'string' && rid.length && !ids.has(rid), '规则 ID 缺失或重复')
    ids.add(rid)
    if (!service) return { id: rid, when: true, output: r.output }
    requireShape(typeof r.output_template_ref === 'string' && isRecord(templates) && own(templates, r.output_template_ref), '输出模板引用不存在')
    return { id: rid, when: true, output_template_ref: r.output_template_ref, template: templates[r.output_template_ref] }
  })
  const matrix = buildMatrix({ id, hit_policy: model.hit_policy as 'FIRST' | 'COLLECT' | 'UNIQUE', rules })
  model.rules.forEach((r, index) => {
    const rule = r as Record<string, Json>
    const any = service && own(rule, 'when_any')
    const groups = any ? rule.when_any : [rule.when]
    requireShape(Array.isArray(groups) && groups.length > 0 && groups.length <= 128, 'when_any 必须包含 1..128 个条件组')
    const groupedAtoms = groups.map((conditions, groupIndex) => {
      requireShape(Array.isArray(conditions) && conditions.length <= 32 && (!any || conditions.length > 0), 'when 必须为最多 32 项的 AND 条件数组')
      const atoms = conditions.map((c, i) => {
        requireShape(isRecord(c), '条件必须为对象')
        exact(c, ['path', 'op', 'value'], '条件')
        requireShape(Array.isArray(c.path) && c.path.length > 0 && c.path.length <= 16 && c.path.every(x => typeof x === 'string' && x.length > 0), '条件 path 必须为字符串路径数组')
        requireShape(typeof c.op === 'string' && own(operators, c.op), `不支持的条件算子：${c.op}`)
        if (c.op === 'exists' || c.op === 'is_null') requireShape(typeof c.value === 'boolean', 'exists/is_null 需要布尔值')
        if (c.op === 'in') requireShape(Array.isArray(c.value) && c.value.length <= 128, 'in 需要最多 128 项的数组')
        if (['lt', 'lte', 'gt', 'gte'].includes(c.op)) requireShape(typeof c.value === 'number' || typeof c.value === 'string', '比较值必须为数字或字符串')
        const parameter = isRecord(model.parameters) ? model.parameters[String(c.path[1])] : null
        const tableParameter = stored && isRecord(parameter) && parameter.type === 'table'
        if (tableParameter) requireShape(c.path[0] === 'parameters' && ((c.path.length === 3 && ['state', 'quality'].includes(String(c.path[2]))) || (c.path.length === 4 && c.path[2] === 'result')), 'table 参数路径无效')
        else if (service) requireShape(c.path.length >= 3 && (!stored || c.path.length === 3) && c.path[0] === 'parameters' && typeof c.path[1] === 'string' && isRecord(model.parameters) && own(model.parameters, c.path[1]) && ['value', 'quality'].includes(String(c.path[2])) && (c.path[2] !== 'quality' || c.path.length === 3), '条件引用了未声明参数或不支持的路径')
        // Bracket notation preserves the difference between ["a.b"] and ["a","b"].
        const field = '$' + c.path.map(k => `[${literal(k)}]`).join('')
        if (!matrix.fields.includes(field)) matrix.fields.push(field)
        return { id: (any ? `组${groupIndex + 1}.` : '') + String.fromCharCode(65 + i % 26) + (i >= 26 ? String(Math.floor(i / 26)) : ''), field, label: `${operators[c.op]} ${literal(c.value)}` }
      })
      return atoms
    })
    matrix.rows[index].atoms = groupedAtoms.flat()
    matrix.rows[index].logic = groupedAtoms.map(atoms => atoms.length ? `(${atoms.map(a => a.id).join(' 且 ')})` : '始终成立').join(' 或 ')
    matrix.rows[index].fullLogic = groupedAtoms.map(atoms => atoms.length ? `(${atoms.map(a => `${a.field} ${a.label}`).join(' 且 ')})` : '始终成立').join(' 或 ')
  })
  matrix.note = `${service ? 'service-decision-table-v1' : 'json-table-v1'} · 版本 ${model.version} · 结构预览，不校验运行条件`
  if (service) {
    if (model.rules.some(r => isRecord(r) && own(r, 'when_any') && (!stored || (Array.isArray(r.when_any) && r.when_any.length > 32))))
      matrix.note += ' · 此 when_any 结构需要上游 v0.5.19 或兼容版本'
    if (stored && isRecord(model.parameters)) {
      const sources = Object.entries(model.parameters).filter(([, parameter]) => isRecord(parameter) && own(parameter, 'from_table'))
      if (sources.length) matrix.note += ' · 模型回执来源约束（未求值）：' + sources.map(([name, parameter]) => `${literal(name)} → ${literal((parameter as Record<string, Json>).from_table)}`).join('；')
    }
    requireShape(model.on_no_match === 'ERROR' || model.on_no_match === 'RESULT_TEMPLATE', '不支持的 on_no_match')
    matrix.note += ` · 无匹配：${model.on_no_match}`
    if (model.on_no_match === 'RESULT_TEMPLATE') {
      requireShape(typeof model.empty_template_ref === 'string' && isRecord(templates) && own(templates, model.empty_template_ref), '无匹配模板不存在')
      matrix.note += ` ${model.empty_template_ref} ${literal(templates[model.empty_template_ref])}`
    }
  }
  return matrix
}

export function parseBrian(snapshot: Snapshot): { kind: 'ready'; matrix: Matrix } | { kind: 'error' | 'unsupported'; message: string; storage?: StoredReference } {
  try {
    const t = object(snapshot.raw, snapshot.format === 'brian-json' ? 'table_json' : 'definition_bundle_json', snapshot.format === 'brian-json' ? 512 * 1024 : MAX_DEFINITION_BYTES)
    if (snapshot.format === 'brian-json') {
      exact(t, ['format', 'id', 'version', 'hit_policy', 'rules'], 'json-table-v1')
      requireShape(t.format === 'json-table-v1' && typeof t.id === 'string' && t.id.length, '需要 json-table-v1 和 id')
      return { kind: 'ready', matrix: matrixFor(t, t.id, false) }
    }
    requireShape(t.schema_version === 'service-decision-dsl.node-architecture.v2', '不支持的定义包 schema_version')
    const ref = object(snapshot.auxiliary, 'node_ref')
    const workflow = one(t.workflows, 'workflow_id', ref.workflow_id)
    const phase = one(workflow.phases, 'phase_id', ref.phase_id)
    const step = one(phase.steps, 'step_id', ref.step_id)
    requireShape(isRecord(step.graph), 'step.graph 缺失')
    const node = one(step.graph.nodes, 'node_id', ref.node_id)
    requireShape(node.kind === 'DECISION' && typeof node.model_ref === 'string' && isRecord(t.models) && own(t.models, node.model_ref), '目标节点不是 DECISION 或 model_ref 不存在')
    const model = t.models[node.model_ref]
    requireShape(isRecord(model), '模型不是对象')
    if (own(model, 'source')) return { kind: 'unsupported', storage: isRecord(model.source) && model.source.kind === 'PLUGIN_STORAGE' && typeof model.source.table === 'string' && typeof model.source.format === 'string' ? { table: model.source.table, format: model.source.format } : undefined, message: `模型 ${node.model_ref} 引用了外部或插件存储内容，尚未读取表体。\nsource: ${literal(model.source)}` }
    requireShape(model.profile === 'service-decision-table-v1', '不支持的模型 profile')
    return { kind: 'ready', matrix: matrixFor(model, node.model_ref, true) }
  } catch (e) { return { kind: 'error', message: e instanceof Error ? e.message : '无法读取 Brian 决策表' } }
}
