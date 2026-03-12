/**
 * ParliamentSessionWidget — Parliamentary Summary
 *
 * Shows parliament session status. Currently the 2082 parliament
 * has been elected but first session has not convened yet.
 */
import { memo } from 'react';
import { Widget } from '../Widget';
import { Building2, Clock } from 'lucide-react';

export const ParliamentSessionWidget = memo(function ParliamentSessionWidget() {
  return (
    <Widget id="parliament-session" icon={<Building2 size={14} />}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: 24, textAlign: 'center', gap: 10,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'rgba(209, 152, 11, 0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Clock size={18} style={{ color: 'var(--status-medium)' }} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            Parliament Session Not Started
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 260 }}>
            The 2082 House of Representatives has been elected but has not convened its first session yet. Session data, attendance, and legislative activity will appear here once parliament begins.
          </div>
          <div style={{
            marginTop: 4, padding: '4px 10px',
            background: 'rgba(209, 152, 11, 0.08)',
            border: '1px solid rgba(209, 152, 11, 0.15)',
            fontSize: 9, color: 'var(--status-medium)',
            fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Awaiting First Session
          </div>
        </div>
      </div>
    </Widget>
  );
});
