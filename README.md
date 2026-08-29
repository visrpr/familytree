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

Editing is intentionally open: anyone can update a profile's name and years or upload, replace, and arrange photos from the editor. Anyone can also add new family members from the tree — hover a card's `+` button (or open a profile and use the Add chips) to add a spouse, child, sibling, or parents. These follow simple rules: adding a child requires a married couple (add a spouse first if the person has none), adding a sibling requires the person to already have a parent recorded in the tree, and adding parents is only offered to someone with no parents recorded yet (mother and father, or either one alone, in one form). Every successful change is written to the D1 `edit_log` table (person, action, details, timestamp, and visitor IP) so edits can be reviewed or reverted. Per-IP rate limiting (applied in the Worker) discourages abuse but is best-effort; it is not real authentication.

The **Recent Additions** view shows the last 80 `edit_log` entries paired with the person's name. Viewing and removing entries requires the shared `ADMIN_CODE` passcode stored in the Worker `vars` (a `X-Admin-Code` header; set it in `wrangler.jsonc` and redeploy). Removing an entry reverts it: for additions it deletes the added person(s), strips them from everyone's `children_json`/`parents_json`/`siblings_json`, clears the spouse link, and removes their photos — then records a `revert` row. Only `create` actions can be reverted. If no `ADMIN_CODE` is set, these admin features are disabled. If you want a different lock-down, the `ADMIN_TOKEN` bearer check can be restored in `worker.js`.

Additions send an idempotency key (`X-Idempotency-Key`) that is stored as `edit_log.idem_key` (partial unique index, migration `0004`). A retried request with the same key returns the original result instead of inserting a duplicate; client retries on transient network/server failures reuse the same key. Spouse creation is protected by an atomic "reserve then insert" UPDATE and slug collisions are retried at the database level.

The Cloudflare resources, schema, and family-data import are already set up. Binding IDs are recorded in `wrangler.jsonc`.

For a future schema change or Worker deployment, run these commands from this folder:

```powershell
npm install
npx wrangler d1 migrations apply family-tree --remote
npx wrangler deploy --config D:\FamilyTree\familytree\wrangler.jsonc
```

If the family seed data must be rebuilt from `family-data.js`, run `node scripts/seed-people.js` once. It replaces the D1 people records; it does not touch photos.

Seed options (run from this folder):
- `node scripts/seed-people.js --dry-run` — preview the SQL without touching the database.
- `node scripts/seed-people.js --yes` — skip the confirmation prompt.
- `node scripts/seed-people.js --merge` — upsert records by id instead of deleting the table first (preserves rows added outside the seed).

Run the Worker/seed unit tests with `node scripts/run-tests.js`.

Updates to `index.html` are published through the GitHub Pages deployment. After this change, run `npx wrangler d1 migrations apply family-tree --remote` once to create the `edit_log` table and its idempotency-key index, then `npx wrangler deploy --config D:\FamilyTree\familytree\wrangler.jsonc`.
