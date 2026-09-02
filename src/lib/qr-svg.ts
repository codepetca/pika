/** Export the rendered code without depending on the application's CSS or theme. */
export function serializeQrSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const [x, y, width, height] = svg.getAttribute('viewBox')!.split(/\s+/).map(Number)
  const quietZone = 4 // react-qr-code's viewBox uses one unit per module.
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', '1024')
  clone.setAttribute('height', '1024')
  clone.setAttribute('viewBox', `${x - quietZone} ${y - quietZone} ${width + 8} ${height + 8}`)
  clone.removeAttribute('class')
  const sources = svg.querySelectorAll('[fill]')
  clone.querySelectorAll('[fill]').forEach((element, index) => {
    element.setAttribute('fill', getComputedStyle(sources[index]).fill)
  })
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  background.setAttribute('x', String(x - quietZone))
  background.setAttribute('y', String(y - quietZone))
  background.setAttribute('width', String(width + 8))
  background.setAttribute('height', String(height + 8))
  background.setAttribute('fill', getComputedStyle(svg).getPropertyValue('--color-qr-background').trim())
  clone.prepend(background)
  return new XMLSerializer().serializeToString(clone)
}
