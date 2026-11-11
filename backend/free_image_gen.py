"""Unified text-to-image client across four backends.

Parameter names differ per backend and per model. They are NOT interchangeable:

  modelscope   : {"model","prompt","size":"WxH","negative_prompt","seed",
                  "steps","guidance"}   size max 2048/side
  cloudflare   : flux-1-schnell uses "steps" (max 8, default 4) and the docs
                 list no width/height; the SDXL family uses "num_steps"
                 (max 20) and accepts width/height 256-2048
  pollinations : GET /image/{prompt} uses width/height query params;
                 POST /v1/images/generations uses "size":"WxH"
  sensenova    : {"model","prompt","size":"WxH","n","watermark",
                  "response_format","output_format","prompt_extend"} and an
                 edit endpoint taking "images"; size 512-4096, multiple of 32.
                 PAID (token-billed) - the only paid channel here.

Authoritative parameter tables, with per-field provenance, live in
../references/{modelscope,cloudflare,pollinations,sensenova}.md

Credentials come from environment variables only:
    MODELSCOPE_API_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
    POLLINATIONS_API_KEY, SENSENOVA_API_KEY

Every outbound request is pinned to an exact host, must be https, must not
follow redirects, and is rejected when DNS resolves to a non-public address.
This module returns bytes and never writes files.
The low-level backends (modelscope_generate, cloudflare_generate,
pollinations_generate, sensenova_generate) stay pure functions: bytes in, no
disk writes.
The high-level generate() is the delivery boundary: it ALWAYS writes the
image and a .meta.json sidecar to out_dir (default enabled), so a successful
call cannot lose the artifact. See save_result for the on-disk contract.
"""

import base64
import inspect
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HOST_POLLINATIONS = "gen.pollinations.ai"
HOST_CLOUDFLARE_API = "api.cloudflare.com"
HOST_MODELSCOPE_API = "api-inference.modelscope.cn"
HOST_SENSENOVA_API = "token.sensenova.cn"

API_HOSTS = frozenset(
    {HOST_POLLINATIONS, HOST_CLOUDFLARE_API, HOST_MODELSCOPE_API, HOST_SENSENOVA_API}
)

# Image results are served from object storage, not the API hosts.
#
# A bare ".aliyuncs.com" suffix would allow any Alibaba Cloud OSS bucket in the
# world, which defeats the point of the guard. Instead the host must match the
# OSS structure "{bucket}.oss-{region}.aliyuncs.com" *and* the bucket must carry
# a modelscope-owned prefix. Pinning a single region would break as soon as
# ModelScope relocates storage, so the region stays free-form but the bucket
# owner does not.
MODELSCOPE_OSS_BUCKET_PREFIXES = ("modelscope",)
POLLINATIONS_IMAGE_SUFFIX = ".pollinations.ai"

# SenseNova serves results from its own object storage. The host carries a
# fixed role label in front of a free-form region (aoss.cn-sh-01.<suffix>), so
# the tenant identity lives in the PATH prefix instead of the bucket label.
# Both halves are checked: a matching host with someone else's path prefix, or
# a matching prefix hosted elsewhere, is rejected.
SENSENOVA_OSS_PATH_PREFIXES = ("/nova-clotho", "/sensenova")
SENSENOVA_OSS_SUFFIX = ".sensecoreapi-oss.cn"

_OSS_HOST_RE = re.compile(
    r"^(?P<bucket>[a-z0-9][a-z0-9-]*)\.oss-[a-z0-9-]+\.aliyuncs\.com$"
)
_SENSENOVA_OSS_HOST_RE = re.compile(
    r"^aoss\.cn-[a-z0-9-]+" + re.escape(SENSENOVA_OSS_SUFFIX) + r"$"
)

POLLINATIONS_IMAGE_URL = f"https://{HOST_POLLINATIONS}/image/"
CLOUDFLARE_RUN_URL = f"https://{HOST_CLOUDFLARE_API}/client/v4/accounts/"
MODELSCOPE_GEN_URL = f"https://{HOST_MODELSCOPE_API}/v1/images/generations"
MODELSCOPE_TASK_URL = f"https://{HOST_MODELSCOPE_API}/v1/tasks/"
SENSENOVA_GEN_URL = f"https://{HOST_SENSENOVA_API}/v1/images/generations"
SENSENOVA_EDIT_URL = f"https://{HOST_SENSENOVA_API}/v1/images/edits"

MODELSCOPE_MAX_SIDE = 2048
MODELSCOPE_MIN_SIDE = 64

# Cloudflare model capability tables. The three families take different
# parameter names and ranges, so each is declared once here instead of being
# inferred from "is it flux or not".
#
# Doc sources: developers.cloudflare.com/workers-ai/models/{slug}/schema-input.json

