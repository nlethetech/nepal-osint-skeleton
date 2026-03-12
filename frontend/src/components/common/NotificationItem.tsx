import { Check, X, RotateCcw, Upload } from 'lucide-react'

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  is_read: boolean
  created_at: string
  data?: Record<string, any> | null
}

interface NotificationItemProps {
  notification: Notification
  onMarkRead: () => void
}

const ICON_MAP: Record<string, typeof Check> = {
  correction_approved: Check,
  correction_rejected: X,
  correction_rolled_back: RotateCcw,
  bulk_upload_complete: Upload,
}

const COLOR_MAP: Record<string, string> = {
  correction_approved: 'text-emerald-400 bg-emerald-500/10',
  correction_rejected: 'text-red-400 bg-red-500/10',
  correction_rolled_back: 'text-orange-400 bg-orange-500/10',
  bulk_upload_complete: 'text-blue-400 bg-blue-500/10',
}

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const Icon = ICON_MAP[notification.type] || Check
  const colorClass = COLOR_MAP[notification.type] || 'text-white/40 bg-white/5'

  return (
    <div
      className={`px-3 py-2.5 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors cursor-pointer ${
        !notification.is_read ? 'bg-white/[0.02]' : ''
      }`}
      onClick={() => {
        if (!notification.is_read) onMarkRead()
      }}
    >
      <div className="flex gap-2.5">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${colorClass}`}>
          <Icon size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-white truncate">{notification.title}</span>
            {!notification.is_read && (
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
            )}
          </div>
          {notification.message && (
            <p className="text-[11px] text-white/40 mt-0.5 line-clamp-2">{notification.message}</p>
          )}
          <p className="text-[10px] text-white/20 mt-1">{formatRelative(notification.created_at)}</p>
        </div>
      </div>
    </div>
  )
}
