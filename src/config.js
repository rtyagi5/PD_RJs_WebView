// Backend service URLs. Multi-tenant: each clinic gets its own subdomain, and the
// tenant comes from the decoded JWT at runtime.
//
// REACT_APP_API_BASE_URL overrides the base domain for local/staging work. It was
// previously documented in .env but never actually read.
const baseURL = process.env.REACT_APP_API_BASE_URL || 'rehabranger.ai';

// Tenant used when the JWT doesn't carry one (dev mode, the manual start form).
const FALLBACK_TENANT = process.env.REACT_APP_TENANT || 'dev';

/**
 * Build the service URLs for an activity.
 * @param {Object} activityData - decoded JWT payload; `.tenant` selects the subdomain
 */
export const getServiceUrl = (activityData) => {
  // Guard the missing-tenant case explicitly — it used to produce
  // "https://undefined.rehabranger.ai/..." and fail as an opaque network error.
  const tenant = activityData?.tenant || FALLBACK_TENANT;
  if (!activityData?.tenant) {
    console.warn(`[Config] No tenant in activity data — falling back to "${tenant}".`);
  }

  // Allow a fully-qualified override (e.g. http://localhost:5000) to be used as-is,
  // since a local backend has no tenant subdomain.
  const origin = /^https?:\/\//.test(baseURL) ? baseURL : `https://${tenant}.${baseURL}`;

  return {
    EXERCISE_SERVICE: `${origin}/exercise-service`,
    USER_SERVICE: `${origin}/user-service`,
    REFERENCE_SERVICE: `${origin}/exercise-service/references`,
  };
};
