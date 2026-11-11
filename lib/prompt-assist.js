/**
 * Prompt assistance for the image workbench: translate, polish, and expand.
 *
 * Three separate operations, because they answer three different questions and
 * mixing them would make each one lie about what it did:
 *
 *   translate — say the same thing in English. Faithful, no rewriting, no
 *               invented detail. This exists because Pollinations silently
 *               returns an unrelated image for a CJK prompt, and ModelScope
 *               recommends English.
 *   polish    — keep the user's intent and add the *vocabulary* a diffusion
 *               model responds to (lighting, lens, material, composition),
 *               without changing what is depicted.
 *   expand    — turn a short idea into a fuller scene description. This one is
 *               allowed to invent detail, which is exactly why it is not the
 *               same button as polish.
 *
 * Translation runs on the Host's anonymous `translator` service (Bing/Google,
 * no key, no cost). Polish and expand need a language model, so they go through
 * the standard `llm` service with the deployment's configured route; a
 * deployment without one still gets translation and is told why the other two
 * are missing rather than being offered a button that always fails.
 *
 * @module dsh-image-workbench/lib/prompt-assist
 */

/** Longest text any operation accepts, matching the form's own prompt limit. */
export const PROMPT_LIMIT = 4000

/** Languages the form offers to translate into. */
export const TARGET_LANGUAGES = Object.freeze([
  { id: 'en', label: { zh: '英文', en: 'English' } },
  { id: 'zh', label: { zh: '中文', en: 'Chinese' } },
])

/**
 * Per-operation instructions.
 *
 * Each prompt states the invariant the operation must not break, because a
 * model handed "make this better" will happily change the subject: polish is
 * told not to alter content, and translate is told not to embellish. The reply
 * is required to be bare text so the caller never has to strip prose framing.
 */
const INSTRUCTIONS = Object.freeze({
  translate: [
    'You translate an image-generation prompt.',
    'Return only the translation, with no quotes, labels, or commentary.',
    'Translate faithfully: do not add, remove, explain, or embellish any detail.',
    'Keep established prompt conventions and their commas as written.',
  ].join('\n'),
  polish: [
    'You refine an image-generation prompt without changing what it depicts.',
    'Return only the refined prompt, with no quotes, labels, or commentary.',
    'Keep the subject, count, pose, colours and setting exactly as given;',
    'you may only enrich the rendering vocabulary: lighting, lens, depth of field,',
    'material, composition, and finish. Never invent a new subject or object.',
    'Write one comma-separated prompt, not sentences. Stay under 900 characters.',
  ].join('\n'),
  expand: [
    'You expand a short idea into a fuller image-generation prompt.',
    'Return only the expanded prompt, with no quotes, labels, or commentary.',
    'Keep the original idea recognisable and put it first; then develop it with',
    'plausible, concrete visual detail: setting, time of day, lighting, framing,',
    'materials, and mood. Invent detail where it helps, but stay consistent.',
    'Write one comma-separated prompt, not sentences. Stay under 1200 characters.',
  ].join('\n'),
})

/** Whether a string is one of the operations this module implements. */
export function isOperation(value) {
  return typeof value === 'string' && Object.hasOwn(INSTRUCTIONS, value)
}

/** The instruction text for one operation. */
export function instructionOf(operation) {
  return INSTRUCTIONS[operation]
}

/**
 * Trim and reject an empty prompt.
 *
 * Deliberately does NOT truncate: silently dropping the tail of someone's prompt
 * would send a different request than they wrote, and the page could not tell.
 * An over-long prompt is reported instead, so the user trims it themselves.
 * @param value - untrusted input.
 * @returns the trimmed prompt, or undefined when there is nothing usable.
 */
export function normalizeText(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  return trimmed
}

/**
 * Join a model's streamed text chunks into one reply.
 *
 * Only `text-delta` contributes: a reasoning block is the model thinking, not
 * the answer, and concatenating it would silently prefix the prompt with the
 * model's own deliberation.
 * @param stream - chunk stream from the llm service.
 * @returns the accumulated text.
 */
export async function collectText(stream) {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
  }
  return text
}

/**
 * Clean one model reply into a pasteable prompt.
 *
 * Models wrap answers in quotes, prepend "Sure, here is", or fence them in
 * backticks even when told not to. Stripping the common shapes here keeps the
 * form free of that cleanup and makes a misbehaving model a cosmetic problem
 * rather than a broken result.
 * @param raw - the model's reply.
 * @returns the cleaned single-line prompt.
 */
export function cleanReply(raw) {
  let text = String(raw ?? '').trim()
  if (text === '') return ''
  // A fenced block: keep only the first fence's body.
  const fenced = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/.exec(text)
  if (fenced !== null) text = fenced[1].trim()
  // A leading or trailing sentence of framing around one block of text. A model
  // often stacks two of them ("Sure, here is the refined prompt:"), so the strip
  // repeats until the text stops changing instead of leaving the second one.
  const FRAMING = /^(?:sure[,!]?\s*|certainly[,!]?\s*|of course[,!]?\s*|here(?:'s| is)\s+(?:the|a|an)\s+[^:\n]*:\s*|(?:the\s+)?(?:refined|translated|expanded)?\s*prompt\s*:\s*)/i
  for (let guard = 0; guard < 4; guard += 1) {
    const next = text.replace(FRAMING, '')
    if (next === text) break
    text = next
  }
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
  // One prompt is one line; collapse the wrapping a model likes to add.
  text = text.replace(/\r/g, '').replace(/\n{2,}/g, '\n').trim()
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length > 1) {
    // Several lines: treat it as one prompt so the form box stays usable.
    text = lines.join(', ')
  }
  return text.trim()
}

/**
 * Translate one prompt through the Host's anonymous translation service.
 *
 * The service is optional: a deployment without it returns `unsupported` and
 * the page hides the button instead of offering a broken one.
 * @param translator - `ctx.translator`, or undefined.
 * @param text - the prompt to translate.
 * @param targetLanguage - destination language id.
 * @returns `{ ok: true, text }` or `{ ok: false, code, error }`.
 */
export async function translatePrompt(translator, text, targetLanguage) {
  if (translator === undefined) {
    return { ok: false, code: 'translator-unavailable', error: 'this deployment mounts no translator service' }
  }
  const target = TARGET_LANGUAGES.some(entry => entry.id === targetLanguage) ? targetLanguage : 'en'
  try {
    // `resolve` validates the length limit before any network call, which is
    // the cheapest place to catch an over-long prompt.
    const spec = translator.resolve({ text, targetLanguage: target })
    const translated = await translator.translate(spec)
    const cleaned = String(translated ?? '').trim()
    if (cleaned === '') return { ok: false, code: 'empty-reply', error: 'the translator returned nothing' }
    return { ok: true, text: cleaned }
  } catch (error) {
    const code = error?.code ?? error?.name ?? 'translate-failed'
    return { ok: false, code: String(code), error: `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}` }
  }
}

/**
 * True when the text is too long for the translation service to accept.
 *
 * The translator enforces its own `maxTextChars` (default 4000 UTF-16 units),
 * and a CJK prompt near the form limit expands past that in English. Checking
 * here lets the page say "too long, trim it" instead of surfacing a service
 * error the user cannot act on.
 * @param translator - the service, or undefined.
 * @param text - candidate prompt.
 * @returns whether the service would refuse it.
 */
export function exceedsTranslationLimit(translator, text) {
  const limit = Number(translator?.maxTextChars)
  if (!Number.isFinite(limit) || limit <= 0) return false
  return text.length > limit
}
