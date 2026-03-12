"""Shared OpenAI runtime for embeddings and strict JSON judgments."""
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from app.config import get_settings
from app.core.redis import get_redis

logger = logging.getLogger(__name__)


class OpenAIUsageLimitExceeded(RuntimeError):
    """Raised when Redis-backed OpenAI budget caps are exceeded."""


class UsageLimiter:
    """Simple Redis-backed hourly/daily counter limiter."""

    def __init__(self, settings):
        self.settings = settings

    async def consume(self, bucket: str, units: int, *, per_hour: int, per_day: int) -> None:
        if not self.settings.openai_usage_limit_enabled:
            return

        now = datetime.now(timezone.utc)
        hour_stamp = now.strftime("%Y%m%d%H")
        day_stamp = now.strftime("%Y%m%d")
        await self._consume_key(
            key=f"openai:usage:{bucket}:hour:{hour_stamp}",
            units=units,
            limit=per_hour,
            expiry_seconds=2 * 3600,
        )
        await self._consume_key(
            key=f"openai:usage:{bucket}:day:{day_stamp}",
            units=units,
            limit=per_day,
            expiry_seconds=2 * 86400,
        )

    async def _consume_key(self, *, key: str, units: int, limit: int, expiry_seconds: int) -> None:
        if limit <= 0:
            raise OpenAIUsageLimitExceeded(f"OpenAI usage for {key} is disabled by configuration")

        try:
            redis = await get_redis()
            value = await redis.incrby(key, units)
            if value == units:
                await redis.expire(key, expiry_seconds)
        except OpenAIUsageLimitExceeded:
            raise
        except Exception:
            logger.warning("OpenAI usage limiter unavailable for %s", key, exc_info=True)
            return

        if value > limit:
            raise OpenAIUsageLimitExceeded(
                f"OpenAI usage cap exceeded for {key} ({value}/{limit})"
            )


