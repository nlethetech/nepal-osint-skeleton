/**
 * CompanyExplorer — Blueprint Table2 virtual-scrolled company browser
 * Renders 341K+ company registrations with server-side pagination,
 * PAN click-through, IRD status color-coding, and context menus.
 */
import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  Table2,
  Column,
  Cell,
  ColumnHeaderCell,
  TruncatedFormat,
  RegionCardinality,
} from '@blueprintjs/table'
import {
  Tag,
  Intent,
  InputGroup,
  Button,
  ButtonGroup,
  Spinner,
  NonIdealState,
  HTMLSelect,
  Menu,
  MenuItem,
  MenuDivider,
  Drawer,
  // ContextMenu is not needed — Table2 has bodyContextMenuRenderer
  DrawerSize,
  Section,
  SectionCard,
  Card,
  Icon,
  Classes,
  Tooltip,
} from '@blueprintjs/core'
import { useQuery } from '@tanstack/react-query'
import {
  searchCompanies,
  getCompanyDetail,
  getCorporateStats,
  investigatePAN,
  type CompanySearchParams,
  type PANInvestigation,
} from '../../api/corporate'
import { DataValueGrid, NoPanBadge } from '../../components/ui/narada-ui'
import { CompanyProfilePanel } from './CompanyProfilePanel'

// ── Helpers ──────────────────────────────────────────────────

function irdStatusIntent(status: string | null): Intent {
  if (!status) return Intent.NONE
  if (status === 'A' || status === 'Active') return Intent.SUCCESS
  if (status.startsWith('Non-filer')) return Intent.WARNING
  if (status === 'D' || status === 'Deactivated') return Intent.DANGER
  return Intent.NONE
}

function irdStatusLabel(status: string | null): string {
  if (!status) return 'Not checked'
  if (status.length > 25) return status.substring(0, 25) + '...'
  return status
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return dateStr
}

function formatNprCompact(value: number | null | undefined): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('en-NP', {
    style: 'currency',
    currency: 'NPR',
    maximumFractionDigits: 0,
  }).format(value)
}

// ── Types ──────────────────────────────────────────────────

interface CompanyExplorerProps {
  onPANClick?: (pan: string) => void
  onCompanyClick?: (id: string) => void
}

// ── Component ──────────────────────────────────────────────

