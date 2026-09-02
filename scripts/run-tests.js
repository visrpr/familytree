const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) { passed += 1; }
  else { failed += 1; console.error('  ✗ ' + message); }
}
function section(name) { console.log('\n' + name); }

(async function () {
  const root = path.resolve(__dirname, '..');

  // ---- load worker helpers (copy to .mjs so Node imports it as ESM) ----
  const tmp = path.join(os.tmpdir(), 'familytree-worker-test.mjs');
  fs.copyFileSync(path.join(root, 'worker.js'), tmp);
  const worker = await import('file://' + tmp.replace(/\\/g, '/'));
  fs.unlinkSync(tmp);

  section('validYear');
  assert(worker.validYear('') === true, 'empty year allowed');
  assert(worker.validYear('1900') === true, 'four-digit year allowed');
  assert(worker.validYear('12') === true, 'short year allowed');
  assert(worker.validYear('19ab') === false, 'non-numeric rejected');
  assert(worker.validYear('19000') === false, 'over four digits rejected');

  section('safeContentType');
  assert(worker.safeContentType('image/jpeg') === 'image/jpeg', 'jpeg allowed');
  assert(worker.safeContentType('image/webp') === 'image/webp', 'webp allowed');
  assert(worker.safeContentType('image/svg+xml') === null, 'svg rejected');
  assert(worker.safeContentType('text/html') === null, 'html rejected');
  assert(worker.safeContentType('image/jpeg; charset=utf-8') === 'image/jpeg', 'params stripped');
  assert(worker.safeContentType('IMAGE/PNG') === 'image/png', 'case-insensitive');

  section('reorderIdsValid');
  assert(worker.reorderIdsValid([3, 1, 2], [1, 2, 3]) === true, 'same set reordered is valid');
  assert(worker.reorderIdsValid([1, 2, 3], [1, 2]) === false, 'missing id invalid');
  assert(worker.reorderIdsValid([1, 2, 3], [1, 2, 4]) === false, 'different set invalid');
  assert(worker.reorderIdsValid([1, 2, 3, 4, 5, 6, 7], [7, 6, 5, 4, 3, 2, 1, 99]) === false, 'over six ids invalid');
  assert(worker.reorderIdsValid([1, 2], [2, 1]) === true, 'two ids valid');

  section('rateLimited');
  const key = 'test-key-' + Date.now();
  for (let i = 0; i < 5; i++) worker.rateLimited(key, 'default');
  assert(worker.rateLimited(key, 'default') === false, 'within limit not blocked');
  for (let i = 0; i < 100; i++) worker.rateLimited(key + '-flood', 'default');
  assert(worker.rateLimited(key + '-flood', 'default') === true, 'over limit blocked');

  section('slugFor');
  assert(worker.slugFor('Savitri') === 'savitri', 'simple name slugged');
  assert(worker.slugFor('Ram P. Pai') === 'ram-p-pai', 'punctuation slugged');
  assert(worker.slugFor('Sri Lakshmi Devi  V') === 'sri-lakshmi-devi-v', 'spaces collapsed');
  assert(worker.slugFor('   ') === 'member', 'empty falls back to member');
  assert(worker.slugFor('X'.repeat(80)).length <= 40, 'long names capped at 40 chars');

  section('uniqueId');
  assert(worker.uniqueId(new Set(['savitri']), 'Savitri') === 'savitri-2', 'collision increments suffix');
  assert(worker.uniqueId(new Set(['savitri', 'savitri-2']), 'Savitri') === 'savitri-3', 'chained collision increments');
  assert(worker.uniqueId(new Set([]), 'Madhu') === 'madhu', 'unused slug returned as-is');

  section('parseCreateBody');
  const spouse = worker.parseCreateBody({kind:'spouse', personId:'ram', name:'Sita', gender:'female', birth:'1910'});
  assert(!spouse.error && spouse.value.kind === 'spouse' && spouse.value.name === 'Sita', 'valid spouse accepted');
  const child = worker.parseCreateBody({kind:'child', personId:'srinivas', name:'Vijay'});
  assert(!child.error && child.value.gender === 'unknown' && child.value.birth === '', 'child defaults applied');
  assert(!!worker.parseCreateBody({kind:'cousin', personId:'ram', name:'Sita'}).error, 'unknown kind rejected');
  assert(!!worker.parseCreateBody({kind:'spouse', personId:'ram', name:'   '}).error, 'blank name rejected');
  assert(!!worker.parseCreateBody({kind:'spouse', personId:'ram', name:'Sita', birth:'19ab'}).error, 'bad year rejected');
  assert(!!worker.parseCreateBody({kind:'spouse', personId:'RAM!', name:'Sita'}).error, 'bad person id rejected');
  assert(!!worker.parseCreateBody({kind:'sibling', personId:'bhumika', name:'Kiran'}).error, 'sibling without parent rejected');
  const sibling = worker.parseCreateBody({kind:'sibling', personId:'bhumika', parentId:'srinivas', name:'Kiran'});
  assert(!sibling.error && sibling.value.parentId === 'srinivas', 'sibling with parent accepted');

  const parentPair = worker.parseCreateBody({kind:'parent', personId:'padmanabh', mother:{name:'Yashoda Bai', birth:'1880'}, father:{name:'Narayan Rao'}});
  assert(!parentPair.error && parentPair.value.kind === 'parent' && parentPair.value.mother.name === 'Yashoda Bai' && parentPair.value.father.name === 'Narayan Rao', 'parent pair accepted');
  const parentSingle = worker.parseCreateBody({kind:'parent', personId:'padmanabh', mother:'Yashoda Bai'});
  assert(!parentSingle.error && parentSingle.value.mother.name === 'Yashoda Bai' && !parentSingle.value.father, 'single mother string accepted');
  assert(!!worker.parseCreateBody({kind:'parent', personId:'padmanabh'}).error, 'parent without any name rejected');
  assert(!!worker.parseCreateBody({kind:'parent', personId:'padmanabh', mother:{name:'X'}, father:{name:'X'}}).error, 'same mother/father name rejected');
  assert(!!worker.parseCreateBody({kind:'parent', personId:'padmanabh', mother:{name:'X', birth:'18ab'}}).error, 'parent bad year rejected');

  section('family-data integrity');
  const source = fs.readFileSync(path.join(root, 'family-data.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const people = context.window.FAMILY_DATA || [];
  const ids = people.map((p) => p.id);
  const byId = {};
  people.forEach((p) => { byId[p.id] = p; });
  assert(ids.length === new Set(ids).size, 'no duplicate people ids');
  const missingRefs = [];
  people.forEach((p) => {
    if (typeof p.spouse === 'string' && p.spouse && !byId[p.spouse]) missingRefs.push(p.id + '->spouse');
    ['children', 'parents', 'siblings'].forEach((k) => (p[k] || []).forEach((r) => { if (!byId[r]) missingRefs.push(p.id + '->' + k); }));
  });
  assert(missingRefs.length === 0, 'no missing id references (' + missingRefs.join(', ') + ')');
  const rootPerson = people.find((p) => p.id === 'padmanabh');
  assert(!!rootPerson, 'root person padmanabh present');

  section('unified graph layout (from index.html)');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(!!scriptMatch, 'inline script present in index.html');
  if (scriptMatch) {
    const inlineScript = scriptMatch[1];
    const glStartIdx = inlineScript.indexOf('function graphLayout(){');
    const glEndIdx = inlineScript.indexOf('function makeMarriageHeart(', glStartIdx);
    assert(glStartIdx !== -1 && glEndIdx !== -1, 'graphLayout function found');
    const glSrc = inlineScript.slice(glStartIdx, glEndIdx);
    const CARD_W = 150, CARD_H = 220, GAP_X = 52, SPOUSE_GAP = 44, LEVEL_GAP = 200, CHILD_Y_STEP = 10, PAD = 70;
    const LEVEL_H = CARD_H + LEVEL_GAP;
    const layoutParentOf = {};
    people.forEach((p) => (p.children || []).forEach((c) => { if (byId[c]) layoutParentOf[c] = p.id; }));
    people.forEach((p) => (p.parents || []).forEach((pid) => { if (byId[pid] && layoutParentOf[p.id] === undefined) layoutParentOf[p.id] = pid; }));
    const collapsed = new Set();
    const partnerForLayout = (p) => {
      if (p.spouse && byId[p.spouse]) return byId[p.spouse];
      if ((p.children || []).some((c) => byId[c])) return { id: p.id + '-spouse-placeholder', name: 'Spouse', gender: 'unknown', birth: '', death: '', children: [], placeholder: true };
      return null;
    };
    const makeGraphLayout = new Function(
      'RAW', 'byId', 'ROOT_ID', 'parentOf', 'partnerFor', 'collapsed',
      'CARD_W', 'CARD_H', 'GAP_X', 'SPOUSE_GAP', 'LEVEL_GAP', 'CHILD_Y_STEP', 'PAD', 'LEVEL_H',
      glSrc + '\n return graphLayout;'
    );
    const layout = makeGraphLayout(people, byId, 'padmanabh', layoutParentOf, partnerForLayout, collapsed,
      CARD_W, CARD_H, GAP_X, SPOUSE_GAP, LEVEL_GAP, CHILD_Y_STEP, PAD, LEVEL_H)();
    const placedIds = Object.keys(layout.positions).filter((id) => !layout.positions[id].placeholder);
    const missing = people.filter((p) => placedIds.indexOf(p.id) === -1).map((p) => p.id);
    assert(missing.length === 0, 'every person is positioned exactly once (missing: ' + missing.join(', ') + ')');
    let overlapCount = 0;
    for (let i = 0; i < placedIds.length; i++) {
      for (let j = i + 1; j < placedIds.length; j++) {
        const a = layout.positions[placedIds[i]], b = layout.positions[placedIds[j]];
        if (a.left < b.left + CARD_W && b.left < a.left + CARD_W && a.top < b.top + CARD_H && b.top < a.top + CARD_H) overlapCount++;
      }
    }
    assert(overlapCount === 0, 'no overlapping cards (' + overlapCount + ' overlaps)');
    const linkOk = layout.childLinks.concat(layout.parentLinks).every((l) => layout.positions[l.parent] && layout.positions[l.child]);
    assert(linkOk, 'every parent/child link connects two positioned cards');
    const couplesOk = layout.couples.every((c) => c.spouseId === null || (layout.positions[c.primaryId] && layout.positions[c.spouseId]));
    assert(couplesOk, 'every couple has positioned partner cards');
    // A married couple's two cards must stay side by side, with the SPOUSE card placed
    // strictly to the RIGHT of the primary (parent) card and exactly SPOUSE_GAP apart.
    // This is the core simplified rule; it also guards the regression where the old rigid
    // in-law x-cut shoved a spouse card (Arya) ~990px right of her husband (Rajesh).
    const spouseGapBad = [];
    layout.couples.forEach((c) => {
      if (!c.spouseId) return;
      const pa = layout.positions[c.primaryId], pb = layout.positions[c.spouseId];
      if (!pa || !pb || pa.placeholder || pb.placeholder) return;
      const rightOf = pb.left > pa.left;
      const gap = (pb.left - pa.left) - CARD_W;
      if (!rightOf || gap !== SPOUSE_GAP) spouseGapBad.push(c.primaryId + '~' + c.spouseId + ' right=' + rightOf + ' gap=' + gap);
    });
    assert(spouseGapBad.length === 0, 'every spouse sits directly right of its partner card, exactly SPOUSE_GAP apart: ' + (spouseGapBad.length ? spouseGapBad.join(', ') : 'none'));
    // Tidy-tree invariant: every parent's cx is the true centre of its own two cards (spouse
    // beside primary) so the bezier stem attaches exactly to the card pair — this is the old
    // cx-drift regression where Padmanabh's stem was ~7000px from his actual card.
    const pairCentreBad = [];
    (layout.childLinks || []).forEach((l) => {
      const pp = layout.positions[l.parent];
      if (!pp) return;
      const sp = layout.couples.find((c) => c.primaryId === l.parent);
      let ownCentre;
      if (sp && sp.spouseId) {
        const sb = layout.positions[sp.spouseId];
        ownCentre = (pp.left + CARD_W + sb.left) / 2;
      } else {
        ownCentre = pp.left + CARD_W / 2;
      }
      if (Math.abs(ownCentre - pp.cx) > 1) pairCentreBad.push(l.parent);
    });
    assert(pairCentreBad.length === 0, 'each parent cx is exactly centred on its own card pair (drift: ' + (pairCentreBad.length ? pairCentreBad.join(', ') : 'none') + ')');
    const rootSet = new Set(['padmanabh', 'taranath-bhandarkar']);
    const disconnected = [];
    people.forEach((p) => {
      if (rootSet.has(p.id)) return;
      const linkedAsChild = layout.childLinks.concat(layout.parentLinks).some((l) => l.child === p.id);
      const linkedAsSpouse = layout.couples.some((c) => c.primaryId === p.id || c.spouseId === p.id);
      const crossMarried = layout.marriageLinks.some((l) => l.a === p.id || l.b === p.id);
      if (!linkedAsChild && !linkedAsSpouse && !crossMarried) disconnected.push(p.id);
    });
    assert(disconnected.length === 0, 'every positioned person is connected via parent, spouse, or marriage (stray: ' + disconnected.join(', ') + ')');
    // The whole plane is translated so the leftmost card sits at x=0, and the main root is
    // centered among its descendants (radiating both sides) rather than hugging the left edge.
    const minLeft = Math.min.apply(null, placedIds.map((id) => layout.positions[id].left));
    assert(minLeft === 0, 'layout shifted so leftmost card is at x=0 (was ' + minLeft + ')');
    const ppRoot = layout.positions.padmanabh;
    const maxRightHere = Math.max.apply(null, placedIds.map((id) => layout.positions[id].left + CARD_W));
    const treeCentre = maxRightHere / 2;
    // Root cx should be within ~12% of the tree horizontal centre, not at the far left.
    assert(Math.abs(ppRoot.cx - treeCentre) / treeCentre < 0.12, 'main root is horizontally centred in the tree (root cx=' + ppRoot.cx.toFixed(0) + ', tree centre=' + treeCentre.toFixed(0) + ')');

    // ---- bezier connector geometry (mirrors the renderer's branch builder) ----
    const allBranchKids = {};
    (layout.childLinks || []).forEach((l) => { (allBranchKids[l.parent] = allBranchKids[l.parent] || []).push(l.child); });
    (layout.parentLinks || []).forEach((l) => { (allBranchKids[l.parent] = allBranchKids[l.parent] || []).push(l.child); });
    let dropsChecked = 0, overhangBad = 0;
    (Object.keys(allBranchKids) || []).forEach((pid) => {
      const kids = allBranchKids[pid].filter((c) => layout.positions[c]);
      if (!kids.length || !layout.positions[pid]) return;
      const startX = layout.positions[pid].cx + PAD;
      kids.forEach((c) => {
        const endX = layout.positions[c].left + PAD + CARD_W / 2;
        const endY = layout.positions[c].top + PAD;
        dropsChecked++;
        assert(endX === layout.positions[c].left + PAD + CARD_W / 2 && endY === layout.positions[c].top + PAD,
          'bezier ends at its rendered child card top-centre (' + pid + '->' + c + ')');
        if (endX !== layout.positions[c].left + PAD + CARD_W / 2) overhangBad++;
      });
    });
    assert(dropsChecked > 0, 'bezier endpoints were measured (' + dropsChecked + ')');
    assert(overhangBad === 0, 'no bezier endpoint overhangs its target card (' + overhangBad + ' bad)');
  }

  console.log('\n------------------------------------');
  if (failed) {
    console.log('FAIL: ' + failed + ' failed, ' + passed + ' passed');
    process.exit(1);
  }
  console.log('PASS: all ' + passed + ' assertions passed');
})();
