window.__ModuleLoader__.load({
  id: 'dsh-image-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /**
     * Browser half of the image workbench: one sidebar row and the keyed main
     * panel it opens.
     *
     * The panel owns no provider knowledge. Channel ids, model lists, size
     * bounds, step parameter names, billing, seed support, image-input facts and
     * per-channel concurrency all arrive from the Host's capability route, which
     * merges a declarative table with live introspection of the Python module.
     * The only strings here are route paths, storage keys and copy.
     *
     * A generation is no longer one at a time. The Host hands out permits per
     * channel and queues the rest, so this half submits a batch and then reads
     * the whole queue from `/jobs` on a single poll rather than tracking one id.
     */

    /** Dictionaries registered into the Client locale service. */
    const zh = {
      'entry.label': '图像生成工作台',
      'page.title': '图像生成工作台',
      'page.subtitle': '经 Host 路由调用本机生图脚本，图片与元信息落到固定工作区。',
      'page.close': '返回对话',
      'theme.label': '主题',
      'theme.light': '亮',
      'theme.dark': '暗',
      'theme.system': '跟随系统',

      'palette.label': '配色方案',
      'palette.custom': '自定义配色',
      'palette.customCount': '已改 {n} 项',
      'palette.customHint': '清空某一项即可恢复该配色的原始值。',
      'palette.reset': '恢复默认',
      'zoom.label': '画布缩放',
      'zoom.in': '放大',
      'zoom.out': '缩小',
      'zoom.reset': '点击回到 100%',
      'batch.reasonMore': '展开完整原因',
      'batch.reasonLess': '收起完整原因',

      'form.channel': '渠道',
      'form.onlyChannel': '只用手选渠道',
      'form.onlyChannel.hint': '关闭后，手选渠道失败时会沿降级链继续尝试。',
      'form.onlyChannel.autoHint': '自动模式本身就沿降级链执行。',
      'form.modelPinned': '所选模型只属于该渠道，本次不会降级到其他渠道。',
      'form.model': '模型',
      'form.prompt': '提示词',
      'form.prompt.placeholder': '描述想生成的画面，例如：清晨薄雾中的湖面，极简构图，柔和光线',
      'form.prompt.tooLong': '提示词 {length} 字符，超过 {scope} 的上限 {limit}，已禁用生成。',
      'form.prompt.modelLimit': '该模型上限 {limit} 字符（渠道内其他模型可能更宽）。',
      'batch.clearFailed': '清理失败：',
      'form.ratio': '比例',
      'form.resolution': '分辨率档位',
      'form.generate': '生成',
      'form.cancel': '取消',

      'badge.free': '免费',
      'badge.paid': '按 token 计费',
      'badge.imageInput': '支持参考图',
      'badge.unavailable': '缺少凭据',
      'badge.concurrency': '可并发 {n}',

      'assist.model': '润色/扩写使用的模型',
      'assist.modelProvider': '提供方',
      'assist.modelId': '模型 id',
      'assist.modelFollowDefault': '跟随本机默认',
      'assist.modelPlaceholder': '填模型 id',
      'assist.modelDefaultNone': '跟随本机默认（本机未配置）',
      'assist.modelNone': '当前没有可用的模型路由。',
      'assist.modelNow': '正在使用 {route}（{source}）',
      'assist.srcConfigured': '手动指定',
      'assist.srcDefault': '默认',
      'assist.modelHint': '留空即跟随默认（{route}）。只影响润色与扩写，不影响出图。',
      'assist.translate': '译成英文',
      'assist.polish': '润色',
      'assist.expand': '扩写',
      'assist.working': '处理中…',
      'assist.adopt': '采用',
      'assist.discard': '丢弃',
      'assist.label.translate': '译文',
      'assist.label.polish': '润色结果',
      'assist.label.expand': '扩写结果',
      'assist.unavailable': '本机未挂载翻译服务或模型，无法使用提示词助手。',
      'assist.polishOff': '润色与扩写不可用：',
      'assist.noModel': '本机没有可用的模型路由，润色与扩写已停用。',
      'assist.noTranslator': '本机未挂载翻译服务，翻译按钮应保持隐藏。',
      'assist.failed': '处理失败：',
      'assist.tooLong': '译文过长，请手动精简（上限 {limit} 字符）。原文已保留。',
      'form.reference': '参考图',
      'form.reference.hint': '最多 {max} 张，第一张为主图；也可从画廊或本地文件添加。',
      'form.reference.add': '添加参考图',
      'form.reference.fromGallery': '从画廊选取',
      'form.reference.fromFile': '上传本地图片',
      'form.reference.url': '或粘贴图片地址',
      'form.reference.remove': '移除',
      'form.reference.primary': '主图',
      'form.reference.empty': '未使用参考图（文字生成图片）',
      'form.reference.invalid': '只接受 https 图片地址或 data:image base64。',
      'form.reference.tooMany': '最多 {max} 张参考图。',
      'form.reference.pinned': '使用参考图时只跑该渠道的图生图接口，不会降级。',

      'warn.cjk': '{channel} 请用英文提示词：中日韩字符会被静默忽略并返回不相干的画面。本次仍会提交。',
      'warn.module': '未能读取生图脚本的能力清单，尺寸与模型列表可能不完整：',

      'seed.title': '随机种子',
      'seed.hint': '相同 seed + 相同参数通常能复现同一张图。',
      'seed.placeholder': '留空则随机',
      'seed.random': '随机一个',
      'seed.repro': '可复现',
      'seed.reproLikely': '通常可复现',
      'seed.reproUnknown': '存疑',
      'seed.reproNo': '不可复现',
      'seed.unsupported': '该模型不支持 seed',
      'result.stalled': '超过 90 秒没有任何进展，任务可能卡在等供应商响应。可以取消后重试。',
      'seed.batchHint': '批量时每张的 seed 依次 +1，保证每张不同。',

      'params.toggle': '展开高级参数',
      'params.collapse': '收起高级参数',
      'params.clear': '全部清空',

      'batch.title': '批量与队列',
      'batch.count': '本次生成张数',
      'batch.submit': '加入队列',
      'batch.pending': '{n} 张待提交',
      'batch.empty': '队列为空。',
      'batch.cancelAll': '全部取消',
      'batch.clearFinished': '清理已完成',
      'batch.running': '执行中',
      'batch.queued': '排队中 · 第 {n} 位',
      'batch.done': '完成',
      'batch.failed': '失败',
      'batch.cancelled': '已取消',
      'batch.lost': '已丢失',
      'batch.concurrency': '并发上限',
      'batch.concurrencyHint': '实际并发取「该值」与「渠道许可」的较小者。',
      'batch.permitList': '各渠道许可',

      'result.backend': '实际渠道',
      'result.size': '实际尺寸',
      'result.tokens': '本次 billed_tokens',
      'result.tokensCumulative': '本地累计 billed_tokens',
      'result.file': '文件',
      'result.seedUsed': '本次 seed',

      'gallery.refresh': '刷新',
      'gallery.empty': '工作区里还没有图片。',
      'gallery.loading': '读取中…',
      'gallery.error': '读取画廊失败',
      'gallery.selectAll': '全选',
      'gallery.clearSelection': '清除选择',
      'gallery.selected': '已选 {n} 张',
      'gallery.delete': '删除',
      'gallery.deleteOne': '删除这张',
      'gallery.deleteConfirm': '删除 {n} 张图片？会移到回收站，可撤销。',
      'gallery.download': '下载原图',
      'gallery.reuse': '用这张再生成',
      'gallery.asReference': '设为参考图',
      'gallery.savePreset': '存为预设',
      'gallery.prompt': '提示词',
      'gallery.noPrompt': '这张图生成时没有记录提示词。',
      'gallery.filterAll': '全部',
      'gallery.search': '按提示词搜索',

      'trash.empty': '回收站是空的。',
      'trash.restore': '恢复',
      'trash.restoreAll': '全部恢复',
      'trash.purge': '清空回收站',
      'trash.purgeConfirm': '永久删除回收站里的 {n} 项？此操作不可撤销。',
      'trash.deletedAt': '删除于',

      'library.saveCurrent': '把当前设置存为预设',
      'library.name': '预设名称',
      'library.namePlaceholder': '例如：柔光人像 · 3:4',
      'library.use': '套用',
      'library.delete': '删除',
      'library.deleteConfirm': '删除预设「{title}」？',
      'library.empty': '还没有自己的预设。',
      'library.builtin': '内置提示词库',
      'library.builtinPending': '框架已就位，资源尚未导入。',
      'library.needPrompt': '先在表单里填好提示词，再存为预设。',
      'library.saved': '已保存',
      'library.noImage': '无示例图',
      'library.stars': '★ {n}',
      'library.statusPending': '待导入',

      'tab.gallery': '画廊',
      'tab.library': '预设',
      'tab.trash': '回收站',

      'error.host': '请求未送达 Host，请重试。',
      'error.validation': '请求被校验拒绝：',
      'error.deleteFailed': '删除失败',
    }

    const en = {
      'entry.label': 'Image workbench',
      'page.title': 'Image workbench',
      'page.subtitle': 'Generation runs through the Host on the local image script; images and sidecars land in a fixed workspace.',
      'page.close': 'Back to conversation',
      'theme.label': 'Theme',
      'theme.light': 'Light',
      'theme.dark': 'Dark',
      'palette.label': 'Colour scheme',
      'palette.custom': 'Custom colours',
      'palette.customCount': '{n} changed',
      'palette.customHint': "Clear a role to fall back to the scheme's own value.",
      'palette.reset': 'Reset',
      'zoom.label': 'Canvas zoom',
      'zoom.in': 'Zoom in',
      'zoom.out': 'Zoom out',
      'zoom.reset': 'Click to return to 100%',
      'batch.reasonMore': 'Show full reason',
      'batch.reasonLess': 'Hide full reason',
      'theme.system': 'Follow system',

      'form.channel': 'Channel',
      'form.onlyChannel': 'Use only the selected channel',
      'form.onlyChannel.hint': 'When off, a failing channel falls through to the rest of the chain.',
      'form.onlyChannel.autoHint': 'Auto mode always runs the whole chain.',
      'form.modelPinned': 'This model belongs to this channel alone, so this run will not fall back.',
      'form.model': 'Model',
      'form.prompt': 'Prompt',
      'form.prompt.placeholder': 'Describe the image, for example: a misty lake at dawn, minimal composition, soft light',
      'form.prompt.tooLong': 'The prompt is {length} characters; {scope} accepts at most {limit}, so Generate is disabled.',
      'form.prompt.modelLimit': 'This model caps at {limit} characters (other models on the channel may allow more).',
      'batch.clearFailed': 'Could not clear:',
      'form.ratio': 'Aspect ratio',
      'form.resolution': 'Resolution tier',
      'form.generate': 'Generate',
      'form.cancel': 'Cancel',

      'badge.free': 'Free',
      'badge.paid': 'Billed in tokens',
      'badge.imageInput': 'Reference images',
      'badge.unavailable': 'Credential missing',
      'badge.concurrency': 'up to {n} at once',

      'assist.model': 'Model for polish and expand',
      'assist.modelProvider': 'Provider',
      'assist.modelId': 'Model id',
      'assist.modelFollowDefault': 'Follow the deployment default',
      'assist.modelPlaceholder': 'Type a model id',
      'assist.modelDefaultNone': 'Follow the deployment default (none configured)',
      'assist.modelNone': 'No model route is available right now.',
      'assist.modelNow': 'Using {route} ({source})',
      'assist.srcConfigured': 'set by hand',
      'assist.srcDefault': 'default',
      'assist.modelHint': 'Leave blank to follow the default ({route}). This affects polish and expand only, never image generation.',
      'assist.translate': 'Translate to English',
      'assist.polish': 'Polish',
      'assist.expand': 'Expand',
      'assist.working': 'Working…',
      'assist.adopt': 'Use this',
      'assist.discard': 'Discard',
      'assist.label.translate': 'Translation',
      'assist.label.polish': 'Polished',
      'assist.label.expand': 'Expanded',
      'assist.unavailable': 'This deployment mounts neither a translator nor a model, so the prompt assistants are unavailable.',
      'assist.polishOff': 'Polish and expand are unavailable:',
      'assist.noModel': 'No model route is available here, so polish and expand are disabled.',
      'assist.noTranslator': 'This deployment mounts no translator, so the translate button stays hidden.',
      'assist.failed': 'The assistant failed:',
      'assist.tooLong': 'The result would be too long; trim the prompt yourself (limit {limit} characters). Your original text is unchanged.',
      'form.reference': 'Reference images',
      'form.reference.hint': 'Up to {max}; the first is the primary. Pick from the gallery or a local file.',
      'form.reference.add': 'Add a reference image',
      'form.reference.fromGallery': 'Pick from the gallery',
      'form.reference.fromFile': 'Upload a local image',
      'form.reference.url': 'Or paste an image URL',
      'form.reference.remove': 'Remove',
      'form.reference.primary': 'Primary',
      'form.reference.empty': 'No reference image (text to image)',
      'form.reference.invalid': 'Only an https image URL or a data:image base64 value is accepted.',
      'form.reference.tooMany': 'At most {max} reference images.',
      'form.reference.pinned': 'With a reference image the run uses that channel\'s edit endpoint and does not fall back.',

      'warn.cjk': '{channel} needs an English prompt: CJK text is silently ignored and returns an unrelated image. This request is still submitted.',
      'warn.module': 'The image script did not report its capabilities; sizes and models may be incomplete:',

      'seed.title': 'Seed',
      'seed.hint': 'The same seed and settings usually reproduce the same image.',
      'seed.placeholder': 'Empty picks one at random',
      'seed.random': 'Randomize',
      'seed.repro': 'Reproducible',
      'seed.reproLikely': 'Usually reproducible',
      'seed.reproUnknown': 'Unverified',
      'seed.reproNo': 'Not reproducible',
      'seed.unsupported': 'This model accepts no seed',
      'result.stalled': 'No progress for over 90 seconds; the task may be stuck waiting on a provider. Cancel and retry.',
      'seed.batchHint': 'In a batch each seed steps by 1 so every image differs.',

      'params.toggle': 'Show advanced parameters',
      'params.collapse': 'Hide advanced parameters',
      'params.clear': 'Clear all',

      'batch.title': 'Batch and queue',
      'batch.count': 'Images this run',
      'batch.submit': 'Add to queue',
      'batch.pending': '{n} to submit',
      'batch.empty': 'The queue is empty.',
      'batch.cancelAll': 'Cancel all',
      'batch.clearFinished': 'Clear finished',
      'batch.running': 'Running',
      'batch.queued': 'Queued · position {n}',
      'batch.done': 'Done',
      'batch.failed': 'Failed',
      'batch.cancelled': 'Cancelled',
      'batch.lost': 'Lost',
      'batch.concurrency': 'Concurrency cap',
      'batch.concurrencyHint': 'The effective limit is the smaller of this and the channel permit.',
      'batch.permitList': 'Per-channel permits',

      'result.backend': 'Channel',
      'result.size': 'Output size',
      'result.tokens': 'Billed tokens (this run)',
      'result.tokensCumulative': 'Billed tokens (local total)',
      'result.file': 'File',
      'result.seedUsed': 'Seed used',

      'gallery.refresh': 'Refresh',
      'gallery.empty': 'The workspace has no images yet.',
      'gallery.loading': 'Loading…',
      'gallery.error': 'Could not read the gallery',
      'gallery.selectAll': 'Select all',
      'gallery.clearSelection': 'Clear selection',
      'gallery.selected': '{n} selected',
      'gallery.delete': 'Delete',
      'gallery.deleteOne': 'Delete this image',
      'gallery.deleteConfirm': 'Delete {n} image(s)? They move to the trash and can be restored.',
      'gallery.download': 'Download original',
      'gallery.reuse': 'Generate again from this',
      'gallery.asReference': 'Use as reference',
      'gallery.savePreset': 'Save as preset',
      'gallery.prompt': 'Prompt',
      'gallery.noPrompt': 'No prompt was recorded for this image.',
      'gallery.filterAll': 'All',
      'gallery.search': 'Search prompts',

      'trash.empty': 'The trash is empty.',
      'trash.restore': 'Restore',
      'trash.restoreAll': 'Restore all',
      'trash.purge': 'Empty the trash',
      'trash.purgeConfirm': 'Permanently delete {n} item(s)? This cannot be undone.',
      'trash.deletedAt': 'Deleted',

      'library.saveCurrent': 'Save the current settings as a preset',
      'library.name': 'Preset name',
      'library.namePlaceholder': 'e.g. Soft portrait · 3:4',
      'library.use': 'Apply',
      'library.delete': 'Delete',
      'library.deleteConfirm': 'Delete the preset "{title}"?',
      'library.empty': 'You have no presets yet.',
      'library.builtin': 'Built-in prompt library',
      'library.builtinPending': 'The framework is in place; the assets are not imported yet.',
      'library.needPrompt': 'Fill in a prompt first, then save it as a preset.',
      'library.saved': 'Saved',
      'library.noImage': 'No example image',
      'library.stars': '★ {n}',
      'library.statusPending': 'Pending import',

      'tab.gallery': 'Gallery',
      'tab.library': 'Presets',
      'tab.trash': 'Trash',

      'error.host': 'The request did not reach the Host. Try again.',
      'error.validation': 'The Host rejected the request: ',
      'error.deleteFailed': 'Delete failed',
    }

    /** Locale namespace shared with the Host's display metadata. */
    const NS = 'imageWorkbench'

    /** Sidebar row id; identical to the main panel key so the shell syncs both. */
    const PANEL_ID = 'image-workbench'

    /** Host API, document-relative because the GUI is served with `<base href="./">`. */
    const API = 'api/dsh-image-workbench'

    /** Theme preference storage key (local, so it survives without Host settings). */
    const THEME_KEY = 'dsh-image-workbench:theme'

    /** Selected palette id; a per-browser preference like the scheme above. */
    const PALETTE_KEY = 'dsh-image-workbench:palette'

    /** Per-user palette overrides, keyed by role name. */
    const PALETTE_CUSTOM_KEY = 'dsh-image-workbench:palette-custom'

    /** Canvas zoom, stored so a chosen scale survives a reload. */
    const ZOOM_KEY = 'dsh-image-workbench:zoom'

    /** Poll cadence while anything is queued or running. */
    const POLL_MS = 1200

    /**
     * Canvas zoom range and step.
     *
     * The three-column board keeps one fixed intrinsic width and is scaled as a
     * whole, the way an infinite canvas works. That is what stops a narrow
     * window from collapsing the columns into one tall strip: below the fitted
     * width the board shrinks instead of reflowing.
     */
    const MIN_ZOOM = 0.4
    const MAX_ZOOM = 2
    const ZOOM_STEP = 0.1

    /** Intrinsic board width in CSS pixels, before zoom. */
    const BOARD_WIDTH = 1440

    /** Silence after which a running job is reported as possibly stuck. */
    const STALL_MS = 90_000

    /** CJK ranges that make a Pollinations prompt unreliable. */
    const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef\uac00-\ud7af]/

    /** Stylesheet. Every value is an existing `--dsw-*` token; nothing is literal paint. */
    const STYLE_ID = 'dsh-image-workbench/styles'

    const CSS = `
.wbRoot {
  /* The palette is supplied inline by useTheme as --wb-* custom properties, so
     no scheme lives in this stylesheet. Every rule below reads only those roles,
     which is why adding a palette needs no CSS change. The fallbacks here are
     the warm light arm, used only if the inline bundle is somehow absent. */
  --wb-bg: #FBF7F1;
  --wb-surface: #FFFFFF;
  --wb-surface2: #F8F2E9;
  --wb-border: #EBE0D2;
  --wb-border-strong: #DCCEBC;
  --wb-text: #3A3129;
  --wb-text2: #6B5D4F;
  --wb-text3: #9C8C7A;
  --wb-accent: #C2603C;
  --wb-on-accent: #FFF9F5;
  --wb-danger: #B85450;
  --wb-warn: #B98A2E;
  --wb-ok: #5F8557;
  --wb-shadow: 0 1px 2px rgba(74,54,38,.05), 0 10px 28px -14px rgba(74,54,38,.16);
  /* The panel is a flex column; this root is the endless canvas surface and owns
     both scroll axes, so the board inside it can be panned at any zoom. */
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  overflow: auto;
  background: var(--wb-bg);
  color: var(--wb-text);
  font-size: 13px;
  line-height: 1.55;
}
.wbRoot[data-wb-scheme="dark"] {
  --wb-bg: #171310;
  --wb-surface: #1F1A15;
  --wb-surface2: #262019;
  --wb-border: #332A21;
  --wb-border-strong: #453A2C;
  --wb-text: #F3ECE2;
  --wb-text2: #B7A795;
  --wb-text3: #8B7B68;
  --wb-accent: #E0913F;
  --wb-on-accent: #1A1409;
  --wb-danger: #D9705F;
  --wb-warn: #D9A441;
  --wb-ok: #7FA86B;
  --wb-shadow: 0 1px 2px rgba(0,0,0,.45), 0 12px 30px -16px rgba(0,0,0,.75);
  color-scheme: dark;
}
/* The zoomable surface: fixed intrinsic width, scaled as a whole, so a narrow
   window shrinks the board instead of stacking the three columns. */
.wbCanvas { padding: 26px 30px 60px; min-width: 0; }
.wbBoard {
  width: var(--wb-board-width, 1440px);
  transform-origin: top left;
  transform: scale(var(--wb-zoom, 1));
}
/* A transform does not affect layout, so the scaled board's height has to be
   reserved explicitly or the scroll area keeps the unscaled size and leaves a
   gap (or clips) after a zoom change. --wb-board-height is measured from the
   board and written back by the component. */
.wbCanvas { min-height: calc(var(--wb-board-height, 0px) * var(--wb-zoom, 1) + 86px); }
.wbInner {
  padding-inline-start: max(0px, calc(var(--dsh-frame-leading-clearance, 0px) - 20px));
}
.wbHead { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.wbHeadTools { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wbPalette { display: inline-flex; gap: 5px; align-items: center; }
.wbSwatch {
  width: 22px; height: 22px; border-radius: 7px; border: 1px solid var(--wb-border-strong);
  padding: 0; cursor: pointer; box-shadow: var(--wb-shadow);
}
.wbSwatch[aria-pressed="true"] { outline: 2px solid var(--wb-accent); outline-offset: 2px; }
.wbZoom {
  display: inline-flex; align-items: center; border: 1px solid var(--wb-border); border-radius: 999px;
  background: var(--wb-surface2); overflow: hidden;
}
.wbZoomBtn, .wbZoomValue {
  font: inherit; color: var(--wb-text2); background: transparent; border: 0; cursor: pointer;
  padding: 3px 9px; font-size: 12px; line-height: 1.5;
}
.wbZoomBtn:disabled { opacity: .4; cursor: not-allowed; }
.wbZoomValue { font-variant-numeric: tabular-nums; font-weight: 600; border-inline: 1px solid var(--wb-border); }
/* Custom-palette editor: a compact grid of role → colour pairs. */
.wbCustom { display: flex; flex-direction: column; gap: 10px; }
.wbCustomGrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 8px; }
.wbCustomRow { display: flex; align-items: center; gap: 7px; }
.wbCustomInput {
  width: 26px; height: 24px; padding: 0; border: 1px solid var(--wb-border-strong);
  border-radius: 6px; background: none; cursor: pointer;
}
.wbCustomHex {
  font: inherit; font-size: 11px; font-family: var(--wb-mono, ui-monospace, monospace);
  color: var(--wb-text2); background: var(--wb-surface2); border: 1px solid var(--wb-border);
  border-radius: 5px; padding: 3px 6px; width: 100%; min-width: 0;
}
.wbHeadText { flex: 1 1 auto; min-width: 0; }
.wbTitle { margin: 0 0 4px; font-size: 19px; font-weight: 600; letter-spacing: .01em; }
.wbSubtitle { margin: 0; color: var(--wb-text2); font-size: 12.5px; }
.wbSeg { display: inline-flex; padding: 2px; border: 1px solid var(--wb-border); border-radius: 999px; background: var(--wb-surface2); }
.wbSegBtn, .wbChip, .wbBtn, .wbMini { font: inherit; color: inherit; cursor: pointer; }
.wbSegBtn { border: 0; background: transparent; padding: 3px 11px; border-radius: 999px; color: var(--wb-text2); font-size: 12px; }
.wbSegBtn[aria-pressed="true"] { background: var(--wb-surface); color: var(--wb-text); box-shadow: var(--wb-shadow); }
/* Three fixed columns, always. The old @media rule collapsed them into one tall
   strip on a narrow window, which is the vertical sprawl being removed here; the
   board now scales as a canvas instead, so this grid never reflows. */
.wbLayout { display: grid; grid-template-columns: 352px minmax(0, 1fr) 404px; gap: 16px; align-items: start; }
.wbCol { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.wbCard { background: var(--wb-surface); border: 1px solid var(--wb-border); border-radius: 12px; box-shadow: var(--wb-shadow); }
.wbCardHead { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--wb-border); }
.wbCardTitle { margin: 0; font-size: 13px; font-weight: 600; flex: 1 1 auto; min-width: 0; }
.wbCardHint { color: var(--wb-text3); font-size: 12px; }
.wbBody { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
.wbField { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.wbLabel { font-size: 12px; font-weight: 600; color: var(--wb-text2); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wbRow { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.wbSelect, .wbInput, .wbArea {
  font: inherit; color: var(--wb-text); background: var(--wb-surface);
  border: 1px solid var(--wb-border-strong); border-radius: 8px; padding: 7px 10px; width: 100%;
  box-sizing: border-box;
}
.wbSelect { appearance: none; padding-right: 26px;
  background-image: linear-gradient(45deg, transparent 50%, var(--wb-text3) 50%), linear-gradient(135deg, var(--wb-text3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 52%, calc(100% - 10px) 52%;
  background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; }
.wbArea { resize: vertical; min-height: 92px; line-height: 1.6; }
.wbInput:disabled, .wbSelect:disabled { opacity: .5; cursor: not-allowed; }
.wbSelect:focus-visible, .wbInput:focus-visible, .wbArea:focus-visible, .wbBtn:focus-visible, .wbChip:focus-visible, .wbMini:focus-visible, .wbSegBtn:focus-visible, .wbTab:focus-visible {
  outline: 2px solid var(--wb-accent); outline-offset: 1px;
}
.wbChips { display: flex; flex-wrap: wrap; gap: 6px; }
.wbChip {
  border: 1px solid var(--wb-border-strong); background: var(--wb-surface); border-radius: 999px;
  padding: 4px 12px; font-size: 12px; color: var(--wb-text2);
}
.wbChip[aria-pressed="true"] { border-color: var(--wb-accent); color: var(--wb-accent); background: var(--wb-surface2); font-weight: 600; }
.wbChip:disabled { opacity: .45; cursor: not-allowed; }
.wbBadges { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.wbBadge { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--wb-border-strong); color: var(--wb-text2); white-space: nowrap; }
.wbBadge[data-tone="paid"] { color: var(--wb-warn); border-color: var(--wb-warn); }
.wbBadge[data-tone="ok"] { color: var(--wb-ok); border-color: var(--wb-ok); }
.wbBadge[data-tone="warn"] { color: var(--wb-warn); border-color: var(--wb-warn); }
.wbBadge[data-tone="danger"] { color: var(--wb-danger); border-color: var(--wb-danger); }
.wbBadge[data-tone="muted"] { color: var(--wb-text3); }
.wbToggle { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--wb-text2); }
.wbToggle input { position: absolute; opacity: 0; pointer-events: none; }
.wbTrack { width: 32px; height: 18px; border-radius: 999px; background: var(--wb-surface2); border: 1px solid var(--wb-border-strong); position: relative; transition: background .15s ease, border-color .15s ease; flex: none; }
.wbTrack::after { content: ""; position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%; background: var(--wb-text3); transition: transform .15s ease, background .15s ease; }
.wbToggle input:checked + .wbTrack { background: var(--wb-accent); border-color: var(--wb-accent); }
.wbToggle input:checked + .wbTrack::after { transform: translateX(14px); background: var(--wb-on-accent); }
.wbToggle input:disabled + .wbTrack { opacity: .4; }
.wbToggle input:focus-visible + .wbTrack { outline: 2px solid var(--wb-accent); outline-offset: 2px; }
.wbNotice { display: flex; gap: 8px; padding: 8px 11px; border-radius: 8px; font-size: 12px; border: 1px solid var(--wb-border-strong); background: var(--wb-surface2); color: var(--wb-text2); }
.wbNotice[data-tone="warn"] { border-color: var(--wb-warn); color: var(--wb-warn); }
.wbNotice[data-tone="danger"] { border-color: var(--wb-danger); color: var(--wb-danger); }
.wbNotice[data-tone="muted"] { border-color: var(--wb-border); color: var(--wb-text3); }
.wbActions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.wbBtn {
  border: 1px solid var(--wb-accent); background: var(--wb-accent); color: var(--wb-on-accent);
  border-radius: 8px; padding: 8px 18px; font-size: 13px; font-weight: 600;
}
.wbBtn:disabled { opacity: .5; cursor: not-allowed; }
.wbBtn[data-variant="ghost"] { background: transparent; color: var(--wb-text2); border-color: var(--wb-border-strong); font-weight: 500; }
.wbBtn[data-variant="danger"] { background: transparent; color: var(--wb-danger); border-color: var(--wb-danger); font-weight: 500; }
.wbMini { border: 0; background: transparent; color: var(--wb-text3); padding: 2px 6px; border-radius: 6px; font-size: 12px; }
.wbMini:hover { background: var(--wb-surface2); color: var(--wb-text); }
.wbMini[data-tone="danger"]:hover { color: var(--wb-danger); }
.wbKv { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 12.5px; margin: 0; }
.wbKv dt { color: var(--wb-text3); white-space: nowrap; }
.wbKv dd { margin: 0; color: var(--wb-text); word-break: break-word; min-width: 0; }
.wbNum { font-variant-numeric: tabular-nums; }
.wbEmpty { color: var(--wb-text3); font-size: 12.5px; padding: 18px 0; text-align: center; }

/* ── tabs ─────────────────────────────────────────────────────────────── */
.wbTabs { display: flex; gap: 4px; padding: 4px; border-bottom: 1px solid var(--wb-border); background: var(--wb-surface); border-radius: 12px 12px 0 0; }
.wbTab { border: 0; background: transparent; color: var(--wb-text2); font: inherit; font-size: 12.5px; padding: 6px 13px; border-radius: 8px; cursor: pointer; }
.wbTab[aria-selected="true"] { background: var(--wb-surface2); color: var(--wb-text); font-weight: 600; }
.wbTabCount { color: var(--wb-text3); font-variant-numeric: tabular-nums; margin-inline-start: 5px; }

/* ── gallery ──────────────────────────────────────────────────────────── */
.wbToolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding: 12px 16px; border-bottom: 1px solid var(--wb-border); }
.wbToolbar .wbInput { width: auto; flex: 1 1 160px; min-width: 120px; }
.wbToolbar .wbSelect { width: auto; min-width: 120px; }
.wbGallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: 10px; padding: 16px; }
.wbTile { position: relative; border: 1px solid var(--wb-border); border-radius: 10px; overflow: hidden; background: var(--wb-surface2); }
.wbTile[data-selected="true"] { border-color: var(--wb-accent); box-shadow: 0 0 0 2px var(--wb-accent); }
.wbTileOpen { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.wbTileOpen img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.wbTileMeta { padding: 6px 8px; font-size: 10.5px; color: var(--wb-text2); display: flex; flex-direction: column; gap: 1px; }
.wbTileBar { display: flex; gap: 4px; padding: 4px 6px 6px; }
.wbCheck { position: absolute; top: 6px; left: 6px; width: 20px; height: 20px; border-radius: 6px; border: 1px solid var(--wb-border-strong); background: var(--wb-surface); cursor: pointer; display: grid; place-items: center; font-size: 12px; line-height: 1; color: transparent; }
.wbCheck[aria-pressed="true"] { background: var(--wb-accent); border-color: var(--wb-accent); color: var(--wb-on-accent); }

/* ── queue ────────────────────────────────────────────────────────────── */
.wbQueue { display: flex; flex-direction: column; gap: 8px; }
.wbQueueRow { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--wb-border); border-radius: 9px; background: var(--wb-surface); }
.wbQueueThumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: var(--wb-surface); flex: none; border: 1px solid var(--wb-border); }
.wbQueueMain { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wbQueueTitle { font-size: 12px; font-weight: 600; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.wbQueueSub { font-size: 11px; color: var(--wb-text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Failure reasons get their own wrapping block. The one-line ellipsis above is
   still right for a filename or a prompt preview, but it used to clip the
   provider's own error text — measured at 137-178 characters, of which roughly
   half was cut — hiding the very sentence that says what broke. */
.wbReason {
  margin-top: 6px; font-size: 11.6px; line-height: 1.6; color: var(--wb-text);
  word-break: break-word; white-space: normal;
}
.wbReason[data-tone="danger"] { font-weight: 500; }
.wbReasonRaw {
  margin-top: 7px; font-family: var(--wb-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10.4px; line-height: 1.5; color: var(--wb-text2);
  background: var(--wb-surface); border: 1px solid var(--wb-border);
  border-left: 2px solid var(--wb-danger); border-radius: 6px;
  padding: 7px 9px; word-break: break-all; white-space: pre-wrap; max-height: 132px; overflow: auto;
}
.wbReasonMore {
  margin-top: 6px; font: inherit; font-size: 10.8px; font-weight: 600; color: var(--wb-accent);
  background: none; border: 0; padding: 0; cursor: pointer;
}
.wbJobFail { border-color: var(--wb-danger); background: var(--wb-surface2); }
/* A failed row must read as failed at a glance: the dot alone was too quiet. */
.wbJobFail .wbQueueSub { color: var(--wb-danger); }
.wbDot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex: none; }
.wbDot[data-state="running"] { background: var(--wb-accent); }
.wbDot[data-state="queued"] { background: var(--wb-text3); }
.wbDot[data-state="done"] { background: var(--wb-ok); }
.wbDot[data-state="failed"], .wbDot[data-state="lost"] { background: var(--wb-danger); }
.wbDot[data-state="cancelled"] { background: var(--wb-warn); }

/* ── reference images ─────────────────────────────────────────────────── */
.wbRefs { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
.wbRef { position: relative; width: 68px; height: 68px; border-radius: 8px; overflow: hidden; border: 1px solid var(--wb-border-strong); background: var(--wb-surface2); }
.wbRef img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wbRefTag { position: absolute; left: 0; bottom: 0; right: 0; font-size: 9.5px; text-align: center; padding: 1px 0; background: rgba(0,0,0,.62); color: #FFFFFF; }
.wbRefRemove { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; line-height: 1; border-radius: 50%; border: 0; cursor: pointer; font: inherit; font-size: 11px; background: rgba(0,0,0,.62); color: #FFFFFF; }
.wbRefPick { display: grid; grid-template-columns: repeat(auto-fill, minmax(52px, 1fr)); gap: 6px; padding: 8px; border: 1px solid var(--wb-border); border-radius: 8px; background: var(--wb-surface2); max-height: 168px; overflow: auto; }
.wbRefPickItem { padding: 0; border: 1px solid var(--wb-border-strong); border-radius: 6px; overflow: hidden; background: var(--wb-surface); cursor: pointer; aspect-ratio: 1; }
.wbRefPickItem img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wbRefPickItem:hover { border-color: var(--wb-accent); }

/* ── prompt assistants ─────────────────────────────────────────────────── */
.wbAssist { border: 1px solid var(--wb-accent); border-radius: 10px; background: var(--wb-surface2); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.wbAssistHead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wbAssistLabel { font-size: 11.5px; font-weight: 600; color: var(--wb-accent); }
.wbAssistLen { margin-inline-start: auto; font-size: 11px; color: var(--wb-text3); font-variant-numeric: tabular-nums; }
/* The result is comparison material, so it reads as text rather than a field:
   selectable, wrapping, and never the same box the user typed into. */
.wbAssistText { font-size: 12.5px; line-height: 1.6; color: var(--wb-text); white-space: pre-wrap; word-break: break-word; max-height: 210px; overflow: auto; }
/* Korean and Chinese results need the same letter spacing the rest of the page
   uses; the mono fallback would otherwise fight the panel's typography. */
.wbAssist[data-operation="translate"] .wbAssistText { font-style: normal; }

/* A stalled row is an advisory, not an error: warn colour, no border. */
.wbStall { font-size: 11px; color: var(--wb-warn); line-height: 1.45; }

/* ── params ───────────────────────────────────────────────────────────── */
.wbParamGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; }
.wbParam { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.wbParamLabel { font-size: 11.5px; color: var(--wb-text2); font-weight: 600; }
.wbParamNote { font-size: 11px; color: var(--wb-text3); line-height: 1.45; }
/* Live prompt-length counter; it turns red only at the actual ceiling of the
   selected channel/model, so the number is never a decorative guess. */
.wbPromptCount { margin-inline-start: 8px; font-size: 11px; font-weight: 400; font-variant-numeric: tabular-nums; color: var(--wb-text3); }
.wbPromptCount[data-over="true"] { color: var(--wb-danger); font-weight: 600; }

/* ── presets ──────────────────────────────────────────────────────────── */
.wbPresets { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; padding: 16px; }
.wbPreset { border: 1px solid var(--wb-border); border-radius: 10px; overflow: hidden; background: var(--wb-surface2); display: flex; flex-direction: column; }
.wbPresetImg { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; background: var(--wb-surface); }
.wbPresetNoImg { width: 100%; aspect-ratio: 4/3; display: grid; place-items: center; background: var(--wb-surface); color: var(--wb-text3); font-size: 11px; }
.wbPresetBody { padding: 7px 9px; display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; }
.wbPresetName { font-size: 12px; font-weight: 600; }
.wbPresetText { font-size: 11px; color: var(--wb-text3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.wbPresetBar { display: flex; gap: 4px; padding: 0 7px 7px; }

/* ── trash ────────────────────────────────────────────────────────────── */
.wbTrashRow { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--wb-border); border-radius: 9px; background: var(--wb-surface2); }
.wbTrashThumb { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: var(--wb-surface); border: 1px solid var(--wb-border); flex: none; }

.wbLightbox { position: fixed; inset: 0; z-index: 40; background: var(--dsw-alias-bg-mask-3); display: flex; align-items: center; justify-content: center; padding: 32px; }
.wbLightboxCard { background: var(--wb-surface); border-radius: 12px; max-width: min(960px, 100%); max-height: 100%; overflow: auto; box-shadow: 0 24px 64px var(--dsw-alias-bg-mask-1); }
.wbLightboxCard img { display: block; max-width: 100%; max-height: 62vh; margin: 0 auto; }
.wbLightboxFoot { padding: 12px 16px; display: grid; gap: 10px; }

/* The artifact name is the one value that reads as a path. */
.wbFile { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
`

    /** Stable empty tier list, so the effect below does not re-run on identity. */
    const NO_TIERS = Object.freeze([])

    /**
     * Named palettes, each with a light and a dark arm.
     *
     * A palette is data, not CSS: every entry maps one semantic role onto a
     * concrete colour, and the stylesheet consumes only those roles. That is
     * what makes "several built-in schemes plus a user-made one" possible
     * without duplicating a stylesheet per scheme — switching a palette rewrites
     * the same fourteen custom properties.
     *
     * The roles are the ones the panel already used, so no rule changes when a
     * palette is swapped:
     *   bg/page surface/card, surface2/inset, border, text 1-3,
     *   accent, onAccent, ok, warn, danger, shadow.
     */
    const PALETTES = [
      {
        id: 'warm',
        label: { zh: '暖阳工作室', en: 'Warm studio' },
        note: { zh: '米白纸感 + 赤陶色', en: 'Cream paper with terracotta' },
        swatch: ['#FBF7F1', '#C2603C', '#3A3129'],
        light: {
          bg: '#FBF7F1', surface: '#FFFFFF', surface2: '#F8F2E9',
          border: '#EBE0D2', borderStrong: '#DCCEBC',
          text: '#3A3129', text2: '#6B5D4F', text3: '#9C8C7A',
          accent: '#C2603C', onAccent: '#FFF9F5',
          ok: '#5F8557', warn: '#B98A2E', danger: '#B85450',
          shadow: '0 1px 2px rgba(74,54,38,.05), 0 10px 28px -14px rgba(74,54,38,.16)',
        },
        dark: {
          bg: '#171310', surface: '#1F1A15', surface2: '#262019',
          border: '#332A21', borderStrong: '#453A2C',
          text: '#F3ECE2', text2: '#B7A795', text3: '#8B7B68',
          accent: '#E0913F', onAccent: '#1A1409',
          ok: '#7FA86B', warn: '#D9A441', danger: '#D9705F',
          shadow: '0 1px 2px rgba(0,0,0,.45), 0 12px 30px -16px rgba(0,0,0,.75)',
        },
      },
      {
        id: 'editorial',
        label: { zh: '商业杂志', en: 'Editorial' },
        note: { zh: '冷白纸底 + 铜金点缀', en: 'Cool white with bronze' },
        swatch: ['#F7F7F5', '#9A7233', '#16181C'],
        light: {
          bg: '#F7F7F5', surface: '#FFFFFF', surface2: '#FAFAF8',
          border: '#E4E3DE', borderStrong: '#CFCEC8',
          text: '#16181C', text2: '#55595F', text3: '#8A8F96',
          accent: '#9A7233', onAccent: '#FFFFFF',
          ok: '#3F7A52', warn: '#A9761E', danger: '#A63E36',
          shadow: '0 1px 1px rgba(20,22,26,.04), 0 8px 26px -20px rgba(20,22,26,.30)',
        },
        dark: {
          bg: '#121417', surface: '#191C20', surface2: '#1F2227',
          border: '#2B2F35', borderStrong: '#3A4048',
          text: '#EDEFF2', text2: '#A8AEB6', text3: '#7D848C',
          accent: '#C9A35E', onAccent: '#14161A',
          ok: '#6FA37E', warn: '#CFA45C', danger: '#CF7A6E',
          shadow: '0 1px 2px rgba(0,0,0,.4), 0 10px 28px -16px rgba(0,0,0,.7)',
        },
      },
      {
        id: 'blend',
        label: { zh: '陶土编辑', en: 'Clay editorial' },
        note: { zh: '暖纸底 + 陶土色 + 衬线骨架', en: 'Warm paper, clay accent' },
        swatch: ['#FAF6F0', '#A8663A', '#2E2620'],
        light: {
          bg: '#FAF6F0', surface: '#FFFFFF', surface2: '#FBF6EF',
          border: '#E8DDCE', borderStrong: '#D6C6B2',
          text: '#2E2620', text2: '#5F5346', text3: '#96867A',
          accent: '#A8663A', onAccent: '#FFFBF7',
          ok: '#5A7F52', warn: '#A8812E', danger: '#AC5548',
          shadow: '0 1px 1px rgba(58,42,28,.05), 0 9px 26px -16px rgba(58,42,28,.20)',
        },
        dark: {
          bg: '#151210', surface: '#1C1815', surface2: '#231E1A',
          border: '#2F2822', borderStrong: '#40362C',
          text: '#F1E9DF', text2: '#B4A492', text3: '#88796A',
          accent: '#C98455', onAccent: '#1A1310',
          ok: '#79A06B', warn: '#D0A044', danger: '#CC7361',
          shadow: '0 1px 2px rgba(0,0,0,.45), 0 11px 28px -16px rgba(0,0,0,.72)',
        },
      },
      {
        id: 'slate',
        label: { zh: '石板蓝', en: 'Slate blue' },
        note: { zh: '冷静中性 + 靛蓝强调', en: 'Neutral slate with indigo' },
        swatch: ['#F4F6F8', '#3F6EA8', '#1B222C'],
        light: {
          bg: '#F4F6F8', surface: '#FFFFFF', surface2: '#F8FAFB',
          border: '#E1E6EB', borderStrong: '#C9D2DA',
          text: '#1B222C', text2: '#54606E', text3: '#85909C',
          accent: '#3F6EA8', onAccent: '#FFFFFF',
          ok: '#3E7D5A', warn: '#A97C22', danger: '#B05048',
          shadow: '0 1px 1px rgba(24,34,46,.04), 0 9px 26px -18px rgba(24,34,46,.26)',
        },
        dark: {
          bg: '#0F141A', surface: '#161C24', surface2: '#1C242D',
          border: '#28323D', borderStrong: '#37434F',
          text: '#E9EEF4', text2: '#A3B0BD', text3: '#76828F',
          accent: '#6B9BD8', onAccent: '#0D1218',
          ok: '#6AA37F', warn: '#D1A24C', danger: '#D0786C',
          shadow: '0 1px 2px rgba(0,0,0,.42), 0 10px 28px -16px rgba(0,0,0,.72)',
        },
      },
      {
        id: 'sakura',
        label: { zh: '樱雾粉', en: 'Sakura mist' },
        note: { zh: '浅粉柔雾 + 玫瑰强调', en: 'Soft pink with rose' },
        swatch: ['#FBF5F6', '#B85C6E', '#33262A'],
        light: {
          bg: '#FBF5F6', surface: '#FFFFFF', surface2: '#FDF8F9',
          border: '#EFE0E3', borderStrong: '#DEC5CB',
          text: '#33262A', text2: '#6B555B', text3: '#9E8A90',
          accent: '#B85C6E', onAccent: '#FFF8F9',
          ok: '#5C8464', warn: '#B08A3C', danger: '#B44F52',
          shadow: '0 1px 1px rgba(64,38,44,.05), 0 9px 26px -16px rgba(64,38,44,.20)',
        },
        dark: {
          bg: '#161113', surface: '#1D171A', surface2: '#241C20',
          border: '#33262B', borderStrong: '#453339',
          text: '#F4EAEC', text2: '#BAA4A9', text3: '#8D787E',
          accent: '#DE8395', onAccent: '#1A1113',
          ok: '#7BA283', warn: '#D5A85C', danger: '#D4777A',
          shadow: '0 1px 2px rgba(0,0,0,.45), 0 11px 28px -16px rgba(0,0,0,.72)',
        },
      },
    ]

    /** The role names a palette must fill; used by the custom-colour editor. */
    const PALETTE_ROLES = [
      ['bg', '页面底色'], ['surface', '卡片底色'], ['surface2', '内嵌底色'],
      ['border', '边框'], ['text', '正文'], ['text2', '次要文字'], ['text3', '弱化文字'],
      ['accent', '强调色'], ['ok', '成功'], ['warn', '警告'], ['danger', '错误'],
    ]

    /**
     * Build a valid palette map, filling any role the caller left out.
     *
     * A custom palette arrives from storage, so it is untrusted: a hex check
     * rejects junk that would otherwise become an invalid CSS value, and a
     * missing role falls back to the base palette instead of rendering black.
     * @param base - palette to inherit missing roles from.
     * @param overrides - untrusted partial palette.
     * @returns a complete palette.
     */
    function mergePalette(base, overrides) {
      const next = { ...base }
      if (overrides !== null && typeof overrides === 'object') {
        for (const [key, value] of Object.entries(overrides)) {
          if (typeof value !== 'string') continue
          if (key === 'shadow') continue
          if (/^#[0-9a-fA-F]{3,8}$/.test(value.trim())) next[key] = value.trim()
        }
      }
      return next
    }

    /** Read the persisted theme preference, falling back to `system`. */
    function readTheme() {
      try {
        const stored = window.localStorage.getItem(THEME_KEY)
        return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
      } catch {
        return 'system'
      }
    }

    /** Persist one theme preference, ignoring storage denial. */
    function writeTheme(value) {
      try {
        window.localStorage.setItem(THEME_KEY, value)
      } catch {
        /* a denied storage write only loses the preference after reload */
      }
    }

    /** Read the selected palette id, defaulting to the first declared one. */
    function readPaletteId() {
      try {
        const stored = window.localStorage.getItem(PALETTE_KEY)
        return PALETTES.some(entry => entry.id === stored) ? stored : (PALETTES[0]?.id ?? 'warm')
      } catch {
        return PALETTES[0]?.id ?? 'warm'
      }
    }

    /** Persist the palette choice. */
    function writePaletteId(value) {
      try {
        window.localStorage.setItem(PALETTE_KEY, value)
      } catch {
        /* losing the choice only resets the look after a reload */
      }
    }

    /** Read the user's role overrides, or an empty map. */
    function readCustomPalette() {
      try {
        const raw = window.localStorage.getItem(PALETTE_CUSTOM_KEY)
        if (raw === null || raw === '') return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
      } catch {
        return {}
      }
    }

    /** Persist the role overrides. */
    function writeCustomPalette(value) {
      try {
        window.localStorage.setItem(PALETTE_CUSTOM_KEY, JSON.stringify(value ?? {}))
      } catch {
        /* a denied write keeps the edit for this session only */
      }
    }

    /** Read the stored canvas zoom, clamped to the supported range. */
    function readZoom() {
      try {
        const stored = Number(window.localStorage.getItem(ZOOM_KEY))
        if (!Number.isFinite(stored) || stored <= 0) return 1
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stored))
      } catch {
        return 1
      }
    }

    /** Persist the canvas zoom. */
    function writeZoom(value) {
      try {
        window.localStorage.setItem(ZOOM_KEY, String(value))
      } catch {
        /* zoom is a convenience, never a saved artifact */
      }
    }

    /** What the OS currently prefers, when `matchMedia` exists. */
    function systemPrefersDark() {
      return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches
    }

    /**
     * Resolve the light/dark scheme, live.
     *
     * The `system` preference follows `prefers-color-scheme` through a change
     * listener, so switching the OS theme repaints the panel without a reload.
     * An explicit light/dark choice is stored locally and wins over the OS.
     */
    function useTheme() {
      const [preference, setPreference] = useState(readTheme)
      const [systemDark, setSystemDark] = useState(systemPrefersDark)
      const [paletteId, setPaletteId] = useState(readPaletteId)
      const [custom, setCustom] = useState(readCustomPalette)
      const [zoom, setZoomState] = useState(readZoom)
      useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined
        const query = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = (event) => { setSystemDark(event.matches) }
        query.addEventListener('change', onChange)
        return () => { query.removeEventListener('change', onChange) }
      }, [])

      const scheme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
      const palette = PALETTES.find(entry => entry.id === paletteId) ?? PALETTES[0]
      // The chosen palette's own arm for this scheme, then the user's role
      // overrides on top. A custom colour therefore keeps the palette's intent
      // for every role it does not touch.
      const roleColors = useMemo(
        () => mergePalette(palette?.[scheme] ?? {}, custom),
        [palette, scheme, custom],
      )

      const choose = useCallback((next) => {
        setPreference(next)
        writeTheme(next)
      }, [])

      const choosePalette = useCallback((id) => {
        setPaletteId(id)
        writePaletteId(id)
      }, [])

      /** Set one role override, or clear it when the value is blank. */
      const setRole = useCallback((role, value) => {
        setCustom((current) => {
          const next = { ...current }
          const trimmed = typeof value === 'string' ? value.trim() : ''
          if (trimmed === '') delete next[role]
          else next[role] = trimmed
          writeCustomPalette(next)
          return next
        })
      }, [])

      /** Drop every override, returning to the palette exactly as declared. */
      const resetCustom = useCallback(() => {
        setCustom({})
        writeCustomPalette({})
      }, [])

      const setZoom = useCallback((next) => {
        const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100))
        setZoomState(clamped)
        writeZoom(clamped)
      }, [])

      return {
        scheme, preference, choose,
        paletteId, palette, choosePalette,
        custom, setRole, resetCustom, roleColors,
        zoom, setZoom,
      }
    }

    /**
     * Fetch one Host route and parse JSON.
     *
     * No client-side timeout: a generation can legitimately take minutes, and
     * the Host owns the run's deadline.
     */
    async function call(path, init) {
      const response = await fetch(`${API}/${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', ...(init && init.headers) },
      })
      let payload
      try {
        payload = await response.json()
      } catch {
        payload = undefined
      }
      return { status: response.status, ok: response.ok, payload }
    }

    /** Ratio x tier matrix of the current selection, or an empty list. */
    function presetsOf(capabilities, channelId, modelId) {
      if (capabilities === undefined) return []
      if (channelId === capabilities.auto.id) return capabilities.auto.presets
      const channel = capabilities.channels.find(entry => entry.id === channelId)
      if (channel === undefined) return []
      const model = channel.models.find(entry => entry.id === modelId) ?? channel.models[0]
      return model === undefined ? [] : model.presets
    }

    /** The model entry the form is currently pointed at. */
    function modelOf(capabilities, channelId, modelId) {
      if (capabilities === undefined) return undefined
      if (channelId === capabilities.auto.id) return undefined
      const channel = capabilities.channels.find(entry => entry.id === channelId)
      if (channel === undefined) return undefined
      return channel.models.find(entry => entry.id === modelId) ?? channel.models[0]
    }

    /** The first offered pair of a matrix. */
    function firstPair(presets) {
      for (const preset of presets) {
        if (preset.tiers.length > 0) return { ratio: preset.ratio, width: preset.tiers[0].width, height: preset.tiers[0].height }
      }
      return undefined
    }

    /** Keep a chosen pair when the new matrix still offers it, else fall back. */
    function keepPair(presets, ratio, pair) {
      const preset = presets.find(entry => entry.ratio === ratio)
      if (preset !== undefined && pair !== undefined && preset.tiers.some(tier => tier.width === pair.width && tier.height === pair.height)) {
        return { ratio, pair }
      }
      if (preset !== undefined && preset.tiers.length > 0) return { ratio, pair: { width: preset.tiers[0].width, height: preset.tiers[0].height } }
      return { ratio: presets[0]?.ratio, pair: firstPair(presets) }
    }

    /**
     * The prompt ceiling that applies to the current selection.
     *
     * The Host publishes it per channel and, where a family differs, per model
     * (Cloudflare's flux caps at 2048 while its SDXL siblings take 8000), so the
     * page never hardcodes a provider number. Auto mode runs the fallback chain,
     * whose head channel decides what is tried first — which is why its ceiling
     * comes from `capabilities.auto.prompt` rather than a fixed value.
     * @returns `{ limit, source, scope }` or undefined before capabilities load.
     */
    function promptLimitOf(capabilities, channelId, modelId) {
      if (capabilities === undefined) return undefined
      if (channelId === capabilities.auto.id) {
        return {
          limit: capabilities.auto.prompt?.limit ?? 4000,
          source: capabilities.auto.prompt?.source ?? null,
          scope: capabilities.auto.headLabel ?? capabilities.auto.label,
          modelScoped: capabilities.auto.prompt?.modelScoped === true,
        }
      }
      const channel = capabilities.channels.find(entry => entry.id === channelId)
      if (channel === undefined) return undefined
      const model = channel.models.find(entry => entry.id === modelId) ?? channel.models[0]
      const resolved = model?.prompt ?? channel.prompt
      return {
        limit: resolved?.limit ?? 4000,
        source: resolved?.source ?? null,
        scope: model?.label ?? channel.label,
        modelScoped: resolved?.modelScoped === true,
      }
    }

    /** Short label for one channel id, for filters and queue rows. */
    function channelLabel(capabilities, id) {
      if (id === null || id === undefined) return '—'
      const channel = capabilities?.channels?.find(entry => entry.id === id)
      return channel?.label ?? id
    }

    /** One channel option row, with the badges its declaration implies. */
    function ChannelBadges({ channel, t }) {
      if (channel === undefined) return null
      return h('span', { className: 'wbBadges' },
        h('span', { className: 'wbBadge', 'data-tone': channel.paid ? 'paid' : 'ok' },
          t(channel.paid ? 'badge.paid' : 'badge.free')),
        channel.imageInput === null ? null : h('span', { className: 'wbBadge' }, t('badge.imageInput')),
        h('span', { className: 'wbBadge' }, t('badge.concurrency', { n: channel.concurrency })),
        channel.available ? null : h('span', { className: 'wbBadge', 'data-tone': 'danger' }, t('badge.unavailable')))
    }

    /** A labelled field wrapper. `hintNode` takes a pre-built node, `hint` plain text. */
    function Field({ label, hint, hintNode, children }) {
      return h('div', { className: 'wbField' },
        h('div', { className: 'wbLabel' }, label,
          hintNode ?? (hint === undefined ? null : h('span', { className: 'wbCardHint', style: { fontWeight: 400 } }, hint))),
        children)
    }

    /** One status dot plus its label. */
    function StatusDot({ status }) {
      return h('span', { className: 'wbDot', 'data-state': status, 'aria-hidden': 'true' })
    }

    /** A toggle switch whose state is `aria-checked` on the input. */
    function Toggle({ checked, disabled, onChange, label }) {
      return h('label', { className: 'wbToggle' },
        h('input', {
          type: 'checkbox',
          checked: checked === true,
          disabled: disabled === true,
          onChange: (event) => { onChange(event.target.checked) },
        }),
        h('span', { className: 'wbTrack' }),
        h('span', null, label))
    }

    /** Render the value inputs of the advanced-parameter section. */
    function ParamField({ descriptor, value, locale, onChange }) {
      const label = descriptor.label?.[locale] ?? descriptor.label?.en ?? descriptor.key
      const note = descriptor.note?.[locale] ?? descriptor.note?.en ?? null
      const id = `wb-param-${descriptor.key}`
      let control
      if (descriptor.type === 'bool') {
        control = h(Toggle, {
          checked: value === true,
          label,
          onChange: (next) => { onChange(descriptor.key, next) },
        })
      } else if (descriptor.type === 'enum') {
        control = h('select', {
          id, className: 'wbSelect', value: value ?? '',
          onChange: (event) => { onChange(descriptor.key, event.target.value) },
        },
          h('option', { value: '' }, '—'),
          (descriptor.options ?? []).map(option => h('option', { key: option, value: option }, option)))
      } else if (descriptor.type === 'json') {
        control = h('textarea', {
          id, className: 'wbArea', style: { minHeight: '60px' },
          value: typeof value === 'string' ? value : (value === undefined || value === null ? '' : JSON.stringify(value)),
          placeholder: '{"repo-id": 1.0}',
          onChange: (event) => { onChange(descriptor.key, event.target.value) },
        })
      } else if (descriptor.type === 'text') {
        control = h('input', {
          id, className: 'wbInput', value: value ?? '',
          onChange: (event) => { onChange(descriptor.key, event.target.value) },
        })
      } else {
        control = h('input', {
          id, className: 'wbInput', type: 'number',
          min: descriptor.min ?? undefined,
          max: descriptor.max ?? undefined,
          step: descriptor.step ?? (descriptor.type === 'float' ? 0.5 : 1),
          value: value ?? '',
          placeholder: descriptor.default === null || descriptor.default === undefined ? '' : String(descriptor.default),
          onChange: (event) => { onChange(descriptor.key, event.target.value) },
        })
      }
      return h('div', { className: 'wbParam' },
        descriptor.type === 'bool'
          ? null
          : h('label', { className: 'wbParamLabel', htmlFor: id }, label),
        control,
        note === null ? null : h('div', { className: 'wbParamNote' }, note))
    }

    /** One gallery tile with its selection checkbox and actions. */
    function Tile({ entry, selected, onToggle, onOpen, onDelete, locale, t }) {
      return h('div', { className: 'wbTile', 'data-selected': selected ? 'true' : 'false' },
        h('button', {
          type: 'button', className: 'wbCheck',
          'aria-pressed': selected ? 'true' : 'false',
          'aria-label': t('gallery.selected', { n: 1 }),
          onClick: () => { onToggle(entry.file) },
        }, '✓'),
        h('button', {
          type: 'button', className: 'wbTileOpen',
          title: entry.prompt ?? entry.file,
          onClick: () => { onOpen(entry) },
        }, h('img', { src: entry.imageUrl, alt: entry.prompt ?? entry.file, loading: 'lazy' })),
        h('div', { className: 'wbTileMeta' },
          h('span', { className: 'wbNum' }, entry.size === null ? '—' : `${entry.size[0]}×${entry.size[1]}`),
          h('span', null, entry.backend ?? '—')),
        h('div', { className: 'wbTileBar' },
          h('button', {
            type: 'button', className: 'wbMini', 'data-tone': 'danger',
            title: t('gallery.deleteOne'), 'aria-label': t('gallery.deleteOne'),
            onClick: () => { onDelete(entry.file) },
          }, '🗑')))
    }

    /** The lightbox: one artifact in full, with its recorded prompt and actions. */
    function Lightbox({ t, locale, entry, capabilities, onClose, onDelete, onReuse, onAsReference, onSavePreset }) {
      if (entry === null) return null
      const facts = [
        [t('gallery.prompt'), entry.prompt ?? t('gallery.noPrompt')],
        [t('result.backend'), `${entry.backend ?? '—'} · ${entry.model ?? '—'}`],
        [t('result.size'), entry.size === null ? '—' : `${entry.size[0]}×${entry.size[1]}`],
      ]
      if (entry.seed !== null) facts.push([t('result.seedUsed'), String(entry.seed)])
      if (entry.billedTokens !== null) facts.push([t('result.tokens'), String(entry.billedTokens)])
      facts.push([t('result.file'), entry.file])

      const rows = []
      facts.forEach(([label, value], index) => {
        rows.push(h('dt', { key: `dt-${index}` }, label))
        rows.push(h('dd', {
          key: `dd-${index}`,
          className: index === facts.length - 1 ? 'wbFile' : 'wbNum',
        }, value))
      })

      const actions = [h('a', {
        key: 'download',
        className: 'wbBtn',
        href: entry.imageUrl,
        download: entry.file,
      }, t('gallery.download'))]
      if (entry.prompt !== null) {
        actions.push(h('button', {
          key: 'preset',
          type: 'button',
          className: 'wbBtn',
          'data-variant': 'ghost',
          onClick: () => { onSavePreset(entry) },
        }, t('gallery.savePreset')))
        actions.push(h('button', {
          key: 'reuse',
          type: 'button',
          className: 'wbBtn',
          'data-variant': 'ghost',
          onClick: () => { onReuse(entry) },
        }, t('gallery.reuse')))
        actions.push(h('button', {
          key: 'reference',
          type: 'button',
          className: 'wbBtn',
          'data-variant': 'ghost',
          onClick: () => { onAsReference(entry, capabilities) },
        }, t('gallery.asReference')))
      }
      actions.push(h('button', {
        key: 'delete',
        type: 'button',
        className: 'wbBtn',
        'data-variant': 'danger',
        onClick: () => { onDelete(entry.file) },
      }, t('gallery.delete')))
      actions.push(h('button', {
        key: 'close',
        type: 'button',
        className: 'wbBtn',
        'data-variant': 'ghost',
        onClick: onClose,
      }, t('page.close')))

      return h('div', {
        className: 'wbLightbox',
        role: 'dialog',
        'aria-modal': 'true',
        onClick: (event) => { if (event.target === event.currentTarget) onClose() },
      }, h('div', { className: 'wbLightboxCard' },
        h('img', { src: entry.imageUrl, alt: entry.prompt ?? entry.file }),
        h('div', { className: 'wbLightboxFoot' },
          h('dl', { className: 'wbKv' }, rows),
          h('div', { className: 'wbActions' }, actions))))
    }

    /** Build the workbench state and its actions; the page component renders it. */
    function useWorkbench(t, locale) {
      const [capabilities, setCapabilities] = useState(undefined)
      const [channelId, setChannelId] = useState('')
      const [modelId, setModelId] = useState('')
      const [onlyChannel, setOnlyChannel] = useState(false)
      const [prompt, setPrompt] = useState('')
      const [ratio, setRatio] = useState(undefined)
      const [pair, setPair] = useState(undefined)
      const [images, setImages] = useState([])
      const [imageError, setImageError] = useState(null)
      const [seedText, setSeedText] = useState('')
      const [params, setParams] = useState({})
      const [advancedOpen, setAdvancedOpen] = useState(false)
      const [batchCount, setBatchCount] = useState(1)
      const [jobs, setJobs] = useState([])
      const [queueMeta, setQueueMeta] = useState({ running: 0, queued: 0 })
      const [userConcurrency, setUserConcurrency] = useState(0)
      const [busyMessage, setBusyMessage] = useState(null)
      /** Id of the job whose raw provider error is expanded, or null. */
      const [openReason, setOpenReason] = useState(null)
      const [gallery, setGallery] = useState([])
      const [galleryState, setGalleryState] = useState('loading')
      const [selection, setSelection] = useState([])
      const [trash, setTrash] = useState([])
      const [presets, setPresets] = useState([])
      const [builtin, setBuiltin] = useState(null)
      const [tab, setTab] = useState('gallery')
      /** Assistant output: { operation, text, target? } or null. Shown beside the prompt. */
      const [assist, setAssist] = useState(null)
      /** Which assistant is running, so its own button shows the spinner. */
      const [assistBusy, setAssistBusy] = useState(null)
      const [assistError, setAssistError] = useState(null)
      /** The route the user is editing; blank means "use the deployment default". */
      const [assistDraft, setAssistDraft] = useState('')
      const [openEntry, setOpenEntry] = useState(null)
      const [filterChannel, setFilterChannel] = useState('')
      const [search, setSearch] = useState('')
      const [flash, setFlash] = useState(null)
      const pollRef = useRef(null)
      const lastDoneRef = useRef(0)

      const autoId = capabilities === undefined ? 'auto' : capabilities.auto.id
      const channel = capabilities === undefined
        ? undefined
        : (channelId === '' ? capabilities.channels[0] : capabilities.channels.find(entry => entry.id === channelId))
      const model = modelOf(capabilities, channelId, modelId)
      // The prompt ceiling follows the selection: a pinned MAI model, a
      // Cloudflare flux model and the fallback chain each resolve their own.
      // Declared here, above every callback that reads it, so the hooks below
      // never touch a binding that is still in its temporal dead zone.
      const promptLimit = promptLimitOf(capabilities, channelId, modelId)
      // Counted on the trimmed prompt, the same string the Host validates.
      const promptLength = prompt.trim().length
      const promptOver = promptLimit !== undefined && promptLength > promptLimit.limit
      const presetsMatrix = useMemo(
        () => presetsOf(capabilities, channelId, modelId),
        [capabilities, channelId, modelId],
      )
      const tiers = presetsMatrix.find(entry => entry.ratio === ratio)?.tiers ?? NO_TIERS

      /** One short-lived notice under the form. */
      const announce = useCallback((message, tone) => {
        setFlash({ message, tone: tone ?? 'muted', at: Date.now() })
      }, [])

      useEffect(() => {
        if (flash === null) return undefined
        const timer = window.setTimeout(() => { setFlash(null) }, 4000)
        return () => { window.clearTimeout(timer) }
      }, [flash])

      const reloadCapabilities = useCallback(async (force) => {
        try {
          const answer = await call(`capabilities${force ? '?refresh=1' : ''}`)
          if (answer.ok === true && answer.payload?.ok === true) {
            setCapabilities(answer.payload)
            setUserConcurrency(answer.payload.settings?.userConcurrency ?? 0)
            return answer.payload
          }
          setBusyMessage(t('error.host'))
        } catch {
          setBusyMessage(t('error.host'))
        }
        return undefined
      }, [t])

      const reloadGallery = useCallback(async () => {
        try {
          const answer = await call('gallery')
          if (answer.ok === true && answer.payload?.ok === true) {
            setGallery(answer.payload.entries)
            setGalleryState('ready')
            // A vanished file must not stay selected, or a delete would report
            // a refusal for something the user can no longer see.
            const present = new Set(answer.payload.entries.map(entry => entry.file))
            setSelection(current => current.filter(name => present.has(name)))
            return
          }
          setGalleryState('error')
        } catch {
          setGalleryState('error')
        }
      }, [])

      const reloadTrash = useCallback(async () => {
        try {
          const answer = await call('trash')
          if (answer.ok === true && answer.payload?.ok === true) setTrash(answer.payload.entries)
        } catch {
          /* the trash tab simply keeps its previous list */
        }
      }, [])

      const reloadLibrary = useCallback(async () => {
        try {
          const answer = await call('library')
          if (answer.ok === true && answer.payload?.ok === true) {
            setPresets(answer.payload.presets ?? [])
            setBuiltin(answer.payload.builtin ?? null)
          }
        } catch {
          /* an unreadable library leaves the user presets untouched */
        }
      }, [])

      const reloadJobs = useCallback(async () => {
        try {
          const answer = await call('jobs')
          if (answer.ok === true && answer.payload?.ok === true) {
            setJobs(answer.payload.jobs ?? [])
            setQueueMeta({ running: answer.payload.running ?? 0, queued: answer.payload.queued ?? 0 })
            // A newly finished job means a new artifact; refresh the gallery
            // exactly once per transition rather than on every tick.
            const done = (answer.payload.jobs ?? []).filter(job => job.status === 'done').length
            if (done > lastDoneRef.current) {
              lastDoneRef.current = done
              void reloadGallery()
            }
            return answer.payload
          }
        } catch {
          /* one dropped poll is not a failure; the next tick retries */
        }
        return undefined
      }, [reloadGallery])

      useEffect(() => { void reloadCapabilities(false) }, [reloadCapabilities])

      // Seed the route editor from the Host once. Without this a reload would
      // show "follow default" while the stored override is still in effect.
      useEffect(() => {
        const stored = capabilities?.settings?.assistModel
        if (typeof stored !== 'string') return
        // Only adopt the stored value when the editor is untouched, so a seed
        // that arrives after a user edit cannot overwrite what they typed.
        setAssistDraft(current => (current === '' ? stored : current))
      }, [capabilities])
      useEffect(() => { void reloadGallery() }, [reloadGallery])
      useEffect(() => { void reloadLibrary() }, [reloadLibrary])
      useEffect(() => { void reloadJobs() }, [reloadJobs])

      // Default the selection once capabilities arrive.
      useEffect(() => {
        if (capabilities === undefined) return
        setChannelId(current => current === '' ? capabilities.channels[0]?.id ?? capabilities.auto.id : current)
      }, [capabilities])

      // Keep ratio and pair valid for whatever matrix the selection produces.
      useEffect(() => {
        const next = keepPair(presetsMatrix, ratio, pair)
        if (next.ratio !== ratio) setRatio(next.ratio)
        if (pair === undefined || next.pair === undefined || next.pair.width !== pair.width || next.pair.height !== pair.height) {
          setPair(next.pair)
        }
      }, [presetsMatrix, ratio, pair])

      // Default the model to the channel's leading entry.
      useEffect(() => {
        if (channel === undefined) return
        const stillThere = channel.models.some(entry => entry.id === modelId)
        if (!stillThere) setModelId(channel.models[0]?.id ?? '')
      }, [channel, modelId])

      // A parameter the newly selected model does not accept must not be sent.
      useEffect(() => {
        if (model === undefined) {
          setParams({})
          return
        }
        const allowed = new Set(model.params.map(entry => entry.key))
        setParams(current => {
          const next = {}
          for (const [key, value] of Object.entries(current)) if (allowed.has(key)) next[key] = value
          return next
        })
      }, [model])

      // Poll only while something is pending; a settled queue costs nothing.
      useEffect(() => {
        const active = queueMeta.running + queueMeta.queued
        if (active === 0) return undefined
        const timer = window.setInterval(() => { void reloadJobs() }, POLL_MS)
        return () => { window.clearInterval(timer) }
      }, [queueMeta.running, queueMeta.queued, reloadJobs])

      useEffect(() => () => { if (pollRef.current !== null) window.clearTimeout(pollRef.current) }, [])

      const chooseChannel = useCallback((id) => {
        setChannelId(id)
        setModelId('')
        setParams({})
        setImages([])
        setSeedText('')
      }, [])

      // The channel's own declaration says how many references its edit
      // endpoint takes; a channel that declares none has no control at all.
      const imageRule = model?.imageInput ?? channel?.imageInput ?? null

      const addImage = useCallback((reference) => {
        if (imageRule === null) return
        const trimmed = typeof reference === 'string' ? reference.trim() : ''
        if (trimmed === '') return
        const valid = /^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed)
          || (() => { try { return new URL(trimmed).protocol === 'https:' } catch { return false } })()
        if (!valid) { setImageError(t('form.reference.invalid')); return }
        setImageError(null)
        setImages((current) => {
          if (current.length >= imageRule.maxImages) {
            setImageError(t('form.reference.tooMany', { max: imageRule.maxImages }))
            return current
          }
          return [...current, trimmed]
        })
      }, [imageRule, t])

      const removeImage = useCallback((index) => {
        setImageError(null)
        setImages((current) => current.filter((_, position) => position !== index))
      }, [])

      // Dropping to a channel without image input must not carry references
      // into a request that would silently ignore them.
      useEffect(() => {
        if (imageRule === null && images.length > 0) setImages([])
      }, [imageRule, images.length])

      /**
       * Run one prompt assistant.
       *
       * The result is held beside the prompt instead of replacing it: machine
       * translation and model rewriting both get things wrong sometimes, and a
       * replaced textarea leaves nothing to compare against. The user applies a
       * result deliberately.
       */
      const runAssist = useCallback(async (operation, targetLanguage) => {
        if (prompt.trim() === '') return
        setAssistBusy(operation)
        setAssistError(null)
        try {
          const body = { operation, text: prompt }
          if (operation === 'translate') body.targetLanguage = targetLanguage ?? 'en'
          const answer = await call('assist', { method: 'POST', body: JSON.stringify(body) })
          const payload = answer.payload
          if (answer.ok === true && payload?.ok === true) {
            setAssist({ operation, text: payload.text, target: targetLanguage ?? null, route: payload.route ?? null })
          } else if (payload?.code === 'text-too-long') {
            // Too long to process is not the same as too long to *show*: say it
            // and keep the original untouched.
            setAssistError(t('assist.tooLong', { limit: payload.limit ?? 4000 }))
          } else if (payload?.code === 'llm-unavailable' || payload?.code === 'model-unavailable') {
            setAssistError(t('assist.noModel'))
          } else if (payload?.code === 'translator-unavailable') {
            setAssistError(t('assist.noTranslator'))
          } else {
            setAssistError(`${t('assist.failed')} ${payload?.error ?? `HTTP ${answer.status}`}`)
          }
        } catch {
          setAssistError(t('error.host'))
        } finally {
          setAssistBusy(null)
        }
      }, [prompt, t])

      /** Store a model route override for the polish and expand calls. */
      const chooseAssistModel = useCallback(async (route) => {
        const trimmed = String(route ?? '').trim()
        setAssistDraft(trimmed)
        try {
          const answer = await call('settings', { method: 'POST', body: JSON.stringify({ assistModel: trimmed }) })
          if (answer.ok !== true) {
            setAssistError(`${t('assist.failed')} ${answer.payload?.error ?? answer.status}`)
            return
          }
          // Re-read capabilities so the buttons follow the new route's
          // availability instead of the old one's.
          await reloadCapabilities(false)
        } catch {
          setAssistError(t('error.host'))
        }
      }, [reloadCapabilities, t])

      /** Replace the prompt with an assistant result, discarding the old text. */
      const adoptAssist = useCallback(() => {
        if (assist === null) return
        setPrompt(assist.text)
        setAssist(null)
      }, [assist])

      /** Store one advanced-parameter value. */
      const setParam = useCallback((key, value) => {
        setParams(current => ({ ...current, [key]: value }))
      }, [])

      /** Store the user's own concurrency cap on the Host. */
      const chooseConcurrency = useCallback(async (value) => {
        setUserConcurrency(value)
        try {
          const answer = await call('settings', { method: 'POST', body: JSON.stringify({ userConcurrency: value }) })
          if (answer.ok !== true) setBusyMessage(t('error.host'))
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [t])

      /** Submit the current settings as a batch. */
      const submit = useCallback(async () => {
        if (pair === undefined || prompt.trim() === '') return
        // The Host enforces the same ceiling, but refusing here keeps an
        // over-long prompt from ever becoming a queued job that fails on arrival.
        if (promptOver === true) {
          setBusyMessage(t('form.prompt.tooLong', {
            length: promptLength,
            limit: promptLimit.limit,
            scope: promptLimit.scope ?? '',
          }))
          return
        }
        const parsedSeed = seedText.trim() === '' ? undefined : Number(seedText.trim())
        if (parsedSeed !== undefined && (!Number.isInteger(parsedSeed) || parsedSeed < 0)) {
          setBusyMessage(t('error.validation') + 'seed')
          return
        }
        const count = Math.max(1, Math.min(batchCount, 12))
        const base = {
          channelId: channelId === '' ? autoId : channelId,
          onlyChannel: channelId === autoId ? false : onlyChannel,
          prompt,
          width: pair.width,
          height: pair.height,
        }
        if (channelId !== autoId && model !== undefined) base.model = model.id
        if (images.length > 0) base.images = images
        if (Object.keys(params).length > 0) base.params = params
        // A batch of variants needs distinct seeds, or a lock-seeded batch would
        // return the same image N times. Without a seed the provider already
        // varies, so the field stays absent.
        const batch = []
        for (let index = 0; index < count; index += 1) {
          const item = { ...base }
          if (parsedSeed !== undefined) item.seed = parsedSeed + index
          batch.push(item)
        }
        try {
          const answer = await call('generate', { method: 'POST', body: JSON.stringify({ batch }) })
          if (answer.ok !== true || answer.payload?.ok !== true) {
            const index = answer.payload?.index
            setBusyMessage(t('error.validation') + (answer.payload?.error ?? `HTTP ${answer.status}`))
            if (typeof index === 'number' && index > 0) {
              announce(`${t('batch.pending', { n: index })}`, 'warn')
            }
            return
          }
          setBusyMessage(null)
          await reloadJobs()
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [announce, autoId, batchCount, channelId, images, model, onlyChannel, pair, params, prompt, promptLength, promptLimit, promptOver, reloadJobs, seedText, t])

      /** Cancel one job or every active job. */
      const cancelJobs = useCallback(async (ids) => {
        const targets = ids ?? jobs.filter(job => job.status === 'running' || job.status === 'queued').map(job => job.id)
        if (targets.length === 0) return
        try {
          await call('cancel', { method: 'POST', body: JSON.stringify({ ids: targets }) })
          await reloadJobs()
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [jobs, reloadJobs, t])

      /**
       * Forget settled rows, on the Host and in the page.
       *
       * Filtering the local list alone is not enough: the queue lives on the
       * Host, so the next poll — or the next submission — returns the same
       * records and the rows come back. The Host therefore drops the records and
       * this only mirrors the answer. Artifacts are untouched; deleting files is
       * the gallery's job.
       */
      const clearFinished = useCallback(async () => {
        try {
          const answer = await call('jobs/clear-finished', { method: 'POST', body: '{}' })
          if (answer.ok !== true) {
            setBusyMessage(`${t('batch.clearFailed')} ${answer.payload?.error ?? answer.status}`)
            return
          }
          setJobs(current => current.filter(job => job.status === 'running' || job.status === 'queued'))
          setQueueMeta(current => ({ ...current }))
          // The persisted last-job record may have been dropped too, so a
          // remount must not re-adopt a row the user just cleared.
          lastDoneRef.current = 0
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [t])

      /** Toggle one gallery selection. */
      const toggleSelected = useCallback((name) => {
        setSelection(current => current.includes(name)
          ? current.filter(entry => entry !== name)
          : [...current, name])
      }, [])

      /** Move the selected (or one) artifact into the trash. */
      const deleteArtifacts = useCallback(async (names) => {
        const targets = names ?? selection
        if (targets.length === 0) return
        try {
          const answer = await call('delete', { method: 'POST', body: JSON.stringify({ names: targets }) })
          if (answer.ok !== true) {
            setBusyMessage(`${t('error.deleteFailed')}: ${answer.payload?.error ?? answer.status}`)
          }
          await reloadGallery()
          await reloadTrash()
          setSelection([])
          setOpenEntry(null)
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [reloadGallery, reloadTrash, selection, t])

      /** Move trash entries back into the gallery. */
      const restoreArtifacts = useCallback(async (ids) => {
        if (ids.length === 0) return
        try {
          await call('restore', { method: 'POST', body: JSON.stringify({ ids }) })
          await reloadTrash()
          await reloadGallery()
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [reloadGallery, reloadTrash, t])

      /** Permanently empty the trash, after the caller has confirmed. */
      const purgeTrash = useCallback(async () => {
        try {
          await call('purge-trash', { method: 'POST', body: '{}' })
          await reloadTrash()
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [reloadTrash, t])

      /** Save the current form as a preset. */
      const savePreset = useCallback(async (title, imageName) => {
        if (prompt.trim() === '') { announce(t('library.needPrompt'), 'warn'); return }
        try {
          const answer = await call('library', {
            method: 'POST',
            body: JSON.stringify({
              title: title ?? '',
              prompt,
              imageName: imageName ?? null,
              channelId: channelId === '' ? autoId : channelId,
              model: model?.id ?? null,
              width: pair?.width ?? null,
              height: pair?.height ?? null,
              seed: seedText.trim() === '' ? null : Number(seedText.trim()),
              params: Object.keys(params).length > 0 ? params : null,
            }),
          })
          if (answer.ok === true) {
            announce(t('library.saved'), 'muted')
            await reloadLibrary()
          } else {
            setBusyMessage(t('error.validation') + (answer.payload?.error ?? answer.status))
          }
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [announce, autoId, channelId, model, pair, params, prompt, reloadLibrary, seedText, t])

      /**
       * Save one gallery artifact as a preset.
       *
       * The recorded prompt and settings travel with the artifact, so this does
       * not read the form: saving a preset from an image you generated an hour
       * ago must capture *its* prompt, not whatever is in the box now.
       */
      const savePresetFromArtifact = useCallback(async (item, title) => {
        try {
          const answer = await call('library', {
            method: 'POST',
            body: JSON.stringify({
              title,
              prompt: item.prompt,
              imageName: item.file,
              channelId: item.channelId,
              model: item.model,
              width: Array.isArray(item.size) ? item.size[0] : null,
              height: Array.isArray(item.size) ? item.size[1] : null,
              seed: item.seed,
              params: item.params,
            }),
          })
          if (answer.ok === true) {
            announce(t('library.saved'), 'muted')
            await reloadLibrary()
          } else {
            setBusyMessage(t('error.validation') + (answer.payload?.error ?? answer.status))
          }
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [announce, reloadLibrary, t])

      /** Apply one preset back into the form. */
      const applyPreset = useCallback((preset) => {
        if (typeof preset.channelId === 'string' && preset.channelId !== '') {
          setChannelId(preset.channelId === autoId ? autoId : preset.channelId)
        }
        if (typeof preset.model === 'string') setModelId(preset.model)
        if (typeof preset.prompt === 'string') setPrompt(preset.prompt)
        if (Number.isInteger(preset.width) && Number.isInteger(preset.height)) {
          setPair({ width: preset.width, height: preset.height })
        }
        if (Number.isInteger(preset.seed)) setSeedText(String(preset.seed))
        if (preset.params !== null && typeof preset.params === 'object') {
          const next = {}
          for (const [key, value] of Object.entries(preset.params)) next[key] = value
          setParams(next)
        }
      }, [autoId])

      /** Remove one user preset. */
      const deletePreset = useCallback(async (id) => {
        try {
          await call('library/delete', { method: 'POST', body: JSON.stringify({ id }) })
          await reloadLibrary()
        } catch {
          setBusyMessage(t('error.host'))
        }
      }, [reloadLibrary, t])

      /** Refill the form from a gallery artifact's recorded prompt. */
      const reuseEntry = useCallback((entry) => {
        if (entry.prompt === null) return
        setPrompt(entry.prompt)
        if (typeof entry.channelId === 'string' && entry.channelId !== '') {
          setChannelId(entry.channelId === autoId ? autoId : entry.channelId)
        }
        if (typeof entry.model === 'string') setModelId(entry.model)
        if (Number.isInteger(entry.seed)) setSeedText(String(entry.seed))
        if (entry.params !== null && typeof entry.params === 'object') {
          const next = {}
          for (const [key, value] of Object.entries(entry.params)) next[key] = value
          setParams(next)
        }
        setOpenEntry(null)
      }, [autoId])

      /**
       * Send a gallery artifact to the form as a reference image.
       *
       * Only a channel whose declaration takes references can accept one, so
       * the click moves the selection there instead of silently doing nothing.
       */
      const useAsReference = useCallback(async (entry, caps) => {
        const capable = caps?.channels?.find(item => item.imageInput !== null && item.available === true)
        if (capable === undefined) return
        setChannelId(capable.id)
        setModelId(capable.models[0]?.id ?? '')
        try {
          const response = await fetch(entry.imageUrl)
          const blob = await response.blob()
          const reader = new window.FileReader()
          reader.onload = () => {
            if (typeof reader.result === 'string') addImage(reader.result)
          }
          reader.readAsDataURL(blob)
        } catch {
          /* an unreadable artifact adds nothing; the field reports invalid input */
        }
        setOpenEntry(null)
      }, [addImage])

      const cumulative = useMemo(
        () => gallery.reduce((total, entry) => total + (typeof entry.billedTokens === 'number' ? entry.billedTokens : 0), 0),
        [gallery],
      )

      const filteredGallery = useMemo(() => {
        const query = search.trim().toLowerCase()
        return gallery.filter((entry) => {
          if (filterChannel !== '' && entry.backend !== filterChannel) return false
          if (query !== '' && !(entry.prompt ?? '').toLowerCase().includes(query)) return false
          return true
        })
      }, [filterChannel, gallery, search])

      const activeJobs = jobs.filter(job => job.status === 'running' || job.status === 'queued')
      const idle = activeJobs.length === 0

      return {
        locale, t,
        capabilities, reloadCapabilities,
        channelId, setChannelId: chooseChannel, channel, modelId, setModelId, model,
        onlyChannel, setOnlyChannel,
        prompt, setPrompt, promptLimit, promptLength, promptOver,
        ratio, setRatio, pair, setPair, presets: presetsMatrix, tiers,
        seedText, setSeedText, params, setParam, advancedOpen, setAdvancedOpen, clearParams: () => { setParams({}) },
        images, imageError, imageRule, addImage, removeImage,
        batchCount, setBatchCount, submit, busyMessage,
        jobs, activeJobs, idle, queueMeta, cancelJobs, clearFinished,
        openReason,
        toggleReason: useCallback((id) => { setOpenReason(current => (current === id ? null : id)) }, []),
        userConcurrency, chooseConcurrency,
        gallery: filteredGallery, galleryAll: gallery, galleryState, reloadGallery,
        selection, toggleSelected, setSelection, deleteArtifacts, cumulative,
        filterChannel, setFilterChannel, search, setSearch,
        trash, reloadTrash, restoreArtifacts, purgeTrash,
        presets2: presets, builtin, savePreset, savePresetFromArtifact, applyPreset, deletePreset, reloadLibrary,
        tab, setTab, openEntry, setOpenEntry, reuseEntry, useAsReference,
        assist, setAssist, assistBusy, assistError, runAssist, adoptAssist,
        assistDraft, setAssistDraft, chooseAssistModel,
        flash, announce,
      }
    }

    /** Page heading: title, subtitle, theme switch and the panel close button. */
    function PageHead({ t, scheme, preference, choose, closePanel, paletteId, choosePalette, zoomUi }) {
      const options = [['light', 'theme.light'], ['dark', 'theme.dark'], ['system', 'theme.system']]
      const zoomPct = Math.round((zoomUi?.zoom ?? 1) * 100)
      const zoomStep = (delta) => {
        if (zoomUi === undefined) return
        zoomUi.setZoom(zoomUi.zoom + delta)
      }
      return h('div', { className: 'wbHead' },
        h('div', { className: 'wbHeadText' },
          h('h1', { className: 'wbTitle' }, t('page.title')),
          h('p', { className: 'wbSubtitle' }, t('page.subtitle'))),
        h('div', { className: 'wbHeadTools' },
          // Palette swatches: one glance shows the available schemes, and the
          // active one is ringed rather than merely bolded.
          h('div', { className: 'wbPalette', role: 'group', 'aria-label': t('palette.label') },
            PALETTES.map(entry => h('button', {
              key: entry.id,
              type: 'button',
              className: 'wbSwatch',
              'aria-pressed': paletteId === entry.id ? 'true' : 'false',
              title: `${entry.label.zh} · ${entry.note.zh}`,
              style: {
                background: `linear-gradient(135deg, ${entry.swatch[0]} 0 46%, ${entry.swatch[1]} 46% 74%, ${entry.swatch[2]} 74% 100%)`,
              },
              onClick: () => { choosePalette(entry.id) },
            }))),
          h('div', { className: 'wbSeg', role: 'group', 'aria-label': t('theme.label') },
            options.map(([value, key]) => h('button', {
              key: value,
              type: 'button',
              className: 'wbSegBtn',
              'aria-pressed': preference === value ? 'true' : 'false',
              onClick: () => { choose(value) },
            }, t(key)))),
          zoomUi === undefined
            ? null
            : h('div', { className: 'wbZoom', role: 'group', 'aria-label': t('zoom.label') },
              h('button', {
                type: 'button', className: 'wbZoomBtn',
                disabled: zoomUi.zoom <= zoomUi.min,
                onClick: () => { zoomStep(-zoomUi.step) },
                'aria-label': t('zoom.out'),
              }, '\u2212'),
              h('button', {
                type: 'button', className: 'wbZoomValue',
                title: t('zoom.reset'),
                onClick: () => { zoomUi.setZoom(1) },
              }, `${zoomPct}%`),
              h('button', {
                type: 'button', className: 'wbZoomBtn',
                disabled: zoomUi.zoom >= zoomUi.max,
                onClick: () => { zoomStep(zoomUi.step) },
                'aria-label': t('zoom.in'),
              }, '+')),
          h('button', {
            type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
            onClick: closePanel,
          }, t('page.close'))))
    }

    /**
     * The custom-colour editor.
     *
     * It edits role overrides on top of the active palette, not a whole palette,
     * so clearing a role restores the palette's own value instead of a default.
     * Colours are shown as swatch + hex side by side: the picker is convenient
     * for picking, the hex is what makes a value copyable and exact.
     */
    function CustomPalette({ t, custom, setRole, resetCustom, roleColors }) {
      const [open, setOpen] = useState(false)
      const touched = Object.keys(custom ?? {}).length
      return h('section', { className: 'wbCard' },
        h('div', { className: 'wbCardHead' },
          h('h2', { className: 'wbCardTitle' }, t('palette.custom')),
          touched > 0
            ? h('span', { className: 'wbCardHint' }, t('palette.customCount', { n: touched }))
            : null,
          h('button', {
            type: 'button', className: 'wbMini',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => { setOpen(current => !current) },
          }, open ? t('params.collapse') : t('params.toggle'))),
        open
          ? h('div', { className: 'wbBody' },
            h('div', { className: 'wbCustom' },
              h('div', { className: 'wbCustomGrid' },
                PALETTE_ROLES.map(([role, label]) => h('div', { key: role, className: 'wbCustomRow' },
                  h('input', {
                    type: 'color',
                    className: 'wbCustomInput',
                    'aria-label': label,
                    value: /^#[0-9a-fA-F]{6}$/.test(roleColors?.[role] ?? '') ? roleColors[role] : '#888888',
                    onChange: (event) => { setRole(role, event.target.value) },
                  }),
                  h('input', {
                    type: 'text',
                    className: 'wbCustomHex',
                    value: custom?.[role] ?? roleColors?.[role] ?? '',
                    placeholder: roleColors?.[role] ?? '',
                    'aria-label': `${label} (hex)`,
                    onChange: (event) => { setRole(role, event.target.value) },
                  }),
                  h('span', { className: 'wbCardHint', style: { whiteSpace: 'nowrap' } }, label)))),
              h('div', { className: 'wbRow' },
                h('button', {
                  type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
                  disabled: touched === 0,
                  onClick: resetCustom,
                }, t('palette.reset')),
                h('div', { className: 'wbCardHint' }, t('palette.customHint')))))
          : null)
    }

    /** Channel picker plus the channel's own badges and notes. */
    function ChannelCard({ t, locale, state }) {
      const { capabilities } = state
      if (capabilities === undefined) {
        return h('section', { className: 'wbCard' },
          h('div', { className: 'wbCardHead' }, h('h2', { className: 'wbCardTitle' }, t('form.channel'))),
          h('div', { className: 'wbBody' }, h('div', { className: 'wbEmpty' }, t('gallery.loading'))))
      }
      const channel = state.channel
      return h('section', { className: 'wbCard' },
        h('div', { className: 'wbCardHead' },
          h('h2', { className: 'wbCardTitle' }, t('form.channel')),
          h(ChannelBadges, { channel, t })),
        h('div', { className: 'wbBody' },
          capabilities.moduleOk === false
            ? h('div', { className: 'wbNotice', 'data-tone': 'danger' },
              t('warn.module'), ' ', capabilities.moduleError ?? '')
            : null,
          h(Field, { label: t('form.channel') },
            h('select', {
              className: 'wbSelect',
              value: state.channelId,
              onChange: (event) => { state.setChannelId(event.target.value) },
            },
              h('option', { value: capabilities.auto.id }, capabilities.auto.label),
              capabilities.channels.map(entry => h('option', {
                key: entry.id, value: entry.id,
                disabled: entry.available !== true,
              }, `${entry.label}${entry.available === true ? '' : ` · ${t('badge.unavailable')}`}`)))),
          channel === undefined ? null : h('div', { className: 'wbRow' },
            channel.notes === null ? null : h('span', { className: 'wbCardHint' }, channel.notes[locale] ?? channel.notes.en ?? '')),
          channel === undefined || state.channelId === capabilities.auto.id ? null : h(Field, { label: t('form.model') },
            h('select', {
              className: 'wbSelect',
              value: state.modelId,
              onChange: (event) => { state.setModelId(event.target.value) },
            }, channel.models.map(entry => h('option', { key: entry.id, value: entry.id }, entry.label)))),
          state.channelId === capabilities.auto.id
            ? h('div', { className: 'wbCardHint' }, t('form.onlyChannel.autoHint'))
            : h('div', null,
              h(Toggle, {
                checked: state.onlyChannel,
                onChange: state.setOnlyChannel,
                label: t('form.onlyChannel'),
              }),
              h('div', { className: 'wbCardHint', style: { marginTop: '4px' } }, t('form.onlyChannel.hint'))),
          state.model !== undefined && state.model.id !== channel?.defaultModel
            ? h('div', { className: 'wbNotice', 'data-tone': 'muted' }, t('form.modelPinned'))
            : null)
      )
    }

    /** Seed control plus the reproducibility contract for the selected model. */
    function SeedField({ t, locale, state }) {
      const model = state.model
      if (model === undefined) {
        // Auto mode runs the chain, so no single model carries the contract.
        const seed = state.capabilities?.auto?.seed ?? null
        return h(Field, { label: t('seed.title') },
          h('input', {
            className: 'wbInput', value: state.seedText, inputMode: 'numeric',
            placeholder: t('seed.placeholder'),
            onChange: (event) => { state.setSeedText(event.target.value) },
          }),
          seed?.note === null || seed?.note === undefined
            ? null
            : h('div', { className: 'wbParamNote' }, seed.note[locale] ?? seed.note.en ?? ''))
      }
      const seed = model.seed ?? { supported: false, reproducible: 'no' }
      const tone = seed.reproducible === 'yes' || seed.reproducible === 'likely' ? 'ok'
        : seed.reproducible === 'unknown' ? 'warn' : 'muted'
      const label = seed.reproducible === 'yes' ? t('seed.repro')
        : seed.reproducible === 'likely' ? t('seed.reproLikely')
          : seed.reproducible === 'unknown' ? t('seed.reproUnknown')
            : t('seed.reproNo')
      return h(Field, { label: t('seed.title'), hint: t('seed.hint') },
        h('div', { className: 'wbRow' },
          h('input', {
            className: 'wbInput', style: { flex: '1 1 140px', width: 'auto' },
            value: seed.supported ? state.seedText : '',
            disabled: seed.supported !== true,
            inputMode: 'numeric',
            placeholder: seed.supported ? t('seed.placeholder') : t('seed.unsupported'),
            onChange: (event) => { state.setSeedText(event.target.value) },
          }),
          seed.supported
            ? h('button', {
              type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
              onClick: () => { state.setSeedText(String(Math.floor(Math.random() * 4294967295))) },
            }, t('seed.random'))
            : null,
          h('span', { className: 'wbBadge', 'data-tone': tone }, label)),
        seed.note === null || seed.note === undefined
          ? null
          : h('div', { className: 'wbParamNote' }, seed.note[locale] ?? seed.note.en ?? ''),
        seed.supported && state.batchCount > 1
          ? h('div', { className: 'wbParamNote' }, t('seed.batchHint'))
          : null)
    }

    /** Advanced parameters, rendered only for what the model actually accepts. */
    function AdvancedParams({ t, locale, state }) {
      const model = state.model
      const descriptors = model?.params ?? []
      if (state.channelId === state.capabilities?.auto?.id) return null
      if (descriptors.length === 0) return null
      return h('div', { className: 'wbField' },
        h('div', { className: 'wbRow' },
          h('button', {
            type: 'button', className: 'wbMini',
            'aria-expanded': state.advancedOpen ? 'true' : 'false',
            onClick: () => { state.setAdvancedOpen(!state.advancedOpen) },
          }, state.advancedOpen ? t('params.collapse') : t('params.toggle')),
          Object.keys(state.params).length === 0
            ? null
            : h('button', {
              type: 'button', className: 'wbMini',
              onClick: () => { state.clearParams() },
            }, t('params.clear'))),
        state.advancedOpen
          ? h('div', { className: 'wbParamGrid' },
            descriptors.map(descriptor => h(ParamField, {
              key: descriptor.key,
              descriptor,
              locale,
              // An untouched control must show the value the request will
              // actually carry. For a bool that is the module's own default
              // (prompt_extend starts True), so falling back to the descriptor
              // default is what keeps the switch honest instead of merely
              // looking "off".
              value: state.params[descriptor.key] === undefined
                ? descriptor.default
                : state.params[descriptor.key],
              onChange: state.setParam,
            })))
          : null)
    }

    /**
     * Reference-image control. Rendered only for a model whose declaration says
     * it accepts one, so the form never offers an input the run would drop.
     */
    function ReferenceField({ t, state, gallery, locale }) {
      const rule = state.imageRule
      if (rule === null) return null
      const [draft, setDraft] = useState('')
      const [picking, setPicking] = useState(false)
      const fileRef = useRef(null)

      const commit = () => {
        state.addImage(draft)
        setDraft('')
      }
      // A gallery artifact is served from this Host's own route, which the
      // provider cannot reach; the edit endpoint accepts an inline data URL, so
      // the pick is read here and sent inline instead of as an unreachable link.
      const pickFromGallery = async (entry) => {
        setPicking(false)
        try {
          const response = await fetch(entry.imageUrl)
          if (response.ok !== true) throw new Error(String(response.status))
          const blob = await response.blob()
          const reader = new window.FileReader()
          reader.onload = () => { if (typeof reader.result === 'string') state.addImage(reader.result) }
          reader.readAsDataURL(blob)
        } catch {
          // An unreadable artifact adds nothing; the field's own notice covers
          // an invalid value, so no separate message is invented here.
        }
      }
      const onFile = (event) => {
        const file = event.target.files?.[0]
        if (file === undefined) return
        if (!file.type.startsWith('image/')) { setDraft(''); return }
        const reader = new window.FileReader()
        reader.onload = () => { if (typeof reader.result === 'string') state.addImage(reader.result) }
        // FileReader yields `data:<mime>;base64,...`, exactly what the edit
        // endpoint accepts, so no upload endpoint is needed.
        reader.readAsDataURL(file)
        event.target.value = ''
      }
      const thumbs = state.images.map((reference, index) => h('li', {
        key: `${index}-${reference.slice(0, 32)}`,
        className: 'wbRef',
      },
        h('img', { src: reference, alt: '' }),
        index === 0 ? h('span', { className: 'wbRefTag' }, t('form.reference.primary')) : null,
        h('button', {
          type: 'button', className: 'wbRefRemove',
          title: t('form.reference.remove'), 'aria-label': t('form.reference.remove'),
          onClick: () => { state.removeImage(index) },
        }, '×')))

      return h(Field, {
        label: t('form.reference'),
        hint: t('form.reference.hint', { max: rule.maxImages }),
      },
      h('div', { className: 'wbField' },
        state.images.length === 0
          ? h('div', { className: 'wbCardHint' }, t('form.reference.empty'))
          : h('ul', { className: 'wbRefs' }, thumbs),
        // The edit endpoint exists on one backend only, so a reference image
        // pins the run to that channel. Say it before the click, not after.
        state.images.length === 0
          ? null
          : h('div', { className: 'wbCardHint' }, t('form.reference.pinned')),
        h('div', { className: 'wbRow' },
          h('input', {
            className: 'wbInput',
            value: draft,
            placeholder: t('form.reference.url'),
            'aria-label': t('form.reference.url'),
            onChange: (event) => { setDraft(event.target.value) },
            onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } },
          }),
          h('button', {
            type: 'button', className: 'wbMini',
            disabled: state.images.length >= rule.maxImages,
            onClick: commit,
          }, t('form.reference.add')),
          h('button', {
            type: 'button', className: 'wbMini',
            disabled: state.images.length >= rule.maxImages,
            onClick: () => { fileRef.current?.click() },
          }, t('form.reference.fromFile')),
          h('button', {
            type: 'button', className: 'wbMini',
            'aria-expanded': picking ? 'true' : 'false',
            disabled: state.images.length >= rule.maxImages || gallery.length === 0,
            onClick: () => { setPicking(value => !value) },
          }, t('form.reference.fromGallery'))),
        h('input', {
          ref: fileRef,
          type: 'file',
          accept: 'image/*',
          style: { display: 'none' },
          'aria-hidden': 'true',
          tabIndex: -1,
          onChange: onFile,
        }),
        picking
          ? h('div', { className: 'wbRefPick' },
            gallery.slice(0, 24).map(entry => h('button', {
              key: entry.file,
              type: 'button',
              className: 'wbRefPickItem',
              title: entry.file,
              onClick: () => { void pickFromGallery(entry) },
            }, h('img', { src: entry.imageUrl, alt: '' }))))
          : null,
        state.imageError === null
          ? null
          : h('div', { className: 'wbNotice', 'data-tone': 'danger', role: 'status' }, state.imageError)))
    }

    /**
     * The prompt assistants: translate, polish, expand — plus the side-by-side
     * comparison panel.
     *
     * Each button appears only when the Host reports that operation as runnable,
     * so a deployment without a translator or without a model shows a working
     * form instead of three buttons that fail.
     */
    function AssistBar({ t, state }) {
      const assist = state.capabilities?.assist
      if (assist === undefined) return null
      const busy = state.assistBusy
      const disabled = state.prompt.trim() === '' || busy !== null
      const buttons = []
      if (assist.translator === true) {
        buttons.push(h('button', {
          key: 'translate',
          type: 'button',
          className: 'wbBtn',
          'data-variant': 'ghost',
          disabled,
          onClick: () => { void state.runAssist('translate', 'en') },
        }, busy === 'translate' ? t('assist.working') : t('assist.translate')))
      }
      if (assist.model === true) {
        buttons.push(h('button', {
          key: 'polish',
          type: 'button',
          className: 'wbBtn',
          'data-variant': 'ghost',
          disabled,
          onClick: () => { void state.runAssist('polish') },
        }, busy === 'polish' ? t('assist.working') : t('assist.polish')))
        buttons.push(h('button', {
          key: 'expand',
          type: 'button',
          className: 'wbBtn',
          'data-variant': 'ghost',
          disabled,
          onClick: () => { void state.runAssist('expand') },
        }, busy === 'expand' ? t('assist.working') : t('assist.expand')))
      }

      // The route picker is worth showing whenever a model exists at all: it is
      // how a user moves polish/expand onto a cheaper or better model without
      // editing the profile by hand.
      //
      // It is a provider select plus a model text box, not two selects: provider
      // ids are enumerable (the llm service lists them) but model ids are not
      // cheap to enumerate, and inventing an empty second dropdown would be
      // worse than letting the user type the model the provider actually knows.
      const providers = Array.isArray(assist.providers) ? assist.providers : []
      const draftProvider = state.assistDraft.includes('/')
        ? state.assistDraft.slice(0, state.assistDraft.indexOf('/'))
        : ''
      const draftModel = state.assistDraft.includes('/')
        ? state.assistDraft.slice(state.assistDraft.indexOf('/') + 1)
        : ''
      const defaultLabel = assist.defaultRoute === null || assist.defaultRoute === undefined
        ? t('assist.modelDefaultNone')
        : `${assist.defaultRoute.provider}/${assist.defaultRoute.model}`
      const routeControl = providers.length > 0
        ? h('div', { className: 'wbField' },
          h('div', { className: 'wbLabel' }, t('assist.model')),
          h('div', { className: 'wbRow' },
            h('select', {
              className: 'wbSelect',
              style: { flex: '0 1 150px' },
              value: draftProvider,
              'aria-label': t('assist.modelProvider'),
              onChange: (event) => {
                const provider = event.target.value
                // Switching provider keeps the model box editable but clears a
                // model id that belonged to the previous provider.
                state.setAssistDraft(provider === '' ? '' : `${provider}/`)
              },
            },
              h('option', { value: '' }, t('assist.modelFollowDefault')),
              providers.map(provider => h('option', { key: provider, value: provider }, provider))),
            h('input', {
              className: 'wbInput',
              style: { flex: '1 1 200px' },
              value: draftModel,
              disabled: draftProvider === '',
              placeholder: assist.defaultRoute === null || assist.defaultRoute === undefined
                ? t('assist.modelPlaceholder')
                : assist.defaultRoute.model,
              'aria-label': t('assist.modelId'),
              onChange: (event) => {
                const model = event.target.value.trim()
                state.setAssistDraft(model === '' ? '' : `${draftProvider}/${model}`)
              },
            })),
          h('div', { className: 'wbParamNote' },
            assist.modelRoute === null || assist.modelRoute === undefined
              ? t('assist.modelNone')
              : t('assist.modelNow', {
                route: `${assist.modelRoute.provider}/${assist.modelRoute.model}`,
                source: t(assist.modelRouteSource === 'configured' ? 'assist.srcConfigured' : 'assist.srcDefault'),
              })),
          h('div', { className: 'wbParamNote' }, t('assist.modelHint', { route: defaultLabel })))
        : null

      if (buttons.length === 0 && routeControl === null) return null

      const result = state.assist
      return h('div', { className: 'wbField' },
        h('div', { className: 'wbRow' }, buttons),
        // The two unavailable cases are deployment facts worth naming once,
        // rather than a silent absence the user cannot explain.
        assist.translator !== true && assist.model !== true
          ? h('div', { className: 'wbParamNote' }, t('assist.unavailable'))
          : null,
        assist.model !== true && assist.modelError !== null && assist.modelError !== undefined
          ? h('div', { className: 'wbParamNote' }, `${t('assist.polishOff')} ${assist.modelError}`)
          : null,
        routeControl,
        state.assistError === null
          ? null
          : h('div', { className: 'wbNotice', 'data-tone': 'danger', role: 'status' }, state.assistError),
        result === null
          ? null
          : h('div', { className: 'wbAssist', 'data-operation': result.operation },
            h('div', { className: 'wbAssistHead' },
              h('span', { className: 'wbAssistLabel' }, t(`assist.label.${result.operation}`)),
              result.route === null || result.route === undefined
                ? null
                : h('span', { className: 'wbBadge' }, `${result.route.provider}/${result.route.model}`),
              h('span', { className: 'wbAssistLen' }, `${result.text.length}`)),
            // The original stays visible above the result: the user compares, and
            // nothing is overwritten until they choose to adopt it.
            h('div', { className: 'wbAssistText' }, result.text),
            h('div', { className: 'wbRow' },
              h('button', {
                type: 'button', className: 'wbBtn',
                onClick: () => { state.adoptAssist() },
              }, t('assist.adopt')),
              h('button', {
                type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
                onClick: () => { state.setAssist(null) },
              }, t('assist.discard')))))
    }

    /** Prompt, ratio chips, resolution chips, seed, params and the run controls. */
    function PromptCard({ t, locale, state, gallery }) {
      // The channel's declaration says whether non-Latin text is unreliable
      // instead of the form guessing from the channel id.
      const cjkWarning = state.channel?.promptScript === 'latin'
        && CJK.test(state.prompt)
      // Name the step parameter the selected family actually sends. Cloudflare's
      // flux family takes `steps` while its SDXL siblings take `num_steps`, so a
      // single channel-level label would be wrong for half the list.
      const stepDescriptor = state.model?.params?.find(entry => entry.key === 'steps') ?? null
      const stepHint = state.model === undefined || stepDescriptor === null
        ? null
        : `${stepDescriptor.param} \u00b7 ${stepDescriptor.min}\u2013${stepDescriptor.max}`

      const ratioChips = state.presets.map(preset => h('button', {
        key: preset.ratio,
        type: 'button',
        className: 'wbChip',
        'aria-pressed': state.ratio === preset.ratio ? 'true' : 'false',
        onClick: () => {
          state.setRatio(preset.ratio)
          const tier = preset.tiers[0]
          if (tier !== undefined) state.setPair({ width: tier.width, height: tier.height })
        },
      }, preset.ratio))
      const tierChips = state.tiers.map(tier => h('button', {
        key: `${tier.width}x${tier.height}`,
        type: 'button',
        className: 'wbChip',
        'aria-pressed': state.pair !== undefined && state.pair.width === tier.width && state.pair.height === tier.height ? 'true' : 'false',
        onClick: () => { state.setPair({ width: tier.width, height: tier.height }) },
      }, `${tier.width}×${tier.height}`))

      return h('section', { className: 'wbCard' },
        h('div', { className: 'wbCardHead' },
          h('h2', { className: 'wbCardTitle' }, t('form.prompt')),
          stepHint === null ? null : h('span', { className: 'wbCardHint' }, stepHint)),
        h('div', { className: 'wbBody' },
          h(Field, {
            label: t('form.prompt'),
            // The limit belongs to the current channel/model, so it is shown
            // beside the field instead of being a fixed number in the copy.
            hintNode: state.promptLimit === undefined
              ? undefined
              : h('span', {
                className: 'wbPromptCount',
                'data-over': state.promptOver ? 'true' : 'false',
              }, `${state.promptLength} / ${state.promptLimit.limit}`),
          },
            h('textarea', {
              className: 'wbArea',
              value: state.prompt,
              placeholder: t('form.prompt.placeholder'),
              onChange: (event) => { state.setPrompt(event.target.value) },
            })),
          state.promptOver
            ? h('div', { className: 'wbNotice', 'data-tone': 'danger', role: 'alert' },
              t('form.prompt.tooLong', {
                length: state.promptLength,
                limit: state.promptLimit.limit,
                scope: state.promptLimit.scope ?? '',
              }))
            : null,
          state.promptLimit !== undefined && state.promptLimit.modelScoped && state.promptOver !== true
            ? h('div', { className: 'wbParamNote' },
              t('form.prompt.modelLimit', { limit: state.promptLimit.limit }))
            : null,
          h(AssistBar, { t, state }),
          cjkWarning
            ? h('div', { className: 'wbNotice', 'data-tone': 'warn' },
              t('warn.cjk', { channel: state.channel?.label ?? '' }))
            : null,
          h(ReferenceField, { t, state, gallery, locale }),
          h(Field, { label: t('form.ratio') }, h('div', { className: 'wbChips' }, ratioChips)),
          h(Field, { label: t('form.resolution') }, h('div', { className: 'wbChips' }, tierChips)),
          // A measured model rule (the MAI 768 floor / 2,359,296 px budget) is
          // worth stating, because it explains why small tiers are absent.
          state.model?.sizeNote === undefined || state.model?.sizeNote === null
            ? null
            : h('div', { className: 'wbParamNote' }, locale === 'zh' ? state.model.sizeNote.zh : state.model.sizeNote.en),
          h(SeedField, { t, locale, state }),
          h(AdvancedParams, { t, locale, state }))
      )
    }

    /** Batch size, submit, and the live queue. */
    /**
     * The failure reason of one job.
     *
     * Always shows the whole message wrapped to the card, never clipped. The
     * provider's own payload is long and only sometimes useful, so it sits
     * behind a toggle: the first line is the human summary, the raw text stays
     * available because a support question often needs the exact sentence.
     */
    function JobReason({ t, reason, open, id, toggle }) {
      // The first clause is what a person reads; the rest is provider detail.
      const summary = reason.length > 160 ? `${reason.slice(0, 160).trimEnd()}…` : reason
      return h('div', null,
        h('div', { className: 'wbReason', 'data-tone': 'danger' }, summary),
        open
          ? h('div', { className: 'wbReasonRaw' }, reason)
          : null,
        h('button', {
          type: 'button', className: 'wbReasonMore',
          'aria-expanded': open ? 'true' : 'false',
          onClick: () => { toggle(id) },
        }, open ? t('batch.reasonLess') : t('batch.reasonMore')))
    }

    function QueueCard({ t, locale, state }) {
      // A run whose log has not moved for a while is very likely blocked in a
      // provider call. The poll re-renders while anything is active, so reading
      // the clock during render is enough to surface it; nothing schedules a
      // timer of its own.
      const now = Date.now()
      const rows = state.jobs.map(job => {
        const status = job.status
        const stalled = status === 'running' && now - job.updatedAt > STALL_MS
        const tone = status === 'done' ? 'ok'
          : status === 'failed' || status === 'lost' ? 'danger'
            : status === 'cancelled' ? 'warn' : 'muted'
        const label = status === 'running' ? t('batch.running')
          : status === 'queued' ? t('batch.queued', { n: job.queuePosition ?? 0 })
            : status === 'done' ? t('batch.done')
              : status === 'failed' ? t('batch.failed')
                : status === 'lost' ? t('batch.lost')
                  : t('batch.cancelled')
        const thumbnail = job.result?.imageUrl ?? null
        // A failed row owns its reason. The generic one-line strip is fine for a
        // filename or a prompt preview, but the provider's error text ran to
        // 137-178 characters and was clipped to roughly half of that, hiding the
        // sentence that actually explained the failure.
        const failed = status === 'failed' || status === 'lost'
        const reason = typeof job.error === 'string' ? job.error.trim() : ''
        return h('div', {
          key: job.id,
          className: failed ? 'wbQueueRow wbJobFail' : 'wbQueueRow',
        },
          thumbnail === null
            ? h('div', { className: 'wbQueueThumb', style: { display: 'grid', placeItems: 'center' } },
              h(StatusDot, { status }))
            : h('img', { className: 'wbQueueThumb', src: thumbnail, alt: '' }),
          h('div', { className: 'wbQueueMain' },
            h('div', { className: 'wbQueueTitle' },
              h(StatusDot, { status }),
              h('span', null, label),
              h('span', { className: 'wbBadge', 'data-tone': tone }, `${job.request.width}×${job.request.height}`),
              job.result?.backend === null || job.result?.backend === undefined
                ? null
                : h('span', { className: 'wbBadge' }, job.result.backend)),
            failed && reason !== ''
              // Full text, wrapping: this is the element that was truncated.
              ? h(JobReason, { t, reason, open: state.openReason === job.id, id: job.id, toggle: state.toggleReason })
              : h('div', { className: 'wbQueueSub' },
                job.result?.fileName ?? job.request.prompt),
            stalled
              ? h('div', { className: 'wbStall' }, t('result.stalled'))
              : null),
          status === 'running' || status === 'queued'
            ? h('button', {
              type: 'button', className: 'wbMini', 'data-tone': 'danger',
              onClick: () => { void state.cancelJobs([job.id]) },
            }, t('form.cancel'))
            : null)
      })

      return h('section', { className: 'wbCard' },
        h('div', { className: 'wbCardHead' },
          h('h2', { className: 'wbCardTitle' }, t('batch.title')),
          state.activeJobs.length === 0
            ? null
            : h('span', { className: 'wbCardHint' },
              `${state.queueMeta.running} · ${state.queueMeta.queued}`)),
        h('div', { className: 'wbBody' },
          h('div', { className: 'wbRow' },
            h('div', { style: { flex: '0 0 auto' } },
              h('div', { className: 'wbLabel' }, t('batch.count')),
              h('input', {
                className: 'wbInput', type: 'number', min: 1, max: 12,
                style: { width: '84px' },
                value: state.batchCount,
                onChange: (event) => {
                  const next = Number(event.target.value)
                  state.setBatchCount(Number.isFinite(next) ? Math.max(1, Math.min(12, Math.trunc(next))) : 1)
                },
              })),
            h('div', { style: { flex: '0 0 auto' } },
              h('div', { className: 'wbLabel' }, t('batch.concurrency')),
              h('select', {
                className: 'wbSelect',
                style: { width: '96px' },
                value: state.userConcurrency === 0 ? 3 : state.userConcurrency,
                onChange: (event) => { void state.chooseConcurrency(Number(event.target.value)) },
              },
                [1, 2, 3].map(value => h('option', { key: value, value }, String(value))))),
            h('div', { style: { flex: '1 1 auto' } },
              h('div', { className: 'wbLabel' }, t('batch.permitList')),
              h('div', { className: 'wbCardHint' },
                Object.entries(state.capabilities?.limits?.channelPermits ?? {})
                  .map(([id, permit]) => `${channelLabel(state.capabilities, id)} ${permit}`)
                  .join(' · ')))),
          h('div', { className: 'wbCardHint' }, t('batch.concurrencyHint')),
          h('div', { className: 'wbActions' },
            h('button', {
              type: 'button', className: 'wbBtn',
              // An over-long prompt is refused here rather than submitted and
              // rejected by the Host: the button says why it cannot run instead
              // of the user watching a request fail.
              disabled: state.pair === undefined || state.prompt.trim() === '' || state.promptOver === true,
              onClick: () => { void state.submit() },
            }, state.activeJobs.length === 0 ? t('form.generate') : t('batch.submit')),
            state.activeJobs.length === 0
              ? null
              : h('button', {
                type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
                onClick: () => { void state.cancelJobs() },
              }, t('batch.cancelAll')),
            state.jobs.some(job => job.status !== 'running' && job.status !== 'queued')
              ? h('button', {
                type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
                onClick: state.clearFinished,
              }, t('batch.clearFinished'))
              : null),
          state.busyMessage === null
            ? null
            : h('div', { className: 'wbNotice', 'data-tone': 'danger', role: 'status' }, state.busyMessage),
          state.flash === null
            ? null
            : h('div', { className: 'wbNotice', 'data-tone': state.flash.tone, role: 'status' }, state.flash.message),
          state.jobs.length === 0
            ? h('div', { className: 'wbEmpty' }, t('batch.empty'))
            : h('div', { className: 'wbQueue' }, rows))
      )
    }

    /** Gallery: filter, search, selection, delete, open. */
    function GalleryCard({ t, locale, state }) {
      const channels = state.capabilities?.channels ?? []
      const allSelected = state.gallery.length > 0 && state.selection.length === state.gallery.length
      return h('section', { className: 'wbCard', style: { borderTopLeftRadius: 0, borderTopRightRadius: 0 } },
        h('div', { className: 'wbToolbar' },
          h('input', {
            className: 'wbInput', value: state.search,
            placeholder: t('gallery.search'),
            onChange: (event) => { state.setSearch(event.target.value) },
          }),
          h('select', {
            className: 'wbSelect',
            value: state.filterChannel,
            onChange: (event) => { state.setFilterChannel(event.target.value) },
          },
            h('option', { value: '' }, t('gallery.filterAll')),
            channels.map(entry => h('option', { key: entry.id, value: entry.id }, entry.label)))),
        state.selection.length > 0
          ? h('div', { className: 'wbToolbar' },
            h('span', { className: 'wbCardHint' }, t('gallery.selected', { n: state.selection.length })),
            h('button', {
              type: 'button', className: 'wbBtn', 'data-variant': 'danger',
              onClick: () => {
                if (window.confirm(t('gallery.deleteConfirm', { n: state.selection.length }))) {
                  void state.deleteArtifacts()
                }
              },
            }, t('gallery.delete')),
            h('button', {
              type: 'button', className: 'wbBtn', 'data-variant': 'ghost',
              onClick: () => { state.setSelection([]) },
            }, t('gallery.clearSelection')))
          : h('div', { className: 'wbToolbar' },
            h('button', {
              type: 'button', className: 'wbMini',
              disabled: state.gallery.length === 0,
              onClick: () => { state.setSelection(allSelected ? [] : state.gallery.map(entry => entry.file)) },
            }, allSelected ? t('gallery.clearSelection') : t('gallery.selectAll')),
            h('button', { type: 'button', className: 'wbMini', onClick: () => { void state.reloadGallery() } }, t('gallery.refresh')),
            h('span', { className: 'wbCardHint', style: { marginInlineStart: 'auto' } },
              t('result.tokensCumulative') + ' · ' + state.cumulative)),
        state.galleryState === 'loading'
          ? h('div', { className: 'wbEmpty' }, t('gallery.loading'))
          : state.galleryState === 'error'
            ? h('div', { className: 'wbEmpty' }, t('gallery.error'))
            : state.gallery.length === 0
              ? h('div', { className: 'wbEmpty' }, t('gallery.empty'))
              : h('div', { className: 'wbGallery' },
                state.gallery.map(entry => h(Tile, {
                  key: entry.file,
                  entry,
                  locale,
                  t,
                  selected: state.selection.includes(entry.file),
                  onToggle: state.toggleSelected,
                  onOpen: state.setOpenEntry,
                  onDelete: (name) => {
                    if (window.confirm(t('gallery.deleteConfirm', { n: 1 }))) void state.deleteArtifacts([name])
                  },
                }))))
    }

    /** Prompt presets: the user's own, plus the built-in library placeholder. */
    function LibraryCard({ t, locale, state }) {
      const [name, setName] = useState('')
      const builtin = state.builtin
      return h('section', { className: 'wbCard', style: { borderTopLeftRadius: 0, borderTopRightRadius: 0 } },
        h('div', { className: 'wbBody' },
          h('div', { className: 'wbRow' },
            h('input', {
              className: 'wbInput',
              style: { flex: '1 1 180px' },
              value: name,
              placeholder: t('library.namePlaceholder'),
              'aria-label': t('library.name'),
              onChange: (event) => { setName(event.target.value) },
            }),
            h('button', {
              type: 'button', className: 'wbBtn',
              onClick: async () => {
                await state.savePreset(name)
                setName('')
              },
            }, t('library.saveCurrent')))),
        state.presets2.length === 0
          ? h('div', { className: 'wbEmpty' }, t('library.empty'))
          : h('div', { className: 'wbPresets' },
            state.presets2.map(preset => h('div', { key: preset.id, className: 'wbPreset' },
              preset.imageUrl === null
                ? h('div', { className: 'wbPresetNoImg' }, t('library.noImage'))
                : h('img', { className: 'wbPresetImg', src: preset.imageUrl, alt: '', loading: 'lazy' }),
              h('div', { className: 'wbPresetBody' },
                h('div', { className: 'wbPresetName' }, preset.title),
                h('div', { className: 'wbPresetText' }, preset.prompt)),
              h('div', { className: 'wbPresetBar' },
                h('button', {
                  type: 'button', className: 'wbMini',
                  onClick: () => { state.applyPreset(preset) },
                }, t('library.use')),
                h('button', {
                  type: 'button', className: 'wbMini', 'data-tone': 'danger',
                  onClick: () => {
                    if (window.confirm(t('library.deleteConfirm', { title: preset.title }))) {
                      void state.deletePreset(preset.id)
                    }
                  },
                }, t('library.delete')))))),
        builtin === null
          ? null
          : h('div', { className: 'wbBody', style: { borderTop: '1px solid var(--wb-border)' } },
            h('div', { className: 'wbRow' },
              h('strong', { style: { fontSize: '12.5px' } }, t('library.builtin')),
              h('span', { className: 'wbBadge', 'data-tone': 'warn' }, t('library.statusPending'))),
            h('div', { className: 'wbParamNote' }, t('library.builtinPending')),
            (builtin.sources ?? []).map(source => h('div', { key: source.id, className: 'wbQueueRow' },
              h('div', { className: 'wbQueueMain' },
                h('div', { className: 'wbQueueTitle' },
                  h('span', null, source.label),
                  h('span', { className: 'wbBadge' }, t('library.stars', { n: source.stars })),
                  h('span', { className: 'wbBadge' }, source.license)),
                h('div', { className: 'wbQueueSub' }, `${source.repo} · ${source.styles} styles`),
                h('div', { className: 'wbParamNote' }, source.note?.[locale] ?? source.note?.en ?? ''))))))
    }

    /** Trash: restore or permanently purge. */
    function TrashCard({ t, locale, state }) {
      return h('section', { className: 'wbCard', style: { borderTopLeftRadius: 0, borderTopRightRadius: 0 } },
        h('div', { className: 'wbToolbar' },
          h('span', { className: 'wbCardHint' }, `${state.trash.length}`),
          h('button', {
            type: 'button', className: 'wbMini', style: { marginInlineStart: 'auto' },
            disabled: state.trash.length === 0,
            onClick: () => { void state.restoreArtifacts(state.trash.map(entry => entry.id)) },
          }, t('trash.restoreAll')),
          h('button', {
            type: 'button', className: 'wbBtn', 'data-variant': 'danger',
            disabled: state.trash.length === 0,
            onClick: () => {
              if (window.confirm(t('trash.purgeConfirm', { n: state.trash.length }))) void state.purgeTrash()
            },
          }, t('trash.purge'))),
        state.trash.length === 0
          ? h('div', { className: 'wbEmpty' }, t('trash.empty'))
          : h('div', { className: 'wbBody' },
            state.trash.map(entry => h('div', { key: entry.id, className: 'wbTrashRow' },
              entry.imageUrl === null
                ? h('div', { className: 'wbTrashThumb' })
                : h('img', { className: 'wbTrashThumb', src: entry.imageUrl, alt: '', loading: 'lazy' }),
              h('div', { className: 'wbQueueMain' },
                h('div', { className: 'wbQueueTitle' }, entry.image),
                h('div', { className: 'wbQueueSub' },
                  `${t('trash.deletedAt')} ${String(entry.deletedAt ?? '').replace('T', ' ').slice(0, 19)}`)),
              h('button', {
                type: 'button', className: 'wbMini',
                onClick: () => { void state.restoreArtifacts([entry.id]) },
              }, t('trash.restore'))))))
    }

    /** The page: header, form column, and the tabbed right column. */
    function Workbench({ t, closePanel, activeLocale }) {
      // `t` reads the active locale at call time and the outlet re-renders on a
      // locale switch, so reading the id during render keeps provider notes in
      // step with the copy around them.
      const locale = typeof activeLocale === 'function' ? activeLocale() : 'zh'
      const state = useWorkbench(t, locale)
      const theme = useTheme()
      // The palette becomes inline custom properties on the root. Nothing in the
      // stylesheet names a colour, so a palette switch or a custom role repaints
      // every rule without a re-render of any card.
      // A CSS transform does not change layout size, so the canvas needs the
      // board's unscaled height written back to reserve the right scroll range.
      // Declared before paletteVars because that object reads boardHeight.
      const boardRef = useRef(null)
      const [boardHeight, setBoardHeight] = useState(0)
      useEffect(() => {
        const node = boardRef.current
        if (node === null) return undefined
        const measure = () => { setBoardHeight(node.offsetHeight) }
        measure()
        if (typeof window.ResizeObserver !== 'function') return undefined
        const observer = new window.ResizeObserver(measure)
        observer.observe(node)
        return () => { observer.disconnect() }
      }, [theme.zoom, state.jobs.length, state.tab, state.galleryAll.length])

      const paletteVars = {}
      for (const [role, value] of Object.entries(theme.roleColors)) {
        // `shadow` is a full value, the rest are colours; both travel as tokens.
        paletteVars[role === 'shadow' ? '--wb-shadow' : `--wb-${role.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`] = value
      }
      paletteVars['--wb-board-width'] = `${BOARD_WIDTH}px`
      paletteVars['--wb-zoom'] = String(theme.zoom)
      paletteVars['--wb-board-height'] = `${boardHeight}px`
      const tabs = [
        ['gallery', 'tab.gallery', state.galleryAll.length],
        ['library', 'tab.library', state.presets2.length],
        ['trash', 'tab.trash', state.trash.length],
      ]
      const zoomUi = {
        zoom: theme.zoom,
        setZoom: theme.setZoom,
        min: MIN_ZOOM,
        max: MAX_ZOOM,
        step: ZOOM_STEP,
      }
      return h('div', { className: 'wbRoot', 'data-wb-scheme': theme.scheme, style: paletteVars },
        h('div', { className: 'wbCanvas' },
          h('div', { className: 'wbBoard', ref: boardRef },
          h('div', { className: 'wbInner' },
          h(PageHead, {
            t, scheme: theme.scheme, preference: theme.preference, choose: theme.choose, closePanel,
            paletteId: theme.paletteId, choosePalette: theme.choosePalette,
            custom: theme.custom, setRole: theme.setRole, resetCustom: theme.resetCustom,
            roleColors: theme.roleColors, zoomUi,
          }),
          h('div', { className: 'wbLayout' },
            // Column 1: what the run is built from. Column 2: the run itself and
            // its failures — the widest column, because a failure reason has to
            // be readable without scrolling. Column 3: what came out.
            h('div', { className: 'wbCol' },
              h(ChannelCard, { t, locale, state }),
              h(CustomPalette, {
                t,
                custom: theme.custom,
                setRole: theme.setRole,
                resetCustom: theme.resetCustom,
                roleColors: theme.roleColors,
              }),
              h(PromptCard, { t, locale, state, gallery: state.galleryAll })),
            h('div', { className: 'wbCol' },
              h(QueueCard, { t, locale, state })),
            h('div', { className: 'wbCol' },
              h('div', null,
                h('div', { className: 'wbTabs', role: 'tablist' },
                  tabs.map(([id, key, count]) => h('button', {
                    key: id, type: 'button', className: 'wbTab', role: 'tab',
                    'aria-selected': state.tab === id ? 'true' : 'false',
                    onClick: () => {
                      state.setTab(id)
                      if (id === 'trash') void state.reloadTrash()
                      if (id === 'library') void state.reloadLibrary()
                      if (id === 'gallery') void state.reloadGallery()
                    },
                  }, t(key), h('span', { className: 'wbTabCount' }, String(count))))),
                state.tab === 'gallery' ? h(GalleryCard, { t, locale, state }) : null,
                state.tab === 'library' ? h(LibraryCard, { t, locale, state }) : null,
                state.tab === 'trash' ? h(TrashCard, { t, locale, state }) : null)))))),
        state.openEntry === null
          ? null
          : h(Lightbox, {
            t,
            locale,
            entry: state.openEntry,
            capabilities: state.capabilities,
            onClose: () => { state.setOpenEntry(null) },
            onDelete: (name) => {
              if (window.confirm(t('gallery.deleteConfirm', { n: 1 }))) void state.deleteArtifacts([name])
            },
            onReuse: state.reuseEntry,
            onAsReference: state.useAsReference,
            onSavePreset: async (item) => {
              // The artifact's own recorded prompt and settings become the
              // preset, with the image itself as the example: nothing is copied.
              const defaultTitle = (item.prompt ?? '').slice(0, 40) || item.file
              const answer = window.prompt(t('library.name'), defaultTitle)
              if (answer === null || answer.trim() === '') return
              await state.savePresetFromArtifact(item, answer.trim())
            },
          }))
    }

    /** The sidebar row glyph, drawn at whatever size the shell asks for. */
    function WorkbenchIcon({ size }) {
      return h('svg', {
        'data-dsh-panel-entry': PANEL_ID,
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.3,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
      h('rect', { x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 }),
      h('circle', { cx: 5.6, cy: 6.1, r: 1.1 }),
      h('path', { d: 'M2.6 11.4l3.2-3 2.4 2.3 2-1.9 3.2 3' }))
    }

    return {
      // `apply` reads ctx.locale, ctx.slots and ctx.layout synchronously on its
      // first line, so Cordis must not call it before those services exist.
      // Without this declaration the entry activates too early, throws on the
      // missing service, and the boot audit reports the whole row as failed.
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        // The stylesheet is a plain <style> tag owned by this plugin: the client
        // module system loads this bundle lazily, so the effect's disposer is
        // what removes it when the row is disabled.
        ctx.effect(() => {
          let tag = document.getElementById(STYLE_ID)
          if (tag === null) {
            tag = document.createElement('style')
            tag.id = STYLE_ID
            tag.textContent = CSS
            document.head.appendChild(tag)
          }
          return () => { tag.remove() }
        }, 'image-workbench: stylesheet')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'image-workbench: dictionaries')

        const t = ctx.locale.bind(NS)
        const disposers = []

        disposers.push(ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({
            closePanel: () => { ctx.layout.selectPanel(null) },
            // A provider note is bilingual data, not copy: `t` cannot pick the
            // right arm of `{zh, en}`, so the seat carries the active id too.
            activeLocale: () => ctx.locale.getSnapshot().active,
          }),
        }, Workbench)))
        disposers.push(ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          // After the shipped Plugins (0) and Schedule (10) rows and the task
          // board (20), so this row never displaces a page the user already had.
          order: 30,
          locale: NS,
          label: () => t('entry.label'),
        }, WorkbenchIcon)))

        ctx.effect(() => () => {
          // Leave the page BEFORE its registration disappears: the layout
          // resolves the selected panel through the live main registry, and a
          // selected key that vanished renders nothing.
          // Only leave it when this plugin's own page is the selection, so
          // another plugin's page is never reset by our unload.
          try {
            if (ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID) ctx.layout.selectPanel(null)
          } catch {
            /* a layout torn down first leaves nothing to deselect */
          }
          for (const dispose of disposers.splice(0)) dispose()
        }, 'image-workbench: panel registrations')
      },
    }
  },
})
