// Execute the served bundle's apply() against a stand-in context, the way the
// client module system does after its inject services are ready. This catches a
// throw that the static guard cannot see.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
// Resolve React from the profile that runs the plugin, not a fixed checkout
// path: the bundle only ever sees the shell's own React.
const require = createRequire(import.meta.url)
const React = require(process.env.DSH_REACT_PATH ?? 'react')

const src = readFileSync(process.argv[2], 'utf8')
let registered
const styleTags = []
const window = { __ModuleLoader__: { load: (o) => { registered = o } } }
const document = {
  getElementById: () => null,
  createElement: () => ({ style: {}, textContent: '', remove() {} }),
  head: { appendChild: (tag) => styleTags.push(tag) },
}
const fn = new Function('window', 'document', 'React', 'module', 'exports', src + '\nreturn window.__ModuleLoader__.load')
fn(window, document, React, {}, {})
const mod = registered.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require(${name})`)
})
if (typeof mod.apply !== 'function') throw new Error('no apply')

const panels = []
const disposers = []
const ctx = {
  effect(fn, label) {
    const d = fn?.()
    if (typeof d === 'function') disposers.push(d)
    return () => {}
  },
  locale: { register: () => () => {}, bind: () => (k) => k, getSnapshot: () => ({ active: 'zh' }) },
  slots: {
    inject: (name, cb) => { const d = cb(); if (typeof d === 'function') disposers.push(d); return () => {} },
    register: (opts) => { panels.push(opts); return () => {} },
  },
  layout: { selectPanel() {}, panelInfo: { getSnapshot: () => ({ activePanelId: null }) } },
}
mod.apply(ctx)
console.log('apply() ran without throwing')
console.log('style tags installed:', styleTags.length)
console.log('slot registrations:', panels.map(p => `${p.name}:${p.key ?? p.id}`).join(', '))
// Teardown must also be safe, or disabling the row throws during unload.
for (const dispose of disposers.reverse()) dispose()
console.log('disposers ran cleanly:', disposers.length)
