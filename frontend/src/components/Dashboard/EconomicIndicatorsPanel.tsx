import { useState } from 'react'
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Globe,
  AlertTriangle,
  BarChart3,
  ArrowRight,
  Info
} from 'lucide-react'

type IndicatorStatus = 'healthy' | 'caution' | 'warning' | 'critical'
type TrendDirection = 'improving' | 'stable' | 'deteriorating'

interface EconomicIndicator {
  id: string
  name: string
  value: number
  unit: string
  status: IndicatorStatus
  trend: TrendDirection
  change_pct: number
  description: string
  components?: Array<{
    name: string
    value: number
    weight: number
  }>
}

interface TradePartner {
  country: string
  import_value: number
  export_value: number
  trade_balance: number
  share_pct: number
  trend: TrendDirection
}

interface EconomicIndicatorsPanelProps {
  fiscalYear?: string
}

const mockIndicators: EconomicIndicator[] = [
  {
    id: 'ehi',
    name: 'Economic Health Index',
    value: 52.3,
    unit: '/100',
    status: 'caution',
    trend: 'stable',
    change_pct: -2.1,
    description: "Nepal's economic health is moderate with trade deficit pressures offset by remittance inflows.",
    components: [
      { name: 'Trade Balance', value: 35, weight: 0.3 },
      { name: 'Export Growth', value: 60, weight: 0.25 },
      { name: 'Duty Efficiency', value: 70, weight: 0.2 },
      { name: 'Diversification', value: 45, weight: 0.25 },
    ]
  },
  {
    id: 'tvi',
    name: 'Trade Vulnerability Index',
    value: 68.5,
    unit: '/100',
    status: 'warning',
    trend: 'deteriorating',
    change_pct: 5.2,
    description: 'High vulnerability due to trade concentration and essential goods import dependency.',
    components: [
      { name: 'Deficit Severity', value: 75, weight: 0.3 },
      { name: 'Partner Concentration', value: 70, weight: 0.25 },
      { name: 'Commodity Concentration', value: 60, weight: 0.25 },
      { name: 'Shock Exposure', value: 68, weight: 0.2 },
    ]
  },
  {
    id: 'idi',
    name: 'Import Dependency Index',
    value: 72.8,
    unit: '/100',
    status: 'warning',
    trend: 'stable',
    change_pct: 1.5,
    description: 'Critical dependency on imports for energy, machinery, and pharmaceuticals.',
    components: [
      { name: 'Energy', value: 95, weight: 0.35 },
      { name: 'Machinery', value: 70, weight: 0.25 },
      { name: 'Food', value: 45, weight: 0.2 },
      { name: 'Pharma', value: 75, weight: 0.2 },
    ]
  }
]

const mockTradePartners: TradePartner[] = [
  { country: 'India', import_value: 982.5, export_value: 78.3, trade_balance: -904.2, share_pct: 65.2, trend: 'stable' },
  { country: 'China', import_value: 234.8, export_value: 12.1, trade_balance: -222.7, share_pct: 15.3, trend: 'deteriorating' },
  { country: 'UAE', import_value: 89.2, export_value: 45.6, trade_balance: -43.6, share_pct: 5.4, trend: 'improving' },
  { country: 'USA', import_value: 45.6, export_value: 78.9, trade_balance: 33.3, share_pct: 4.8, trend: 'improving' },
]

const mockTradeMetrics = {
  totalImports: 1512.4,
  totalExports: 245.7,
  tradeDeficit: 1266.7,
  deficitGrowth: 8.5,
  dutyCollection: 312.5,
  dutyGrowth: 5.2,
}

