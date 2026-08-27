# 🌳 Family Tree Web Project

Welcome to the repository for our family history website! This project is a digital space dedicated to preserving our family’s lineage, sharing historical photos, and connecting generations.

## 🚀 View The Website Here: [FAMILY TREE](https://visrpr.github.io/familytree/)

---

## ✨ Features
* **Interactive Family Tree:** Visual representation of generations, lineage branches, and relative connections.
* **Biographical Profiles:** Dedicated pages or sections for family members featuring key dates, milestones, and stories.
* **Photo Gallery:** A curated archive of historical family photographs and scanned documents.
* **Mobile-Friendly Design:** Fully responsive layout that looks great on phones, tablets, and desktop computers.

## Photo storage setup

Photos are stored in Cloudflare R2 and their order is stored in Cloudflare D1. The existing GitHub/ImgBB data remains available as a legacy fallback while new uploads use R2.

Run these commands from this folder:

```powershell
npm install
npx wrangler r2 bucket create family-tree-photos
npx wrangler d1 create family-tree
```

Copy the D1 `database_id` printed by the last command into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Then create the tables and set the admin token:

```powershell
npx wrangler d1 migrations apply family-tree --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put IMGBB_API_KEY
npx wrangler deploy
```

The admin token is requested the first time you upload, edit, or arrange a photo. It is kept only in that browser session. The GitHub Pages deployment must also include the updated `index.html`.
