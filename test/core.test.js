import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeSolarNoon, formatSolarNoon, julianDay } from '../src/index.js';

/**
 * Convenience: run computeSolarNoon for a UTC date and format in a timezone.
 *
 * @param {number} year
 * @param {number} month  0-based (Date constructor convention)
 * @param {number} day
 * @param {number} latitude
 * @param {number} longitude
 * @param {string} timeZone
 * @returns {{transitUtcMs: number, date: Date, latitude: number, longitude: number, formatted: string}}
 */
function run(year, month, day, latitude, longitude, timeZone) {
  const date = new Date(Date.UTC(year, month, day));
  const r = computeSolarNoon(date, latitude, longitude);
  return { ...r, formatted: formatSolarNoon(r, timeZone) };
}

test('julianDay for J2000.0 epoch (2000-01-01 12:00 UT) is 2451545.0', () => {
  const d = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
  const jd = julianDay(d);
  // Use a tolerance because JD is a float derived from ms.
  assert.ok(Math.abs(jd - 2451545.0) < 1e-6, `expected ~2451545.0, got ${jd}`);
});

test('julianDay for 1970-01-01 00:00 UT is 2440587.5', () => {
  const d = new Date(Date.UTC(1970, 0, 1, 0, 0, 0));
  const jd = julianDay(d);
  assert.ok(Math.abs(jd - 2440587.5) < 1e-6, `expected ~2440587.5, got ${jd}`);
});

test('solar noon in UTC for Greenwich (lon 0) is near 12:00', () => {
  const r = run(2024, 5, 21, 51.4779, 0.0, 'UTC');
  // Allow ±10 minutes for EoT variation; June solstice EoT is small.
  assert.match(r.formatted, /^1[12]:[0-5][0-9]$/);
  assert.ok(r.transitUtcMs > 11 * 3_600_000 && r.transitUtcMs < 13 * 3_600_000);
});

test('solar noon moves ~4 minutes earlier per degree east', () => {
  // Same date, two longitudes 15° apart. Difference should be ~60 minutes.
  const east = run(2024, 5, 21, 0.0, 15.0, 'UTC');
  const west = run(2024, 5, 21, 0.0, 0.0, 'UTC');
  const diffMinutes = (west.transitUtcMs - east.transitUtcMs) / 60_000;
  assert.ok(Math.abs(diffMinutes - 60) < 5, `expected ~60 min diff, got ${diffMinutes}`);
});

test('solar noon in America/New_York is afternoon local time in June', () => {
  const r = run(2024, 5, 21, 40.7128, -74.006, 'America/New_York');
  // NYC is EDT in June (UTC-4). Expect a time between 12:00 and 13:30 local.
  const [h, m] = r.formatted.split(':').map(Number);
  const minutes = h * 60 + m;
  assert.ok(minutes >= 12 * 60 && minutes <= 13 * 60 + 30,
    `expected 12:00-13:30, got ${r.formatted}`);
});

test('solar noon in Asia/Tokyo is morning local time (UTC+9)', () => {
  const r = run(2024, 5, 21, 35.6762, 139.6503, 'Asia/Tokyo');
  // Tokyo at ~140°E, June EoT ~ -2 min. Local noon ≈ 11:43.
  const [h, m] = r.formatted.split(':').map(Number);
  const minutes = h * 60 + m;
  assert.ok(minutes >= 11 * 60 + 35 && minutes <= 11 * 60 + 55,
    `expected ~11:35-11:55, got ${r.formatted}`);
});

test('solar transit is independent of latitude to first order', () => {
  // Moving along a meridian should not materially change transit time.
  const a = run(2024, 5, 21, 0.0, 0.0, 'UTC');
  const b = run(2024, 5, 21, 60.0, 0.0, 'UTC');
  assert.ok(Math.abs(a.transitUtcMs - b.transitUtcMs) < 60_000,
    `latitude should not change transit by more than ~1 min, got Δ=${a.transitUtcMs - b.transitUtcMs}ms`);
});