export function EconomicIndicatorsPanel({
  fiscalYear = '2080/81'
}: EconomicIndicatorsPanelProps) {
  const [selectedIndicator, setSelectedIndicator] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'indicators' | 'partners' | 'trade'>('indicators')

  const getStatusColor = (status: IndicatorStatus): string => {
    switch (status) {
      case 'healthy':
        return 'text-severity-low'
      case 'caution':
        return 'text-severity-medium'
      case 'warning':
        return 'text-severity-high'
      case 'critical':
        return 'text-severity-critical'
      default:
        return 'text-osint-muted'
    }
  }

  const getStatusBg = (status: IndicatorStatus): string => {
    switch (status) {
      case 'healthy':
        return 'bg-severity-low/20'
      case 'caution':
        return 'bg-severity-medium/20'
      case 'warning':
        return 'bg-severity-high/20'
      case 'critical':
        return 'bg-severity-critical/20'
      default:
        return 'bg-osint-border'
    }
  }

  const getTrendIcon = (trend: TrendDirection, size: number = 14) => {
    switch (trend) {
      case 'improving':
        return <TrendingUp size={size} className="text-severity-low" />
      case 'deteriorating':
        return <TrendingDown size={size} className="text-severity-critical" />
      default:
        return <ArrowRight size={size} className="text-osint-muted" />
    }
  }

  return (
    <div className="bg-osint-card border border-osint-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-osint-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="text-entity-organization" size={20} />
            <h3 className="font-semibold text-osint-text">Economic Intelligence</h3>
          </div>
          <span className="text-xs text-osint-muted">FY {fiscalYear}</span>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {[
            { id: 'indicators', label: 'Indicators', icon: BarChart3 },
            { id: 'partners', label: 'Partners', icon: Globe },
            { id: 'trade', label: 'Trade Flow', icon: Package },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary-600 text-white'
                  : 'bg-osint-border text-osint-muted hover:text-osint-text'
              }`}
            >
              <tab.icon size={12} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Indicators Tab */}
        {activeTab === 'indicators' && (
          <div className="space-y-3">
            {mockIndicators.map(indicator => (
              <div
                key={indicator.id}
                onClick={() => setSelectedIndicator(
                  selectedIndicator === indicator.id ? null : indicator.id
                )}
                className={`p-3 rounded-lg cursor-pointer transition-all border ${
                  selectedIndicator === indicator.id
                    ? 'border-primary-500 bg-osint-bg'
                    : 'border-osint-border hover:border-osint-muted'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-osint-text">{indicator.name}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${getStatusBg(indicator.status)} ${getStatusColor(indicator.status)}`}>
                        {indicator.status}
                      </span>
                    </div>
                    <p className="text-xs text-osint-muted line-clamp-1">{indicator.description}</p>
                  </div>
                  <div className="text-right ml-4">
                    <div className="flex items-center gap-1">
                      <span className="text-2xl font-bold text-osint-text">{indicator.value}</span>
                      <span className="text-xs text-osint-muted">{indicator.unit}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 text-xs">
                      {getTrendIcon(indicator.trend, 12)}
                      <span className={indicator.change_pct >= 0 ? 'text-severity-critical' : 'text-severity-low'}>
                        {indicator.change_pct >= 0 ? '+' : ''}{indicator.change_pct}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Expanded Components */}
                {selectedIndicator === indicator.id && indicator.components && (
                  <div className="mt-3 pt-3 border-t border-osint-border">
                    <p className="text-xs text-osint-muted mb-2">Components:</p>
                    <div className="grid grid-cols-2 gap-2">
                      {indicator.components.map(comp => (
                        <div key={comp.name} className="flex items-center justify-between">
                          <span className="text-xs text-osint-muted">{comp.name}</span>
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-osint-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary-500 rounded-full"
                                style={{ width: `${comp.value}%` }}
                              />
                            </div>
                            <span className="text-xs text-osint-text w-8">{comp.value}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Partners Tab */}
        {activeTab === 'partners' && (
          <div className="space-y-2">
            {mockTradePartners.map(partner => (
              <div
                key={partner.country}
                className="flex items-center justify-between p-3 rounded-lg bg-osint-bg border border-osint-border"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-osint-border flex items-center justify-center text-xs font-medium text-osint-text">
                    {partner.country.slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-osint-text">{partner.country}</p>
                    <p className="text-xs text-osint-muted">{partner.share_pct}% of total trade</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    {getTrendIcon(partner.trend, 12)}
                    <span className={`text-sm font-medium ${
                      partner.trade_balance >= 0 ? 'text-severity-low' : 'text-severity-critical'
                    }`}>
                      {partner.trade_balance >= 0 ? '+' : ''}{partner.trade_balance.toFixed(1)}B
                    </span>
                  </div>
                  <div className="text-xs text-osint-muted mt-0.5">
                    <span className="text-severity-low">E: {partner.export_value}B</span>
                    {' / '}
                    <span className="text-severity-critical">I: {partner.import_value}B</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Trade Flow Tab */}
        {activeTab === 'trade' && (
          <div className="space-y-4">
            {/* Trade Balance Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg bg-osint-bg border border-osint-border">
                <p className="text-xs text-osint-muted mb-1">Total Imports</p>
                <p className="text-xl font-bold text-severity-critical">
                  {mockTradeMetrics.totalImports}B
                </p>
                <p className="text-xs text-osint-muted">NPR</p>
              </div>
              <div className="p-3 rounded-lg bg-osint-bg border border-osint-border">
                <p className="text-xs text-osint-muted mb-1">Total Exports</p>
                <p className="text-xl font-bold text-severity-low">
                  {mockTradeMetrics.totalExports}B
                </p>
                <p className="text-xs text-osint-muted">NPR</p>
              </div>
              <div className="p-3 rounded-lg bg-osint-bg border border-osint-border">
                <p className="text-xs text-osint-muted mb-1">Trade Deficit</p>
                <p className="text-xl font-bold text-severity-high">
                  -{mockTradeMetrics.tradeDeficit}B
                </p>
                <p className="text-xs text-severity-critical">
                  +{mockTradeMetrics.deficitGrowth}% YoY
                </p>
              </div>
            </div>

            {/* Duty Collection */}
            <div className="p-3 rounded-lg bg-osint-bg border border-osint-border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-osint-muted mb-1">Duty Collection</p>
                  <p className="text-lg font-bold text-osint-text">
                    {mockTradeMetrics.dutyCollection}B NPR
                  </p>
                </div>
                <div className="flex items-center gap-1 text-severity-low">
                  <TrendingUp size={16} />
                  <span className="text-sm font-medium">+{mockTradeMetrics.dutyGrowth}%</span>
                </div>
              </div>
              <div className="mt-2 h-2 bg-osint-border rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-600 to-primary-400"
                  style={{ width: '75%' }}
                />
              </div>
              <p className="text-xs text-osint-muted mt-1">75% of annual target</p>
            </div>

            {/* Risk Alert */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-severity-high/10 border border-severity-high/20">
              <AlertTriangle size={16} className="text-severity-high mt-0.5" />
              <div>
                <p className="text-sm font-medium text-severity-high">Trade Deficit Alert</p>
                <p className="text-xs text-osint-muted mt-0.5">
                  Trade deficit has grown {mockTradeMetrics.deficitGrowth}% YoY, primarily driven by
                  petroleum imports. Strategic reserve levels should be monitored.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between text-xs text-osint-muted">
          <span>Data: Nepal Customs / Trade Analyzer</span>
          <button className="flex items-center gap-1 text-primary-400 hover:text-primary-300 transition-colors">
            <span>Full Report</span>
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
