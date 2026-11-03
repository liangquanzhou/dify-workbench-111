import { buildMatrix, isRecord, literal, own, parseJson } from './model'
import { matrixFor } from './brian'
import type { Json, Matrix } from './model'
import type { StoredReference } from './binding'

export const MAX_IMPORT_BYTES = 832 * 1024
export type StoredPreview = { models: { key: string; matrix: Matrix }[]; document: Json; provenance: string }
const schemas: Record<string, string[]> = {
  'decision-table/v1': ['dmn-json.decision-table/v1'],
  'decision-set/v1': ['dmn-json.decision-set/v1'],
  'admission-routing-table/v1': ['dmn-json.route-table/v1'],
  'routing-table/v2': ['dmn-json.route-table/v2', 'dmn-json.route-table/v3'],
  'routing-table/v3': ['dmn-json.route-table/v2', 'dmn-json.route-table/v3'],
  'routing-table/v4': ['dmn-json.route-table/v2', 'dmn-json.route-table/v3'],
  'supplement-requirements/v1': ['dmn-json.supplement-requirements/v1', 'dmn-json.supplement-requirements/v2'],
  'supplement-requirements/v2': ['dmn-json.supplement-requirements/v2'],
  'resource-targets/v1': ['dmn-json.resource-targets/v1'],
}
function need(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message) }
async function sha256(text: string): Promise<string> {
  need(globalThis.crypto?.subtle, '当前页面没有安全摘要能力；请在 HTTPS 或 localhost 页面导入')
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), b => b.toString(16).padStart(2, '0')).join('')
}

// Upstream hashes Python json.dumps(sort_keys=True, ensure_ascii=False), not RFC8785.
// Keep numeric token types: Python hashes 1.0 differently from 1. JS JSON.parse loses this.
export function pythonCanonicalizer(raw: string): (value: Json, path?: string[]) => string {
  let pos = 0
  const numbers = new Map<string, string>()
  const ws = () => { while (/\s/.test(raw[pos] || '') && pos < raw.length) pos++ }
  const string = () => {
    const start = pos++
    while (pos < raw.length) { if (raw[pos] === '\\') pos += 2; else if (raw[pos++] === '"') break }
    return JSON.parse(raw.slice(start, pos)) as string
  }
  function scan(path: string[]) {
    ws()
    if (raw[pos] === '{') {
      pos++; ws()
      while (raw[pos] !== '}') { const k = string(); ws(); pos++; scan([...path, k]); ws(); if (raw[pos] !== ',') break; pos++; ws() }
      pos++
    } else if (raw[pos] === '[') {
      pos++; ws(); let i = 0
      while (raw[pos] !== ']') { scan([...path, String(i++)]); ws(); if (raw[pos] !== ',') break; pos++; ws() }
      pos++
    } else if (raw[pos] === '"') string()
    else {
      const start = pos
      while (pos < raw.length && !/[\s,}\]]/.test(raw[pos])) pos++
      const token = raw.slice(start, pos)
      if (/^-?\d/.test(token)) {
        const n = Number(token)
        let canonical = JSON.stringify(n)
        if (/[.eE]/.test(token)) {
          if (n === 0) canonical = (token.startsWith('-') ? '-' : '') + '0.0'
          else if (Math.abs(n) < 0.0001 || Math.abs(n) >= 1e16) {
            const [mantissa, exponent] = n.toExponential().split('e')
            const power = Number(exponent)
            canonical = `${mantissa}e${power < 0 ? '-' : '+'}${String(Math.abs(power)).padStart(2, '0')}`
          } else canonical = Number.isInteger(n) ? `${n}.0` : String(n)
        }
        numbers.set(JSON.stringify(path), canonical)
      }
    }
  }
  scan([])
  const compare = (a: string, b: string) => {
    const aa = Array.from(a, x => x.codePointAt(0)!), bb = Array.from(b, x => x.codePointAt(0)!)
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i]
    return aa.length - bb.length
  }
  function canonical(value: Json, path: string[] = []): string {
    if (typeof value === 'number') return numbers.get(JSON.stringify(path)) ?? JSON.stringify(value)
    if (Array.isArray(value)) return '[' + value.map((v, i) => canonical(v, [...path, String(i)])).join(',') + ']'
    if (isRecord(value)) return '{' + Object.keys(value).sort(compare).map(k => JSON.stringify(k) + ':' + canonical(value[k], [...path, k])).join(',') + '}'
    return JSON.stringify(value)
  }
  return canonical
}

function configMatrix(id: string, rows: Json): Matrix {
  need(Array.isArray(rows) && rows.length <= 4096 && rows.every(isRecord), '存储配置记录结构不支持')
  const matrix = buildMatrix({ id, hit_policy: '配置原文', rules: rows.map((row, i) => ({ id: String(i + 1), when: true, record: row })) })
  matrix.rows.forEach(row => { row.logic = '配置记录（未求值）'; row.fullLogic = '未编译为执行规则；所有记录字段按原文展示' })
  matrix.note = '存储配置原文 · 不是编译后的执行决策表 · 请展开完整文档查看字典和声明'
  return matrix
}

