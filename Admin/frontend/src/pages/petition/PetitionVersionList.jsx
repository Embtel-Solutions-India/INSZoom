import PetitionUploadPanel from './PetitionUploadPanel'

// The Petition tab of a case. It shows ONLY the petition area (upload, attorney review / client review, the client's feedback). The list of auto-assembled petition versions that used
// to sit under it (v1, "needs revision", ...) belonged to an older petition flow that is no longer used, so it is no longer shown and no longer fetched. The assembled-package viewer
// itself (PetitionViewer, reached through `onOpen`) is left in the code untouched.
export default function PetitionVersionList({ caseId, canAssemble }) {
  return (
    <div className="space-y-4">
      <PetitionUploadPanel caseId={caseId} canUpload={canAssemble} />
    </div>
  )
}
