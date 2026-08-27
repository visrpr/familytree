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

function isAuthorized(request, env) {
  if (!env.ADMIN_TOKEN) return true;
  return request.headers.get('Authorization') === `Bearer ${env.ADMIN_TOKEN}`;
}

function photoUrl(request, objectKey, env) {
  const host = env.PHOTOS_HOST || new URL(request.url).host;
  return `https://${host}/media/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

function legacyPhotos(source, personId) {
  const escapedId = personId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\{id:"${escapedId}"[^\\n]*$`, 'm'));
  if (!match) return [];
  const photos = match[0].match(/,photos:(\[[^\n]*?\])/);
  if (!photos) return [];
  try { return JSON.parse(photos[1]).filter(Boolean).slice(0, 6); } catch (error) { return []; }
}

async function storedPhotos(env, personId) {
  if (!env.DB) return [];
  const result = await env.DB.prepare('SELECT url FROM photos WHERE person_id = ? ORDER BY sort_order, id').bind(personId).all();
  return (result.results || []).map(row => row.url).filter(Boolean);
}

async function savePhotoRows(env, personId, photos) {
  if (!env.DB) return;
  const statements = [env.DB.prepare('DELETE FROM photos WHERE person_id = ?').bind(personId)];
  photos.slice(0, 6).forEach((url, index) => {
    statements.push(env.DB.prepare('INSERT INTO photos (person_id, url, sort_order) VALUES (?, ?, ?)').bind(personId, url, index));
  });
  await env.DB.batch(statements);
}

async function dataWithStoredPhotos(source, env) {
  if (!env.DB) return source;
  const result = await env.DB.prepare('SELECT person_id, url FROM photos ORDER BY person_id, sort_order, id').all();
  const grouped = {};
  (result.results || []).forEach(row => {
    if (!grouped[row.person_id]) grouped[row.person_id] = [];
    if (row.url) grouped[row.person_id].push(row.url);
  });
  Object.keys(grouped).forEach(personId => {
    source = updatePersonRecord(source, personId, { photos: grouped[personId], replacePhotos: true });
  });
  return source;
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
    if (field === 'replaceCardPhoto' || field === 'replacePhotos' || value === undefined) return;
    const fieldPattern = new RegExp(`,${field}:(?:"(?:\\\\.|[^"\\\\])*"|\\[[^\\n]*?\\])`);
    let nextValue = value;
    const existingFields = field === 'photos' ? record.match(new RegExp(fieldPattern.source, 'g')) : null;
    if (field === 'photos' && Array.isArray(value) && existingFields) {
      try {
        const existingPhotos = existingFields.reduce(function(photos, existingField){
          return photos.concat(JSON.parse(existingField.slice(existingField.indexOf(':') + 1)));
        }, []);
        nextValue = fields.replacePhotos
          ? value.slice(0, 6)
          : fields.replaceCardPhoto
          ? value.slice(0, 1).concat(existingPhotos.slice(1)).slice(0, 6)
          : existingPhotos.concat(value.filter(photo => !existingPhotos.includes(photo))).slice(0, 6);
      } catch (error) {
        nextValue = value.slice(0, 6);
      }
    }
    const replacement = `,${field}:${JSON.stringify(nextValue)}`;
    if (field === 'photos' && existingFields) record = record.replace(new RegExp(fieldPattern.source, 'g'), '');
    if (field === 'photos' && existingFields) record = record.replace(/,children:/, `${replacement},children:`);
    else if (fieldPattern.test(record)) record = record.replace(fieldPattern, replacement);
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
        const source = await dataWithStoredPhotos(file.source, env);
        return new Response(source, {
          status: 200,
          headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', ...corsHeaders(responseOrigin) }
        });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Could not read family data.' }, 502, responseOrigin);
      }
    }
    if (url.pathname.startsWith('/media/') && request.method === 'GET') {
      if (!env.PHOTOS) return json({ error: 'Photo storage is not configured.' }, 503, responseOrigin);
      const objectKey = url.pathname.slice('/media/'.length).split('/').map(decodeURIComponent).join('/');
      const object = await env.PHOTOS.get(objectKey);
      if (!object) return new Response('Not found', { status: 404 });
      return new Response(object.body, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Type': object.httpMetadata?.contentType || 'image/jpeg' } });
    }
    if (!['/api/upload', '/api/update', '/api/reorder'].includes(url.pathname) || request.method !== 'POST') return json({ error: 'Not found' }, 404, responseOrigin);
    if (requestOrigin && requestOrigin !== allowedOrigin) return json({ error: 'Origin not allowed.' }, 403, responseOrigin);
    if (!isAuthorized(request, env)) return json({ error: 'Admin authorization is required.' }, 401, responseOrigin);
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
        if (env.PHOTOS && env.DB) {
          const source = await readGitHubFamilyData(env);
          const stored = await storedPhotos(env, personId);
          const existingPhotos = stored.length ? stored : legacyPhotos(source.source, personId);
          const safeName = (image.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
          const objectKey = `${personId}/${crypto.randomUUID()}-${safeName}`;
          await env.PHOTOS.put(objectKey, image.stream(), { httpMetadata: { contentType: image.type } });
          const imageUrl = photoUrl(request, objectKey, env);
          const photos = form.get('replaceCardPhoto') === 'true' ? [imageUrl].concat(existingPhotos.slice(1)) : existingPhotos.concat(imageUrl).slice(0, 6);
          await savePhotoRows(env, personId, photos);
          return json({ success: true, url: imageUrl, photos }, 200, responseOrigin);
        }
        const imageUrl = await uploadToImgBB(image, env.IMGBB_API_KEY);
        fields = { photos: [imageUrl], replaceCardPhoto: form.get('replaceCardPhoto') === 'true' };
      } else {
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
          return json({ error: 'Update must use JSON.' }, 415, responseOrigin);
        }
        const body = await request.json();
        personId = String(body.personId || '');
        fields = url.pathname === '/api/reorder'
          ? { photos: Array.isArray(body.photos) ? body.photos.filter(photo => typeof photo === 'string' && photo).slice(0, 6) : [], replacePhotos: true }
          : { name: String(body.name || '').trim(), birth: String(body.birth || '').trim(), death: String(body.death || '').trim() };
        if (url.pathname === '/api/reorder' && !fields.photos.length) return json({ error: 'At least one photo is required.' }, 400, responseOrigin);
        if (url.pathname === '/api/update' && !fields.name) return json({ error: 'A name is required.' }, 400, responseOrigin);
      }
      if (!/^[a-z0-9-]+$/.test(personId)) return json({ error: 'A valid family member is required.' }, 400, responseOrigin);

      if (url.pathname === '/api/reorder' && env.DB) {
        await savePhotoRows(env, personId, fields.photos);
        return json({ success: true, photos: fields.photos }, 200, responseOrigin);
      }

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
