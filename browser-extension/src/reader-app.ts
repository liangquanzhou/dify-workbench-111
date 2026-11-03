import { isRecord, parseJson } from './model'
import { importStored } from './stored'
import { isWorkflowEditorLocation } from './binding'
import type { StoredReference } from './binding'

type Reader = { table: string; mode: 'latest' | 'version'; appCode: string; readAppId: string; publishedWorkflowId: string }
type Connections = { origin: string; editorAppId: string; readers: Reader[] }
let connections: Connections | undefined
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function need(ok: unknown, text: string): asserts ok { if (!ok) throw Error(text) }
function editor(url: string) {
  const u = new URL(url)
  need(u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)), '查询连接只支持 HTTPS 或本机回环页面')
  need(isWorkflowEditorLocation(u), '请在 Dify 工作流编辑页面连接')
  const id = (/^\/app\/([^/]+)\/workflow\/?$/.exec(u.pathname) || /^\/v2\/app\/([^/]+)\/?$/.exec(u.pathname))?.[1]
  need(id && uuid.test(id), '请在 Dify 工作流编辑页面连接')
  return { origin: u.origin, editorAppId: id }
}
export function clearReaderConnections() { connections = undefined }
export function readerConnected(url: string): boolean {
  if (!connections) return false
  try {
    const scope = editor(url)
    if (scope.origin === connections.origin && scope.editorAppId === connections.editorAppId) return true
  } catch { /* A non-workflow navigation clears the tab-only connection. */ }
  clearReaderConnections(); return false
}
export function connectReaders(raw: string, url: string): void {
  clearReaderConnections()
  need(raw.length <= 65536, '查询连接文件超过 64 KiB')
  const scope = editor(url), data = parseJson(raw)
  need(isRecord(data) && data.schema === 'dmn-preview.reader-apps/v1', '查询连接文件格式不支持')
  need(data.origin === scope.origin && data.editorAppId === scope.editorAppId, '查询连接不属于当前站点和编辑应用')
  need(Array.isArray(data.readers) && data.readers.length > 0 && data.readers.length <= 64, '查询连接必须有 1..64 个表绑定')
  const keys = new Set<string>()
  const readers = data.readers.map(r => {
    need(isRecord(r) && typeof r.table === 'string' && r.table.length > 0 && r.table.length <= 256 && ['latest', 'version'].includes(String(r.mode)), '查询表绑定无效')
    need(typeof r.appCode === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(r.appCode), '查询应用代码无效')
    need(typeof r.readAppId === 'string' && uuid.test(r.readAppId) && typeof r.publishedWorkflowId === 'string' && uuid.test(r.publishedWorkflowId), '查询应用或发布版本编号无效')
    const key = r.table + '/' + r.mode; need(!keys.has(key), '查询表绑定重复'); keys.add(key)
    return { table: r.table, mode: r.mode as Reader['mode'], appCode: r.appCode, readAppId: r.readAppId, publishedWorkflowId: r.publishedWorkflowId }
  })
  connections = { ...scope, readers }
}
// Limit streamed receipts, including duplicated node outputs, without persisting tokens or results.
async function responseText(response: Response): Promise<string> {
  need(response.ok, `查询接口返回 HTTP ${response.status}；请检查应用访问权限`)
  need(response.body, '查询接口没有响应体')
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, text = ''
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break
      size += part.value.byteLength; need(size <= 8 * 1024 * 1024, '查询响应超过 8 MiB，未显示截断表')
      text += decoder.decode(part.value, { stream: true })
    }
    return text + decoder.decode()
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
export async function readFromApp(ref: StoredReference, url: string, signal: AbortSignal, request: typeof fetch = globalThis.fetch) {
  need(readerConnected(url) && connections, '尚未连接当前应用的只读查询应用')
  const scope = connections
  const mode = ref.version ? 'version' : 'latest'
  const rd = scope.readers.find(r => r.table === ref.table && r.mode === mode)
  need(rd, `没有该表的 ${mode === 'version' ? '指定版本' : '当前版本'} 查询绑定；未回退其他读取路径`)
  if (ref.version) need(/^[1-9]\d*$/.test(ref.version) && Number.isSafeInteger(Number(ref.version)), '节点版本必须是正整数')
  // Only same-origin Dify web-app routes. No console key, cookie reads, arbitrary URL or redirects.
  const auth = await request(scope.origin + '/api/passport', { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal, headers: { 'X-App-Code': rd.appCode } })
  const passport = parseJson(await responseText(auth))
  need(isRecord(passport) && typeof passport.access_token === 'string' && passport.access_token.length <= 16384, '无法取得查询应用的访问身份；请先完成该应用登录')
  const response = await request(scope.origin + '/api/workflows/run', {
    method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', 'X-App-Code': rd.appCode, 'X-App-Passport': passport.access_token },
    body: JSON.stringify({ inputs: mode === 'version' ? { version: ref.version } : {}, files: [] }),
  })
  const text = await responseText(response)
  let final: Record<string, unknown> | undefined
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue
    const event = parseJson(line.slice(5).trim())
    need(isRecord(event), '查询事件格式无效')
    need(event.event !== 'error', '查询应用运行失败；未取得完整表')
    if (event.event === 'workflow_finished') { need(!final && isRecord(event.data), '查询结束事件无效'); final = event.data }
  }
  need(final?.status === 'succeeded' && final.workflow_id === rd.publishedWorkflowId, '查询失败或已发布工作流版本改变；请由维护者复核绑定')
  const outputs = final.outputs
  need(isRecord(outputs) && outputs.status_code === 200 && typeof outputs.result_json === 'string', '查询未返回成功表体；指定版本缺失时不回退最新版')
  need(connections === scope && !signal.aborted, '查询连接已切换，结果已丢弃')
  const preview = await importStored(outputs.result_json, ref, '已发布查询应用响应', 'reader')
  need(connections === scope && !signal.aborted, '查询连接已切换，结果已丢弃')
  const finished = typeof final.finished_at === 'number' && Math.abs(final.finished_at) < 8640000000000 ? new Date(final.finished_at * 1000).toISOString() : '未提供'
  preview.provenance = `查询应用 ${rd.readAppId}\n发布版本 ${rd.publishedWorkflowId}\n运行 ${String(final.id || '')} · 完成时间 ${finished}\n${preview.provenance}\n已运行查询应用并产生记录；表内容对应这次查询完成时刻。`
  return preview
}
