// dshx-patch-board — host half.
//
// 设置页「补丁」栏目的数据源：逐个检查本机打过的本地补丁现在是否还在。
// DSH 桌面端自动更新会整个替换 app.asar，插件更新/重装会覆盖 node_modules
// 里的文件——补丁会悄无声息地消失。这里按「标记文本」判定：目标文件里还能
// 找到补丁写入的标记 = 生效中；文件在但标记没了 = 已被覆盖。
//
// Endpoints (behind the Web GUI's own auth):
//   GET  /dshx-patch-board/list      全部补丁的当前状态
//   POST /dshx-patch-board/reapply   { id } 用备份的已修复文件重新覆盖（仅插件文件类补丁）
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import z from '@deepseek-ai/schemastery'

export const name = 'dshx-patch-board'
export const inject = ['webServer']

export const Config = z.object({
  asarPath: z.string().default('C:\\Deepseek Harness\\resources\\app.asar').description('DSH 桌面端 app.asar 路径。'),
  profileDir: z.string().default('').description('profile 目录；留空则从本插件安装位置推断。'),
  extraFile: z.string().default('').description('额外补丁清单（JSON 数组）；留空用 $DSH_HOME/dshx-patch-board/patches.json。'),
})

const VERSION = '1.0.4'
const BASE = '/dshx-patch-board'

/**
 * 内置补丁清单。
 * targets[].kind: 'asar'（app.asar 内的文件）| 'profile'（相对 profile 目录的文件）
 *                 | 'exemption'（profile/compatibility.json 里针对当前宿主版本的精确版本豁免）
 * targets[].markers: 补丁写入的、原版文件里不会出现的文本；全部命中才算生效。
 * reapply: 插件文件类补丁可一键重新覆盖（仅当已安装版本 === whenVersion）。
 * script: 桌面端补丁需要先退出 DSH，只能给出安装脚本路径。
 */
