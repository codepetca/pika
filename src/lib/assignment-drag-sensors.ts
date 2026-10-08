import {
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  defaultKeyboardCoordinateGetter,
  getClientRect,
  getScrollableAncestors,
  type DistanceMeasurement,
  type KeyboardSensorOptions,
  type PointerSensorOptions,
  type SensorInstance,
  type SensorProps,
} from '@dnd-kit/core'
import { add, subtract, getEventCoordinates, getOwnerDocument, getWindow, isKeyboardEvent, type Coordinates } from '@dnd-kit/utilities'

/*
 * Movement/scroll behavior adapted from @dnd-kit/core 6.3.1.
 * MIT License — Copyright (c) 2021, Claudéric Demers
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

interface OwnedSensor {
  cancel(): void
}

/** One requirements editor owns pending sensors and normal-drop click tails. */
export function createAssignmentDragSensorOwner(isActive: () => boolean) {
  const instances = new Set<OwnedSensor>()
  return {
    isActive,
    register(sensor: OwnedSensor) {
      instances.add(sensor)
      return () => { instances.delete(sensor) }
    },
    cancel() {
      for (const sensor of [...instances]) sensor.cancel()
    },
  }
}

export type AssignmentDragSensorOwner = ReturnType<typeof createAssignmentDragSensorOwner>
export interface AssignmentPointerSensorOptions extends PointerSensorOptions {
  owner: AssignmentDragSensorOwner
}
export interface AssignmentKeyboardSensorOptions extends KeyboardSensorOptions {
  owner: AssignmentDragSensorOwner
}

class Resources {
  private cleanups = new Set<() => void>()

  listen(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions) {
    target.addEventListener(type, handler, options)
    this.cleanups.add(() => target.removeEventListener(type, handler, options))
  }

  later(callback: () => void, delay: number) {
    const id = setTimeout(() => {
      this.cleanups.delete(cleanup)
      callback()
    }, delay)
    const cleanup = () => clearTimeout(id)
    this.cleanups.add(cleanup)
  }

  clear() {
    for (const cleanup of this.cleanups) cleanup()
    this.cleanups.clear()
  }
}

function exceedsDistance(delta: Coordinates, distance: DistanceMeasurement) {
  const x = Math.abs(delta.x)
  const y = Math.abs(delta.y)
  if (typeof distance === 'number') return Math.hypot(x, y) > distance
  if ('x' in distance && 'y' in distance) return x > distance.x && y > distance.y
  if ('x' in distance) return x > distance.x
  return y > distance.y
}

/** Uses the public Sensor protocol; no private dnd-kit instance is retained. */
export class AssignmentPointerSensor implements SensorInstance {
  autoScrollEnabled = true
  private resources = new Resources()
  private dropResources = new Resources()
  private unregister: () => void
  private initialCoordinates: Coordinates
  private document: Document
  private activated = false
  private settled = false

  static activators = PointerSensor.activators.map((activator) => ({
    eventName: activator.eventName,
    handler: (event: Parameters<typeof activator.handler>[0], options: AssignmentPointerSensorOptions) =>
      options.owner.isActive() && activator.handler(event, options),
  }))

  constructor(private props: SensorProps<AssignmentPointerSensorOptions>) {
    this.unregister = props.options.owner.register(this)
    this.initialCoordinates = getEventCoordinates(props.event) ?? { x: 0, y: 0 }
    this.document = getOwnerDocument(props.event.target)
    if (!props.options.owner.isActive()) {
      this.cancel()
      return
    }
    const window = getWindow(props.event.target)
    this.resources.listen(this.document, 'pointermove', this.move, { passive: false })
    this.resources.listen(this.document, 'pointerup', () => this.finish(false))
    this.resources.listen(this.document, 'pointercancel', () => this.finish(true))
    this.resources.listen(this.document, 'keydown', (event) => {
      if (isKeyboardEvent(event) && event.code === KeyboardCode.Esc) this.finish(true)
    })
    this.resources.listen(window, 'resize', () => this.finish(true))
    this.resources.listen(window, 'visibilitychange', () => this.finish(true))
    this.resources.listen(window, 'dragstart', (event) => event.preventDefault())
    this.resources.listen(window, 'contextmenu', (event) => event.preventDefault())

    const { activationConstraint: constraint, bypassActivationConstraint } = props.options
    if (!constraint || bypassActivationConstraint?.(props)) {
      this.start()
    } else {
      if ('delay' in constraint) this.resources.later(() => this.start(), constraint.delay)
      props.onPending(props.active, constraint, this.initialCoordinates)
    }
  }

