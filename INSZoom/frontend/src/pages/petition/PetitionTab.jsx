import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import PetitionVersionList from './PetitionVersionList'
import PetitionViewer from './PetitionViewer'

// Entry point for the Petition sub-tab (Cases › [case] › Petition). Owns the
// ?tab=petition&pkg=:packageId deep link — never a standalone route — and
// switches between the version list (Level 1) and the full-screen version
// viewer (Level 2) based on whether a package is open.
export default function PetitionTab({ caseId }) {
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const normalizedRole = String(user?.role || '').toLowerCase().replace(/[\s-]+/g, '_')
  const canAssemble = ['super_admin', 'admin', 'team_lead', 'case_manager'].includes(normalizedRole)

  const [openPackageId, setOpenPackageId] = useState(() => new URLSearchParams(location.search).get('pkg') || '')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    setOpenPackageId(params.get('pkg') || '')
  }, [location.search])

  const openPackage = (packageId) => {
    const params = new URLSearchParams(location.search)
    params.set('tab', 'petition')
    params.set('pkg', packageId)
    navigate({ search: params.toString() }, { replace: true })
    setOpenPackageId(packageId)
  }

  const closePackage = () => {
    const params = new URLSearchParams(location.search)
    params.set('tab', 'petition')
    params.delete('pkg')
    navigate({ search: params.toString() }, { replace: true })
    setOpenPackageId('')
    setRefreshKey((k) => k + 1)
  }

  if (openPackageId) {
    return <PetitionViewer caseId={caseId} packageId={openPackageId} onClose={closePackage} onChanged={() => setRefreshKey((k) => k + 1)} />
  }

  return <PetitionVersionList key={refreshKey} caseId={caseId} canAssemble={canAssemble} onOpen={openPackage} />
}
