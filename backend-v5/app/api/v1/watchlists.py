"""Watchlist API endpoints for entity and keyword monitoring."""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user, require_analyst
from app.models.user import User
from app.models.team import TeamMembership
from app.models.watchlist import (
    Watchlist,
    WatchlistItem,
    WatchlistMatch,
    WatchlistScope,
)
from app.schemas.collaboration import (
    WatchlistCreate,
    WatchlistUpdate,
    WatchlistResponse,
    WatchlistItemCreate,
    WatchlistItemResponse,
    WatchlistMatchResponse,
    UserBrief,
    WatchlistScopeEnum,
    AlertFrequencyEnum,
    WatchableTypeEnum,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/watchlists", tags=["watchlists"])


def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


async def get_watchlist_with_access(
    watchlist_id: UUID,
    user: User,
    db: AsyncSession,
    require_write: bool = False,
) -> Watchlist:
    """Get a watchlist and verify access."""
    result = await db.execute(
        select(Watchlist)
        .options(selectinload(Watchlist.owner))
        .where(Watchlist.id == watchlist_id)
    )
    watchlist = result.scalar_one_or_none()

    if not watchlist:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Watchlist not found",
        )

    # Owner always has access
    if watchlist.owner_id == user.id:
        return watchlist

    # Dev has access
    if user.is_dev():
        return watchlist

    # Public watchlists - read access for all
    if watchlist.scope == WatchlistScope.PUBLIC:
        if require_write:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the owner can modify this watchlist",
            )
        return watchlist

    # Team watchlists - check membership
    if watchlist.scope == WatchlistScope.TEAM and watchlist.team_id:
        membership = await db.execute(
            select(TeamMembership).where(
                TeamMembership.team_id == watchlist.team_id,
                TeamMembership.user_id == user.id,
                TeamMembership.is_active == True,
            )
        )
        if membership.scalar_one_or_none():
            if require_write:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the owner can modify this watchlist",
                )
            return watchlist

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You don't have access to this watchlist",
    )


# ============================================================
# Watchlist CRUD Endpoints
# ============================================================

