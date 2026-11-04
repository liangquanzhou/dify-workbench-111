/** Page-owned data is untrusted. This adapter only reads own data properties. */
import { MAX_JSON_VALUES, MAX_DEFINITION_BYTES } from './model'
export const PROVIDER = 'liangquanzhou/dmn_decision/dmn'
export const BRIAN_JSON_PROVIDER = 'hu8627/dmn_json/dmn_json'
export const BRIAN_XML_PROVIDER = 'hu8627/dmn/dmn'
export const SNAPSHOT_EVENT = 'dmn-preview:snapshot:v1'
export const STOP_EVENT = 'dmn-preview:stop:v1'
export const REFRESH_EVENT = 'dmn-preview:refresh:v1'
export const MAX_TABLE_CHARS = 512 * 1024
export type StoredReference = { table: string; format: string; version?: string; digest?: string }
export type StoreNode = { table?: string; version?: string; op?: string }
export type Snapshot = { status: 'ready' | 'empty' | 'dynamic' | 'unsupported' | 'idle' | 'error'; nodeId?: string; title?: string; raw?: string; message?: string; format?: 'brian-json' | 'brian-decision' | 'dmn-xml'; auxiliary?: string; storage?: StoredReference; storeNode?: StoreNode }
export function ownValue(object: unknown, name: string): unknown {
  if (!object || typeof object !== 'object') return undefined
  return Object.getOwnPropertyDescriptor(object, name)?.value
}
export function extractTable(data: unknown, nodeId: string): Snapshot {
  const provider = ownValue(data, 'provider_id')
  if (ownValue(data, 'type') === 'tool' && ownValue(data, 'provider_type') === 'builtin'
    && (provider === BRIAN_JSON_PROVIDER || provider === BRIAN_XML_PROVIDER)) return extractBrian(data, nodeId, provider)
  if (ownValue(data, 'type') !== 'tool' || ownValue(data, 'provider_type') !== 'builtin'
    || ownValue(data, 'provider_id') !== PROVIDER || ownValue(data, 'tool_name') !== 'evaluate')
    return { status: 'unsupported', message: '当前节点不在支持范围。仅支持指定 DMN 插件的 evaluate 工具。' }
  const titleValue = ownValue(data, 'title')
  const base = { nodeId, title: typeof titleValue === 'string' ? titleValue.slice(0, 300) : 'DMN evaluate' }
  const config = ownValue(data, 'tool_configurations')
  const setting = ownValue(config, 'table_json')
  let raw = setting
  if (setting && typeof setting === 'object') {
    const type = ownValue(setting, 'type')
    if (type !== 'constant' && type !== 'mixed') return { ...base, status: 'dynamic', message: 'table_json 是变量或未支持的绑定；运行前没有可确认的完整表格。' }
    raw = ownValue(setting, 'value')
    if (type === 'mixed' && typeof raw === 'string' && /\{\{#.*?#\}\}/s.test(raw))
      return { ...base, status: 'dynamic', message: 'table_json 含未解析的变量；不显示推测表格。' }
  }
  if (raw === undefined || raw === null || raw === '') return { ...base, status: 'empty', message: '此节点尚未配置 table_json。' }
  if (typeof raw !== 'string') return { ...base, status: 'error', message: 'table_json 必须是 JSON 字符串。' }
  if (raw.length > MAX_TABLE_CHARS || new TextEncoder().encode(raw).length > MAX_TABLE_CHARS) return { ...base, status: 'error', message: 'table_json 超过 512 KiB 预览大小限制。' }
  return { ...base, status: 'ready', raw }
}

// Serialize object-valued form parameters without invoking page getters or toJSON.
function serializeParameter(value: unknown, maxBytes: number): string {
  let count = 0
  let bytes = 0
  const encoder = new TextEncoder()
  const charge = (text: string) => {
    bytes += encoder.encode(text).length
    if (bytes > maxBytes) throw Error(`参数超过 ${maxBytes / 1024} KiB 预览大小限制`)
  }
  const chargeString = (text: string) => {
    if (text.length > maxBytes) throw Error(`参数超过 ${maxBytes / 1024} KiB 预览大小限制`)
    charge(JSON.stringify(text))
  }
  function copy(v: unknown, depth: number): unknown {
    if (++count > MAX_JSON_VALUES || depth > 32) throw Error('参数超过预览结构限制')
    if (typeof v === 'number' && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)))) throw Error('数值超出安全范围')
    if (typeof v === 'string') { chargeString(v); return v }
    if (v === null || typeof v === 'boolean' || typeof v === 'number') { charge(JSON.stringify(v)); return v }
    if (!v || typeof v !== 'object') throw Error('参数不是 JSON 数据')
    if (Array.isArray(v) && v.length > MAX_JSON_VALUES) throw Error('参数超过预览结构限制')
    const keys = Array.isArray(v) ? Array.from({ length: v.length }, (_, i) => String(i)) : Object.keys(v)
    if (keys.length > MAX_JSON_VALUES) throw Error('参数超过预览结构限制')
    // Account for delimiters, keys and values before copying further children.
    // Repeated references cannot expand a small page object into a huge JSON string.
    charge((Array.isArray(v) ? '[]' : '{}') + ','.repeat(Math.max(0, keys.length - 1)))
    const entries = keys.map(k => {
      if (!Array.isArray(v)) { chargeString(k); charge(':') }
      const descriptor = Object.getOwnPropertyDescriptor(v, k)
      if (!descriptor || !('value' in descriptor)) throw Error('参数含不可读取的属性')
      return [k, copy(descriptor.value, depth + 1)] as const
    })
    return Array.isArray(v) ? entries.map(([, x]) => x) : Object.fromEntries(entries)
  }
  return JSON.stringify(copy(value, 0))
}
function readParameter(data: unknown, name: string, location: 'tool_configurations' | 'tool_parameters', maxBytes = MAX_TABLE_CHARS): Snapshot {
  let raw = ownValue(ownValue(data, location), name)
  if (raw && typeof raw === 'object' && ownValue(raw, 'type') !== undefined) {
    const type = ownValue(raw, 'type')
    if (type !== 'constant' && type !== 'mixed') return { status: 'dynamic', message: `${name} 是变量绑定；运行前无法确认内容。` }
    raw = ownValue(raw, 'value')
  }
  if (typeof raw === 'string' && /\{\{#.*?#\}\}/s.test(raw)) return { status: 'dynamic', message: `${name} 含未解析变量；无法确认内容。` }
  if (raw === undefined || raw === null || raw === '') return { status: 'empty', message: `尚未配置 ${name}。` }
  try {
    if (typeof raw !== 'string') raw = serializeParameter(raw, maxBytes)
    if ((raw as string).length > maxBytes || new TextEncoder().encode(raw as string).length > maxBytes) throw Error(`${name} 超过 ${maxBytes / 1024} KiB 预览大小限制`)
    return { status: 'ready', raw: raw as string }
  } catch (e) { return { status: 'error', message: e instanceof Error ? e.message : '参数读取失败' } }
}
function extractBrian(data: unknown, nodeId: string, provider: unknown): Snapshot {
  const title = ownValue(data, 'title')
  const base = { nodeId, title: typeof title === 'string' ? title.slice(0, 300) : 'DMN' }
  const tool = ownValue(data, 'tool_name')
  if (provider === BRIAN_JSON_PROVIDER && tool === 'evaluate_json_table')
    return { ...base, ...readParameter(data, 'table_json', 'tool_configurations'), format: 'brian-json' }
  if (provider === BRIAN_JSON_PROVIDER && tool === 'evaluate_decision') {
    const bundle = readParameter(data, 'definition_bundle_json', 'tool_configurations', MAX_DEFINITION_BYTES)
    const ref = readParameter(data, 'node_ref', 'tool_configurations')
    if (bundle.status !== 'ready') return { ...base, ...bundle }
    if (ref.status !== 'ready') return { ...base, ...ref }
    return { ...base, ...bundle, auxiliary: ref.raw, format: 'brian-decision' }
  }
  if (provider === BRIAN_JSON_PROVIDER && tool === 'route_table_store') {
    const fields = ['op', 'table', 'version'].map(name => [name, readParameter(data, name, 'tool_parameters')] as const)
    const storeNode: StoreNode = {}
    for (const [name, value] of fields) if (value.status === 'ready' && value.raw!.length <= 1024) storeNode[name as keyof StoreNode] = value.raw!.trim()
    return { ...base, status: 'dynamic', storeNode, message: `这是路由表存取节点；参数中的变量要到运行时才有值。可读取此节点已有的上次运行记录，或导入已保存表的 JSON。预览不会执行节点，也不会保存表。\n${fields.map(([name, value]) => `${name}: ${value.status === 'ready' ? value.raw : value.message}`).join('\n')}` }
  }
  if (provider === BRIAN_JSON_PROVIDER && tool === 'evaluate_stored_table') {
    const table = readParameter(data, 'table', 'tool_parameters')
    const format = readParameter(data, 'format', 'tool_configurations')
    const version = readParameter(data, 'version', 'tool_configurations')
    const digest = readParameter(data, 'content_sha256', 'tool_configurations')
    const staticReference = table.status === 'ready' && format.status === 'ready'
      && ['ready', 'empty'].includes(version.status) && ['ready', 'empty'].includes(digest.status)
    const values = ['table', 'format', 'version', 'content_sha256'].map(name => {
      const s = readParameter(data, name, name === 'table' ? 'tool_parameters' : 'tool_configurations')
      return `${name}: ${s.status === 'ready' ? s.raw : s.message}`
    })
    return { ...base, status: 'unsupported', storage: staticReference ? { table: table.raw!, format: format.raw!, version: version.raw, digest: digest.raw } : undefined, message: `此节点引用插件存储表，页面没有表体，尚未读取规则。\n${values.join('\n')}` }
  }
  if (provider === BRIAN_XML_PROVIDER && tool === 'evaluate_dmn') {
    const xml = readParameter(data, 'dmn_xml', 'tool_parameters')
    const ref = readParameter(data, 'decision_id', 'tool_parameters')
    if (xml.status !== 'ready') return { ...base, ...xml }
    if (ref.status !== 'ready') return { ...base, ...ref }
    return { ...base, ...xml, auxiliary: ref.raw, format: 'dmn-xml' }
  }
  return { ...base, status: 'unsupported', message: '此工具不提供可直接预览的决策表。' }
}
/** Read only the rendered ReactFlow node's current DOM props children, never Fiber/store/network. */
export function readRenderedNode(element: Element): { id: string; data: unknown } | null {
  const id = element.getAttribute('data-id')
  if (!id) return null
  const key = Object.getOwnPropertyNames(element).find(name => name.startsWith('__reactProps$'))
  if (!key) return null
  const props = ownValue(element, key)
  const queue: { value: unknown; depth: number }[] = [{ value: ownValue(props, 'children'), depth: 0 }]
  let examined = 0
  while (queue.length && examined++ < 96) {
    const { value, depth } = queue.shift()!
    if (depth > 6 || !value || typeof value !== 'object') continue
    if (Array.isArray(value)) { for (const child of value.slice(0, 48)) queue.push({ value: child, depth: depth + 1 }); continue }
    const childProps = ownValue(value, 'props')
    const data = ownValue(childProps, 'data')
    if (ownValue(childProps, 'id') === id && data && typeof ownValue(data, 'type') === 'string') return { id, data }
    queue.push({ value: ownValue(childProps, 'children'), depth: depth + 1 })
  }
  return null
}
/** Supported editor URLs: /app/<id>/workflow and AgentHub's /v2/app/<id>?mode=workflow. */
export function isWorkflowEditorLocation(location: { pathname: string; search: string }): boolean {
  if (/^\/app\/[^/]+\/workflow\/?$/.test(location.pathname)) return true
  return /^\/v2\/app\/[^/]+\/?$/.test(location.pathname) && new URLSearchParams(location.search).get('mode') === 'workflow'
}
export function snapshotDocument(document: Document): Snapshot {
  if (!isWorkflowEditorLocation(document.location))
    return { status: 'unsupported', message: '请打开 Dify 1.11.1 的 Workflow 编辑页面。' }
  const rendered = document.querySelectorAll('.react-flow__node[data-id]')
  if (rendered.length > 1500) return { status: 'error', message: '工作流节点超过 1,500，无法可靠识别当前选择；未显示部分扫描结果。' }
  if (!rendered.length) return { status: 'idle', message: '等待工作流节点；打开工作流并点击 DMN 节点。' }
  let readable = 0
  const selected: { id: string; data: unknown }[] = []
  for (const element of Array.from(rendered).slice(0, 1500)) {
    const node = readRenderedNode(element)
    if (!node) continue
    readable++
    if (ownValue(node.data, 'selected') === true) selected.push(node)
  }
  if (readable !== rendered.length) return { status: 'error', message: '无法完整读取此 Dify 页面结构。预览仅适配经验证的 1.11.1；不会显示缓存或猜测数据。' }
  if (selected.length !== 1) return { status: 'idle', message: selected.length ? '请只选择一个 DMN 节点。' : '点击 DMN 节点即可预览当前决策表。' }
  return extractTable(selected[0].data, selected[0].id)
}

/** An activation never follows a different workflow, even if the old DOM lingers or Back is used. */
export function createPageReader(document: Document): () => Snapshot {
  const activationPath = document.location.pathname
  let navigated = false
  return () => {
    if (document.location.pathname !== activationPath) navigated = true
    if (navigated) return { status: 'unsupported', message: '工作流页面已切换，旧预览已清除。请再次点击扩展启用当前页面。' }
    return snapshotDocument(document)
  }
}
