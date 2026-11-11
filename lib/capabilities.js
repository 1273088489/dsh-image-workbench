/**
 * Channel capabilities = a declarative table merged with live introspection of
 * the image-gen-hub Python module.
 *
 * Nothing here re-implements a provider: the table names which module constant
 * holds a channel's side bounds, which module function signature holds its
 * default model, and — only for facts the module keeps as inline literals or
 * does not expose at all — the rule itself. Adding a channel therefore means
 * adding one declaration entry; the browser stores no channel ids, model ids,
 * size bounds, step parameter names, billing, image-input, seed or concurrency
 * facts of its own.
 *
 * Three families of fact live in the declaration because the module has no
 * machine-readable form for them, and inventing one there would be worse than
 * declaring it here:
 *
 *   - `paid`       — billing model.
 *   - `seed`       — whether a channel exposes a seed at all, and whether that
 *                    seed actually reproduces an image. Verified per channel
 *                    from the provider docs and the module signature; see the
 *                    per-channel notes.
 *   - `concurrency`— how many simultaneous requests the provider tolerates.
 *                    ModelScope's own limits page says it targets single-
 *                    concurrent developer use, so its permit is 1 by design,
 *                    not by timidity.
 *
 * @module dsh-image-workbench/lib/capabilities
 */

/** Pseudo-channel meaning "run the module's own fallback chain". */
export const AUTO_CHANNEL_ID = 'auto'

/**
 * Aspect ratios offered by the workbench, widest applicability first.
 * Ratios are a presentation axis, not a provider capability, so the owner of
 * the form declares them once here.
 */
export const RATIOS = Object.freeze([
  { id: '1:1', width: 1, height: 1 },
  { id: '4:3', width: 4, height: 3 },
  { id: '3:4', width: 3, height: 4 },
  { id: '3:2', width: 3, height: 2 },
  { id: '2:3', width: 2, height: 3 },
  { id: '16:9', width: 16, height: 9 },
  { id: '9:16', width: 9, height: 16 },
])

/**
 * Resolution tiers, expressed as the LONG edge in pixels. A tier only appears
 * for a ratio when the resulting pair satisfies the channel's declared rule.
 */
export const TIER_LONG_SIDES = Object.freeze([512, 768, 1024, 1360, 1536, 2048, 2560, 3072, 4096])

/** Highest simultaneous generations the advanced slider may request. */
export const MAX_USER_CONCURRENCY = 3

/**
 * Prompt-length ceilings, per channel and — where a family differs — per model.
 *
 * These are measured, not assumed. The workbench used to apply one flat 4000
 * for every provider, which was wrong in both directions: it rejected prompts
 * ModelScope and Pollinations accept, and it let a 4000-character prompt reach
 * Cloudflare's flux schema, which stops at 2048.
 *
 * Each entry records how the number was obtained, because a limit copied from
 * documentation can be wrong (Pollinations documents 32000 for the POST
 * endpoint, while the GET endpoint this workbench uses is capped at 20000
 * upstream). Probes were sent directly to the provider with `save=False`, once
 * per boundary, and never through the workbench queue.
 */
export const PROMPT_LIMITS = Object.freeze({
  modelscope: {
    // Server-side rejection of 12000 chars reads "invalid prompt or prompt
    // length more than 4000", and 2001 was accepted, so 4000 is the real wall.
    // (The docs' "长度小于 2000" is a recommendation the API does not enforce.)
    limit: 4000,
    source: 'measured: 4000 accepted, 12000 rejected with "prompt length more than 4000"',
  },
  sensenova: {
    // Measured on the paid channel at 1024x1024, seven requests total. The
    // docs' "3–4K context" is the model's context budget, NOT an input ceiling:
    // u1.5-lite accepted 4001, 8000, 16000 and 32000 characters and refused
    // 64000 with "field Prompt invalid, should be at most 32000"; u1.5-fast
    // accepted 32000 and refused 32001 with the identical message.
    //
    // Both models therefore share one ceiling, and an over-limit rejection is
    // free (0.2–0.3 s, usage null), which is why probing one character past the
    // boundary costs nothing.
    limit: 32000,
    source: 'measured: both models accept 32000 and reject 32001 with "should be at most 32000" (rejection unbilled)',
    paid: true,
  },
  pollinations: {
    // GET /image/{prompt} is proxied upstream, which answers
    // "Prompt length (32000) exceeds the maximum allowed length of 20000
    // characters" — so 20000, not the 32000 the POST endpoint documents.
    limit: 20000,
    source: 'measured: 8000 accepted, 20000+1 rejected with "maximum allowed length of 20000"',
  },
  cloudflare: {
    // Per-family schema, so the channel figure is the loosest family. Models
    // that declare their own `promptLimit` override this.
    limit: 8000,
    source: 'measured: SDXL family accepted 8000; flux-1-schnell caps at 2048 per model',
  },
})

/**
 * Prompt ceilings for individual models that differ from their channel.
 *
 * Cloudflare is the clearest case: `flux-1-schnell` declares `maxLength: 2048`
 * in its input schema and rejected 2049 characters with
 * "Length of '/prompt' must be <= 2048", while the SDXL family accepted 8000.
 * A single channel number cannot describe both.
 */
export const MODEL_PROMPT_LIMITS = Object.freeze({
  '@cf/black-forest-labs/flux-1-schnell': {
    limit: 2048,
    source: 'measured: 2048 accepted, 2049 rejected with "must be <= 2048"',
  },
})

/**
 * Every advanced parameter the workbench can render.
 *
 * A parameter is only ever offered for a channel whose module signature accepts
 * it (`accepted`), so the form cannot present a control the run would silently
 * drop. Ranges come from the declaration here, overridable per channel where a
 * provider documents a different one.
 *
 * `seed` is deliberately not in this table: it carries the reproducibility
 * contract, which is per model rather than per channel, so it is resolved by
 * {@link resolveSeed} instead.
 */
