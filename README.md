# Prabhu Family Tree image upload

The page sends editor photo uploads to `/api/upload`. `worker.js` validates the file and forwards it to ImgBB without exposing the API key in the browser.

## Deploy the Worker

1. Install Wrangler if needed: `npm install --save-dev wrangler`
2. Authenticate: `npx wrangler login`
3. Add the ImgBB key as a Cloudflare secret:

   `npx wrangler secret put IMGBB_API_KEY`

4. Deploy from this folder:

   `npx wrangler deploy`

The frontend and Worker should share the same origin for `/api/upload` to work directly. If the Worker is hosted separately, set `ALLOWED_ORIGIN` in `wrangler.jsonc` to the frontend origin and change `IMAGE_UPLOAD_ENDPOINT` in `index.html` to the Worker URL.
