# Solar Noon Calculator

Computes the exact solar transit time ("solar noon") for a given latitude,
longitude, and date, and formats it as a wall-clock string in any IANA
timezone. Pure JavaScript, ESM, zero dependencies.

## Usage

```js
import { computeSolarNoon, formatSolarNoon } from 'solar-noon-calculator';

const date = new Date(Date.UTC(2024, 5, 21));        // 2024-06-21 (date only)
const r = computeSolarNoon(date, 40.7128, -74.006); // NYC lat/lon (east-positive)
console.log(formatSolarNoon(r, 'America/New_York')); // e.g. "12:01"
```

`computeSolarNoon(date, latitude, longitude)` returns
`{ transitUtcMs, date, latitude, longitude }` where `transitUtcMs` is
milliseconds since UTC midnight of the supplied date. `formatSolarNoon(result,
timeZone)` formats that instant in the given IANA timezone as `HH:mm`.

## Why this exists

Existing solar-position libraries tend to be large and to bundle a full SPA
table for every quantity NOAA publishes. For the single question "when is solar
noon today, in my local clock time?" most of that is dead weight. This library
implements just the solar-transit branch of the NOAA/NREL algorithm: Julian Day,
equation of time, longitude correction. Precision is on the order of one
minute of clock time, which is more than enough for civil purposes and for
scheduling reminders. The trade-off is that we do not compute sunrise, sunset,
twilight, or elevation angles.

## The awkward edge

Longitudes near ±180° combined with timezones that span the antimeridian can
push `transitUtcMs` outside the `[0, 86400000)` range, because solar transit on
the requested calendar date (UTC) may actually fall on the previous or next UTC
day in local time. We do not clamp: the value returned is the physical transit
instant, and `formatSolarNoon` will still format it correctly in the requested
timezone. If you need the transit on a specific *local* calendar day, supply
the `Date` whose UTC Y/M/D corresponds to that local day.

Latitude is currently accepted for API symmetry but does not affect the
transit time — solar transit is, to first order, independent of latitude. We
validate it ([-90, 90]) but do not use it in the computation.

Longitude uses the geographic convention: **positive = east**. This matches
GeoJSON, JSR-107, and most modern geo libraries; it does *not* match the
west-positive convention some astronomy textbooks use internally.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

