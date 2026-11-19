#!/usr/bin/env node
// Harness for dshx-patch-board's host half: drives the real /list and /reapply
// handlers with a fake Cordis context, so the new 1.0.1 logic (exemption targets,
// 0.9.10 reapply, hard-link-safe copy) can be checked without restarting DSH.
//
// The module is imported from the profile install copy on purpose: it resolves
// @deepseek-ai/schemastery from the hoisted profile node_modules, while the source
// tree alone has no dependencies installed.
//
// usage: node test-list.mjs [<installed index.js>] [--write]
//   --write   also exercise POST /reapply for subscriptions-empty-response
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE = path.join(HOME, 'profiles', 'desktop')
const ENTRY = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(PROFILE, 'node_modules', 'dshx-patch-board', 'index.js')
const WRITE = process.argv.includes('--write')

const handlers = new Map()
function makeCtx() {
  return {
    effect(fn) { fn(); return () => {} },
    webServer: { register(spec) { handlers.set(spec.path, spec.handler); return () => {} } },
    logger: { info() {}, warn() {} },
  }
}

function makeRes() {
  const out = { status: 0, headers: null, body: null }
  const res = {
    writeHead(status, headers) { out.status = status; out.headers = headers },
    end(text) { out.body = text },
  }
  return { res, out }
}

async function request(method, url, body) {
  const handler = handlers.get(url)
  if (!handler) throw new Error('no handler for ' + url)
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
  }
  const { res, out } = makeRes()
  await handler(req, res)
  return { status: out.status, json: out.body === null ? null : JSON.parse(out.body), raw: out.body }
}

function assert(cond, message) {
  if (!cond) throw new Error('ASSERT: ' + message)
}

const mod = await import(pathToFileURL(ENTRY).href)
mod.apply(makeCtx(), {})

const list = await request('GET', '/dshx-patch-board/list')
assert(list.status === 200, 'list returns 200, got ' + list.status)
const byId = new Map(list.json.patches.map((p) => [p.id, p]))
console.log(`host asar ${list.json.desktopVersion} · ${list.json.patches.length} patches · module ${list.json.version}\n`)

const expect = {
  // 2026-11-06: v6 desktop patch installed on 0.2.2-rc.1 (F:\ds\_fix\v6).
  'desktop-tray-restart': 'active',
  'desktop-focus-fix': 'active',
  'suggest-ghost-timeout': 'active',
  'suggest-ghost-no-glow': 'active',
  'suggest-ghost-remount': 'active',
  'subscriptions-empty-response': 'active',
}
// 2026-11-14: plugin-version-exemptions removed (dsh-workbuddy-connect is no longer installed).
if (byId.has('plugin-version-exemptions')) { console.log('FAIL  plugin-version-exemptions should be gone'); failures++ }
let failures = 0
for (const [id, want] of Object.entries(expect)) {
  const p = byId.get(id)
  if (!p) { console.log(`FAIL  ${id}: not in list`); failures++; continue }
  const ok = p.status === want
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${id.padEnd(28)} ${p.status.padEnd(10)} (want ${want})`)
  if (id === 'subscriptions-empty-response') {
    const ra = p.reapply
    const raOk = ra?.available === true && ra.whenVersion === '0.9.12'
    console.log(`      reapply: available=${ra?.available} whenVersion=${ra?.whenVersion} ${raOk ? '' : ra?.reason ?? ''}`)
    if (!raOk) failures++
  }
}

if (WRITE) {
  handlers.clear()
  mod.apply(makeCtx(), {})
  const re = await request('POST', '/dshx-patch-board/reapply', { id: 'subscriptions-empty-response' })
  const reOk = re.status === 200 && re.json?.ok === true && re.json.after?.status === 'active'
  if (!reOk) failures++
  console.log(`\n${reOk ? 'ok  ' : 'FAIL'}  POST /reapply subscriptions-empty-response -> ${re.status} ${re.json?.ok ? 'ok' : JSON.stringify(re.json).slice(0, 160)}`)
  const nm = path.join(PROFILE, 'node_modules/dsh-plugin-subscriptions/lib/index.js')
  const nlink = fs.statSync(nm).nlink
  const linkOk = nlink === 1
  if (!linkOk) failures++
  console.log(`${linkOk ? 'ok  ' : 'FAIL'}  patched file is its own copy (nlink=${nlink}, must be 1 to keep the pnpm store clean)`)
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
