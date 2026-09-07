import { resolvePrimaryFeatureKey } from './videoFeatureExtractor';
import { EXERCISE_CONFIGS } from './specToReference';

// The extractor used to choose which feature counts reps by ranking raw feature
// ranges. That is invalid across families, because the universal feature set
// mixes degrees with dimensionless ratios.
//
// Real failure it caused: a seated dorsiflexion clip where the demonstrator sits
// down, settles, and moves their arms. elbowAngleMin sweeps ~100 degrees; the
// actual exercise, footPitchNorm, sweeps 0.17. The elbow wins on magnitude, and
// phase labelling then fails outright with "cannot tell which end of
// elbowAngleMin is the rest posture for SeatedDorsiflexion" — which is the
// labeller correctly refusing to guess, on a feature it should never have been
// handed.

/** Frames where the arms move a lot and the foot moves a little, as when seated. */
function seatedDorsiflexionClip({ footSwing = 0.17, elbowSwing = 100 } = {}) {
  const frames = [];
  for (let i = 0; i < 120; i++) {
    const cycle = Math.sin((i / 120) * Math.PI * 6);
    frames.push({
      features: {
        footPitchNormL: 0.12 - footSwing * Math.max(0, cycle),
        footPitchNormR: 0.12,                       // far foot, barely tracked
        elbowAngleL: 90 + (elbowSwing / 2) * Math.sin(i / 9),
        elbowAngleR: 90 + (elbowSwing / 2) * Math.sin(i / 11),
        elbowAngleMin: 40 + (elbowSwing / 2) * Math.sin(i / 9),
        kneeAngleL: 95,
        shoulderAngleL: 20 + 30 * Math.sin(i / 7),
      },
    });
  }
  return frames;
}

describe('resolvePrimaryFeatureKey', () => {
  const frames = seatedDorsiflexionClip();

  it('picks the foot for a dorsiflexion clip where the arms move far more', () => {
    const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, frames);
    expect(key).toBe('footPitchNormL');
  });

  it('picks the side that actually moved', () => {
    // Side-on, only the near foot is tracked well. The family is declared; which
    // side is exercised is not, and cannot be known before the clip is seen.
    const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, frames);
    expect(key.endsWith('L')).toBe(true);
  });

  it('is not swayed by making the arms move even more', () => {
    // The whole point: no elbow range can outvote the declared family.
    const wild = seatedDorsiflexionClip({ elbowSwing: 100000 });
    expect(resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, wild))
      .toBe('footPitchNormL');
  });

  it('honours an exact primaryFeature pin over the family', () => {
    const cfg = EXERCISE_CONFIGS.MiniSquats;
    expect(cfg.primaryFeature).toBe('kneeAngleMin');
    const f = [{ features: { kneeAngleMin: 90, elbowAngleL: 10 } },
               { features: { kneeAngleMin: 160, elbowAngleL: 9000 } }];
    expect(resolvePrimaryFeatureKey(cfg, f)).toBe('kneeAngleMin');
  });

  it('resolves every foot exercise to its foot feature', () => {
    for (const name of ['CalfRaisesSeated', 'CalfRaisesStanding',
      'SeatedDorsiflexion', 'StandingDorsiflexion']) {
      const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS[name], frames);
      expect(`${name}:${key}`).toBe(`${name}:footPitchNormL`);
    }
  });

  it('falls back to the features the canonical template sweeps', () => {
    // An exercise with no explicit pin still must not be handed a feature its
    // own template says nothing about.
    const key = resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SideArmRaise, frames);
    expect(key).toBe('shoulderAngleL');
  });

  it('returns null for a free-text name, so the old ranking still applies', () => {
    expect(resolvePrimaryFeatureKey(null, frames)).toBeNull();
    expect(resolvePrimaryFeatureKey(undefined, frames)).toBeNull();
  });

  it('returns null rather than a key the clip never produced', () => {
    // A clip with no foot keypoints at all must not claim footPitchNorm.
    const noFoot = [{ features: { elbowAngleL: 10 } }, { features: { elbowAngleL: 90 } }];
    expect(resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, noFoot)).toBeNull();
  });

  it('does not throw on an empty clip', () => {
    expect(resolvePrimaryFeatureKey(EXERCISE_CONFIGS.SeatedDorsiflexion, [])).toBeNull();
  });
});
