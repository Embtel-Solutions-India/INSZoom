import { Loader2 } from 'lucide-react'

// Shown in the content area while a page's code is being fetched.
export default function PageLoading() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="Loading">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  )
}
