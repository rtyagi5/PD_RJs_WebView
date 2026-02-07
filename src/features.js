// ---------------------------------------------
// features.js
// ---------------------------------------------


export function angle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const m1 = Math.hypot(v1.x, v1.y);
    const m2 = Math.hypot(v2.x, v2.y);
    if (!m1 || !m2) return NaN;
    return (Math.acos(Math.min(1, Math.max(-1, dot / (m1 * m2)))) * 180) / Math.PI;
    }
    export const distance = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
    export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    export const slope = (a, b) => (Math.abs(b.x - a.x) < 1e-4 ? Infinity : (b.y - a.y) / (b.x - a.x));
    
    export class EMA {
        constructor(alpha = 0.35) {
        this.a = alpha;
        this.v = null;
        }
        next(x) {
        // Ignore non-finite inputs so a single NaN doesn't poison the filter
        if (!Number.isFinite(x)) return this.v;
        this.v = this.v == null ? x : this.a * x + (1 - this.a) * this.v;
        return this.v;
        }
        reset() { this.v = null; } // optional helper
    }
    
    
    
    export function kp(map, name) { return map?.find(k => k.name === name); }
    export function present(k, thr = 0.3) { return !!k && k.score > thr && k.x != null && k.y != null; }
    
    
    // Given a landmark map & side ("left"|"right"), compute common features used across specs
    export function computeCommonFeatures(kps, side) {
    const sh = kp(kps, `${side}_shoulder`);
    const el = kp(kps, `${side}_elbow`);
    const wr = kp(kps, `${side}_wrist`);
    const hip = kp(kps, `${side}_hip`);
    const knee = kp(kps, `${side}_knee`);
    const ankle = kp(kps, `${side}_ankle`);
    
    
    const shoulderAngle = (present(hip) && present(sh) && present(el)) ? angle(hip, sh, el) : NaN;
    const armAngle = (present(sh) && present(el) && present(wr)) ? angle(sh, el, wr) : NaN;
    const kneeAngle = (present(hip) && present(knee) && present(ankle)) ? angle(hip, knee, ankle) : NaN;
    
    
    return { shoulderAngle, armAngle, kneeAngle };
    }

    export function makeEMA(alpha = 0.35) {
        let v = null; const a = alpha;
        return {
          next(x) {
            if (!Number.isFinite(x)) return v;
            v = v == null ? x : a * x + (1 - a) * v;
            return v;
          },
          reset() { v = null; }
        };
      }
      