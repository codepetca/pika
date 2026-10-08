// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeyboardCode, type DroppableContainer, type SensorContext, type SensorProps, type UniqueIdentifier } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import {
  AssignmentKeyboardSensor,
  AssignmentPointerSensor,
  createAssignmentDragSensorOwner,
  type AssignmentKeyboardSensorOptions,
  type AssignmentPointerSensorOptions,
} from '@/lib/assignment-drag-sensors'

function fixture() {
  let active = true
  const owner = createAssignmentDragSensorOwner(() => active)
  const node = document.createElement('button')
  document.body.append(node)
  const event = new KeyboardEvent('keydown', { code: KeyboardCode.Space, bubbles: true, cancelable: true })
  node.dispatchEvent(event)
  const containers = new Map<UniqueIdentifier, DroppableContainer>()
  const droppableContainers = Object.assign(containers, {
    toArray: () => [...containers.values()],
    getEnabled: () => [...containers.values()].filter((item) => !item.disabled),
    getNodeFor: (id: UniqueIdentifier | null | undefined) => containers.get(id ?? '')?.node.current ?? undefined,
  })
  const context: SensorContext = {
    activatorEvent: event, active: null, activeNode: node, collisionRect: null,
    collisions: null, draggableNodes: new Map(), draggingNode: node, draggingNodeRect: null,
    droppableRects: new Map(), droppableContainers, over: null, scrollableAncestors: [], scrollAdjustedTranslate: null,
  }
  const callbacks = { onAbort: vi.fn(), onPending: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onMove: vi.fn(), onEnd: vi.fn() }
  const base = {
    active: 'first', activeNode: { id: 'first', key: 'first', node: { current: node }, activatorNode: { current: node }, data: { current: {} } },
    event, context: { current: context }, ...callbacks,
  }
  const keyboard = (options: Partial<AssignmentKeyboardSensorOptions> = {}) => new AssignmentKeyboardSensor({ ...base, options: { owner, ...options } })
  const pointer = (options: Partial<AssignmentPointerSensorOptions> = {}) => {
    const pointerEvent = new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 20 })
    node.dispatchEvent(pointerEvent)
    return new AssignmentPointerSensor({ ...base, event: pointerEvent, options: { owner, activationConstraint: { distance: 6 }, ...options } })
  }
  return {
    owner, node, context, callbacks, base, keyboard, pointer,
    retire: () => { active = false; owner.cancel() },
    deactivate: () => { active = false },
    reopen: () => { active = true },
  }
}

function key(code: string) {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  return event
}

function pointerEvent(type: string, x = 10, y = 20) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true })
  document.dispatchEvent(event)
  return event
}

