/**
 * Host half of the image workbench.
 *
 * Everything that touches an image provider happens here, in a `python3`
 * subprocess running the image-gen-hub skill script, so the browser never
 * calls a generation API and inherits the module's fallback chain, per-channel
 * size validation, artifact naming and `.meta.json` sidecar unchanged.
 *
 * Routes (all loopback-only):
 *   GET  /capabilities                 channel/model/size/seed/param matrix
 *   GET  /jobs                         every retained job, newest first
 *   GET  /job?id=... | ?latest=1       one job, or the newest one persisted
 *   GET  /gallery                      history read from the workspace
 *   GET  /artifact?name=...            one image, sidecar or preset thumbnail
 *   GET  /library                      prompt presets (built-in set + user's own)
 *   GET  /trash                        deleted artifacts awaiting restore
 *   POST /generate                     start one run or a batch
 *   POST /cancel                       cancel one or more jobs (queued or running)
 *   POST /jobs/clear-finished          forget settled job records (files untouched)
 *   POST /delete                       move artifacts to the trash
 *   POST /restore                      move artifacts back out of the trash
 *   POST /purge-trash                  permanently delete everything in the trash
 *   POST /library                      create or update one user preset
 *   POST /library/delete               remove one user preset
 *   POST /settings                     store the user concurrency cap or assistant model
 *   POST /assist                       translate, polish or expand one prompt
 *
 * Concurrency is per channel, not global. Each declaration carries the number
 * of simultaneous requests its provider tolerates (`capabilities.channels[].concurrency`),
 * and the scheduler hands out permits per channel: a job may start only when
 * its channel has a free permit and the user's own cap is not reached. A job
 * that cannot start waits in a FIFO queue instead of being refused, which is
 * what makes a batch of eight possible at all.
 *
 * @module dsh-image-workbench
 */

import { spawn } from 'node:child_process'
import { createReadStream, existsSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCapabilities, validateGeneration } from './lib/capabilities.js'
import {
  PROMPT_LIMIT,
  TARGET_LANGUAGES,
  exceedsTranslationLimit,
  instructionOf,
  isOperation,
  normalizeText,
  translatePrompt,
} from './lib/prompt-assist.js'
import { runAssist, resolveAssistRoute } from './lib/prompt-llm.js'

export const inject = ['webServer']

/** Route prefix of this plugin's host API (server side, absolute). */
const API_PREFIX = '/api/dsh-image-workbench'

/**
 * The same prefix without a leading slash: artifact URLs travel to the browser,
 * where the document's `<base href="./">` makes them resolve inside a sub-path
 * deployment instead of escaping to the origin root.
 */
const API_URL = 'api/dsh-image-workbench'

/** Fixed global artifact directory; the gallery reads history from here. */
const WORKSPACE_DIR = path.join(homedir(), '.dsh', 'image-gen-workspace')

/**
 * Where generated images and their `.meta.json` sidecars land: the fixed global
 * workspace itself, so the module's own naming and the gallery's history agree.
 */
const OUT_DIR = WORKSPACE_DIR

/** Temporary request/result files handed to the bridge script. */
const JOB_DIR = path.join(WORKSPACE_DIR, 'jobs')

/** Deleted artifacts wait here until purged or restored. */
const TRASH_DIR = path.join(WORKSPACE_DIR, '.trash')

/** Imported or generated preset thumbnails live here. */
const LIBRARY_DIR = path.join(WORKSPACE_DIR, 'library')

/** The user's own prompt presets, alongside the built-in placeholder set. */
const LIBRARY_FILE = path.join(WORKSPACE_DIR, 'library.json')

/** Small persisted preferences (currently the user concurrency cap). */
const SETTINGS_FILE = path.join(WORKSPACE_DIR, 'settings.json')

/** Absolute directory of this package, used to locate the bundled backend. */
const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * Where the image-gen-hub Python module lives.
 *
 * Nothing here is a personal path: the environment variable wins, otherwise the
 * conventional per-user skill location is derived from the current home
 * directory, so a fresh install works without editing this package. Point
 * `IMAGE_GEN_HUB_SCRIPTS` at a checkout kept somewhere else.
 */
const MODULE_DIR = process.env.IMAGE_GEN_HUB_SCRIPTS
  // The backend ships inside this package, so a fresh clone runs without
  // installing the skill separately. A per-user skill install still wins when
  // the bundled copy is absent, and the environment variable overrides both.
  || firstExisting([
    path.join(PACKAGE_DIR, 'backend'),
    path.join(homedir(), '.dsh', 'skills', 'image-gen-hub', 'scripts'),
  ])

/**
 * The first candidate that exists, or the first one when none do.
 *
 * Returning the first candidate on a total miss keeps the error message useful:
 * the caller reports "not found: <the path we expected>" instead of an empty
 * string that explains nothing.
 * @param candidates - absolute paths, highest priority first.
 * @returns one of the candidates.
 */
function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'free_image_gen.py'))) return candidate
  }
  return candidates[0] ?? ''
}

/** Bridge script shipped inside this package. */
const BRIDGE = path.join(PACKAGE_DIR, 'scripts', 'image_gen_bridge.py')

/** Interpreter the Host routes through. */
const PYTHON = process.env.IMAGE_GEN_PYTHON || 'python3'

/** Wall-clock ceiling for one generation, matching the module's own polling timeout floor. */
const GENERATION_TIMEOUT_MS = 15 * 60_000

/** Ceiling for a capabilities probe (imports the module and reports booleans). */
const PROBE_TIMEOUT_MS = 20_000

/** Image file extensions the gallery recognises. */
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

/** How long a finished job is retained in memory for status reads. */
const JOB_RETENTION_MS = 6 * 60 * 60_000

/** Consecutive jobs retained at most. */
const JOB_HISTORY_LIMIT = 200

/** Most requests one batch may carry. */
const MAX_BATCH = 12

/** Most presets a user may keep. */
const MAX_USER_PRESETS = 400

/** Suffix the workbench writes beside each artifact to make it replayable. */
const WORKBENCH_SUFFIX = '.workbench.json'

/**
 * The one job record kept on disk. Job records live in memory, so a page that
 * remounts — or a Host that restarts — would otherwise lose a run that already
 * produced a file, and the user would see neither a result nor an error.
 */
const LAST_JOB_FILE = 'last-job.json'

/** Monotonic job id source. */
let jobCounter = 0

/** Monotonic batch id source. */
let batchCounter = 0

/**
 * Run one Python invocation and collect its bounded stdout/stderr.
 * @param argv - full argument vector, `argv[0]` included.
 * @param timeoutMs - wall-clock ceiling; the child is killed past it.
 * @returns exit code and captured text.
 */
