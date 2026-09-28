/*
 * Authentication now runs through /api/auth/login and secure HTTP-only
 * cookies. This legacy module remains as a harmless compatibility stub so
 * older cached HTML cannot expose or depend on a browser-side Supabase key.
 */
export const supabase = null;
