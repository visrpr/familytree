const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const IMGBB_ENDPOINT = 'https://api.imgbb.com/1/upload';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'family-tree-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function readGitHubFamilyData(env) {
  const path = env.GITHUB_PATH || 'family-data.js';
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPOSITORY)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(`${endpoint}?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`, {
    cache: 'no-store',
    headers: githubHeaders(env.GITHUB_TOKEN)
  });
  if (!response.ok) throw new Error(`GitHub read failed (${response.status}).`);
  const file = await response.json();
  return { source: decodeBase64(file.content), sha: file.sha };
}

function updatePersonRecord(source, personId, fields) {
  const escapedId = personId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const recordPattern = new RegExp(`(^\\{id:"${escapedId}"[^\\n]*$)`, 'm');
  const match = source.match(recordPattern);
  if (!match) return null;

  let record = match[1];
  Object.entries(fields).forEach(([field, value]) => {
    if (value === undefined) return;
    const fieldPattern = new RegExp(`,${field}:(?:"(?:\\\\.|[^"\\\\])*"|\\[[^\\n]*?\\])`);
    let nextValue = value;
    const existingField = record.match(fieldPattern);
    if (field === 'photos' && Array.isArray(value) && existingField) {
      try {
        const existingPhotos = JSON.parse(existingField[0].slice(existingField[0].indexOf(':') + 1));
        nextValue = existingPhotos.concat(value.filter(photo => !existingPhotos.includes(photo)));
      } catch (error) {
        nextValue = value;
      }
    }
    const replacement = `,${field}:${JSON.stringify(nextValue)}`;
    if (fieldPattern.test(record)) record = record.replace(fieldPattern, replacement);
    else if (record.includes(',children:')) record = record.replace(',children:', `${replacement},children:`);
    else record = record.replace(/},?$/, `${replacement}}`);
  });
  return source.replace(match[1], record);
}

async function uploadToImgBB(image, apiKey) {
  const form = new FormData();
  form.append('image', image, image.name || 'family-photo');
  const response = await fetch(`${IMGBB_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    body: form
  });
  const result = await response.json();
  if (!response.ok || result.success === false) throw new Error('ImgBB rejected the image upload.');
  const imageUrl = result.data && (result.data.display_url || result.data.url);
  if (!imageUrl) throw new Error('ImgBB returned no image URL.');
  return imageUrl;
}

async function commitFamilyData(source, sha, personId, fields, env) {
  const updated = updatePersonRecord(source, personId, fields);
  if (!updated) throw new Error('The requested family member was not found.');
  const path = `${env.GITHUB_PATH || 'family-data.js'}`;
  const endpoint = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPOSITORY)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: { ...githubHeaders(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Update family member ${personId}`,
      content: encodeBase64(updated),
      sha,
      branch: env.GITHUB_BRANCH || 'main'
    })
  });
  if (!response.ok) throw new Error(`GitHub update failed (${response.status}).`);
  return updated;
}

async function updateGitHubFamilyData(personId, fields, env) {
  const file = await readGitHubFamilyData(env);
  return commitFamilyData(file.source, file.sha, personId, fields, env);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestOrigin = request.headers.get('Origin');
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://visrpr.github.io';
    const responseOrigin = requestOrigin === allowedOrigin ? requestOrigin : allowedOrigin;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(responseOrigin) });
    if (url.pathname === '/api/data.js' && request.method === 'GET') {
      if (requestOrigin && requestOrigin !== allowedOrigin) return json({ error: 'Origin not allowed.' }, 403, responseOrigin);
      if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPOSITORY) return json({ error: 'Data service is not configured.' }, 503, responseOrigin);
      try {
        const file = await readGitHubFamilyData(env);
        return new Response(file.source, {
          status: 200,
          headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', ...corsHeaders(responseOrigin) }
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Could not read family data.' }, 502, responseOrigin);
      }
    }
    if (!['/api/upload', '/api/update'].includes(url.pathname) || request.method !== 'POST') return json({ error: 'Not found' }, 404, responseOrigin);
    if (requestOrigin && requestOrigin !== allowedOrigin) return json({ error: 'Origin not allowed.' }, 403, responseOrigin);
    if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPOSITORY || (url.pathname === '/api/upload' && !env.IMGBB_API_KEY)) {
      return json({ error: 'Upload service is not configured.' }, 503, responseOrigin);
    }

    try {
      let personId;
      let fields;
      if (url.pathname === '/api/upload') {
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('multipart/form-data')) {
          return json({ error: 'Upload must use multipart/form-data.' }, 415, responseOrigin);
        }
        const form = await request.formData();
        const image = form.get('image');
        personId = String(form.get('personId') || '');
        if (!(image instanceof File) || !image.size || !image.type.startsWith('image/')) {
          return json({ error: 'A valid image file is required.' }, 400, responseOrigin);
        }
        if (image.size > MAX_IMAGE_BYTES) return json({ error: 'Image must be smaller than 32 MB.' }, 413, responseOrigin);
        const imageUrl = await uploadToImgBB(image, env.IMGBB_API_KEY);
        fields = { photos: [imageUrl] };
      } else {
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
          return json({ error: 'Update must use JSON.' }, 415, responseOrigin);
        }
        const body = await request.json();
        personId = String(body.personId || '');
        fields = { name: String(body.name || '').trim(), birth: String(body.birth || '').trim(), death: String(body.death || '').trim() };
        if (!fields.name) return json({ error: 'A name is required.' }, 400, responseOrigin);
      }
      if (!/^[a-z0-9-]+$/.test(personId)) return json({ error: 'A valid family member is required.' }, 400, responseOrigin);

      const updated = await updateGitHubFamilyData(personId, fields, env);
      const imageUrl = fields.photos && fields.photos[0];
      const photoMatch = updated.match(new RegExp(`,photos:(\\[[^\\n]*?\\])`));
      const photos = photoMatch ? JSON.parse(photoMatch[1]) : undefined;
      return json({ success: true, ...(imageUrl ? { url: imageUrl, photos } : {}), updated }, 200, responseOrigin);
    } catch (error) {
      console.error(JSON.stringify({ message: 'Image upload failed', error: error instanceof Error ? error.message : String(error) }));
      return json({ error: error instanceof Error ? error.message : 'Image upload failed.' }, 502, responseOrigin);
    }
  }
};