# SDXL family: num_steps 1-20 (default 20), width/height 256-2048.
CF_SDXL_FAMILY = frozenset(
    {
        "@cf/stabilityai/stable-diffusion-xl-base-1.0",
        "@cf/bytedance/stable-diffusion-xl-lightning",
        "@cf/lykon/dreamshaper-8-lcm",
        "@cf/runwayml/stable-diffusion-v1-5-inpainting",
    }
)

# phoenix-1.0: num_steps 1-50 (default 25), width/height 0-2048 (default 1024),
# guidance 2-10 (default 2). Only "num_steps" is accepted, not "steps".
CF_NUM_STEPS_ONLY = frozenset({"@cf/leonardo/phoenix-1.0"})

# lucid-origin: num_steps AND steps both 1-40, width/height 0-2500 (default 1120),
# guidance 0-10 (default 4.5). Both step names are documented as accepted.
CF_DUAL_STEP_NAME = frozenset({"@cf/leonardo/lucid-origin"})

# flux-1-schnell: steps 1-8 (default 4), no width/height. Its input schema also
# declares additionalProperties:false with only prompt+steps, so optional
# parameters are dropped rather than forwarded.
CF_FLUX_SCHNELL = "@cf/black-forest-labs/flux-1-schnell"

# Cloudflare models requiring a multipart body; plain JSON is rejected.
CF_MULTIPART_ONLY = frozenset(
    {
        "@cf/black-forest-labs/flux-2-klein-4b",
        "@cf/black-forest-labs/flux-2-klein-9b",
        "@cf/black-forest-labs/flux-2-dev",
    }
)


def _load_credentials() -> None:
    """Populate missing credential env vars from a sibling credentials.env file.

    Lookup order, highest priority first:
      1. an already-set environment variable
      2. ``<skill root>/credentials.env`` next to this script's parent directory

    The file is plain ``KEY=VALUE`` data and is never executed. Lines starting
    with ``#`` and blank lines are ignored, surrounding quotes are stripped, and
    the ``REPLACE_ME`` placeholder is treated as absent so an unedited template
    fails loudly instead of authenticating with a bogus value.

    Existing environment variables are never overwritten.
    """
    if _CREDENTIALS_LOADED[0]:
        return
    _CREDENTIALS_LOADED[0] = True

    candidates = [
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.realpath(__file__))),
            "credentials.env",
        ),
    ]
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                lines = handle.readlines()
        except OSError:
            continue
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip("'\"")
            if not key or not value or value == "REPLACE_ME":
                continue
            if key in CREDENTIAL_VARS and not os.environ.get(key):
                os.environ[key] = value


CREDENTIAL_VARS = frozenset(
    {
        "MODELSCOPE_API_TOKEN",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ACCOUNT_ID",
        "POLLINATIONS_API_KEY",
        "SENSENOVA_API_KEY",
    }
)
_CREDENTIALS_LOADED = [False]


def credential_status() -> dict[str, bool]:
    """Report which credentials are present, without revealing any value."""
    _load_credentials()
    return {name: bool(os.environ.get(name)) for name in sorted(CREDENTIAL_VARS)}


def _require(name: str) -> str:
    """Return a credential or raise a message naming the exact missing variable."""
    _load_credentials()
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"{name} is not set. Add it to environment variables or to "
            f"{os.path.join('free-image-gen', 'credentials.env')}."
        )
    return value


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects so a validated host cannot bounce us elsewhere."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url, code, f"redirect blocked to {newurl!r}", headers, fp
        )


_OPENER = urllib.request.build_opener(_NoRedirect)


def _resolve_is_public(host: str) -> bool:
    """True only when every A/AAAA record for host is a public unicast address."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if (
            address.is_private
            or address.is_loopback
            or address.is_link_local
            or address.is_reserved
            or address.is_multicast
            or address.is_unspecified
            or not address.is_global
        ):
            return False
    return True


def _is_allowed_image_host(host: str, path: str = "") -> bool:
    """True only for ModelScope-owned OSS buckets, Pollinations media, or
    SenseNova's own object-storage host with its own path prefix."""
    if host.endswith(POLLINATIONS_IMAGE_SUFFIX):
        return True
    if _SENSENOVA_OSS_HOST_RE.match(host):
        # The host pattern alone is shared by every tenant on that storage, so
        # the path must also sit under one of SenseNova's own prefixes.
        return path.startswith(SENSENOVA_OSS_PATH_PREFIXES)
    match = _OSS_HOST_RE.match(host)
    if not match:
        return False
    return match.group("bucket").startswith(MODELSCOPE_OSS_BUCKET_PREFIXES)


def _guard(url: str, image: bool) -> None:
    """Allow only https on an allow-listed host with public DNS."""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https":
        raise ValueError(f"blocked scheme: {parts.scheme!r}")
    host = parts.hostname or ""
    if image:
        if not _is_allowed_image_host(host, parts.path):
            raise ValueError(f"blocked image host: {host!r}")
    elif host not in API_HOSTS:
        raise ValueError(f"blocked API host: {host!r}")
    if not _resolve_is_public(host):
        raise ValueError(f"host not publicly routable: {host!r}")


