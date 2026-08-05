// Suspense fallback for lazy-loaded routes — mirrors the existing loading
// state in ProtectedRoute.jsx so route transitions look identical to the
// app's current loading state, just shown while the route's JS chunk
// downloads instead of while auth resolves.
export default function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-gray-600">Loading...</div>
    </div>
  )
}
