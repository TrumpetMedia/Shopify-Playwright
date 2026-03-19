/**
 * Detect Shopify / Partner login or session expiry redirects.
 * @param {string} url
 * @returns {boolean}
 */
function isLoginOrAuthUrl(url) {
  if (!url || typeof url !== 'string') return true;
  const u = url.toLowerCase();
  if (u.includes('accounts.shopify.com') && (u.includes('/login') || u.includes('sign_in'))) {
    return true;
  }
  if (u.includes('/login') && (u.includes('shopify.com') || u.includes('myshopify.com'))) {
    return true;
  }
  return false;
}

/**
 * @param {import('playwright').Page} page
 */
async function assertNotLoggedOut(page) {
  const url = page.url();
  if (isLoginOrAuthUrl(url)) {
    const err = new Error(
      'Session appears expired or not logged in (redirected to login/auth). Run `npm run login` headfully to refresh the profile.'
    );
    err.code = 'LOGIN_REQUIRED';
    throw err;
  }
}

module.exports = { isLoginOrAuthUrl, assertNotLoggedOut };
