// Mirrors Backend's ExhibitService.exhibitLabelFor exactly (A, B, ... Z, AA,
// AB, ...) so an optimistic client-side relabel during drag-reorder never
// disagrees with what the server assigns a moment later.
export default function exhibitLabelFor(index) {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}
