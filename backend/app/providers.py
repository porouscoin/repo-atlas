"""call_model(): one function that talks to every provider.

Groq and Gemini both speak the OpenAI chat format, so one HTTP adapter covers
them. The differences smoothed over here:
- reasoning models may wrap their thinking in <think> tags
- content can be None when the model only calls tools
- tool-call arguments arrive as a JSON string that is sometimes invalid
- Gemini 3 sends a thought signature with each tool call and wants it back

call_any() walks a list of models and moves on when one is rate limited, so
the free tiers of two providers back each other up.
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

from .config import ModelSpec

THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]
    raw_arguments: str = ""
    extra_content: dict[str, Any] | None = None


@dataclass
class ModelResult:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    ms: int = 0
    model: str = ""


class ProviderError(Exception):
    pass


# Tests and local dev can swap in a fake model.
MockFn = Callable[[list[dict], list[dict] | None], ModelResult]
_mock_fn: MockFn | None = None


def set_mock(fn: MockFn | None) -> None:
    global _mock_fn
    _mock_fn = fn


def _default_mock(messages: list[dict], tools: list[dict] | None) -> ModelResult:
    """A rule-based stand-in so the app runs without any API key."""
    system = str(messages[0].get("content", "")).lower()
    last = messages[-1]
    if "tour guide" in system:
        return ModelResult(
            content=json.dumps(
                {
                    "stops": [
                        {"target": "", "title": "The whole repo", "text": "A mock tour. Set GROQ_API_KEY for a real one."},
                    ]
                }
            )
        )
    if "plain english" in system:
        names = re.findall(r"^## (.+?) \(", str(last.get("content", "")), re.M)
        return ModelResult(
            content=json.dumps(
                {"summary": "A mock explanation. Set GROQ_API_KEY for a real one.", "boxes": {n: "A mock role for this part." for n in names}, "start": names[0] if names else ""}
            )
        )
    if "one sentence" in system:
        return ModelResult(content="A mock summary of this file.")
    if tools and last["role"] == "user":
        return ModelResult(content="", tool_calls=[ToolCall("call_1", "search_code", {"query": "def |function "})])
    return ModelResult(content=json.dumps({"answer": "A mock answer.", "files": []}))


def _parse_args(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    except json.JSONDecodeError:
        return {"_invalid_json": raw}


_client: httpx.AsyncClient | None = None


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0))
    return _client


class RateLimited(ProviderError):
    pass


async def call_model(
    spec: ModelSpec,
    messages: list[dict],
    tools: list[dict] | None = None,
    max_tokens: int = 800,
    temperature: float = 0.3,
    json_mode: bool = False,
) -> ModelResult:
    started = time.monotonic()
    if spec.provider == "mock":
        result = (_mock_fn or _default_mock)(messages, tools)
        result.ms = int((time.monotonic() - started) * 1000)
        result.model = "mock"
        return result

    body: dict[str, Any] = {"model": spec.model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if "gpt-oss" in spec.model:
        # Reasoning tokens count against max_tokens; low effort leaves room for the answer.
        body["reasoning_effort"] = "low"
    if tools and spec.supports_tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {spec.api_key}"}

    data: dict[str, Any] | None = None
    for attempt in range(2):
        try:
            resp = await _http().post(f"{spec.base_url}/chat/completions", json=body, headers=headers)
        except httpx.HTTPError as e:
            last_error = f"network error: {type(e).__name__}"
        else:
            if resp.status_code == 200:
                data = resp.json()
                break
            if resp.status_code == 429:
                raise RateLimited(f"{spec.label} is rate limited")
            last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
            if resp.status_code < 500:
                break
        await asyncio.sleep(1.0 * (2**attempt))
    if data is None:
        raise ProviderError(f"{spec.label} failed: {last_error}")

    message = data["choices"][0]["message"]
    content = THINK_RE.sub("", message.get("content") or "").strip()
    tool_calls = [
        ToolCall(
            id=tc.get("id") or f"call_{i}",
            name=tc["function"]["name"],
            arguments=_parse_args(tc["function"].get("arguments", "")),
            raw_arguments=tc["function"].get("arguments", ""),
            extra_content=tc.get("extra_content"),
        )
        for i, tc in enumerate(message.get("tool_calls") or [])
    ]
    usage = data.get("usage") or {}
    return ModelResult(
        content=content,
        tool_calls=tool_calls,
        tokens_in=int(usage.get("prompt_tokens", 0)),
        tokens_out=int(usage.get("completion_tokens", 0)),
        ms=int((time.monotonic() - started) * 1000),
        model=spec.label,
    )


async def call_any(specs: list[ModelSpec], messages: list[dict], **kwargs) -> ModelResult:
    """Try each model in turn until one answers."""
    if not specs:
        raise ProviderError("No model is configured. Set GROQ_API_KEY or GEMINI_API_KEY.")
    errors = []
    for spec in specs:
        try:
            return await call_model(spec, messages, **kwargs)
        except ProviderError as e:
            errors.append(str(e))
    if all("rate limited" in e for e in errors):
        raise RateLimited("The AI is busy right now (free tier limits). Try again in a minute.")
    raise ProviderError("; ".join(errors))


def parse_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return {}
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}
