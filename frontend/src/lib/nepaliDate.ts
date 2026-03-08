/**
 * Bikram Sambat (BS) to Gregorian (AD) date converter.
 *
 * Nepal uses the Bikram Sambat calendar which is ~56.7 years ahead of Gregorian.
 * This provides approximate conversion using lookup tables for accuracy.
 */

// Days in each month for BS years (index 0 = Baisakh, index 11 = Chaitra)
// Verified data for years 2075-2090 BS
const BS_MONTH_DAYS: Record<number, number[]> = {
  2075: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], // 365
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 366
  2077: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 365
  2078: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 365
  2079: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 366
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 366
  2081: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 365
  2082: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 366
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 365
  2084: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 365
  2085: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 366
  2086: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 366
  2087: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], // 365
  2088: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30], // 365
  2089: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31], // 366
  2090: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31], // 366
};

// Reference point: 2080-01-01 BS = 2023-04-14 AD (more recent for accuracy)
const BS_REFERENCE = { year: 2080, month: 1, day: 1 };
const AD_REFERENCE = new Date(2023, 3, 14); // April 14, 2023

/**
 * Convert BS date string to Gregorian Date object.
 * @param bsDate - Date in format "YYYY-MM-DD" (e.g., "2082-09-11")
 * @returns Gregorian Date object or null if invalid
 */
export function bsToAd(bsDate: string): Date | null {
  const match = bsDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const bsYear = parseInt(match[1], 10);
  const bsMonth = parseInt(match[2], 10);
  const bsDay = parseInt(match[3], 10);

  // Validate ranges
  if (bsMonth < 1 || bsMonth > 12 || bsDay < 1 || bsDay > 32) {
    return null;
  }

  // Calculate days from reference
  let totalDays = 0;

  // Add days for full years
  for (let year = BS_REFERENCE.year; year < bsYear; year++) {
    const monthDays = BS_MONTH_DAYS[year];
    if (monthDays) {
      totalDays += monthDays.reduce((a, b) => a + b, 0);
    } else {
      // Fallback: average BS year has ~365 days
      totalDays += 365;
    }
  }

  // Add days for full months in target year
  const targetMonthDays = BS_MONTH_DAYS[bsYear];
  if (targetMonthDays) {
    for (let month = 0; month < bsMonth - 1; month++) {
      totalDays += targetMonthDays[month];
    }
  } else {
    // Fallback approximation
    totalDays += (bsMonth - 1) * 30;
  }

  // Add remaining days
  totalDays += bsDay - 1;

  // Create AD date
  const adDate = new Date(AD_REFERENCE);
  adDate.setDate(adDate.getDate() + totalDays);

  return adDate;
}

/**
 * Format BS date to localized AD date string.
 * @param bsDate - Date in format "YYYY-MM-DD" (e.g., "2082-09-11")
 * @param format - 'short' for "Jan 25, 2026" or 'long' for "January 25, 2026"
 * @returns Formatted date string or original BS date if conversion fails
 */
export function formatBsToAd(
  bsDate: string | null | undefined,
  format: 'short' | 'long' = 'short'
): string {
  if (!bsDate) return '';

  const adDate = bsToAd(bsDate);
  if (!adDate) return bsDate;

  return adDate.toLocaleDateString('en-US', {
    month: format === 'short' ? 'short' : 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Get relative time string (e.g., "2 days ago", "3 weeks ago").
 * @param bsDate - BS date string
 * @returns Relative time string
 */
export function getRelativeTime(bsDate: string | null | undefined): string {
  if (!bsDate) return '';

  const adDate = bsToAd(bsDate);
  if (!adDate) return '';

  const now = new Date();
  const diffMs = now.getTime() - adDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'upcoming';
  } else if (diffDays === 0) {
    return 'today';
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks}w ago`;
  } else {
    return formatBsToAd(bsDate);
  }
}
