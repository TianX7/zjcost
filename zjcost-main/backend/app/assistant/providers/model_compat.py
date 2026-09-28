"""model-compatible provider (works with model-compatible endpoints)."""

from __future__ import annotations

import json
from time import perf_counter
from types import SimpleNamespace
from typing import Any, Iterator, Sequence

from pydantic import BaseModel, ValidationError
import requests

from app.assistant.config import ZhSettings
from app.assistant.observability import log_zh_call
from app.assistant.providers.base import (
    ZhProviderError,
    ZhProviderNotAvailableError,
    ZhProviderNotConfiguredError,
    BaseZhProvider,
    StreamEvent,
    StructuredMessage,
    TModel,
    ToolCallRequest,
    ToolsResponse,
)


def _extract_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if not stripped:
        raise ZhProviderError("Empty model output")

    if stripped.startswith("```"):
        stripped = stripped.strip("`").strip()
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()

    try:
        data = json.loads(stripped)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ZhProviderError("Model output is not valid JSON object")

    candidate = stripped[start : end + 1]
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ZhProviderError("Model output JSON parse failed") from exc

    if not isinstance(data, dict):
        raise ZhProviderError("Model output JSON root must be object")
    return data


# Reasoning models that require temperature=1 or don't accept temperature=0.
_REASONING_MODEL_PATTERNS = ("model-c-k2", "model-e-reasoner", "o1", "o3")


class BadRequestError(RuntimeError):
    pass


def _to_namespace(value: Any) -> Any:
    if isinstance(value, dict):
        return SimpleNamespace(**{k: _to_namespace(v) for k, v in value.items()})
    if isinstance(value, list):
        return [_to_namespace(v) for v in value]
    return value


class _ChatCompletions:
    def __init__(self, client: "ModelCompatHttpClient") -> None:
        self._client = client

    def create(self, **payload: Any) -> Any:
        stream = bool(payload.get("stream"))
        data = self._client.post_json("chat/completions", payload, stream=stream)
        if stream:
            return self._client.iter_stream(data)
        return _to_namespace(data)


class _Chat:
    def __init__(self, client: "ModelCompatHttpClient") -> None:
        self.completions = _ChatCompletions(client)


class _Embeddings:
    def __init__(self, client: "ModelCompatHttpClient") -> None:
        self._client = client

    def create(self, **payload: Any) -> Any:
        return _to_namespace(self._client.post_json("embeddings", payload))


class ModelCompatHttpClient:
    def __init__(self, *, api_key: str | None, base_url: str | None, timeout: float) -> None:
        if not api_key:
            raise ZhProviderNotAvailableError("model key is not configured")
        self.api_key = api_key
        self.base_url = (base_url or "").rstrip("/")
        self.timeout = timeout
        self.chat = _Chat(self)
        self.embeddings = _Embeddings(self)

    def post_json(self, endpoint: str, payload: dict[str, Any], *, stream: bool = False) -> Any:
        if not self.base_url:
            raise ZhProviderNotAvailableError("model endpoint is not configured")
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=self.timeout,
            stream=stream,
        )
        if response.status_code == 400:
            raise BadRequestError(response.text[:500])
        response.raise_for_status()
        return response if stream else response.json()

    @staticmethod
    def iter_stream(response: requests.Response) -> Iterator[Any]:
        for raw in response.iter_lines(decode_unicode=True):
            if not raw:
                continue
            line = raw.strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if line == "[DONE]":
                break
            try:
                yield _to_namespace(json.loads(line))
            except json.JSONDecodeError:
                continue


