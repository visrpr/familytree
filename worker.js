const MAX_IMAGE_BYTES = 32 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
// Per-isolate, best-effort rate limiting for admin endpoints.
const RATE_LIMIT = {
  upload: { windowMs: 60 * 1000, max: 10 },
  default: { windowMs: 60 * 1000, max: 30 }
};

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
    ...securityHeaders()
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) }
  });
}

function clientKeyFrom(request) {
  const forwarded = request.headers.get('CF-Connecting-IP');
  if (forwarded) return forwarded;
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

const rateBuckets = new Map();
function rateLimited(key, category) {
  const limits = RATE_LIMIT[category] || RATE_LIMIT.default;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || bucket.windowUntil <= now) {
    bucket = { windowUntil: now + limits.windowMs, count: 0 };
    rateBuckets.set(key, bucket);
  }
  if (rateBuckets.size > 5000) rateBuckets.clear();
  bucket.count += 1;
  return bucket.count > limits.max;
}

function photoUrl(request, objectKey, env) {
  const host = env.PHOTOS_HOST || new URL(request.url).host;
  return `https://${host}/media/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
}

function safeContentType(requested) {
  const base = String(requested || '').split(';')[0].trim().toLowerCase();
  return IMAGE_MIME_TYPES.has(base) ? base : null;
}

async function storedPhotos(env, personId) {
  if (!env.DB) return [];
  const result = await env.DB.prepare('SELECT id, url, object_key FROM photos WHERE person_id = ? ORDER BY sort_order, id').bind(personId).all();
  return (result.results || []).filter(row => row.url).map(row => ({ id: row.id, url: row.url }));
}

async function photoRows(env, personId) {
  const result = await env.DB.prepare('SELECT id, url FROM photos WHERE person_id = ? ORDER BY sort_order, id').bind(personId).all();
  return (result.results || []).map(row => ({ id: row.id, url: row.url }));
}

function reorderIdsValid(knownIds, requestedIds) {
  const normalized = requestedIds.slice(0, 6);
  if (normalized.length !== knownIds.length) return false;
  const sortedKnown = knownIds.slice().sort((a, b) => a - b);
  const sortedRequested = normalized.slice().sort((a, b) => a - b);
  return sortedRequested.every((id, index) => id === sortedKnown[index]);
}

async function reorderPhotoRows(env, personId, photoIds) {
  const rows = await photoRows(env, personId);
  const knownIds = rows.map(row => row.id);
  if (!reorderIdsValid(knownIds, photoIds)) {
    throw new Error('The photo list changed. Refresh and try again.');
  }
  const requestedIds = photoIds.slice(0, 6);
  await env.DB.batch(requestedIds.map((id, index) => env.DB.prepare('UPDATE photos SET sort_order = ? WHERE id = ? AND person_id = ?').bind(index, id, personId)));
  return photoRows(env, personId);
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch (error) { return fallback; }
}

function validYear(value) {
  return value === '' || /^\d{1,4}$/.test(value);
}

async function logEdit(env, personId, action, details, clientIp) {
  if (!env.DB) return;
  await env.DB.prepare('INSERT INTO edit_log (person_id, action, details, client_ip) VALUES (?, ?, ?, ?)')
    .bind(personId, action, JSON.stringify(details), clientIp)
    .run()
    .catch(() => {});
}

function slugFor(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return base || 'member';
}

function uniqueId(existingIds, name) {
  const base = slugFor(name);
  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

const CREATE_KINDS = new Set(['spouse', 'child', 'sibling']);
const GENDERS = new Set(['male', 'female', 'unknown']);

function parseCreateBody(body) {
  const kind = String(body.kind || '');
  if (!CREATE_KINDS.has(kind)) return { error: 'A valid kind (spouse, child, or sibling) is required.' };
  const personId = String(body.personId || '');
  if (!/^[a-z0-9-]+$/.test(personId)) return { error: 'A valid family member is required.' };
  const name = String(body.name || '').trim();
  if (!name) return { error: 'A name is required.' };
  if (name.length > 200) return { error: 'Name must be 200 characters or fewer.' };
  const gender = GENDERS.has(String(body.gender)) ? String(body.gender) : 'unknown';
  const birth = String(body.birth || '').trim();
  const death = String(body.death || '').trim();
  if (!validYear(birth) || !validYear(death)) return { error: 'Birth and death years must be empty or a four-digit year.' };
  if (kind === 'sibling') {
    const parentId = String(body.parentId || '');
    if (!/^[a-z0-9-]+$/.test(parentId)) return { error: 'A valid parent is required to add a sibling.' };
    return { value: { kind, personId, parentId, name, gender, birth, death } };
  }
  return { value: { kind, personId, name, gender, birth, death } };
}

async function existingPeopleIds(env) {
  const result = await env.DB.prepare('SELECT id FROM people').all();
  return new Set((result.results || []).map(row => row.id));
}

function insertNewPerson(env, newId, payload, spouseId) {
  return env.DB.prepare('INSERT INTO people (id, name, gender, birth, death, children_json, parents_json, siblings_json, spouse_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newId, payload.name, payload.gender, payload.birth, payload.death, '[]', '[]', '[]', spouseId || null);
}

async function createPerson(env, payload) {
  const existingIds = await existingPeopleIds(env);
  const newId = uniqueId(existingIds, payload.name);

  if (payload.kind === 'spouse') {
    const anchor = await env.DB.prepare('SELECT id, spouse_id FROM people WHERE id = ?').bind(payload.personId).first();
    if (!anchor) throw new Error('The requested family member was not found.');
    if (anchor.spouse_id) throw new Error('This family member already has a spouse.');
    await env.DB.batch([
      insertNewPerson(env, newId, payload, payload.personId),
      env.DB.prepare('UPDATE people SET spouse_id = ? WHERE id = ?').bind(newId, payload.personId)
    ]);
  } else {
    const ownerId = payload.kind === 'child' ? payload.personId : payload.parentId;
    const owner = await env.DB.prepare('SELECT id, spouse_id, children_json FROM people WHERE id = ?').bind(ownerId).first();
    if (!owner) throw new Error('The requested family member was not found.');
    if (payload.kind === 'child') {
      const hasHousehold = !!(owner.spouse_id || parseJson(owner.children_json, []).length);
      if (!hasHousehold) throw new Error('Children are added to a married couple. Add a spouse first.');
    } else if (parseJson(owner.children_json, []).indexOf(payload.personId) === -1) {
      throw new Error('The requested family member is not a child of that parent.');
    }
    await env.DB.batch([
      insertNewPerson(env, newId, payload, null),
      env.DB.prepare("UPDATE people SET children_json = json_insert(children_json, '$[#]', ?) WHERE id = ?").bind(newId, ownerId)
    ]);
  }

  const people = await readPeople(env);
  const person = people.find(entry => entry.id === newId) || null;
  if (!person) throw new Error('The family member could not be created. Try again.');
  return { person, people };
}

async function readPeople(env) {
  const [peopleResult, photosResult] = await Promise.all([
    env.DB.prepare('SELECT * FROM people ORDER BY rowid').all(),
    env.DB.prepare('SELECT person_id, id, url FROM photos ORDER BY person_id, sort_order, id').all()
  ]);
  const grouped = {};
  (photosResult.results || []).forEach(row => {
    if (!grouped[row.person_id]) grouped[row.person_id] = [];
    grouped[row.person_id].push({ id: row.id, url: row.url });
  });
  return (peopleResult.results || []).map(row => {
    const photos = grouped[row.id] || [];
    const person = { id: row.id, name: row.name, gender: row.gender || 'unknown', birth: row.birth || '', death: row.death || '', children: parseJson(row.children_json, []), parents: parseJson(row.parents_json, []), siblings: parseJson(row.siblings_json, []) };
    if (row.maiden_name) person.maidenName = row.maiden_name;
    if (row.spouse_id) person.spouse = row.spouse_id;
    if (row.marriage) person.marriage = row.marriage;
    if (row.divorce) person.divorce = row.divorce;
    ['description', 'phone', 'email', 'address'].forEach(field => { if (row[field]) person[field] = row[field]; });
    if (photos.length) { person.photos = photos.map(photo => photo.url); person.photoIds = photos.map(photo => photo.id); }
    return person;
  });
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
      if (!env.DB) return json({ error: 'Family database is not configured.' }, 503, responseOrigin);
      try {
        const people = await readPeople(env);
        return new Response(`window.FAMILY_DATA = ${JSON.stringify(people)};`, {
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
      const contentType = safeContentType(object.httpMetadata?.contentType) || 'image/jpeg';
      return new Response(object.body, {
        headers: {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"
        }
      });
    }
    if (!['/api/upload', '/api/update', '/api/reorder', '/api/person'].includes(url.pathname) || request.method !== 'POST') return json({ error: 'Not found' }, 404, responseOrigin);
    if (requestOrigin && requestOrigin !== allowedOrigin) return json({ error: 'Origin not allowed.' }, 403, responseOrigin);
    const clientKey = clientKeyFrom(request);
    if (rateLimited(clientKey, url.pathname === '/api/upload' ? 'upload' : 'default')) {
      return json({ error: 'Too many requests. Please slow down and try again.' }, 429, responseOrigin);
    }
    try {
      let personId;
      let fields;
      let requestedPhotoIds = [];
      if (url.pathname === '/api/person') {
        if (!env.DB) return json({ error: 'Family database is not configured.' }, 503, responseOrigin);
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
          return json({ error: 'Create must use JSON.' }, 415, responseOrigin);
        }
        const body = await request.json();
        const parsed = parseCreateBody(body);
        if (parsed.error) return json({ error: parsed.error }, 400, responseOrigin);
        const created = await createPerson(env, parsed.value);
        await logEdit(env, parsed.value.personId, 'create', { kind: parsed.value.kind, name: created.person.name, newId: created.person.id }, clientKey);
        return json({ success: true, person: created.person, people: created.people }, 200, responseOrigin);
      }
      if (url.pathname === '/api/upload') {
        if (!env.DB || !env.PHOTOS) return json({ error: 'Photo storage is not configured.' }, 503, responseOrigin);
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('multipart/form-data')) {
          return json({ error: 'Upload must use multipart/form-data.' }, 415, responseOrigin);
        }
        const form = await request.formData();
        const image = form.get('image');
        personId = String(form.get('personId') || '');
        if (!(image instanceof File) || !image.size) {
          return json({ error: 'A valid image file is required.' }, 400, responseOrigin);
        }
        const contentType = safeContentType(image.type);
        if (!contentType) {
          return json({ error: 'Only JPEG, PNG, WebP, and GIF images are accepted.' }, 415, responseOrigin);
        }
        if (image.size > MAX_IMAGE_BYTES) return json({ error: 'Image must be smaller than 32 MB.' }, 413, responseOrigin);
        const stored = await storedPhotos(env, personId);
        const replaceCardPhoto = form.get('replaceCardPhoto') === 'true';
        if (!replaceCardPhoto && stored.length >= 6) return json({ error: 'The gallery already has six photos.' }, 400, responseOrigin);
        const safeName = (image.name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
        const objectKey = `${personId}/${crypto.randomUUID()}-${safeName}`;
        await env.PHOTOS.put(objectKey, image.stream(), { httpMetadata: { contentType } });
        const imageUrl = photoUrl(request, objectKey, env);
        if (replaceCardPhoto && stored.length) {
          await env.DB.prepare('UPDATE photos SET url = ?, object_key = ? WHERE id = ? AND person_id = ?').bind(imageUrl, objectKey, stored[0].id, personId).run();
        } else {
          await env.DB.prepare('INSERT INTO photos (person_id, url, object_key, sort_order) VALUES (?, ?, ?, ?)').bind(personId, imageUrl, objectKey, replaceCardPhoto ? 0 : stored.length).run();
        }
        const rows = await photoRows(env, personId);
        await logEdit(env, personId, 'photo_upload', { url: imageUrl, objectKey, replaceCardPhoto }, clientKey);
        return json({ success: true, url: imageUrl, photos: rows.map(photo => photo.url), photoIds: rows.map(photo => photo.id) }, 200, responseOrigin);
      } else {
        if (!env.DB) return json({ error: 'Family database is not configured.' }, 503, responseOrigin);
        if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
          return json({ error: 'Update must use JSON.' }, 415, responseOrigin);
        }
        const body = await request.json();
        personId = String(body.personId || '');
        requestedPhotoIds = Array.isArray(body.photoIds) ? body.photoIds.filter(id => Number.isInteger(id)) : [];
        fields = url.pathname === '/api/reorder'
          ? { photos: Array.isArray(body.photos) ? body.photos.filter(photo => typeof photo === 'string' && photo).slice(0, 6) : [] }
          : { name: String(body.name || '').trim(), birth: String(body.birth || '').trim(), death: String(body.death || '').trim() };
        if (url.pathname === '/api/reorder' && !requestedPhotoIds.length) return json({ error: 'Photo IDs are required.' }, 400, responseOrigin);
        if (url.pathname === '/api/update') {
          if (!fields.name) return json({ error: 'A name is required.' }, 400, responseOrigin);
          if (fields.name.length > 200) return json({ error: 'Name must be 200 characters or fewer.' }, 400, responseOrigin);
          if (!validYear(fields.birth) || !validYear(fields.death)) return json({ error: 'Birth and death years must be empty or a four-digit year.' }, 400, responseOrigin);
        }
      }
      if (!/^[a-z0-9-]+$/.test(personId)) return json({ error: 'A valid family member is required.' }, 400, responseOrigin);

      if (url.pathname === '/api/reorder' && env.DB) {
        const rows = await reorderPhotoRows(env, personId, requestedPhotoIds);
        await logEdit(env, personId, 'photo_reorder', { photoIds: requestedPhotoIds }, clientKey);
        return json({ success: true, photos: rows.map(photo => photo.url), photoIds: rows.map(photo => photo.id) }, 200, responseOrigin);
      }

      const result = await env.DB.prepare('UPDATE people SET name = ?, birth = ?, death = ? WHERE id = ?').bind(fields.name, fields.birth, fields.death, personId).run();
      if (!result.meta.changes) return json({ error: 'The requested family member was not found.' }, 404, responseOrigin);
      await logEdit(env, personId, 'update', { name: fields.name, birth: fields.birth, death: fields.death }, clientKey);
      return json({ success: true }, 200, responseOrigin);
    } catch (error) {
      console.error(JSON.stringify({ path: url.pathname, message: `${url.pathname} failed`, error: error instanceof Error ? error.message : String(error) }));
      return json({ error: error instanceof Error ? error.message : `${url.pathname} failed.` }, 502, responseOrigin);
    }
  }
};

export { validYear, safeContentType, reorderIdsValid, rateLimited, slugFor, uniqueId, parseCreateBody };
