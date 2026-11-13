import { Info } from 'lucide-react'

// An (i) next to a points heading: hover, focus or tap it to read how the points are calculated.
// Mirrors Backend/src/modules/leaderboard/leaderboard.service.js (staffBoard): keep the two in step.
const ScoreRulesInfo = () => (
  <span className="group relative inline-flex align-middle">
    <button
      type="button"
      aria-label="How the points are calculated"
      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus:bg-secondary focus:text-foreground focus:outline-none"
    >
      <Info className="h-4 w-4" />
    </button>
    <span
      role="tooltip"
      className="pointer-events-none invisible absolute left-0 top-full z-30 mt-2 w-48 rounded-lg border border-border bg-card p-3 text-left text-xs font-normal normal-case leading-relaxed text-foreground opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
    >
      <span className="mb-1 block text-sm font-semibold">Scoring</span>
      <span className="block">Closed case &times; 10</span>
      <span className="block">Task completed &times; 3</span>
      <span className="block">Active case &times; 1</span>
    </span>
  </span>
)

export default ScoreRulesInfo
