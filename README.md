# 🌳 Family Tree Web Project

Welcome to the repository for our family history website! This project is a digital space dedicated to preserving our family’s lineage, sharing historical photos, and connecting generations.

## 🚀 View The Website Here: [FAMILY TREE](https://visrpr.github.io/familytree/)

---

## ✨ Features
* **Interactive Family Tree:** Visual representation of generations, lineage branches, and relative connections.
* **Biographical Profiles:** Dedicated pages or sections for family members featuring key dates, milestones, and stories.
* **Photo Gallery:** A curated archive of historical family photographs and scanned documents.
* **Mobile-Friendly Design:** Fully responsive layout that looks great on phones, tablets, and desktop computers.

## Storage and deployment

Family members and photo metadata are stored in the Cloudflare D1 database `family-tree`. Image files are stored in the Cloudflare R2 bucket `family-tree-photos`. New photos and profile changes are managed through the family tree editor.

The Cloudflare resources, schema, and family-data import are already set up. Binding IDs are recorded in `wrangler.jsonc`, and the private admin token is stored in Cloudflare rather than Git.

For a future schema change or Worker deployment, run these commands from this folder:

```powershell
npm install
npx wrangler d1 migrations apply family-tree --remote
npx wrangler deploy --config D:\FamilyTree\familytree\wrangler.jsonc
```

If the family seed data must be rebuilt from `family-data.js`, run `node scripts/seed-people.js` once. It replaces the D1 people records; it does not touch photos.

The admin token is requested the first time you upload, edit, or arrange a photo. It is kept only in that browser session. Do not commit or share the token. Updates to `index.html` are published through the GitHub Pages deployment.
