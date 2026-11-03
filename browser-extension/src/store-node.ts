import type { StoreNode } from './binding'
import { isWorkflowEditorLocation } from './binding'
import { isRecord, parseJson } from './model'
import { importStored, MAX_IMPORT_BYTES } from './stored'
import type { StoredPreview } from './stored'
const formats: Record<string, string> = {
  'dmn-json.decision-table/v1': 'decision-table/v1',
  'dmn-json.decision-set/v1': 'decision-set/v1',
  'dmn-json.route-table/v1': 'admission-routing-table/v1',
  'dmn-json.route-table/v2': 'routing-table/v2',
  'dmn-json.route-table/v3': 'routing-table/v3',
  'dmn-json.supplement-requirements/v1': 'supplement-requirements/v1',
  'dmn-json.supplement-requirements/v2': 'supplement-requirements/v2',
  'dmn-json.resource-targets/v1': 'resource-targets/v1',
}
function need(ok: unknown, message: string): asserts ok { if (!ok) throw Error(message) }
/** Read original result_json; serializing result would lose Python floating-point tokens. */
export async function previewStoreResult(raw: string, ref: StoreNode, label: string): Promise<StoredPreview> {
  need(new TextEncoder().encode(raw).length <= MAX_IMPORT_BYTES, '文件超过 832 KiB 导入上限')
  let value = parseJson(raw)
  need(isRecord(value), '表文件必须为 JSON 对象')
  if ('status_code' in value) {
    need(value.status_code === 200 && isRecord(value.result), '存取结果未成功')
    value = value.result
  }
  const doc = isRecord(value) && 'doc' in value ? value.doc : value
  need(isRecord(doc) && typeof doc.table === 'string' && typeof doc.schema === 'string', '结果没有完整已保存表；history 列表、求值结果和未保存草稿不能代替表体')
  const format = formats[doc.schema]
  need(format, '尚不支持这个存储表格式')
  const preview = await importStored(raw, { table: ref.table || doc.table, format, version: ref.op === 'version' ? ref.version : undefined }, label)
  preview.provenance += '\n存取节点快照：变量输入未与当前运行绑定；不是当前存储版本的证明。'
  return preview
}
/** AgentHub prefixes are accepted only after the page itself requested this exact last-run route. */
export function lastRunUrl(pageUrl: string, nodeId: string, observedUrls: string[] = []): string {
  const page = new URL(pageUrl)
  need(isWorkflowEditorLocation(page) && (page.protocol === 'https:' || (page.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(page.hostname))), '请在受支持的安全 Workflow 页面读取')
  const match = page.pathname.match(/\/(?:v2\/)?app\/([0-9a-f-]{36})(?:\/workflow)?\/?$/i)
  need(match && /^[a-zA-Z0-9_-]{1,100}$/.test(nodeId), '应用或节点标识不支持')
  const suffix = `/apps/${match[1]}/workflows/draft/nodes/${nodeId}/last-run`
  if (page.pathname.startsWith('/app/')) return page.origin + '/console/api' + suffix
  const candidates = new Set(observedUrls.filter(raw => {
    try {
      const url = new URL(raw)
      const prefix = url.pathname.slice(0, -suffix.length)
      return url.origin === page.origin && !url.username && !url.password && !url.search && !url.hash && url.pathname.endsWith(suffix) && /^\/(?:[a-zA-Z0-9_-]+\/)*api$/.test(prefix)
    } catch { return false }
  }))
  need(candidates.size === 1, '此定制页面的只读接口尚未确认。请先打开该节点的「上次运行」，再点击读取；也可导入其中的 result_json。不要为预览运行保存节点。')
  return [...candidates][0]
}
export async function readStoreLastRun(ref: StoreNode, pageUrl: string, nodeId: string, signal: AbortSignal, observedUrls: string[] = [], request: typeof fetch = fetch): Promise<StoredPreview> {
  const url = lastRunUrl(pageUrl, nodeId, observedUrls)
  const response = await request(url, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal, headers: { Accept: 'application/json' } })
  need(response.ok, `读取上次运行失败（HTTP ${response.status}）。请确认已有运行记录和查看权限；不会触发运行。`)
  need(!response.redirected && (!response.url || response.url === url), '只读响应地址已变化')
  need(response.body, '只读响应为空')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      bytes += part.value.byteLength
      need(bytes <= 8 * 1024 * 1024, '运行记录超过 8 MiB 限制')
      need(!signal.aborted, '读取已取消')
      chunks.push(part.value)
    }
  } finally { await reader.cancel(); reader.releaseLock() }
  const decoder = new TextDecoder(), raw = chunks.map(c => decoder.decode(c, { stream: true })).join('') + decoder.decode()
  const run = JSON.parse(raw)
  need(isRecord(run) && run.node_id === nodeId && run.node_type === 'tool' && run.status === 'succeeded' && typeof run.id === 'string', '运行记录节点不符或未成功')
  need(isRecord(run.inputs) && typeof run.inputs.op === 'string' && ['table', 'version', 'save'].includes(run.inputs.op), '该运行不是完整表结果；history 仅含版本列表')
  need(isRecord(run.outputs) && run.outputs.status_code === 200 && typeof run.outputs.result_json === 'string', '上次运行没有成功的完整 result_json')
  if (ref.op) need(run.inputs.op === ref.op, '上次运行操作与当前节点配置不符')
  const preview = await previewStoreResult(run.outputs.result_json, ref, `上次运行 ${run.id}`)
  const doc = preview.document
  need(isRecord(doc), '表体无效')
  if (typeof run.inputs.table === 'string' && run.inputs.table.trim()) need(run.inputs.table.trim() === doc.table, '历史输入表名与结果不符（不猜测别名）')
  if (run.inputs.op === 'version') need(typeof run.inputs.version === 'string' && /^\d+$/.test(run.inputs.version) && Number(run.inputs.version) === doc.version, '历史请求版本与返回表体不符')
  need(!signal.aborted, '读取已取消')
  preview.provenance = `已有运行记录 · ${run.id} · 操作 ${run.inputs.op} · 时间 ${typeof run.finished_at === 'number' ? new Date(run.finished_at * 1000).toISOString() : '未提供'}\n仅 GET 读取记录；未执行节点。记录可能早于当前配置或存储版本。\n` + preview.provenance.replace('本地导入快照', '历史结果快照').replace('不联网、不执行、不保存到磁盘', '读取已有记录、不执行节点、不保存到磁盘')
  return preview
}
