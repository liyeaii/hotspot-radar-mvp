const STORAGE_KEY = 'hotspot-radar-admin-token';

let cachedToken = loadAdminToken();

export function getAdminToken() {
  return cachedToken;
}

export function hasAdminToken() {
  return Boolean(cachedToken);
}

export function withAdminHeaders(headers = {}) {
  if (!cachedToken) return headers;
  return { ...headers, 'x-admin-token': cachedToken };
}

export function clearAdminToken() {
  cachedToken = '';
  localStorage.removeItem(STORAGE_KEY);
}

function loadAdminToken() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
  const tokenFromHash = hashParams.get('adminToken') || hashParams.get('token');
  const tokenFromQuery = url.searchParams.get('adminToken') || url.searchParams.get('token');
  const nextToken = String(tokenFromHash || tokenFromQuery || '').trim();

  if (nextToken) {
    localStorage.setItem(STORAGE_KEY, nextToken);
    scrubTokenFromAddress(url);
    return nextToken;
  }

  return localStorage.getItem(STORAGE_KEY) || '';
}

function scrubTokenFromAddress(url) {
  url.searchParams.delete('adminToken');
  url.searchParams.delete('token');
  const clean = `${url.pathname}${url.search}`;
  window.history.replaceState(null, '', clean || '/');
}
