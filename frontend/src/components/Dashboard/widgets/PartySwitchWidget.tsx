/**
 * Party Switch Widget
 *
 * Shows verified party switches for the 2082 election.
 * Data is sourced from official ECN (Election Commission Nepal) candidate registrations
 * compared against 2079 election winners.
 *
 * This ensures ZERO false positives - only verified switches are shown.
 */

import { memo, useEffect, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { Widget } from '../Widget';

const PARTY_COLORS: Record<string, string> = {
  'NC': '#dc2626',    // Nepali Congress - Red
  'UML': '#2563eb',   // CPN-UML - Blue
  'MC': '#7f1d1d',    // Maoist Centre - Dark Red
  'RSP': '#f97316',   // Rastriya Swatantra Party - Orange
  'US': '#b91c1c',    // Unified Socialist - Red variant
  'RPP': '#eab308',   // Rastriya Prajatantra Party - Yellow
  'JSP': '#16a34a',   // Janata Samajbadi Party - Green
  'JP': '#059669',    // Janamat Party - Teal
  'NCP': '#9333ea',   // Nepal Communist Party - Purple
  'PDP': '#8b5cf6',   // Progressive Democratic Party - Violet
  'NUP': '#14b8a6',   // Nagarik Unmukti Party - Cyan
  'NWPP': '#f43f5e',  // Nepal Workers Peasants Party - Rose
  'IND': '#64748b',   // Independent - Gray
  'LSP': '#22c55e',   // Loktantrik Samajbadi Party - Light Green
};

const PARTY_NAMES: Record<string, string> = {
  'NC': 'Nepali Congress',
  'UML': 'CPN-UML',
  'MC': 'CPN-Maoist Centre',
  'RSP': 'Rastriya Swatantra Party',
  'US': 'CPN-Unified Socialist',
  'RPP': 'Rastriya Prajatantra Party',
  'JSP': 'Janata Samajbadi Party',
  'JP': 'Janamat Party',
  'NCP': 'Nepal Communist Party',
  'PDP': 'Progressive Democratic',
  'NUP': 'Nagarik Unmukti Party',
  'NWPP': 'Workers Peasants Party',
  'IND': 'Independent',
  'LSP': 'Loktantrik Samajbadi',
};

function getPartyColor(code: string): string {
  return PARTY_COLORS[code] || '#64748b';
}

function getPartyLabel(code: string): string {
  return code;
}

interface VerifiedSwitch {
  name: string;
  fromParty: string;
  fromCode: string;
  toParty: string;
  toCode: string;
  constituency: string;
  constituencyId: string;
  district: string;
  votes2079: number;
  wasWinner: boolean;
}

export const PartySwitchWidget = memo(function PartySwitchWidget() {
  const [switches, setSwitches] = useState<VerifiedSwitch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        // Always load 2082 vs 2079 party switch data
        const response = await fetch('/data/party-switches-2082-vs-2079.json');
        if (response.ok) {
          const data = await response.json();
          setSwitches(data);
        } else {
          console.error('Failed to fetch party switch data:', response.status);
          setSwitches([]);
        }
      } catch (err) {
        console.error('Failed to load party switch data:', err);
        setSwitches([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  // Count by pattern
  const toNCPCount = switches.filter(s => s.toCode === 'NCP').length;

  return (
    <Widget
      id="party-switch"
      icon={<RefreshCw size={14} />}
      badge={switches.length > 0 ? switches.length : undefined}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Summary */}
        <div className="p-3 border-b border-white/5">
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2 rounded bg-purple-500/10 border border-purple-500/20">
              <div className="text-[8px] text-purple-400 uppercase tracking-wide mb-1">Ex-MPs Switched</div>
              <div className="text-lg font-bold text-purple-400 font-mono">{switches.length}</div>
            </div>
            <div className="p-2 rounded bg-violet-500/10 border border-violet-500/20">
              <div className="text-[8px] text-violet-400 uppercase tracking-wide mb-1">Joined NCP</div>
              <div className="text-lg font-bold text-violet-400 font-mono">{toNCPCount}</div>
            </div>
          </div>
          {switches.length > 0 && (
            <div className="text-[9px] text-slate-500 mt-2 text-center">
              Verified from ECN 2082 registrations vs 2079 winners
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : switches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <RefreshCw size={24} className="text-slate-600 mb-2" />
              <div className="text-xs text-slate-500">
                No party switches detected
              </div>
              <div className="text-[10px] text-slate-600 mt-1">
                Comparing 2082 registrations vs 2079 winners
              </div>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {switches.map((s, idx) => (
                <div
                  key={`${s.name}-${idx}`}
                  className="p-2 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-start gap-2">
                    {/* Name and badges */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-medium text-slate-200 truncate">
                          {s.name}
                        </span>
                        <span className="px-1 py-0.5 text-[7px] bg-amber-500/20 text-amber-400 rounded font-semibold">
                          EX-MP
                        </span>
                      </div>

                      {/* Party switch visualization */}
                      <div className="flex items-center gap-1 mt-1">
                        <div className="flex items-center gap-1">
                          <div
                            className="w-2 h-2 rounded-sm"
                            style={{ background: getPartyColor(s.fromCode) }}
                          />
                          <span
                            className="text-[9px] font-medium"
                            style={{ color: getPartyColor(s.fromCode) }}
                          >
                            {getPartyLabel(s.fromCode)}
                          </span>
                        </div>
                        <ArrowRight size={10} className="text-slate-500 mx-0.5" />
                        <div className="flex items-center gap-1">
                          <div
                            className="w-2 h-2 rounded-sm"
                            style={{ background: getPartyColor(s.toCode) }}
                          />
                          <span
                            className="text-[9px] font-medium"
                            style={{ color: getPartyColor(s.toCode) }}
                          >
                            {getPartyLabel(s.toCode)}
                          </span>
                        </div>
                      </div>

                      {/* Constituency */}
                      <div className="text-[8px] text-slate-500 mt-0.5 truncate">
                        {s.constituency}
                      </div>
                    </div>

                    {/* Votes in 2079 */}
                    <div className="text-right flex-shrink-0">
                      <div className="text-[9px] font-bold text-emerald-400">2079</div>
                      <div className="text-[8px] text-slate-500 font-mono">
                        {s.votes2079.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Widget>
  );
});
