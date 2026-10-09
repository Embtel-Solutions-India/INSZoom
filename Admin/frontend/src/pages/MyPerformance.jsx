import CaseManagerPerformance from '../components/CaseManagerPerformance'

// A case manager's own weekly ratings and reviews (read-only): this week highlighted, past weeks below.
export default function MyPerformance() {
  return (
    <div className="p-2 sm:p-4 lg:p-6">
      <h1 className="text-2xl font-bold text-foreground">My Performance</h1>
      <p className="mt-1 text-muted-foreground">Ratings and reviews from your admins and team leads, one week at a time.</p>
      <div className="mt-4 rounded-lg border border-border bg-card">
        <CaseManagerPerformance managerId="me" />
      </div>
    </div>
  )
}