const BUILTIN = [
  {
    id: 'desktop-tray-restart',
    title: '托盘菜单「重启服务」',
    scope: 'DSH 桌面端',
    description: '在系统托盘右键菜单里加一项「重启服务」，一键重启应用和 Host；有正在运行的任务时会先弹确认。',
    lostWhen: 'DSH 桌面端自动更新会整体替换 app.asar。',
    targets: [{ kind: 'asar', file: 'lib/main.js', markers: ['/*dshx-tray-restart*/'] }],
    script: 'F:\\ds\\_fix\\v6\\install.ps1',
  },
  {
    id: 'desktop-focus-fix',
    title: '键盘焦点修复',
    scope: 'DSH 桌面端',
    description: '修复 Windows 上窗口切回来后输入框点不进去、键盘打不了字（粘贴和语音却能用）的问题。',
    lostWhen: 'DSH 桌面端自动更新会整体替换 app.asar。',
    targets: [
      { kind: 'asar', file: 'lib/main.js', markers: ['/*dshx-focus-fix*/'] },
      { kind: 'asar', file: 'lib/preload-app.cjs', markers: ['/*dshx-focus-fix*/'] },
    ],
    script: 'F:\\ds\\_fix\\v6\\install.ps1',
  },
  {
    id: 'suggest-ghost-timeout',
    title: '输入预测：超时参数修复',
    scope: 'dsh-suggest-ghost',
    pkg: 'dsh-suggest-ghost',
    description: '新版内核把数值配置包成引用对象，插件没解包，导致每次生成建议都报「timeoutMs must be a positive finite number」，灰字建议永远不出现。',
    lostWhen: '插件更新或重装会覆盖 lib/generate.js。',
    targets: [{ kind: 'profile', file: 'node_modules/dsh-suggest-ghost/lib/generate.js', markers: ['timeoutMs: readVolatile(config.timeoutMs'] }],
    reapply: { whenVersion: '0.5.1', copies: [{ from: 'F:\\ds\\_fix\\suggest-ghost-backup\\generate.js.0.5.1-fixed', to: 'node_modules/dsh-suggest-ghost/lib/generate.js' }] },
  },
  {
    id: 'suggest-ghost-no-glow',
    title: '输入预测：去掉灰字光晕',
    scope: 'dsh-suggest-ghost',
    pkg: 'dsh-suggest-ghost',
    description: '去掉建议灰字周围的同色柔光（text-shadow），避免显得发糊、发脏，观感与原生占位文字一致。',
    lostWhen: '插件更新或重装会覆盖 lib/client.js。',
    targets: [{ kind: 'profile', file: 'node_modules/dsh-suggest-ghost/lib/client.js', markers: ['"text-shadow:none"'] }],
    reapply: { whenVersion: '0.5.1', copies: [{ from: 'F:\\ds\\_fix\\suggest-ghost-backup\\client.js.0.5.1-fixed', to: 'node_modules/dsh-suggest-ghost/lib/client.js' }] },
  },
  {
    id: 'suggest-ghost-remount',
    title: '输入预测：切页后重新挂载',
    scope: 'dsh-suggest-ghost',
    pkg: 'dsh-suggest-ghost',
    description: '切换页面或标签页回来时输入框会被重建，补上重新挂载，避免灰字残影或消失。',
    lostWhen: '插件更新或重装会覆盖 lib/client.js。',
    targets: [{ kind: 'profile', file: 'node_modules/dsh-suggest-ghost/lib/client.js', markers: ['remountObserver'] }],
    reapply: { whenVersion: '0.5.1', copies: [{ from: 'F:\\ds\\_fix\\suggest-ghost-backup\\client.js.0.5.1-fixed', to: 'node_modules/dsh-suggest-ghost/lib/client.js' }] },
  },
  {
    id: 'subscriptions-empty-response',
    title: '订阅：空响应自动重试',
    scope: 'dsh-plugin-subscriptions',
    pkg: 'dsh-plugin-subscriptions',
    description: '模型还没输出任何内容就断流（EMPTY_RESPONSE）时自动重试一次；已经输出了部分内容或工具调用的不会重放。',
    lostWhen: '插件更新或重装会覆盖 lib/index.js（pnpm 从全局 store 重新硬链接时也算）。',
    targets: [
      { kind: 'profile', file: 'node_modules/dsh-plugin-subscriptions/lib/index.js', markers: ['./empty-response-recovery.js', 'recoverEmptyResponse(openAttempt'] },
      { kind: 'profile', file: 'node_modules/dsh-plugin-subscriptions/lib/empty-response-recovery.js', markers: ['recoverEmptyResponse'] },
    ],
    reapply: {
      whenVersion: '0.9.12',
      copies: [
        { from: 'F:\\ds\\_fix\\subscriptions-empty-response\\lib-0.9.12\\index.js', to: 'node_modules/dsh-plugin-subscriptions/lib/index.js' },
        { from: 'F:\\ds\\_fix\\subscriptions-empty-response\\lib\\empty-response-recovery.js', to: 'node_modules/dsh-plugin-subscriptions/lib/empty-response-recovery.js' },
      ],
    },
  },
]

function errorText(error) {
  if (error instanceof Error) return error.message
  try { return String(error) } catch { return 'unknown error' }
}

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

function defaultProfileDir() {
  // <profile>/node_modules/dshx-patch-board/index.js
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, '..', '..')
}

async function readText(file) {
  try { return await fsp.readFile(file, 'utf8') } catch { return null }
}

async function readPkgVersion(profileDir, pkg) {
  const text = await readText(path.join(profileDir, 'node_modules', pkg, 'package.json'))
  if (text === null) return null
  try { return JSON.parse(text).version ?? null } catch {
    const m = text.match(/"version"\s*:\s*"([^"]+)"/)
    return m ? m[1] : null
  }
}

/**
 * Host 跑在 Electron 的 node 模式里，`fs` 被打了 asar 补丁：把 app.asar 当目录，
 * 直接 open 会 ENOENT。原始字节必须走 `original-fs`；纯 Node 下回落到 fs。
 */
let rawFsPromise = null
function rawFs() {
  rawFsPromise ??= import('original-fs').then((m) => (m.default ?? m).promises).catch(() => fsp)
  return rawFsPromise
}

