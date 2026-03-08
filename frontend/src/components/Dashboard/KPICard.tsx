import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react'

interface KPICardProps {
  title: string
  value: number | string
  icon: LucideIcon
  color: string
  trend?: {
    value: number
    isPositive: boolean
  }
  variant?: 'default' | 'hero' | 'compact'
  size?: 'sm' | 'md' | 'lg'
  sparkline?: number[]
  subtitle?: string
  className?: string
}

export function KPICard({
  title,
  value,
  icon: Icon,
  color,
  trend,
  variant = 'default',
  size = 'md',
  subtitle,
  className = ''
}: KPICardProps) {
  const sizeConfig = {
    sm: { container: 'p-3', iconSize: 14, valueSize: 'text-base', titleSize: 'text-xs' },
    md: { container: 'p-3', iconSize: 16, valueSize: 'text-lg', titleSize: 'text-xs' },
    lg: { container: 'p-4', iconSize: 18, valueSize: 'text-xl', titleSize: 'text-sm' },
  }

  const config = sizeConfig[size]

  const getContainerClass = () => {
    switch (variant) {
      case 'hero':
        return 'card'
      case 'compact':
        return 'card'
      default:
        return 'card'
    }
  }

  // Compact variant (horizontal layout)
  if (variant === 'compact') {
    return (
      <div className={`${getContainerClass()} ${config.container} ${className}`}>
        <div className="flex items-center gap-2.5">
          <Icon size={config.iconSize} className={color} strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className={`text-osint-muted ${config.titleSize}`}>{title}</p>
            <p className={`font-semibold tabular-nums ${config.valueSize} text-osint-text`}>
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Default and Hero variants
  return (
    <div className={`${getContainerClass()} ${config.container} ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-osint-muted ${config.titleSize}`}>{title}</p>
          <p className={`font-semibold mt-0.5 tabular-nums text-osint-text ${config.valueSize}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-xs text-osint-muted mt-0.5">{subtitle}</p>
          )}
          {trend && (
            <div className={`flex items-center gap-1 mt-1.5 text-xs ${trend.isPositive ? 'text-severity-low' : 'text-severity-critical'}`}>
              {trend.isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              <span>{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>
        <Icon size={config.iconSize} className={`${color} flex-shrink-0`} strokeWidth={1.5} />
      </div>
    </div>
  )
}

export function HeroKPICard(props: Omit<KPICardProps, 'variant'>) {
  return <KPICard {...props} variant="hero" size="lg" />
}

export function CompactKPICard(props: Omit<KPICardProps, 'variant'>) {
  return <KPICard {...props} variant="compact" size="sm" />
}
