import { create } from 'zustand'

export interface NotificationItem {
  id: string
  type: string
  title: string
  message: string | null
  data: Record<string, any> | null
  is_read: boolean
  created_at: string
}

interface NotificationState {
  notifications: NotificationItem[]
  unreadCount: number
  isOpen: boolean

  setNotifications: (items: NotificationItem[], unreadCount: number) => void
  setUnreadCount: (count: number) => void
  markRead: (id: string) => void
  markAllRead: () => void
  setOpen: (open: boolean) => void
  toggleOpen: () => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isOpen: false,

  setNotifications: (items, unreadCount) => set({ notifications: items, unreadCount }),
  setUnreadCount: (count) => set({ unreadCount: count }),
  markRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, is_read: true } : n,
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    })),
  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
      unreadCount: 0,
    })),
  setOpen: (open) => set({ isOpen: open }),
  toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
}))
