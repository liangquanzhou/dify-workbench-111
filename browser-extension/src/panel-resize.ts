type Rect = { x: number; y: number; width: number; height: number }
// Keep geometry in CSS pixels; changing panel dimensions never rebuilds the table.
export function resizePanel(root: HTMLElement, grow: HTMLButtonElement): () => void {
  const win = root.ownerDocument.defaultView!
  const gap = 8
  let expanded = false, cancelDrag: (() => void) | undefined
  const bounds = () => ({ width: Math.max(1, win.innerWidth - gap * 2), height: Math.max(1, win.innerHeight - gap * 2) })
  const clamp = (r: Rect): Rect => {
    const b = bounds(), width = Math.min(b.width, Math.max(Math.min(420, b.width), r.width)), height = Math.min(b.height, Math.max(Math.min(220, b.height), r.height))
    return { width, height, x: Math.max(gap, Math.min(r.x, win.innerWidth - gap - width)), y: Math.max(gap, Math.min(r.y, win.innerHeight - gap - height)) }
  }
  const initial = root.getBoundingClientRect()
  let rect = clamp({ x: initial.x || 14, y: Math.max(gap, win.innerHeight - Math.min(580, win.innerHeight * .6) - 14), width: initial.width || win.innerWidth - 490, height: Math.min(580, win.innerHeight * .6) })
  let normal = { ...rect }
  const apply = (r: Rect) => {
    rect = clamp(r)
    Object.assign(root.style, { left: `${rect.x}px`, top: `${rect.y}px`, bottom: 'auto', width: `${rect.width}px`, height: `${rect.height}px`, minWidth: '0', maxHeight: 'none' })
    root.style.setProperty('--dmnp-panel-height', `${rect.height}px`)
    root.classList.toggle('dmnp-expanded', expanded); grow.textContent = expanded ? '还原' : '展开'
  }
  const full = (): Rect => ({ x: gap, y: gap, ...bounds() })
  const move = (start: Rect, direction: string, dx: number, dy: number): Rect => {
    const b = bounds(), minW = Math.min(420, b.width), minH = Math.min(220, b.height)
    let left = start.x, right = start.x + start.width, top = start.y, bottom = start.y + start.height
    if (direction.includes('e')) right = Math.min(win.innerWidth - gap, Math.max(left + minW, right + dx))
    if (direction.includes('w')) left = Math.max(gap, Math.min(right - minW, left + dx))
    if (direction.includes('s')) bottom = Math.min(win.innerHeight - gap, Math.max(top + minH, bottom + dy))
    if (direction.includes('n')) top = Math.max(gap, Math.min(bottom - minH, top + dy))
    return { x: left, y: top, width: right - left, height: bottom - top }
  }
  const toggle = () => { cancelDrag?.(); if (!expanded) normal = { ...rect }; expanded = !expanded; apply(expanded ? full() : normal) }
  grow.addEventListener('click', toggle)
  const handles: HTMLElement[] = []
  for (const [direction, label] of Object.entries({ n: '上', s: '下', e: '右', w: '左', ne: '右上', nw: '左上', se: '右下', sw: '左下' })) {
    const handle = root.ownerDocument.createElement('div')
    handle.className = `dmnp-panel-resize dmnp-edge-${direction}`
    handle.tabIndex = 0; handle.setAttribute('role', 'button'); handle.setAttribute('aria-label', `调整预览窗口${label}边界`)
    handle.title = '拖动调整窗口；方向键微调；Esc 取消拖拽'
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false) return
      event.preventDefault(); event.stopPropagation(); cancelDrag?.()
      const start = { ...rect }, wasExpanded = expanded, oldNormal = { ...normal }, x = event.clientX, y = event.clientY, pointer = event.pointerId
      let pending = start, frame = 0
      expanded = false; apply(rect); root.classList.add('dmnp-panel-dragging')
      handle.setPointerCapture?.(pointer)
      const flush = () => { frame = 0; apply(pending) }
      const pointermove = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return
        e.preventDefault(); pending = move(start, direction, e.clientX - x, e.clientY - y)
        if (!frame) frame = win.requestAnimationFrame(flush)
      }
      const finish = (restore: boolean) => {
        if (frame) win.cancelAnimationFrame(frame)
        win.removeEventListener('pointermove', pointermove); win.removeEventListener('pointerup', pointerup); win.removeEventListener('pointercancel', pointercancel); win.removeEventListener('keydown', keydown)
        handle.removeEventListener('lostpointercapture', pointercancel)
        if (handle.hasPointerCapture?.(pointer)) handle.releasePointerCapture(pointer)
        root.classList.remove('dmnp-panel-dragging'); cancelDrag = undefined
        if (restore) { expanded = wasExpanded; normal = oldNormal; apply(start) } else { apply(pending); normal = { ...rect } }
      }
      const pointerup = (e: PointerEvent) => { if (e.pointerId === pointer) { pending = move(start, direction, e.clientX - x, e.clientY - y); finish(false) } }
      const pointercancel = () => finish(true)
      const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(true) } }
      win.addEventListener('pointermove', pointermove); win.addEventListener('pointerup', pointerup); win.addEventListener('pointercancel', pointercancel); win.addEventListener('keydown', keydown)
      handle.addEventListener('lostpointercapture', pointercancel); cancelDrag = () => finish(true)
    })
    handle.addEventListener('keydown', event => {
      const delta: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }
      if (!delta[event.key]) return
      event.preventDefault(); event.stopPropagation(); cancelDrag?.()
      const [dx, dy] = delta[event.key]; expanded = false
      apply(move(rect, direction, dx * (event.shiftKey ? 5 : 1), dy * (event.shiftKey ? 5 : 1))); normal = { ...rect }
    })
    root.append(handle); handles.push(handle)
  }
  const viewport = () => { cancelDrag?.(); apply(expanded ? full() : rect); if (!expanded) normal = { ...rect } }
  win.addEventListener('resize', viewport); apply(rect)
  return () => { cancelDrag?.(); win.removeEventListener('resize', viewport); grow.removeEventListener('click', toggle); handles.forEach(handle => handle.remove()) }
}
