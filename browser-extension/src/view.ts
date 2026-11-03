import { parseTable, literal, outputValue } from './model'
import type { Snapshot, StoredReference } from './binding'
import { parseBrian } from './brian'
import { parseXml } from './xml'
import { importStored, MAX_IMPORT_BYTES } from './stored'
import type { Matrix } from './model'
import type { StoredPreview } from './stored'
import { connectReaders, readerConnected, readFromApp, clearReaderConnections } from './reader-app'
const pendingReads = new WeakMap<HTMLElement, AbortController>()
export function cancelPreview(container: HTMLElement) { pendingReads.get(container)?.abort(); pendingReads.delete(container) }
const renderGenerations = new WeakMap<HTMLElement, object>()
export function element(document: Document, tag: string, text?: string, className?: string): HTMLElement {
  const result = document.createElement(tag)
  if (text !== undefined) result.textContent = text
  if (className) result.className = className
  return result
}
export function renderSnapshot(container: HTMLElement, snapshot: Snapshot, page = 0): void {
  cancelPreview(container)
  const document = container.ownerDocument
  readerConnected(document.location.href)
  renderGenerations.set(container, {})
  container.replaceChildren()
  container.dataset.status = snapshot.status
  if (snapshot.nodeId) container.dataset.nodeId = snapshot.nodeId
  else delete container.dataset.nodeId
  const source = element(document, 'div', snapshot.nodeId ? `${snapshot.title} · 节点 ${snapshot.nodeId}` : '当前工作流节点', 'dmnp-source')
  container.append(source)
  if (snapshot.status !== 'ready') {
    const message = element(document, 'div', snapshot.message || '无法读取当前节点。', 'dmnp-status')
    message.setAttribute('role', snapshot.status === 'error' ? 'alert' : 'status')
    container.append(message)
    if (snapshot.storage) importControls(container, snapshot.storage)
    return
  }
  const parsed = snapshot.format === 'dmn-xml' ? parseXml(snapshot, document)
    : snapshot.format ? parseBrian(snapshot) : parseTable(snapshot.raw)
  if (parsed.kind !== 'ready') {
    container.dataset.status = parsed.kind
    const message = element(document, 'div', parsed.message, 'dmnp-status')
    message.setAttribute('role', parsed.kind === 'error' ? 'alert' : 'status')
    container.append(message)
    if ('storage' in parsed && parsed.storage) importControls(container, parsed.storage)
    return
  }
  const body = element(document, 'div')
  container.append(body)
  renderMatrix(body, parsed.matrix, !!snapshot.format, page)
}
function renderMatrix(container: HTMLElement, matrix: Matrix, formatted: boolean, page = 0) {
  const document = container.ownerDocument
  container.replaceChildren()
  const columns = matrix.fields.length + matrix.outputs.length + 2
  if (columns > 128) {
    container.dataset.status = 'error'
    if (container.parentElement?.dataset.status) container.parentElement.dataset.status = 'error'
    container.append(element(document, 'div', `此表含 ${columns} 列，超过可读预览上限 128 列；未显示不完整表格。`, 'dmnp-status'))
    return
  }
  const pageSize = 50
  const pages = Math.max(1, Math.ceil(matrix.rows.length / pageSize))
  page = Math.max(0, Math.min(page, pages - 1))
  container.append(element(document, 'div', `${matrix.table.id} · ${matrix.table.hit_policy} · ${matrix.rows.length} 条规则 · 预览不求值`, 'dmnp-meta'))
  if (matrix.note) container.append(element(document, 'div', matrix.note, 'dmnp-meta'))
  const scroll = element(document, 'div', undefined, 'dmnp-scroll')
  scroll.tabIndex = 0
  scroll.setAttribute('aria-label', '决策表，可横向滚动')
  const table = document.createElement('table')
  table.setAttribute('aria-label', `决策表 ${matrix.table.id}`)
  const head = table.createTHead()
  const header = head.insertRow()
  for (const [index, label] of ['规则', ...matrix.fields.map(field => `条件 · ${formatted ? field : literal(field)}`), '逻辑', ...matrix.outputs.map(output => `输出 · ${output.label}`)].entries()) {
    const th = document.createElement('th')
    th.textContent = label
    th.scope = 'col'
    if (index === matrix.fields.length + 1) th.className = 'dmnp-logic-cell'
    if (index > matrix.fields.length + 1) th.className = 'dmnp-output-cell'
    header.append(th)
  }
  const body = table.createTBody()
  for (const row of matrix.rows.slice(page * pageSize, (page + 1) * pageSize)) {
    const tr = body.insertRow()
    const id = document.createElement('th')
    id.scope = 'row'
    id.textContent = row.rule.id
    tr.append(id)
    for (const field of matrix.fields) {
      const cell = tr.insertCell()
      const atoms = row.atoms.filter(atom => atom.field === field)
      cell.textContent = atoms.length ? atoms.map(atom => `${atom.id}: ${atom.label}`).join('\n') : '—'
    }
    const logic = tr.insertCell()
    logic.className = 'dmnp-logic-cell'
    const details = document.createElement('details')
    details.append(element(document, 'summary', row.logic), element(document, 'div', row.fullLogic, 'dmnp-full-logic'))
    logic.append(details)
    for (const output of matrix.outputs) {
      const cell = tr.insertCell()
      cell.className = 'dmnp-output-cell'
      const value = outputValue(row.rule, output)
      const text = !value.present ? '未定义' : value.expanded ? '见展开列' : literal(value.value!)
      if (text.length > 140) {
        const expanded = document.createElement('details')
        expanded.append(element(document, 'summary', '展开完整输出'), element(document, 'pre', text))
        cell.append(expanded)
      } else cell.textContent = text
    }
  }
  scroll.append(table)
  container.append(scroll)
  if (!matrix.rows.length) container.append(element(document, 'div', '此表没有规则。', 'dmnp-status'))
  if (pages > 1) {
    const paging = element(document, 'nav', undefined, 'dmnp-paging')
    paging.setAttribute('aria-label', '规则分页')
    const previous = element(document, 'button', '上一页') as HTMLButtonElement
    previous.disabled = page === 0
    previous.addEventListener('click', () => renderMatrix(container, matrix, formatted, page - 1))
    const next = element(document, 'button', '下一页') as HTMLButtonElement
    next.disabled = page === pages - 1
    next.addEventListener('click', () => renderMatrix(container, matrix, formatted, page + 1))
    paging.append(previous, element(document, 'span', `第 ${page + 1}/${pages} 页 · 每页最多 ${pageSize} 条`), next)
    container.append(paging)
  }
  container.append(element(document, 'div', '只读结构预览 · 点击逻辑查看完整条件 · 预览不判断规则命中', 'dmnp-footnote'))
}

