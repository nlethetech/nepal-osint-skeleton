/**
 * CorporateIntel — Palantir-grade Corporate Intelligence Workstation
 *
 * Full-screen analyst workspace with Blueprint Navbar, Tabs, Tree sidebar,
 * Drawer detail panel, and keyboard shortcuts. The centerpiece of NARADA v6.
 */
import { useState, useCallback, useEffect } from 'react'
import {
  Tabs,
  Tab,
  Button,
  Icon,
  Tag,
  Intent,
  Drawer,
  DrawerSize,
  Spinner,
  Tooltip,
  useHotkeys,
  HotkeyConfig,
  Classes,
  MenuItem,
  Section,
  SectionCard,
  Card,
} from '@blueprintjs/core'
import { useQuery } from '@tanstack/react-query'
import { Omnibar } from '@blueprintjs/select'
import { CompanyExplorer } from '../components/corporate/CompanyExplorer'
import { StatsOverview } from '../components/corporate/StatsOverview'
import { RiskDashboard } from '../components/corporate/RiskDashboard'
import { DirectorNetwork } from '../components/corporate/DirectorNetwork'
import { AddressClusters } from '../components/corporate/AddressClusters'
import { PhoneClusters } from '../components/corporate/PhoneClusters'
import { RegistrationTimeline } from '../components/corporate/RegistrationTimeline'
import { AnalyticsDashboard } from '../components/corporate/AnalyticsDashboard'
import { AnomalyDashboard } from '../components/corporate/AnomalyDashboard'
import { CaseManager } from '../components/corporate/CaseManager'
import { CompanyProfilePanel } from '../components/corporate/CompanyProfilePanel'
import { AnalystShell } from '../components/layout/AnalystShell'
import { DataValueGrid } from '../components/ui/narada-ui'
import {
  getCorporateStats,
  searchCompanies,
  investigatePAN,
  getCompanyDetail,
  getPhoneLinks,
} from '../api/corporate'

// ── Tab IDs ──────────────────────────────────────────────────

type TabId = 'overview' | 'companies' | 'risk' | 'directors' | 'clusters' | 'phone-links' | 'timeline' | 'analytics' | 'anomalies' | 'cases'

const TAB_LABELS: Record<TabId, { label: string; icon: string; shortcut: string }> = {
  overview: { label: 'Overview', icon: 'dashboard', shortcut: 'O' },
  companies: { label: 'Companies', icon: 'office', shortcut: 'C' },
  risk: { label: 'Risk Flags', icon: 'warning-sign', shortcut: 'R' },
  directors: { label: 'Directors', icon: 'people', shortcut: 'D' },
  clusters: { label: 'Clusters', icon: 'map-marker', shortcut: 'A' },
  'phone-links': { label: 'Phone Links', icon: 'link', shortcut: 'P' },
  timeline: { label: 'Timeline', icon: 'timeline-events', shortcut: 'T' },
  analytics: { label: 'Analytics', icon: 'chart', shortcut: 'Y' },
  anomalies: { label: 'Anomalies', icon: 'diagnosis', shortcut: 'N' },
  cases: { label: 'Cases', icon: 'briefcase', shortcut: 'I' },
}

// ── Omnibar Search Result Type ──────────────────────────────

interface OmnibarResult {
  type: 'company' | 'pan'
  id: string
  label: string
  sublabel: string
  icon: 'office' | 'id-number'
  pan?: string | null
}

function renderOmnibarItem(
  item: OmnibarResult,
  { handleClick, handleFocus, modifiers }: {
    handleClick: React.MouseEventHandler<HTMLElement>
    handleFocus?: () => void
    modifiers: { active: boolean; disabled: boolean; matchesPredicate: boolean }
  },
) {
  if (!modifiers.matchesPredicate) return null
  return (
    <MenuItem
      key={`${item.type}-${item.id}`}
      text={item.label}
      label={item.sublabel}
      icon={item.icon}
      active={modifiers.active}
      onClick={handleClick}
      onFocus={handleFocus}
      roleStructure="listoption"
    />
  )
}

// ── PAN Investigation Inline ────────────────────────────────

