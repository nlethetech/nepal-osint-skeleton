/**
 * ReportButtons -- PDF export buttons for Corporate Intelligence views.
 *
 * Three modes:
 *   - type="entity"  : downloads an Entity Dossier PDF (requires entityId)
 *   - type="pan"     : downloads a PAN Investigation PDF (requires pan)
 *   - type="risk"    : downloads the full Corporate Risk Summary PDF
 *
 * Uses Blueprint Button with a download icon and loading spinner while
 * the backend generates the PDF. Errors are surfaced via an inline
 * status indicator (no external toaster dependency).
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { Button, Intent, Tag } from '@blueprintjs/core'
import {
  downloadEntityReport,
  downloadPANReport,
  downloadRiskReport,
} from '../../api/reports'

interface ReportButtonsProps {
  /** Which report type to generate. */
  type: 'entity' | 'pan' | 'risk'
  /** Company UUID -- required when type is "entity". */
  entityId?: string
  /** PAN string -- required when type is "pan". */
  pan?: string
  /** If true, render a minimal/small button variant. */
  minimal?: boolean
  /** Override button label text. */
  label?: string
}

const DEFAULT_LABELS: Record<string, string> = {
  entity: 'Export Dossier PDF',
  pan: 'Export PAN Report',
  risk: 'Export Risk Summary',
}

type Status = 'idle' | 'loading' | 'success' | 'error'

export function ReportButtons({
  type,
  entityId,
  pan,
  minimal = false,
  label,
}: ReportButtonsProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear status message after delay
  useEffect(() => {
    if (status === 'success' || status === 'error') {
      timerRef.current = setTimeout(() => setStatus('idle'), 4000)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [status])

  const handleDownload = useCallback(async () => {
    setStatus('loading')
    setErrorMsg('')
    try {
      switch (type) {
        case 'entity':
          if (!entityId) return
          await downloadEntityReport(entityId)
          break
        case 'pan':
          if (!pan) return
          await downloadPANReport(pan)
          break
        case 'risk':
          await downloadRiskReport()
          break
      }
      setStatus('success')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate report.'
      setErrorMsg(message)
      setStatus('error')
    }
  }, [type, entityId, pan])

  const buttonLabel = label ?? DEFAULT_LABELS[type] ?? 'Export PDF'

  // Disable if the required ID is missing
  const disabled =
    (type === 'entity' && !entityId) || (type === 'pan' && !pan)

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        icon="document"
        rightIcon="download"
        text={buttonLabel}
        intent={Intent.PRIMARY}
        loading={status === 'loading'}
        disabled={disabled}
        onClick={handleDownload}
        minimal={minimal}
        small={minimal}
      />
      {status === 'success' && (
        <Tag intent={Intent.SUCCESS} icon="tick-circle" minimal round>
          Downloaded
        </Tag>
      )}
      {status === 'error' && (
        <Tag intent={Intent.DANGER} icon="error" minimal round title={errorMsg}>
          Failed
        </Tag>
      )}
    </span>
  )
}