test('EoT shifts noon earlier in early November', () => {
  // Around Nov 3, EoT is near +16 min; noon at lon 0 is ~11:44 UT.
  const r = run(2024, 10, 3, 51.4779, 0.0, 'UTC');
  const [h, m] = r.formatted.split(':').map(Number);
  const minutes = h * 60 + m;
  assert.ok(minutes <= 11 * 60 + 50,
    `expected <=11:50 due to EoT, got ${r.formatted}`);
});

test('EoT shifts noon later in mid-February', () => {
  // Around Feb 11-12, EoT is near -14 min; noon at lon 0 is ~12:14 UT.
  const r = run(2024, 1, 11, 51.4779, 0.0, 'UTC');
  const [h, m] = r.formatted.split(':').map(Number);
  const minutes = h * 60 + m;
  assert.ok(minutes >= 12 * 60 + 5,
    `expected >=12:05 due to EoT, got ${r.formatted}`);
});

test('invalid date throws TypeError', () => {
  assert.throws(() => computeSolarNoon(new Date('not-a-date'), 0, 0), TypeError);
});

test('non-Date first argument throws TypeError', () => {
  assert.throws(() => computeSolarNoon('2024-06-21', 0, 0), TypeError);
});

test('out-of-range latitude throws RangeError', () => {
  assert.throws(() => computeSolarNoon(new Date(Date.UTC(2024, 5, 21)), 91, 0), RangeError);
  assert.throws(() => computeSolarNoon(new Date(Date.UTC(2024, 5, 21)), -91, 0), RangeError);
});

test('out-of-range longitude throws RangeError', () => {
  assert.throws(() => computeSolarNoon(new Date(Date.UTC(2024, 5, 21)), 0, 181), RangeError);
  assert.throws(() => computeSolarNoon(new Date(Date.UTC(2024, 5, 21)), 0, -181), RangeError);
});

test('NaN latitude throws TypeError', () => {
  assert.throws(() => computeSolarNoon(new Date(Date.UTC(2024, 5, 21)), NaN, 0), TypeError);
});

test('formatSolarNoon rejects malformed results', () => {
  assert.throws(() => formatSolarNoon({}, 'UTC'), TypeError);
  assert.throws(() => formatSolarNoon(null, 'UTC'), TypeError);
});

test('formatSolarNoon rejects empty or non-string timezone', () => {
  const r = computeSolarNoon(new Date(Date.UTC(2024, 5, 21)), 0, 0);
  assert.throws(() => formatSolarNoon(r, ''), TypeError);
  assert.throws(() => formatSolarNoon(r, 123), TypeError);
});

test('result object exposes the documented fields with correct types', () => {
  const date = new Date(Date.UTC(2024, 5, 21));
  const r = computeSolarNoon(date, 10, 20);
  assert.equal(typeof r.transitUtcMs, 'number');
  assert.ok(r.date instanceof Date);
  assert.equal(r.latitude, 10);
  assert.equal(r.longitude, 20);
  // date should be a copy, not the same reference.
  assert.notEqual(r.date, date);
});

test('time-of-day in the input Date is ignored', () => {
  const morning = new Date(Date.UTC(2024, 5, 21, 6, 0, 0));
  const evening = new Date(Date.UTC(2024, 5, 21, 18, 0, 0));
  const a = computeSolarNoon(morning, 0, 0);
  const b = computeSolarNoon(evening, 0, 0);
  assert.equal(a.transitUtcMs, b.transitUtcMs);
});

test('date wrap-around: positive far-east longitude yields transit near 00:00 local next day', () => {
  // At lon ~180°E on a date where EoT ~0, transit UT ≈ 00:00. The local
  // time depends on the timezone; we just check the value is finite and
  // the formatter does not throw.
  const r = run(2024, 5, 21, 0.0, 179.0, 'Pacific/Auckland');
  assert.equal(typeof r.formatted, 'string');
  assert.match(r.formatted, /^[0-2][0-9]:[0-5][0-9]$/);
});

test('deterministic: same inputs always produce same outputs', () => {
  const a = run(2024, 5, 21, 40.7128, -74.006, 'America/New_York');
  const b = run(2024, 5, 21, 40.7128, -74.006, 'America/New_York');
  assert.equal(a.transitUtcMs, b.transitUtcMs);
  assert.equal(a.formatted, b.formatted);
});