/** 只读 asar 头和需要的几个文件，不把整个 asar 读进内存。按 mtime+size 缓存。 */
let asarCache = null
async function readAsar(asarPath, names) {
  const fsp = await rawFs()
  let stat
  try { stat = await fsp.stat(asarPath) } catch { return null }
  const key = asarPath + '|' + stat.mtimeMs + '|' + stat.size
  if (asarCache === null || asarCache.key !== key) asarCache = { key, files: new Map(), header: null, version: null, mtime: stat.mtime }
  const missing = names.filter((n) => !asarCache.files.has(n))
  if (missing.length === 0 && asarCache.header !== null) return asarCache
  const fh = await fsp.open(asarPath, 'r')
  try {
    if (asarCache.header === null) {
      const head = Buffer.alloc(16)
      await fh.read(head, 0, 16, 0)
      const headerSize = head.readUInt32LE(4)
      const strLen = head.readUInt32LE(12)
      const hb = Buffer.alloc(strLen)
      await fh.read(hb, 0, strLen, 16)
      asarCache.header = JSON.parse(hb.toString('utf8'))
      asarCache.base = 8 + headerSize
    }
    const readInner = async (name) => {
      let node = asarCache.header
      for (const part of name.split('/')) node = node?.files?.[part]
      if (!node || node.files || node.offset === undefined || node.unpacked) return null
      const b = Buffer.alloc(node.size)
      await fh.read(b, 0, node.size, asarCache.base + Number(node.offset))
      return b.toString('utf8')
    }
    for (const n of missing) asarCache.files.set(n, await readInner(n))
    if (asarCache.version === null) {
      const pkg = await readInner('package.json')
      try { asarCache.version = pkg ? JSON.parse(pkg).version ?? null : null } catch { asarCache.version = null }
    }
  } finally {
    await fh.close()
  }
  return asarCache
}

