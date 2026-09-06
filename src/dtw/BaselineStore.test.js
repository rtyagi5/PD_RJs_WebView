// The point of this module is that failures are REPORTED rather than swallowed,
// so most of these tests are about status codes, not stored values.
import { LocalBaselineStore, SyncedBaselineStore, StoreStatus, isStorageFailure } from './BaselineStore';

describe('LocalBaselineStore', () => {
  let store;
  beforeEach(() => { localStorage.clear(); store = new LocalBaselineStore(); });

  it('uses the legacy key format so existing baselines keep working', () => {
    // Changing this silently orphans every baseline already on a patient device.
    expect(store.key('p1', 'SideArmRaise')).toBe('dtw_baseline_p1_SideArmRaise');
  });

  it('round-trips a value', () => {
    expect(store.saveSync('p1', 'SideArmRaise', { baseline: { a: 1 } }).status).toBe(StoreStatus.OK);
    const res = store.loadSync('p1', 'SideArmRaise');
    expect(res.status).toBe(StoreStatus.OK);
    expect(res.data.baseline.a).toBe(1);
  });

  it('reports EMPTY (not a failure) for a patient with nothing stored', () => {
    const res = store.loadSync('nobody', 'SideArmRaise');
    expect(res.status).toBe(StoreStatus.EMPTY);
    expect(isStorageFailure(res.status)).toBe(false);
  });

  it('reports CORRUPT rather than pretending the patient is new', () => {
    localStorage.setItem('dtw_baseline_p1_SideArmRaise', '{not json');
    const res = store.loadSync('p1', 'SideArmRaise');
    expect(res.status).toBe(StoreStatus.CORRUPT);
    expect(isStorageFailure(res.status)).toBe(true);
  });

  it('reports UNAVAILABLE when reading throws, and does not propagate', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: private browsing');
    });
    const res = store.loadSync('p1', 'SideArmRaise');
    expect(res.status).toBe(StoreStatus.UNAVAILABLE);
    expect(isStorageFailure(res.status)).toBe(true);
    spy.mockRestore();
  });

  it('reports UNAVAILABLE when writing throws (quota), and does not propagate', () => {
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => store.saveSync('p1', 'SideArmRaise', { a: 1 })).not.toThrow();
    expect(store.saveSync('p1', 'SideArmRaise', { a: 1 }).status).toBe(StoreStatus.UNAVAILABLE);
    spy.mockRestore();
  });

  it('keeps patients and exercises in separate keys', () => {
    store.saveSync('p1', 'SideArmRaise', { v: 'a' });
    store.saveSync('p2', 'SideArmRaise', { v: 'b' });
    store.saveSync('p1', 'BicepCurls', { v: 'c' });
    expect(store.loadSync('p1', 'SideArmRaise').data.v).toBe('a');
    expect(store.loadSync('p2', 'SideArmRaise').data.v).toBe('b');
    expect(store.loadSync('p1', 'BicepCurls').data.v).toBe('c');
  });

  it('exposes an async surface over the same behaviour', async () => {
    await store.save('p1', 'SideArmRaise', { v: 1 });
    await expect(store.load('p1', 'SideArmRaise')).resolves.toMatchObject({ status: StoreStatus.OK });
    await expect(store.sync()).resolves.toMatchObject({ pushed: 0, pending: 0 });
  });
});

describe('SyncedBaselineStore', () => {
  it('refuses to construct until the backend contract is built', () => {
    // Failing loudly beats a store that silently drops every write.
    expect(() => new SyncedBaselineStore()).toThrow(/not implemented/i);
  });
});
