import { useAnalystCenterStore } from '../../../stores/analystCenterStore'
import { CaseInvestigationPanel } from '../../cases/CaseInvestigationPanel'

export function InvestigationTab() {
  const { selectedCaseId, setSelectedCase, setActiveTab } = useAnalystCenterStore()

  return (
    <CaseInvestigationPanel
      caseId={selectedCaseId}
      onCloseCase={() => {
        setSelectedCase(null)
        setActiveTab('collaboration')
      }}
      onRequestSelectCase={() => setActiveTab('collaboration')}
    />
  )
}