function click(node: HTMLElement) {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

function rect(left: number, top: number, width = 100, height = 40) {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

describe('assignment drag sensor ownership', () => {
  const owners: ReturnType<typeof createAssignmentDragSensorOwner>[] = []
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    for (const owner of owners.splice(0)) owner.cancel()
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  function setup() {
    const result = fixture()
    owners.push(result.owner)
    return result
  }

  it('retires keyboard immediately without resurrecting listeners', () => {
    const { keyboard, retire, callbacks } = setup()
    keyboard()
    expect(callbacks.onStart).toHaveBeenCalledWith({ x: 0, y: 0 })
    retire()
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
    expect(key(KeyboardCode.Enter).defaultPrevented).toBe(false)
    window.dispatchEvent(new Event('resize'))
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    expect(callbacks.onEnd).not.toHaveBeenCalled()
  })

  it('ignores the native activation event while handling the next key immediately', () => {
    const { node, base, owner, callbacks } = setup()
    node.addEventListener('keydown', (event) => {
      new AssignmentKeyboardSensor({ ...base, event, options: { owner } })
    }, { once: true })
    node.dispatchEvent(new KeyboardEvent('keydown', { code: KeyboardCode.Space, bubbles: true, cancelable: true }))
    expect(callbacks.onStart).toHaveBeenCalledTimes(1)
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(true)
    expect(callbacks.onMove).toHaveBeenCalledTimes(1)
    owner.cancel()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
  })

  it('cleans up keyboard attachment if onStart synchronously retires its owner', () => {
    const { keyboard, owner, callbacks } = setup()
    callbacks.onStart.mockImplementation(() => owner.cancel())
    keyboard()
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(key(KeyboardCode.Enter).defaultPrevented).toBe(false)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
  })

  it('uses the same owner for a reopened editor after cancelling all prior sensor resources', () => {
    const { keyboard, pointer, retire, reopen, callbacks } = setup()
    keyboard()
    retire()
    reopen()
    keyboard()
    vi.runAllTimers()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(true)
    expect(callbacks.onMove).toHaveBeenCalledTimes(1)
    key(KeyboardCode.Enter)
    pointer()
    pointerEvent('pointermove', 18, 20)
    pointerEvent('pointerup')
    expect(callbacks.onEnd).toHaveBeenCalledTimes(2)
    retire()
    expect(vi.getTimerCount()).toBe(0)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not consume a key or complete a pointer drop after the owner becomes inactive before explicit cleanup', () => {
    const keyboardFixture = setup()
    keyboardFixture.keyboard()
    vi.runAllTimers()
    keyboardFixture.deactivate()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
    expect(keyboardFixture.callbacks.onCancel).toHaveBeenCalledTimes(1)
    const pointerFixture = setup()
    pointerFixture.pointer()
    pointerEvent('pointermove', 18, 20)
    pointerFixture.deactivate()
    pointerEvent('pointerup')
    expect(pointerFixture.callbacks.onCancel).toHaveBeenCalledTimes(1)
    expect(pointerFixture.callbacks.onEnd).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('moves using the real sortable getter, then cancels active keyboard input without consuming later arrows', () => {
    const { keyboard, context, node, retire, callbacks } = setup()
    const nextNode = document.createElement('button')
    document.body.append(nextNode)
    const firstRect = rect(20, 30)
    const nextRect = rect(20, 83)
    context.collisionRect = firstRect
    context.active = { id: 'first', data: { current: {} }, rect: { current: { initial: firstRect, translated: firstRect } } }
    for (const [id, element, geometry, index] of [['first', node, firstRect, 0], ['second', nextNode, nextRect, 1]] as const) {
      context.droppableRects.set(id, geometry)
      context.droppableContainers.set(id, {
        id, key: id, disabled: false, node: { current: element }, rect: { current: geometry },
        data: { current: { sortable: { containerId: 'requirements', index, items: ['first', 'second'] } } },
      })
    }
    keyboard({ coordinateGetter: sortableKeyboardCoordinates })
    vi.runAllTimers()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(true)
    expect(callbacks.onMove).toHaveBeenLastCalledWith({ x: 0, y: 53 })
    retire()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
    expect(callbacks.onMove).toHaveBeenCalledTimes(1)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
  })

  it.each([KeyboardCode.Enter, KeyboardCode.Space, KeyboardCode.Tab])('completes keyboard with %s and permits a new drag on the same owner', (code) => {
    const { keyboard, owner, callbacks } = setup()
    keyboard()
    vi.runAllTimers()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(true)
    expect(callbacks.onMove).toHaveBeenCalledWith({ x: 0, y: 25 })
    expect(key(code).defaultPrevented).toBe(true)
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    owner.cancel()
    expect(callbacks.onCancel).not.toHaveBeenCalled()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
    keyboard()
    vi.runAllTimers()
    expect(key(KeyboardCode.Esc).defaultPrevented).toBe(true)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
  })

  it('preserves keyboard ancestor scrolling when the next item lies outside the viewport', () => {
    const { keyboard, context, callbacks } = setup()
    const scroller = document.createElement('div')
    document.body.append(scroller)
    Object.defineProperties(scroller, { clientHeight: { value: 100 }, clientWidth: { value: 100 }, scrollHeight: { value: 500 }, scrollWidth: { value: 100 } })
    scroller.getBoundingClientRect = () => ({ ...rect(0, 0, 100, 100), x: 0, y: 0, toJSON: () => ({}) })
    scroller.scrollTo = vi.fn()
    scroller.scrollBy = vi.fn()
    context.scrollableAncestors = [scroller]
    context.collisionRect = rect(0, 50)
    keyboard({ coordinateGetter: () => ({ x: 0, y: 150 }) })
    vi.runAllTimers()
    key(KeyboardCode.Down)
    expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 100, behavior: 'smooth' })
    expect(callbacks.onMove).not.toHaveBeenCalled()
  })

  it('preserves mixed keyboard movement with clamped scroll adjustment', () => {
    const { keyboard, context, callbacks } = setup()
    const scroller = document.createElement('div')
    Object.defineProperties(scroller, { clientHeight: { value: 100 }, clientWidth: { value: 100 }, scrollHeight: { value: 200 }, scrollWidth: { value: 100 } })
    scroller.getBoundingClientRect = () => ({ ...rect(0, 0, 100, 100), x: 0, y: 0, toJSON: () => ({}) })
    scroller.scrollBy = vi.fn()
    scroller.scrollTop = 50
    context.scrollableAncestors = [scroller]
    context.collisionRect = rect(0, 60)
    keyboard({ coordinateGetter: () => ({ x: 10, y: 160 }) })
    vi.runAllTimers()
    expect(key(KeyboardCode.Down).defaultPrevented).toBe(true)
    expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 50, behavior: 'smooth' })
    expect(callbacks.onMove).toHaveBeenCalledWith({ x: 10, y: 50 })
  })

  it('cancels pending pointer distance sensors without later activation or blocking unrelated input', () => {
    const { pointer, retire, callbacks } = setup()
    pointer()
    expect(callbacks.onPending).toHaveBeenCalledWith('first', { distance: 6 }, { x: 10, y: 20 })
    pointerEvent('pointermove', 13, 20)
    expect(callbacks.onStart).not.toHaveBeenCalled()
    retire()
    expect(callbacks.onAbort).toHaveBeenCalledWith('first')
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    expect(pointerEvent('pointermove', 30, 20).defaultPrevented).toBe(false)
    pointerEvent('pointerup')
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(key(KeyboardCode.Esc).defaultPrevented).toBe(false)
  })

  it('uses a strict six pixel threshold and normal pointer end retains only the click tail', () => {
    const { pointer, node, owner, callbacks } = setup()
    const onClick = vi.fn()
    node.addEventListener('click', onClick)
    pointer()
    pointerEvent('pointermove', 16, 20)
    expect(callbacks.onStart).not.toHaveBeenCalled()
    pointerEvent('pointermove', 17, 20)
    expect(callbacks.onStart).toHaveBeenCalledWith({ x: 10, y: 20 })
    expect(pointerEvent('pointermove', 18, 20).defaultPrevented).toBe(true)
    expect(callbacks.onMove).toHaveBeenCalledWith({ x: 18, y: 20 })
    click(node)
    expect(onClick).not.toHaveBeenCalled()
    pointerEvent('pointerup')
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onAbort).not.toHaveBeenCalled()
    click(node)
    expect(onClick).not.toHaveBeenCalled()
    expect(pointerEvent('pointermove', 30, 20).defaultPrevented).toBe(false)
    const contextmenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    document.dispatchEvent(contextmenu)
    expect(contextmenu.defaultPrevented).toBe(false)
    vi.advanceTimersByTime(50)
    click(node)
    expect(onClick).toHaveBeenCalledTimes(1)
    owner.cancel()
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })

  it('removes post-drop suppression and its timer immediately when the editor retires', () => {
    const { pointer, retire, node, callbacks } = setup()
    const onClick = vi.fn()
    node.addEventListener('click', onClick)
    pointer()
    pointerEvent('pointermove', 18, 20)
    pointerEvent('pointerup')
    expect(vi.getTimerCount()).toBe(1)
    retire()
    expect(vi.getTimerCount()).toBe(0)
    click(node)
    expect(onClick).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1)
    expect(callbacks.onCancel).not.toHaveBeenCalled()
  })

  it('keeps ordinary Escape cancellation click suppression until the native drop tail expires', () => {
    const { pointer, node, callbacks } = setup()
    const onClick = vi.fn()
    node.addEventListener('click', onClick)
    pointer()
    pointerEvent('pointermove', 18, 20)
    key(KeyboardCode.Esc)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    click(node)
    expect(onClick).not.toHaveBeenCalled()
    expect(pointerEvent('pointermove', 30, 20).defaultPrevented).toBe(false)
    vi.advanceTimersByTime(50)
    click(node)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['pointercancel', 'escape', 'owner'])('cancels active pointers via %s and releases selection/click resources synchronously', (cause) => {
    const { pointer, retire, node, owner, callbacks } = setup()
    const selection = document.getSelection()!
    const removeSelection = vi.spyOn(selection, 'removeAllRanges')
    const onClick = vi.fn()
    node.addEventListener('click', onClick)
    pointer()
    pointerEvent('pointermove', 18, 20)
    expect(removeSelection).toHaveBeenCalledTimes(1)
    document.dispatchEvent(new Event('selectionchange'))
    expect(removeSelection).toHaveBeenCalledTimes(2)
    if (cause === 'pointercancel') pointerEvent('pointercancel')
    else if (cause === 'escape') key(KeyboardCode.Esc)
    else retire()
    owner.cancel()
    document.dispatchEvent(new Event('selectionchange'))
    expect(removeSelection).toHaveBeenCalledTimes(2)
    click(node)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(pointerEvent('pointermove', 30, 20).defaultPrevented).toBe(false)
    pointerEvent('pointerup')
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1)
    expect(callbacks.onEnd).not.toHaveBeenCalled()
    expect(callbacks.onAbort).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels delayed pointer activation timers and tolerances through the public options', () => {
    const { pointer, owner, callbacks } = setup()
    pointer({ activationConstraint: { delay: 100, tolerance: 3 } })
    expect(vi.getTimerCount()).toBe(1)
    owner.cancel()
    expect(vi.getTimerCount()).toBe(0)
    vi.runAllTimers()
    expect(callbacks.onStart).not.toHaveBeenCalled()
    pointer({ activationConstraint: { delay: 100, tolerance: 3 } })
    pointerEvent('pointermove', 15, 20)
    expect(vi.getTimerCount()).toBe(0)
    expect(callbacks.onAbort).toHaveBeenCalledTimes(2)
    expect(callbacks.onCancel).toHaveBeenCalledTimes(2)
  })

  it('leaves another owner and unrelated document listeners intact', () => {
    const first = setup()
    const second = setup()
    const unrelated = vi.fn()
    document.addEventListener('keydown', unrelated)
    try {
      first.keyboard()
      second.keyboard()
      vi.runAllTimers()
      first.retire()
      expect(key(KeyboardCode.Down).defaultPrevented).toBe(true)
      expect(first.callbacks.onMove).not.toHaveBeenCalled()
      expect(second.callbacks.onMove).toHaveBeenCalledTimes(1)
      expect(unrelated).toHaveBeenCalledTimes(1)
      second.retire()
      expect(key(KeyboardCode.Down).defaultPrevented).toBe(false)
      expect(unrelated).toHaveBeenCalledTimes(2)
    } finally {
      document.removeEventListener('keydown', unrelated)
    }
  })

  it('rejects activators and directly constructed sensors belonging to an inactive owner', () => {
    const { retire, owner, node, base, callbacks } = setup()
    retire()
    const keyboardOptions = { owner }
    const pointerOptions = { owner }
    expect(AssignmentKeyboardSensor.activators[0].handler({ nativeEvent: base.event, target: node }, keyboardOptions, { active: base.activeNode })).toBe(false)
    const event = new MouseEvent('pointerdown', { button: 0 })
    expect(AssignmentPointerSensor.activators[0].handler({ nativeEvent: event } as Parameters<typeof AssignmentPointerSensor.activators[0]['handler']>[0], pointerOptions)).toBe(false)
    new AssignmentKeyboardSensor({ ...base, options: keyboardOptions })
    new AssignmentPointerSensor({ ...base, options: pointerOptions } as SensorProps<AssignmentPointerSensorOptions>)
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(callbacks.onCancel).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