function loadExtra(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.id === 'string' && Array.isArray(p.targets)) : []
  } catch {
    return []
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = Config(rawConfig)
  const profileDir = config.profileDir || defaultProfileDir()
  const extraFile = config.extraFile || path.join(dshHome(), 'dshx-patch-board', 'patches.json')

  const catalog = () => {
    const extra = loadExtra(extraFile).map((p) => ({ ...p, custom: true }))
    const ids = new Set(extra.map((p) => p.id))
    return BUILTIN.filter((p) => !ids.has(p.id)).concat(extra)
  }

  /** Read profile/compatibility.json once per request; missing or malformed reads as no exemptions. */
  async function readExemptions() {
    const file = path.join(profileDir, 'compatibility.json')
    const text = await readText(file)
    if (text === null) return { file, exists: false, data: null }
    try {
      const data = JSON.parse(text.replace(/^\uFEFF/, ''))
      return { file, exists: true, data: data && typeof data === 'object' ? data : null }
    } catch {
      return { file, exists: true, data: null }
    }
  }

  async function inspect(patch, hostVersion) {
    const asarNames = patch.targets.filter((t) => t.kind === 'asar').map((t) => t.file)
    const asar = asarNames.length ? await readAsar(config.asarPath, asarNames.concat()) : null
    const needsExemptions = patch.targets.some((t) => t.kind === 'exemption')
    const exemptions = needsExemptions ? await readExemptions() : null
    const runtime = hostVersion ?? (asar ? asar.version : null)
    const targets = []
    for (const t of patch.targets) {
      if (t.kind === 'exemption') {
        const key = `${t.pkg}@${t.version}`
        const versions = exemptions?.data?.[key]
        const granted = Array.isArray(versions) && runtime !== null && versions.includes(runtime)
        targets.push({
          where: (exemptions?.file ?? path.join(profileDir, 'compatibility.json')) + ' → ' + key,
          exists: exemptions?.exists === true && exemptions.data !== null,
          markers: [{
            text: `${key} on dsh ${runtime ?? '未知宿主版本'}`,
            found: granted,
            grantedFor: Array.isArray(versions) ? versions : [],
          }],
        })
        continue
      }
      let content = null
      let where
      if (t.kind === 'asar') {
        where = config.asarPath + ' → ' + t.file
        content = asar ? asar.files.get(t.file) ?? null : null
      } else {
        where = path.isAbsolute(t.file) ? t.file : path.join(profileDir, t.file)
        content = await readText(where)
      }
      const markers = (t.markers || []).map((m) => ({ text: m, found: content !== null && content.includes(m) }))
      targets.push({ where, exists: content !== null, markers })
    }
    const all = targets.flatMap((t) => t.markers)
    let status
    if (targets.some((t) => !t.exists)) status = 'unavailable'
    else if (all.every((m) => m.found)) status = 'active'
    else if (all.some((m) => m.found)) status = 'partial'
    else status = 'missing'

    const installed = patch.pkg ? await readPkgVersion(profileDir, patch.pkg) : (asar ? asar.version : null)
    let reapply = null
    if (patch.reapply) {
      const sourcesOk = patch.reapply.copies.every((c) => fs.existsSync(c.from))
      const versionOk = !patch.reapply.whenVersion || patch.reapply.whenVersion === installed
      reapply = {
        whenVersion: patch.reapply.whenVersion ?? null,
        available: sourcesOk && versionOk,
        reason: !sourcesOk ? '备份的已修复文件不见了' : !versionOk ? `备份文件是给 ${patch.reapply.whenVersion} 版做的，当前装的是 ${installed ?? '未知版本'}，不能直接覆盖` : '',
      }
    }
    return {
      id: patch.id,
      title: patch.title,
      scope: patch.scope,
      description: patch.description,
      lostWhen: patch.lostWhen ?? '',
      custom: Boolean(patch.custom),
      status,
      installedVersion: installed,
      targets,
      reapply,
      script: patch.script ?? null,
    }
  }

  function sender(res) {
    return (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
  }

  async function readBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 8192) throw new Error('body too large')
      chunks.push(chunk)
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BASE + '/list',
    handler: async (req, res) => {
      const send = sender(res)
      if ((req.method ?? 'GET') !== 'GET') return send(405, { error: 'method not allowed' })
      try {
        const asar = await readAsar(config.asarPath, []).catch(() => null)
        const patches = []
        for (const p of catalog()) {
          try { patches.push(await inspect(p, asar ? asar.version : null)) } catch (error) {
            patches.push({ id: p.id, title: p.title ?? p.id, scope: p.scope ?? '', description: p.description ?? '', status: 'error', error: errorText(error), targets: [] })
          }
        }
        return send(200, {
          patches,
          desktopVersion: asar ? asar.version : null,
          desktopUpdatedAt: asar ? asar.mtime : null,
          profileDir,
          extraFile,
          version: VERSION,
          at: Date.now(),
        })
      } catch (error) {
        return send(500, { error: errorText(error) })
      }
    },
  }), 'dshx-patch-board-list')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BASE + '/reapply',
    handler: async (req, res) => {
      const send = sender(res)
      if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
      try {
        const { id } = await readBody(req)
        const patch = catalog().find((p) => p.id === id)
        if (!patch || !patch.reapply) return send(400, { error: '这个补丁不支持一键重新应用' })
        const asar = await readAsar(config.asarPath, []).catch(() => null)
        const hostVersion = asar ? asar.version : null
        const state = await inspect(patch, hostVersion)
        if (!state.reapply?.available) return send(409, { error: state.reapply?.reason || '当前不能重新应用' })
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')
        const done = []
        for (const c of patch.reapply.copies) {
          const to = path.isAbsolute(c.to) ? c.to : path.join(profileDir, c.to)
          if (fs.existsSync(to)) {
            await fsp.copyFile(to, `${to}.bak-patchboard-${stamp}`)
            // pnpm hard-links node_modules files to its global store: writing through the
            // link would corrupt the store copy for every other project, so drop the link.
            const st = await fsp.stat(to)
            if (st.nlink > 1) await fsp.unlink(to)
          }
          await fsp.copyFile(c.from, to)
          done.push(to)
        }
        ctx.logger?.info?.('dshx-patch-board: reapplied %s -> %s', id, done.join(', '))
        return send(200, { ok: true, written: done, after: await inspect(patch, hostVersion) })
      } catch (error) {
        return send(500, { error: errorText(error) })
      }
    },
  }), 'dshx-patch-board-reapply')
}