function runPython(argv, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: OUT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 64_000) stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 64_000) stderr += String(chunk)
    })
    child.on('error', (error) => finish({ code: null, stdout, stderr: `${stderr}${String(error)}`, spawnError: true }))
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut: false }))
  })
}

/**
 * Ensure the artifact workspace exists. Every path that spawns the child needs
 * it: the child's working directory is the artifact directory. Activation
 * itself creates nothing, so installing the plugin never writes to the home
 * directory before its first use.
 * @returns nothing; a failure surfaces from the spawn or the route.
 */
async function ensureWorkspace() {
  await mkdir(OUT_DIR, { recursive: true })
  await mkdir(JOB_DIR, { recursive: true })
  await mkdir(TRASH_DIR, { recursive: true })
  await mkdir(LIBRARY_DIR, { recursive: true })
}

/** Read a JSON file, or undefined when it is missing or malformed. */
function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/** Write a JSON file atomically, creating its directory. */
async function writeJsonFile(file, value) {
  const directory = path.dirname(file)
  await mkdir(directory, { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await rm(file, { force: true })
  renameSync(tmp, file)
}

/** Assert that a resolved path stays inside the artifact workspace. */
function insideWorkspace(candidate) {
  const resolved = path.resolve(candidate)
  const root = path.resolve(WORKSPACE_DIR)
  return resolved === root || resolved.startsWith(root + path.sep)
}

/** Send a JSON body with no-store caching. */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  })
  res.end(payload)
}

/**
 * Loopback trust fence: a request is served only when it reached this process
 * over the loopback interface with a loopback Host header. Forwarding headers
 * disqualify a request, because a proxy makes both facts describe the proxy.
 * @param req - incoming request.
 * @returns whether the request is local.
 */
