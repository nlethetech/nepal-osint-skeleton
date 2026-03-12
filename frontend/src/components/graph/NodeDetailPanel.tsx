import { X, ExternalLink, Users, MapPin, Building, Calendar, TrendingUp, Expand, Trophy, Vote } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { GraphNode } from '../../types/api'

interface NodeDetailPanelProps {
  node: GraphNode | null
  onClose: () => void
  onExpand: (nodeId: string) => void
  connectedNodes?: GraphNode[]
  connectionCount?: number
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  PERSON: <Users className="w-5 h-5" />,
  ORGANIZATION: <Building className="w-5 h-5" />,
  LOCATION: <MapPin className="w-5 h-5" />,
  DISTRICT: <MapPin className="w-5 h-5" />,
  CONSTITUENCY: <Vote className="w-5 h-5" />,
  PARTY: <Building className="w-5 h-5" />,
  EVENT: <Calendar className="w-5 h-5" />,
}

const TYPE_COLORS: Record<string, string> = {
  PERSON: 'bg-entity-person',
  ORGANIZATION: 'bg-entity-organization',
  LOCATION: 'bg-entity-location',
  DISTRICT: 'bg-teal-500',
  CONSTITUENCY: 'bg-teal-500',
  PARTY: 'bg-purple-500',
  EVENT: 'bg-entity-event',
}

export function NodeDetailPanel({
  node,
  onClose,
  onExpand,
  connectedNodes = [],
  connectionCount = 0,
}: NodeDetailPanelProps) {
  const navigate = useNavigate()

  if (!node) return null

  return (
    <div className="absolute top-0 right-0 w-80 h-full bg-osint-bg/95 backdrop-blur-sm border-l border-osint-border shadow-2xl overflow-hidden flex flex-col z-10">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-osint-border">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-lg ${TYPE_COLORS[node.type]} text-white`}>
            {TYPE_ICONS[node.type] || <Users className="w-5 h-5" />}
          </div>
          <div>
            <span className="text-xs text-osint-muted uppercase tracking-wide">
              {node.type}
            </span>
            <h3 className="font-semibold text-osint-text truncate max-w-[180px]">
              {node.label}
            </h3>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-osint-border rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-osint-card border border-osint-border rounded-lg p-3">
            <div className="flex items-center gap-2 text-osint-muted mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs">Connections</span>
            </div>
            <p className="text-xl font-bold text-osint-accent">{connectionCount}</p>
          </div>
          <div className="bg-osint-card border border-osint-border rounded-lg p-3">
            <div className="flex items-center gap-2 text-osint-muted mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs">Mentions</span>
            </div>
            <p className="text-xl font-bold">{(node.properties?.mentions as number) || 0}</p>
          </div>
        </div>

        {/* Nepali Name */}
        {typeof node.properties?.label_ne === 'string' && node.properties.label_ne ? (
          <div>
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2">
              Nepali Name
            </h4>
            <p className="text-osint-text">{String(node.properties.label_ne)}</p>
          </div>
        ) : null}

        {/* Election Performance (for PERSON nodes with election stats) */}
        {node.type === 'PERSON' && !!(node.properties?.elections_contested || node.properties?.total_wins) && (
          <div>
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2">
              Election Performance
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-osint-card border border-osint-border rounded-lg p-2">
                <span className="text-xs text-osint-muted">Elections</span>
                <p className="text-lg font-bold">{(node.properties.elections_contested as number) || 0}</p>
              </div>
              <div className="bg-osint-card border border-osint-border rounded-lg p-2">
                <div className="flex items-center gap-1">
                  <Trophy className="w-3 h-3 text-green-400" />
                  <span className="text-xs text-osint-muted">Wins</span>
                </div>
                <p className="text-lg font-bold text-green-400">{(node.properties.total_wins as number) || 0}</p>
              </div>
              {node.properties.total_votes ? (
                <div className="bg-osint-card border border-osint-border rounded-lg p-2 col-span-2">
                  <span className="text-xs text-osint-muted">Total Votes</span>
                  <p className="text-lg font-bold">{Number(node.properties.total_votes).toLocaleString()}</p>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Connected Nodes Preview */}
        {connectedNodes.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2">
              Connected Entities ({connectedNodes.length})
            </h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {connectedNodes.slice(0, 10).map((connected) => (
                <div
                  key={connected.id}
                  className="flex items-center gap-2 p-2 bg-osint-card border border-osint-border rounded-lg text-sm hover:border-osint-accent/50 transition-colors cursor-pointer"
                >
                  <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[connected.type]}`} />
                  <span className="truncate flex-1">{connected.label}</span>
                  <span className="text-xs text-osint-muted">{connected.type}</span>
                </div>
              ))}
              {connectedNodes.length > 10 && (
                <p className="text-xs text-osint-muted text-center py-1">
                  +{connectedNodes.length - 10} more
                </p>
              )}
            </div>
          </div>
        )}

        {/* Node ID */}
        <div>
          <h4 className="text-xs font-medium text-osint-muted uppercase tracking-wide mb-2">
            Node ID
          </h4>
          <code className="text-xs bg-osint-card border border-osint-border rounded px-2 py-1 break-all block">
            {node.id}
          </code>
        </div>
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-osint-border space-y-2">
        <button
          onClick={() => onExpand(node.id)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors font-medium"
        >
          <Expand className="w-4 h-4" />
          Expand Connections
        </button>
        <button
          onClick={() => {
            const isStory = (node.type || '').toLowerCase() === 'document'
            navigate(isStory ? `/dossier/story/${node.id}` : `/dossier/kb-entity/${node.id}`)
          }}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-osint-card border border-osint-border hover:bg-osint-border rounded-lg transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          View Full Profile
        </button>
      </div>
    </div>
  )
}
