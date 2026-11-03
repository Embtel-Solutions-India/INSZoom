// Character limits and the one-character-per-box layout of the native PDF boxes in the USCIS form editor (used by USCISFormRenderer).
// Owner rule 2026-11-04: no character limit on any form, ever; numbers stay in their own boxes.

// A comb field is a row of printed boxes, one character per box: pdf.js lines the characters up with the boxes (class "comb" + a letter-spacing) for exactly
// its /MaxLen characters. No field may limit how much can be typed, so maxlength is removed - but the box layout is KEPT while the text fits its boxes, so each
// character sits in its own box; a text longer than the boxes falls back to ordinary text, so every character stays visible and editable. (The layout used to be
// dropped altogether, which packed the characters together and out of their boxes.)
export const rememberCombLayout = (element) => {
  if (element.dataset.combMax !== undefined || !element.classList.contains('comb')) return
  const max = Number(element.getAttribute('maxlength'))
  if (!(max > 0)) return
  element.dataset.combMax = String(max)
  element.dataset.combSpacing = element.style.letterSpacing || ''
}
export const syncCombLayout = (element) => {
  const max = Number(element?.dataset?.combMax)
  if (!(max > 0)) return
  const fits = String(element.value ?? '').length <= max
  if (element.classList.contains('comb') !== fits) element.classList.toggle('comb', fits)
  const spacing = fits ? (element.dataset.combSpacing || '') : ''
  if (element.style.letterSpacing !== spacing) element.style.letterSpacing = spacing
}

// Watches one rendered page and removes every box's character limit the moment pdf.js adds the box or sets a maxlength on it (pdf.js draws
// boxes on its own schedule, after any styling pass) - remembering a one-character-per-box layout first, so numbers stay in their boxes.
// Returns the function that stops watching (the component's effect cleanup).
export function watchFieldLimits(node) {
  if (!node || typeof MutationObserver === 'undefined') return undefined
  const lift = (element) => {
    if (!element || !element.hasAttribute?.('maxlength')) return
    rememberCombLayout(element)
    element.removeAttribute('maxlength')
    syncCombLayout(element)
  }
  const liftAll = (root) => root?.querySelectorAll?.('input[maxlength], textarea[maxlength]').forEach(lift)
  liftAll(node)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes') lift(mutation.target)
      else mutation.addedNodes.forEach((added) => { if (added.nodeType === 1) { lift(added); liftAll(added) } })
    }
  })
  observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['maxlength'] })
  return () => observer.disconnect()
}