  private start() {
    if (this.settled || this.activated) return
    if (!this.props.options.owner.isActive()) return this.cancel()
    this.activated = true
    this.dropResources.listen(this.document, 'click', (event) => event.stopPropagation(), { capture: true })
    const removeSelection = () => this.document.getSelection()?.removeAllRanges()
    removeSelection()
    this.dropResources.listen(this.document, 'selectionchange', removeSelection)
    this.props.onStart(this.initialCoordinates)
  }

  private move: EventListener = (event) => {
    if (this.settled) return
    if (!this.props.options.owner.isActive()) return this.cancel()
    const coordinates = getEventCoordinates(event) ?? { x: 0, y: 0 }
    const delta = subtract(this.initialCoordinates, coordinates)
    const constraint = this.props.options.activationConstraint
    if (!this.activated && constraint) {
      if ('distance' in constraint) {
        if (constraint.tolerance !== undefined && exceedsDistance(delta, constraint.tolerance)) return this.cancel()
        if (exceedsDistance(delta, constraint.distance)) return this.start()
      }
      if ('delay' in constraint && exceedsDistance(delta, constraint.tolerance)) return this.cancel()
      this.props.onPending(this.props.active, constraint, this.initialCoordinates, delta)
      return
    }
    if (event.cancelable) event.preventDefault()
    this.props.onMove(coordinates)
  }

  private finish(cancelled: boolean, retainDropTail = true) {
    if (this.settled) return
    if (!this.props.options.owner.isActive()) cancelled = true
    this.settled = true
    this.resources.clear()
    // Preserve dnd-kit's post-drop click suppression for ordinary completion.
    if (this.activated && retainDropTail && this.props.options.owner.isActive()) {
      this.dropResources.later(() => {
        this.dropResources.clear()
        this.unregister()
      }, 50)
    } else {
      this.dropResources.clear()
      this.unregister()
    }
    if (!this.activated) this.props.onAbort(this.props.active)
    if (cancelled) this.props.onCancel()
    else this.props.onEnd()
  }

  cancel() {
    if (!this.settled) this.finish(true, false)
    // Also dispose an already-completed drop tail when its editor retires.
    this.resources.clear()
    this.dropResources.clear()
    this.unregister()
  }
}

const defaultKeyboardCodes = {
  start: [KeyboardCode.Space, KeyboardCode.Enter],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
}

function scrollGeometry(element: Element) {
  const document = element.ownerDocument
  const window = getWindow(element)
  const documentScroller = element === document.scrollingElement
  const bounds = element.getBoundingClientRect()
  const rect = documentScroller
    ? { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight }
    : { top: bounds.top, left: bounds.left, right: bounds.right, bottom: bounds.bottom, width: element.clientWidth, height: element.clientHeight }
  return {
    rect,
    max: {
      x: element.scrollWidth - (documentScroller ? window.innerWidth : element.clientWidth),
      y: element.scrollHeight - (documentScroller ? window.innerHeight : element.clientHeight),
    },
  }
}

export class AssignmentKeyboardSensor implements SensorInstance {
  autoScrollEnabled = false
  private resources = new Resources()
  private unregister: () => void
  private referenceCoordinates: Coordinates | undefined
  private settled = false

  static activators = KeyboardSensor.activators.map((activator) => ({
    eventName: activator.eventName,
    handler: (event: Parameters<typeof activator.handler>[0], options: AssignmentKeyboardSensorOptions, context: Parameters<typeof activator.handler>[2]) =>
      options.owner.isActive() && activator.handler(event, options, context),
  }))

