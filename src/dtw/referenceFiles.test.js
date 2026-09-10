import fs from 'fs';
import path from 'path';
import { checkPhaseSeparation } from './referenceHealth';
import { applyCanonicalPolicy, CANONICAL_FIELDS } from './bootstrapReferences';
import { generateAllReferences } from './specToReference';
import { DTWPhaseMachine } from './DTWPhaseMachine';

// Runs the recorded .ref.json files through exactly what bootstrapAllReferences
// does at app startup, so a reference that would be silently rejected on the
// phone is caught here instead.

const dir = path.resolve(__dirname, 'references');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.ref.json')) : [];

it('recorded references would load and drive the engine', () => {
  if (!files.length) {
    console.log('[refs] none present');
    return;
  }
  const canonical = generateAllReferences();

  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const lines = [`\n=== ${f} ===`];

    const known = !!canonical[raw.name];
    lines.push(`  name "${raw.name}" ${known ? 'matches a canonical exercise' : 'IS NOT A KNOWN EXERCISE — would never be used'}`);
    if (!known) { console.log(lines.join('\n')); continue; }

    const health = checkPhaseSeparation(raw);
    lines.push(`  phase separation: ${health.ok ? 'OK' : 'REJECTED — ' + health.reason}`);

    const ref = applyCanonicalPolicy(raw, canonical[raw.name]);
    lines.push(`  detector=${ref.detector} mode=${ref.mode} side=${ref.side} ` +
      `primaryFeatureBase=${ref.primaryFeatureBase} minRomPct=${ref.minRomPct}`);

    const counts = {};
    for (const t of ref.template) counts[t.phase] = (counts[t.phase] || 0) + 1;
    lines.push(`  phases: ${JSON.stringify(counts)}  cycle: ` +
      `${ref.repCycle?.start} -> ${ref.repCycle?.effort} -> ${ref.repCycle?.return ?? ref.repCycle?.start}`);

    for (const side of ['left', 'right']) {
      const eng = new DTWPhaseMachine(ref, { targetReps: 5, side });
      lines.push(
        `  side=${side.padEnd(5)} primary=${String(eng.primaryFeature).padEnd(18)} ` +
        `range=${Number(eng.primaryFeatureRange).toFixed(3).padStart(8)} ` +
        `romGate=${Number(eng.minRomForRep).toFixed(3).padStart(7)} ` +
        `nearStart=${Number(eng.nearStartTolerance).toFixed(3).padStart(7)} ` +
        `dir=${eng.templateDirection}`
      );
      expect(eng.primaryFeature).not.toBeNull();
      expect(eng.primaryFeatureRange).toBeGreaterThan(0);
      expect(eng.nearStartTolerance).toBeGreaterThan(0);
    }

    console.log(lines.join('\n'));
    expect(health.ok).toBe(true);
  }
});

// ─── Canonical fields survive a recording ────────────────────────────────────
// A .ref.json replaces the synthetic reference WHOLESALE. Anything the recorder
// does not write is therefore gone unless applyCanonicalPolicy puts it back.
// highlightKeypoints was missing from that list, so dropping in a recorded
// reference silently emptied the highlight name list and drew the entire
// skeleton "aqua" — the green limb-in-focus cue disappeared with no error.
describe('recorded references keep their highlight parts', () => {
  it('lists highlightKeypoints as canonical', () => {
    expect(CANONICAL_FIELDS).toContain('highlightKeypoints');
  });

  it('restores highlightKeypoints onto a recording that lacks them', () => {
    const canonical = { highlightKeypoints: ['shoulder', 'elbow', 'wrist'] };
    const recorded = { name: 'SideArmRaise', template: [] };
    expect(recorded.highlightKeypoints).toBeUndefined();
    const merged = applyCanonicalPolicy(recorded, canonical);
    expect(merged.highlightKeypoints).toEqual(['shoulder', 'elbow', 'wrist']);
  });
});
