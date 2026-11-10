// The browser tab tells the person that messages are waiting:
//   - the tab icon is the Immiglance logo with a small green dot in the corner (a thin gap is cut around the dot), no number. The normal logo comes back as soon as
//     nothing is unread (messages only, not other notifications);
//   - the tab title toggles every 10 seconds between the alert ("Sarah Johnson & Akash · 3 unopened messages") and the normal title ("Immiglance CRM").
//     The tab tooltip shows whichever is current, so the sender names appear when hovering during the alert half.
// Cosmetic only: every step is guarded and never throws, so it can never affect the page.

const GREEN = '#2DA44E' // a flat, calm green
const TITLE_SWAP_MS = 10000

/** "1" ... "9", then "9+" */
export const countLabel = (count) => (count > 9 ? '9+' : String(Math.max(0, Math.floor(count))))

const LOGO = '<circle cx="16" cy="16" r="15.5" fill="#1A4589"/><g transform="translate(6,6) scale(0.8333)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></g>'

export const alertIconSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">`
  + `<defs><mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32"><rect width="32" height="32" fill="#ffffff"/><circle cx="25" cy="25" r="8.6" fill="#000000"/></mask></defs>`
  + `<g mask="url(#gap)">${LOGO}</g><circle cx="25" cy="25" r="6.2" fill="${GREEN}"/></svg>`
const toDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** Up to two names ("Sarah Johnson & Akash"), then "+N" for any further people. */
export function namesLabel(senders = []) {
  const names = [...new Set((Array.isArray(senders) ? senders : [senders]).map((name) => String(name || '').trim()).filter(Boolean))]
  if (!names.length) return ''
  const shown = names.slice(0, 2).join(' & ')
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown
}

/** The alert title: the recent senders first, then how many are unopened (the normal title is the other half of the toggle). */
export function alertTitle({ count = 0, senders = [], base = '' } = {}) {
  if (!count) return base
  const what = count === 1 ? '1 unopened message' : `${count} unopened messages`
  return [namesLabel(senders), what].filter(Boolean).join(' · ')
}

let original = null // { href, type } of the real icon, remembered so it can be put back
let baseTitle = null
let appliedTitle = null
let observer = null
let active = false
let showAlertTitle = true
let swapTimer = null
let state = { count: 0, senders: [] }
let pngIcon = null // the same picture as a PNG too (Safari and some browsers do not draw an SVG tab icon)

function iconLink() {
  let link = document.querySelector('link[rel~="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.setAttribute('rel', 'icon')
    document.head.appendChild(link)
  }
  return link
}

function setIcon(href, type) {
  const link = iconLink()
  link.setAttribute('href', href)
  if (type) link.setAttribute('type', type)
  else link.removeAttribute('type')
}

function upgradeToPng() {
  try {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const context = canvas.getContext('2d')
        if (!context) return
        context.drawImage(image, 0, 0, 64, 64)
        pngIcon = canvas.toDataURL('image/png')
        if (active) setIcon(pngIcon, 'image/png')
      } catch { /* the SVG icon stays */ }
    }
    image.src = toDataUrl(alertIconSvg())
  } catch { /* the SVG icon stays */ }
}

function renderIcon() {
  setIcon(pngIcon || toDataUrl(alertIconSvg()), pngIcon ? 'image/png' : 'image/svg+xml')
  if (!pngIcon) upgradeToPng()
}

function applyTitle() {
  const next = showAlertTitle ? alertTitle({ count: state.count, senders: state.senders, base: baseTitle }) : baseTitle
  appliedTitle = next
  if (document.title !== next) document.title = next
}

function startSwap() {
  if (swapTimer) return
  swapTimer = setInterval(() => {
    if (!active) return
    showAlertTitle = !showAlertTitle
    applyTitle()
  }, TITLE_SWAP_MS)
}

function stopSwap() {
  if (swapTimer) clearInterval(swapTimer)
  swapTimer = null
}

// If the portal itself changes the title meanwhile (its branding), that new title becomes the base and the alert is applied on top of it again.
function watchTitle() {
  if (observer || typeof MutationObserver === 'undefined') return
  const titleNode = document.querySelector('title')
  if (!titleNode) return
  observer = new MutationObserver(() => {
    if (!active || document.title === appliedTitle) return
    baseTitle = document.title
    applyTitle()
  })
  observer.observe(titleNode, { childList: true, characterData: true, subtree: true })
}

/**
 * count   = unopened messages (0 puts the normal icon and title back)
 * senders = the people who wrote most recently, newest first (the title names the first two)
 */
export function setTabAlert({ count = 0, senders = [] } = {}) {
  try {
    state = { count: Math.floor(Number(count)) || 0, senders: Array.isArray(senders) ? senders : [senders] }
    if (state.count > 0) {
      if (!active) {
        const link = iconLink()
        original = { href: link.getAttribute('href'), type: link.getAttribute('type') }
        baseTitle = document.title
        active = true
        showAlertTitle = true // start on the alert: that is the news
      }
      renderIcon()
      startSwap()
      applyTitle()
      watchTitle()
      return
    }
    if (!active) return
    active = false
    stopSwap()
    if (original?.href) setIcon(original.href, original.type)
    if (baseTitle !== null) document.title = baseTitle
    appliedTitle = null
    original = null
  } catch { /* cosmetic only */ }
}
