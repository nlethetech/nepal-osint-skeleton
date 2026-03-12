"""Anthropic Batch API client for cost-effective analysis."""
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, Dict, Any

import aiohttp

logger = logging.getLogger(__name__)

# Anthropic API base URL
ANTHROPIC_API_BASE = "https://api.anthropic.com/v1"


@dataclass
class BatchRequest:
    """Single request within a batch."""
    custom_id: str  # Your ID to track this request (e.g., cluster_id)
    model: str
    max_tokens: int
    messages: List[Dict[str, str]]
    system: Optional[str] = None


@dataclass
class BatchStatus:
    """Status of a batch job."""
    batch_id: str
    status: str  # "processing", "ended", "canceled"
    request_counts: Dict[str, int]  # processing, succeeded, errored, canceled, expired
    created_at: datetime
    ended_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    results_url: Optional[str] = None


@dataclass
class BatchResult:
    """Result for a single request in a batch."""
    custom_id: str
    result_type: str  # "succeeded", "errored", "canceled", "expired"
    message: Optional[Dict[str, Any]] = None  # Claude's response
    error: Optional[Dict[str, Any]] = None


class AnthropicBatchClient:
    """
    Client for Anthropic's Batch API.

    Batch API provides 50% cost reduction for non-time-sensitive requests.
    Results are available within 24 hours.
    """

    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the batch client.

        Args:
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
        """
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            logger.warning("ANTHROPIC_API_KEY not set - batch API will not work")

    def _get_headers(self) -> Dict[str, str]:
        """Get HTTP headers for API requests."""
        return {
            "x-api-key": self.api_key or "",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            "anthropic-beta": "message-batches-2024-09-24",
        }

    async def create_batch(
        self,
        requests: List[BatchRequest],
    ) -> str:
        """
        Create a new batch of requests.

        Args:
            requests: List of BatchRequest objects

        Returns:
            Batch ID string

        Raises:
            Exception if batch creation fails
        """
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")

        # Format requests for API
        formatted_requests = []
        for req in requests:
            request_body = {
                "model": req.model,
                "max_tokens": req.max_tokens,
                "messages": req.messages,
            }
            if req.system:
                request_body["system"] = req.system

            formatted_requests.append({
                "custom_id": req.custom_id,
                "params": request_body,
            })

        payload = {"requests": formatted_requests}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{ANTHROPIC_API_BASE}/messages/batches",
                headers=self._get_headers(),
                json=payload,
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"Batch creation failed: {response.status} - {error_text}")
                    raise Exception(f"Batch creation failed: {error_text}")

                data = await response.json()
                batch_id = data.get("id")
                logger.info(f"Created batch {batch_id} with {len(requests)} requests")
                return batch_id

    async def get_batch_status(self, batch_id: str) -> BatchStatus:
        """
        Get the status of a batch.

        Args:
            batch_id: The batch ID returned from create_batch

        Returns:
            BatchStatus object
        """
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{ANTHROPIC_API_BASE}/messages/batches/{batch_id}",
                headers=self._get_headers(),
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to get batch status: {error_text}")

                data = await response.json()

                return BatchStatus(
                    batch_id=data["id"],
                    status=data["processing_status"],
                    request_counts=data.get("request_counts", {}),
                    created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
                    ended_at=datetime.fromisoformat(data["ended_at"].replace("Z", "+00:00")) if data.get("ended_at") else None,
                    expires_at=datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00")) if data.get("expires_at") else None,
                    results_url=data.get("results_url"),
                )

    async def get_batch_results(self, batch_id: str) -> List[BatchResult]:
        """
        Get the results of a completed batch.

        Args:
            batch_id: The batch ID

        Returns:
            List of BatchResult objects
        """
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")

        # First get the status to get the results URL
        status = await self.get_batch_status(batch_id)

        if status.status != "ended":
            raise Exception(f"Batch not complete. Status: {status.status}")

        if not status.results_url:
            raise Exception("No results URL available")

        # Fetch results from the URL
        async with aiohttp.ClientSession() as session:
            async with session.get(
                status.results_url,
                headers=self._get_headers(),
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to get batch results: {error_text}")

                # Results are JSONL format (one JSON object per line)
                text = await response.text()
                results = []

                import json
                for line in text.strip().split("\n"):
                    if not line:
                        continue
                    data = json.loads(line)

                    result = BatchResult(
                        custom_id=data["custom_id"],
                        result_type=data["result"]["type"],
                        message=data["result"].get("message"),
                        error=data["result"].get("error"),
                    )
                    results.append(result)

                return results

    async def cancel_batch(self, batch_id: str) -> bool:
        """
        Cancel a pending batch.

        Args:
            batch_id: The batch ID to cancel

        Returns:
            True if cancellation was successful
        """
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{ANTHROPIC_API_BASE}/messages/batches/{batch_id}/cancel",
                headers=self._get_headers(),
            ) as response:
                return response.status == 200

    async def list_batches(self, limit: int = 20) -> List[BatchStatus]:
        """
        List recent batches.

        Args:
            limit: Maximum number of batches to return

        Returns:
            List of BatchStatus objects
        """
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY not configured")

        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{ANTHROPIC_API_BASE}/messages/batches",
                headers=self._get_headers(),
                params={"limit": limit},
            ) as response:
                if response.status != 200:
                    error_text = await response.text()
                    raise Exception(f"Failed to list batches: {error_text}")

                data = await response.json()
                batches = []

                for item in data.get("data", []):
                    batch = BatchStatus(
                        batch_id=item["id"],
                        status=item["processing_status"],
                        request_counts=item.get("request_counts", {}),
                        created_at=datetime.fromisoformat(item["created_at"].replace("Z", "+00:00")),
                        ended_at=datetime.fromisoformat(item["ended_at"].replace("Z", "+00:00")) if item.get("ended_at") else None,
                        results_url=item.get("results_url"),
                    )
                    batches.append(batch)

                return batches


# Singleton instance
_client_instance: Optional[AnthropicBatchClient] = None


def get_anthropic_client() -> AnthropicBatchClient:
    """Get the global AnthropicBatchClient singleton."""
    global _client_instance
    if _client_instance is None:
        _client_instance = AnthropicBatchClient()
    return _client_instance