export const PARAM_TABLE = Object.freeze([
  {
    key: 'negative_prompt',
    label: { zh: '负面提示词', en: 'Negative prompt' },
    type: 'text',
  },
  {
    key: 'steps',
    label: { zh: '步数', en: 'Steps' },
    type: 'int',
    // The channel's own steps rule always wins; these are the fallbacks.
    min: 1,
    max: 100,
  },
  {
    key: 'guidance',
    label: { zh: '引导强度', en: 'Guidance' },
    type: 'float',
    min: 0,
    max: 20,
    step: 0.5,
  },
  {
    key: 'quality',
    label: { zh: '画质档', en: 'Quality' },
    type: 'enum',
    options: ['low', 'medium', 'high', 'hd'],
  },
  {
    key: 'transparent',
    label: { zh: '透明背景', en: 'Transparent background' },
    type: 'bool',
    note: {
      zh: '仅 gptimage / gpt-image-2.5 系模型支持，因此只在这些模型上出现。',
      en: 'Only the gptimage / gpt-image-2.5 models accept this, so the switch only appears for them.',
    },
  },
  {
    key: 'output_format',
    label: { zh: '输出格式', en: 'Output format' },
    type: 'enum',
    options: ['png', 'jpeg', 'webp'],
  },
  {
    key: 'prompt_extend',
    label: { zh: '提示词扩写', en: 'Prompt extend' },
    type: 'bool',
    note: {
      zh: '服务端把提示词扩写后再送模型。短提示词建议开着（会补充细节）；长提示词想原样生效请关掉——实测 3 万字符开着时被压到约 2.2K token，关掉后是 8.6K。',
      en: 'The provider expands the prompt before it reaches the model. Keep it on for short prompts (it adds detail); turn it off when a long prompt must survive intact — measured, 30k characters was squeezed to ~2.2k tokens with it on, versus 8.6k with it off.',
    },
  },
  {
    key: 'watermark',
    label: { zh: '水印', en: 'Watermark' },
    type: 'bool',
  },
  {
    key: 'loras',
    label: { zh: 'LoRA', en: 'LoRA' },
    type: 'json',
    note: {
      zh: 'JSON 对象：{"仓库id": 权重}，最多 6 个且权重之和必须为 1.0。',
      en: 'JSON object: {"repo-id": weight}. At most 6 entries, weights must sum to 1.0.',
    },
  },
])

/**
 * One declared channel.
 *
 * - `models`: literal model ids (used when the module publishes no list).
 * - `modelsFrom`: name of the module constant holding the model ids.
 * - `modelGroups`: model ids come from module constant sets, and each set
 *   carries its own size/step rule (Cloudflare's model families).
 * - `size`: side bounds; `minFrom`/`maxFrom`/`stepFrom` read the numbers from
 *   module constants, while `min`/`max`/`step` declare what the module keeps
 *   inline.
 * - `seed`: the reproducibility contract, resolved per model by
 *   {@link resolveSeed}. `supported: false` hides the control entirely;
 *   `reproducible: 'partial'` names the models that honour it.
 * - `concurrency`: provider-tolerated simultaneous requests. See each entry.
 */
