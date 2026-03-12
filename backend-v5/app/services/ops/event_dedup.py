"""Soft deduplication helpers for event clusters."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import re
from typing import List
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.story import Story


class _UF:
    def __init__(self):
        self.parent: dict[UUID, UUID] = {}

    def find(self, x: UUID) -> UUID:
        if x not in self.parent:
            self.parent[x] = x
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]

    def union(self, a: UUID, b: UUID) -> None:
        ra = self.find(a)
        rb = self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def _story_sort_key(story: Story) -> datetime:
    return story.published_at or datetime.min.replace(tzinfo=timezone.utc)


def _norm_title(title: str) -> str:
    t = (title or "").lower()
    t = re.sub(r"[^\w\s]", " ", t)
    t = " ".join(t.split())
    return t


async def group_stories_by_near_duplicate(
    db: AsyncSession,
    stories: list[Story],
    similarity_threshold: float = 0.95,
) -> list[list[Story]]:
    """
    Group near-identical stories within a cluster.

    Strategy:
    1) Embedding similarity via pgvector (language-agnostic) when available.
    2) Strict normalized-title equality fallback (cheap, avoids over-grouping).

    Returns:
      Groups of Story objects, each group sorted by recency desc,
      and groups sorted by their canonical story recency desc.
    """
    if not stories:
        return []

    sorted_stories = sorted(stories, key=_story_sort_key, reverse=True)
    story_ids = [s.id for s in sorted_stories]
    uf = _UF()

    # 1) Embedding-based links
    if len(story_ids) >= 2:
        max_distance = 1.0 - similarity_threshold
        pairs = await db.execute(
            text(
                """
                SELECT
                    se1.story_id AS id1,
                    se2.story_id AS id2
                FROM story_embeddings se1
                JOIN story_embeddings se2
                  ON se1.story_id < se2.story_id
                WHERE se1.story_id = ANY(:ids)
                  AND se2.story_id = ANY(:ids)
                  AND se1.embedding_vector IS NOT NULL
                  AND se2.embedding_vector IS NOT NULL
                  AND (se1.embedding_vector <=> se2.embedding_vector) <= :max_distance
                """
            ),
            {"ids": story_ids, "max_distance": max_distance},
        )
        for id1, id2 in pairs.fetchall():
            uf.union(id1, id2)

    # 2) Title equality fallback
    by_title: dict[str, UUID] = {}
    for s in sorted_stories:
        key = _norm_title(s.title)
        if not key:
            continue
        if key in by_title:
            uf.union(s.id, by_title[key])
        else:
            by_title[key] = s.id

    buckets: dict[UUID, list[Story]] = defaultdict(list)
    for s in sorted_stories:
        buckets[uf.find(s.id)].append(s)

    groups = [
        sorted(group_stories, key=_story_sort_key, reverse=True)
        for group_stories in buckets.values()
    ]

    groups.sort(key=lambda g: _story_sort_key(g[0]), reverse=True)
    return groups

