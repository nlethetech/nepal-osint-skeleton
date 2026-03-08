import { ReactNode } from 'react'

export interface BadgeProps {
  variant:
    | 'critical' | 'high' | 'medium' | 'low' | 'info' | 'default'
    | 'person' | 'organization' | 'location' | 'district' | 'event'
    | 'secondary' | 'destructive' | 'outline'
  children: ReactNode
  size?: 'xs' | 'sm' | 'md'
  glow?: boolean
  icon?: ReactNode
  className?: string
}

const variantClasses: Record<string, string> = {
  // Severity variants
  critical: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  high: 'bg-severity-high/15 text-severity-high border-severity-high/30',
  medium: 'bg-severity-medium/15 text-severity-medium border-severity-medium/30',
  low: 'bg-severity-low/15 text-severity-low border-severity-low/30',

  // Status variants
  info: 'bg-osint-primary/15 text-osint-primary border-osint-primary/30',
  default: 'bg-osint-surface text-osint-text-secondary border-osint-border',
  secondary: 'bg-osint-surface text-osint-muted border-osint-border',
  destructive: 'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  outline: 'bg-transparent text-osint-text border-osint-border',

  // Entity type variants
  person: 'bg-entity-person/15 text-entity-person border-entity-person/30',
  organization: 'bg-entity-organization/15 text-entity-organization border-entity-organization/30',
  location: 'bg-entity-location/15 text-entity-location border-entity-location/30',
  district: 'bg-entity-district/15 text-entity-district border-entity-district/30',
  event: 'bg-entity-event/15 text-entity-event border-entity-event/30',
}

const sizeClasses = {
  xs: 'px-1.5 py-0.5 text-xs gap-0.5',
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-2.5 py-1 text-sm gap-1.5',
}

// Glow classes disabled - using simple borders instead
const glowClasses: Record<string, string> = {
  critical: '',
  high: '',
  medium: '',
  low: '',
  info: '',
}

export function Badge({
  variant,
  children,
  size = 'sm',
  glow = false,
  icon,
  className = ''
}: BadgeProps) {
  const baseClasses = 'inline-flex items-center font-medium rounded-md border transition-all duration-150'
  const variantClass = variantClasses[variant] || variantClasses.default
  const sizeClass = sizeClasses[size]
  const glowClass = glow && glowClasses[variant] ? glowClasses[variant] : ''

  return (
    <span
      className={`${baseClasses} ${variantClass} ${sizeClass} ${glowClass} ${className}`}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  )
}

// Convenience exports for common badge types
export function CriticalBadge({ children, ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="critical" {...props}>{children}</Badge>
}

export function HighBadge({ children, ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="high" {...props}>{children}</Badge>
}

export function MediumBadge({ children, ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="medium" {...props}>{children}</Badge>
}

export function LowBadge({ children, ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="low" {...props}>{children}</Badge>
}

export function InfoBadge({ children, ...props }: Omit<BadgeProps, 'variant'>) {
  return <Badge variant="info" {...props}>{children}</Badge>
}
