import { useState } from 'react'
import { BarChart3, ArrowLeftRight, PieChart, TrendingUp, Building2, Shuffle, AlertTriangle } from 'lucide-react'
import { PartySeatsChart } from './PartySeatsChart'
import { SwingChart } from './SwingChart'
import { VoteSharePie } from './VoteSharePie'
import { TrendLineChart } from './TrendLineChart'
import { ProvinceRollup } from './ProvinceRollup'
import { PartyChangesSankey } from './PartyChangesSankey'
import { AnomalyFlags } from './AnomalyFlags'

type AnalyticsTab = 'seats' | 'swing' | 'vote-share' | 'trends' | 'province' | 'defections' | 'anomalies'

const tabs: { id: AnalyticsTab; label: string; icon: typeof BarChart3 }[] = [
  { id: 'seats', label: 'Seats', icon: BarChart3 },
  { id: 'swing', label: 'Swing', icon: ArrowLeftRight },
  { id: 'vote-share', label: 'Share', icon: PieChart },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'province', label: 'Prov.', icon: Building2 },
  { id: 'defections', label: 'Defect.', icon: Shuffle },
  { id: 'anomalies', label: 'Flags', icon: AlertTriangle },
]

export function AnalyticsPanel() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('seats')

  return (
    <div className="h-full flex flex-col bg-osint-card border border-osint-border rounded-lg overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-osint-border px-1 pt-1">
        {tabs.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2 py-1.5 text-[10px] rounded-t transition-colors ${
                isActive
                  ? 'bg-osint-surface text-osint-text border-b-2 border-osint-primary'
                  : 'text-osint-muted hover:text-osint-text-secondary'
              }`}
            >
              <Icon size={10} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Chart content */}
      <div className="flex-1 p-3 min-h-0 overflow-y-auto">
        {activeTab === 'seats' && <PartySeatsChart />}
        {activeTab === 'swing' && <SwingChart />}
        {activeTab === 'vote-share' && <VoteSharePie />}
        {activeTab === 'trends' && <TrendLineChart />}
        {activeTab === 'province' && <ProvinceRollup />}
        {activeTab === 'defections' && <PartyChangesSankey />}
        {activeTab === 'anomalies' && <AnomalyFlags />}
      </div>
    </div>
  )
}
