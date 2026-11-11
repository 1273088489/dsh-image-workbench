#!/usr/bin/env python3
"""Thin bridge between the DSH Host and the image-gen-hub skill module.

The Host never talks to an image API itself: it starts this script with
``python3`` and passes a request file. Two modes exist:

``probe``
    Print one JSON object describing what the module declares — backend ids,
    the default fallback order, every JSON-safe module-level constant, and the
    keyword parameters of each backend function. The Host merges those facts
    with its declarative channel table, so model lists, size bounds and step
    parameter names are never hardcoded in the browser or in Host JavaScript.

``generate``
    Read a request file, call ``free_image_gen.generate`` (which reuses the
    module's own fallback chain, per-channel size validation, on-disk artifacts
    and ``.meta.json`` sidecar) and write the JSON-safe result to a result file.

Credentials stay inside the module: it loads ``credentials.env`` itself, and
this script only ever reports booleans from ``credential_status()``.

Usage:
    image_gen_bridge.py probe [<module-dir>]
    image_gen_bridge.py generate <request-file> <result-file> [<module-dir>]
"""

from __future__ import annotations

import inspect
import json
import os
import sys
import traceback
from typing import Any

# The fallback location, derived from the current home so a fresh install works
# without editing this file. The Host passes its own path explicitly
# (IMAGE_GEN_HUB_SCRIPTS or the same convention), and argv[2] overrides both.
# Everything else — channels, models, size bounds, step parameter names — is
# introspected from the module below, so a new provider needs no change here.
DEFAULT_MODULE_DIR = os.path.join(
    os.path.expanduser("~"), ".dsh", "skills", "image-gen-hub", "scripts"
)
MODULE_NAME = "free_image_gen"
MODULE_FILE = MODULE_NAME + ".py"

# Constants that describe wire hosts and credential variable names. They are
# ordinary module facts, but they are not needed to render the workbench, so the
# probe leaves them out of the payload the browser receives.
PROBE_SKIP_CONSTANTS = ("API_HOSTS", "CREDENTIAL_VARS", "_CREDENTIALS_LOADED")

JSON_SCALARS = (str, int, float, bool, type(None))


def load_module(module_dir: str) -> Any:
    """Import the skill module from an explicit directory.

    The module file is named explicitly so a missing skill fails with a clear
    message instead of an import that might resolve some unrelated copy.
    """
    module_path = os.path.join(module_dir, MODULE_FILE)
    if not os.path.isfile(module_path):
        raise FileNotFoundError(
            f"image-gen-hub script not found: {module_path} "
            "(set IMAGE_GEN_HUB_SCRIPTS on the Host to its scripts directory)"
        )
    if module_dir not in sys.path:
        sys.path.insert(0, module_dir)
    import importlib

    return importlib.import_module(MODULE_NAME)


