// Whole US dollars, no cents: 10000 -> "$10,000". Anything that is not a number reads as "$0". Pure.
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

export const formatUsdExact = (value) => USD.format(Number.isFinite(Number(value)) ? Number(value) : 0)