class OpenAIRuntime:
    """Thin OpenAI REST client with optional Redis caching."""

    def __init__(self):
        self.settings = get_settings()
        self.base_url = self.settings.openai_base_url.rstrip("/")
        self.api_key = self.settings.openai_api_key
        self.limiter = UsageLimiter(self.settings)

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @property
    def embeddings_enabled(self) -> bool:
        return self.available and bool(self.settings.openai_embedding_enabled)

    @property
    def clustering_enabled(self) -> bool:
        return self.available and bool(self.settings.openai_clustering_enabled)

    @property
    def developing_stories_enabled(self) -> bool:
        return self.available and bool(self.settings.openai_developing_stories_enabled)

    @property
    def story_tracker_enabled(self) -> bool:
        return self.available and bool(self.settings.openai_story_tracker_enabled)

    @property
    def agent_enabled(self) -> bool:
        return self.available and bool(self.settings.openai_agent_enabled)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _trim_text(value: Optional[str], limit: int) -> str:
        if not value:
            return ""
        if limit <= 0 or len(value) <= limit:
            return value
        return value[:limit].rstrip()

    async def _cache_get(self, key: str) -> Optional[dict[str, Any]]:
        try:
            redis = await get_redis()
            cached = await redis.get(key)
            if cached:
                return json.loads(cached)
        except Exception:
            logger.debug("OpenAI cache get failed for %s", key, exc_info=True)
        return None

    async def _cache_set(self, key: str, payload: dict[str, Any]) -> None:
        try:
            redis = await get_redis()
            await redis.set(
                key,
                json.dumps(payload, default=str),
                ex=self.settings.openai_cache_ttl_seconds,
            )
        except Exception:
            logger.debug("OpenAI cache set failed for %s", key, exc_info=True)

    @staticmethod
    def _stable_hash(payload: dict[str, Any]) -> str:
        raw = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    async def _consume_request_budget(self, *, bucket: str, request_units: int = 1) -> None:
        await self.limiter.consume(
            "requests",
            request_units,
            per_hour=self.settings.openai_max_requests_per_hour,
            per_day=self.settings.openai_max_requests_per_day,
        )
        if bucket == "embedding":
            return
        if bucket == "structured":
            await self.limiter.consume(
                "structured",
                request_units,
                per_hour=self.settings.openai_max_structured_calls_per_hour,
                per_day=self.settings.openai_max_structured_calls_per_day,
            )
        elif bucket == "agent":
            await self.limiter.consume(
                "agent",
                request_units,
                per_hour=self.settings.openai_max_agent_calls_per_hour,
                per_day=self.settings.openai_max_agent_calls_per_day,
            )

    async def embed_texts(
        self,
        texts: list[str],
        *,
        model: Optional[str] = None,
        dimensions: Optional[int] = None,
        user_scope: str = "default",
    ) -> list[list[float]]:
        """Generate normalized embeddings through the OpenAI embeddings API."""
        if not self.embeddings_enabled:
            raise RuntimeError("OpenAI embeddings are not enabled")

        max_chars = max(1, self.settings.openai_max_embedding_chars_per_text)
        clean_texts = [
            self._trim_text(t.strip(), max_chars) if (t and t.strip()) else " "
            for t in texts
        ]
        model = model or self.settings.openai_embedding_model
        dimensions = dimensions or self.settings.openai_embedding_dimensions

        embeddings: list[Optional[list[float]]] = [None] * len(clean_texts)
        pending_positions: dict[str, list[int]] = {}
        pending_texts: list[str] = []
        pending_cache_keys: list[str] = []

        for idx, text in enumerate(clean_texts):
            item_payload = {
                "model": model,
                "input": text,
                "dimensions": dimensions,
            }
            item_cache_key = f"openai:embedding-item:{user_scope}:{self._stable_hash(item_payload)}"
            cached = await self._cache_get(item_cache_key)
            if cached and isinstance(cached.get("embedding"), list):
                embeddings[idx] = cached["embedding"]
                continue
            if item_cache_key not in pending_positions:
                pending_positions[item_cache_key] = []
                pending_texts.append(text)
                pending_cache_keys.append(item_cache_key)
            pending_positions[item_cache_key].append(idx)

        if not pending_texts:
            return [embedding or [0.0] * dimensions for embedding in embeddings]

        request_payload = {
            "model": model,
            "input": pending_texts,
            "dimensions": dimensions,
        }

        await self._consume_request_budget(bucket="embedding")
        await self.limiter.consume(
            "embedding_texts",
            len(pending_texts),
            per_hour=self.settings.openai_max_embedding_texts_per_hour,
            per_day=self.settings.openai_max_embedding_texts_per_day,
        )

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/embeddings",
                headers=self._headers(),
                json=request_payload,
            )
            response.raise_for_status()
            data = response.json()

        created_embeddings = [row["embedding"] for row in data.get("data", [])]
        for idx, embedding in enumerate(created_embeddings):
            if idx >= len(pending_cache_keys):
                break
            cache_key = pending_cache_keys[idx]
            await self._cache_set(cache_key, {"embedding": embedding})
            for original_idx in pending_positions[cache_key]:
                embeddings[original_idx] = embedding
        return [embedding or [0.0] * dimensions for embedding in embeddings]

    async def json_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema_name: str,
        schema: dict[str, Any],
        model: Optional[str] = None,
        max_completion_tokens: int = 400,
        temperature: float = 0.1,
        cache_scope: str = "default",
        usage_bucket: str = "structured",
    ) -> dict[str, Any]:
        """Run a strict JSON completion using chat completions json_schema output."""
        if not self.available:
            raise RuntimeError("OpenAI API key is not configured")

        model = model or self.settings.openai_clustering_model
        prompt_char_limit = max(1, self.settings.openai_max_structured_prompt_chars)
        capped_tokens = min(
            max_completion_tokens,
            self.settings.openai_max_structured_completion_tokens,
        )
        request_payload = {
            "model": model,
            "temperature": temperature,
            "max_completion_tokens": capped_tokens,
            "messages": [
                {"role": "system", "content": self._trim_text(system_prompt, prompt_char_limit // 3)},
                {"role": "user", "content": self._trim_text(user_prompt, prompt_char_limit)},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                },
            },
        }
        cache_key = f"openai:json:{cache_scope}:{self._stable_hash(request_payload)}"
        cached = await self._cache_get(cache_key)
        if cached and isinstance(cached.get("result"), dict):
            return cached["result"]

        await self._consume_request_budget(bucket=usage_bucket)

        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json=request_payload,
            )
            response.raise_for_status()
            data = response.json()

        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if not content:
            raise ValueError("OpenAI returned empty structured content")
        parsed = json.loads(content)
        await self._cache_set(cache_key, {"result": parsed})
        return parsed

    async def text_completion(
        self,
        *,
        system_prompt: Optional[str],
        user_prompt: str,
        model: str,
        max_completion_tokens: int = 1200,
        temperature: float = 0.1,
        cache_scope: str = "default",
        usage_bucket: str = "agent",
    ) -> str:
        """Run a plain text completion for agent-style JSON prompts."""
        if not self.available:
            raise RuntimeError("OpenAI API key is not configured")

        prompt_char_limit = max(1, self.settings.openai_max_agent_prompt_chars)
        capped_tokens = min(
            max_completion_tokens,
            self.settings.openai_max_agent_completion_tokens,
        )
        request_payload = {
            "model": model,
            "temperature": temperature,
            "max_completion_tokens": capped_tokens,
            "messages": [],
        }
        if system_prompt:
            request_payload["messages"].append(
                {"role": "system", "content": self._trim_text(system_prompt, prompt_char_limit // 3)}
            )
        request_payload["messages"].append(
            {"role": "user", "content": self._trim_text(user_prompt, prompt_char_limit)}
        )

        cache_key = f"openai:text:{cache_scope}:{self._stable_hash(request_payload)}"
        cached = await self._cache_get(cache_key)
        if cached and isinstance(cached.get("content"), str):
            return cached["content"]

        await self._consume_request_budget(bucket=usage_bucket)

        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json=request_payload,
            )
            response.raise_for_status()
            data = response.json()

        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        if isinstance(content, list):
            content = "".join(
                part.get("text", "")
                for part in content
                if isinstance(part, dict)
            )
        content = content.strip() if isinstance(content, str) else ""
        if not content:
            raise ValueError("OpenAI returned empty text content")

        await self._cache_set(cache_key, {"content": content})
        return content


_runtime: Optional[OpenAIRuntime] = None


def get_openai_runtime() -> OpenAIRuntime:
    global _runtime
    if _runtime is None:
        _runtime = OpenAIRuntime()
    return _runtime
