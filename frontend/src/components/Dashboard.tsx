/**
 * Main Dashboard — open-source skeleton.
 */
export function Dashboard() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#080b11', color: '#c5cbd3',
      fontFamily: "'SF Mono', 'Fira Code', monospace", flexDirection: 'column', gap: 16,
    }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f5f8fa' }}>NepalOSINT</h1>
      <p style={{ fontSize: 14, color: '#8f99a8' }}>Open-source intelligence dashboard — skeleton</p>
      <p style={{ fontSize: 12, color: '#5c7080' }}>API running at localhost:8000</p>
    </div>
  );
}
