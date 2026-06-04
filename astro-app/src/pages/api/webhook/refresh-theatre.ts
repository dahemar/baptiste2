export const prerender = false;

// Secure webhook to trigger a refresh of theatre works data.
// Expects a POST with header `x-site-secret: <secret>` where <secret>
// equals the environment variable `WEBHOOK_SECRET` configured in Vercel.

export async function POST({ request }: any) {
  const reqSecret = (request.headers.get('x-site-secret') || '').trim();
  const envSecret = process.env.WEBHOOK_SECRET || '';

  if (!envSecret || !reqSecret || reqSecret !== envSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    // Import manager dynamically to keep server bundle small
    const gsm = await import('../../../utils/googleSheetsManager');
    if (typeof gsm.clearMemoryCache === 'function') {
      try { gsm.clearMemoryCache(); } catch { /* ignore */ }
    }
    try {
      const { clearSectionMemoryCache } = await import('../../../utils/sectionContentManager');
      clearSectionMemoryCache();
    } catch { /* ignore */ }
    try {
      const { clearMusicPageCache } = await import('../../../utils/musicPageData');
      clearMusicPageCache();
    } catch { /* ignore */ }
    // Force reload from Google Sheets and return a small summary
    const fetched = await gsm.loadTheatreWorksData({ force: true });
    const works = Array.isArray(fetched) ? fetched.length : 0;
    return new Response(JSON.stringify({ ok: true, works }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