def _json_safe(value: Any, depth: int = 0) -> Any:
    """Convert module values into JSON-safe ones, dropping what cannot cross."""
    if depth > 4:
        return None
    if isinstance(value, JSON_SCALARS):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [_json_safe(item, depth + 1) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted(str(item) for item in value)
    return None


def collect_constants(module: Any) -> dict[str, Any]:
    """Every JSON-safe upper-case module constant, minus the skipped ones."""
    constants: dict[str, Any] = {}
    for name in dir(module):
        if not name.isupper() or name in PROBE_SKIP_CONSTANTS:
            continue
        raw = getattr(module, name)
        if inspect.isfunction(raw) or inspect.ismodule(raw) or inspect.isclass(raw):
            continue
        constants[name] = _json_safe(raw)
    return constants


def collect_signatures(module: Any) -> dict[str, Any]:
    """Keyword parameters and JSON-safe defaults of every backend function."""
    signatures: dict[str, Any] = {}
    for backend, handler in getattr(module, "BACKENDS", {}).items():
        if not callable(handler):
            continue
        try:
            signature = inspect.signature(handler)
        except (TypeError, ValueError):
            continue
        params: dict[str, Any] = {}
        for name, param in signature.parameters.items():
            params[name] = {
                "kind": str(param.kind),
                "default": _json_safe(param.default)
                if param.default is not inspect.Parameter.empty
                else None,
                "hasDefault": param.default is not inspect.Parameter.empty,
            }
        signatures[str(backend)] = params
    return signatures


def probe(module_dir: str) -> dict[str, Any]:
    """Describe the module for the Host's channel table merge."""
    module = load_module(module_dir)
    backends = getattr(module, "BACKENDS", {})
    return {
        "ok": True,
        "module": MODULE_NAME,
        "moduleFile": os.path.join(module_dir, MODULE_FILE),
        "moduleDir": module_dir,
        "moduleVersion": getattr(module, "__version__", None),
        "backends": [str(name) for name in backends],
        "defaultOrder": _json_safe(getattr(module, "DEFAULT_ORDER", ())),
        "constants": collect_constants(module),
        "signatures": collect_signatures(module),
        "credentials": _json_safe(getattr(module, "credential_status", lambda: {})()),
    }


def _read_json(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _write_json(path: str, payload: Any) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def generate(request_path: str, result_path: str, module_dir: str) -> None:
    """Run one generation through the module and record the JSON-safe result."""
    request = _read_json(request_path)
    module = load_module(module_dir)

    backends = request.get("backends") or list(getattr(module, "DEFAULT_ORDER", ()))
    prompt = str(request.get("prompt") or "")
    width = int(request.get("width") or 1024)
    height = int(request.get("height") or 1024)
    out_dir = request.get("outDir") or module.default_out_dir()
    os.makedirs(out_dir, exist_ok=True)

    kwargs: dict[str, Any] = {}
    model = request.get("model")
    # A model name belongs to exactly one channel: forwarding it down a fallback
    # chain would make every other backend reject its own request.
    if model and len(backends) == 1:
        kwargs["model"] = model

    # A seed and the advanced knobs belong to one backend's signature. Over the
    # fallback chain generate() filters kwargs per backend, so a value one
    # backend ignores would silently change meaning at the next hop; the Host
    # already refuses both in that case, and this repeats the rule where the
    # call is actually made.
    seed = request.get("seed")
    if isinstance(seed, int):
        if len(backends) != 1:
            raise ValueError("a seed requires a single backend")
        kwargs["seed"] = seed

    params = request.get("params") or {}
    if isinstance(params, dict) and params:
        if len(backends) != 1:
            raise ValueError("advanced parameters require a single backend")
        for key in (
            "negative_prompt",
            "steps",
            "guidance",
            "quality",
            "transparent",
            "output_format",
            "prompt_extend",
            "watermark",
            "loras",
        ):
            if key in params and params[key] is not None:
                kwargs[key] = params[key]

    # Reference images switch the provider to its edit endpoint, which only
    # exists on one backend, so they are only ever forwarded to a single-channel
    # run. generate() itself filters kwargs per backend, so a chain would drop
    # them silently rather than fail.
    images = request.get("images") or []
    if isinstance(images, list) and images:
        if len(backends) != 1:
            raise ValueError(
                "reference images require a single backend; "
                f"got backends={','.join(backends)}"
            )
        kwargs["images"] = [str(ref) for ref in images]

    print(f"generate {width}x{height} backends={','.join(backends)}", flush=True)
    result = module.generate(
        prompt,
        width=width,
        height=height,
        backends=tuple(backends),
        out_dir=out_dir,
        save=True,
        verbose=True,
        **kwargs,
    )

    payload: dict[str, Any] = {
        "ok": bool(result.get("ok")),
        "backend": result.get("backend"),
        "model": result.get("model"),
        "size": _json_safe(result.get("size")),
        "requested_size": result.get("requested_size"),
        "degraded": _json_safe(result.get("degraded")),
        "mode": result.get("mode"),
        "cost": result.get("cost"),
        "billed_tokens": result.get("billed_tokens"),
        "task_id": result.get("task_id"),
        "saved": result.get("saved"),
        "errors": _json_safe(result.get("errors")),
        # Echo the inputs the module does not persist. `save_result` writes a
        # `.meta.json` with provider facts only — no prompt, no seed — so the
        # workbench needs these back to record a replayable entry.
        "prompt": prompt,
        "seed": seed if isinstance(seed, int) else None,
        "params": _json_safe(params) if isinstance(params, dict) else None,
    }

    meta_file = result.get("meta_file")
    if isinstance(meta_file, str) and os.path.isfile(meta_file):
        payload["file"] = result.get("file")
        payload["meta_file"] = meta_file
        try:
            payload["meta"] = _read_json(meta_file)
        except (OSError, ValueError):
            payload["meta"] = None
        if payload.get("billed_tokens") is None and isinstance(payload.get("meta"), dict):
            payload["billed_tokens"] = payload["meta"].get("billed_tokens")

    _write_json(result_path, payload)
    print("done" if payload["ok"] else "failed", flush=True)


def main(argv: list[str]) -> int:
    """Dispatch one mode and always leave a JSON answer on disk or stdout."""
    if len(argv) < 2:
        print("usage: image_gen_bridge.py probe|generate ...", file=sys.stderr)
        return 2
    mode = argv[1]
    if mode == "probe":
        module_dir = argv[2] if len(argv) > 2 else DEFAULT_MODULE_DIR
        try:
            payload = probe(module_dir)
        except Exception as exc:  # noqa: BLE001 - report, never crash silently
            payload = {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "moduleDir": module_dir,
            }
            traceback.print_exc()
        sys.stdout.write(json.dumps(payload, ensure_ascii=False))
        sys.stdout.flush()
        return 0 if payload.get("ok") else 1

    if mode == "generate":
        if len(argv) < 4:
            print("usage: image_gen_bridge.py generate <request> <result> [<dir>]", file=sys.stderr)
            return 2
        request_path, result_path = argv[2], argv[3]
        module_dir = argv[4] if len(argv) > 4 else DEFAULT_MODULE_DIR
        try:
            generate(request_path, result_path, module_dir)
            return 0
        except Exception as exc:  # noqa: BLE001 - the Host needs a structured failure
            traceback.print_exc()
            _write_json(
                result_path,
                {"ok": False, "error": f"{type(exc).__name__}: {exc}", "errors": []},
            )
            return 1

    print(f"unknown mode {mode!r}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