def _open(
    url: str,
    *,
    token: str | None = None,
    payload: dict[str, Any] | None = None,
    image: bool = False,
    extra_headers: dict[str, str] | None = None,
):
    """Send one HTTP request after host validation.

    Everything except ``url`` is keyword-only so a positional slip cannot bind
    the wrong value to the wrong parameter.

    ``payload`` present -> JSON POST body. ``payload`` None -> request without a
    body (used for GET-style calls and bare image downloads).

    ``extra_headers`` carries protocol headers the backend needs beyond auth,
    e.g. ModelScope's async-mode and task-type headers.
    """
    _guard(url, image)
    headers = {"Accept": "*/*", "User-Agent": "free-image-gen/1.2"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)
    try:
        with _OPENER.open(request, timeout=300) as response:
            return (
                response.status,
                response.read(),
                {k.lower(): v for k, v in response.headers.items()},
            )
    except urllib.error.HTTPError as exc:
        return (
            exc.code,
            exc.read(),
            {k.lower(): v for k, v in (exc.headers or {}).items()},
        )
    except (urllib.error.URLError, OSError) as exc:
        # Network-level failure: DNS, TLS handshake, connection reset, timeout.
        # Returned as status 0 so the caller's fallback chain can continue
        # instead of escaping as an uncaught exception. SSL errors surface as
        # URLError wrapping SSLEOFError, so OSError is caught alongside it.
        reason = getattr(exc, "reason", exc)
        return 0, f"network error: {type(reason).__name__}: {reason}".encode(), {}


