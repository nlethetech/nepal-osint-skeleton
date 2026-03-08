import type { HTMLAttributes, ReactNode } from 'react';
import { Classes } from '@blueprintjs/core';
import { NaradaNavbar, type PageKey } from '../common/NaradaNavbar';

export type AnalystPanelDensity = 'compact' | 'standard' | 'comfortable';

export interface AnalystRouteLayoutConfig {
  density?: AnalystPanelDensity;
  centerScrollable?: boolean;
}

export interface AnalystShellProps extends HTMLAttributes<HTMLDivElement> {
  activePage: PageKey;
  toolbar?: ReactNode;
  leftRail?: ReactNode;
  center?: ReactNode;
  rightRail?: ReactNode;
  status?: ReactNode;
  statusBar?: ReactNode;
  density?: AnalystPanelDensity;
  layoutConfig?: AnalystRouteLayoutConfig;
  frameClassName?: string;
  contentClassName?: string;
  children?: ReactNode;
}

export function AnalystShell({
  activePage,
  toolbar,
  leftRail,
  center,
  rightRail,
  status,
  statusBar,
  density = 'standard',
  layoutConfig,
  frameClassName = '',
  contentClassName = '',
  className = '',
  children,
  ...rest
}: AnalystShellProps) {
  const resolvedDensity = layoutConfig?.density ?? density;
  const hasRailLayout = Boolean(leftRail || center || rightRail);
  const centerScrollable = layoutConfig?.centerScrollable ?? true;
  const railDensityClass =
    resolvedDensity === 'compact'
      ? 'gap-2'
      : resolvedDensity === 'comfortable'
      ? 'gap-4'
      : 'gap-3';

  return (
    <div
      className={`${Classes.DARK} h-screen flex flex-col bg-bp-bg text-bp-text ${className}`}
      {...rest}
    >
      <NaradaNavbar activePage={activePage} />

      <div className={`flex-1 min-h-0 flex flex-col ${frameClassName}`}>
        {toolbar && <div className="flex-shrink-0">{toolbar}</div>}
        <div className={`flex-1 min-h-0 ${contentClassName}`}>
          {hasRailLayout ? (
            <div className={`h-full min-h-0 grid grid-cols-1 lg:grid-cols-12 ${railDensityClass}`}>
              {leftRail && <aside className="min-h-0 overflow-hidden lg:col-span-2">{leftRail}</aside>}
              <main
                className={`min-h-0 overflow-hidden ${
                  rightRail ? 'lg:col-span-7' : 'lg:col-span-10'
                } ${centerScrollable ? 'overflow-y-auto' : ''}`}
              >
                {center || children}
              </main>
              {rightRail && <aside className="min-h-0 overflow-hidden lg:col-span-3">{rightRail}</aside>}
            </div>
          ) : (
            children
          )}
        </div>
        {(status ?? statusBar) && <div className="flex-shrink-0">{status ?? statusBar}</div>}
      </div>
    </div>
  );
}
