const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN || url.origin;
    const responseOrigin = requestOrigin && requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(responseOrigin) });
    }
    if (url.pathname !== '/api/upload' || request.method !== 'POST') {
      return json({ error: 'Not found' }, 404, responseOrigin);
    }
    if (!env.IMGBB_API_KEY) {
      return json({ error: 'Image upload service is not configured.' }, 503, responseOrigin);
    }
    if (!request.headers.get('Content-Type')?.toLowerCase().includes('multipart/form-data')) {
      return json({ error: 'Upload must use multipart/form-data.' }, 415, responseOrigin);
    }

    try {
      const form = await request.formData();
      const image = form.get('image');
      if (!(image instanceof File) || !image.size || !image.type.startsWith('image/')) {
        return json({ error: 'A valid image file is required.' }, 400, responseOrigin);
      }
      if (image.size > MAX_IMAGE_BYTES) {
        return json({ error: 'Image must be smaller than 10 MB.' }, 413, responseOrigin);
      }

      const upload = new FormData();
      upload.append('image', image, image.name || 'family-photo');
      const upstream = await fetch(`${IMGBB_ENDPOINT}?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, {
        method: 'POST',
        body: upload
      });
      const result = await upstream.json();
      if (!upstream.ok || result.success === false) {
        return json({ error: 'ImgBB rejected the image upload.' }, 502, responseOrigin);
      }
      return json(result, 200, responseOrigin);
    } catch (error) {
      console.error('ImgBB upload failed', error);
      return json({ error: 'Image upload failed.' }, 502, responseOrigin);
    }
  }
};