export function isLoopbackRequest(req) {
  const address = req.socket.remoteAddress ?? ''
  const normalized = address.toLowerCase()
  const localAddress = normalized === '::1'
    || normalized.startsWith('::ffff:127.')
    || /^127\./.test(normalized)
  if (!localAddress) return false
  if (req.headers['x-forwarded-for'] !== undefined || req.headers['cf-connecting-ip'] !== undefined) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  if (hostname !== 'localhost' && hostname !== '[::1]' && !/^127\./.test(hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** Read at most `limit` bytes of a JSON request body; undefined when unusable. */
async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      req.destroy()
      return undefined
    }
    chunks.push(chunk)
  }
  if (size === 0) return undefined
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/**
 * Host-side workbench state: cached capabilities, the job queue, per-channel
 * concurrency accounting, and the artifact/trash/library bookkeeping.
 */
class Workbench {
  /** @param ctx - host context owning the route registrations. */
  constructor(ctx) {
    this.ctx = ctx
    this.capabilities = undefined
    this.probeAt = 0
    this.jobs = new Map()
    /** Jobs waiting for a permit, in submission order. */
    this.queue = []
    /** channelId -> number of jobs currently running under that permit. */
    this.active = new Map()
    this.userConcurrency = 0
    /**
     * `provider/model` for the polish and expand calls; blank means "use the
     * deployment default". Stored, so a user who wants a cheaper model keeps
     * that choice across restarts.
     */
    this.assistModel = ''
    this.settingsLoaded = false
  }

  /** Refresh capabilities from the Python module, or reuse a recent answer. */
  async capabilitiesSnapshot(force = false) {
    const now = Date.now()
    if (!force && this.capabilities !== undefined && now - this.probeAt < 30_000) return this.capabilities
    await ensureWorkspace()
    const outcome = await runPython([PYTHON, BRIDGE, 'probe', MODULE_DIR], PROBE_TIMEOUT_MS)
    let probe
    let error = null
    try {
      probe = JSON.parse(outcome.stdout)
    } catch {
      probe = { ok: false, error: outcome.timedOut ? 'probe timed out' : (outcome.stderr || 'probe produced no JSON') }
      error = probe.error
    }
    this.capabilities = buildCapabilities({ probe, moduleDir: MODULE_DIR, error })
    this.probeAt = now
    return this.capabilities
  }

  /** Load the persisted settings once. */
  async loadSettings() {
    if (this.settingsLoaded) return
    this.settingsLoaded = true
    const stored = readJsonFile(SETTINGS_FILE)
    const value = Number(stored?.userConcurrency)
    this.userConcurrency = Number.isInteger(value) && value >= 1 ? Math.min(value, 3) : 0
    this.assistModel = typeof stored?.assistModel === 'string' ? stored.assistModel : ''
  }

  /** Persist the settings this workbench owns. */
  async saveSettings() {
    await writeJsonFile(SETTINGS_FILE, {
      userConcurrency: this.userConcurrency,
      assistModel: this.assistModel,
    })
  }

  /**
   * Describe which prompt assistants this deployment can actually run.
   *
   * The page hides a button rather than offering one that always fails, so this
   * reports capability per operation: translation only needs the translator
   * service, while polish and expand each need a resolvable model route.
   * @returns capability flags and the route the model calls would use.
   */
  assistCapabilities() {
    let translator = undefined
    try {
      translator = this.ctx.get('translator')
    } catch {
      translator = undefined
    }
    const translatorUsable = translator !== undefined
      && typeof translator.resolve === 'function'
      && typeof translator.translate === 'function'
    // Import lazily so this report never throws on a deployment without a model.
    const route = resolveAssistRoute(this.ctx, this.assistModel)
    // A route whose provider has no adapter cannot dispatch, so it must not be
    // reported as an available assistant.
    const routable = route.ok === true && this.providerRoutable(route.route.provider)
    return {
      translator: translatorUsable,
      model: routable,
      modelRoute: route.ok === true ? route.route : null,
      modelRouteSource: route.ok === true ? route.source : null,
      modelError: route.ok !== true
        ? route.error
        : (routable ? null : `no model adapter is registered for provider "${route.route.provider}"`),
      /** Provider ids this deployment can dispatch to, for the route picker. */
      providers: this.routableProviders(),
      /** The route used when no override is configured. */
      defaultRoute: this.defaultAssistRoute(),
      languages: TARGET_LANGUAGES,
      // The translator's own ceiling, so the page can warn before submitting.
      maxChars: Number(translator?.maxTextChars) || 4000,
    }
  }

  /**
   * Whether this deployment has an adapter for one provider route.
   *
   * An empty provider directory is treated as "cannot tell" rather than
   * "unavailable": a deployment that reports nothing must not hide a working
   * assistant.
   * @param provider - provider id from the resolved route.
   * @returns whether the route is dispatchable, or true when unknown.
   */
  providerRoutable(provider) {
    if (typeof provider !== 'string' || provider === '') return false
    let providers
    try {
      providers = this.ctx.get('llm')?.listProviders?.() ?? []
    } catch {
      return true
    }
    if (!Array.isArray(providers) || providers.length === 0) return true
    return providers.some(entry => entry?.id === provider)
  }

  /** Provider ids with a registered adapter, in registration order. */
  routableProviders() {
    try {
      const providers = this.ctx.get('llm')?.listProviders?.() ?? []
      return Array.isArray(providers)
        ? providers.map(entry => entry?.id).filter(id => typeof id === 'string' && id !== '')
        : []
    } catch {
      return []
    }
  }

  /** The deployment's default model route, ignoring any override. */
  defaultAssistRoute() {
    const resolved = resolveAssistRoute(this.ctx, '')
    return resolved.ok === true ? resolved.route : null
  }

  /** The channel whose permit a job consumes. */
  permitChannel(request) {
    if (request.channelId === 'auto') {
      const order = this.capabilities?.defaultOrder ?? []
      return order[0] ?? request.backends?.[0] ?? 'modelscope'
    }
    return request.channelId
  }

  /** How many simultaneous requests a channel tolerates, capped by the user. */
  permitLimit(channel) {
    const declared = this.capabilities?.limits?.channelPermits?.[channel] ?? 1
    const cap = this.userConcurrency > 0 ? this.userConcurrency : 3
    return Math.max(1, Math.min(declared, cap))
  }

  /** Jobs currently executing. */
  runningCount() {
    let total = 0
    for (const job of this.jobs.values()) if (job.status === 'running') total += 1
    return total
  }

  /**
   * Start as many queued jobs as the permits allow.
   *
   * Called after every submission and every settlement. It is deliberately not
   * re-entrant: a start schedules its own settlement callback, so a pump inside
   * a pump would double-count.
   */
  pump() {
    const cap = this.userConcurrency > 0 ? this.userConcurrency : 3
    for (const job of this.queue) {
      if (job.status !== 'queued') continue
      if (this.runningCount() >= cap) break
      const channel = this.permitChannel(job.request)
      const limit = this.permitLimit(channel)
      const used = this.active.get(channel) ?? 0
      if (used >= limit) continue
      job.status = 'running'
      job.startedAt = Date.now()
      job.updatedAt = job.startedAt
      this.active.set(channel, used + 1)
      void this.execute(job, channel)
    }
    this.queue = this.queue.filter(job => job.status === 'queued')
    this.refreshQueuePositions()
  }

  /** Keep each waiting job's 1-based position visible to the page. */
  refreshQueuePositions() {
    let position = 0
    for (const job of this.queue) {
      if (job.status !== 'queued') continue
      position += 1
      job.queuePosition = position
      job.updatedAt = Date.now()
    }
  }

  /** Read the artifact directory into gallery entries, newest first. */
  gallery() {
    if (!existsSync(OUT_DIR)) return []
    const names = readdirSync(OUT_DIR)
    const entries = []
    for (const name of names) {
      const extension = path.extname(name).toLowerCase()
      if (!IMAGE_EXTENSIONS.has(extension)) continue
      const file = path.join(OUT_DIR, name)
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      if (!stat.isFile()) continue
      const stem = name.slice(0, -extension.length)
      const metaName = `${stem}.meta.json`
      const workbenchName = `${stem}${WORKBENCH_SUFFIX}`
      const meta = readJsonFile(path.join(OUT_DIR, metaName))
      const recorded = readJsonFile(path.join(OUT_DIR, workbenchName))
      entries.push({
        file: name,
        metaFile: meta === undefined ? null : metaName,
        workbenchFile: recorded === undefined ? null : workbenchName,
        bytes: stat.size,
        modifiedAt: stat.mtimeMs,
        backend: meta?.backend ?? null,
        model: meta?.model ?? null,
        size: Array.isArray(meta?.size) ? meta.size : null,
        requestedSize: meta?.requested_size ?? null,
        savedAt: meta?.saved_at ?? null,
        billedTokens: meta?.billed_tokens ?? null,
        cost: meta?.cost ?? null,
        degraded: Array.isArray(meta?.degraded) ? meta.degraded : null,
        // Facts the module does not persist; recorded by the workbench itself.
        prompt: typeof recorded?.prompt === 'string' ? recorded.prompt : null,
        seed: Number.isInteger(recorded?.seed) ? recorded.seed : null,
        params: recorded?.params ?? null,
        channelId: typeof recorded?.channelId === 'string' ? recorded.channelId : null,
        imageUrl: `${API_URL}/artifact?name=${encodeURIComponent(name)}`,
        metaUrl: meta === undefined ? null : `${API_URL}/artifact?name=${encodeURIComponent(metaName)}`,
      })
    }
    entries.sort((left, right) => right.modifiedAt - left.modifiedAt)
    return entries
  }

  /** Drop finished records past the retention window and cap the history. */
  pruneJobs() {
    const now = Date.now()
    const settled = [...this.jobs.values()].filter(job => job.status !== 'running' && job.status !== 'queued')
    for (const job of settled) {
      if (now - job.updatedAt > JOB_RETENTION_MS) this.jobs.delete(job.id)
    }
    const remaining = [...this.jobs.values()].filter(job => job.status !== 'running' && job.status !== 'queued')
    if (remaining.length <= JOB_HISTORY_LIMIT) return
    remaining.sort((left, right) => left.updatedAt - right.updatedAt)
    for (const job of remaining.slice(0, remaining.length - JOB_HISTORY_LIMIT)) this.jobs.delete(job.id)
  }

  /**
   * Forget every settled job record, keeping the artifacts untouched.
   *
   * A page-side filter alone is not enough: the queue is a Host-owned list, so
   * the next poll (or the next submission) hands the record straight back and
   * the rows the user just cleared reappear. Deleting them here is what makes
   * "clear finished" mean the same thing on both sides. Running and queued jobs
   * are left alone — they are work, not history.
   *
   * Files are deliberately out of scope: artifacts, sidecars and the gallery
   * belong to the delete/trash flow, so this only drops the *display* record.
   * @returns the job ids that were forgotten.
   */
  forgetSettled() {
    const forgotten = []
    for (const [id, job] of this.jobs) {
      if (job.status === 'running' || job.status === 'queued') continue
      // A settled record must never take a live child with it, even if the
      // status lagged behind the process while the request was in flight.
      if (job.child !== null && job.child !== undefined) continue
      forgotten.push(id)
      this.jobs.delete(id)
    }
    // The persisted last-job record exists so a remounted page can re-adopt a
    // run it missed. Once its job is forgotten there is nothing to re-adopt, so
    // leaving it behind would resurrect the cleared row on the next remount.
    if (forgotten.length > 0) {
      const stored = readJsonFile(path.join(JOB_DIR, LAST_JOB_FILE))
      if (stored === null || forgotten.includes(stored.id)) {
        rm(path.join(JOB_DIR, LAST_JOB_FILE), { force: true }).catch(() => {})
      }
    }
    this.refreshQueuePositions()
    return forgotten
  }

  /** Write the persisted record of one job, best effort. */
  async persistLatest(job) {
    try {
      await ensureWorkspace()
      await writeJsonFile(path.join(JOB_DIR, LAST_JOB_FILE), this.jobView(job))
    } catch {
      // Persistence is a reporting aid; losing it must never fail a run.
    }
  }

  /**
   * The newest job this process knows, or the one left on disk by a previous
   * process. A record still marked `running` with no live child belongs to a
   * run that was interrupted, and is reported as such instead of as silence.
   * @returns a job view, or undefined when nothing was ever run.
   */
  latestJob() {
    const live = [...this.jobs.values()].sort((left, right) => right.createdAt - left.createdAt)[0]
    if (live !== undefined) return this.jobView(live)
    const stored = readJsonFile(path.join(JOB_DIR, LAST_JOB_FILE))
    if (stored === null || typeof stored !== 'object') return undefined
    if (stored.status === 'running' || stored.status === 'queued') {
      // Nothing is executing here: the previous Host died mid-run, and the
      // artifact may or may not have landed.
      return {
        ...stored,
        status: 'lost',
        error: 'the Host stopped while this run was executing; check the workspace before retrying',
      }
    }
    return stored
  }

  /** Public view of one job record. */
  jobView(job) {
    return {
      id: job.id,
      batchId: job.batchId ?? null,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      updatedAt: job.updatedAt,
      finishedAt: job.finishedAt ?? null,
      queuePosition: job.status === 'queued' ? (job.queuePosition ?? null) : null,
      request: job.request,
      result: job.result ?? null,
      error: job.error ?? null,
      log: job.log.slice(-40),
    }
  }

  /** Every retained job, newest first. */
  jobList() {
    return [...this.jobs.values()]
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, 60)
      .map(job => this.jobView(job))
  }

  /**
   * Enqueue one validated request.
   * @param request - validated request from the capability rules.
   * @param batchId - batch the job belongs to.
   * @returns the created job view.
   */
  enqueue(request, batchId) {
    jobCounter += 1
    const now = Date.now()
    const job = {
      id: `job-${now.toString(36)}-${jobCounter}`,
      batchId,
      status: 'queued',
      createdAt: now,
      startedAt: null,
      updatedAt: now,
      finishedAt: null,
      queuePosition: null,
      request,
      result: null,
      error: null,
      log: [],
      child: null,
      cancelled: false,
    }
    this.jobs.set(job.id, job)
    this.queue.push(job)
    this.pruneJobs()
    this.refreshQueuePositions()
    return this.jobView(job)
  }

  /**
   * Start a batch of validated requests.
   * @param requests - validated requests, already capped by the caller.
   * @returns the batch id and the created job views.
   */
  startBatch(requests) {
    batchCounter += 1
    const batchId = `batch-${Date.now().toString(36)}-${batchCounter}`
    const jobs = requests.map(request => this.enqueue(request, batchId))
    this.pump()
    return { batchId, jobs }
  }

  /** Run one job to settlement, always releasing its channel permit. */
  async execute(job, channel) {
    const requestFile = path.join(JOB_DIR, `${job.id}.request.json`)
    const resultFile = path.join(JOB_DIR, `${job.id}.result.json`)
    try {
      await ensureWorkspace()
      await writeFile(requestFile, JSON.stringify({
        prompt: job.request.prompt,
        width: job.request.width,
        height: job.request.height,
        backends: job.request.backends,
        model: job.request.model,
        images: job.request.images ?? null,
        seed: job.request.seed ?? null,
        params: job.request.params ?? null,
        outDir: OUT_DIR,
      }), 'utf8')

      // A cancel that arrived while the request file was being written must not
      // spend a real provider request: the run is abandoned before it starts.
      if (job.cancelled) return
      const argv = [PYTHON, BRIDGE, 'generate', requestFile, resultFile, MODULE_DIR]
      const outcome = await this.spawnTracked(job, argv, GENERATION_TIMEOUT_MS)
      const payload = readJsonFile(resultFile)
      if (payload === undefined) {
        job.status = 'failed'
        job.error = outcome.timedOut
          ? 'generation timed out'
          : (outcome.stderr?.trim().split('\n').slice(-3).join(' ') || 'generation produced no result')
      } else if (payload.ok === true) {
        job.status = 'done'
        const fileName = typeof payload.file === 'string' ? path.basename(payload.file) : null
        job.result = {
          backend: payload.backend ?? null,
          model: payload.model ?? null,
          size: payload.size ?? null,
          requestedSize: payload.requested_size ?? null,
          degraded: payload.degraded ?? null,
          cost: payload.cost ?? null,
          billedTokens: payload.billed_tokens ?? null,
          taskId: payload.task_id ?? null,
          fileName,
          imageUrl: fileName === null
            ? null
            : `${API_URL}/artifact?name=${encodeURIComponent(fileName)}`,
          metaUrl: typeof payload.meta_file === 'string'
            ? `${API_URL}/artifact?name=${encodeURIComponent(path.basename(payload.meta_file))}`
            : null,
        }
        await this.recordSidecar(fileName, job)
      } else {
        job.status = 'failed'
        const errors = Array.isArray(payload.errors) ? payload.errors : []
        job.error = payload.error ?? (errors.length > 0 ? errors.join(' · ') : 'generation failed')
      }
    } catch (error) {
      job.status = 'failed'
      job.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`
    } finally {
      // last-job.json is deliberately not in this list: it is what a
      // remounted page reads back.
      for (const file of [requestFile, resultFile]) {
        // Both files are plain scratch; leaving them behind would grow the
        // workspace without ever being read again.
        await rm(file, { force: true }).catch(() => {})
      }
      // A cancel the user asked for always wins over whatever the process
      // reported as it died.
      if (job.cancelled) {
        job.status = 'cancelled'
        job.result = null
        job.error = null
      }
      job.child = null
      job.finishedAt = Date.now()
      job.updatedAt = job.finishedAt
      const used = this.active.get(channel) ?? 1
      if (used <= 1) this.active.delete(channel)
      else this.active.set(channel, used - 1)
      void this.persistLatest(job)
      // A settled job frees a permit, so the queue may be able to advance.
      this.pump()
    }
  }

  /**
   * Record what the module does not: the prompt, seed and knobs that produced
   * one artifact, so the gallery can replay it and the form can refill itself.
   * @param fileName - the artifact base name, or null when nothing landed.
   * @param job - the settled job.
   */
  async recordSidecar(fileName, job) {
    if (fileName === null) return
    const extension = path.extname(fileName)
    const stem = fileName.slice(0, -extension.length)
    try {
      await writeJsonFile(path.join(OUT_DIR, `${stem}${WORKBENCH_SUFFIX}`), {
        recordedAt: new Date().toISOString(),
        channelId: job.request.channelId,
        backends: job.request.backends,
        model: job.request.model,
        width: job.request.width,
        height: job.request.height,
        prompt: job.request.prompt,
        seed: job.request.seed ?? null,
        params: job.request.params ?? null,
        imageCount: Array.isArray(job.request.images) ? job.request.images.length : 0,
        jobId: job.id,
        batchId: job.batchId ?? null,
      })
    } catch {
      // A missing sidecar only costs replayability; it must not fail the run.
    }
  }

  /** Spawn the generation child, tee its output into the job log, and settle it. */
  spawnTracked(job, argv, timeoutMs) {
    return new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: OUT_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
      job.child = child
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        job.log.push('timeout: killing the generation process')
        child.kill('SIGKILL')
        finish({ timedOut: true })
      }, timeoutMs)
      const append = (chunk) => {
        for (const line of String(chunk).split('\n')) {
          const trimmed = line.trim()
          if (trimmed === '') continue
          job.log.push(trimmed)
          if (job.log.length > 200) job.log.splice(0, job.log.length - 200)
        }
        job.updatedAt = Date.now()
      }
      // stderr carries the module's per-backend fallback narration, which is
      // the only progress signal a caller gets from a long poll loop.
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.on('error', (error) => {
        job.log.push(`spawn error: ${String(error)}`)
        finish({ spawnError: true, stderr: String(error) })
      })
      child.on('close', (code) => finish({ code, timedOut: false }))
    })
  }

  /**
   * Cancel one job, queued or running.
   *
   * A running job's permit is released by the child's own settlement, never
   * here: a kill only asks the process to stop, and starting a replacement
   * before the first one is really gone would break the per-channel guarantee.
   * @param id - job id.
   * @returns whether anything was cancelled.
   */
  cancel(id) {
    const job = this.jobs.get(id)
    if (job === undefined) return { ok: false, code: 'not-found', error: 'no such job' }
    if (job.status === 'queued') {
      job.cancelled = true
      job.status = 'cancelled'
      job.error = null
      job.finishedAt = Date.now()
      job.updatedAt = job.finishedAt
      this.queue = this.queue.filter(entry => entry !== job)
      this.refreshQueuePositions()
      return { ok: true, id, was: 'queued' }
    }
    if (job.status !== 'running') return { ok: false, code: 'not-running', error: `${id} already ${job.status}` }
    job.cancelled = true
    job.log.push('cancelled by user')
    // SIGKILL: the work is being discarded, so a graceful drain buys nothing
    // and a module blocked in a poll loop may ignore the polite signal.
    try {
      job.child?.kill('SIGKILL')
    } catch {
      // The process already exited; settlement still reports the cancel.
    }
    job.updatedAt = Date.now()
    return { ok: true, id, was: 'running' }
  }

  /** Point one artifact read at `name`, or undefined when it is not a safe artifact. */
  artifactPath(name) {
    if (typeof name !== 'string' || name === '' || name !== path.basename(name)) return undefined
    const candidate = path.join(OUT_DIR, name)
    if (!insideWorkspace(candidate)) return undefined
    const inside = (root) => {
      const resolved = path.resolve(candidate)
      const base = path.resolve(root)
      return resolved === base || resolved.startsWith(base + path.sep)
    }
    const extension = path.extname(name).toLowerCase()
    const allowed = IMAGE_EXTENSIONS.has(extension) || extension === '.json'
    if (!allowed) return undefined
    // Gallery artifacts sit in the workspace root; a preset thumbnail sits in
    // `library/`. Both are inside the workspace, neither can escape it.
    const isLibrary = inside(LIBRARY_DIR) && path.dirname(path.resolve(candidate)) !== path.resolve(OUT_DIR)
    if (!isLibrary && !inside(OUT_DIR)) return undefined
    if (!existsSync(candidate)) return undefined
    return candidate
  }

  /** Move one artifact and its sidecars into the trash. */
  async deleteArtifact(name) {
    const source = path.join(OUT_DIR, name)
    if (!insideWorkspace(source) || !existsSync(source)) {
      return { ok: false, code: 'missing', error: `${name} is not in the workspace` }
    }
    let bytes = null
    try {
      bytes = statSync(source).size
    } catch {
      // A file that vanished between the check and the stat is still movable by
      // the loop below; the size is only used for reporting.
    }
    const extension = path.extname(name)
    const stem = name.slice(0, -extension.length)
    const related = [name, `${stem}.meta.json`, `${stem}${WORKBENCH_SUFFIX}`]
      .filter(candidate => existsSync(path.join(OUT_DIR, candidate)))
    await mkdir(TRASH_DIR, { recursive: true })
    const manifestFile = path.join(TRASH_DIR, 'manifest.json')
    const manifest = readJsonFile(manifestFile) ?? { entries: [] }
    const entry = {
      id: `trash-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      files: [],
      deletedAt: new Date().toISOString(),
      image: name,
      bytes,
    }
    for (const candidate of related) {
      // A collision can only happen after a restore-and-delete cycle; a numeric
      // suffix keeps both copies instead of overwriting the older one.
      let target = path.join(TRASH_DIR, candidate)
      let suffix = 0
      while (existsSync(target)) {
        suffix += 1
        target = path.join(TRASH_DIR, `${stem}-${suffix}${candidate.slice(stem.length)}`)
      }
      renameSync(path.join(OUT_DIR, candidate), target)
      entry.files.push({ from: candidate, to: path.basename(target) })
    }
    manifest.entries.unshift(entry)
    await writeJsonFile(manifestFile, manifest)
    return { ok: true, entry }
  }

  /** Every trash entry with its size, newest first. */
  trash() {
    const manifest = readJsonFile(path.join(TRASH_DIR, 'manifest.json'))
    const entries = Array.isArray(manifest?.entries) ? manifest.entries : []
    return entries.map((entry) => {
      const image = entry.files?.find(file => IMAGE_EXTENSIONS.has(path.extname(file.to).toLowerCase()))
      const stat = image === undefined ? undefined : (() => {
        try {
          return statSync(path.join(TRASH_DIR, image.to))
        } catch {
          return undefined
        }
      })()
      return {
        id: entry.id,
        image: entry.image,
        deletedAt: entry.deletedAt,
        bytes: stat?.size ?? null,
        // The trash is served through the same artifact route, keyed by the
        // trash-local name.
        imageUrl: image === undefined ? null : `${API_URL}/trash-artifact?name=${encodeURIComponent(image.to)}`,
        files: (entry.files ?? []).map(file => file.to),
      }
    })
  }

  /** Move one trash entry back into the workspace. */
  async restore(id) {
    const manifestFile = path.join(TRASH_DIR, 'manifest.json')
    const manifest = readJsonFile(manifestFile) ?? { entries: [] }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : []
    const entry = entries.find(candidate => candidate.id === id)
    if (entry === undefined) return { ok: false, code: 'missing', error: 'no such trash entry' }
    const restored = []
    for (const file of entry.files ?? []) {
      const source = path.join(TRASH_DIR, file.to)
      if (!existsSync(source)) continue
      let target = path.join(OUT_DIR, file.from)
      let suffix = 0
      while (existsSync(target)) {
        suffix += 1
        const extension = path.extname(file.from)
        const stem = file.from.slice(0, -extension.length)
        target = path.join(OUT_DIR, `${stem}-${suffix}${extension}`)
      }
      renameSync(source, target)
      restored.push(path.basename(target))
    }
    manifest.entries = entries.filter(candidate => candidate.id !== id)
    await writeJsonFile(manifestFile, manifest)
    return { ok: true, restored }
  }

  /** Permanently delete everything in the trash. */
  async purgeTrash() {
    let removed = 0
    for (const name of existsSync(TRASH_DIR) ? readdirSync(TRASH_DIR) : []) {
      if (name === 'manifest.json') continue
      const file = path.join(TRASH_DIR, name)
      try {
        await rm(file, { recursive: true, force: true })
        removed += 1
      } catch {
        // A file another process holds stays; the manifest rewrite below keeps
        // the remaining entries addressable.
      }
    }
    await writeJsonFile(path.join(TRASH_DIR, 'manifest.json'), { entries: [] })
    return { ok: true, removed }
  }

  /** The user's own presets. */
  userPresets() {
    const stored = readJsonFile(LIBRARY_FILE)
    return Array.isArray(stored?.presets) ? stored.presets.filter(entry => entry !== null && typeof entry === 'object') : []
  }

  /** Persist the user's preset list. */
  async saveUserPresets(presets) {
    await writeJsonFile(LIBRARY_FILE, { version: 1, presets })
  }

  /**
   * The preset catalogue the page renders.
   *
   * The built-in half is deliberately a placeholder: the import pipeline is not
   * wired yet, so this reports its shape and readiness instead of inventing
   * entries the page would have to fake. The user half is fully functional —
   * create, edit, delete, and an example image that points at an existing
   * gallery artifact rather than at a copy.
   * @returns catalogue payload.
   */
  library() {
    return {
      ok: true,
      builtin: {
        // The framework is in place; the sources are not imported yet.
        ready: false,
        sourceCount: 0,
        styleCount: 0,
        sources: [
          {
            id: 'ai-visual-prompt-cookbook',
            label: 'AI Visual Prompt Cookbook',
            repo: 'VigoZhao/AI-Visual-Prompt-Cookbook',
            license: 'MIT',
            stars: 831,
            styles: 180,
            note: {
              zh: '结构化 style.json + 16:9 / 9:16 缩略图；导入后可用。原始面向 Gemini / GPT Image，转到本机渠道需调整。',
              en: 'Structured style.json plus 16:9 / 9:16 thumbnails. Authored for Gemini / GPT Image; a port needs adjustment.',
            },
            status: 'pending',
          },
        ],
      },
      presets: this.userPresets(),
    }
  }

  /** Kill every child still alive when the plugin unloads. */
  dispose() {
    for (const job of this.jobs.values()) {
      try {
        job.child?.kill('SIGKILL')
      } catch {
        // Nothing left to kill; unload must not fail on it.
      }
    }
    this.queue = []
    this.active.clear()
  }
}

