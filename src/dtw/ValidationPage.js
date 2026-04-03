// ---------------------------------------------
// dtw/ValidationPage.js
// Browser-based validation: runs synthetic data through all 16 DTW references
// and displays results in a table.
// Accessible at /dtw-validation
// ---------------------------------------------
import React, { useState, useCallback, useEffect } from 'react';
import { bootstrapAllReferences } from './bootstrapReferences';
import { validateAllExercises, validateExercise } from './validateDTW';
import { listReferences } from './referenceRegistry';

// Ensure references are loaded
bootstrapAllReferences();

const S = {
  page: {
    fontFamily: "'Inter', -apple-system, sans-serif",
    background: '#0a0a1a', color: '#e0e0e0', minHeight: '100vh',
    padding: '24px', boxSizing: 'border-box',
  },
  header: { fontSize: 28, fontWeight: 700, marginBottom: 4, color: '#fff' },
  sub: { fontSize: 14, color: '#888', marginBottom: 20 },
  btn: {
    background: '#4466ff', color: '#fff', border: 'none', borderRadius: 8,
    padding: '10px 24px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    marginRight: 8, marginBottom: 16,
  },
  btnSec: {
    background: '#333355', color: '#ccc', border: '1px solid #444477', borderRadius: 8,
    padding: '10px 20px', fontSize: 14, cursor: 'pointer', marginRight: 8, marginBottom: 16,
  },
  table: {
    width: '100%', borderCollapse: 'collapse', marginTop: 12,
    fontSize: 13,
  },
  th: {
    textAlign: 'left', padding: '8px 12px', background: '#13132a',
    borderBottom: '2px solid #333366', color: '#aaccff', fontWeight: 600,
  },
  td: {
    padding: '8px 12px', borderBottom: '1px solid #222244',
  },
  pass: { color: '#44cc66', fontWeight: 700 },
  warn: { color: '#ffaa22', fontWeight: 700 },
  fail: { color: '#ff4444', fontWeight: 700 },
  skip: { color: '#888' },
  error: { color: '#ff4444' },
  card: {
    background: '#13132a', borderRadius: 12, padding: 16, marginBottom: 16,
    border: '1px solid #222244',
  },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  summary: {
    display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap',
  },
  stat: (bg) => ({
    background: bg, borderRadius: 8, padding: '8px 16px',
    fontSize: 14, fontWeight: 700, color: '#fff',
  }),
};

const statusStyle = (s) => {
  if (s === 'PASS') return S.pass;
  if (s === 'WARN') return S.warn;
  if (s === 'FAIL') return S.fail;
  if (s === 'SKIP') return S.skip;
  return S.error;
};

export default function ValidationPage() {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [noise, setNoise] = useState(0.02);
  const [numReps, setNumReps] = useState(5);
  const [registeredCount, setRegisteredCount] = useState(0);

  useEffect(() => {
    setRegisteredCount(listReferences().length);
  }, []);

  const runAll = useCallback(() => {
    setRunning(true);
    // Use setTimeout to let the UI update before blocking
    setTimeout(() => {
      const res = validateAllExercises({ numReps, noise });
      setResults(res);
      setRunning(false);
    }, 50);
  }, [numReps, noise]);

  const runSingle = useCallback((name) => {
    setRunning(true);
    setTimeout(() => {
      const res = validateExercise(name, { numReps, noise });
      setResults(prev => {
        if (!prev) return [res];
        const idx = prev.findIndex(r => r.name === name);
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = res;
          return copy;
        }
        return [...prev, res];
      });
      setRunning(false);
    }, 50);
  }, [numReps, noise]);

  const pass = results?.filter(r => r.status === 'PASS').length || 0;
  const warn = results?.filter(r => r.status === 'WARN').length || 0;
  const fail = results?.filter(r => r.status === 'FAIL').length || 0;

  return (
    <div style={S.page}>
      <div style={S.header}>DTW Validation</div>
      <div style={S.sub}>
        Synthetic movement sequences → DTW pipeline → rep & phase detection accuracy.
        {' '}{registeredCount} references registered.
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: '#888' }}>Reps:</label>
        <input type="number" value={numReps} min={1} max={20}
          onChange={e => setNumReps(parseInt(e.target.value) || 5)}
          style={{ background: '#1a1a3a', border: '1px solid #333366', borderRadius: 6,
            color: '#fff', padding: '6px 10px', width: 60, fontSize: 14 }} />
        <label style={{ fontSize: 13, color: '#888' }}>Noise:</label>
        <input type="number" value={noise} min={0} max={0.5} step={0.01}
          onChange={e => setNoise(parseFloat(e.target.value) || 0)}
          style={{ background: '#1a1a3a', border: '1px solid #333366', borderRadius: 6,
            color: '#fff', padding: '6px 10px', width: 70, fontSize: 14 }} />
        <button style={S.btn} onClick={runAll} disabled={running}>
          {running ? 'Running...' : 'Validate All 16'}
        </button>
      </div>

      {/* Summary */}
      {results && (
        <div style={S.summary}>
          <div style={S.stat('#339944')}>{pass} PASS</div>
          <div style={S.stat('#cc8800')}>{warn} WARN</div>
          <div style={S.stat('#cc3333')}>{fail} FAIL</div>
          <div style={S.stat('#333366')}>{results.length} total</div>
        </div>
      )}

      {/* Results table */}
      {results && (
        <div style={S.card}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Exercise</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Mode</th>
                <th style={S.th}>Reps</th>
                <th style={S.th}>Accuracy</th>
                <th style={S.th}>Quality</th>
                <th style={S.th}>Phase Changes</th>
                <th style={S.th}>Phases</th>
                <th style={S.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ background: i % 2 ? '#0d0d22' : 'transparent' }}>
                  <td style={{ ...S.td, fontWeight: 600, color: '#fff' }}>{r.name}</td>
                  <td style={{ ...S.td, ...statusStyle(r.status) }}>{r.status}</td>
                  <td style={S.td}>{r.mode || '—'}</td>
                  <td style={{ ...S.td, ...S.mono }}>
                    {r.detectedReps ?? '?'}/{r.targetReps ?? '?'}
                  </td>
                  <td style={{ ...S.td, ...S.mono, ...(r.repAccuracy === '100%' ? S.pass : {}) }}>
                    {r.repAccuracy || '—'}
                  </td>
                  <td style={{ ...S.td, ...S.mono }}>{r.avgQuality || '—'}</td>
                  <td style={{ ...S.td, ...S.mono }}>{r.phaseChanges ?? '—'}</td>
                  <td style={{ ...S.td, fontSize: 11 }}>
                    {r.uniquePhases?.join(', ') || '—'}
                  </td>
                  <td style={S.td}>
                    <button style={{ ...S.btnSec, padding: '4px 10px', fontSize: 12, marginBottom: 0 }}
                      onClick={() => runSingle(r.name)} disabled={running}>
                      Re-run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
