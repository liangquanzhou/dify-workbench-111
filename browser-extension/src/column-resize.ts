const MIN_WIDTH = 100
const MAX_WIDTH = 1600
const cleanups = new WeakMap<HTMLTableElement, () => void>()

export function cancelColumnResize(container: HTMLElement): void {
  for (const table of Array.from(container.querySelectorAll('table'))) cleanups.get(table)?.()
}

/** A shared colgroup sizes both header and body; only one column changes per frame. */
export function resizeColumns(table: HTMLTableElement, widths: number[], defaults: number[]): void {
  const document = table.ownerDocument
  const window = document.defaultView!
  const group = document.createElement('colgroup')
  const cols = widths.map(width => {
    const col = document.createElement('col')
    col.style.width = `${width}px`
    group.append(col)
    return col
  })
  table.prepend(group)
  table.classList.add('dmnp-resizable')
  let total = widths.reduce((sum, width) => sum + width, 0)
  table.style.width = `${total}px`
  let endDrag: (() => void) | undefined
  cleanups.set(table, () => endDrag?.())
  for (const [index, th] of Array.from(table.tHead!.rows[0].cells).entries()) {
    const handle = document.createElement('span')
    handle.className = 'dmnp-column-resize'
    handle.tabIndex = 0
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-orientation', 'vertical')
    handle.setAttribute('aria-label', `调整${th.textContent}列宽`)
    handle.setAttribute('aria-valuemin', String(MIN_WIDTH))
    handle.setAttribute('aria-valuemax', String(MAX_WIDTH))
    handle.setAttribute('aria-valuenow', String(widths[index]))
    handle.title = '拖动调整列宽；双击还原；方向键微调'
    th.append(handle)
    const setWidth = (value: number) => {
      const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(value)))
      total += width - widths[index]
      widths[index] = width
      cols[index].style.width = `${width}px`
      table.style.width = `${total}px`
      handle.setAttribute('aria-valuenow', String(width))
    }
    handle.addEventListener('dblclick', event => {
      event.preventDefault(); event.stopPropagation(); endDrag?.(); setWidth(defaults[index])
    })
    handle.addEventListener('keydown', event => {
      const step = event.shiftKey ? 50 : 10
      const target = event.key === 'ArrowLeft' ? widths[index] - step
        : event.key === 'ArrowRight' ? widths[index] + step
          : event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? MAX_WIDTH : undefined
      if (target !== undefined) { event.preventDefault(); event.stopPropagation(); setWidth(target) }
    })
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false) return
      event.preventDefault(); event.stopPropagation(); endDrag?.()
      const startX = event.clientX
      const startWidth = widths[index]
      let pending = startWidth
      let frame: number | undefined
      const flush = () => { frame = undefined; setWidth(pending) }
      const finish = () => {
        if (frame !== undefined) { window.cancelAnimationFrame(frame); flush() }
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', up)
        handle.removeEventListener('pointercancel', cancel)
        handle.removeEventListener('lostpointercapture', finish)
        window.removeEventListener('blur', finish)
        handle.removeEventListener('keydown', escape)
        table.classList.remove('dmnp-resizing')
        handle.classList.remove('dmnp-resizing-column')
        endDrag = undefined
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId)
      }
      const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return
        next.preventDefault(); next.stopPropagation()
        pending = startWidth + next.clientX - startX
        if (frame === undefined) frame = window.requestAnimationFrame(flush)
      }
      const up = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return
        move(next); finish()
      }
      const cancel = () => { pending = startWidth; finish(); setWidth(startWidth) }
      const escape = (key: KeyboardEvent) => {
        if (key.key === 'Escape') { key.preventDefault(); key.stopPropagation(); cancel() }
      }
      endDrag = finish
      handle.setPointerCapture(event.pointerId)
      handle.focus({ preventScroll: true })
      table.classList.add('dmnp-resizing')
      handle.classList.add('dmnp-resizing-column')
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', up)
      handle.addEventListener('pointercancel', cancel)
      handle.addEventListener('lostpointercapture', finish)
      handle.addEventListener('keydown', escape)
      window.addEventListener('blur', finish)
    })
  }
}
