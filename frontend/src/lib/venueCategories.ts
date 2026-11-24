/** Choices for a venue's category dropdown. */
export const VENUE_CATEGORIES = [
  'Football turf', 'Cricket ground', 'Box cricket', 'Badminton court', 'Tennis court', 'Basketball court', 'Volleyball court', 'Pickleball court',
  'Multi-sport turf', 'Indoor sports arena', 'Sports complex', 'Sports academy', 'Other',
];
/** The options to show: the standard list, plus a previously saved value that isn't in it so nothing gets lost. */
export const categoryOptions = (current?: string | null) => (current && !VENUE_CATEGORIES.includes(current) ? [current, ...VENUE_CATEGORIES] : VENUE_CATEGORIES);
