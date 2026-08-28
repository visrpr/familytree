const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const readline = require('readline');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const assumeYes = args.includes('--yes');
const mergeMode = args.includes('--merge');

function sql(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function text(value) {
  return "'" + String(value || '').replace(/'/g, "''") + "'";
}

function insertFor(person) {
  return `INSERT INTO people (id, name, maiden_name, gender, birth, death, spouse_id, children_json, parents_json, siblings_json, marriage, divorce, description, phone, email, address) VALUES (${sql(person.id)}, ${sql(person.name)}, ${sql(person.maidenName)}, ${sql(person.gender || 'unknown')}, ${text(person.birth)}, ${text(person.death)}, ${sql(person.spouse)}, ${sql(JSON.stringify(person.children || []))}, ${sql(JSON.stringify(person.parents || []))}, ${sql(JSON.stringify(person.siblings || []))}, ${sql(person.marriage || person.marriageYear)}, ${sql(person.divorce || person.divorceYear)}, ${sql(person.description)}, ${sql(person.phone)}, ${sql(person.email)}, ${sql(person.address)}) ON CONFLICT(id) DO UPDATE SET name = excluded.name, maiden_name = excluded.maiden_name, gender = excluded.gender, birth = excluded.birth, death = excluded.death, spouse_id = excluded.spouse_id, children_json = excluded.children_json, parents_json = excluded.parents_json, siblings_json = excluded.siblings_json, marriage = excluded.marriage, divorce = excluded.divorce, description = excluded.description, phone = excluded.phone, email = excluded.email, address = excluded.address;`;
}

function confirm(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(projectRoot, 'family-data.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const people = context.window.FAMILY_DATA || [];

  let statements;
  if (mergeMode) {
    statements = people.map(insertFor);
  } else {
    statements = ['DELETE FROM people;', ...people.map(insertFor)];
  }

  const modeLabel = mergeMode ? 'merge (upsert only, no delete)' : 'replace (delete all, then insert)';

  if (dryRun) {
    console.log(`[dry-run] would apply ${statements.length} statement(s) to people (${people.length} people).`);
    console.log('Preview (first 3):');
    console.log(statements.slice(0, 3).join('\n'));
    console.log('...');
    return;
  }

  if (!assumeYes) {
    const ok = await confirm(`This will ${modeLabel} the people records in the remote D1 database (photos are not touched).\nAre you sure? Type "yes" to continue: `);
    if (!ok) {
      console.log('Aborted. No changes were made. Use --dry-run to preview, or --yes to skip the prompt.');
      return;
    }
  }

  const sqlFile = path.join(projectRoot, 'people-seed.sql');
  fs.writeFileSync(sqlFile, statements.join('\n'));
  try {
    execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', 'family-tree', '--remote', '--file', sqlFile, '--config', path.join(projectRoot, 'wrangler.jsonc')], { cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(`Seeded ${people.length} people (${modeLabel}).`);
  } finally {
    fs.unlinkSync(sqlFile);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
