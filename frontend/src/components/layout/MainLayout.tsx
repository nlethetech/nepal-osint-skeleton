import { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal } from 'lucide-react'
import { usePermissions } from '../../hooks/usePermissions'
import { NotificationBell } from '../common/NotificationBell'

interface MainLayoutProps {
  children: ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const { isDev } = usePermissions()
  const navigate = useNavigate()

  return (
    <div className="h-screen bg-osint-bg overflow-hidden">
      {/* Floating utility bar — dev console shortcut + notification bell */}
      <div className="fixed top-2 right-3 z-50 flex items-center gap-1.5">
        <NotificationBell />
        {isDev && (
          <button
            onClick={() => navigate('/dev')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium text-white/40 hover:text-white/70 bg-black/40 hover:bg-black/60 backdrop-blur-sm border border-white/[0.06] rounded-md transition-all"
            title="Developer Console"
          >
            <Terminal size={12} />
            Dev
          </button>
        )}
      </div>
      {children}
    </div>
  )
}
