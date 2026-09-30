/**
 * Core solar noon (solar transit) calculator.
 *
 * Implemented algorithm: NOAA / NREL solar position algorithm (SPA) solar transit
 * via Julian Day, plus a simple longitude-based approximation for day length.
 *
 * The function returns the UTC time-of-day of solar transit as milliseconds
 * since the UTC midnight that begins the date supplied by `date`. If the date's
 * integer-valued day (UTC) differs from the local date in the given timezone,
 * the caller should provide the `date` that corresponds to the local date they
 * care about, and we will compute transit for that calendar day interpreted in
 * the requested timezone.
 *
 * All date math is done in UTC milliseconds; we convert to a local clock string
 * only in `formatSolarNoon()`.
 *
 * Returns a plain object so callers can inspect the raw ms value without
 * parsing a string. String formatting is deliberately a separate function.
 */

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

const JULIAN_UNIX_EPOCH = 2_440_587.5;

/**
 * Julian Day Number for a Date instance, as a float.
 *
 * JD = (unix ms) / 86_400_000 + 2440587.5
 *
 * The +0.5 fractional offset exists because the Julian day starts at noon, not
 * midnight. We keep it because standard astronomical formulas (and thus the
 * NOAA coefficient tables we lean on) assume a noon-based Julian day.
 *
 * @param {Date} date
 * @returns {number}
 */
export function julianDay(date) {
  return date.getTime() / MS_PER_DAY + JULIAN_UNIX_EPOCH;
}

/**
 * Julian Day at 0h UT (midnight UTC) for the calendar day containing `date`.
 *
 * @param {Date} date
 * @returns {number}
 */
function julianDayAtMidnightUtc(date) {
  const startOfDayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return julianDay(new Date(startOfDayUtc));
}

/**
 * Mean solar longitude (L0), in degrees, from the Astronomical Almanac.
 *
 * Polynomial coefficients from the NREL SPA document; we use only the L0 table
 * which is sufficient for the ~minute precision we target.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function meanSolarLongitude(t) {
  const t2 = t * t;
  const t3 = t2 * t;

  let L0 = 280.46646 + t * (36000.76983 + 0.0003032 * t);
  L0 += t2 * (3.0342e-4) + t3 * (2.8e-8);

  // Normalize to [0, 360).
  L0 = ((L0 % 360) + 360) % 360;
  return L0;
}

/**
 * Mean anomaly of the Sun (M), in degrees, from the NREL SPA tables.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function meanSolarAnomaly(t) {
  const t2 = t * t;

  let M = 357.52911 + t * (35999.05029 - 0.0001537 * t2);
  M += t2 * (4.849e-4);

  M = ((M % 360) + 360) % 360;
  return M;
}

/**
 * Equation of center C, in degrees, using NREL's sine coefficients.
 *
 * @param {number} M  Mean anomaly, degrees
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function equationOfCenter(M, t) {
  const t2 = t * t;

  const Mrad = (M * Math.PI) / 180;

  let C = Math.sin(Mrad) * (1.914602 - t * (0.004817 + 0.000014 * t2));
  C += Math.sin(2 * Mrad) * (0.019993 - 0.000101 * t);
  C += Math.sin(3 * Mrad) * (0.000289);

  return C;
}

/**
 * True solar longitude, in degrees.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function trueSolarLongitude(t) {
  const L0 = meanSolarLongitude(t);
  const M = meanSolarAnomaly(t);
  const C = equationOfCenter(M, t);

  // Apparent longitude includes nutation and aberration corrections.
  const omega = 125.04 - 1934.136 * t;
  const omegaRad = (omega * Math.PI) / 180;

  let lambda = L0 + C + 0.00569 + 0.00478 * Math.sin(omegaRad);
  lambda = ((lambda % 360) + 360) % 360;
  return lambda;
}

/**
 * Apparent solar longitude, in degrees, same as trueSolarLongitude here.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function apparentSolarLongitude(t) {
  return trueSolarLongitude(t);
}

/**
 * Mean obliquity of the ecliptic, in degrees, from the NREL SPA polynomial.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function meanObliquity(t) {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * (0.001813)));
  return 23.0 + (26.0 + seconds / 60.0) / 60.0;
}

/**
 * Corrected obliquity, in degrees, including nutation in longitude.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function correctedObliquity(t) {
  const eps0 = meanObliquity(t);
  const omega = 125.04 - 1934.136 * t;
  const omegaRad = (omega * Math.PI) / 180;
  return eps0 + 0.00256 * Math.cos(omegaRad);
}

/**
 * Solar declination, in degrees, from apparent solar longitude and obliquity.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function solarDeclination(t) {
  const lambda = apparentSolarLongitude(t);
  const eps = correctedObliquity(t);

  const lambdaRad = (lambda * Math.PI) / 180;
  const epsRad = (eps * Math.PI) / 180;

  const declRad = Math.asin(Math.sin(epsRad) * Math.sin(lambdaRad));
  return (declRad * 180) / Math.PI;
}

/**
 * Equation of time, in minutes, per the NREL polynomial approximation.
 *
 * @param {number} t  Centuries since J2000.0
 * @returns {number}
 */