@router.post("", response_model=WatchlistResponse, status_code=status.HTTP_201_CREATED)
async def create_watchlist(
    data: WatchlistCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new watchlist."""
    watchlist = Watchlist(
        name=data.name,
        description=data.description,
        scope=data.scope.value,
        alert_frequency=data.alert_frequency.value,
        min_relevance_score=data.min_relevance_score,
        categories_filter=data.categories_filter,
        owner_id=current_user.id,
        team_id=data.team_id,
    )

    db.add(watchlist)
    await db.commit()
    await db.refresh(watchlist, ["owner"])

    return WatchlistResponse(
        id=watchlist.id,
        name=watchlist.name,
        description=watchlist.description,
        scope=WatchlistScopeEnum(watchlist.scope.value),
        alert_frequency=AlertFrequencyEnum(watchlist.alert_frequency.value),
        is_active=watchlist.is_active,
        min_relevance_score=watchlist.min_relevance_score,
        categories_filter=watchlist.categories_filter,
        owner=user_to_brief(watchlist.owner),
        team_id=watchlist.team_id,
        item_count=0,
        total_matches=watchlist.total_matches,
        last_match_at=watchlist.last_match_at,
        created_at=watchlist.created_at,
    )


@router.get("", response_model=list[WatchlistResponse])
async def list_watchlists(
    scope: Optional[WatchlistScopeEnum] = Query(None),
    active_only: bool = Query(True),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List watchlists the user has access to."""
    # Get user's team IDs
    team_memberships = await db.execute(
        select(TeamMembership.team_id).where(
            TeamMembership.user_id == current_user.id,
            TeamMembership.is_active == True,
        )
    )
    user_team_ids = [tm for tm in team_memberships.scalars().all()]

    # Build query
    query = select(Watchlist).options(selectinload(Watchlist.owner))

    # Visibility filter
    visibility_conditions = [
        Watchlist.owner_id == current_user.id,
        Watchlist.scope == WatchlistScope.PUBLIC,
    ]
    if user_team_ids:
        visibility_conditions.append(
            (Watchlist.scope == WatchlistScope.TEAM) &
            (Watchlist.team_id.in_(user_team_ids))
        )

    query = query.where(or_(*visibility_conditions))

    if scope:
        query = query.where(Watchlist.scope == scope.value)
    if active_only:
        query = query.where(Watchlist.is_active == True)

    query = query.order_by(Watchlist.name).offset(skip).limit(limit)

    result = await db.execute(query)
    watchlists = result.scalars().all()

    responses = []
    for w in watchlists:
        item_count = (await db.execute(
            select(func.count()).where(
                WatchlistItem.watchlist_id == w.id,
                WatchlistItem.is_active == True,
            )
        )).scalar() or 0

        responses.append(WatchlistResponse(
            id=w.id,
            name=w.name,
            description=w.description,
            scope=WatchlistScopeEnum(w.scope.value),
            alert_frequency=AlertFrequencyEnum(w.alert_frequency.value),
            is_active=w.is_active,
            min_relevance_score=w.min_relevance_score,
            categories_filter=w.categories_filter,
            owner=user_to_brief(w.owner),
            team_id=w.team_id,
            item_count=item_count,
            total_matches=w.total_matches,
            last_match_at=w.last_match_at,
            created_at=w.created_at,
        ))

    return responses


@router.get("/{watchlist_id}", response_model=WatchlistResponse)
async def get_watchlist(
    watchlist_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get a watchlist by ID."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db)

    item_count = (await db.execute(
        select(func.count()).where(
            WatchlistItem.watchlist_id == watchlist.id,
            WatchlistItem.is_active == True,
        )
    )).scalar() or 0

    return WatchlistResponse(
        id=watchlist.id,
        name=watchlist.name,
        description=watchlist.description,
        scope=WatchlistScopeEnum(watchlist.scope.value),
        alert_frequency=AlertFrequencyEnum(watchlist.alert_frequency.value),
        is_active=watchlist.is_active,
        min_relevance_score=watchlist.min_relevance_score,
        categories_filter=watchlist.categories_filter,
        owner=user_to_brief(watchlist.owner),
        team_id=watchlist.team_id,
        item_count=item_count,
        total_matches=watchlist.total_matches,
        last_match_at=watchlist.last_match_at,
        created_at=watchlist.created_at,
    )


@router.patch("/{watchlist_id}", response_model=WatchlistResponse)
async def update_watchlist(
    watchlist_id: UUID,
    data: WatchlistUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update a watchlist (owner only)."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db, require_write=True)

    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "scope" and value:
            value = value.value
        elif field == "alert_frequency" and value:
            value = value.value
        setattr(watchlist, field, value)

    await db.commit()
    await db.refresh(watchlist)

    item_count = (await db.execute(
        select(func.count()).where(
            WatchlistItem.watchlist_id == watchlist.id,
            WatchlistItem.is_active == True,
        )
    )).scalar() or 0

    return WatchlistResponse(
        id=watchlist.id,
        name=watchlist.name,
        description=watchlist.description,
        scope=WatchlistScopeEnum(watchlist.scope.value),
        alert_frequency=AlertFrequencyEnum(watchlist.alert_frequency.value),
        is_active=watchlist.is_active,
        min_relevance_score=watchlist.min_relevance_score,
        categories_filter=watchlist.categories_filter,
        owner=user_to_brief(watchlist.owner),
        team_id=watchlist.team_id,
        item_count=item_count,
        total_matches=watchlist.total_matches,
        last_match_at=watchlist.last_match_at,
        created_at=watchlist.created_at,
    )


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_watchlist(
    watchlist_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Delete a watchlist (owner only)."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db, require_write=True)
    await db.delete(watchlist)
    await db.commit()


# ============================================================
# Watchlist Item Endpoints
# ============================================================

@router.post("/{watchlist_id}/items", response_model=WatchlistItemResponse, status_code=status.HTTP_201_CREATED)
async def add_watchlist_item(
    watchlist_id: UUID,
    data: WatchlistItemCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add an item to a watchlist."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db, require_write=True)

    # Check for duplicate
    existing = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.watchlist_id == watchlist.id,
            WatchlistItem.item_type == data.item_type.value,
            WatchlistItem.value == data.value,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This item already exists in the watchlist",
        )

    item = WatchlistItem(
        watchlist_id=watchlist.id,
        item_type=data.item_type.value,
        value=data.value,
        reference_id=data.reference_id,
        aliases=data.aliases,
        case_sensitive=data.case_sensitive,
        exact_match=data.exact_match,
        notes=data.notes,
    )

    db.add(item)
    await db.commit()
    await db.refresh(item)

    return WatchlistItemResponse(
        id=item.id,
        watchlist_id=item.watchlist_id,
        item_type=WatchableTypeEnum(item.item_type.value),
        value=item.value,
        reference_id=item.reference_id,
        aliases=item.aliases,
        case_sensitive=item.case_sensitive,
        exact_match=item.exact_match,
        notes=item.notes,
        is_active=item.is_active,
        match_count=item.match_count,
        last_match_at=item.last_match_at,
        created_at=item.created_at,
    )


@router.get("/{watchlist_id}/items", response_model=list[WatchlistItemResponse])
async def list_watchlist_items(
    watchlist_id: UUID,
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List items in a watchlist."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db)

    query = select(WatchlistItem).where(WatchlistItem.watchlist_id == watchlist.id)
    if active_only:
        query = query.where(WatchlistItem.is_active == True)

    query = query.order_by(WatchlistItem.value)

    result = await db.execute(query)
    items = result.scalars().all()

    return [
        WatchlistItemResponse(
            id=item.id,
            watchlist_id=item.watchlist_id,
            item_type=WatchableTypeEnum(item.item_type.value),
            value=item.value,
            reference_id=item.reference_id,
            aliases=item.aliases,
            case_sensitive=item.case_sensitive,
            exact_match=item.exact_match,
            notes=item.notes,
            is_active=item.is_active,
            match_count=item.match_count,
            last_match_at=item.last_match_at,
            created_at=item.created_at,
        )
        for item in items
    ]


@router.delete("/{watchlist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_watchlist_item(
    watchlist_id: UUID,
    item_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Remove an item from a watchlist."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db, require_write=True)

    result = await db.execute(
        select(WatchlistItem).where(
            WatchlistItem.id == item_id,
            WatchlistItem.watchlist_id == watchlist.id,
        )
    )
    item = result.scalar_one_or_none()

    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Item not found",
        )

    await db.delete(item)
    await db.commit()


# ============================================================
# Watchlist Match Endpoints
# ============================================================

@router.get("/{watchlist_id}/matches", response_model=list[WatchlistMatchResponse])
async def list_watchlist_matches(
    watchlist_id: UUID,
    dismissed: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List matches for a watchlist."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db)

    query = select(WatchlistMatch).where(
        WatchlistMatch.watchlist_id == watchlist.id,
        WatchlistMatch.is_dismissed == dismissed,
    ).order_by(WatchlistMatch.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    matches = result.scalars().all()

    return [
        WatchlistMatchResponse(
            id=m.id,
            watchlist_id=m.watchlist_id,
            item_id=m.item_id,
            matched_story_id=m.matched_story_id,
            matched_text=m.matched_text,
            match_context=m.match_context,
            relevance_score=m.relevance_score,
            is_alerted=m.is_alerted,
            is_dismissed=m.is_dismissed,
            created_at=m.created_at,
        )
        for m in matches
    ]


@router.post("/{watchlist_id}/matches/{match_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
async def dismiss_match(
    watchlist_id: UUID,
    match_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Dismiss a watchlist match."""
    watchlist = await get_watchlist_with_access(watchlist_id, current_user, db)

    result = await db.execute(
        select(WatchlistMatch).where(
            WatchlistMatch.id == match_id,
            WatchlistMatch.watchlist_id == watchlist.id,
        )
    )
    match = result.scalar_one_or_none()

    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Match not found",
        )

    match.is_dismissed = True
    match.dismissed_by_id = current_user.id
    await db.commit()
