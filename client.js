// dshx-patch-board — browser half.
//
// 1. 设置页新增「补丁」栏目：列出本机打过的本地补丁、它们现在是否还生效。
// 2. 给设置导航里落到默认齿轮图标的第三方栏目换上各自的图标。
//    宿主的 navIcon() 只认 account/models/agent-presets/plugins/archived-sessions，
//    其余一律画齿轮。新宿主把齿轮包进 navIcon 的 <span>，不再是按钮的直接子 svg。
//    做法同 dshmarket：按可见文字认领那一行，藏掉这一行里的齿轮（不管套了几层），
//    用 CSS mask 画新图标（颜色跟随 currentColor）。
window.__ModuleLoader__.load({
  id: 'dshx-patch-board',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const VERSION = '1.0.3'
    const LABEL = '补丁'

    // ---------------------------------------------------------------- icons
    // 24×24 线性图标，1.8 描边、圆头，与宿主 Outline Medium 图标同一视觉重量。
    const P = (d) => `<path d="${d}"/>`
    const ICONS = {
      // 用量与费用：柱状图 + 基线
      usage: P('M4 20h16') + P('M7 16v-4') + P('M12 16V7') + P('M17 16v-6'),
      // AI 审批：盾牌 + 对勾
      approval: P('M12 3 5 6v5c0 4.4 3 8.2 7 10 4-1.8 7-5.6 7-10V6l-7-3Z') + P('m9 12 2 2 4-4'),
      // 技能管理：闪光（大星 + 小星）
      skills: P('M10 4l1.6 4.4L16 10l-4.4 1.6L10 16l-1.6-4.4L4 10l4.4-1.6L10 4Z') + P('M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14Z'),
      // 远程控制：手机 + 信号弧
      remote: '<rect x="4" y="7" width="9" height="14" rx="2"/>' + P('M8 18h1') + P('M16 7.5a4 4 0 0 1 0 5') + P('M18.5 5a7.5 7.5 0 0 1 0 10'),
      // 状态文案：对话气泡 + 两行字
      status: P('M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z') + P('M8 9h8') + P('M8 12h5'),
      // 订阅：钥匙
      subscriptions: '<circle cx="8" cy="15" r="4"/>' + P('m11 12 8-8') + P('m16 7 2 2') + P('m14 9 1.5 1.5'),
      // 输入预测：文本光标 + 虚影字
      predict: P('M4 7h7') + P('M4 12h4') + P('M11 5v14') + P('M9.5 5h3') + P('M9.5 19h3') + P('M14 12h1') + P('M17 12h1') + P('M20 12h.5'),
      // 补丁：斜放的创可贴
      patch: '<rect x="2.6" y="8.5" width="18.8" height="7" rx="3.5" transform="rotate(-45 12 12)"/>' + P('M10.5 10.5h.01') + P('M13.5 10.5h.01') + P('M10.5 13.5h.01') + P('M13.5 13.5h.01'),
    }
    /** 可见文字 → 图标。中英文标签都认。 */
    const LABEL_ICON = {
      '用量与费用': 'usage', 'Usage & Cost': 'usage',
      'AI 审批': 'approval', 'AI Approval': 'approval',
      '技能管理': 'skills', 'Skills': 'skills',
      '远程控制': 'remote', 'Remote Control': 'remote',
      '状态文案': 'status', 'Status Texts': 'status',
      '订阅': 'subscriptions', 'Subscriptions': 'subscriptions',
      '输入预测': 'predict', 'Input prediction': 'predict',
      [LABEL]: 'patch', 'Patches': 'patch',
    }
    const MARK = 'data-dshx-nav-icon'
    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'

    function maskUrl(body) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
      return `data:image/svg+xml,${encodeURIComponent(svg)}`
    }
    function navCss() {
      const rules = [
        // 旧宿主齿轮是按钮的直接子 svg；0.2.2 起包在 navIcon span 里。两种都藏，
        // 否则 ::before 的新图标会和后面那个齿轮叠在一起。
        `[${MARK}] svg { display: none !important; }`,
        `[${MARK}]::before { content: ''; flex: none; width: 16px; height: 16px; background-color: currentColor;` +
          ' -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center;' +
          ' -webkit-mask-size: 16px 16px; mask-size: 16px 16px; }',
      ]
      for (const key of Object.keys(ICONS)) {
        const url = maskUrl(ICONS[key])
        rules.push(`[${MARK}="${key}"]::before { -webkit-mask-image: url("${url}"); mask-image: url("${url}"); }`)
      }
      return rules.join('\n')
    }
    function installNavIcons(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.pluginCss = 'dshx-patch-board/nav-icons'
        tag.textContent = navCss()
        document.head.appendChild(tag)
        let disposed = false
        let scheduled = false
        const sync = () => {
          scheduled = false
          if (disposed) return
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
            // 只认领还在用默认齿轮（有 svg 子节点）且标签在表里的行；别的插件已认领的行不碰。
            const key = LABEL_ICON[String(row.textContent || '').trim()]
            const ownedByOther = [...row.attributes].some((a) => a.name !== MARK && /^data-.*nav-icon$/.test(a.name))
            if (key && !ownedByOther) { if (row.getAttribute(MARK) !== key) row.setAttribute(MARK, key) }
            else if (row.hasAttribute(MARK)) row.removeAttribute(MARK)
          }
        }
        const schedule = () => {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(sync)
        }
        sync()
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        return () => {
          disposed = true
          observer.disconnect()
          for (const row of document.querySelectorAll(`[${MARK}]`)) row.removeAttribute(MARK)
          tag.remove()
        }
      }, 'dshx-patch-board: settings nav icons')
    }

    // ---------------------------------------------------------------- panel
    const card = {
      border: '1px solid rgba(127,127,127,0.22)',
      borderRadius: 10,
      padding: '12px 14px',
      background: 'rgba(127,127,127,0.07)',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }
    const button = {
      border: '1px solid rgba(127,127,127,0.35)',
      background: 'transparent',
      color: 'inherit',
      borderRadius: 6,
      padding: '5px 12px',
      fontSize: 12,
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    }
    const tag = {
      display: 'inline-block',
      padding: '0 7px',
      borderRadius: 99,
      fontSize: 10.5,
      lineHeight: '17px',
      border: '1px solid rgba(127,127,127,0.3)',
      opacity: 0.75,
      whiteSpace: 'nowrap',
    }
    const STATUS = {
      active: { text: '生效中', color: '#2ea043' },
      partial: { text: '部分丢失', color: '#d29922' },
      missing: { text: '已被覆盖', color: '#d9534f' },
      unavailable: { text: '目标不存在', color: '#8b949e' },
      error: { text: '检查出错', color: '#d9534f' },
    }

    function api(p, body) {
      const init = body === undefined
        ? { credentials: 'same-origin' }
        : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      return fetch('/dshx-patch-board/' + p, init).then((response) =>
        response.json().catch(() => ({})).then((data) => {
          if (!response.ok) throw new Error(data.error || 'HTTP ' + String(response.status))
          return data
        }))
    }

    function copy(text) {
      try { navigator.clipboard.writeText(text) } catch { /* ignore */ }
    }

    function StatusPill(props) {
      const s = STATUS[props.status] || STATUS.error
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600,
          color: s.color, whiteSpace: 'nowrap',
        },
      }, h('span', { style: { width: 7, height: 7, borderRadius: 4, background: s.color } }), s.text)
    }

    function PatchCard(props) {
      const p = props.patch
      const [open, setOpen] = React.useState(false)
      const lost = p.status === 'missing' || p.status === 'partial'
      return h('div', { style: Object.assign({}, card, lost ? { borderColor: 'rgba(217,83,79,0.45)' } : {}) },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 13.5, fontWeight: 600 } }, p.title),
          h('span', { style: tag }, p.scope),
          p.installedVersion ? h('span', { style: tag }, 'v' + p.installedVersion) : null,
          p.custom ? h('span', { style: tag }, '自定义') : null,
          h('span', { style: { flex: 1 } }),
          h(StatusPill, { status: p.status })),
        h('div', { style: { fontSize: 12.5, lineHeight: 1.6, opacity: 0.85 } }, p.description),
        lost && p.lostWhen ? h('div', { style: { fontSize: 12, color: '#d9534f', lineHeight: 1.6 } }, '可能原因：' + p.lostWhen) : null,
        p.error ? h('div', { style: { fontSize: 12, color: '#d9534f' } }, p.error) : null,
        lost ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 } },
          p.reapply && p.reapply.available
            ? h('button', { style: button, disabled: props.busy, onClick: () => props.onReapply(p) }, props.busy ? '处理中…' : '重新应用')
            : null,
          p.reapply && !p.reapply.available
            ? h('span', { style: { fontSize: 12, opacity: 0.7 } }, p.reapply.reason + '，需要让助手按新版本重新打补丁。')
            : null,
          p.script
            ? h(React.Fragment, null,
                h('span', { style: { fontSize: 12, opacity: 0.7 } }, '需先退出 DSH，再右键用 PowerShell 运行：'),
                h('code', { style: { fontSize: 11.5, cursor: 'pointer' }, title: '点击复制路径', onClick: () => copy(p.script) }, p.script))
            : null) : null,
        h('div', {
          style: { fontSize: 11, opacity: 0.55, cursor: 'pointer', userSelect: 'none' },
          onClick: () => setOpen(!open),
        }, open ? '▾ 收起检查详情' : '▸ 检查详情'),
        open ? h('div', { style: { fontSize: 11.5, opacity: 0.75, lineHeight: 1.7, wordBreak: 'break-all' } },
          (p.targets || []).map((t, i) => h('div', { key: i },
            h('div', null, (t.exists ? '' : '（文件不存在）') + t.where),
            (t.markers || []).map((m, j) => h('div', { key: j, style: { paddingLeft: 12 } },
              (m.found ? '✓ ' : '✗ ') + m.text))))) : null)
    }

    function PatchSection() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [working, setWorking] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        let alive = true
        setBusy(true)
        api('list')
          .then((r) => { if (alive) { setData(r); setError('') } })
          .catch((e) => { if (alive) setError(e.message || String(e)) })
          .finally(() => { if (alive) setBusy(false) })
        return () => { alive = false }
      }, [nonce])

      function reapply(p) {
        setWorking(p.id)
        api('reapply', { id: p.id })
          .then(() => setNotice('已重新应用「' + p.title + '」。插件后台部分要重启 DSH 才生效；页面部分刷新即可。'))
          .catch((e) => setNotice('重新应用失败：' + (e.message || String(e))))
          .finally(() => { setWorking(''); setNonce((n) => n + 1) })
      }

      const patches = data ? data.patches : []
      const count = (s) => patches.filter((p) => p.status === s).length
      const lost = count('missing') + count('partial')
      const updated = data && data.desktopUpdatedAt ? new Date(data.desktopUpdatedAt) : null

      return h('div', { style: { padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 12, color: 'inherit' } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 } },
          h('div', null,
            h('h2', { style: { margin: 0, fontSize: 15, fontWeight: 600 } }, '补丁'),
            h('div', { style: { marginTop: 4, fontSize: 12, opacity: 0.6 } },
              data
                ? '共 ' + patches.length + ' 个本地补丁：' + count('active') + ' 个生效中' + (lost ? '，' + lost + ' 个已被覆盖' : '')
                  + (data.desktopVersion ? ' · 桌面端 ' + data.desktopVersion : '')
                  + (updated ? '（' + updated.toLocaleString() + ' 安装）' : '')
                : '读取中…')),
          h('button', { style: button, disabled: busy, onClick: () => setNonce((n) => n + 1) }, busy ? '检查中' : '重新检查')),
        lost ? h('div', { style: { fontSize: 12.5, color: '#d9534f', lineHeight: 1.6 } },
          '有补丁被更新或重装覆盖了，对应的修复已经不起作用。') : null,
        notice ? h('div', { style: { fontSize: 12, opacity: 0.75 } }, notice) : null,
        error ? h('div', { style: { fontSize: 12, color: '#d9534f' } }, error) : null,
        patches.map((p) => h(PatchCard, { key: p.id, patch: p, busy: working === p.id, onReapply: reapply })),
        h('div', { style: { fontSize: 11, opacity: 0.45, lineHeight: 1.6 } },
          '这里只读取文件检查补丁标记，不会自动修改任何东西。自定义补丁可写进 ',
          h('code', null, data ? data.extraFile : 'patches.json'),
          ' · dshx-patch-board v' + VERSION))
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dshx-patch-board',
        order: 95,
        label: LABEL,
      }, PatchSection))
      installNavIcons(ctx)
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