function equationOfTime(t) {
  const eps0 = meanObliquity(t);
  const L0 = meanSolarLongitude(t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t * t);
  const M = meanSolarAnomaly(t);

  const Mrad = (M * Math.PI) / 180;
  const Lrad = (L0 * Math.PI) / 180;
  const epsRad = (eps0 * Math.PI) / 180;

  let y = Math.tan(epsRad / 2);
  y = y * y;

  const sin2L = Math.sin(2 * Lrad);
  const cos2L = Math.cos(2 * Lrad);
  const sin4L = Math.sin(4 * Lrad);
  const sinM = Math.sin(Mrad);
  const sin3M = Math.sin(3 * Mrad);

  let eot = y * sin2L - 2 * e * sinM + 4 * e * y * sinM * cos2L
    - 0.5 * y * y * sin4L - 1.25 * e * e * sin3M;

  // The summation above yields a result in radians. Convert to minutes of
  // time: 1 radian = 180/π degrees = (180/π)/15 hours = (180/π)/15 * 60
  // minutes = (180/π) * 4 minutes.
  eot *= (4 * 180) / Math.PI;

  return eot;
}

/**
 * Compute solar transit (solar noon) for a given calendar date, latitude, longitude.
 *
 * Algorithm sketch (NOAA / NREL SPA):
 *   1. JD0 = Julian Day at 0h UT of the requested date.
 *   2. t  = (JD0 - 2451545) / 36525.
 *   3. Compute the equation of time (EoT) in minutes.
 *   4. Solar transit (UT minutes since midnight) ≈ 720 - 4*longitude - EoT
 *      where longitude is positive east (we accept west-positive as input and
 *      flip sign internally; see below for why).
 *   5. Return transit time as ms since the UTC midnight of `date`.
 *
 * Why west-positive longitude internally: we accept the geographic convention
 * (positive = east of the prime meridian) on the public API. Internally the
 * NOAA formula is written as (720 - 4*lon - EoT) for west-positive longitudes;
 * we substitute -lon to keep the API east-positive, which is the convention
 * used by JSR-107, GeoJSON, and most modern geo libraries.
 *
 * @param {Date}   date       Calendar date (only Y/M/D are used; time-of-day is ignored).
 * @param {number} latitude   Latitude in degrees, positive north. (Currently unused in the
 *                            transit computation but accepted for API symmetry; solar
 *                            transit time is independent of latitude to first order.)
 * @param {number} longitude  Longitude in degrees, positive east.
 * @returns {{
 *   transitUtcMs: number,   // ms since UTC midnight of `date` (may exceed 86400000 or be negative
 *                           // near poles / at extreme longitudes; see README).
 *   date: Date,              // The input date (a copy) for reference.
 *   longitude: number,      // Echoed input longitude.
 *   latitude: number,       // Echoed input latitude.
 * }}
 */
export function computeSolarNoon(date, latitude, longitude) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('computeSolarNoon: `date` must be a valid Date instance');
  }
  if (typeof latitude !== 'number' || Number.isNaN(latitude)) {
    throw new TypeError('computeSolarNoon: `latitude` must be a number');
  }
  if (typeof longitude !== 'number' || Number.isNaN(longitude)) {
    throw new TypeError('computeSolarNoon: `longitude` must be a number');
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError('computeSolarNoon: `latitude` must be within [-90, 90]');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError('computeSolarNoon: `longitude` must be within [-180, 180]');
  }

  const jd0 = julianDayAtMidnightUtc(date);
  const t = (jd0 - 2_451_545.0) / 36_525.0;

  const eotMinutes = equationOfTime(t);

  // Convert east-positive longitude to the west-positive convention used by
  // the textbook NOAA formula.
  const lonWestPositive = -longitude;

  // Solar transit in minutes since UT midnight.
  const transitMinutes = 720.0 + 4.0 * lonWestPositive - eotMinutes;

  const transitUtcMs = transitMinutes * MS_PER_MINUTE;

  return {
    transitUtcMs,
    date: new Date(date.getTime()),
    latitude,
    longitude,
  };
}

/**
 * Format a solar transit result as a wall-clock time string in a given IANA timezone.
 *
 * The string is produced via Intl.DateTimeFormat in 'en-CA' locale with
 * hour12:false and a fixed 'HH:mm' pattern. We use 'en-CA' specifically because
 * it yields zero-padded 24-hour times like "12:34" without locale quirks.
 *
 * @param {{transitUtcMs: number, date: Date}} result
 * @param {string} timeZone  IANA timezone identifier, e.g. 'America/New_York'.
 * @returns {string}  Local wall-clock time, e.g. "12:34".
 */
export function formatSolarNoon(result, timeZone) {
  if (!result || typeof result.transitUtcMs !== 'number' || !(result.date instanceof Date)) {
    throw new TypeError('formatSolarNoon: first argument must be a computeSolarNoon result');
  }
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new TypeError('formatSolarNoon: `timeZone` must be a non-empty IANA identifier');
  }

  const startOfDayUtc = Date.UTC(
    result.date.getUTCFullYear(),
    result.date.getUTCMonth(),
    result.date.getUTCDate(),
  );
  const instantMs = startOfDayUtc + result.transitUtcMs;
  const instant = new Date(instantMs);

  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  // en-CA can produce e.g. "24:00" for midnight; normalize to "00:00" for display.
  let s = fmt.format(instant);
  if (s.startsWith('24')) {
    s = '00' + s.slice(2);
  }
  return s;
}
