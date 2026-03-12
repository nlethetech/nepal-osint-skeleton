import { useState, useEffect, useRef } from 'react'
import { Bell } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchNotifications, markNotificationRead, markAllNotificationsRead } from '../../api/notifications'
import { NotificationItem } from './NotificationItem'
import { useNotificationStore } from '../../stores/notificationStore'

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { setUnreadCount } = useNotificationStore()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => fetchNotifications(),
    refetchInterval: 30000,
  })

  const unread = data?.unread_count || 0

  useEffect(() => {
    setUnreadCount(unread)
  }, [unread, setUnreadCount])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markReadMut = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markAllMut = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-md hover:bg-white/[0.06] transition-colors"
      >
        <Bell size={16} className="text-white/50" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center text-[9px] font-bold text-white bg-red-500 rounded-full tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-[#12121a] border border-white/[0.08] rounded-lg shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
            <span className="text-xs font-semibold text-white">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllMut.mutate()}
                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {!data?.items.length ? (
              <div className="px-3 py-6 text-center text-xs text-white/20">
                No notifications
              </div>
            ) : (
              data.items.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onMarkRead={() => markReadMut.mutate(n.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