export const CHANNEL_TABLE = Object.freeze([
  {
    id: 'modelscope',
    label: 'ModelScope 魔搭',
    credential: 'MODELSCOPE_API_TOKEN',
    paid: false,
    imageInput: null,
    models: [
      { id: 'Qwen/Qwen-Image-2.1-Turbo', label: 'Qwen-Image 2.1 Turbo' },
      { id: 'Qwen/Qwen-Image-2.1', label: 'Qwen-Image 2.1' },
      { id: 'Qwen/Qwen-Image', label: 'Qwen-Image' },
    ],
    size: { minFrom: 'MODELSCOPE_MIN_SIDE', maxFrom: 'MODELSCOPE_MAX_SIDE', quantize: 16 },
    // The module rejects steps outside this range before sending anything.
    steps: { param: 'steps', min: 1, max: 100 },
    guidance: { min: 1.5, max: 20 },
    // Measured, not assumed: two runs with the same prompt, size and seed
    // returned byte-identical PNGs (sha256 c5dfd17556212aa6), so this channel
    // reproduces exactly for the default model. The docs do not enumerate which
    // families honour it, so the note keeps the measurement's scope honest.
    seed: {
      supported: true,
      reproducible: 'yes',
      note: {
        zh: '实测：同一提示词与 seed 两次生成得到完全相同的文件。官方文档未逐一列明哪些模型支持，故换模型时以实测为准。',
        en: 'Measured: the same prompt and seed produced a byte-identical file twice. The docs do not list which models honour it, so re-measure after changing the model.',
      },
    },
    // "原则上以保障开发者单并发正常使用为目标" — the provider's own limits
    // page. One permit, deliberately.
    concurrency: 1,
    notes: { zh: '免费渠道，异步任务提交后轮询结果。官方建议单并发。', en: 'Free channel; submits an async task and polls. The provider targets single-concurrent use.' },
  },
  {
    id: 'sensenova',
    label: 'SenseNova 商汤日日新',
    credential: 'SENSENOVA_API_KEY',
    paid: true,
    // The edit endpoint takes up to five references; the first is the primary.
    imageInput: { maxImages: 5 },
    modelsFrom: 'SENSENOVA_MODELS',
    size: {
      minFrom: 'SENSENOVA_MIN_SIDE',
      maxFrom: 'SENSENOVA_MAX_SIDE',
      stepFrom: 'SENSENOVA_SIDE_STEP',
      ratioMaxFrom: 'SENSENOVA_MAX_RATIO',
    },
    // The REST endpoint exposes no sampler knobs; the declaration is explicit
    // about that instead of inventing a parameter.
    steps: null,
    // The signature has no `seed` parameter at all, so nothing can be repeated.
    seed: {
      supported: false,
      reproducible: 'no',
      note: {
        zh: '该渠道没有 seed 参数，同样提示词也只会得到不同的随机结果，无法复现。',
        en: 'This channel has no seed parameter: the same prompt yields a different image, and nothing can be reproduced.',
      },
    },
    // No published RPM or concurrency limit; two in flight, then back off.
    concurrency: 2,
    notes: { zh: '按 token 计费的渠道，唯一支持参考图编辑。', en: 'Token-billed channel; the only one that accepts reference images.' },
  },
  {
    id: 'pollinations',
    label: 'Pollinations',
    credential: 'POLLINATIONS_API_KEY',
    paid: false,
    imageInput: null,
    // Trimmed to the two models this user actually works with, as requested.
    // Both are verified present, healthy and free in the live catalog
    // (/image/models, 2026-11-09): per_user_rpm 12, success_rate ≥ 99%.
    //
    // The previous working set has been dropped on purpose. Two entries were
    // already dead in the live catalog — `community/tomdacatto/gpt-image-2.5-
    // sunburst` (the module's own default) no longer exists there, so a run
    // pinned to it fails before reaching the provider.
    models: [
      { id: 'microsoft/mai-image-2.6', label: 'MAI Image 2.6' },
      { id: 'microsoft/mai-image-2.6-flash', label: 'MAI Image 2.6 Flash' },
    ],
    // Server-side ceiling on a single side. The MAI models are stricter than
    // the channel: measured, both require ≥768 px a side, multiples of 16, and
    // ≤2,359,296 total pixels — the docs attribute that rule to `-flash` only,
    // but `mai-image-2.6` answered the same 400 at 640×640. `sizeModels` below
    // applies the measured rule to both; this entry stays the channel default.
    size: { max: 1920 },
    // Per-model size rules that override the channel's, keyed by model id.
    // Source: measured 2026-11-09 (640×640 rejected, 784×784 accepted).
    sizeModels: {
      'microsoft/mai-image-2.6': {
        min: 768, max: 1920, step: 16, maxPixels: 2359296,
        note: {
          zh: '实测：每边 ≥768、16 的倍数、总像素 ≤2,359,296。官方只把这个限制写在 -flash 上，但两者行为一致。',
          en: 'Measured: ≥768 per side, multiples of 16, ≤2,359,296 total pixels. The docs attribute this to -flash only, but both behave the same.',
        },
      },
      'microsoft/mai-image-2.6-flash': {
        min: 768, max: 1920, step: 16, maxPixels: 2359296,
        note: {
          zh: '官方文档：每边 ≥768、16 的倍数、总像素 ≤2,359,296。',
          en: 'Documented: ≥768 per side, multiples of 16, ≤2,359,296 total pixels.',
        },
      },
    },
    // `quality` and `transparent` are accepted only by a handful of models, and
    // the provider answers 400 for the rest, so both stay gated per model rather
    // than per channel. With the trimmed model set neither MAI model supports
    // them, so the gates simply never open — kept because the declarations are
    // still the correct provider facts if a model is added back.
    // Source: references/pollinations.md.
    qualityModels: ['gptimage', 'gptimage-large', 'gpt-image-2', 'grok-imagine-image-2.0'],
    steps: null,
    // Only these six models honour `seed`; every other model ignores the
    // parameter without an error, which is exactly the case the form must not
    // pretend to support. Neither MAI model is in the list, so no seed control
    // appears for them. Source: references/pollinations.md § seed.
    seed: {
      supported: true,
      reproducible: 'partial',
      models: [
        'black-forest-labs/flux.1-schnell',
        'black-forest-labs/flux.1.1-pro',
        'tongyi-mai/z-image-turbo',
        'bytedance/seedream-4.0',
        'black-forest-labs/flux.2-klein-4b',
        'bytedance/seedance-2.0',
      ],
      note: {
        zh: '只有 6 个模型认 seed，其余模型会静默忽略该参数。',
        en: 'Only six models honour a seed; every other model silently ignores it.',
      },
    },
    // Models publish per_user_rpm (12–300); three in flight stays under the
    // tightest of the declared set without needing a per-model table.
    concurrency: 3,
    // The provider silently ignores CJK text instead of rejecting it, so the
    // page warns before submitting. Declared here, not keyed off the channel id.
    promptScript: 'latin',
    notes: { zh: '提示词请用英文：中文输入会静默返回不相干的画面。', en: 'Write the prompt in English: CJK text silently returns an unrelated image.' },
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    credential: 'CLOUDFLARE_API_TOKEN',
    paid: false,
    imageInput: null,
    modelGroups: [
      {
        constant: 'CF_FLUX_SCHNELL',
        single: true,
        size: { fixed: [1024, 1024] },
        steps: { param: 'steps', min: 1, max: 8, default: 4 },
        // Its wire schema is `additionalProperties: false` with only prompt and
        // steps, so the Python signature accepts these two and the payload then
        // discards them. Offering a control the request drops is worse than not
        // offering it, so the group withholds them.
        dropParams: ['negative_prompt', 'guidance'],
        // The schema is additionalProperties:false and lists only prompt+steps,
        // yet the provider's own examples pass a seed. Which one wins is
        // undocumented, so this group promises nothing.
        seedOverride: { supported: true, reproducible: 'unknown' },
      },
      {
        constant: 'CF_SDXL_FAMILY',
        size: { min: 256, max: 2048 },
        steps: { param: 'num_steps', min: 1, max: 20, default: 20 },
        guidance: { min: 0, max: 20 },
      },
      {
        constant: 'CF_NUM_STEPS_ONLY',
        size: { min: 0, max: 2048 },
        steps: { param: 'num_steps', min: 1, max: 50, default: 25 },
        guidance: { min: 2, max: 10 },
      },
      {
        constant: 'CF_DUAL_STEP_NAME',
        size: { min: 0, max: 2500 },
        steps: { param: 'num_steps', min: 1, max: 40, default: 4 },
        guidance: { min: 0, max: 10 },
      },
    ],
    // Declared so a model added to a family constant is never offered before
    // its wire form is known to work.
    excludeFrom: 'CF_MULTIPART_ONLY',
    steps: null,
    // Every image family schema but flux-1-schnell lists seed; see the group
    // override above for the one that contradicts itself.
    seed: { supported: true, reproducible: 'likely' },
    // The daily wall is 10,000 neurons per account, not a concurrency limit.
    concurrency: 3,
    notes: { zh: '最后兜底：flux-1-schnell 固定 1024×1024。每日 10000 neurons 额度。', en: 'Last resort: flux-1-schnell is fixed at 1024×1024. Daily wall is 10,000 neurons.' },
  },
])

