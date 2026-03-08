/**
 * Close Races Widget
 *
 * Shows constituencies with tight margins:
 * - Races decided by narrow margins
 * - Potential upsets
 * - Anomaly indicators (high/low turnout, lopsided)
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Target, Eye } from 'lucide-react';
import { Widget } from '../Widget';
import { useElectionStore } from '../../../stores/electionStore';
import { loadElectionData, type ElectionData } from '../../elections/electionDataLoader';
import { computeCloseRaces, computeIncumbency, computeLandslides, computeMarginsByConstituency, computeTurnoutAnomalies, type CloseRace, type TurnoutAnomaly, type Landslide, type IncumbencyMajorLoss } from '../../elections/electionAnalytics';
import { getPartyColor, getPartyShortLabel } from '../../../lib/partyColors';
import { PROVINCES, type Province } from '../../../data/districts';

type Anomaly = TurnoutAnomaly;

export const CloseRacesWidget = memo(function CloseRacesWidget() {
  const { electionYear, setMapViewLevel, selectProvince, selectDistrict, selectConstituency } = useElectionStore();
  const [closeRaces, setCloseRaces] = useState<CloseRace[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [landslides, setLandslides] = useState<Landslide[]>([]);
  const [incumbencyLosses, setIncumbencyLosses] = useState<IncumbencyMajorLoss[]>([]);
  const [activeTab, setActiveTab] = useState<'close' | 'anomalies' | 'key'>('close');
  const [isLoading, setIsLoading] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [marginBins, setMarginBins] = useState<{ '<2%': number; '2–5%': number; '5–10%': number; '>10%': number }>({ '<2%': 0, '2–5%': 0, '5–10%': 0, '>10%': 0 });
  const [turnoutBins, setTurnoutBins] = useState<{ '<40': number; '40–60': number; '60–80': number; '>80': number }>({ '<40': 0, '40–60': 0, '60–80': 0, '>80': 0 });

  const focusConstituency = (constituencyId: string, district: string, province: string | null) => {
    setMapViewLevel('constituency');
    if (province && (PROVINCES as readonly string[]).includes(province)) {
      selectProvince(province as Province);
    }
    selectDistrict(district);
    selectConstituency(constituencyId);
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      setNote(null);
      try {
        const data = await loadElectionData(electionYear);
        if (data) {
          const declaredCount = data.constituencies.filter(c => c.status === 'declared').length;
          const countingCount = data.constituencies.filter(c => c.status === 'counting').length;
          if (electionYear === 2082 && declaredCount === 0 && countingCount === 0) {
            setNote('2082 counting has not started yet.');
          }

          const races = computeCloseRaces(data, 5).slice(0, 15);
          const detected = computeTurnoutAnomalies(data, 85, 40, 70).slice(0, 15);
          const lands = computeLandslides(data, 70).slice(0, 10);

          setCloseRaces(races);
          setAnomalies(detected);
          setLandslides(lands);

          // Histograms (declared constituencies only)
          const margins = computeMarginsByConstituency(data);
          const mb = { '<2%': 0, '2–5%': 0, '5–10%': 0, '>10%': 0 } as typeof marginBins;
          const tb = { '<40': 0, '40–60': 0, '60–80': 0, '>80': 0 } as typeof turnoutBins;
          for (const c of data.constituencies) {
            if (c.status === 'pending') continue;
            const m = margins.get(c.constituency_id)?.marginPct;
            if (m !== null && m !== undefined) {
              if (m < 2) mb['<2%']++;
              else if (m < 5) mb['2–5%']++;
              else if (m < 10) mb['5–10%']++;
              else mb['>10%']++;
            }
            const t = c.turnout_pct || 0;
            if (t > 0) {
              if (t < 40) tb['<40']++;
              else if (t < 60) tb['40–60']++;
              else if (t < 80) tb['60–80']++;
              else tb['>80']++;
            }
          }
          setMarginBins(mb);
          setTurnoutBins(tb);

          // Incumbency losses (for Key Races)
          const prevYear = electionYear === 2082 ? 2079 : electionYear === 2079 ? 2074 : null;
          if (declaredCount > 0 && prevYear) {
            const prevData = await loadElectionData(prevYear);
            if (prevData) {
              const inc = computeIncumbency(data, prevData);
              setIncumbencyLosses(inc.majorLosses.slice(0, 10));
            } else {
              setIncumbencyLosses([]);
            }
          } else {
            setIncumbencyLosses([]);
          }
        }
      } catch (err) {
        console.error('Failed to load close races:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [electionYear]);

  const keyRaces = useMemo(() => {
    const items: Array<{ id: string; title: string; subtitle: string; kind: string; severity: 'red' | 'amber' | 'neutral'; onClick: () => void }> = [];

    for (const r of closeRaces.slice(0, 6)) {
      items.push({
        id: `close:${r.constituencyId}`,
        title: `Close: ${r.name}`,
        subtitle: `${r.district} • ${r.marginPct.toFixed(1)}% margin • ${getPartyShortLabel(r.winnerParty)} vs ${getPartyShortLabel(r.runnerUpParty)}`,
        kind: 'close',
        severity: r.marginPct < 2 ? 'red' : 'amber',
        onClick: () => focusConstituency(r.constituencyId, r.district, typeof r.province === 'string' ? r.province : String(r.province)),
      });
    }

    for (const a of anomalies.slice(0, 6)) {
      items.push({
        id: `anom:${a.type}:${a.constituencyId}`,
        title: `${a.type === 'high_turnout' ? 'High Turnout' : a.type === 'low_turnout' ? 'Low Turnout' : 'Landslide'}: ${a.name}`,
        subtitle: `${a.district} • ${a.description}`,
        kind: 'anomaly',
        severity: a.severity,
        onClick: () => focusConstituency(a.constituencyId, a.district, typeof a.province === 'string' ? a.province : String(a.province)),
      });
    }

    for (const l of landslides.slice(0, 4)) {
      items.push({
        id: `land:${l.constituencyId}`,
        title: `Landslide: ${l.name}`,
        subtitle: `${l.district} • ${getPartyShortLabel(l.winnerParty)} ${l.winnerPct.toFixed(1)}%`,
        kind: 'landslide',
        severity: l.winnerPct >= 85 ? 'red' : 'amber',
        onClick: () => focusConstituency(l.constituencyId, l.district, typeof l.province === 'string' ? l.province : String(l.province)),
      });
    }

    for (const loss of incumbencyLosses.slice(0, 6)) {
      items.push({
        id: `inc:${loss.constituencyId}`,
        title: `Upset: ${loss.constituency}`,
        subtitle: `${loss.district} • ${getPartyShortLabel(loss.prevParty)} → ${getPartyShortLabel(loss.newParty)}`,
        kind: 'incumbency',
        severity: 'amber',
        onClick: () => focusConstituency(loss.constituencyId, loss.district, typeof loss.province === 'string' ? loss.province : String(loss.province)),
      });
    }

    return items.slice(0, 18);
  }, [closeRaces, anomalies, landslides, incumbencyLosses]);

  const renderBins = (bins: Record<string, number>, color: string) => {
    const max = Math.max(...Object.values(bins), 1);
    return (
      <div className="space-y-1.5">
        {Object.entries(bins).map(([label, value]) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-12 text-[9px] text-slate-500 font-mono">{label}</div>
            <div className="flex-1 h-1.5 bg-slate-800/60 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(value / max) * 100}%`, background: color }} />
            </div>
            <div className="w-6 text-right text-[9px] text-slate-400 font-mono">{value}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Widget
      id="close-races"
      icon={<Target size={14} />}
      badge={closeRaces.length > 0 ? closeRaces.length : undefined}
      badgeVariant="high"
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-white/5">
          <button
            onClick={() => setActiveTab('close')}
            className={`flex-1 px-3 py-2 text-[10px] font-semibold transition-colors ${
              activeTab === 'close'
                ? 'text-amber-400 border-b-2 border-amber-400 bg-amber-500/5'
                : 'text-slate-500 hover:text-slate-400'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Target size={10} />
              Close Races ({closeRaces.length})
            </div>
          </button>
          <button
            onClick={() => setActiveTab('anomalies')}
            className={`flex-1 px-3 py-2 text-[10px] font-semibold transition-colors ${
              activeTab === 'anomalies'
                ? 'text-red-400 border-b-2 border-red-400 bg-red-500/5'
                : 'text-slate-500 hover:text-slate-400'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <AlertTriangle size={10} />
              Anomalies ({anomalies.length})
            </div>
          </button>
          <button
            onClick={() => setActiveTab('key')}
            className={`flex-1 px-3 py-2 text-[10px] font-semibold transition-colors ${
              activeTab === 'key'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                : 'text-slate-500 hover:text-slate-400'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Eye size={10} />
              Key Races
            </div>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {note && (
                <div className="mb-3 p-2 rounded bg-white/[0.02] border border-white/5 text-[10px] text-slate-500">
                  {note}
                </div>
              )}

              {/* Micro distributions */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="p-2 rounded bg-white/[0.02] border border-white/5">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">Margins</div>
                  {renderBins(marginBins as any, '#f59e0b')}
                </div>
                <div className="p-2 rounded bg-white/[0.02] border border-white/5">
                  <div className="text-[9px] text-slate-500 uppercase tracking-wide mb-2">Turnout</div>
                  {renderBins(turnoutBins as any, '#22c55e')}
                </div>
              </div>

              {activeTab === 'close' ? (
            closeRaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Target size={24} className="text-slate-600 mb-2" />
                <div className="text-xs text-slate-500">No close races</div>
                <div className="text-[10px] text-slate-600 mt-1">All results have clear margins</div>
              </div>
            ) : (
              <div className="space-y-3">
                {closeRaces.map((race) => (
                  <button
                    key={race.constituencyId}
                    onClick={() => focusConstituency(race.constituencyId, race.district, typeof race.province === 'string' ? race.province : String(race.province))}
                    className="p-2 rounded bg-white/[0.02] border border-white/5 hover:border-amber-500/30 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-[10px] font-semibold text-slate-200">{race.name}</div>
                        <div className="text-[9px] text-slate-500">{race.district}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-bold text-amber-400 font-mono">
                          {race.marginPct.toFixed(1)}%
                        </div>
                        <div className="text-[8px] text-slate-600">margin</div>
                      </div>
                    </div>

                    {/* Winner vs Runner-up */}
                    <div className="flex items-center gap-2 text-[9px]">
                      <div className="flex items-center gap-1 flex-1">
                        <div
                          className="w-2 h-2 rounded-sm"
                          style={{ background: getPartyColor(race.winnerParty) }}
                        />
                        <span className="font-medium" style={{ color: getPartyColor(race.winnerParty) }}>
                          {getPartyShortLabel(race.winnerParty)}
                        </span>
                        <span className="text-slate-400 font-mono">{race.winnerVotes.toLocaleString()}</span>
                      </div>
                      <span className="text-slate-600">vs</span>
                      <div className="flex items-center gap-1 flex-1 justify-end">
                        <span className="text-slate-400 font-mono">{race.runnerUpVotes.toLocaleString()}</span>
                        <span className="font-medium" style={{ color: getPartyColor(race.runnerUpParty) }}>
                          {getPartyShortLabel(race.runnerUpParty)}
                        </span>
                        <div
                          className="w-2 h-2 rounded-sm"
                          style={{ background: getPartyColor(race.runnerUpParty) }}
                        />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : activeTab === 'anomalies' ? (
            anomalies.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <AlertTriangle size={24} className="text-slate-600 mb-2" />
                <div className="text-xs text-slate-500">No anomalies detected</div>
                <div className="text-[10px] text-slate-600 mt-1">All results within normal ranges</div>
              </div>
            ) : (
              <div className="space-y-2">
                {anomalies.map((anomaly, idx) => (
                  <button
                    key={`${anomaly.constituencyId}-${idx}`}
                    onClick={() => focusConstituency(anomaly.constituencyId, anomaly.district, typeof anomaly.province === 'string' ? anomaly.province : String(anomaly.province))}
                    className={`p-2 rounded border ${
                      anomaly.severity === 'red'
                        ? 'bg-red-500/10 border-red-500/30'
                        : 'bg-amber-500/10 border-amber-500/30'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        size={12}
                        className={anomaly.severity === 'red' ? 'text-red-500' : 'text-amber-500'}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium text-slate-200">{anomaly.name}</div>
                        <div className="text-[9px] text-slate-500 mb-1">{anomaly.district}</div>
                        <div className={`text-[9px] ${
                          anomaly.severity === 'red' ? 'text-red-400' : 'text-amber-400'
                        }`}>
                          {anomaly.description}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : (
            keyRaces.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Eye size={24} className="text-slate-600 mb-2" />
                <div className="text-xs text-slate-500">No key signals</div>
                <div className="text-[10px] text-slate-600 mt-1">Waiting for declared results</div>
              </div>
            ) : (
              <div className="space-y-2">
                {keyRaces.map((k) => (
                  <button
                    key={k.id}
                    onClick={k.onClick}
                    className={`w-full text-left p-2 rounded border transition-colors ${
                      k.severity === 'red'
                        ? 'bg-red-500/10 border-red-500/25 hover:border-red-500/40'
                        : k.severity === 'amber'
                          ? 'bg-amber-500/10 border-amber-500/25 hover:border-amber-500/40'
                          : 'bg-white/[0.02] border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="text-[10px] font-semibold text-slate-200">{k.title}</div>
                    <div className="text-[9px] text-slate-500 mt-0.5">{k.subtitle}</div>
                  </button>
                ))}
              </div>
            )
          )}
            </>
          )}
        </div>
      </div>
    </Widget>
  );
});
