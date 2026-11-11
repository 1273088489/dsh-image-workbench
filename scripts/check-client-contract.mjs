// Static contract check for the browser half: the bundle must declare every
// ctx service its apply() reads, or Cordis activates it before they exist and
// the boot audit fails the whole row (the 2026-11-05 outage).
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const src = readFileSync(file, 'utf8')
let failures = 0
const fail = (message) => { console.log('FAIL ' + message); failures += 1 }
const pass = (message) => { console.log('ok   ' + message) }

// 1) apply() body
const start = src.indexOf('      apply(ctx) {')
if (start < 0) fail('apply(ctx) not found')
else {
  const block = src.slice(start)
  const services = [...new Set([...block.matchAll(/ctx\.([a-zA-Z][a-zA-Z0-9]*)\./g)].map(m => m[1]))]
  const declared = (src.match(/inject: \[([^\]]*)\]/) ?? [, ''])[1]
  const declaredSet = new Set([...declared.matchAll(/'([^']+)'/g)].map(m => m[1]))
  for (const service of services) {
    if (declaredSet.has(service)) pass(`inject declares ${service}`)
    else fail(`apply() reads ctx.${service} but inject does not declare it`)
  }
  // A dotted namespace (remote.session) needs its head too.
  for (const name of declaredSet) {
    if (!name.includes('.')) continue
    const head = name.split('.')[0]
    if (!declaredSet.has(head)) fail(`inject names ${name} without its head ${head}`)
  }
}

// 2) no non-browser globals at module scope
for (const banned of ['process.env', '__dirname', 'setImmediate', 'Buffer.']) {
  if (src.includes(banned)) fail(`bundle references non-browser global ${banned}`)
  else pass(`no ${banned}`)
}

// 3) the module loader wrapper is intact
if (!src.startsWith('window.__ModuleLoader__.load(')) fail('missing __ModuleLoader__ wrapper')
else pass('__ModuleLoader__ wrapper present')
if (!/^\s{4}return \{\s*$/m.test(src)) fail('module factory returns no object')
else pass('factory returns the module object')
if (!/^\s{6,8}apply\(ctx\) \{/m.test(src)) fail('exported object has no apply(ctx)')
else pass('exports apply(ctx)')

console.log(failures === 0
  ? '\nGUARD PASS (static: inject contract, globals, module shape)'
  : `\nGUARD FAIL (${failures})`)
console.log('note: this script does not execute apply(); run check-client-apply.mjs for that')
process.exit(failures === 0 ? 0 : 1)