  constructor(private props: SensorProps<AssignmentKeyboardSensorOptions>) {
    this.unregister = props.options.owner.register(this)
    if (!props.options.owner.isActive()) {
      this.cancel()
      return
    }
    const window = getWindow(props.event.target)
    const node = props.activeNode.node.current
    if (node && getScrollableAncestors(node).length) {
      const rect = getClientRect(node)
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= window.innerHeight || rect.left >= window.innerWidth) {
        node.scrollIntoView({ block: 'center', inline: 'center' })
      }
    }
    // Install resources before onStart: a synchronous owner exit can cancel them.
    this.resources.listen(window, 'resize', () => this.cancel())
    this.resources.listen(window, 'visibilitychange', () => this.cancel())
    // Ignore the activating key itself rather than leaving a timer-sized gap
    // where a fast next arrow cannot reach the sensor.
    this.resources.listen(getOwnerDocument(props.event.target), 'keydown', this.keydown)
    props.onStart({ x: 0, y: 0 })
  }

  private keydown: EventListener = (event) => {
    if (this.settled || event === this.props.event || !isKeyboardEvent(event)) return
    if (!this.props.options.owner.isActive()) return this.cancel()
    const { keyboardCodes = defaultKeyboardCodes, coordinateGetter = defaultKeyboardCoordinateGetter, scrollBehavior = 'smooth' } = this.props.options
    if (keyboardCodes.end.includes(event.code) || keyboardCodes.cancel.includes(event.code)) {
      event.preventDefault()
      this.finish(keyboardCodes.cancel.includes(event.code) && !keyboardCodes.end.includes(event.code))
      return
    }
    const context = this.props.context.current
    const currentCoordinates = context.collisionRect ? { x: context.collisionRect.left, y: context.collisionRect.top } : { x: 0, y: 0 }
    this.referenceCoordinates ??= currentCoordinates
    const nextCoordinates = coordinateGetter(event, { active: this.props.active, currentCoordinates, context })
    if (!nextCoordinates) return
    const delta = subtract(nextCoordinates, currentCoordinates)
    const scrollDelta = { x: 0, y: 0 }

    // Match KeyboardSensor's viewport clamping and ancestor scroll adjustment.
    for (const element of context.scrollableAncestors) {
      const { rect, max } = scrollGeometry(element)
      const right = event.code === KeyboardCode.Right
      const left = event.code === KeyboardCode.Left
      const down = event.code === KeyboardCode.Down
      const up = event.code === KeyboardCode.Up
      const clampedX = Math.min(right ? rect.right - rect.width / 2 : rect.right, Math.max(right ? rect.left : rect.left + rect.width / 2, nextCoordinates.x))
      const clampedY = Math.min(down ? rect.bottom - rect.height / 2 : rect.bottom, Math.max(down ? rect.top : rect.top + rect.height / 2, nextCoordinates.y))
      const canScrollX = (right && element.scrollLeft < max.x) || (left && element.scrollLeft > 0)
      const canScrollY = (down && element.scrollTop < max.y) || (up && element.scrollTop > 0)
      if (canScrollX && clampedX !== nextCoordinates.x) {
        const next = element.scrollLeft + delta.x
        const canScrollTo = (right && next <= max.x) || (left && next >= 0)
        if (canScrollTo && !delta.y) {
          element.scrollTo({ left: next, behavior: scrollBehavior })
          return
        }
        scrollDelta.x = element.scrollLeft - (canScrollTo ? next : right ? max.x : 0)
        if (scrollDelta.x) element.scrollBy({ left: -scrollDelta.x, behavior: scrollBehavior })
        break
      }
      if (canScrollY && clampedY !== nextCoordinates.y) {
        const next = element.scrollTop + delta.y
        const canScrollTo = (down && next <= max.y) || (up && next >= 0)
        if (canScrollTo && !delta.x) {
          element.scrollTo({ top: next, behavior: scrollBehavior })
          return
        }
        scrollDelta.y = element.scrollTop - (canScrollTo ? next : down ? max.y : 0)
        if (scrollDelta.y) element.scrollBy({ top: -scrollDelta.y, behavior: scrollBehavior })
        break
      }
    }
    event.preventDefault()
    this.props.onMove(add(subtract(nextCoordinates, this.referenceCoordinates), scrollDelta))
  }

  private finish(cancelled: boolean) {
    if (this.settled) return
    this.settled = true
    this.resources.clear()
    this.unregister()
    if (cancelled) this.props.onCancel()
    else this.props.onEnd()
  }

  cancel() {
    this.finish(true)
  }
}
