// A tab's content stays MOUNTED once it has been opened (just hidden), so switching
// between Overview / Documents / Forms / ... never reloads what was already loaded -
// open forms, scroll position, expanded rows and typed text all stay as they were.
// `visited` is a ref holding a Set of tab names opened so far.
export default function KeepTab({ name, active, visited, children }) {
  if (active) visited.current.add(name)
  if (!visited.current.has(name)) return null
  return <div hidden={!active}>{children}</div>
}
