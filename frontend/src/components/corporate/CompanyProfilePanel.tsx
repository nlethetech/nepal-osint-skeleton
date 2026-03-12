import type { ReactNode } from 'react'
import { Button, Card, Intent, Section, SectionCard, Tag } from '@blueprintjs/core'
import { type CompanyDetail } from '../../api/corporate'

function irdStatusIntent(status: string | null): Intent {
  if (!status) return Intent.NONE
  if (status === 'A' || status === 'Active') return Intent.SUCCESS
  if (status.startsWith('Non-filer')) return Intent.WARNING
  if (status === 'D' || status === 'Deactivated') return Intent.DANGER
  return Intent.NONE
}

function formatNpr(value: number | null | undefined): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('en-NP', {
    style: 'currency',
    currency: 'NPR',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  return value.slice(0, 10)
}

interface CompanyProfilePanelProps {
  detail: CompanyDetail
  onPANClick: (pan: string) => void
  onOpenProcurement?: (companyName: string) => void
}

interface ProfileKVRow {
  label: string
  value: ReactNode
  mono?: boolean
}

function ProfileKV({ rows }: { rows: ProfileKVRow[] }) {
  return (
    <dl className="company-profile-kv">
      {rows.map((row, index) => (
        <div key={`${row.label}-${index}`} className="company-profile-kv-row">
          <dt className="company-profile-label">{row.label}</dt>
          <dd className={`company-profile-value ${row.mono ? 'company-profile-mono' : ''}`}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CompanyProfilePanel({
  detail,
  onPANClick,
  onOpenProcurement,
}: CompanyProfilePanelProps) {
  const directorCount = detail.director_count ?? detail.directors?.length ?? 0
  const linkedCompanyCount = detail.linked_company_count ?? 0
  const govtContractCount = detail.govt_contract_count ?? 0
  const govtContractValue = formatNpr(detail.govt_contract_total_npr)
  const procurementSummary = detail.govt_procurement_summary
  const procuringEntities = procurementSummary?.procuring_entities ?? []
  const procurementContracts = procurementSummary?.contracts ?? []
  const registrationType = detail.company_type_category || detail.company_type || 'Unclassified'
  const locationLabel = [detail.district, detail.province].filter(Boolean).join(' / ') || 'Unknown district'

  return (
    <div className="company-profile-panel">
      <div className="company-profile-hero">
        <p className="company-profile-eyebrow">Entity Dossier</p>
        <h3 className="company-profile-heading text-lg font-semibold">{detail.name_english}</h3>
        {detail.name_nepali && (
          <p className="company-profile-subheading text-sm mt-0.5">{detail.name_nepali}</p>
        )}
        <div className="company-profile-hero-meta">
          <Tag minimal className="company-profile-chip company-profile-chip-primary">
            {registrationType}
          </Tag>
          <Tag minimal className="company-profile-chip">
            {locationLabel}
          </Tag>
          <Tag minimal className="company-profile-chip">
            Reg #{detail.registration_number.toLocaleString()}
          </Tag>
        </div>
      </div>

      <div className="company-profile-kpi-strip">
        <div className="company-profile-kpi-card">
          <span className="company-profile-kpi-label">Directors</span>
          <span className="company-profile-kpi-value">{directorCount}</span>
        </div>
        <div className="company-profile-kpi-card">
          <span className="company-profile-kpi-label">Linked Cos.</span>
          <span className="company-profile-kpi-value">{linkedCompanyCount}</span>
        </div>
        <div className="company-profile-kpi-card">
          <span className="company-profile-kpi-label">Contracts</span>
          <span className="company-profile-kpi-value">{govtContractCount}</span>
        </div>
        <div className="company-profile-kpi-card">
          <span className="company-profile-kpi-label">Total Value</span>
          <span className="company-profile-kpi-value company-profile-kpi-value--currency">{govtContractValue}</span>
        </div>
      </div>

      <Section title="Registration" collapsible>
        <SectionCard>
          <ProfileKV
            rows={[
              { label: 'Reg Number', value: detail.registration_number.toLocaleString(), mono: true },
              { label: 'Type', value: detail.company_type_category || detail.company_type || '-' },
              { label: 'Address', value: detail.company_address || '-' },
              { label: 'District', value: detail.district || '-' },
              { label: 'Province', value: detail.province || '-' },
              { label: 'Reg Date (BS)', value: detail.registration_date_bs || '-', mono: true },
              { label: 'Reg Date (AD)', value: detail.registration_date_ad || '-', mono: true },
            ]}
          />
        </SectionCard>
      </Section>

      <Section title="PAN & Tax" collapsible>
        <SectionCard>
          <ProfileKV
            rows={[
              {
                label: 'PAN',
                value: detail.pan ? (
                  <Tag
                    intent={Intent.PRIMARY}
                    minimal
                    interactive
                    onClick={() => onPANClick(detail.pan!)}
                    className="cursor-pointer font-mono company-profile-chip company-profile-chip-primary"
                  >
                    {detail.pan}
                  </Tag>
                ) : '-',
              },
              {
                label: 'IRD Status',
                value: (
                  <Tag intent={irdStatusIntent(detail.ird_status)} minimal className="company-profile-chip">
                    {detail.ird_status || 'Not checked'}
                  </Tag>
                ),
              },
              { label: 'IRD Taxpayer', value: detail.ird_taxpayer_name || '-' },
            ]}
          />
        </SectionCard>
      </Section>

      {detail.ird && (
        <Section title="IRD Enrichment" collapsible>
          <SectionCard>
            <ProfileKV
              rows={[
                { label: 'Account Type', value: detail.ird.account_type || '-' },
                { label: 'Tax Office', value: detail.ird.tax_office || '-' },
                { label: 'Filing Period', value: detail.ird.filing_period || '-' },
                { label: 'Ward', value: detail.ird.ward_no || '-' },
                { label: 'VDC/Municipality', value: detail.ird.vdc_municipality || '-' },
                {
                  label: 'Tax Clearance',
                  value: (
                    <Tag intent={detail.ird.tax_clearance_verified ? Intent.SUCCESS : Intent.WARNING} minimal className="company-profile-chip">
                      {detail.ird.latest_tax_clearance_fy || 'None'}
                    </Tag>
                  ),
                },
              ]}
            />
          </SectionCard>
        </Section>
      )}

      <Section title="Network Summary" collapsible>
        <SectionCard>
          <ProfileKV
            rows={[
              { label: 'Directors', value: directorCount, mono: true },
              { label: 'Linked Companies', value: linkedCompanyCount, mono: true },
            ]}
          />
        </SectionCard>
      </Section>

      <Section
        title="Govt Procurement Summary"
        collapsible
        rightElement={
          onOpenProcurement ? (
            <Button
              small
              minimal
              icon="share"
              text="Open Detail"
              onClick={() => onOpenProcurement(detail.name_english)}
            />
          ) : undefined
        }
      >
        <SectionCard>
          <ProfileKV
            rows={[
              { label: 'Contract Count', value: govtContractCount, mono: true },
              { label: 'Total Value', value: govtContractValue, mono: true },
            ]}
          />
          {procuringEntities.length > 0 && (
            <div className="mt-3">
              <p className="company-profile-label text-xs mb-1">Top Procuring Organizations</p>
              <div className="space-y-1">
                {procuringEntities.slice(0, 8).map((entity, idx) => (
                  <div key={`${entity.name}-${idx}`} className="flex items-center justify-between text-xs company-profile-subheading">
                    <span className="truncate pr-3">{entity.name}</span>
                    <span className="company-profile-mono whitespace-nowrap">
                      {entity.contract_count} • {formatNpr(entity.total_value_npr)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {procurementContracts.length > 0 && (
            <div className="mt-3">
              <p className="company-profile-label text-xs mb-1">Recent Contracts</p>
              <div className="space-y-2">
                {procurementContracts.slice(0, 12).map((contract) => (
                  <Card key={contract.id} className="p-2 company-profile-director-card">
                    <p className="text-sm font-medium company-profile-value">
                      {contract.project_name || contract.ifb_number || 'Contract'}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs company-profile-subheading">
                      <span>Entity: {contract.procuring_entity || '-'}</span>
                      <span>Type: {contract.procurement_type || '-'}</span>
                      <span>Date: {formatDate(contract.contract_award_date)}</span>
                      <span>Amount: {formatNpr(contract.contract_amount_npr)}</span>
                      {contract.fiscal_year_bs && <span>FY: {contract.fiscal_year_bs}</span>}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          {govtContractCount > 0 && procuringEntities.length === 0 && procurementContracts.length === 0 && (
            <p className="company-profile-subheading text-xs mt-2">
              Contract totals available, detailed contract rows are still loading from procurement linkage.
            </p>
          )}
        </SectionCard>
      </Section>

      <Section title="Enrichment Status" collapsible>
        <SectionCard>
          <div className="flex flex-wrap gap-2">
            <Tag intent={detail.camis_enriched ? Intent.SUCCESS : Intent.NONE} minimal className="company-profile-chip">
              CAMIS {detail.camis_enriched ? 'Done' : 'Pending'}
            </Tag>
            <Tag intent={detail.ird_enriched ? Intent.SUCCESS : Intent.NONE} minimal className="company-profile-chip">
              IRD {detail.ird_enriched ? 'Done' : 'Pending'}
            </Tag>
          </div>
          {detail.camis_enriched_at && (
            <p className="company-profile-subheading text-xs mt-1">CAMIS enriched: {detail.camis_enriched_at}</p>
          )}
          {detail.ird_enriched_at && (
            <p className="company-profile-subheading text-xs mt-1">IRD enriched: {detail.ird_enriched_at}</p>
          )}
        </SectionCard>
      </Section>

      {detail.directors && detail.directors.length > 0 && (
        <Section
          title="Directors"
          collapsible
          rightElement={<Tag minimal>{detail.directors.length}</Tag>}
        >
          <SectionCard>
            <div className="space-y-2">
              {detail.directors.map((d) => (
                <Card key={d.id} className="p-2 company-profile-director-card">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium company-profile-value">{d.name_en}</p>
                      {d.name_np && <p className="text-xs company-profile-subheading">{d.name_np}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {d.role && <Tag minimal className="text-xs company-profile-chip">{d.role}</Tag>}
                      {d.pan && (
                        <Tag
                          intent={Intent.PRIMARY}
                          minimal
                          interactive
                          onClick={() => onPANClick(d.pan!)}
                          className="cursor-pointer font-mono text-xs company-profile-chip company-profile-chip-primary"
                        >
                          {d.pan}
                        </Tag>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-3 mt-1 text-xs company-profile-subheading">
                    <span>Source: {d.source}</span>
                    <span>Confidence: {(d.confidence * 100).toFixed(0)}%</span>
                    {d.appointed_date && <span>Appointed: {d.appointed_date}</span>}
                  </div>
                </Card>
              ))}
            </div>
          </SectionCard>
        </Section>
      )}
    </div>
  )
}