function PANPanel({
  pan,
  onCompanyClick,
  onClose,
}: {
  pan: string
  onCompanyClick: (id: string) => void
  onClose: () => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['pan-investigation', pan],
    queryFn: () => investigatePAN(pan),
    enabled: !!pan,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size={40} />
      </div>
    )
  }

  if (!data) return null

  const irdIntent = (s: string | null) =>
    !s ? Intent.NONE
    : s === 'A' ? Intent.SUCCESS
    : s.startsWith('Non-filer') ? Intent.WARNING
    : s === 'D' ? Intent.DANGER
    : Intent.NONE

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Tag large intent={Intent.PRIMARY} className="font-mono">{data.pan}</Tag>
        {data.ird && (
          <Tag intent={irdIntent(data.ird.account_status)} minimal>
            {data.ird.account_status || 'Unknown'}
          </Tag>
        )}
        <span className="text-xs text-bp-text-muted ml-auto">
          {data.companies.length} companies linked
        </span>
      </div>

      {/* IRD */}
      {data.ird && (
        <Section title="IRD Tax Profile" collapsible>
          <SectionCard>
            <DataValueGrid
              className="corporate-drawer-grid"
              valueColorClassName="corporate-drawer-value"
              rows={[
                { label: 'Taxpayer (EN)', value: data.ird.taxpayer_name_en || '-' },
                { label: 'Taxpayer (NP)', value: data.ird.taxpayer_name_np || '-' },
                { label: 'Account Type', value: data.ird.account_type || '-' },
                {
                  label: 'Account Status',
                  value: (
                    <Tag intent={irdIntent(data.ird.account_status)} minimal>
                      {data.ird.account_status || '-'}
                    </Tag>
                  ),
                },
                { label: 'Tax Office', value: data.ird.tax_office || '-' },
                { label: 'VDC/Municipality', value: data.ird.vdc_municipality || '-' },
                {
                  label: 'Tax Clearance',
                  value: (
                    <Tag intent={data.ird.tax_clearance_verified ? Intent.SUCCESS : Intent.WARNING} minimal>
                      {data.ird.latest_tax_clearance_fy || 'None'}
                    </Tag>
                  ),
                },
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
                      {c.company_type_category || c.company_type || '-'} &middot; {c.district || '-'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tag intent={irdIntent(c.ird_status)} minimal className="text-xs">
                      {c.ird_status || '-'}
                    </Tag>
                  </div>
                </div>
              </Card>
            ))}
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
            <div className="space-y-1.5">
              {data.directors.map((d) => (
                <div key={d.id} className="flex items-center justify-between p-2 rounded bg-bp-surface text-sm">
                  <div>
                    <span className="font-medium">{d.name_en}</span>
                    {d.company_name && (
                      <span className="text-bp-text-muted ml-2 text-xs">{d.company_name}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {d.role && <Tag minimal className="text-[10px]">{d.role}</Tag>}
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
                  <p className="text-sm">{rf.description}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </Section>
      )}
    </div>
  )
}

// ── Company Detail Inline ───────────────────────────────────

function CompanyProfileDrawerContent({
  companyId,
  onPANClick,
  onCompanyClick,
}: {
  companyId: string
  onPANClick: (pan: string) => void
  onCompanyClick: (id: string) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['corporate-company', companyId],
    queryFn: () => getCompanyDetail(companyId),
    enabled: !!companyId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size={40} />
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="company-profile-stack">
      <CompanyProfilePanel detail={data} onPANClick={onPANClick} />
      <div className="company-profile-panel company-profile-panel-addon">
        <PhoneLinksSection companyId={companyId} onCompanyClick={onCompanyClick} onPANClick={onPANClick} />
      </div>
    </div>
  )
}

// ── Phone-Linked Companies ─────────────────────────────────

function PhoneLinksSection({
  companyId,
  onCompanyClick,
  onPANClick,
}: {
  companyId: string
  onCompanyClick: (id: string) => void
  onPANClick: (pan: string) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['phone-links', companyId],
    queryFn: () => getPhoneLinks(companyId),
    enabled: !!companyId,
  })

  if (isLoading) return <Spinner size={20} className="my-2" />
  if (!data || data.links.length === 0) return null

  const irdIntent = (s: string | null) =>
    !s ? Intent.NONE
    : s === 'A' ? Intent.SUCCESS
    : s.startsWith('Non-filer') ? Intent.WARNING
    : Intent.DANGER

  return (
    <Section
      title="Phone-Linked Companies"
      collapsible
      className="company-profile-section"
      rightElement={<Tag intent={Intent.WARNING} minimal className="company-profile-chip company-profile-chip-warn">{data.links.length}</Tag>}
    >
      <SectionCard>
        <p className="company-profile-phone-note">
          Companies sharing the same phone/mobile number (privacy-preserving hash match)
        </p>
        <div className="space-y-2.5">
          {data.links.map((link) => (
            <Card
              key={link.company_id}
              interactive
              className="p-2.5 cursor-pointer company-profile-phone-card"
              onClick={() => onCompanyClick(link.company_id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate company-profile-phone-name">{link.company_name}</p>
                  <div className="flex items-center gap-2 text-xs company-profile-phone-meta">
                    {link.district && <span>{link.district}</span>}
                    <Tag minimal className="text-xs company-profile-chip company-profile-chip-muted">{link.match_type}</Tag>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Tag intent={irdIntent(link.ird_status)} minimal className="text-xs company-profile-chip">
                    {link.ird_status || '-'}
                  </Tag>
                  {link.pan && (
                    <Tag intent={Intent.PRIMARY} minimal interactive
                      onClick={(e) => {
                        e.stopPropagation()
                        onPANClick(link.pan!)
                      }}
                      className="cursor-pointer font-mono text-xs company-profile-chip company-profile-chip-primary"
                    >
                      {link.pan}
                    </Tag>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </SectionCard>
    </Section>
  )
}

// ── Main Workstation ────────────────────────────────────────

export default function CorporateIntel() {
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Drawer state
  const [drawerType, setDrawerType] = useState<'company' | 'pan' | null>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  // Omnibar state
  const [omnibarOpen, setOmnibarOpen] = useState(false)
  const [omnibarQuery, setOmnibarQuery] = useState('')
  const [omnibarResults, setOmnibarResults] = useState<OmnibarResult[]>([])

  // Stats for navbar badge
  const { data: stats } = useQuery({
    queryKey: ['corporate-stats'],
    queryFn: getCorporateStats,
    staleTime: 60_000,
  })

  // Omnibar search — debounced server-side search
  useEffect(() => {
    if (omnibarQuery.length < 2) {
      setOmnibarResults([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const results: OmnibarResult[] = []

        // If query looks like a PAN (all digits), add PAN investigation option
        if (/^\d{5,}$/.test(omnibarQuery.trim())) {
          results.push({
            type: 'pan',
            id: omnibarQuery.trim(),
            label: `Investigate PAN: ${omnibarQuery.trim()}`,
            sublabel: 'PAN Investigation',
            icon: 'id-number',
            pan: omnibarQuery.trim(),
          })
        }

        // Search companies
        const data = await searchCompanies({ q: omnibarQuery, limit: 10 })
        for (const c of data.items) {
          results.push({
            type: 'company',
            id: c.id,
            label: c.name_english || c.name_nepali || `Reg #${c.registration_number}`,
            sublabel: [c.district, c.pan ? `PAN: ${c.pan}` : null].filter(Boolean).join(' · '),
            icon: 'office',
            pan: c.pan,
          })
        }

        setOmnibarResults(results)
      } catch {
        setOmnibarResults([])
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [omnibarQuery])

  // Handlers
  const handlePANClick = useCallback((pan: string) => {
    setDrawerType('pan')
    setDrawerId(pan)
  }, [])

  const handleCompanyClick = useCallback((id: string) => {
    setDrawerType('company')
    setDrawerId(id)
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerType(null)
    setDrawerId(null)
  }, [])

  const handleOmnibarSelect = useCallback((item: OmnibarResult) => {
    setOmnibarOpen(false)
    setOmnibarQuery('')
    setOmnibarResults([])
    if (item.type === 'pan' && item.pan) {
      handlePANClick(item.pan)
    } else if (item.type === 'company') {
      handleCompanyClick(item.id)
    }
  }, [handlePANClick, handleCompanyClick])

  // Keyboard shortcuts
  const hotkeys: HotkeyConfig[] = [
    {
      combo: 'o',
      global: true,
      label: 'Overview tab',
      onKeyDown: () => setActiveTab('overview'),
      group: 'Navigation',
    },
    {
      combo: 'c',
      global: true,
      label: 'Companies tab',
      onKeyDown: () => setActiveTab('companies'),
      group: 'Navigation',
    },
    {
      combo: 'r',
      global: true,
      label: 'Risk Flags tab',
      onKeyDown: () => setActiveTab('risk'),
      group: 'Navigation',
    },
    {
      combo: 'd',
      global: true,
      label: 'Directors tab',
      onKeyDown: () => setActiveTab('directors'),
      group: 'Navigation',
    },
    {
      combo: 'a',
      global: true,
      label: 'Address Clusters tab',
      onKeyDown: () => setActiveTab('clusters'),
      group: 'Navigation',
    },
    {
      combo: 'p',
      global: true,
      label: 'Phone Links tab',
      onKeyDown: () => setActiveTab('phone-links'),
      group: 'Navigation',
    },
    {
      combo: 't',
      global: true,
      label: 'Timeline tab',
      onKeyDown: () => setActiveTab('timeline'),
      group: 'Navigation',
    },
    {
      combo: 'y',
      global: true,
      label: 'Analytics tab',
      onKeyDown: () => setActiveTab('analytics'),
      group: 'Navigation',
    },
    {
      combo: 'n',
      global: true,
      label: 'Anomalies tab',
      onKeyDown: () => setActiveTab('anomalies'),
      group: 'Navigation',
    },
    {
      combo: 'i',
      global: true,
      label: 'Cases tab',
      onKeyDown: () => setActiveTab('cases'),
      group: 'Navigation',
    },
    {
      combo: 'escape',
      global: true,
      label: 'Close drawer',
      onKeyDown: closeDrawer,
      group: 'Actions',
    },
    {
      combo: 'mod+k',
      global: true,
      label: 'Open search',
      onKeyDown: () => setOmnibarOpen(true),
      group: 'Actions',
    },
  ]
  const { handleKeyDown, handleKeyUp } = useHotkeys(hotkeys)

  return (
    <>
      <AnalystShell
        activePage="corporate"
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        tabIndex={0}
        toolbar={(
          <div className="flex items-center gap-3 px-4 py-1.5 flex-shrink-0 bg-bp-card border-b border-bp-border">
            <Button
              icon="search"
              text="Search companies, PANs, directors..."
              rightIcon={<kbd className="shortcut-badge">Ctrl+K</kbd>}
              minimal
              onClick={() => setOmnibarOpen(true)}
              className="justify-start max-w-[400px] flex-1 text-bp-text-secondary"
            />
            <div className="flex-1" />
            {stats && (
              <span className="text-[11px] font-mono text-bp-text-secondary">
                {stats.total_companies.toLocaleString()} companies &middot; {stats.companies_with_pan.toLocaleString()} PANs
              </span>
            )}
            <Tooltip content="Keys: O C R D A T Y N I · Esc close · Ctrl+K search" placement="bottom">
              <Button icon="key-command" minimal small className="text-bp-text-secondary" />
            </Tooltip>
          </div>
        )}
        status={(
          <div className="flex items-center justify-between px-4 py-1.5 bg-bp-card border-t border-bp-border text-[10px] font-mono text-bp-text-muted">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-bp-success" />
                LIVE
              </span>
              <span>Tab: {TAB_LABELS[activeTab].label}</span>
            </div>
            <div className="flex items-center gap-4">
              <span>Shortcuts: press ? for help</span>
              <span>{new Date().toLocaleTimeString('en-US', { hour12: false })} NPT</span>
            </div>
          </div>
        )}
      >
        <div className="flex h-full flex-col min-h-0">
          {/* eslint-disable-next-line @blueprintjs/classes-constants */}
          <div className="px-4 pt-1 border-b bg-bp-card border-bp-border">
            <Tabs
              id="corporate-tabs"
              selectedTabId={activeTab}
              onChange={(newTab) => setActiveTab(newTab as TabId)}
              animate
              large={false}
            >
              {(Object.entries(TAB_LABELS) as [TabId, typeof TAB_LABELS[TabId]][]).map(([id, { label, icon, shortcut }]) => (
                <Tab
                  key={id}
                  id={id}
                  title={
                    <span className={`flex items-center gap-1.5 ${activeTab === id ? 'text-bp-text' : 'text-bp-text-secondary'}`}>
                      <Icon icon={icon as any} size={14} />
                      {label}
                      <kbd className="shortcut-badge text-[9px] px-1 ml-1">
                        {shortcut}
                      </kbd>
                    </span>
                  }
                />
              ))}
            </Tabs>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {activeTab === 'overview' && (
              <div className="h-full overflow-y-auto">
                <StatsOverview onNavigate={(tab) => setActiveTab(tab as TabId)} />
              </div>
            )}
            {activeTab === 'companies' && (
              <CompanyExplorer
                onPANClick={handlePANClick}
                onCompanyClick={handleCompanyClick}
              />
            )}
            {activeTab === 'risk' && (
              <div className="h-full overflow-y-auto p-4">
                <RiskDashboard
                  onPANClick={handlePANClick}
                  onCompanyClick={handleCompanyClick}
                />
              </div>
            )}
            {activeTab === 'directors' && (
              <div className="h-full overflow-y-auto p-4">
                <DirectorNetwork
                  onCompanyClick={handleCompanyClick}
                  onPANClick={handlePANClick}
                />
              </div>
            )}
            {activeTab === 'clusters' && (
              <div className="h-full overflow-y-auto p-4">
                <AddressClusters
                  onCompanyClick={handleCompanyClick}
                  onPANClick={handlePANClick}
                />
              </div>
            )}
            {activeTab === 'phone-links' && (
              <div className="h-full overflow-y-auto">
                <PhoneClusters
                  onCompanyClick={handleCompanyClick}
                  onPANClick={handlePANClick}
                />
              </div>
            )}
            {activeTab === 'timeline' && (
              <div className="h-full">
                <RegistrationTimeline
                  onCompanyClick={handleCompanyClick}
                  onPANClick={handlePANClick}
                />
              </div>
            )}
            {activeTab === 'analytics' && (
              <div className="h-full overflow-y-auto p-4">
                <AnalyticsDashboard
                  onCompanyClick={handleCompanyClick}
                  onPANClick={handlePANClick}
                />
              </div>
            )}
            {activeTab === 'anomalies' && (
              <div className="h-full overflow-y-auto p-4">
                <AnomalyDashboard
                  onCompanyClick={handleCompanyClick}
                  onPANClick={handlePANClick}
                />
              </div>
            )}
            {activeTab === 'cases' && (
              <div className="h-full overflow-hidden">
                <CaseManager />
              </div>
            )}
          </div>
        </div>
      </AnalystShell>

      <Omnibar<OmnibarResult>
        isOpen={omnibarOpen}
        onClose={() => {
          setOmnibarOpen(false)
          setOmnibarQuery('')
          setOmnibarResults([])
        }}
        items={omnibarResults}
        itemRenderer={renderOmnibarItem}
        onItemSelect={handleOmnibarSelect}
        query={omnibarQuery}
        onQueryChange={setOmnibarQuery}
        itemsEqual="id"
        noResults={
          omnibarQuery.length >= 2
            ? <MenuItem disabled text="No results found" roleStructure="listoption" />
            : <MenuItem disabled text="Type to search companies, PANs..." roleStructure="listoption" />
        }
        initialContent={
          <MenuItem disabled text="Type to search companies, PANs, directors..." roleStructure="listoption" />
        }
        inputProps={{
          placeholder: 'Search companies, PANs, directors...',
          leftIcon: 'search',
        }}
        itemListPredicate={() => omnibarResults}
        className={Classes.DARK}
      />

      <Drawer
        isOpen={!!drawerType && !!drawerId}
        onClose={closeDrawer}
        size={DrawerSize.STANDARD}
        title={
          drawerType === 'pan'
            ? `PAN Investigation: ${drawerId}`
            : 'Company Profile'
        }
        hasBackdrop={false}
        className={drawerType === 'company' ? 'company-profile-drawer' : `${Classes.DARK} corporate-profile-drawer`}
      >
        {drawerType === 'pan' && drawerId && (
          <PANPanel
            pan={drawerId}
            onCompanyClick={handleCompanyClick}
            onClose={closeDrawer}
          />
        )}
        {drawerType === 'company' && drawerId && (
          <CompanyProfileDrawerContent
            companyId={drawerId}
            onPANClick={handlePANClick}
            onCompanyClick={handleCompanyClick}
          />
        )}
      </Drawer>
    </>
  )
}
