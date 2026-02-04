/**
 * Shared utility functions
 */

/**
 * Generates SQL condition for date range overlap check.
 * Returns SQL that checks if date range A overlaps with date range B.
 * @param {string} aStart - Column/value for range A start date
 * @param {string} aEnd - Column/value for range A end date
 * @param {string} bStart - Column/value for range B start date
 * @param {string} bEnd - Column/value for range B end date
 * @returns {string} SQL condition string
 */
function overlapCondition(aStart, aEnd, bStart, bEnd) {
    return `NOT (date(${aEnd}) < date(${bStart}) OR date(${aStart}) > date(${bEnd}))`;
}

module.exports = { overlapCondition };
