/**
 * Kettleborn is single-character/single-user per install until Multiple
 * Characters ships (flagged as a deferred architectural decision in
 * Mobile Architecture v2.0 Section 9/10). Every table keyed by user_id
 * uses this fixed id for now.
 */
export const LOCAL_USER_ID = 'local-hunter';
