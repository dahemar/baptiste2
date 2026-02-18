addEventListener('fetch', event => event.respondWith(handle(event.request)));

async function handle(request) {
  try {
    const { source, key } = await request.json();
    if (!source || !key) return new Response('missing source/key', { status: 400 });

    const res = await fetch(source);
    if (!res.ok) return new Response('failed to fetch source', { status: 502 });

    const buf = await res.arrayBuffer();

    // BKT is the R2 binding name provided at upload time
    await BKT.put(key, buf, {
      httpMetadata: { contentType: 'video/mp4' },
      // set cache control
      customMetadata: { migratedBy: 'worker_r2_copy' },
    });

    return new Response('ok', { status: 200 });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}