def _image_size(blob: bytes) -> tuple[int, int] | None:
    """Read width/height from PNG or JPEG headers."""
    if blob[:8] == b"\x89PNG\r\n\x1a\n" and len(blob) >= 24:
        return int.from_bytes(blob[16:20], "big"), int.from_bytes(blob[20:24], "big")
    if blob[:2] == b"\xff\xd8":
        index = 2
        while index < len(blob) - 9:
            if blob[index] != 0xFF:
                index += 1
                continue
            marker = blob[index + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                height = int.from_bytes(blob[index + 5 : index + 7], "big")
                width = int.from_bytes(blob[index + 7 : index + 9], "big")
                return width, height
            if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
                index += 2
                continue
            index += 2 + int.from_bytes(blob[index + 2 : index + 4], "big")
    return None


def _image_mode(blob: bytes) -> str | None:
    """Best-effort colour mode from PNG header bytes.

    Only the PNG IHDR colour-type byte is read; JPEG is reported as "RGB"
    because its component count is not worth parsing here. Returned so callers
    know in advance that e.g. saving to JPEG needs an ``convert("RGB")`` first.
    """
    if blob[:8] == b"\x89PNG\r\n\x1a\n" and len(blob) >= 26:
        colour_type = blob[25]
        return {
            0: "L",
            2: "RGB",
            3: "P",
            4: "LA",
            6: "RGBA",
        }.get(colour_type)
    if blob[:2] == b"\xff\xd8":
        return "RGB"
    return None


def _ok(backend: str, **fields: Any) -> dict[str, Any]:
    result = {"ok": True, "backend": backend}
    result.update(fields)
    return result


def _fail(backend: str, status: int, error: str) -> dict[str, Any]:
    return {"ok": False, "backend": backend, "status": status, "error": error}


def _params_of(fn) -> frozenset[str]:
    """Return the declared parameter names of fn.

    Uses the signature rather than ``fn.__code__.co_varnames``: co_varnames also
    contains local variables, which would let a non-parameter name through and
    then raise ``unexpected keyword argument`` at call time.
    """
    return frozenset(inspect.signature(fn).parameters)


def default_out_dir() -> Path:
    """Default artifact directory: the caller's cwd, not the skill folder."""
    return Path.cwd() / "generated-images"


def save_result(
    result: dict[str, Any],
    *,
    out_dir: str | os.PathLike[str] | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    """Write the image bytes and a .meta.json sidecar to disk, atomically.

    This is the delivery boundary. A successful generate() call ALWAYS lands
    here (save defaults to True), so an artifact can never be lost to process
    exit the way raw bytes in a return dict can.

    Returns the fields to merge into the result: file, meta_file, saved.
    Raises on any write failure rather than silently returning unsaved bytes.
    """
    data = result.get("data")
    if not result.get("ok") or not isinstance(data, (bytes, bytearray)) or not data:
        raise ValueError("save_result requires a successful result with image data")

    target = Path(out_dir) if out_dir is not None else default_out_dir()
    target.mkdir(parents=True, exist_ok=True)

    ext = ".jpg" if result.get("content_type") == "image/jpeg" else ".png"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = f"{stamp}-{result.get('backend', 'unknown')}"

    image_path = target / f"{stem}{ext}"
    meta_path = target / f"{stem}.meta.json"

    # Unique names even for two calls in the same second.
    n = 0
    while image_path.exists() or meta_path.exists():
        n += 1
        image_path = target / f"{stem}-{n}{ext}"
        meta_path = target / f"{stem}-{n}.meta.json"

    meta = {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "backend": result.get("backend"),
        "model": result.get("model"),
        "task_id": result.get("task_id"),
        "content_type": result.get("content_type"),
        "size": list(result["size"]) if result.get("size") else None,
        "requested_size": result.get("requested_size"),
        "mode": result.get("mode"),
        "cost": result.get("cost"),
        # Token count is the billing unit for sensenova; kept alongside cost so
        # a paid run can be reconciled even when no unit price is configured.
        "billed_tokens": result.get("billed_tokens"),
        "degraded": result.get("degraded"),
        "bytes": len(data),
        "image_file": image_path.name,
    }

    # Write-then-rename so a crash never leaves a half-written artifact.
    tmp_img = image_path.with_name(image_path.name + ".tmp")
    tmp_meta = meta_path.with_name(meta_path.name + ".tmp")
    try:
        tmp_img.write_bytes(bytes(data))
        os.replace(tmp_img, image_path)
        tmp_meta.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(tmp_meta, meta_path)
    finally:
        for tmp in (tmp_img, tmp_meta):
            if tmp.exists():
                tmp.unlink()

    if verbose:
        print(f"  saved: {image_path}", flush=True)
        print(f"  meta:  {meta_path}", flush=True)

    return {"file": str(image_path), "meta_file": str(meta_path), "saved": True}


# --------------------------------------------------------------------------
# modelscope
# --------------------------------------------------------------------------
def modelscope_generate(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    model: str = "Qwen/Qwen-Image-2.1-Turbo",
    negative_prompt: str | None = None,
    seed: int | None = None,
    steps: int | None = None,
    guidance: float | None = None,
    loras: str | dict[str, float] | None = None,
    poll_interval: float = 5.0,
    timeout: float = 480.0,
    token: str | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    """Generate via ModelScope API-Inference. Async submit then poll.

    Size limits are per model family in the official docs:
      SD series      64..2048
      FLUX           64..1024
      Qwen-Image     64..1664
      Z-Image-Turbo  512..2048
    The generic 2048 ceiling below is the loosest bound; pass a size the model
    actually accepts or the server rejects it.

    loras follows the documented form: a single repo id string, or a dict of
    repo id -> weight where up to 6 entries must sum to 1.0.
    """
    token = token or _require("MODELSCOPE_API_TOKEN")

    for side in (width, height):
        if not MODELSCOPE_MIN_SIDE <= side <= MODELSCOPE_MAX_SIDE:
            raise ValueError(
                f"width and height must be within "
                f"[{MODELSCOPE_MIN_SIDE}, {MODELSCOPE_MAX_SIDE}]"
            )
    size = f"{width - width % 16}x{height - height % 16}"

    payload: dict[str, Any] = {"model": model, "prompt": prompt, "size": size}
    if negative_prompt:
        payload["negative_prompt"] = negative_prompt
    if seed is not None:
        payload["seed"] = int(seed)
    if steps is not None:
        if not 1 <= int(steps) <= 100:
            raise ValueError("steps must be within [1, 100]")
        payload["steps"] = int(steps)
    if guidance is not None:
        if not 1.5 <= float(guidance) <= 20:
            raise ValueError("guidance must be within [1.5, 20]")
        payload["guidance"] = float(guidance)
    if loras is not None:
        if isinstance(loras, dict):
            if len(loras) > 6:
                raise ValueError("at most 6 LoRAs are allowed")
            total = sum(loras.values())
            if abs(total - 1.0) > 1e-6:
                raise ValueError(f"LoRA weights must sum to 1.0, got {total}")
        payload["loras"] = loras

    # ModelScope requires the async-mode header on submit and the task-type
    # header on every poll. Without the latter, a valid task_id is answered with
    # {"errors":{"code":500,"message":"task not found"}}.
    status, body, _ = _open(
        MODELSCOPE_GEN_URL,
        token=token,
        payload=payload,
        extra_headers={"X-ModelScope-Async-Mode": "true"},
    )
    try:
        submitted = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return _fail("modelscope", status, body[:300].decode("utf-8", "ignore"))

    task_id = submitted.get("task_id")
    if status != 200 or not task_id:
        return _fail(
            "modelscope", status, json.dumps(submitted, ensure_ascii=False)[:300]
        )

    deadline = time.time() + timeout
    attempt = 0
    while time.time() < deadline:
        time.sleep(poll_interval)
        attempt += 1
        st, raw, _ = _open(
            f"{MODELSCOPE_TASK_URL}{task_id}",
            token=token,
            extra_headers={"X-ModelScope-Task-Type": "image_generation"},
        )
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            continue
        state = parsed.get("task_status")
        images = parsed.get("output_images") or []
        if verbose:
            print(
                f"  [modelscope] poll#{attempt} {state} images={len(images)}",
                flush=True,
            )
        if images:
            code, blob, headers = _open(images[0], image=True)
            if code != 200 or not blob:
                return _fail("modelscope", code, "image download failed")
            return _ok(
                "modelscope",
                model=model,
                task_id=task_id,
                content_type=headers.get("content-type", "image/png"),
                data=blob,
                size=_image_size(blob),
                mode=_image_mode(blob),
                cost=None,
            )
        if state in ("FAILED", "CANCELED"):
            return _fail(
                "modelscope", 200, json.dumps(parsed, ensure_ascii=False)[:300]
            )

    return _fail("modelscope", 0, "timeout")


# --------------------------------------------------------------------------
# cloudflare
# --------------------------------------------------------------------------
def cloudflare_generate(
    prompt: str,
    *,
    model: str = "@cf/black-forest-labs/flux-1-schnell",
    steps: int | None = None,
    width: int | None = None,
    height: int | None = None,
    negative_prompt: str | None = None,
    guidance: float | None = None,
    seed: int | None = None,
    token: str | None = None,
    account_id: str | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    """Generate via Cloudflare Workers AI.

    Signature note: unlike modelscope_generate and pollinations_generate, this
    function does NOT take (width, height) in positions 2 and 3. Cloudflare's
    models disagree on step naming and size ranges, so ``model`` leads. Every
    argument after ``prompt`` is keyword-only, which makes a positional slip
    impossible; the asymmetry is intentional and documented.

    Parameter handling per model family (all ranges from the model's official
    schema-input.json):
      flux-1-schnell  steps 1-8 (default 4); no width/height; only prompt+steps
                      are legal, so optional params are dropped.
      SDXL family     num_steps 1-20 (default 20); width/height 256-2048.
      phoenix-1.0     num_steps 1-50 (default 25); width/height 0-2048;
                      guidance 2-10.
      lucid-origin    num_steps/steps 1-40; width/height 0-2500; guidance 0-10.
    """
    token = token or _require("CLOUDFLARE_API_TOKEN")
    account_id = account_id or _require("CLOUDFLARE_ACCOUNT_ID")
    if not account_id.isalnum():
        raise ValueError("CLOUDFLARE_ACCOUNT_ID must be alphanumeric")

    if model in CF_MULTIPART_ONLY:
        raise ValueError(
            f"{model} requires a multipart body; "
            "its fields are not documented, so this client does not send it"
        )

    payload: dict[str, Any] = {"prompt": prompt}
    dropped: list[str] = []

    def _size(min_side: int, max_side: int) -> None:
        for label, value in (("width", width), ("height", height)):
            if value is None:
                continue
            if not min_side <= int(value) <= max_side:
                raise ValueError(
                    f"{label} must be within [{min_side}, {max_side}] for {model}"
                )
            payload[label] = int(value)

    if model == CF_FLUX_SCHNELL:
        # Schema is additionalProperties:false with only prompt and steps.
        step_value = 4 if steps is None else int(steps)
        if not 1 <= step_value <= 8:
            raise ValueError("steps must be within [1, 8] for flux-1-schnell")
        payload["steps"] = step_value
        if width is not None or height is not None:
            raise ValueError(
                f"{model} documents no width/height parameters; "
                "omit them or use a model that accepts them"
            )
        for name, value in (
            ("negative_prompt", negative_prompt),
            ("guidance", guidance),
            ("seed", seed),
        ):
            if value is not None:
                dropped.append(name)
    elif model in CF_SDXL_FAMILY:
        step_value = 20 if steps is None else int(steps)
        if not 1 <= step_value <= 20:
            raise ValueError(f"num_steps must be within [1, 20] for {model}")
        payload["num_steps"] = step_value
        _size(256, 2048)
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if guidance is not None:
            payload["guidance"] = float(guidance)
        if seed is not None:
            payload["seed"] = int(seed)
    elif model in CF_NUM_STEPS_ONLY:
        # phoenix-1.0 accepts num_steps only, never "steps".
        step_value = 25 if steps is None else int(steps)
        if not 1 <= step_value <= 50:
            raise ValueError(f"num_steps must be within [1, 50] for {model}")
        payload["num_steps"] = step_value
        _size(0, 2048)
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if guidance is not None:
            g = float(guidance)
            if not 2 <= g <= 10:
                raise ValueError(f"guidance must be within [2, 10] for {model}")
            payload["guidance"] = g
        if seed is not None:
            payload["seed"] = int(seed)
    elif model in CF_DUAL_STEP_NAME:
        step_value = 4 if steps is None else int(steps)
        if not 1 <= step_value <= 40:
            raise ValueError(f"num_steps must be within [1, 40] for {model}")
        payload["num_steps"] = step_value
        _size(0, 2500)
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if guidance is not None:
            g = float(guidance)
            if not 0 <= g <= 10:
                raise ValueError(f"guidance must be within [0, 10] for {model}")
            payload["guidance"] = g
        if seed is not None:
            payload["seed"] = int(seed)
    else:
        raise ValueError(
            f"{model} is not in the known Cloudflare model tables; "
            "its parameter names and ranges are undocumented here, so this "
            "client refuses to guess. Add it to one of the CF_* sets after "
            "reading its schema-input.json."
        )

    if dropped and verbose:
        print(
            f"  [cloudflare] dropped unsupported for flux-1-schnell: "
            f"{', '.join(dropped)}",
            flush=True,
        )

    url = f"{CLOUDFLARE_RUN_URL}{account_id}/ai/run/{model}"
    status, body, _ = _open(url, token=token, payload=payload)

    if status != 200:
        return _fail("cloudflare", status, body[:300].decode("utf-8", "ignore"))

    # SDXL family streams raw bytes; flux returns JSON with a base64 image.
    if body[:2] == b"\xff\xd8" or body[:8] == b"\x89PNG\r\n\x1a\n":
        content_type = "image/jpeg" if body[:2] == b"\xff\xd8" else "image/png"
        if verbose:
            print(
                f"  [cloudflare] {status} raw {content_type} bytes={len(body)}",
                flush=True,
            )
        return _ok(
            "cloudflare",
            model=model,
            content_type=content_type,
            data=body,
            size=_image_size(body),
            mode=_image_mode(body),
            cost=None,
        )

    try:
        parsed = json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return _fail("cloudflare", status, "unparsable response")

    if not parsed.get("success"):
        return _fail("cloudflare", status, str(parsed.get("errors"))[:300])

    result = parsed.get("result") or {}
    image_b64 = result.get("image")
    if not image_b64:
        return _fail("cloudflare", status, f"no image; keys={list(result)}")

    data = base64.b64decode(image_b64)
    neurons = (result.get("usage") or {}).get("neurons")
    content_type = "image/jpeg" if data[:2] == b"\xff\xd8" else "image/png"
    if verbose:
        print(
            f"  [cloudflare] {status} {content_type} bytes={len(data)} "
            f"neurons={neurons}",
            flush=True,
        )
    return _ok(
        "cloudflare",
        model=model,
        content_type=content_type,
        data=data,
        size=_image_size(data),
        mode=_image_mode(data),
        cost=f"{neurons} neurons" if neurons is not None else None,
    )


# --------------------------------------------------------------------------
# pollinations
# --------------------------------------------------------------------------
def pollinations_generate(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    # Was community/tomdacatto/gpt-image-2.5-sunburst, which is no longer in the
    # live catalog (/image/models, 2026-11-09), so any call that relied on the
    # default failed before reaching the provider. The current default model is
    # tongyi-mai/z-image-turbo; mai-image-2.6 is used here because it is a
    # verified-present, healthy, free model with a 12 rpm allowance.
    model: str = "microsoft/mai-image-2.6",
    seed: int | None = None,
    quality: str | None = None,
    transparent: bool = False,
    token: str | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    """Generate via Pollinations GET /image/{prompt}. Returns raw image bytes."""
    token = token or _require("POLLINATIONS_API_KEY")

    query: dict[str, Any] = {"model": model, "width": int(width), "height": int(height)}
    if seed is not None:
        query["seed"] = int(seed)
    if quality:
        if quality not in ("low", "medium", "high", "hd"):
            raise ValueError("quality must be low|medium|high|hd")
        query["quality"] = quality
    if transparent:
        query["transparent"] = "true"

    url = (
        POLLINATIONS_IMAGE_URL
        + urllib.parse.quote(prompt, safe="")
        + "?"
        + urllib.parse.urlencode(query)
    )

    status, body, headers = _open(url, token=token)
    content_type = headers.get("content-type", "")
    if verbose:
        print(
            f"  [pollinations] {status} type={content_type!r} "
            f"model={headers.get('x-model-used', '?')} bytes={len(body)}",
            flush=True,
        )
    if status != 200 or not body:
        return _fail("pollinations", status, body[:300].decode("utf-8", "ignore"))
    if not content_type.startswith("image/"):
        return _fail(
            "pollinations", status, f"unexpected content-type {content_type!r}"
        )

    return _ok(
        "pollinations",
        model=headers.get("x-model-used", model),
        content_type=content_type,
        data=body,
        size=_image_size(body),
        mode=_image_mode(body),
        # Raw value of an undocumented response header. The unit is unverified:
        # an observed value of 1 does not correspond to the documented 0.002
        # pollen price, so this must NOT be read as pollen spent.
        usage_header=headers.get("x-usage-completion-image-tokens"),
    )


# --------------------------------------------------------------------------
# sensenova
# --------------------------------------------------------------------------
# Field names, ranges and defaults are documented in references/sensenova.md.
# Only the API-exposed surface is implemented here: the REST endpoint accepts
# eight fields and does NOT expose sampler knobs (cfg_scale / steps /
# timestep_shift belong to local inference, see the reference file).
SENSENOVA_MODELS = ("sensenova-u1.5-lite", "sensenova-u1.5-fast")
SENSENOVA_MIN_SIDE = 512
SENSENOVA_MAX_SIDE = 4096
SENSENOVA_SIDE_STEP = 32
SENSENOVA_MAX_RATIO = 3


def _sensenova_check_size(width: int, height: int) -> None:
    """Reject sizes the API documents as invalid before spending a request."""
    for label, value in (("width", width), ("height", height)):
        if not (SENSENOVA_MIN_SIDE <= value <= SENSENOVA_MAX_SIDE):
            raise ValueError(
                f"{label} must be {SENSENOVA_MIN_SIDE}-{SENSENOVA_MAX_SIDE}, "
                f"got {value}"
            )
        if value % SENSENOVA_SIDE_STEP:
            raise ValueError(f"{label} must be a multiple of {SENSENOVA_SIDE_STEP}")
    if max(width, height) > min(width, height) * SENSENOVA_MAX_RATIO:
        raise ValueError(
            f"aspect ratio must not exceed {SENSENOVA_MAX_RATIO}:1 "
            f"(got {width}x{height})"
        )


def sensenova_generate(
    prompt: str,
    *,
    width: int = 2048,
    height: int = 2048,
    model: str = "sensenova-u1.5-lite",
    response_format: str = "url",
    output_format: str = "png",
    watermark: bool = False,
    prompt_extend: bool = True,
    images: list[str] | None = None,
    token: str | None = None,
    verbose: bool = True,
) -> dict[str, Any]:
    """Generate via SenseNova /v1/images/generations (or /images/edits).

    This is a **paid** channel billed in tokens, unlike the three free ones.
    Passing ``images`` switches to the edit endpoint, which does not exist in
    any other backend of this module.

    ``response_format="url"`` is used by default so the returned URL can be
    fetched and stored like the other backends; "b64_json" is also accepted and
    decoded in place.
    """
    token = token or _require("SENSENOVA_API_KEY")
    if model not in SENSENOVA_MODELS:
        raise ValueError(f"model must be one of {SENSENOVA_MODELS}, got {model!r}")
    if response_format not in ("url", "b64_json"):
        raise ValueError("response_format must be 'url' or 'b64_json'")
    if output_format not in ("png", "jpeg", "webp"):
        raise ValueError("output_format must be png|jpeg|webp")
    _sensenova_check_size(width, height)

    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "size": f"{width}x{height}",
        "response_format": response_format,
        "output_format": output_format,
        "watermark": bool(watermark),
        "prompt_extend": bool(prompt_extend),
    }
    url = SENSENOVA_GEN_URL
    if images:
        # Edits: auto keeps the primary image's aspect ratio.
        payload["images"] = [{"image_url": ref} for ref in images]
        payload["size"] = "auto"
        url = SENSENOVA_EDIT_URL

    status, body, headers = _open(url, token=token, payload=payload)
    if verbose:
        print(f"  [sensenova] {status} model={model} bytes={len(body)}", flush=True)
    if status != 200:
        return _fail("sensenova", status, body[:300].decode("utf-8", "ignore"))

    try:
        parsed = json.loads(body)
    except ValueError:
        return _fail("sensenova", status, "response was not JSON")
    items = parsed.get("data") or []
    if not items:
        return _fail("sensenova", status, "response contained no image data")

    item = items[0]
    if response_format == "b64_json":
        try:
            blob = base64.b64decode(item["b64_json"])
        except (KeyError, ValueError):
            return _fail("sensenova", status, "b64_json missing or undecodable")
    else:
        image_url = item.get("url")
        if not image_url:
            return _fail("sensenova", status, "response contained no url")
        # _guard validates the image host allow-list and public DNS for us.
        img_status, blob, _ = _open(image_url, image=True)
        if img_status != 200 or not blob:
            return _fail("sensenova", img_status, "image download failed")

    return _ok(
        "sensenova",
        model=model,
        content_type=f"image/{output_format}",
        data=blob,
        size=_image_size(blob),
        mode=_image_mode(blob),
        usage=parsed.get("usage"),
        # Token usage is the billing unit for this channel. Kept verbatim so the
        # caller can report cost; the price per token is NOT encoded here.
        billed_tokens=(parsed.get("usage") or {}).get("total_tokens"),
        cost=f"{(parsed.get('usage') or {}).get('total_tokens')} tokens",
    )


BACKENDS = {
    "modelscope": modelscope_generate,
    "cloudflare": cloudflare_generate,
    "pollinations": pollinations_generate,
    "sensenova": sensenova_generate,
}

# Channel order, highest priority first.
#   1. modelscope  - free, best spatial structure, slowest of the free ones
#   2. sensenova   - token-billed; user has ruled it in the default chain
#   3. pollinations- free, wide model choice
#   4. cloudflare  - free, last resort: flux-1-schnell is fixed at 1024x1024 and
#                    its DNS precheck can stall on hosts with a slow resolver
DEFAULT_ORDER = ("modelscope", "sensenova", "pollinations", "cloudflare")


BYTE_SIZE = 8


def generate(
    prompt: str,
    *,
    width: int = 1024,
    height: int = 1024,
    backends: tuple[str, ...] = DEFAULT_ORDER,
    verbose: bool = True,
    out_dir: str | os.PathLike[str] | None = None,
    save: bool = True,
    **kwargs: Any,
) -> dict[str, Any]:
    """Try each backend in order and return the first success.

    modelscope is the primary channel by design; sensenova, pollinations and
    cloudflare are the fallbacks, in that order. Any failure moves on to the
    next backend rather than retrying the same one. sensenova is token-billed,
    so reaching it means a paid request was accepted as a fallback.

    Each backend has its own size ceiling, so a fallback may silently produce a
    different resolution than requested. That is recorded in the returned
    ``degraded`` list and ``requested_size`` so the caller can tell the user.

    Backend-specific kwargs are filtered so one call site works for every backend.
    A backend raising ValueError on an unsupported parameter is skipped rather
    than retried with guessed values.
    """
    errors: list[str] = []
    degraded: list[str] = []
    requested_size = f"{width}x{height}"

    for name in backends:
        fn = BACKENDS.get(name)
        if fn is None:
            errors.append(f"{name}: unknown backend")
            continue
        if verbose:
            print(f"try {name} ...", flush=True)

        attempt_w, attempt_h = width, height
        attempt_notes: list[str] = []
        call_kwargs: dict[str, Any] = {"verbose": verbose}

        if name == "cloudflare":
            # flux-1-schnell documents no width/height at all, so passing even
            # the default 1024x1024 is rejected by its schema. Every other
            # Cloudflare family accepts them. The model is read from kwargs so
            # this decision matches what the backend will actually send.
            chosen_model = kwargs.get("model", "@cf/black-forest-labs/flux-1-schnell")
            if chosen_model == CF_FLUX_SCHNELL:
                if (width, height) != (1024, 1024):
                    attempt_w = attempt_h = 1024
                    attempt_notes.append(
                        f"{name}: requested {requested_size}, "
                        "cloudflare flux outputs fixed 1024x1024"
                    )
                    if verbose:
                        print("  size adjusted -> 1024x1024", flush=True)
            else:
                call_kwargs["width"] = attempt_w
                call_kwargs["height"] = attempt_h
        else:
            call_kwargs["width"] = attempt_w
            call_kwargs["height"] = attempt_h

        params = _params_of(fn)
        accepted = {k: v for k, v in kwargs.items() if k in params}
        accepted.update({k: v for k, v in call_kwargs.items() if k in params})

        try:
            result = fn(prompt, **accepted)
        except (RuntimeError, ValueError) as exc:
            errors.append(f"{name}: {exc}")
            if verbose:
                print(f"  skipped: {exc}", flush=True)
            continue
        except Exception as exc:  # noqa: BLE001 - keep the chain alive
            errors.append(f"{name}: {type(exc).__name__}: {exc}")
            if verbose:
                print(f"  failed: {type(exc).__name__}: {exc}", flush=True)
            continue

        if result.get("ok"):
            result["requested_size"] = requested_size
            # The backend may return a different pixel size than requested even
            # when the client sent the size faithfully: pollinations/flux.1-schnell
            # snaps to its own bucket (observed 1152x2048 -> 768x1280). Compare the
            # real output against the request so the caller is never told a size
            # the file does not have.
            actual = result.get("size")
            if isinstance(actual, tuple) and actual != (attempt_w, attempt_h):
                attempt_notes.append(
                    f"{name}: requested {attempt_w}x{attempt_h}, "
                    f"service returned {actual[0]}x{actual[1]}"
                )
            # Only this backend's adjustments apply; earlier attempts failed.
            result["degraded"] = attempt_notes if attempt_notes else None
            if save:
                result.update(save_result(result, out_dir=out_dir, verbose=verbose))
            return result

        errors.append(f"{name}: {result.get('error')}")
        if verbose:
            print(f"  failed: {str(result.get('error'))[:160]}", flush=True)

    return {
        "ok": False,
        "requested_size": requested_size,
        "errors": errors,
        "degraded": degraded,
    }
