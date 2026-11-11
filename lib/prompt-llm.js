/**
 * One-shot model calls for the prompt assistants.
 *
 * Polish and expand each need exactly one text completion: no history, no
 * tools, no conversation. This module owns that call so both share one route
 * resolution, one timeout, one cancellation path and one failure vocabulary.
 *
 * Two things here are deliberate:
 *
 *   - The route comes from `agentDefaultModel.currentSelection()`, so the plugin
 *     uses whatever model the deployment already configured instead of
 *     hardcoding a provider or spending on a second one. A configured override
 *     wins, so a user who wants a cheaper or better model can name it.
 *   - Dispatch goes through `prepareCall().stream()` when the runtime offers it,
 *     with `llm.stream()` only as the fallback. `llm.stream` is a mutable
 *     instance property any plugin may replace with a waterfall listener; calling
 *     it directly is how a third-party provider plugin once broke every caller.
 *
 * @module dsh-image-workbench/lib/prompt-llm
 */

import { collectText, cleanReply, PROMPT_LIMIT } from './prompt-assist.js'

/** Wall-clock ceiling for one assistant call. */
export const ASSIST_TIMEOUT_MS = 60_000

/** Output ceiling: a prompt is short, and a runaway reply must not cost more. */
export const ASSIST_MAX_TOKENS = 1200

/**
 * Split a `provider/model` route.
 *
 * A model id may itself contain slashes (`Qwen/Qwen-Image`), so the split is on
 * the FIRST slash only: everything after it is the model id.
 * @param route - configured route, or a bare model id.
 * @returns the split route, or undefined when it names no provider and model.
 */
export function splitRoute(route) {
  if (typeof route !== 'string') return undefined
  const trimmed = route.trim()
  if (trimmed === '') return undefined
  const slash = trimmed.indexOf('/')
  if (slash <= 0 || slash === trimmed.length - 1) return undefined
  return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) }
}

/**
 * Resolve the route one assistant call should use.
 *
 * @param ctx - host context, for the optional services.
 * @param override - configured `provider/model` route, when the user set one.
 * @returns `{ ok: true, route }` or `{ ok: false, code, error }` explaining why
 *   no model is available, which the page turns into a hidden button.
 */
export function resolveAssistRoute(ctx, override) {
  if (typeof override === 'string' && override.trim() !== '') {
    const explicit = splitRoute(override)
    if (explicit === undefined) {
      return { ok: false, code: 'model-route-invalid', error: `the configured model route "${override}" is not provider/model` }
    }
    return { ok: true, route: explicit, source: 'configured' }
  }
  let selection
  try {
    selection = ctx.get('agentDefaultModel')?.currentSelection()
  } catch {
    selection = undefined
  }
  if (selection === undefined || selection === null
    || typeof selection.provider !== 'string' || typeof selection.model !== 'string') {
    return { ok: false, code: 'model-unavailable', error: 'this deployment configures no default model' }
  }
  return {
    ok: true,
    route: { provider: selection.provider, model: selection.model },
    source: 'default',
  }
}

/** The subset of the llm service this module uses. */
function llmRuntime(ctx) {
  try {
    const llm = ctx.get('llm')
    return llm !== undefined && typeof llm.stream === 'function' ? llm : undefined
  } catch {
    return undefined
  }
}

/**
 * Run one assistant call.
 *
 * @param ctx - host context.
 * @param options - instruction, user text and the configured route override.
 * @returns `{ ok: true, text, route }` or `{ ok: false, code, error }`.
 */
export async function runAssist(ctx, { operation, instruction, text, routeOverride }) {
  const llm = llmRuntime(ctx)
  if (llm === undefined) {
    return { ok: false, code: 'llm-unavailable', error: 'this deployment mounts no llm service' }
  }
  const resolved = resolveAssistRoute(ctx, routeOverride)
  if (resolved.ok !== true) return resolved

  const body = String(text ?? '').trim()
  if (body === '') return { ok: false, code: 'text-empty', error: 'nothing to work with' }
  // An over-long prompt is refused, not sliced: half a prompt is a different
  // request, and the caller reports the real reason to the user.
  if (body.length > PROMPT_LIMIT) {
    return {
      ok: false,
      code: 'text-too-long',
      error: `the prompt is ${body.length} characters; the limit is ${PROMPT_LIMIT}`,
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ASSIST_TIMEOUT_MS)
  try {
    const config = {
      provider: resolved.route.provider,
      model: resolved.route.model,
      temperature: 0.4,
      maxTokens: ASSIST_MAX_TOKENS,
    }
    const request = {
      system: instruction,
      messages: [{ role: 'user', content: [{ type: 'text', text: body }] }],
      signal: controller.signal,
    }
    let stream
    if (typeof llm.prepareCall === 'function') {
      const prepared = await llm.prepareCall(config, controller.signal)
      stream = prepared.stream({ ...prepared.config, ...request })
    } else {
      stream = llm.stream({ ...config, ...request })
    }
    const reply = cleanReply(await collectText(stream))
    if (reply === '') return { ok: false, code: 'empty-reply', error: 'the model returned no text' }
    return { ok: true, text: reply, operation, route: resolved.route, routeSource: resolved.source }
  } catch (error) {
    const aborted = controller.signal.aborted
    const code = aborted ? 'timeout' : (error?.code ?? error?.name ?? 'model-error')
    return {
      ok: false,
      code: String(code),
      error: aborted
        ? `the model did not answer within ${ASSIST_TIMEOUT_MS / 1000}s`
        : `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}
