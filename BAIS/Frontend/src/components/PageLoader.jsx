// Suspense fallback for lazy-loaded routes — mirrors the existing loading
// spinner in ProtectedRoute.jsx/OAuthCallback.jsx so route transitions look
// identical to the app's current loading state, just shown while the route's
// JS chunk downloads instead of while auth resolves.
export default function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-5rem)]">
      <div className="w-10 h-10 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
    </div>
  );
}
