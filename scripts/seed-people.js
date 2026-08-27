const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'family-data.js'), 'utf8');
const context = { window: {} };
vm.runInNewContext(source, context);
const people = context.window.FAMILY_DATA || [];

function sql(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function text(value) {
  return "'" + String(value || '').replace(/'/g, "''") + "'";
}

const statements = [
  'DELETE FROM people;',
  ...people.map(person => `INSERT INTO people (id, name, maiden_name, gender, birth, death, spouse_id, children_json, parents_json, siblings_json, marriage, divorce, description, phone, email, address) VALUES (${sql(person.id)}, ${sql(person.name)}, ${sql(person.maidenName)}, ${sql(person.gender || 'unknown')}, ${text(person.birth)}, ${text(person.death)}, ${sql(person.spouse)}, ${sql(JSON.stringify(person.children || []))}, ${sql(JSON.stringify(person.parents || []))}, ${sql(JSON.stringify(person.siblings || []))}, ${sql(person.marriage || person.marriageYear)}, ${sql(person.divorce || person.divorceYear)}, ${sql(person.description)}, ${sql(person.phone)}, ${sql(person.email)}, ${sql(person.address)});`)
];

const sqlFile = path.join(projectRoot, 'people-seed.sql');
fs.writeFileSync(sqlFile, statements.join('\n'));
try {
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'd1', 'execute', 'family-tree', '--remote', '--file', sqlFile, '--config', path.join(projectRoot, 'wrangler.jsonc')], { cwd: projectRoot, stdio: 'inherit', shell: process.platform === 'win32' });
} finally {
  fs.unlinkSync(sqlFile);
}