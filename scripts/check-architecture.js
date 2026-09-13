const fs = require('fs'); const path = require('path');
const apps = path.join(process.cwd(), 'apps'); let failures = [];
for (const app of fs.readdirSync(apps, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  for (const file of walk(path.join(apps, app, 'src')).filter((f) => f.endsWith('.ts'))) {
    const content = fs.readFileSync(file, 'utf8');
    for (const other of fs.readdirSync(apps)) if (other !== app && new RegExp(`apps[\\\\/]${other}[\\\\/]`).test(content)) failures.push(`${file} imports implementation from ${other}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('Architecture boundaries: OK');
