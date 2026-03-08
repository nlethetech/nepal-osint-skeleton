import { LucideIcon, Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="w-12 h-12 text-osint-muted mb-4" />
      <h3 className="text-lg font-medium text-osint-text mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-osint-muted max-w-sm mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-osint-accent hover:bg-osint-accent-hover text-white rounded-lg transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