export async function importStored(raw: string, ref: StoredReference, filename: string, source: 'local' | 'reader' = 'local'): Promise<StoredPreview> {
  need(new TextEncoder().encode(raw).length <= MAX_IMPORT_BYTES, '文件超过 832 KiB 导入上限')
  let value = parseJson(raw)
  let prefix: string[] = []
  need(isRecord(value), '导入内容必须为 JSON 对象')
  if (own(value, 'status_code')) {
    need(value.status_code === 200 && isRecord(value.result), '只接受成功的 route_table_store 读取结果')
    value = value.result; prefix = ['result']
  }
  need(isRecord(value), '读取结果必须为对象')
  if (own(value, 'doc')) {
    need(value.table === ref.table, '读取结果的表名与当前节点不符')
    value = value.doc; prefix.push('doc')
  }
  need(isRecord(value), '读取结果没有表体；运行结果或空结果不能代替完整规则')
  const doc = value
  need(doc.table === ref.table, '导入表名与当前节点不符（不猜测别名）')
  need(typeof doc.schema === 'string' && own(schemas, ref.format) && schemas[ref.format].includes(doc.schema), '导入格式与节点不符或尚不支持')
  need(typeof doc.version === 'number' && Number.isSafeInteger(doc.version) && doc.version > 0, '缺少已保存版本；请导出已保存版本，不能导入未保存草稿')
  if (ref.version) need(/^\d+$/.test(ref.version) && Number(ref.version) === doc.version, '导入版本与节点钉住的版本不符')
  need(typeof doc.content_sha256 === 'string' && /^[a-f0-9]{64}$/.test(doc.content_sha256), '已保存文档缺少有效 content_sha256')
  const route = doc.schema.startsWith('dmn-json.route-table/')
  const keys = doc.schema === 'dmn-json.decision-table/v1' ? ['owner', 'model_ref', 'model']
    : doc.schema === 'dmn-json.decision-set/v1' ? ['owner', 'models']
    : route ? ['routes', doc.schema.endsWith('/v1') ? 'registry' : 'solutions', 'issue_types', 'phases', ...(own(doc, 'resource_table') && doc.resource_table !== null ? ['resource_table'] : [])]
    : doc.schema.startsWith('dmn-json.supplement-requirements/') ? ['scenes'] : ['targets']
  need(keys.every(k => own(doc, k)), '存储文档缺少完整内容字段')
  const canonical = pythonCanonicalizer(raw)
  const content = '{' + keys.sort().map(k => JSON.stringify(k) + ':' + canonical(doc[k], [...prefix, k])).join(',') + '}'
  const digest = await sha256(content)
  need(digest === doc.content_sha256, '文档摘要核对失败；内容被修改或数字序列化改变，请导入原始只读响应')
  if (ref.digest) need(ref.digest === digest, '导入内容与节点钉住的 content_sha256 不符')
  const models: StoredPreview['models'] = []
  function addModel(key: string, entry: Record<string, Json>) {
    need(typeof entry.model_ref === 'string' && isRecord(entry.model) && entry.model.profile === 'service-decision-table-v1', '存储决策模型引用或格式无效')
    models.push({ key, matrix: matrixFor(entry.model, entry.model_ref, true, true) })
  }
  if (doc.schema === 'dmn-json.decision-table/v1') addModel('默认模型', doc)
  else if (doc.schema === 'dmn-json.decision-set/v1') {
    need(isRecord(doc.models) && Object.keys(doc.models).length > 0 && Object.keys(doc.models).length <= 64, '决策集必须有 1..64 个模型')
    for (const [key, entry] of Object.entries(doc.models)) { need(isRecord(entry), '决策集模型条目无效'); addModel(key, entry) }
    models.forEach(m => { m.matrix.note += ' · 显示完整决策集；未推断运行时 models 选择' })
  } else if (route) models.push({ key: '路由配置', matrix: configMatrix(ref.table, doc.routes) })
  else {
    const records = doc[doc.schema.startsWith('dmn-json.supplement-requirements/') ? 'scenes' : 'targets']
    need(isRecord(records), '存储配置必须为对象')
    models.push({ key: '配置记录', matrix: configMatrix(ref.table, Object.entries(records).map(([key, record]) => ({ key, record }))) })
  }
  const fileHash = await sha256(raw)
  const provenance = `${source === 'local' ? '本地导入快照' : '查询响应快照'} · ${filename.slice(0, 200)}\n表 ${ref.table} · 已保存版本 ${doc.version} · 保存时间 ${typeof doc.saved_at === 'string' ? doc.saved_at : '未提供'}\ncontent_sha256 ${digest}\n原文 SHA-256 ${fileHash}\n${ref.version || ref.digest ? '已核对节点版本/摘要约束' : source === 'local' ? '节点未钉版本；此快照是否为线上最新版未知' : '节点未钉版本；显示这次查询返回的版本'} · ${source === 'local' ? '摘要一致不证明文件来源身份 · 不联网、不执行、不保存到磁盘' : '摘要一致不代替查询应用权限审查 · 仅在当前预览内保存'}`
  return { models, document: doc, provenance }
}
