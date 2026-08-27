const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

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

async function storedPhotos(env, personId) {
  if (!env.DB) return [];
  const result = await env.DB.prepare('SELECT id, url, object_key FROM photos WHERE person_id = ? ORDER BY sort_order, id').bind(personId).all();
  return (result.results || []).filter(row => row.url).map(row => ({ id: row.id, url: row.url, objectKey: row.object_key || null }));
}

async function photoRows(env, personId) {
  const result = await env.DB.prepare('SELECT id, url FROM photos WHERE person_id = ? ORDER BY sort_order, id').bind(personId).all();
  return (result.results || []).map(row => ({ id: row.id, url: row.url }));
}

async function reorderPhotoRows(env, personId, photoIds) {
  const rows = await photoRows(env, personId);
  const knownIds = rows.map(row => row.id).sort((a, b) => a - b);
  const requestedIds = photoIds.slice(0, 6);
  if (requestedIds.length !== rows.length || requestedIds.slice().sort((a, b) => a - b).some((id, index) => id !== knownIds[index])) {
    throw new Error('The photo list changed. Refresh and try again.');
  }
  await env.DB.batch(requestedIds.map((id, index) => env.DB.prepare('UPDATE photos SET sort_order = ? WHERE id = ? AND person_id = ?').bind(index, id, personId)));
  return photoRows(env, personId);
}

async function dataWithStoredPhotos(source, env) {
  if (!env.DB) return source;
  const result = await env.DB.prepare('SELECT person_id, id, url FROM photos ORDER BY person_id, sort_order, id').all();
  const grouped = {};
  (result.results || []).forEach(row => {
    if (!grouped[row.person_id]) grouped[row.person_id] = [];
    if (row.url) grouped[row.person_id].push({ id: row.id, url: row.url });
  });
  Object.keys(grouped).forEach(personId => {
    source = updatePersonRecord(source, personId, {
      photos: grouped[personId].map(photo => photo.url),
      photoIds: grouped[personId].map(photo => photo.id),
      replacePhotos: true
    });
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
    try {
      let personId;
      let fields;
      let requestedPhotoIds = [];
      if (url.pathname === '/api/upload') {
        if (!env.DB || !env.PHOTOS) return json({ error: 'Photo storage is not configured.' }, 503, responseOrigin);
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
        const stored = await storedPhotos(env, personId);
        const replaceCardPhoto = form.get('replaceCardPhoto') === 'true';
        if (!replaceCardPhoto && stored.length >= 6) return json({ error: 'The gallery already has six photos.' }, 400, responseOrigin);
        const safeName = (image.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
        const objectKey = `${personId}/${crypto.randomUUID()}-${safeName}`;
        await env.PHOTOS.put(objectKey, image.stream(), { httpMetadata: { contentType: image.type } });
        const imageUrl = photoUrl(request, objectKey, env);
        if (replaceCardPhoto && stored.length) {
          await env.DB.prepare('UPDATE photos SET url = ?, object_key = ? WHERE id = ? AND person_id = ?').bind(imageUrl, objectKey, stored[0].id, personId).run();
        } else {
          await env.DB.prepare('INSERT INTO photos (person_id, url, object_key, sort_order) VALUES (?, ?, ?, ?)').bind(personId, imageUrl, objectKey, replaceCardPhoto ? 0 : stored.length).run();
        }
        const rows = await photoRows(env, personId);
        return json({ success: true, url: imageUrl, photos: rows.map(photo => photo.url), photoIds: rows.map(photo => photo.id) }, 200, responseOrigin);
      } else {
        if (url.pathname === '/api/update' && (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPOSITORY)) return json({ error: 'Profile editing is not configured.' }, 503, responseOrigin);
        if (url.pathname === '/api/reorder' && !env.DB) return json({ error: 'Photo storage is not configured.' }, 503, responseOrigin);
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
          return json({ error: 'Update must use JSON.' }, 415, responseOrigin);
        }
        const body = await request.json();
        personId = String(body.personId || '');
        requestedPhotoIds = Array.isArray(body.photoIds) ? body.photoIds.filter(id => Number.isInteger(id)) : [];
        fields = url.pathname === '/api/reorder'
          ? { photos: Array.isArray(body.photos) ? body.photos.filter(photo => typeof photo === 'string' && photo).slice(0, 6) : [], replacePhotos: true }
          : { name: String(body.name || '').trim(), birth: String(body.birth || '').trim(), death: String(body.death || '').trim() };
        if (url.pathname === '/api/reorder' && !fields.photos.length) return json({ error: 'At least one photo is required.' }, 400, responseOrigin);
        if (url.pathname === '/api/update' && !fields.name) return json({ error: 'A name is required.' }, 400, responseOrigin);
      }
      if (!/^[a-z0-9-]+$/.test(personId)) return json({ error: 'A valid family member is required.' }, 400, responseOrigin);

      if (url.pathname === '/api/reorder' && env.DB) {
        if (requestedPhotoIds.length) {
          const rows = await reorderPhotoRows(env, personId, requestedPhotoIds);
          return json({ success: true, photos: rows.map(photo => photo.url), photoIds: rows.map(photo => photo.id) }, 200, responseOrigin);
        }
        throw new Error('Photo IDs are required. Refresh the gallery and try again.');
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
