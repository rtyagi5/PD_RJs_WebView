// ---------------------------------------------
// dtw/BaselineStore.js
// Storage abstraction for patient baselines.
//
// PatientBaseline used to call localStorage directly and swallow every failure
// in a try/catch that only console.warn'd. That made three genuinely different
// situations indistinguishable to the caller:
//
//   1. This patient has no baseline yet   -> calibrate, this is normal
//   2. Storage is unavailable (private browsing, quota, disabled cookies)
//   3. Storage held corrupt JSON
//
// Cases 2 and 3 must NOT silently look like case 1. If they do, the engine
// quietly falls back to the template ROM gate while the UI keeps reporting
// baseline-relative progress — i.e. it shows numbers that mean nothing.
// Every method here returns an explicit status so the caller can tell them apart.
//
// The async surface (load/save/sync) is what SyncedBaselineStore will implement
// once the server contract in docs/BASELINE_SYNC_CONTRACT.md is built. The sync
// surface (loadSync/saveSync) exists because PatientBaseline loads inside its
// constructor and localStorage is synchronous; removing that would change
// construction semantics for every existing caller and test.
// ---------------------------------------------

export const StoreStatus = {
  OK: 'ok',                   // value read/written successfully
  EMPTY: 'empty',             // storage worked, nothing stored for this key
  UNAVAILABLE: 'unavailable', // storage API missing or threw (private browsing, quota)
  CORRUPT: 'corrupt',         // storage worked, contents did not parse
};

/** True when the status means we could not trust storage, as opposed to it simply being empty. */
export function isStorageFailure(status) {
  return status === StoreStatus.UNAVAILABLE || status === StoreStatus.CORRUPT;
}

const STORAGE_PREFIX = 'dtw_baseline_';

/**
 * Abstract interface. Concrete stores override the *Sync methods; the async
 * wrappers are provided here so callers can migrate to await without a rewrite.
 */
export class BaselineStore {
  // eslint-disable-next-line no-unused-vars
  loadSync(patientId, exerciseName) {
    throw new Error('BaselineStore.loadSync not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  saveSync(patientId, exerciseName, data) {
    throw new Error('BaselineStore.saveSync not implemented');
  }

  load(patientId, exerciseName) {
    return Promise.resolve(this.loadSync(patientId, exerciseName));
  }

  save(patientId, exerciseName, data) {
    return Promise.resolve(this.saveSync(patientId, exerciseName, data));
  }

  /** @returns {Promise<{pushed:number, failed:number, pending:number}>} */
  sync() {
    return Promise.resolve({ pushed: 0, failed: 0, pending: 0 });
  }
}

/**
 * localStorage-backed store. This is current behaviour, lifted out of
 * PatientBaseline unchanged except that failures are now reported rather than
 * only logged.
 */
export class LocalBaselineStore extends BaselineStore {
  constructor(opts = {}) {
    super();
    this.prefix = opts.prefix ?? STORAGE_PREFIX;
  }

  key(patientId, exerciseName) {
    return `${this.prefix}${patientId}_${exerciseName}`;
  }

  loadSync(patientId, exerciseName) {
    const key = this.key(patientId, exerciseName);
    let raw;
    // Reading and parsing are separated deliberately: a throw from getItem means
    // storage itself is unavailable, while a throw from JSON.parse means the
    // storage worked and the *contents* are bad. Those need different responses.
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) {
        return { status: StoreStatus.UNAVAILABLE, data: null, error: 'localStorage undefined' };
      }
      raw = localStorage.getItem(key);
    } catch (e) {
      console.warn('[BaselineStore] localStorage read failed:', e);
      return { status: StoreStatus.UNAVAILABLE, data: null, error: String(e) };
    }

    if (!raw) return { status: StoreStatus.EMPTY, data: null, error: null };

    try {
      return { status: StoreStatus.OK, data: JSON.parse(raw), error: null };
    } catch (e) {
      console.warn('[BaselineStore] stored baseline did not parse:', e);
      return { status: StoreStatus.CORRUPT, data: null, error: String(e) };
    }
  }

  saveSync(patientId, exerciseName, data) {
    const key = this.key(patientId, exerciseName);
    try {
      if (typeof localStorage === 'undefined' || localStorage === null) {
        return { status: StoreStatus.UNAVAILABLE, error: 'localStorage undefined' };
      }
      localStorage.setItem(key, JSON.stringify(data));
      return { status: StoreStatus.OK, error: null };
    } catch (e) {
      console.warn('[BaselineStore] localStorage save failed:', e);
      return { status: StoreStatus.UNAVAILABLE, error: String(e) };
    }
  }
}

/**
 * Server-backed store: local write-ahead cache + outbox + server as system of
 * record. Not implemented — the contract it must satisfy is specified in
 * docs/BASELINE_SYNC_CONTRACT.md and the endpoints do not exist yet.
 *
 * It is declared here (rather than left out) so the injection point is real and
 * the eventual swap is a one-line change at the construction site.
 */
export class SyncedBaselineStore extends BaselineStore {
  constructor() {
    super();
    throw new Error(
      'SyncedBaselineStore is not implemented — the backend endpoints in ' +
      'docs/BASELINE_SYNC_CONTRACT.md do not exist yet. Use LocalBaselineStore.'
    );
  }
}

/** Default store used when a caller does not inject one. */
export const defaultBaselineStore = new LocalBaselineStore();