class ModelCompatProvider(BaseZhProvider):
    def __init__(self, settings: ZhSettings) -> None:
        self._settings = settings
        self._client: Any | None = None

    def _is_reasoning_model(self, model_override: str | None = None) -> bool:
        model = (model_override or self._settings.model or "").lower()
        return any(p in model for p in _REASONING_MODEL_PATTERNS)

    def _resolve_model(self, model_override: str | None) -> str:
        """OPT-4: Return the concrete model name to use for this call."""
        return model_override or self._settings.model or ""

    def is_enabled(self) -> bool:
        return self._settings.is_enabled()

    def is_configured(self) -> bool:
        return self._settings.is_configured()

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        self._client = ModelCompatHttpClient(
            api_key=self._settings.api_key,
            base_url=self._settings.base_url,
            timeout=self._settings.timeout_seconds,
        )
        return self._client

    def generate_structured(
        self,
        *,
        task: str,
        messages: Sequence[StructuredMessage],
        schema_model: type[TModel],
    ) -> TModel:
        if not self.is_enabled():
            raise ZhProviderNotConfiguredError("辅助 provider is disabled or misconfigured")

        started = perf_counter()
        input_size = sum(len(m["content"]) for m in messages)

        try:
            client = self._get_client()
            create_kwargs: dict[str, Any] = {
                "model": self._settings.model,
                "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
                "response_format": {"type": "json_object"},
            }
            if not self._is_reasoning_model():
                create_kwargs["temperature"] = 0
            response = client.chat.completions.create(**create_kwargs)

            content = response.choices[0].message.content or ""
            payload = _extract_json_object(content)
            parsed = schema_model.model_validate(payload)

            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=True,
                duration_ms=int((perf_counter() - started) * 1000),
                input_size=input_size,
                output_size=len(content),
            )
            return parsed
        except ZhProviderError as exc:
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=False,
                duration_ms=int((perf_counter() - started) * 1000),
                error=str(exc),
                input_size=input_size,
            )
            raise
        except ValidationError as exc:
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=False,
                duration_ms=int((perf_counter() - started) * 1000),
                error=f"schema_validation_error: {exc.errors()}",
                input_size=input_size,
            )
            raise ZhProviderError("Model output failed schema validation") from exc
        except Exception as exc:  # pragma: no cover - network/runtime failures
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=False,
                duration_ms=int((perf_counter() - started) * 1000),
                error=exc.__class__.__name__,
                input_size=input_size,
            )
            raise ZhProviderError(self._format_provider_error("Provider call failed", exc)) from exc

    def generate_text(
        self,
        *,
        task: str,
        messages: Sequence[StructuredMessage],
    ) -> str:
        """Run model completion and return plain text."""
        if not self.is_enabled():
            raise ZhProviderNotConfiguredError("辅助 provider is disabled or misconfigured")

        started = perf_counter()
        input_size = sum(len(m["content"]) for m in messages)

        try:
            client = self._get_client()
            gen_kwargs: dict[str, Any] = {
                "model": self._settings.model,
                "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
            }
            if not self._is_reasoning_model():
                gen_kwargs["temperature"] = 0.3
            response = client.chat.completions.create(**gen_kwargs)
            content = response.choices[0].message.content or ""
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=True,
                duration_ms=int((perf_counter() - started) * 1000),
                input_size=input_size,
                output_size=len(content),
            )
            return content.strip()
        except ZhProviderError:
            raise
        except Exception as exc:  # pragma: no cover
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=False,
                duration_ms=int((perf_counter() - started) * 1000),
                error=exc.__class__.__name__,
                input_size=input_size,
            )
            raise ZhProviderError(self._format_provider_error("Provider call failed", exc)) from exc

    def generate_with_tools(
        self,
        *,
        task: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str | None = None,
    ) -> ToolsResponse:
        """Run model completion with ModelCompat function calling.

        OPT-4: ``model`` optionally overrides the default. Used by BaseHandler
        when ``route_model()`` picks a fast/powerful tier.
        """
        if not self.is_enabled():
            raise ZhProviderNotConfiguredError("辅助 provider is disabled or misconfigured")

        started = perf_counter()
        input_size = sum(len(str(m.get("content", ""))) for m in messages)
        active_model = self._resolve_model(model)

        try:
            client = self._get_client()
            try:
                response = client.chat.completions.create(**self._build_tool_kwargs(
                    messages=messages,
                    tools=tools,
                    include_tool_choice=True,
                    model_override=model,
                ))
            except Exception as exc:
                if not tools or not self._is_bad_request_error(exc):
                    raise
                response = client.chat.completions.create(**self._build_tool_kwargs(
                    messages=messages,
                    tools=tools,
                    include_tool_choice=False,
                    model_override=model,
                ))
            choice = response.choices[0]
            msg = choice.message

            tool_calls: list[ToolCallRequest] = []
            if msg.tool_calls:
                for tc in msg.tool_calls:
                    try:
                        args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        args = {}
                    tool_calls.append(ToolCallRequest(
                        id=tc.id,
                        name=tc.function.name,
                        arguments=args,
                    ))

            content = msg.content or ""
            # B2: Capture reasoning_content (reasoning models, o1/o3).
            # Per provider docs we must NOT send reasoning back — caller only
            # emits it as a UI-facing THINKING step and strips from messages.
            reasoning = getattr(msg, "reasoning_content", None) or ""

            resp_usage = getattr(response, "usage", None)
            usage: dict[str, Any] = {}
            if resp_usage:
                usage = {
                    "input_tokens": getattr(resp_usage, "prompt_tokens", 0),
                    "output_tokens": getattr(resp_usage, "completion_tokens", 0),
                }
                # A4: Prompt-cache telemetry. Auto-caching is free on some providers
                # (prompt_cache_hit_tokens) and transparent on others
                # (prompt_tokens_details.cached_tokens). We just record the stats.
                cache_hit = getattr(resp_usage, "prompt_cache_hit_tokens", None)
                cache_miss = getattr(resp_usage, "prompt_cache_miss_tokens", None)
                if cache_hit is not None:
                    usage["cache_hit_tokens"] = cache_hit
                if cache_miss is not None:
                    usage["cache_miss_tokens"] = cache_miss
                details = getattr(resp_usage, "prompt_tokens_details", None)
                if details is not None:
                    cached = getattr(details, "cached_tokens", None)
                    if cached:
                        usage["cache_hit_tokens"] = cached
            if reasoning:
                usage["reasoning_content"] = reasoning
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=True,
                duration_ms=int((perf_counter() - started) * 1000),
                input_size=input_size,
                output_size=len(content) + sum(len(str(tc["arguments"])) for tc in tool_calls),
            )
            return ToolsResponse(content=content or None, tool_calls=tool_calls, usage=usage)
        except ZhProviderError:
            raise
        except Exception as exc:
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=False,
                duration_ms=int((perf_counter() - started) * 1000),
                error=exc.__class__.__name__,
                input_size=input_size,
            )
            raise ZhProviderError(self._format_provider_error("LLM call failed", exc)) from exc

    # ── Phase H2: Streaming ──

    def supports_streaming(self) -> bool:
        return True

    @staticmethod
    def _is_bad_request_error(exc: Exception) -> bool:
        return exc.__class__.__name__ == "BadRequestError"

    @staticmethod
    def _format_stream_error(exc: Exception) -> str:
        detail = str(exc).strip()
        if detail:
            return f"Stream failed: {exc.__class__.__name__}: {detail}"
        return f"Stream failed: {exc.__class__.__name__}"

    @staticmethod
    def _format_provider_error(prefix: str, exc: Exception) -> str:
        detail = str(exc).strip()
        if detail:
            return f"{prefix}: {exc.__class__.__name__}: {detail}"
        return f"{prefix}: {exc.__class__.__name__}"

    def _build_tool_kwargs(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        include_tool_choice: bool,
        model_override: str | None = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self._resolve_model(model_override),
            "messages": messages,
        }
        if not self._is_reasoning_model(model_override):
            kwargs["temperature"] = 0
        if tools:
            kwargs["tools"] = tools
            if include_tool_choice:
                kwargs["tool_choice"] = "auto"
        return kwargs

    def _build_stream_kwargs(
        self,
        *,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        include_usage: bool,
        model_override: str | None = None,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self._resolve_model(model_override),
            "messages": messages,
            "stream": True,
        }
        if not self._is_reasoning_model(model_override):
            kwargs["temperature"] = 0
        if include_usage:
            kwargs["stream_options"] = {"include_usage": True}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        return kwargs

    def _fallback_sync_stream(
        self,
        *,
        task: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str | None = None,
    ) -> Iterator[StreamEvent]:
        kwargs: dict[str, Any] = {"task": task, "messages": messages, "tools": tools}
        if model is not None:
            kwargs["model"] = model
        response = self.generate_with_tools(**kwargs)
        content = response.get("content") or ""
        if content:
            yield StreamEvent(type="content_delta", text=content)
        for tc in response.get("tool_calls", []):
            yield StreamEvent(type="tool_call", tool_call=tc)
        yield StreamEvent(type="done", content=content or None, usage={})

    def generate_with_tools_stream(
        self,
        *,
        task: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        model: str | None = None,
    ) -> Iterator[StreamEvent]:
        """Stream tool calls and content as they arrive from the model.

        Yields:
            - {"type": "content_delta", "text": <str>} for each content chunk.
            - {"type": "tool_call", "tool_call": {id, name, arguments}}
              as each tool_call is fully assembled (finish_reason or index change).
            - {"type": "done", "content": <full_text>, "usage": {...}} when the
              stream ends successfully.
            - {"type": "error", "error": <str>} on provider failure.
        """
        if not self.is_enabled():
            yield StreamEvent(type="error", error="辅助 provider is disabled or misconfigured")
            return

        started = perf_counter()
        input_size = sum(len(str(m.get("content", ""))) for m in messages)

        # Buffers for incremental tool call assembly, keyed by ModelCompat index.
        partial: dict[int, dict[str, Any]] = {}
        emitted_indices: set[int] = set()
        full_content = ""
        full_reasoning = ""  # B2: accumulate reasoning_content deltas
        usage: dict[str, Any] = {}
        has_stream_output = False

        def _try_emit(idx: int) -> StreamEvent | None:
            """If the tool call at idx has complete JSON args, mark emitted and return event."""
            if idx in emitted_indices:
                return None
            p = partial.get(idx)
            if not p or not p.get("id") or not p.get("name"):
                return None
            raw_args = p.get("arguments", "")
            try:
                parsed = json.loads(raw_args) if raw_args else {}
            except json.JSONDecodeError:
                return None
            emitted_indices.add(idx)
            return StreamEvent(
                type="tool_call",
                tool_call=ToolCallRequest(
                    id=p["id"], name=p["name"], arguments=parsed
                ),
            )

        try:
            client = self._get_client()
            try:
                stream = client.chat.completions.create(**self._build_stream_kwargs(
                    messages=messages,
                    tools=tools,
                    include_usage=True,
                    model_override=model,
                ))
            except Exception as exc:
                if not self._is_bad_request_error(exc):
                    raise
                stream = client.chat.completions.create(**self._build_stream_kwargs(
                    messages=messages,
                    tools=tools,
                    include_usage=False,
                    model_override=model,
                ))

            for chunk in stream:
                # Usage is typically in the final chunk with empty choices.
                chunk_usage = getattr(chunk, "usage", None)
                if chunk_usage is not None:
                    usage = {
                        "input_tokens": getattr(chunk_usage, "prompt_tokens", 0),
                        "output_tokens": getattr(chunk_usage, "completion_tokens", 0),
                    }
                    # A4: prompt-cache telemetry (same sources as non-stream path).
                    cache_hit = getattr(chunk_usage, "prompt_cache_hit_tokens", None)
                    cache_miss = getattr(chunk_usage, "prompt_cache_miss_tokens", None)
                    if cache_hit is not None:
                        usage["cache_hit_tokens"] = cache_hit
                    if cache_miss is not None:
                        usage["cache_miss_tokens"] = cache_miss
                    details = getattr(chunk_usage, "prompt_tokens_details", None)
                    if details is not None:
                        cached = getattr(details, "cached_tokens", None)
                        if cached:
                            usage["cache_hit_tokens"] = cached

                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = getattr(choice, "delta", None)
                if delta is None:
                    continue

                # ── Content delta ──
                text_chunk = getattr(delta, "content", None)
                if text_chunk:
                    full_content += text_chunk
                    has_stream_output = True
                    yield StreamEvent(type="content_delta", text=text_chunk)

                # B2: reasoning_content delta (collected, not streamed — surfaced
                # at done-time so the orchestrator emits a single THINKING step).
                reasoning_chunk = getattr(delta, "reasoning_content", None)
                if reasoning_chunk:
                    full_reasoning += reasoning_chunk

                # ── Tool call deltas ──
                tc_deltas = getattr(delta, "tool_calls", None) or []
                for tcd in tc_deltas:
                    idx = getattr(tcd, "index", 0) or 0
                    entry = partial.setdefault(
                        idx, {"id": None, "name": None, "arguments": ""}
                    )
                    if getattr(tcd, "id", None):
                        entry["id"] = tcd.id
                    fn = getattr(tcd, "function", None)
                    if fn is not None:
                        if getattr(fn, "name", None):
                            entry["name"] = fn.name
                        fn_args = getattr(fn, "arguments", None)
                        if fn_args:
                            entry["arguments"] += fn_args

                    # Try to emit as soon as JSON is complete.
                    # Many providers send arguments in a single chunk — emit immediately.
                    evt = _try_emit(idx)
                    if evt is not None:
                        has_stream_output = True
                        yield evt

                # ── Finish: emit any remaining tool calls ──
                finish = getattr(choice, "finish_reason", None)
                if finish:
                    for idx in sorted(partial.keys()):
                        evt = _try_emit(idx)
                        if evt is not None:
                            has_stream_output = True
                            yield evt

            # ── Stream ended successfully ──
            output_size = (
                len(full_content)
                + sum(len(p.get("arguments", "")) for p in partial.values())
            )
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=True,
                duration_ms=int((perf_counter() - started) * 1000),
                input_size=input_size,
                output_size=output_size,
            )
            if full_reasoning:
                usage["reasoning_content"] = full_reasoning
            yield StreamEvent(
                type="done",
                content=full_content or None,
                usage=usage,
            )
        except Exception as exc:  # pragma: no cover — network failures
            if not has_stream_output and self._is_bad_request_error(exc):
                try:
                    yield from self._fallback_sync_stream(
                        task=task,
                        messages=messages,
                        tools=tools,
                        model=model,
                    )
                    return
                except Exception as fallback_exc:
                    exc = fallback_exc
            log_zh_call(
                task=task,
                provider=self._settings.provider,
                model=self._settings.model,
                success=False,
                duration_ms=int((perf_counter() - started) * 1000),
                error=exc.__class__.__name__,
                input_size=input_size,
            )
            yield StreamEvent(
                type="error",
                error=self._format_stream_error(exc),
            )
