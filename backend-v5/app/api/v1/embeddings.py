"""Embeddings API endpoints."""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.story import Story
from app.services.embeddings import EmbeddingService
from app.repositories.embedding import EmbeddingRepository
from app.schemas.analysis import (
    EmbeddingStatsResponse,
    GenerateEmbeddingsRequest,
    GenerateEmbeddingsResponse,
    SimilaritySearchRequest,
    SimilaritySearchResponse,
    SimilarStoryItem,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/embeddings", tags=["embeddings"])


@router.get("/stats", response_model=EmbeddingStatsResponse)
async def get_embedding_stats(
    db: AsyncSession = Depends(get_db),
):
    """Get statistics about embeddings in the database."""
    service = EmbeddingService(db)
    stats = await service.get_embedding_stats()

    return EmbeddingStatsResponse(
        total_embeddings=stats["total_embeddings"],
        recent_24h=stats["recent_24h"],
        model=stats["model"],
        embedding_dim=stats["embedding_dim"],
    )


@router.post("/generate", response_model=GenerateEmbeddingsResponse)
async def generate_embeddings(
    request: GenerateEmbeddingsRequest = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate embeddings for stories that don't have them.

    This is typically run as a background task, but can be
    triggered manually for immediate processing.
    """
    service = EmbeddingService(db)

    hours = request.hours if request else 72
    limit = request.limit if request else 500
    nepal_only = request.nepal_only if request else True

    try:
        stats = await service.batch_generate_embeddings(
            hours=hours,
            limit=limit,
            nepal_only=nepal_only,
        )

        return GenerateEmbeddingsResponse(
            processed=stats.get("processed", 0),
            created=stats.get("created", 0),
            skipped=stats.get("skipped", 0),
            failed=stats.get("failed", 0),
        )

    except Exception as e:
        logger.exception(f"Failed to generate embeddings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search", response_model=SimilaritySearchResponse)
async def search_similar(
    request: SimilaritySearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Search for stories similar to a text query.

    Uses semantic similarity via embeddings.
    """
    service = EmbeddingService(db)

    try:
        results = await service.search_similar(
            query_text=request.query,
            hours=request.hours,
            top_k=request.top_k,
            min_similarity=request.min_similarity,
        )

        # Fetch story details for results
        story_ids = [r[0] for r in results]
        if story_ids:
            story_result = await db.execute(
                select(Story).where(Story.id.in_(story_ids))
            )
            stories = {s.id: s for s in story_result.scalars().all()}
        else:
            stories = {}

        items = []
        for story_id, similarity in results:
            story = stories.get(story_id)
            if story:
                items.append(SimilarStoryItem(
                    story_id=story_id,
                    title=story.title,
                    source_name=story.source_name,
                    similarity=similarity,
                    published_at=story.published_at,
                ))

        return SimilaritySearchResponse(
            query=request.query,
            results=items,
            total_found=len(items),
        )

    except Exception as e:
        logger.exception(f"Failed to search similar stories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/story/{story_id}/similar")
async def get_similar_stories(
    story_id: UUID,
    hours: int = Query(72, le=168),
    top_k: int = Query(10, le=50),
    min_similarity: float = Query(0.6, ge=0.0, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    """
    Find stories similar to a specific story.

    Uses the story's embedding for similarity search.
    """
    service = EmbeddingService(db)

    try:
        results = await service.find_similar_to_story(
            story_id=story_id,
            hours=hours,
            top_k=top_k,
            min_similarity=min_similarity,
        )

        # Fetch story details
        story_ids = [r[0] for r in results]
        if story_ids:
            story_result = await db.execute(
                select(Story).where(Story.id.in_(story_ids))
            )
            stories = {s.id: s for s in story_result.scalars().all()}
        else:
            stories = {}

        items = []
        for sid, similarity in results:
            story = stories.get(sid)
            if story:
                items.append({
                    "story_id": str(sid),
                    "title": story.title,
                    "source_name": story.source_name,
                    "similarity": similarity,
                    "published_at": story.published_at.isoformat() if story.published_at else None,
                })

        return {
            "source_story_id": str(story_id),
            "similar_stories": items,
            "total_found": len(items),
        }

    except Exception as e:
        logger.exception(f"Failed to find similar stories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/story/{story_id}")
async def get_story_embedding(
    story_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Get embedding information for a specific story.

    Note: Does not return the full embedding vector for bandwidth reasons.
    """
    repo = EmbeddingRepository(db)
    embedding = await repo.get_by_story_id(story_id)

    if not embedding:
        raise HTTPException(status_code=404, detail="Embedding not found")

    return {
        "story_id": str(story_id),
        "has_embedding": True,
        "text_hash": embedding.text_hash,
        "model_name": embedding.model_name,
        "model_version": embedding.model_version,
        "created_at": embedding.created_at.isoformat(),
        "updated_at": embedding.updated_at.isoformat() if embedding.updated_at else None,
    }


@router.post("/story/{story_id}/generate")
async def generate_story_embedding(
    story_id: UUID,
    force: bool = Query(False, description="Regenerate even if exists"),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate embedding for a specific story.

    Use force=true to regenerate even if embedding already exists.
    """
    # Get story
    story_result = await db.execute(
        select(Story).where(Story.id == story_id)
    )
    story = story_result.scalar_one_or_none()

    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    service = EmbeddingService(db)

    try:
        result = await service.ensure_story_embedding(
            story_id=story_id,
            title=story.title,
            summary=story.summary,
            content=story.content,
            force=force,
        )

        if result:
            return {
                "success": True,
                "story_id": str(story_id),
                "message": "Embedding generated successfully",
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate embedding",
            )

    except Exception as e:
        logger.exception(f"Failed to generate embedding for story {story_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
