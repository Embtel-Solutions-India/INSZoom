import Card, { CardHeader } from './Card'

// Presentational wrapper only - callers keep rendering their own recharts
// tree (ResponsiveContainer/BarChart/PieChart/etc.) as children; this never
// touches the data-fetching or chart-library calls themselves, only the
// surrounding card chrome + empty/loading state, matching Dashboard.jsx's
// pre-existing EmptyChartState convention.
export default function ChartCard({ title, subtitle, isEmpty, emptyLabel = 'No chart data available', height = 240, children }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {isEmpty ? (
        <div
          className="flex items-center justify-center rounded-lg border border-dashed border-border bg-muted text-sm text-muted-foreground"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </Card>
  )
}
