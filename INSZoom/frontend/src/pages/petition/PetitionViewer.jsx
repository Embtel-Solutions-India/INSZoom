import { useEffect, useRef, useState } from 'react'
import { X, Download, Lock, Unlock as UnlockIcon, ShieldCheck, Truck, Loader2, AlertTriangle } from 'lucide-react'
import { petitionApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import usePetitionPackage from './usePetitionPackage'
import PetitionOutline from './PetitionOutline'
import PetitionCanvas from './PetitionCanvas'
import ValidationPanel from './ValidationPanel'
import FinalizeModal from './FinalizeModal'
import UnlockModal from './UnlockModal'
import FilingForm from './FilingForm'

const STATUS_BADGE = {
  draft: 'badge-info',
  assembling: 'badge-info',
  assembled: 'badge-success',
  needs_revision: 'badge-warning',
  finalized: 'badge-success',
  filed: 'badge-success',
  superseded: 'badge-info',
  failed: 'badge-danger',
}

// Level 2 (§5) — full-screen version viewer: 3-region layout (outline /
// canvas / validation panel) + an action bar mirroring CaseDocumentViewer's
// slate chrome. Everything else (letter edits, exhibit reorder, validation)
// is owned by usePetitionPackage / the child components; this shell wires
// them together and owns the lifecycle actions (finalize/unlock/filing) that
// aren't per-section mutations.
export default function PetitionViewer({ caseId, packageId, onClose, onChanged }) {
  const { user } = useAuth()
  const normalizedRole = String(user?.role || '').toLowerCase().replace(/[\s-]+/g, '_')
  const canFinalize = ['super_admin', 'admin', 'team_lead'].includes(normalizedRole)

  const { package: pkg, validation, loading, error, saveStates, conflict, dismissConflict, reload, saveLetter, reorderExhibits, refreshValidation, setPackage } = usePetitionPackage(packageId)
  const [definition, setDefinition] = useState(null)
  const [activeSectionKey, setActiveSectionKey] = useState('')
  const [pageInfo, setPageInfo] = useState({ page: 1, total: 1 })
  const [showFinalize, setShowFinalize] = useState(false)
  const [showUnlock, setShowUnlock] = useState(false)
  const [showFiling, setShowFiling] = useState(false)
  const [downloading, setDownloading] = useState('')
  const [actionError, setActionError] = useState('')
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!pkg?.packageDefinitionKey) return
    petitionApi.getDefinition(pkg.packageDefinitionKey).then((res) => setDefinition(res.data.data)).catch(() => setDefinition(null))
  }, [pkg?.packageDefinitionKey])

  const disabled = Boolean(pkg?.lock?.locked) || ['superseded', 'failed', 'assembling'].includes(pkg?.status)

  const handleJump = (key) => {
    setActiveSectionKey(key)
    canvasRef.current?.scrollToSection(key)
  }

  const handleScrollSpy = (key, page, total) => {
    setActiveSectionKey(key)
    setPageInfo({ page, total })
  }

  const handleDownload = async (format) => {
    setDownloading(format)
    setActionError('')
    try {
      const res = await petitionApi.download(packageId, format)
      const blobUrl = URL.createObjectURL(res.data)
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `${definition?.displayName || 'petition'}.${format === 'word' || format === 'docx' ? 'docx' : 'pdf'}`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(blobUrl), 3000)
    } catch {
      setActionError('That output has not been assembled yet.')
    } finally {
      setDownloading('')
    }
  }

  const handleFinalize = async ({ acknowledgeWarnings }) => {
    const res = await petitionApi.finalize(packageId, { acknowledgeWarnings })
    setPackage(res.data.data)
    setShowFinalize(false)
    refreshValidation()
    onChanged?.()
  }

  const handleUnlock = async ({ reason }) => {
    const res = await petitionApi.unlock(packageId, reason)
    setPackage(res.data.data)
    setShowUnlock(false)
    onChanged?.()
  }

  const handleRecordFiling = async (payload) => {
    const res = await petitionApi.recordFiling(packageId, payload)
    setPackage(res.data.data)
    onChanged?.()
  }

  const handleRecordReceipt = async (payload) => {
    const res = await petitionApi.recordReceipt(packageId, payload)
    setPackage(res.data.data)
    onChanged?.()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/90 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 bg-slate-950 px-5 py-3 shadow-lg">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{definition?.displayName || 'Petition'} · v{pkg?.versionNumber ?? '—'}</p>
            {pkg?.status && <span className={`badge ${STATUS_BADGE[pkg.status] || 'badge-info'}`}>{pkg.status.replace(/_/g, ' ')}</span>}
            {pkg?.lock?.locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
          </div>
          <p className="text-xs text-slate-400">Page {pageInfo.page} of {pageInfo.total}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => handleDownload('pdf')} disabled={downloading} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
            {downloading === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} PDF
          </button>
          <button type="button" onClick={() => handleDownload('word')} disabled={downloading} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
            {downloading === 'word' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Word
          </button>
          {canFinalize && !pkg?.lock?.locked && pkg?.status !== 'filed' && (
            <button type="button" onClick={() => setShowFinalize(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              <ShieldCheck className="h-4 w-4" /> Finalize
            </button>
          )}
          {canFinalize && pkg?.lock?.locked && pkg?.status !== 'filed' && (
            <button type="button" onClick={() => setShowUnlock(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              <UnlockIcon className="h-4 w-4" /> Unlock
            </button>
          )}
          {canFinalize && (pkg?.status === 'finalized' || pkg?.status === 'filed') && (
            <button type="button" onClick={() => setShowFiling(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700">
              <Truck className="h-4 w-4" /> {pkg?.status === 'filed' ? 'Filing Details' : 'Record Filing'}
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-800 p-2 text-slate-200 hover:bg-slate-700" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {conflict && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> This petition was updated — reload to see the latest.</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { dismissConflict(); reload() }} className="btn-secondary !py-1 !px-3 text-xs">Reload</button>
            <button type="button" onClick={dismissConflict} className="text-amber-700 hover:text-amber-900">Dismiss</button>
          </div>
        </div>
      )}
      {actionError && (
        <div className="bg-red-50 px-5 py-2 text-sm text-red-700">{actionError}</div>
      )}

      <div className="flex min-h-0 flex-1 bg-white">
        {loading && (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-1 items-center justify-center text-sm text-red-600">{error}</div>
        )}
        {!loading && !error && pkg && (
          <>
            <PetitionOutline
              pkg={pkg}
              validation={validation}
              activeSectionKey={activeSectionKey}
              onJump={handleJump}
              onReorderExhibits={reorderExhibits}
              disabled={disabled}
            />
            <div className="min-w-0 flex-1 overflow-y-auto">
              <PetitionCanvas
                ref={canvasRef}
                caseId={caseId}
                pkg={pkg}
                validation={validation}
                presentationOrdering={definition?.ordering?.presentation}
                disabled={disabled}
                onEditLetter={saveLetter}
                saveStates={saveStates}
                onScrollSpy={handleScrollSpy}
              />
            </div>
            <ValidationPanel validation={validation} onJump={handleJump} />
          </>
        )}
      </div>

      {showFinalize && (
        <FinalizeModal validation={validation} onCancel={() => setShowFinalize(false)} onConfirm={handleFinalize} />
      )}
      {showUnlock && (
        <UnlockModal onCancel={() => setShowUnlock(false)} onConfirm={handleUnlock} />
      )}
      {showFiling && pkg && (
        <FilingForm pkg={pkg} onCancel={() => setShowFiling(false)} onRecordFiling={handleRecordFiling} onRecordReceipt={handleRecordReceipt} />
      )}
    </div>
  )
}