/** Read one numeric module constant, or undefined when absent/not a number. */
function constantNumber(probe, name) {
  if (typeof name !== 'string') return undefined
  const value = probe?.constants?.[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read one module constant as a list of strings. */
function constantList(probe, name) {
  const value = probe?.constants?.[name]
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter(entry => typeof entry === 'string')
}

/** The module function signature parameters of one backend, or {}. */
function signatureOf(probe, channelId) {
  const params = probe?.signatures?.[channelId]
  return params !== null && typeof params === 'object' ? params : {}
}

/** The module's declared default model for one backend, when it has one. */
function defaultModelOf(probe, channelId) {
  const model = signatureOf(probe, channelId).model
  return typeof model?.default === 'string' ? model.default : undefined
}

/** Resolve a declared size rule into plain numbers plus its source description. */
function resolveSizeRule(declared, probe) {
  if (declared === undefined || declared === null) return { min: 0, max: 4096, step: 1 }
  if (Array.isArray(declared.fixed)) {
    return { fixed: [declared.fixed[0], declared.fixed[1]], min: 0, max: 0, step: 1 }
  }
  const min = declared.minFrom === undefined ? (declared.min ?? 0) : (constantNumber(probe, declared.minFrom) ?? 0)
  const max = declared.maxFrom === undefined ? (declared.max ?? 4096) : (constantNumber(probe, declared.maxFrom) ?? 4096)
  const step = declared.stepFrom === undefined ? (declared.step ?? 1) : (constantNumber(probe, declared.stepFrom) ?? 1)
  const ratioMax = declared.ratioMaxFrom === undefined
    ? (declared.ratioMax ?? null)
    : (constantNumber(probe, declared.ratioMaxFrom) ?? null)
  return {
    min,
    max,
    step: Math.max(1, Math.trunc(step) || 1),
    quantize: Math.max(1, Math.trunc(declared.quantize ?? 1) || 1),
    ratioMax,
    // A total-pixel budget is a separate axis from the per-side bound: the MAI
    // models accept 1920 a side but not both sides at once.
    maxPixels: Number.isInteger(declared.maxPixels) ? declared.maxPixels : null,
    note: declared.note ?? null,
  }
}

/** Round a side down to the rule's alignment so a client never sends an odd size. */
function alignSide(value, rule) {
  const unit = Math.max(rule.step ?? 1, rule.quantize ?? 1)
  if (unit <= 1) return Math.round(value)
  return Math.max(unit, Math.round(value / unit) * unit)
}

/** Whether a pair satisfies a rule (bounds, ratio ceiling, or a fixed size). */
function pairAllowed(width, height, rule) {
  if (Number.isInteger(rule.fixed?.[0])) return width === rule.fixed[0] && height === rule.fixed[1]
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false
  if (width <= 0 || height <= 0) return false
  if (width < rule.min || height < rule.min) return false
  if (width > rule.max || height > rule.max) return false
  if (rule.quantize > 1 && (width % rule.quantize !== 0 || height % rule.quantize !== 0)) return false
  if (rule.step > 1 && (width % rule.step !== 0 || height % rule.step !== 0)) return false
  if (rule.ratioMax !== null && Math.max(width, height) > Math.min(width, height) * rule.ratioMax) return false
  // A pixel budget rejects a pair whose sides are each legal but whose product
  // is not (the MAI models' 2,359,296 ceiling).
  if (Number.isInteger(rule.maxPixels) && width * height > rule.maxPixels) return false
  return true
}

/**
 * Build the ratio × resolution-tier matrix for one size rule.
 * @param rule - resolved rule.
 * @returns one entry per ratio that has at least one allowed tier.
 */
function buildPresets(rule) {
  const presets = []
  for (const ratio of RATIOS) {
    const tiers = []
    for (const longSide of TIER_LONG_SIDES) {
      const rawWidth = ratio.width >= ratio.height
        ? longSide
        : Math.round(longSide * ratio.width / ratio.height)
      const rawHeight = ratio.width >= ratio.height
        ? Math.round(longSide * ratio.height / ratio.width)
        : longSide
      const width = alignSide(rawWidth, rule)
      const height = alignSide(rawHeight, rule)
      if (!pairAllowed(width, height, rule)) continue
      if (tiers.some(entry => entry.width === width && entry.height === height)) continue
      tiers.push({ width, height, longSide })
    }
    if (tiers.length === 0) continue
    tiers.sort((left, right) => left.longSide - right.longSide)
    presets.push({ ratio: ratio.id, tiers })
  }
  return presets
}

/**
 * Resolve the seed contract for one model.
 *
 * A channel that has no `seed` in its function signature gets `supported:false`
 * no matter what its declaration says — the signature is the hard fact. A
 * channel that declares `reproducible: 'partial'` only supports the models it
 * names, so a model outside that list reports `supported:false` with the reason
 * instead of offering a control that would be ignored.
 * @param declared - channel-level (or group-level) seed declaration.
 * @param modelId - the model the form has selected.
 * @param accepted - whether the backend signature takes a `seed` parameter.
 * @returns the model-facing seed contract.
 */
function resolveSeed(declared, modelId, accepted) {
  const base = declared === undefined || declared === null ? { supported: false, reproducible: 'no' } : declared
  if (accepted !== true || base.supported !== true) {
    return {
      supported: false,
      reproducible: 'no',
      note: base.note ?? {
        zh: '该渠道的接口没有 seed 参数，无法复现。',
        en: 'This channel exposes no seed parameter, so a result cannot be reproduced.',
      },
    }
  }
  if (base.reproducible === 'partial') {
    const named = Array.isArray(base.models) ? base.models : []
    if (!named.includes(modelId)) {
      return {
        supported: false,
        reproducible: 'no',
        note: base.note ?? {
          zh: '这个模型不认 seed，填了也会被静默忽略。',
          en: 'This model ignores a seed, so setting one would be silently dropped.',
        },
      }
    }
    return { supported: true, reproducible: 'yes', note: base.note ?? null }
  }
  return {
    supported: true,
    reproducible: base.reproducible ?? 'unknown',
    note: base.note ?? null,
  }
}

/**
 * Resolve the advanced parameters one channel/model accepts.
 *
 * Acceptance is decided by the module signature, so a provider parameter added
 * to the Python function appears in the form with no change here, and one the
 * function does not take can never be offered.
 * @param channel - declaration entry.
 * @param group - the model group the model came from, when the channel has groups.
 * @param modelId - selected model id.
 * @param accepted - backend signature parameter names.
 * @returns rendered parameter descriptors, in {@link PARAM_TABLE} order.
 */
function resolveParams(channel, group, modelId, accepted) {
  // A channel declares `steps` once; a model group may override the parameter
  // name and range per family (Cloudflare's flux uses `steps`, SDXL uses
  // `num_steps`). The group always wins, because its function dispatches on it.
  const stepsRule = group?.steps ?? channel.steps ?? null
  const guidanceRule = group?.guidance ?? channel.guidance ?? null
  // A family whose wire schema rejects a field the function accepts must not
  // have that field offered: the run would return a value the user never set.
  const withheld = new Set(Array.isArray(group?.dropParams)
    ? group.dropParams
    : (Array.isArray(channel.dropParams) ? channel.dropParams : []))
  const rendered = []
  for (const definition of PARAM_TABLE) {
    if (withheld.has(definition.key)) continue
    if (accepted[definition.key] === undefined) continue
    const required = accepted[definition.key]?.hasDefault === false
    // A required positional is part of the call contract, never a user choice.
    if (required) continue
    const entry = {
      key: definition.key,
      label: definition.label,
      type: definition.type,
      note: definition.note ?? null,
    }
    if (definition.type === 'int' || definition.type === 'float') {
      const override = definition.key === 'steps' ? stepsRule : definition.key === 'guidance' ? guidanceRule : null
      entry.min = override?.min ?? definition.min ?? null
      entry.max = override?.max ?? definition.max ?? null
      entry.step = definition.key === 'steps' ? 1 : (definition.step ?? (definition.type === 'int' ? 1 : 0.5))
      const declaredDefault = override?.default ?? accepted[definition.key]?.default
      entry.default = typeof declaredDefault === 'number' ? declaredDefault : null
      entry.param = override?.param ?? definition.key
    }
    // Every parameter's module default is published, not just numeric ones.
    // A bool is the case that matters: `prompt_extend` defaults to True in the
    // module, so omitting it means "on" server-side. Without this the switch
    // rendered unchecked on an untouched form — it displayed "off" while the
    // request actually sent was "on", and toggling it twice silently flipped
    // the real behaviour. Publishing the default lets the control start in the
    // state the request will really have.
    if (entry.default === undefined) {
      const moduleDefault = accepted[definition.key]?.default
      if (moduleDefault !== null && moduleDefault !== undefined) entry.default = moduleDefault
      else if (definition.type === 'bool') entry.default = false
    }
    // A provider that answers 400 for an unsupported value makes the control
    // unusable rather than merely ignored, so it is withheld: a greyed-out
    // switch advertises a feature the page cannot deliver.
    if (definition.key === 'transparent' && transparentCapable(modelId) !== true) continue
    if (definition.key === 'quality'
      && Array.isArray(channel.qualityModels)
      && channel.qualityModels.includes(modelId) !== true) continue
    if (definition.type === 'enum') entry.options = definition.options
    rendered.push(entry)
  }
  return rendered
}

/**
 * Whether a Pollinations model accepts `transparent`.
 *
 * Declared here because the provider publishes it per model in its catalog,
 * not in the module: the other models answer HTTP 400 rather than ignoring the
 * flag, so offering the switch unconditionally would turn a harmless checkbox
 * into a failed run.
 * @param modelId - selected model id.
 * @returns whether the model takes the flag.
 */
function transparentCapable(modelId) {
  return [
    'gptimage',
    'gptimage-large',
    'openai/gpt-image-2.5-flare',
    'openai/gpt-image-2.5-sunburst',
    'community/tomdacatto/gpt-image-2.5-flare',
    'community/tomdacatto/gpt-image-2.5-sunburst',
  ].includes(modelId)
}

/**
 * Resolve the prompt ceiling that applies to one channel/model pair.
 *
 * A model-specific measurement wins over its channel's figure, because a
 * provider that applies per-family schema limits (Cloudflare) cannot be
 * described by one number. The result always names where the number came from,
 * so the page can say which limit it is enforcing instead of an anonymous
 * "too long".
 * @param channelId - channel the request would run on.
 * @param modelId - selected model, or undefined for a channel-wide answer.
 * @returns `{ limit, source, modelScoped }`.
 */
export function resolvePromptLimit(channelId, modelId) {
  const scoped = typeof modelId === 'string' ? MODEL_PROMPT_LIMITS[modelId] : undefined
  if (scoped !== undefined) {
    return { limit: scoped.limit, source: scoped.source, modelScoped: true }
  }
  const channel = PROMPT_LIMITS[channelId]
  if (channel !== undefined) {
    return { limit: channel.limit, source: channel.source, modelScoped: false }
  }
  // An unknown channel is not silently unbounded: the loosest measured ceiling
  // is used so a request can never exceed what any provider in the chain takes.
  const widest = Math.max(...Object.values(PROMPT_LIMITS).map(entry => entry.limit))
  return { limit: widest, source: 'unknown channel: clamped to the loosest measured ceiling', modelScoped: false }
}

/**
 * The prompt ceiling a fallback-chain request is held to.
 *
 * The head channel is the one that actually serves the request, and a chain
 * request carries no model id, so each backend resolves its own default model.
 * The head's default is therefore the ceiling that decides success or failure.
 *
 * Deliberately NOT the minimum across the chain. Taking the minimum would apply
 * Cloudflare's 2048 (its default `flux-1-schnell`) to every auto-mode request
 * and reject 3000-character prompts that ModelScope accepts outright — a
 * fallback whose own ceiling is tighter is a normal degraded attempt, not an
 * upfront reason to refuse. Per-channel and per-model limits are still published
 * separately, so the page can warn before a fallback would be skipped.
 * @param channelIds - channel ids in chain order.
 * @param channels - channel views, used to read each head candidate's default.
 * @returns `{ limit, source, modelScoped, channelId }`.
 */
function chainPromptLimit(channelIds, channels = []) {
  for (const id of channelIds) {
    const channel = channels.find(entry => entry.id === id)
    return { ...resolvePromptLimit(id, channel?.defaultModel), channelId: id }
  }
  return { ...resolvePromptLimit('', undefined), channelId: null }
}

/** One model entry of one channel, with its own size/steps/seed rule resolved. */
function modelEntry(entry, declaredRule, probe, imageInput, channel, group, accepted) {
  const rule = resolveSizeRule(declaredRule, probe)
  const seedDeclared = group?.seedOverride ?? channel.seed
  // A model may carry its own size rule, which wins over the channel's. The MAI
  // models are the reason: their 768 floor and pixel budget do not apply to
  // every Pollinations model, so a single channel rule would either reject legal
  // sizes or let illegal ones through.
  const override = channel.sizeModels?.[entry.id]
  const effectiveRule = override === undefined ? rule : resolveSizeRule(override, probe)
  return {
    id: entry.id,
    label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : entry.id,
    presets: buildPresets(effectiveRule),
    sizeNote: effectiveRule.note ?? null,
    imageInput: imageInput === null || imageInput === undefined
      ? null
      : { maxImages: Math.max(1, Math.trunc(imageInput.maxImages ?? 1)) },
    seed: resolveSeed(seedDeclared, entry.id, accepted.seed !== undefined),
    params: resolveParams(channel, group, entry.id, accepted),
    prompt: resolvePromptLimit(channel.id, entry.id),
  }
}

/**
 * Resolve one declared channel into the payload the browser renders.
 * @param channel - declaration entry.
 * @param probe - probe payload, or undefined when the module could not be read.
 * @returns channel view with models, presets, defaults and availability.
 */
function channelView(channel, probe) {
  const credentials = probe?.credentials ?? {}
  const required = channel.credential
  const available = required === undefined ? true : credentials[required] !== false
  const defaultModel = defaultModelOf(probe, channel.id)
  const accepted = signatureOf(probe, channel.id)

  let models = []
  if (Array.isArray(channel.modelGroups)) {
    const excluded = new Set(constantList(probe, channel.excludeFrom))
    for (const group of channel.modelGroups) {
      const ids = constantList(probe, group.constant)
      for (const id of ids) {
        if (excluded.has(id)) continue
        models.push(modelEntry({ id }, group.size, probe, channel.imageInput, channel, group, accepted))
      }
    }
  } else if (typeof channel.modelsFrom === 'string') {
    for (const id of constantList(probe, channel.modelsFrom)) {
      models.push(modelEntry({ id }, channel.size, probe, channel.imageInput, channel, null, accepted))
    }
  } else if (Array.isArray(channel.models)) {
    for (const entry of channel.models) {
      models.push(modelEntry(entry, channel.size, probe, channel.imageInput, channel, null, accepted))
    }
  }

  // The module's own default leads the list whenever the channel offers it.
  if (defaultModel !== undefined) {
    const index = models.findIndex(model => model.id === defaultModel)
    if (index > 0) models = [models[index], ...models.slice(0, index), ...models.slice(index + 1)]
  }

  return {
    id: channel.id,
    label: channel.label,
    paid: channel.paid === true,
    promptScript: channel.promptScript ?? null,
    imageInput: channel.imageInput === null || channel.imageInput === undefined
      ? null
      : { maxImages: Math.max(1, Math.trunc(channel.imageInput.maxImages ?? 1)) },
    available,
    credential: required ?? null,
    notes: channel.notes ?? null,
    seed: channel.seed === undefined ? null : {
      supported: channel.seed.supported === true,
      reproducible: channel.seed.reproducible ?? 'no',
      note: channel.seed.note ?? null,
    },
    concurrency: Math.max(1, Math.trunc(channel.concurrency ?? 1)),
    defaultModel: models[0]?.id ?? null,
    // The channel's own ceiling, not its leading model's: Cloudflare's channel
    // figure is the SDXL family's 8000 while `flux-1-schnell` is 2048, and
    // collapsing them would under-report what the channel can accept.
    prompt: resolvePromptLimit(channel.id, undefined),
    models,
  }
}

/**
 * Sizes the fallback chain can serve, as the union of every channel's leading
 * model matrix. Each tier records which channels accept it, so the page can say
 * why a large size only works through the channel-billed provider.
 * @param channels - channel views in chain order.
 * @returns ratio × tier matrix with per-tier channel attribution.
 */
function buildAutoPresets(channels) {
  const byRatio = new Map()
  for (const channel of channels) {
    const leading = channel.models[0]
    if (leading === undefined) continue
    for (const preset of leading.presets) {
      const bucket = byRatio.get(preset.ratio) ?? new Map()
      for (const tier of preset.tiers) {
        const key = `${tier.width}x${tier.height}`
        const existing = bucket.get(key) ?? { width: tier.width, height: tier.height, longSide: tier.longSide, channels: [] }
        if (!existing.channels.includes(channel.id)) existing.channels.push(channel.id)
        bucket.set(key, existing)
      }
      byRatio.set(preset.ratio, bucket)
    }
  }
  const presets = []
  for (const ratio of RATIOS) {
    const bucket = byRatio.get(ratio.id)
    if (bucket === undefined) continue
    presets.push({ ratio: ratio.id, tiers: [...bucket.values()].sort((left, right) => left.longSide - right.longSide) })
  }
  return presets
}

/**
 * Compose the capability payload from a probe result.
 * @param options - probe payload and the module directory it was read from.
 * @returns JSON-safe capabilities the workbench renders and validates against.
 */
export function buildCapabilities({ probe, moduleDir, error }) {
  const moduleOk = probe?.ok === true
  const order = Array.isArray(probe?.defaultOrder) && probe.defaultOrder.length > 0
    ? probe.defaultOrder.filter(id => CHANNEL_TABLE.some(channel => channel.id === id))
    : CHANNEL_TABLE.map(channel => channel.id)
  const channels = CHANNEL_TABLE.map(channel => channelView(channel, probe))
  const chain = order.map(id => channels.find(channel => channel.id === id)).filter(Boolean)
  return {
    ok: true,
    moduleDir: moduleDir ?? null,
    moduleOk,
    moduleError: moduleOk ? null : (error ?? probe?.error ?? null),
    credentials: probe?.credentials ?? null,
    defaultOrder: order,
    auto: {
      id: AUTO_CHANNEL_ID,
      label: '自动 · 按降级链',
      order,
      presets: buildAutoPresets(chain),
      // `auto` runs the chain: its first submission occupies the head channel,
      // but a fallback may land on any of them, so the permit it consumes is the
      // strictest of the ones it can actually reach.
      concurrency: Math.min(
        1,
        ...order.map(id => channels.find(channel => channel.id === id)?.concurrency ?? 1),
      ),
      seed: {
        supported: true,
        reproducible: 'partial',
        note: {
          zh: '自动模式按降级链执行；seed 只在真正出图的渠道支持时生效，商汤不支持。',
          en: 'Auto follows the fallback chain; a seed only applies on the channel that actually renders, and SenseNova has none.',
        },
      },
      // Every channel in the chain must accept the prompt, so the chain's own
      // ceiling is the head channel's — see chainPromptLimit for why the head,
      // and not the narrowest member, decides.
      prompt: (() => {
        const resolved = chainPromptLimit(order, channels)
        return {
          ...resolved,
          headChannel: resolved.channelId ?? null,
          headLabel: channels.find(channel => channel.id === resolved.channelId)?.label ?? null,
        }
      })(),
    },
    channels,
    limits: {
      // The slider may ask for more than any single channel allows; the Host
      // still clamps per channel, and the page shows each channel's own permit.
      maxUserConcurrency: MAX_USER_CONCURRENCY,
      channelPermits: Object.fromEntries(channels.map(channel => [channel.id, channel.concurrency])),
      // One entry per channel and per scoped model, so the form can pick the
      // right ceiling without knowing any provider rule itself.
      promptLimits: Object.fromEntries(channels.map(channel => [channel.id, channel.prompt.limit])),
      modelPromptLimits: Object.fromEntries(
        channels.flatMap(channel => channel.models
          .filter(model => model.prompt.modelScoped)
          .map(model => [model.id, model.prompt.limit])),
      ),
    },
  }
}

/**
 * Resolve the backend list a request runs with.
 *
 * `auto` always means the module's own chain. A concrete channel runs as the
 * chain's head unless the caller insists on that channel alone, in which case
 * the request has exactly one backend and the picked model is honoured.
 * @param channelId - selected channel id or `auto`.
 * @param onlyChannel - whether the fallback chain is disabled.
 * @param defaultOrder - module chain order.
 * @returns backend ids, highest priority first.
 */
export function resolveBackends(channelId, onlyChannel, defaultOrder) {
  const order = Array.isArray(defaultOrder) && defaultOrder.length > 0 ? defaultOrder : []
  if (channelId === AUTO_CHANNEL_ID) return [...order]
  if (onlyChannel === true) return [channelId]
  return [channelId, ...order.filter(id => id !== channelId)]
}

/**
 * Check one reference-image reference.
 *
 * The module's own edit endpoint takes a public https URL or a
 * `data:image/<fmt>;base64,<data>` payload, and it re-validates the host
 * itself, so this only rejects what could never be valid — it does not try to
 * be the provider's security check.
 * @param value - untrusted reference value.
 * @returns the trimmed reference, or undefined when it is not one.
 */
function referenceValue(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (/^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' ? trimmed : undefined
  } catch {
    return undefined
  }
}

/**
 * Coerce one advanced parameter value against its descriptor.
 *
 * Out-of-range numbers are rejected here rather than handed to the module,
 * because the module raises inside the child after a subprocess start but
 * before any provider request — cheap, yet the user still waits for a process.
 * @param descriptor - rendered parameter descriptor.
 * @param raw - untrusted value.
 * @returns `{ ok: true, value }` or `{ ok: false, code, error }`.
 */
function paramValue(descriptor, raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  switch (descriptor.type) {
    case 'int': {
      const value = Number(raw)
      if (!Number.isInteger(value)) return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be an integer` }
      if (descriptor.min !== null && value < descriptor.min) return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be >= ${descriptor.min}` }
      if (descriptor.max !== null && value > descriptor.max) return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be <= ${descriptor.max}` }
      return { ok: true, value }
    }
    case 'float': {
      const value = Number(raw)
      if (!Number.isFinite(value)) return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be a number` }
      if (descriptor.min !== null && value < descriptor.min) return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be >= ${descriptor.min}` }
      if (descriptor.max !== null && value > descriptor.max) return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be <= ${descriptor.max}` }
      return { ok: true, value }
    }
    case 'bool':
      return { ok: true, value: raw === true || raw === 'true' }
    case 'enum': {
      const options = descriptor.options ?? []
      if (!options.includes(String(raw))) {
        return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be one of ${options.join(', ')}` }
      }
      return { ok: true, value: String(raw) }
    }
    case 'text':
      return { ok: true, value: String(raw).slice(0, 2000) }
    case 'json': {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { ok: false, code: 'param-invalid', error: `${descriptor.key} must be a JSON object` }
        }
        return { ok: true, value: parsed }
      } catch {
        return { ok: false, code: 'param-invalid', error: `${descriptor.key} is not valid JSON` }
      }
    }
    default:
      return { ok: true, value: String(raw) }
  }
}

/**
 * Reject a prompt that the request's own providers would refuse.
 *
 * The ceiling depends on where the request actually runs: a single pinned model
 * has one number, while a fallback chain must satisfy every member because the
 * winning backend is not known in advance. Checking after `backends` is resolved
 * therefore catches the case a flat limit missed — a 4000-character prompt is
 * fine on ModelScope and rejected by Cloudflare's flux schema.
 * @param prompt - the trimmed prompt.
 * @param backends - backend ids the run may use.
 * @param modelId - pinned model id, or null when the run is a chain.
 * @param channels - channel views, so a chain can read each channel's default model.
 * @returns `{ ok: true }` or a refusal naming the limit and its source.
 */
function checkPromptLength(prompt, backends, modelId, channels) {
  const scoped = backends.length === 1 ? resolvePromptLimit(backends[0], modelId ?? undefined) : null
  const resolved = scoped ?? chainPromptLimit(backends, channels)
  if (prompt.length <= resolved.limit) return { ok: true }
  const where = resolved.modelScoped
    // A model-scoped ceiling is the real constraint even when the request is a
    // chain: the head channel's default model is the one that gets tried first.
    ? `${modelId !== null && modelId !== undefined ? `model ${modelId}` : `${resolved.channelId} default model`}`
    : backends.length === 1
      ? `channel ${backends[0]}`
      : `the head of the fallback chain (${backends[0]})`
  return {
    ok: false,
    code: 'prompt-too-long',
    limit: resolved.limit,
    length: prompt.length,
    scope: where,
    source: resolved.source,
    error: `prompt is ${prompt.length} characters; ${where} accepts at most ${resolved.limit}`,
  }
}

/**
 * Validate a generation request against the composed capabilities and return
 * the exact size to run with.
 * @param capabilities - payload from {@link buildCapabilities}.
 * @param body - untrusted request body.
 * @returns `{ ok: true, request }` or `{ ok: false, error }` with a stable code.
 */
export function validateGeneration(capabilities, body) {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt === '') return { ok: false, code: 'prompt-empty', error: 'prompt is required' }

  const channelId = typeof body?.channelId === 'string' ? body.channelId : ''
  if (channelId === '') return { ok: false, code: 'channel-missing', error: 'channelId is required' }

  const width = Number(body?.width)
  const height = Number(body?.height)
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return { ok: false, code: 'size-invalid', error: 'width and height must be integers' }
  }

  const rawImages = body?.images
  if (rawImages !== undefined && !Array.isArray(rawImages)) {
    return { ok: false, code: 'images-invalid', error: 'images must be a list of references' }
  }
  const images = []
  for (const entry of Array.isArray(rawImages) ? rawImages : []) {
    const reference = referenceValue(entry)
    if (reference === undefined) {
      return { ok: false, code: 'images-invalid', error: 'each reference must be an https URL or a data:image base64 value' }
    }
    images.push(reference)
  }

  if (images.length > 0 && channelId === AUTO_CHANNEL_ID) {
    // A reference image switches the run to the edit endpoint, which only one
    // provider exposes; picking the chain would silently drop it.
    return { ok: false, code: 'images-need-channel', error: 'choose a channel that accepts reference images' }
  }

  if (channelId === AUTO_CHANNEL_ID) {
    const offered = capabilities.auto.presets.some(preset =>
      preset.tiers.some(tier => tier.width === width && tier.height === height))
    if (!offered) {
      return { ok: false, code: 'size-not-offered', error: `${width}x${height} is not offered by the fallback chain` }
    }
    // The chain has no single model to validate these against, so a run over the
    // chain cannot carry them. Refusing is the honest answer: generate() would
    // hand them to whichever backend answered first, which may not be the one
    // the user had in mind.
    if (body?.seed !== undefined && body?.seed !== null && body?.seed !== '') {
      return {
        ok: false,
        code: 'seed-needs-channel',
        error: 'a seed needs one channel; auto mode runs the whole fallback chain',
      }
    }
    const autoParams = body?.params !== null && typeof body?.params === 'object' && !Array.isArray(body?.params)
      ? Object.keys(body.params).filter(key => body.params[key] !== undefined && body.params[key] !== '')
      : []
    if (autoParams.length > 0) {
      return {
        ok: false,
        code: 'params-need-channel',
        error: `advanced parameters need one channel; auto mode runs the whole fallback chain (${autoParams.join(', ')})`,
      }
    }
    // Auto runs the whole chain, so the prompt must satisfy its narrowest
    // member — the head channel alone is not the deciding limit.
    const chainOk = checkPromptLength(prompt, capabilities.defaultOrder, null, capabilities.channels)
    if (chainOk.ok !== true) return chainOk
    return {
      ok: true,
      request: { channelId, backends: [...capabilities.defaultOrder], model: null, prompt, width, height },
    }
  }

  const channel = capabilities.channels.find(entry => entry.id === channelId)
  if (channel === undefined) return { ok: false, code: 'channel-unknown', error: `unknown channel ${channelId}` }

  const modelId = typeof body?.model === 'string' && body.model !== '' ? body.model : channel.defaultModel
  const model = channel.models.find(entry => entry.id === modelId)
  if (model === undefined) return { ok: false, code: 'model-unknown', error: `unknown model ${String(modelId)}` }

  if (images.length > 0) {
    if (model.imageInput === null) {
      return { ok: false, code: 'images-unsupported', error: `${model.id} accepts no reference image` }
    }
    if (images.length > model.imageInput.maxImages) {
      return {
        ok: false,
        code: 'images-too-many',
        error: `${model.id} accepts at most ${model.imageInput.maxImages} reference images`,
      }
    }
  }

  if (!model.presets.some(preset => preset.tiers.some(tier => tier.width === width && tier.height === height))) {
    return { ok: false, code: 'size-not-offered', error: `${width}x${height} is not an offered size for ${model.id}` }
  }

  // Seed is validated against the model's own contract: a channel/model that
  // does not honour it must not accept one and then quietly drop it.
  const seedRaw = body?.seed
  let seed
  if (seedRaw !== undefined && seedRaw !== null && seedRaw !== '') {
    const numeric = Number(seedRaw)
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 4294967295) {
      return { ok: false, code: 'seed-invalid', error: 'seed must be an integer in 0..4294967295' }
    }
    if (model.seed?.supported !== true) {
      return { ok: false, code: 'seed-unsupported', error: `${model.id} does not accept a seed` }
    }
    seed = numeric
  }

  // Advanced parameters are filtered by the model's own descriptor list, so a
  // parameter the module does not accept can never reach the child.
  const params = {}
  const rawParams = body?.params !== null && typeof body?.params === 'object' && !Array.isArray(body?.params)
    ? body.params
    : {}
  for (const [key, raw] of Object.entries(rawParams)) {
    const descriptor = model.params.find(entry => entry.key === key)
    if (descriptor === undefined) continue
    const coerced = paramValue(descriptor, raw)
    if (coerced.ok !== true) return coerced
    if (coerced.value !== undefined) params[key] = coerced.value
  }
  // A parameter the model does not accept is dropped above, which is right for
  // the request but wrong to do silently: the user set a knob and would see it
  // ignored. Only the keys that survived are compared, so an unrelated extra
  // field is still tolerated.
  const requestedKeys = Object.keys(rawParams).filter(key => rawParams[key] !== undefined && rawParams[key] !== '')
  const dropped = requestedKeys.filter(key => model.params.every(descriptor => descriptor.key !== key))
  if (dropped.length > 0) {
    return {
      ok: false,
      code: 'param-unsupported',
      error: `${model.id} does not accept ${dropped.join(', ')}`,
    }
  }
  // A model id names one provider's deployment, and the module's chain passes
  // one kwargs set to every backend. A non-default pick therefore runs that
  // channel alone; the default pick keeps the chain, where each backend falls
  // back to its own documented default model.
  const pinned = model.id !== channel.defaultModel
  // Three facts force a single backend, because each of them is meaningless once
  // the request hops to another provider:
  //   - a non-default model id belongs to exactly one deployment;
  //   - a reference image only exists on one provider's edit endpoint;
  //   - a seed and the advanced knobs are per-signature, and generate() filters
  //     kwargs per backend, so a chain would apply them to the wrong provider.
  const runAlone = body?.onlyChannel === true
    || pinned
    || images.length > 0
    || seed !== undefined
    || Object.keys(params).length > 0
  const backends = resolveBackends(channelId, runAlone, capabilities.defaultOrder)
  // The prompt ceiling is a property of the providers this run can reach, so it
  // is checked here rather than up front against one global number.
  const longEnough = checkPromptLength(prompt, backends, backends.length === 1 ? model.id : null, capabilities.channels)
  if (longEnough.ok !== true) return longEnough
  return {
    ok: true,
    request: {
      channelId,
      backends,
      modelPinned: (pinned || images.length > 0) && backends.length === 1,
      // Only a single-backend request may carry the model; a chain would hand
      // it to a backend that does not know this id.
      model: backends.length === 1 ? model.id : null,
      prompt,
      width,
      height,
      images: images.length > 0 ? images : undefined,
      seed: seed ?? undefined,
      params: Object.keys(params).length > 0 ? params : undefined,
    },
  }
}