export function CompanyExplorer({ onPANClick, onCompanyClick }: CompanyExplorerProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [district, setDistrict] = useState<string>('')
  const [typeCategory, setTypeCategory] = useState<string>('')
  const [irdStatus, setIrdStatus] = useState<string>('')
  const [hasPan, setHasPan] = useState<boolean | undefined>(undefined)
  const [hasCluster, setHasCluster] = useState<boolean | undefined>(undefined)
  const [sortField, setSortField] = useState<string>('registration_number')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [limit] = useState(100)

  // Detail drawer
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [panInvestigation, setPanInvestigation] = useState<string | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Build search params
  const searchParams: CompanySearchParams = useMemo(() => ({
    q: debouncedQuery || undefined,
    district: district || undefined,
    company_type_category: typeCategory || undefined,
    ird_status: irdStatus || undefined,
    has_pan: hasPan,
    has_cluster: hasCluster,
    sort: sortField,
    sort_dir: sortDir,
    page,
    limit,
  }), [debouncedQuery, district, typeCategory, irdStatus, hasPan, hasCluster, sortField, sortDir, page, limit])

  // Queries
  const { data: statsData } = useQuery({
    queryKey: ['corporate-stats'],
    queryFn: getCorporateStats,
    staleTime: 60_000,
  })

  const { data: searchData, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ['corporate-companies', searchParams],
    queryFn: () => searchCompanies(searchParams),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  })

  const companies = searchData?.items ?? []
  const totalResults = searchData?.total ?? 0
  const totalPages = searchData?.pages ?? 0

  // Company detail drawer
  const { data: companyDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['corporate-company', selectedCompanyId],
    queryFn: () => getCompanyDetail(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  })

  // PAN investigation drawer
  const { data: panData, isLoading: panLoading } = useQuery({
    queryKey: ['pan-investigation', panInvestigation],
    queryFn: () => investigatePAN(panInvestigation!),
    enabled: !!panInvestigation,
  })

  // Handlers
  const handlePANClick = useCallback((pan: string) => {
    if (onPANClick) {
      onPANClick(pan)
    } else {
      setPanInvestigation(pan)
    }
  }, [onPANClick])

  const handleCompanyClick = useCallback((id: string) => {
    if (onCompanyClick) {
      onCompanyClick(id)
    } else {
      setSelectedCompanyId(id)
    }
  }, [onCompanyClick])

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
    setPage(1)
  }, [sortField])

  // Context menu
  const renderContextMenu = useCallback((rowIndex: number) => {
    const company = companies[rowIndex]
    if (!company) return null
    return (
      <Menu>
        <MenuItem
          icon="document-open"
          text="View Details"
          onClick={() => handleCompanyClick(company.id)}
        />
        {company.pan && (
          <MenuItem
            icon="search"
            text={`Investigate PAN ${company.pan}`}
            onClick={() => handlePANClick(company.pan!)}
          />
        )}
        <MenuItem icon="graph" text="Open in Graph" disabled />
        <MenuItem icon="add-to-folder" text="Add to Case" disabled />
        <MenuDivider />
        <MenuItem icon="export" text="Export Record" disabled />
      </Menu>
    )
  }, [companies, handleCompanyClick, handlePANClick])

  // ── Cell Renderers ──────────────────────────────────────

  const companyNameRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <span
          className="cursor-pointer hover:underline text-bp-primary-hover"
          onClick={() => handleCompanyClick(c.id)}
        >
          <TruncatedFormat detectTruncation>{c.name_english}</TruncatedFormat>
        </span>
      </Cell>
    )
  }, [companies, handleCompanyClick])

  const panRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        {c.pan ? (
          <Tag
            intent={Intent.PRIMARY}
            minimal
            interactive
            onClick={() => handlePANClick(c.pan!)}
            className="cursor-pointer font-mono text-xs"
          >
            {c.pan}
          </Tag>
        ) : (
          <NoPanBadge />
        )}
      </Cell>
    )
  }, [companies, handlePANClick])

  const irdStatusRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <Tag
          intent={irdStatusIntent(c.ird_status)}
          minimal
          className="text-xs"
        >
          {irdStatusLabel(c.ird_status)}
        </Tag>
      </Cell>
    )
  }, [companies])

  const typeRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <TruncatedFormat detectTruncation>
          {c.company_type_category || c.company_type || '-'}
        </TruncatedFormat>
      </Cell>
    )
  }, [companies])

  const districtRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <TruncatedFormat detectTruncation>{c.district || '-'}</TruncatedFormat>
      </Cell>
    )
  }, [companies])

  const regDateRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>{formatDate(c.registration_date_bs)}</Cell>
    )
  }, [companies])

  const directorsRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        {(c.director_count ?? 0) > 0 ? (
          <Tag minimal intent={Intent.NONE} className="text-xs">
            {c.director_count ?? 0}
          </Tag>
        ) : '-'}
      </Cell>
    )
  }, [companies])

  const linkedCompaniesRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <Tag minimal intent={Intent.NONE} className="text-xs">
          {c.linked_company_count ?? 0}
        </Tag>
      </Cell>
    )
  }, [companies])

  const govtContractsRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <Tooltip
          content={`Total value: ${formatNprCompact(c.govt_contract_total_npr)}`}
          placement="top"
        >
          <Tag minimal intent={Intent.PRIMARY} className="text-xs">
            {c.govt_contract_count ?? 0}
          </Tag>
        </Tooltip>
      </Cell>
    )
  }, [companies])

  const enrichmentRenderer = useCallback((rowIndex: number) => {
    const c = companies[rowIndex]
    if (!c) return <Cell loading />
    return (
      <Cell>
        <span className="flex gap-1">
          {c.camis_enriched && (
            <Tag minimal intent={Intent.SUCCESS} className="text-[10px]">CAMIS</Tag>
          )}
          {c.ird_enriched && (
            <Tag minimal intent={Intent.PRIMARY} className="text-[10px]">IRD</Tag>
          )}
          {!c.camis_enriched && !c.ird_enriched && (
            <span className="text-bp-text-muted text-xs">-</span>
          )}
        </span>
      </Cell>
    )
  }, [companies])

  // ── Sort Header ──────────────────────────────────────

  const sortableHeader = useCallback((name: string, field: string) => {
    const isActive = sortField === field
    return (
      <ColumnHeaderCell
        name={name}
        nameRenderer={() => (
          <span
            className="cursor-pointer select-none flex items-center gap-1"
            onClick={() => handleSort(field)}
          >
            {name}
            {isActive && (
              <Icon
                icon={sortDir === 'asc' ? 'sort-asc' : 'sort-desc'}
                size={12}
                className="opacity-70"
              />
            )}
          </span>
        )}
      />
    )
  }, [sortField, sortDir, handleSort])

  // ── Render ──────────────────────────────────────────────

  return (
    <div className={`${Classes.DARK} flex flex-col h-full`}>
      {/* Stats Bar */}
      {statsData && (
        <div className="flex items-center gap-4 px-4 py-2 bg-bp-card border-b border-bp-border text-xs">
          <span className="text-bp-text-muted">
            Total: <span className="text-bp-text font-mono">{statsData.total_companies.toLocaleString()}</span>
          </span>
          <span className="text-bp-text-muted">
            With PAN: <span className="text-bp-text font-mono">{statsData.companies_with_pan.toLocaleString()}</span>
          </span>
          <span className="text-bp-text-muted">
            CAMIS: <span className="text-bp-success font-mono">{statsData.camis_enriched_count.toLocaleString()}</span>
          </span>
          <span className="text-bp-text-muted">
            IRD: <span className="text-bp-primary font-mono">{statsData.ird_enriched_count.toLocaleString()}</span>
          </span>
          <span className="text-bp-text-muted">
            Directors: <span className="text-bp-text font-mono">{statsData.total_directors.toLocaleString()}</span>
          </span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-bp-card border-b border-bp-border">
        <InputGroup
          leftIcon="search"
          placeholder="Search companies by name, PAN, or registration number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1"
          small
        />

        <HTMLSelect
          value={typeCategory}
          onChange={(e) => { setTypeCategory(e.target.value); setPage(1) }}
          options={[
            { value: '', label: 'All Types' },
            { value: 'Private Limited', label: 'Private Ltd' },
            { value: 'Public Limited', label: 'Public Ltd' },
            { value: 'Partnership', label: 'Partnership' },
            { value: 'Sole Proprietorship', label: 'Sole Prop' },
            { value: 'Non-Profit', label: 'Non-Profit' },
          ]}
          minimal
        />

        <HTMLSelect
          value={irdStatus}
          onChange={(e) => { setIrdStatus(e.target.value); setPage(1) }}
          options={[
            { value: '', label: 'IRD Status' },
            { value: 'A', label: 'Active' },
            { value: 'Non-filer', label: 'Non-filer' },
            { value: 'D', label: 'Deactivated' },
          ]}
          minimal
        />

        <ButtonGroup minimal>
          <Button
            small
            active={hasPan === true}
            onClick={() => { setHasPan(hasPan === true ? undefined : true); setPage(1) }}
            text="Has PAN"
            className={`border border-bp-border-strong ${hasPan === true ? 'bg-bp-surface text-bp-text' : 'text-bp-text-secondary'}`}
          />
          <Button
            small
            active={hasPan === false}
            onClick={() => { setHasPan(hasPan === false ? undefined : false); setPage(1) }}
            text="No PAN"
            className={`border border-bp-border-strong ${hasPan === false ? 'bg-bp-surface text-bp-text' : 'text-bp-text-secondary'}`}
          />
        </ButtonGroup>

        <ButtonGroup minimal>
          <Button
            small
            active={hasCluster === true}
            onClick={() => { setHasCluster(hasCluster === true ? undefined : true); setPage(1) }}
            text="In Clusters"
            icon="link"
            className={`border border-bp-border-strong ${hasCluster === true ? 'bg-bp-surface text-bp-text' : 'text-bp-text-secondary'}`}
          />
          <Button
            small
            active={hasCluster === false}
            onClick={() => { setHasCluster(hasCluster === false ? undefined : false); setPage(1) }}
            text="Unique"
            icon="circle"
            className={`border border-bp-border-strong ${hasCluster === false ? 'bg-bp-surface text-bp-text' : 'text-bp-text-secondary'}`}
          />
        </ButtonGroup>

        {isFetching && <Spinner size={16} />}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size={40} />
          </div>
        ) : isError ? (
          <NonIdealState
            icon="error"
            title="Unable to load companies"
            description={error instanceof Error ? error.message : 'Request failed. Please retry.'}
          />
        ) : companies.length === 0 ? (
          <NonIdealState
            icon="search"
            title="No companies found"
            description="Try adjusting your search filters."
          />
        ) : (
            <Table2
              numRows={companies.length}
              enableColumnResizing
              enableRowResizing={false}
              enableMultipleSelection
              selectionModes={[RegionCardinality.FULL_ROWS]}
              cellRendererDependencies={[companies, sortField, sortDir]}
              defaultRowHeight={32}
              bodyContextMenuRenderer={(_context) => {
                // Use first selected row for context menu
                const row = (_context as any)?.target?.closest('[class*="row"]')?.dataset?.rowIndex
                const idx = row !== undefined ? parseInt(row, 10) : 0
                return renderContextMenu(idx) ?? <Menu />
              }}
            >
              <Column
                name="Company"
                cellRenderer={companyNameRenderer}
                columnHeaderCellRenderer={() => sortableHeader('Company', 'name_english')}
              />
              <Column
                name="PAN"
                cellRenderer={panRenderer}
                columnHeaderCellRenderer={() => sortableHeader('PAN', 'pan')}
              />
              <Column
                name="IRD Status"
                cellRenderer={irdStatusRenderer}
                columnHeaderCellRenderer={() => sortableHeader('IRD Status', 'ird_status')}
              />
              <Column
                name="Type"
                cellRenderer={typeRenderer}
                columnHeaderCellRenderer={() => sortableHeader('Type', 'company_type_category')}
              />
              <Column
                name="District"
                cellRenderer={districtRenderer}
                columnHeaderCellRenderer={() => sortableHeader('District', 'district')}
              />
              <Column
                name="Reg Date (BS)"
                cellRenderer={regDateRenderer}
                columnHeaderCellRenderer={() => sortableHeader('Reg Date', 'registration_date_bs')}
              />
              <Column
                name="Directors"
                cellRenderer={directorsRenderer}
                columnHeaderCellRenderer={() => sortableHeader('Directors', 'director_count')}
              />
              <Column
                name="Linked Companies"
                cellRenderer={linkedCompaniesRenderer}
                columnHeaderCellRenderer={() => <ColumnHeaderCell name="Linked Companies" />}
              />
              <Column
                name="Govt Contracts"
                cellRenderer={govtContractsRenderer}
                columnHeaderCellRenderer={() => <ColumnHeaderCell name="Govt Contracts" />}
              />
              <Column
                name="Enrichment"
                cellRenderer={enrichmentRenderer}
              />
            </Table2>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-2 bg-bp-card border-t border-bp-border text-xs">
        <span className="text-bp-text-muted">
          Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, totalResults)} of{' '}
          <span className="text-bp-text font-mono">{totalResults.toLocaleString()}</span> results
        </span>
        <ButtonGroup minimal>
          <Button
            small
            icon="chevron-left"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          />
          <Button small text={`${page} / ${totalPages}`} disabled />
          <Button
            small
            icon="chevron-right"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          />
        </ButtonGroup>
      </div>

      {/* Company Detail Drawer */}
      <Drawer
        isOpen={!!selectedCompanyId}
        onClose={() => setSelectedCompanyId(null)}
        size={DrawerSize.STANDARD}
        title="Company Profile"
        hasBackdrop={false}
        className="company-profile-drawer"
      >
        {detailLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size={40} />
          </div>
        ) : companyDetail ? (
          <CompanyProfilePanel
            detail={companyDetail}
            onPANClick={handlePANClick}
          />
        ) : null}
      </Drawer>

      {/* PAN Investigation Drawer */}
      <Drawer
        isOpen={!!panInvestigation}
        onClose={() => setPanInvestigation(null)}
        size={DrawerSize.LARGE}
        title={`PAN Investigation: ${panInvestigation}`}
        hasBackdrop={false}
        className={`${Classes.DARK} corporate-profile-drawer`}
      >
        {panLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size={40} />
          </div>
        ) : panData ? (
          <PANInvestigationDrawer
            data={panData}
            onCompanyClick={handleCompanyClick}
          />
        ) : null}
      </Drawer>
    </div>
  )
}