/** Content type for one artifact extension. */
function contentTypeOf(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.json': return 'application/json; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

/** Answer one artifact read, or 404 when the name is not a safe artifact. */
function serveArtifact(workbench, res, name, resolver) {
  const file = resolver === undefined ? workbench.artifactPath(name) : resolver(name)
  if (file === undefined) {
    sendJson(res, 404, { ok: false, error: 'artifact not found' })
    return
  }
  res.writeHead(200, {
    'content-type': contentTypeOf(file),
    'cache-control': 'private, max-age=31536000, immutable',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(file).on('error', () => { res.destroy() }).pipe(res)
}

/**
 * Register the workbench's host routes.
 * @param ctx - host context with the web server.
 */
export function apply(ctx) {
  const workbench = new Workbench(ctx)
  ctx.effect(() => () => { workbench.dispose() }, 'image-workbench: child process')

  const guard = (req, res) => {
    if (isLoopbackRequest(req)) return true
    sendJson(res, 403, { ok: false, error: 'forbidden: loopback-only' })
    return false
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/capabilities`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('refresh') === '1'
      try {
        await workbench.loadSettings()
        const capabilities = await workbench.capabilitiesSnapshot(force)
        sendJson(res, 200, {
          ...capabilities,
          settings: {
            userConcurrency: workbench.userConcurrency,
            assistModel: workbench.assistModel,
          },
          assist: workbench.assistCapabilities(),
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: capabilities route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/settings`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      const body = await readJsonBody(req)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, error: 'a JSON body is required' })
        return
      }
      // Every field is optional and only what was sent changes: a page that
      // edits one setting must not reset the others.
      const next = {}
      if (body.userConcurrency !== undefined) {
        const raw = Number(body.userConcurrency)
        if (!Number.isInteger(raw) || raw < 1 || raw > 3) {
          sendJson(res, 400, { ok: false, error: 'userConcurrency must be an integer in 1..3' })
          return
        }
        next.userConcurrency = raw
      }
      if (body.assistModel !== undefined) {
        if (typeof body.assistModel !== 'string') {
          sendJson(res, 400, { ok: false, error: 'assistModel must be a string' })
          return
        }
        const trimmed = body.assistModel.trim()
        // A non-empty value must name a route; blank clears back to the default.
        if (trimmed !== '' && !trimmed.includes('/')) {
          sendJson(res, 400, { ok: false, error: 'assistModel must be provider/model, or blank for the deployment default' })
          return
        }
        // Refuse a provider this deployment cannot route to, now rather than on
        // the first polish call: saving a route that can never work would leave
        // the page reporting the assistant as available when it is not.
        if (trimmed !== '') {
          const provider = trimmed.slice(0, trimmed.indexOf('/'))
          const providers = typeof ctx.get === 'function'
            ? (() => {
                try {
                  return ctx.get('llm')?.listProviders?.() ?? []
                } catch {
                  return []
                }
              })()
            : []
          if (Array.isArray(providers) && providers.length > 0
            && !providers.some(entry => entry?.id === provider)) {
            sendJson(res, 400, {
              ok: false,
              code: 'provider-unknown',
              error: `no model adapter is registered for provider "${provider}"`,
              providers: providers.map(entry => entry?.id).filter(Boolean),
            })
            return
          }
        }
        next.assistModel = trimmed
      }
      if (Object.keys(next).length === 0) {
        sendJson(res, 400, { ok: false, error: 'nothing to update' })
        return
      }
      try {
        await workbench.loadSettings()
        if (next.userConcurrency !== undefined) workbench.userConcurrency = next.userConcurrency
        if (next.assistModel !== undefined) workbench.assistModel = next.assistModel
        await workbench.saveSettings()
        // Lowering the cap never evicts a running job; it only stops new ones.
        workbench.pump()
        sendJson(res, 200, {
          ok: true,
          settings: {
            userConcurrency: workbench.userConcurrency,
            assistModel: workbench.assistModel,
          },
          assist: workbench.assistCapabilities(),
        })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: settings route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/assist`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      const body = await readJsonBody(req)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, error: 'a JSON body is required' })
        return
      }
      const operation = typeof body.operation === 'string' ? body.operation : ''
      if (isOperation(operation) !== true) {
        sendJson(res, 400, {
          ok: false,
          code: 'operation-unknown',
          error: 'operation must be one of translate, polish, expand',
        })
        return
      }
      const text = normalizeText(body.text)
      if (text === undefined) {
        sendJson(res, 400, { ok: false, code: 'text-empty', error: 'text is required' })
        return
      }
      // Too long is refused, never truncated: a trimmed prompt would silently
      // become a different request than the one the user wrote.
      if (text.length > PROMPT_LIMIT) {
        sendJson(res, 400, {
          ok: false,
          code: 'text-too-long',
          error: `the prompt is ${text.length} characters; the limit is ${PROMPT_LIMIT}`,
        })
        return
      }
      try {
        await workbench.loadSettings()
        let translator
        try {
          translator = ctx.get('translator')
        } catch {
          translator = undefined
        }

        if (operation === 'translate') {
          const target = typeof body.targetLanguage === 'string' ? body.targetLanguage : 'en'
          // A prompt near the form limit expands past the translator's own
          // ceiling once translated; say so instead of surfacing its error.
          if (exceedsTranslationLimit(translator, text)) {
            sendJson(res, 400, {
              ok: false,
              code: 'text-too-long',
              error: `the prompt exceeds the translator limit of ${Number(translator?.maxTextChars) || 4000} characters`,
            })
            return
          }
          const outcome = await translatePrompt(translator, text, target)
          sendJson(res, outcome.ok === true ? 200 : 502, outcome)
          return
        }

        const outcome = await runAssist(ctx, {
          operation,
          instruction: instructionOf(operation),
          text,
          routeOverride: workbench.assistModel,
        })
        // A missing model is a deployment fact, not a failure of this request:
        // 501 tells the page to keep the button hidden rather than report an error.
        const status = outcome.ok === true
          ? 200
          : (outcome.code === 'llm-unavailable' || outcome.code === 'model-unavailable') ? 501 : 502
        sendJson(res, status, outcome)
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: assist route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/jobs`,
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET required' })
        return
      }
      sendJson(res, 200, {
        ok: true,
        jobs: workbench.jobList(),
        running: workbench.runningCount(),
        queued: workbench.queue.filter(job => job.status === 'queued').length,
        limits: workbench.capabilities?.limits ?? null,
        userConcurrency: workbench.userConcurrency,
      })
    },
  }), 'image-workbench: jobs route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/jobs/clear-finished`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      // Ids are optional and advisory: the point of the button is "drop all the
      // settled rows", so a caller that names a subset still gets a coherent
      // queue afterwards. Unknown ids are reported rather than refused, because
      // a stale page must be able to finish clearing.
      const body = await readJsonBody(req)
      const asked = Array.isArray(body?.ids)
        ? body.ids.filter(entry => typeof entry === 'string')
        : null
      const forgotten = workbench.forgetSettled()
      sendJson(res, 200, {
        ok: true,
        cleared: asked === null ? forgotten : forgotten.filter(id => asked.includes(id)),
        clearedAll: forgotten,
        removedFiles: 0,
      })
    },
  }), 'image-workbench: clear-finished route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/job`,
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET required' })
        return
      }
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
      if (query.get('latest') === '1') {
        // Re-adoption path: a remounted page asks what happened while it was
        // gone instead of silently showing an empty panel.
        sendJson(res, 200, { ok: true, job: workbench.latestJob() ?? null })
        return
      }
      const id = query.get('id') ?? ''
      const job = workbench.jobs.get(id)
      if (job === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown job' })
        return
      }
      sendJson(res, 200, { ok: true, job: workbench.jobView(job) })
    },
  }), 'image-workbench: job route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/gallery`,
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET required' })
        return
      }
      try {
        sendJson(res, 200, { ok: true, outDir: OUT_DIR, entries: workbench.gallery() })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: gallery route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/artifact`,
    handler: (req, res) => {
      if (!guard(req, res)) return
      const name = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('name') ?? ''
      serveArtifact(workbench, res, name)
    },
  }), 'image-workbench: artifact route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/trash-artifact`,
    handler: (req, res) => {
      if (!guard(req, res)) return
      const name = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('name') ?? ''
      // Trash reads are resolved against the trash directory only, so a deleted
      // artifact can be previewed without becoming addressable in the gallery.
      const candidate = typeof name === 'string' && name !== '' && name === path.basename(name)
        ? path.join(TRASH_DIR, name)
        : undefined
      if (candidate === undefined || !existsSync(candidate)) {
        sendJson(res, 404, { ok: false, error: 'trash artifact not found' })
        return
      }
      serveArtifact(workbench, res, name, () => candidate)
    },
  }), 'image-workbench: trash artifact route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/trash`,
    handler: (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET required' })
        return
      }
      try {
        sendJson(res, 200, { ok: true, entries: workbench.trash() })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: trash route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/generate`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      // Reference images may be inline base64, so this route takes a larger
      // body than the other JSON routes; the size is still bounded.
      const body = await readJsonBody(req, 24 * 1024 * 1024)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, error: 'a JSON body is required' })
        return
      }
      try {
        await workbench.loadSettings()
        const capabilities = await workbench.capabilitiesSnapshot(false)
        // One submission carries either a single request or a batch; both are
        // validated against the same rules, and a batch is rejected as a whole
        // so a half-accepted queue never surprises the caller.
        const rawBatch = Array.isArray(body.batch) ? body.batch : [body]
        if (rawBatch.length === 0) {
          sendJson(res, 400, { ok: false, code: 'batch-empty', error: 'the batch is empty' })
          return
        }
        if (rawBatch.length > MAX_BATCH) {
          sendJson(res, 400, { ok: false, code: 'batch-too-large', error: `a batch may hold at most ${MAX_BATCH} requests` })
          return
        }
        const requests = []
        for (const [index, item] of rawBatch.entries()) {
          const verdict = validateGeneration(capabilities, item)
          if (verdict.ok !== true) {
            sendJson(res, 400, { ...verdict, index })
            return
          }
          requests.push(verdict.request)
        }
        const started = workbench.startBatch(requests)
        sendJson(res, 200, { ok: true, batchId: started.batchId, jobs: started.jobs })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: generate route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/cancel`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      const body = await readJsonBody(req)
      // One id or many: a batch cancel is the common case.
      const ids = Array.isArray(body?.ids)
        ? body.ids.filter(entry => typeof entry === 'string')
        : (typeof body?.id === 'string' ? [body.id] : [])
      if (ids.length === 0) {
        sendJson(res, 400, { ok: false, error: 'id or ids is required' })
        return
      }
      const outcomes = ids.map(id => workbench.cancel(id))
      const cancelled = outcomes.filter(outcome => outcome.ok === true)
      sendJson(res, cancelled.length > 0 ? 200 : 409, {
        ok: cancelled.length > 0,
        cancelled,
        refused: outcomes.filter(outcome => outcome.ok !== true),
      })
    },
  }), 'image-workbench: cancel route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/delete`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      const body = await readJsonBody(req)
      const names = Array.isArray(body?.names)
        ? body.names.filter(entry => typeof entry === 'string')
        : (typeof body?.name === 'string' ? [body.name] : [])
      if (names.length === 0) {
        sendJson(res, 400, { ok: false, error: 'name or names is required' })
        return
      }
      const deleted = []
      const refused = []
      for (const name of names) {
        const outcome = await workbench.deleteArtifact(name)
        if (outcome.ok === true) deleted.push({ name, entry: outcome.entry })
        else refused.push({ name, ...outcome })
      }
      sendJson(res, deleted.length > 0 ? 200 : 409, { ok: deleted.length > 0, deleted, refused })
    },
  }), 'image-workbench: delete route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/restore`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      const body = await readJsonBody(req)
      const ids = Array.isArray(body?.ids)
        ? body.ids.filter(entry => typeof entry === 'string')
        : (typeof body?.id === 'string' ? [body.id] : [])
      if (ids.length === 0) {
        sendJson(res, 400, { ok: false, error: 'id or ids is required' })
        return
      }
      const restored = []
      const refused = []
      for (const id of ids) {
        const outcome = await workbench.restore(id)
        if (outcome.ok === true) restored.push({ id, files: outcome.restored })
        else refused.push({ id, ...outcome })
      }
      sendJson(res, restored.length > 0 ? 200 : 409, { ok: restored.length > 0, restored, refused })
    },
  }), 'image-workbench: restore route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/purge-trash`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      try {
        sendJson(res, 200, await workbench.purgeTrash())
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: purge route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/library`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method === 'GET') {
        try {
          sendJson(res, 200, workbench.library())
        } catch (error) {
          sendJson(res, 500, { ok: false, error: String(error) })
        }
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'GET or POST required' })
        return
      }
      const body = await readJsonBody(req)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, error: 'a JSON body is required' })
        return
      }
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (prompt === '') {
        sendJson(res, 400, { ok: false, code: 'prompt-empty', error: 'prompt is required' })
        return
      }
      if (prompt.length > 4000) {
        sendJson(res, 400, { ok: false, code: 'prompt-too-long', error: 'prompt exceeds 4000 characters' })
        return
      }
      const title = typeof body.title === 'string' && body.title.trim() !== ''
        ? body.title.trim().slice(0, 120)
        : prompt.slice(0, 60)
      const presets = workbench.userPresets()
      const existingId = typeof body.id === 'string' ? body.id : ''
      const existingIndex = presets.findIndex(entry => entry.id === existingId)
      // An example image is a gallery artifact name, not a copy: the preset
      // stays a few hundred bytes and the thumbnail is served from the image it
      // describes, so importing images never duplicates bytes.
      const imageName = typeof body.imageName === 'string' && body.imageName !== ''
        && body.imageName === path.basename(body.imageName)
        && IMAGE_EXTENSIONS.has(path.extname(body.imageName).toLowerCase())
        && existsSync(path.join(OUT_DIR, body.imageName))
        ? body.imageName
        : null
      const record = {
        id: existingIndex >= 0 ? existingId : `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        prompt,
        imageName,
        imageUrl: imageName === null ? null : `${API_URL}/artifact?name=${encodeURIComponent(imageName)}`,
        channelId: typeof body.channelId === 'string' ? body.channelId : null,
        model: typeof body.model === 'string' ? body.model : null,
        width: Number.isInteger(body.width) ? body.width : null,
        height: Number.isInteger(body.height) ? body.height : null,
        seed: Number.isInteger(body.seed) ? body.seed : null,
        params: body.params !== null && typeof body.params === 'object' && !Array.isArray(body.params) ? body.params : null,
        tags: Array.isArray(body.tags) ? body.tags.filter(tag => typeof tag === 'string').slice(0, 12) : [],
        origin: typeof body.origin === 'string' ? body.origin.slice(0, 200) : null,
        updatedAt: new Date().toISOString(),
      }
      if (existingIndex >= 0) presets[existingIndex] = record
      else {
        if (presets.length >= MAX_USER_PRESETS) {
          sendJson(res, 409, { ok: false, code: 'library-full', error: `at most ${MAX_USER_PRESETS} presets` })
          return
        }
        presets.unshift(record)
      }
      try {
        await workbench.saveUserPresets(presets)
        sendJson(res, 200, { ok: true, preset: record })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: library route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/library/delete`,
    handler: async (req, res) => {
      if (!guard(req, res)) return
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST required' })
        return
      }
      const body = await readJsonBody(req)
      const id = typeof body?.id === 'string' ? body.id : ''
      if (id === '') {
        sendJson(res, 400, { ok: false, error: 'id is required' })
        return
      }
      const presets = workbench.userPresets()
      const remaining = presets.filter(entry => entry.id !== id)
      if (remaining.length === presets.length) {
        sendJson(res, 404, { ok: false, error: 'no such preset' })
        return
      }
      try {
        await workbench.saveUserPresets(remaining)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) })
      }
    },
  }), 'image-workbench: library delete route')
}
