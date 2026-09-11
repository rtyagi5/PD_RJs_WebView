// The SeatedDorsiflexion recording that counted reps off noise.
//
// It was recorded with the right side to the camera, and every foot family was
// declared "both sides genuinely used" and left unmirrored - because the far
// foot is occluded side-on and MediaPipe's guesses at it wander as widely as
// the near foot really moves. A range test cannot tell motion from noise.
import { mirrorTemplateSides } from './videoFeatureExtractor';
import { EXERCISE_CONFIGS } from './specToReference';
// Imported directly rather than through references/index.js, which discovers
// files with webpack's require.context and so resolves to nothing under Jest.
import dorsiflexionRef from './references/SeatedDorsiflexion.ref.json';

const dorsiflexion = () => dorsiflexionRef;

const spanOf = (tpl, key) => {
  const vals = tpl.map(f => f.features?.[key]).filter(Number.isFinite);
  return Math.max(...vals) - Math.min(...vals);
};

describe('mirroring a one-sided recording', () => {
  it('is the shipped reference, recorded right, with the foot families unmirrored', () => {
    // Guards the premise. If this ever changes, the tests below prove nothing.
    const ref = dorsiflexion();
    expect(ref.provenance.recordedSide).toBe('right');
    expect(ref.provenance.bilateralFamilies).toEqual(
      expect.arrayContaining(['footPitchNorm', 'ankleAngleToe'])
    );
  });

  it('the range test alone leaves the occluded foot in place', () => {
    const tpl = dorsiflexion().template.map(f => ({ ...f, features: { ...f.features } }));
    const out = mirrorTemplateSides(tpl);
    expect(out.bilateral).toContain('footPitchNorm');
    // The idle side reaches 0.665 of the active side - two thirds of a real
    // movement, produced entirely by a limb the camera could not see.
    expect(spanOf(tpl, 'footPitchNormL') / spanOf(tpl, 'footPitchNormR'))
      .toBeGreaterThan(0.6);
  });

  it('mirrors every family when the exercise is performed one side at a time', () => {
    const tpl = dorsiflexion().template.map(f => ({ ...f, features: { ...f.features } }));
    const out = mirrorTemplateSides(tpl, { unilateral: true });
    expect(out.bilateral).toEqual([]);
    expect(out.mirrored.map(m => m.base)).toEqual(
      expect.arrayContaining(['footPitchNorm', 'ankleAngleToe', 'ankleAngleHeel'])
    );
  });

  it('copies the recorded side onto the other, exactly', () => {
    const before = dorsiflexion().template;
    const tpl = before.map(f => ({ ...f, features: { ...f.features } }));
    mirrorTemplateSides(tpl, { unilateral: true });
    for (let i = 0; i < tpl.length; i += 1) {
      expect(tpl[i].features.footPitchNormL).toBe(before[i].features.footPitchNormR);
    }
  });

  it('decides the recorded side once for the clip, not per family', () => {
    // ankleAngleHeel is the most lopsided family and footPitchNorm the least.
    // Deciding per family lets a noisy one mirror the wrong way; every family
    // must end up carrying the same side's data.
    const tpl = dorsiflexion().template.map(f => ({ ...f, features: { ...f.features } }));
    const out = mirrorTemplateSides(tpl, { unilateral: true });
    const froms = new Set(out.mirrored.map(m => m.from.slice(-1)));
    expect([...froms]).toEqual(['R']);
  });

  it('leaves a genuinely alternating exercise alone', () => {
    // Two legs really do move in an alternating exercise, and overwriting one
    // with the other would destroy the only thing that distinguishes them.
    const alternating = Object.values(EXERCISE_CONFIGS).filter(c => c.side === 'alternating');
    expect(alternating.length).toBeGreaterThan(0);
    const tpl = [
      { frame: 0, features: { kneeLiftNormL: 0.0, kneeLiftNormR: 0.4 } },
      { frame: 1, features: { kneeLiftNormL: 0.4, kneeLiftNormR: 0.0 } },
    ];
    const out = mirrorTemplateSides(tpl); // unilateral omitted, as for alternating
    expect(out.mirrored).toEqual([]);
    expect(tpl[0].features.kneeLiftNormL).toBe(0.0);
  });
});
