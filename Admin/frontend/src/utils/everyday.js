// Shared bits of the "Everyday plan" / "Everyday report" feature (EOD Reports page + the global reminder box).
export const EVERYDAY_CHANNEL = 'everyday-updates'

// Tells every open tab (and this one) that the person's own plan / report / dismissal changed, so the reminder boxes re-check at once.
export function announceEverydayChange() {
  try { window.dispatchEvent(new Event('everyday-updated')) } catch { /* no window */ }
  try {
    const channel = new BroadcastChannel(EVERYDAY_CHANNEL)
    channel.postMessage('changed')
    channel.close()
  } catch { /* BroadcastChannel unavailable: the polling in EverydayPrompt still catches up */ }
}

// The IST calendar date (YYYY-MM-DD) of a stored report date; an EOD report's `date` is the IST midnight of its day.
export function istDateKey(value) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return ''
  return new Date(time + 330 * 60 * 1000).toISOString().slice(0, 10)
}

export const personName = (person) => person?.name || person?.displayName || person?.email || 'Team member'
