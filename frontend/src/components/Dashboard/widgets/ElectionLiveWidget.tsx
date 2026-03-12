/**
 * ElectionLiveWidget — 2x2 grid of YouTube live streams for election coverage.
 */
import { memo, useState } from 'react';
import { Widget } from '../Widget';
import { Radio, Maximize2, Minimize2 } from 'lucide-react';

const STREAMS = [
  { id: 'mtWk231-12Q', label: 'Stream 1' },
  { id: 'MSqXwRgiGhI', label: 'Stream 2' },
];

export const ElectionLiveWidget = memo(function ElectionLiveWidget() {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <Widget id="election-live" icon={<Radio size={14} />} badge="LIVE">
      <div style={{
        display: 'grid',
        gridTemplateColumns: expanded !== null ? '1fr' : '1fr 1fr',
        gridTemplateRows: '1fr',
        gap: '2px',
        width: '100%',
        height: '100%',
        minHeight: '400px',
        background: '#000',
      }}>
        {STREAMS.map((stream, i) => {
          if (expanded !== null && expanded !== i) return null;
          return (
            <div key={stream.id} style={{ position: 'relative', width: '100%', height: '100%', minHeight: expanded !== null ? '400px' : '190px' }}>
              <iframe
                src={`https://www.youtube.com/embed/${stream.id}?autoplay=${i === 0 ? 1 : 0}&mute=1&rel=0`}
                title={stream.label}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  border: 'none',
                }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
              <button
                onClick={() => setExpanded(expanded === i ? null : i)}
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  background: 'rgba(0,0,0,0.7)',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: '3px',
                  zIndex: 10,
                  display: 'flex',
                  alignItems: 'center',
                }}
                title={expanded === i ? 'Show all' : 'Expand'}
              >
                {expanded === i ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
            </div>
          );
        })}
      </div>
    </Widget>
  );
});
