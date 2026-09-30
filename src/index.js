/**
 * Public entrypoint for the solar-noon-calculator library.
 *
 * Re-exports the compute and format functions plus the low-level Julian Day
 * helper so callers can compose their own tooling if they wish.
 */

export { computeSolarNoon, formatSolarNoon, julianDay } from './core.js';
