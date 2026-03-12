import { useEffect, useState } from 'react'
import { User, Building2, MapPin, Map } from 'lucide-react'
import { Modal } from '../common/Modal'
import { Badge } from '../common/Badge'
import { LoadingSpinner } from '../common/LoadingSpinner'
import { getEntity } from '../../api/entities'
import type { Entity, EntityType } from '../../types/api'

interface EntityDetailModalProps {
  entityId: string | null
  onClose: () => void
}

const typeIcons: Record<EntityType, typeof User> = {
  PERSON: User,
  ORGANIZATION: Building2,
  LOCATION: MapPin,
  DISTRICT: Map,
}

const typeBadgeVariant: Record<EntityType, 'person' | 'organization' | 'location' | 'district'> = {
  PERSON: 'person',
  ORGANIZATION: 'organization',
  LOCATION: 'location',
  DISTRICT: 'district',
}

export function EntityDetailModal({ entityId, onClose }: EntityDetailModalProps) {
  const [entity, setEntity] = useState<Entity | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!entityId) {
      setEntity(null)
      return
    }

    async function fetchEntity(id: string) {
      setLoading(true)
      setError(null)
      try {
        const data = await getEntity(id)
        setEntity(data)
      } catch (err) {
        setError('Failed to load entity details')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchEntity(entityId)
  }, [entityId])

  const Icon = entity ? typeIcons[entity.entity_type] : User

  return (
    <Modal
      isOpen={!!entityId}
      onClose={onClose}
      title="Entity Details"
      size="md"
    >
      {loading && <LoadingSpinner message="Loading entity..." />}

      {error && (
        <div className="text-center text-severity-critical py-4">{error}</div>
      )}

      {entity && !loading && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-osint-border">
              <Icon className="w-8 h-8 text-osint-accent" />
            </div>
            <div className="flex-1">
              <h3 className="text-xl font-semibold">{entity.name}</h3>
              {entity.name_ne && (
                <p className="text-osint-muted mt-1">{entity.name_ne}</p>
              )}
              <div className="mt-2">
                <Badge variant={typeBadgeVariant[entity.entity_type]} size="md">
                  {entity.entity_type}
                </Badge>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-osint-border/30 rounded-lg p-4">
              <p className="text-osint-muted text-sm">Mention Count</p>
              <p className="text-2xl font-bold text-osint-accent mt-1">
                {entity.mention_count.toLocaleString()}
              </p>
            </div>
            <div className="bg-osint-border/30 rounded-lg p-4">
              <p className="text-osint-muted text-sm">Normalized Name</p>
              <p className="text-lg font-medium mt-1">{entity.normalized_name}</p>
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-2">
            <h4 className="font-medium text-osint-muted">Activity Timeline</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-osint-muted">First Seen</p>
                <p>{new Date(entity.first_seen_at).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-osint-muted">Last Seen</p>
                <p>{new Date(entity.last_seen_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-osint-border">
            <button className="flex-1 px-4 py-2 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors">
              View in Graph
            </button>
            <button className="flex-1 px-4 py-2 bg-osint-border hover:bg-osint-border/70 rounded-lg transition-colors">
              View Stories
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
