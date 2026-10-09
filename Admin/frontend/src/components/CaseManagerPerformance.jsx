import { useCallback, useEffect, useState } from 'react'
import { Star, CalendarDays, MessageSquare } from 'lucide-react'
import api from '../services/api'

// Weekly performance of one case manager: "Performance this week" (highlighted, with the rating form for admins / team leads), and the past weeks
// below it as a log with a few figures. managerId = a user id, or 'me' for the signed-in case manager's own ratings.

const formatDay = (value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const weekLabel = (week) => `${formatDay(week.weekStart)} – ${formatDay(week.weekEnd)}`

function Stars({ value, size = 'w-5 h-5', onPick, label }) {
  const rounded = value == null ? 0 : value
  return (
    <div className="inline-flex items-center gap-0.5" role={onPick ? 'radiogroup' : 'img'} aria-label={label || `${rounded} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = rounded >= n - 0.25
        const half = !filled && rounded >= n - 0.75
        const icon = <Star className={`${size} ${filled ? 'fill-current text-primary' : half ? 'fill-current text-primary/50' : 'text-muted-foreground/40'}`} />
        return onPick ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onPick(n)} className="rounded p-0.5 hover:scale-110 transition-transform">
            {icon}
          </button>
        ) : <span key={n}>{icon}</span>
      })}
    </div>
  )
}

export default function CaseManagerPerformance({ managerId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [rating, setRating] = useState(0)
  const [review, setReview] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/case-managers/${managerId}/ratings`)
      const next = response.data?.data
      setData(next)
      setError('')
      const mine = next?.currentWeek?.ratings?.find((item) => item.mine)
      setRating(mine?.rating || 0)
      setReview(mine?.review || '')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the performance ratings.')
    }
  }, [managerId])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!rating) return
    setSaving(true)
    setSaved(false)
    try {
      const response = await api.put(`/case-managers/${managerId}/ratings`, { rating, review })
      setData(response.data?.data)
      setSaved(true)
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save the rating.')
    } finally {
      setSaving(false)
    }
  }

  if (error && !data) return <p className="p-6 text-sm text-destructive">{error}</p>
  if (!data) return <p className="p-6 text-sm text-muted-foreground">Loading performance…</p>

  const week = data.currentWeek
  return (
    <div className="space-y-6 p-6">
      <section className="rounded-xl border-2 border-primary/50 bg-primary/5 p-5" aria-label="Performance this week">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-foreground">Performance this week</h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarDays className="h-4 w-4" /> {weekLabel(week)}</p>
          </div>
          <div className="text-right">
            {week.average != null ? (
              <>
                <div className="flex items-center justify-end gap-2"><Stars value={week.average} size="w-6 h-6" /><span className="text-2xl font-bold text-foreground">{week.average.toFixed(1)}</span></div>
                <p className="text-xs text-muted-foreground">{week.ratingCount} rating{week.ratingCount === 1 ? '' : 's'} this week</p>
              </>
            ) : <p className="text-sm text-muted-foreground">Not rated yet this week</p>}
          </div>
        </div>

        {data.canRate ? (
          <div className="mt-4 rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-sm font-medium text-foreground">Your rating for this week</p>
            <Stars value={rating} size="w-7 h-7" onPick={(n) => { setRating(n); setSaved(false) }} label="Your rating" />
            <textarea
              value={review}
              onChange={(event) => { setReview(event.target.value); setSaved(false) }}
              rows={3}
              maxLength={2000}
              placeholder="Review (optional)"
              className="input-field mt-3 w-full"
            />
            <div className="mt-3 flex items-center gap-3">
              <button type="button" onClick={save} disabled={!rating || saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Saving…' : week.ratings.some((item) => item.mine) ? 'Update rating' : 'Save rating'}</button>
              {saved && <span className="text-sm font-semibold text-emerald-600" role="status">Saved</span>}
              {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
            </div>
          </div>
        ) : null}

        <ReviewList ratings={week.ratings} showRater={week.ratings.some((item) => item.ratedByName)} />
        <WeekFigures analytics={week.analytics} />
      </section>

      <section aria-label="Past weeks">
        <h3 className="mb-3 text-lg font-semibold text-foreground">Past weeks</h3>
        {data.history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No past weeks have been rated yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.history.map((past) => (
              <li key={new Date(past.weekStart).getTime()} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">{weekLabel(past)}</span>
                  <span className="flex items-center gap-2">
                    {past.average != null ? <><Stars value={past.average} size="w-4 h-4" /><span className="text-sm font-semibold text-foreground">{past.average.toFixed(1)}</span><span className="text-xs text-muted-foreground">({past.ratingCount})</span></> : <span className="text-sm text-muted-foreground">Not rated</span>}
                  </span>
                </div>
                <WeekFigures analytics={past.analytics} />
                <ReviewList ratings={past.ratings} showRater={past.ratings.some((item) => item.ratedByName)} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function WeekFigures({ analytics }) {
  if (!analytics) return null
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      That week: {analytics.completedCases} case{analytics.completedCases === 1 ? '' : 's'} completed · {analytics.completedTasks} task{analytics.completedTasks === 1 ? '' : 's'} completed
    </p>
  )
}

function ReviewList({ ratings = [], showRater }) {
  const withText = ratings.filter((item) => item.review)
  if (!withText.length) return null
  return (
    <ul className="mt-3 space-y-2">
      {withText.map((item) => (
        <li key={item._id} className="flex gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><Stars value={item.rating} size="w-3.5 h-3.5" />{showRater && item.ratedByName ? <span className="text-xs font-medium text-foreground">{item.ratedByName}</span> : null}<span className="text-xs text-muted-foreground capitalize">{String(item.ratedByRole || '').replace('_', ' ')}</span></div>
            <p className="mt-1 whitespace-pre-wrap text-foreground">{item.review}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
