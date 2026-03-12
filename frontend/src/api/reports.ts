/**
 * Report Generation API client
 * Downloads PDF reports from the NARADA backend as blobs.
 */
import { apiClient } from './client'

/**
 * Internal helper: fetches a PDF from the given URL and triggers
 * a browser download with the supplied filename.
 */
async function downloadPDF(url: string, fallbackFilename: string): Promise<void> {
  const response = await apiClient.get(url, {
    responseType: 'blob',
  })

  // Extract filename from Content-Disposition header if available
  const disposition = response.headers['content-disposition'] as string | undefined
  let filename = fallbackFilename
  if (disposition) {
    const match = disposition.match(/filename="?([^";\n]+)"?/)
    if (match?.[1]) {
      filename = match[1]
    }
  }

  // Create a temporary download link
  const blob = new Blob([response.data], { type: 'application/pdf' })
  const blobUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = blobUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()

  // Cleanup
  window.URL.revokeObjectURL(blobUrl)
  document.body.removeChild(anchor)
}

/**
 * Download a PDF entity dossier for a company.
 */
export async function downloadEntityReport(companyId: string): Promise<void> {
  return downloadPDF(
    `/reports/corporate/entity/${companyId}`,
    `entity_dossier_${companyId}.pdf`,
  )
}

/**
 * Download a PDF PAN investigation report.
 */
export async function downloadPANReport(pan: string): Promise<void> {
  return downloadPDF(
    `/reports/corporate/pan/${pan}`,
    `pan_investigation_${pan}.pdf`,
  )
}

/**
 * Download a PDF corporate risk summary report.
 */
export async function downloadRiskReport(): Promise<void> {
  const now = new Date().toISOString().slice(0, 16).replace(/[:-]/g, '')
  return downloadPDF(
    '/reports/corporate/risk-summary',
    `risk_summary_${now}.pdf`,
  )
}
