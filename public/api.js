// The one function in the browser that talks to the server. Pages never call fetch directly.
// Always resolves to { ok, status, data } or { ok: false, status, error } with a readable sentence.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the server. Check your connection and try again.' };
  }
  if (res.status === 204) return { ok: true, status: 204, data: null };

  let data = null;
  try {
    data = await res.json();
  } catch {
    // not JSON: fall through to the generic message
  }
  if (res.ok) return { ok: true, status: res.status, data };
  return { ok: false, status: res.status, error: data?.error ?? 'Something went wrong. Try again.' };
}

export async function signOut() {
  await api('/api/auth/logout', { method: 'POST' });
  location.assign('/login');
}
