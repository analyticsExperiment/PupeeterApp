const { URL } = require('url');
const { classifyTagRequest } = require('./tagCatalog');

function normalizeUrl(href, base) {
  try {
    return new URL(href, base).toString().replace(/#.*$/, '');
  } catch (e) {
    return null;
  }
}

function sameOrigin(u1, u2) {
  try {
    const a = new URL(u1);
    const b = new URL(u2);
    return a.origin === b.origin;
  } catch (e) {
    return false;
  }
}

function classifyAnalytics(url, options = {}) {
  return classifyTagRequest(url, options);
}

function isFirstPartyCookie(cookie, pageUrl) {
  try {
    const host = new URL(pageUrl).hostname;
    const cd = (cookie.domain || '').replace(/^\./, '').toLowerCase();
    if (!cd) return true;
    const h = (host || '').toLowerCase();
    return h === cd || h.endsWith(`.${cd}`) || cd.endsWith(`.${h}`);
  } catch (e) {
    return false;
  }
}

module.exports = {
  normalizeUrl,
  sameOrigin,
  classifyAnalytics,
  isFirstPartyCookie,
};