function importControls(container: HTMLElement, ref: StoredReference) {
  const document = container.ownerDocument
  const generation = renderGenerations.get(container)
  const referenceMessage = container.querySelector(':scope > .dmnp-status')
  const originalMessage = referenceMessage?.textContent || ''
  const controls = document.createElement('details')
  controls.open = !readerConnected(document.location.href)
  controls.append(element(document, 'summary', '表文件与查询连接设置'))
  controls.append(element(document, 'p', '可导入已保存表，或连接维护者提供的查询应用。连接后切换节点会自动运行固定查询，并产生 Dify 运行记录；不执行当前业务节点。连接仅本标签页有效。', 'dmnp-footnote'))
  controls.append(element(document, 'p', '仅连接维护者锁定只读配置的专用应用。发布版本在运行后核对：变更会拒绝展示，但无法撤销已发生的执行。', 'dmnp-footnote'))
  const input = document.createElement('input')
  input.type = 'file'; input.accept = '.json,application/json'; input.setAttribute('aria-label', '导入已保存的存储表 JSON')
  const config = document.createElement('input')
  config.type = 'file'; config.accept = '.json,application/json'; config.setAttribute('aria-label', '选择维护者提供的查询连接 JSON')
  const enable = element(document, 'button', '启用查询与自动读取') as HTMLButtonElement
  const refresh = element(document, 'button', '重新查询') as HTMLButtonElement
  const disconnect = element(document, 'button', '断开查询') as HTMLButtonElement
  const output = element(document, 'div')
  controls.append(element(document, 'div', '本地表文件（可选）', 'dmnp-footnote'), input,
    element(document, 'div', '维护者审核的查询连接（可选）', 'dmnp-footnote'), config, enable)
  container.append(controls, refresh, disconnect, output)
  let attempt = 0
  function show(preview: StoredPreview) {
    const lines = preview.provenance.split('\n')
    output.append(element(document, 'div', lines.filter(line => line.startsWith('表 ') || line.startsWith('content_sha256')).join('\n'), 'dmnp-meta'))
    const provenance = document.createElement('details')
    provenance.append(element(document, 'summary', '来源、运行记录与摘要校验（展开）'), element(document, 'div', preview.provenance, 'dmnp-status'))
    output.append(provenance)
    const select = document.createElement('select')
    select.setAttribute('aria-label', '选择决策集模型')
    preview.models.forEach((m, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = `${m.key} · ${m.matrix.table.id}`; select.append(option) })
    if (preview.models.length > 1) output.append(select)
    const matrix = element(document, 'div'); output.append(matrix)
    const render = () => renderMatrix(matrix, preview.models[Number(select.value || 0)].matrix, true)
    select.addEventListener('change', render); render()
    const details = document.createElement('details')
    details.append(element(document, 'summary', '完整导入文档（含声明、字典与模板）'), element(document, 'pre', JSON.stringify(preview.document, null, 2)))
    output.append(details)
  }
  async function load(source: 'local' | 'reader', task: (signal: AbortSignal) => Promise<StoredPreview>) {
    cancelPreview(container)
    const controller = new AbortController(); pendingReads.set(container, controller)
    const current = ++attempt
    const timeout = setTimeout(() => controller.abort(), 60000)
    const active = () => renderGenerations.get(container) === generation && attempt === current && container.isConnected
    output.replaceChildren(element(document, 'div', source === 'local' ? '正在核对文件、版本和摘要…' : '正在运行已授权的查询应用，并核对版本和摘要…', 'dmnp-status'))
    container.dataset.status = 'unsupported'
    if (referenceMessage) referenceMessage.textContent = originalMessage
    try {
      const preview = await task(controller.signal)
      if (!active()) return
      output.replaceChildren()
      container.dataset.status = source === 'local' ? 'imported' : 'queried'
      if (referenceMessage) referenceMessage.textContent = source === 'local' ? '节点仅含存储引用。以下展示已导入快照；未查询线上当前版本。' : '节点仅含存储引用。以下表体来自已授权查询应用，已核对节点版本和摘要约束。'
      controls.open = false
      show(preview)
    } catch (e) {
      if (!active()) return
      container.dataset.status = 'error'; output.replaceChildren()
      const message = element(document, 'div', controller.signal.aborted ? '查询取消或超时，未显示旧表；查询应用可能已留下运行记录。' : e instanceof Error ? e.message : '读取失败', 'dmnp-status')
      message.setAttribute('role', 'alert'); output.append(message)
    } finally { clearTimeout(timeout); if (pendingReads.get(container) === controller) pendingReads.delete(container) }
  }
  input.addEventListener('change', () => load('local', async () => {
    const file = input.files?.[0]
    if (!file) throw Error('未选择文件')
    if (file.size > MAX_IMPORT_BYTES) throw Error('文件超过 832 KiB 导入上限')
    return importStored(await file.text(), ref, file.name)
  }))
  const query = () => load('reader', signal => readFromApp(ref, document.location.href, signal))
  enable.addEventListener('click', () => load('reader', async signal => {
    const activationUrl = document.location.href
    const file = config.files?.[0]
    if (!file || file.size > 65536) throw Error('请选择不超过 64 KiB 的查询连接文件')
    const raw = await file.text()
    if (signal.aborted || renderGenerations.get(container) !== generation || !container.isConnected || document.location.href !== activationUrl) throw Error('连接操作已取消，未启用查询')
    connectReaders(raw, activationUrl)
    return readFromApp(ref, activationUrl, signal)
  }))
  refresh.addEventListener('click', query)
  disconnect.addEventListener('click', () => {
    ++attempt; cancelPreview(container); clearReaderConnections(); output.replaceChildren(); container.dataset.status = 'unsupported'
    if (referenceMessage) referenceMessage.textContent = originalMessage
  })
  if (readerConnected(document.location.href)) void query()
}