// ── PAN Investigation Drawer Content ──────────────────────

function PANInvestigationDrawer({
  data,
  onCompanyClick,
}: {
  data: PANInvestigation
  onCompanyClick: (id: string) => void
}) {
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Tag large intent={Intent.PRIMARY} className="font-mono">{data.pan}</Tag>
        {data.ird && (
          <Tag intent={irdStatusIntent(data.ird.account_status)} minimal>
            {data.ird.account_status || 'Unknown'}
          </Tag>
        )}
      </div>

      {/* IRD Info */}
      {data.ird && (
        <Section title="IRD Information" collapsible>
          <SectionCard>
            <DataValueGrid
              className="corporate-drawer-grid"
              valueColorClassName="corporate-drawer-value"
              rows={[
                { label: 'Taxpayer (EN)', value: data.ird.taxpayer_name_en || '-' },
                { label: 'Taxpayer (NP)', value: data.ird.taxpayer_name_np || '-' },
                { label: 'Account Type', value: data.ird.account_type || '-' },
                { label: 'Tax Office', value: data.ird.tax_office || '-' },
                { label: 'Ward', value: data.ird.ward_no || '-' },
                { label: 'VDC/Municipality', value: data.ird.vdc_municipality || '-' },
              ]}
            />
          </SectionCard>
        </Section>
      )}

      {/* Companies */}
      <Section
        title="Registered Companies"
        collapsible
        rightElement={<Tag minimal>{data.companies.length}</Tag>}
      >
        <SectionCard>
          <div className="space-y-2">
            {data.companies.map((c) => (
              <Card
                key={c.id}
                interactive
                onClick={() => onCompanyClick(c.id)}
                className="p-3"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-bp-primary-hover">{c.name_english}</p>
                    <p className="text-xs text-bp-text-muted mt-0.5">
                      {c.company_type_category || c.company_type} &middot; {c.district || 'Unknown district'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tag intent={irdStatusIntent(c.ird_status)} minimal className="text-xs">
                      {c.ird_status || '-'}
                    </Tag>
                    {(c.director_count ?? 0) > 0 && (
                      <Tag minimal className="text-xs">{c.director_count ?? 0} dirs</Tag>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            {data.companies.length === 0 && (
              <p className="text-sm text-bp-text-muted">No companies registered to this PAN.</p>
            )}
          </div>
        </SectionCard>
      </Section>

      {/* Directors */}
      {data.directors && data.directors.length > 0 && (
        <Section
          title="Associated Directors"
          collapsible
          rightElement={<Tag minimal>{data.directors.length}</Tag>}
        >
          <SectionCard>
            <div className="space-y-2">
              {data.directors.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-2 rounded bg-bp-surface">
                  <div>
                    <p className="text-sm font-medium">{d.name_en}</p>
                    {d.company_name && (
                      <p className="text-xs text-bp-text-muted">{d.company_name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {d.role && <Tag minimal className="text-xs">{d.role}</Tag>}
                    <span className="text-xs text-bp-text-muted">{d.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </Section>
      )}

      {/* Risk Flags */}
      {data.risk_flags && data.risk_flags.length > 0 && (
        <Section
          title="Risk Flags"
          collapsible
          rightElement={<Tag intent={Intent.DANGER} minimal>{data.risk_flags.length}</Tag>}
        >
          <SectionCard>
            <div className="space-y-2">
              {data.risk_flags.map((rf, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded bg-bp-surface">
                  <Tag
                    intent={
                      rf.severity === 'CRITICAL' ? Intent.DANGER
                        : rf.severity === 'HIGH' ? Intent.WARNING
                        : rf.severity === 'MEDIUM' ? Intent.PRIMARY
                        : Intent.NONE
                    }
                    minimal
                    className="text-[10px] mt-0.5 shrink-0"
                  >
                    {rf.severity}
                  </Tag>
                  <div>
                    <p className="text-sm">{rf.description}</p>
                    <p className="text-xs text-bp-text-muted">{rf.flag_type}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </Section>
      )}
    </div>
  )
}

export default CompanyExplorer
