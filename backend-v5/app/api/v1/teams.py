"""Teams API endpoints for analyst collaboration."""
import logging
import re
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_db, get_current_user, require_analyst
from app.models.user import User
from app.models.team import Team, TeamMembership, TeamRole
from app.schemas.collaboration import (
    TeamCreate,
    TeamUpdate,
    TeamResponse,
    TeamDetailResponse,
    TeamMemberResponse,
    TeamMemberAdd,
    TeamMemberUpdate,
    UserBrief,
    TeamRoleEnum,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/teams", tags=["teams"])


def user_to_brief(user: User) -> UserBrief:
    """Convert User model to UserBrief schema."""
    return UserBrief(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
    )


def slugify(text: str) -> str:
    """Convert text to URL-safe slug."""
    text = text.lower()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = text.strip('-')
    return text


async def get_team_membership(
    team_id: UUID,
    user: User,
    db: AsyncSession,
) -> TeamMembership | None:
    """Get user's membership in a team."""
    result = await db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user.id,
            TeamMembership.is_active == True,
        )
    )
    return result.scalar_one_or_none()


# ============================================================
# Team CRUD Endpoints
# ============================================================

@router.post("", response_model=TeamResponse, status_code=status.HTTP_201_CREATED)
async def create_team(
    data: TeamCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Create a new team."""
    # Generate slug
    slug = slugify(data.name)

    # Check uniqueness
    existing = await db.execute(
        select(Team).where(
            (Team.name == data.name) | (Team.slug == slug)
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A team with this name already exists",
        )

    team = Team(
        name=data.name,
        description=data.description,
        slug=slug,
        specialization=data.specialization,
        is_public=data.is_public,
    )

    db.add(team)
    await db.flush()

    # Add creator as owner
    membership = TeamMembership(
        team_id=team.id,
        user_id=current_user.id,
        role=TeamRole.OWNER,
    )
    db.add(membership)

    await db.commit()
    await db.refresh(team)

    return TeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        slug=team.slug,
        specialization=team.specialization,
        is_public=team.is_public,
        is_active=team.is_active,
        member_count=1,
        created_at=team.created_at,
        updated_at=team.updated_at,
    )


@router.get("", response_model=list[TeamResponse])
async def list_teams(
    my_teams: bool = Query(False, description="Only teams I'm a member of"),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """List teams."""
    query = select(Team).where(Team.is_active == True)

    if my_teams:
        # Get user's team IDs
        memberships = await db.execute(
            select(TeamMembership.team_id).where(
                TeamMembership.user_id == current_user.id,
                TeamMembership.is_active == True,
            )
        )
        team_ids = [m for m in memberships.scalars().all()]
        query = query.where(Team.id.in_(team_ids))
    else:
        # Show public teams or teams user is in
        memberships = await db.execute(
            select(TeamMembership.team_id).where(
                TeamMembership.user_id == current_user.id,
                TeamMembership.is_active == True,
            )
        )
        team_ids = [m for m in memberships.scalars().all()]
        query = query.where(
            (Team.is_public == True) | (Team.id.in_(team_ids))
        )

    if search:
        query = query.where(Team.name.ilike(f"%{search}%"))

    query = query.order_by(Team.name).offset(skip).limit(limit)

    result = await db.execute(query)
    teams = result.scalars().all()

    # Get member counts
    responses = []
    for team in teams:
        count = (await db.execute(
            select(func.count()).where(
                TeamMembership.team_id == team.id,
                TeamMembership.is_active == True,
            )
        )).scalar() or 0

        responses.append(TeamResponse(
            id=team.id,
            name=team.name,
            description=team.description,
            slug=team.slug,
            specialization=team.specialization,
            is_public=team.is_public,
            is_active=team.is_active,
            member_count=count,
            created_at=team.created_at,
            updated_at=team.updated_at,
        ))

    return responses


@router.get("/{team_id}", response_model=TeamDetailResponse)
async def get_team(
    team_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Get team details with members."""
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.is_active == True)
    )
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )

    # Check access
    membership = await get_team_membership(team_id, current_user, db)
    if not team.is_public and not membership and not current_user.is_dev():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this team",
        )

    # Get members
    members_result = await db.execute(
        select(TeamMembership)
        .options(selectinload(TeamMembership.user))
        .where(
            TeamMembership.team_id == team_id,
            TeamMembership.is_active == True,
        )
        .order_by(TeamMembership.role, TeamMembership.joined_at)
    )
    members = members_result.scalars().all()

    return TeamDetailResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        slug=team.slug,
        specialization=team.specialization,
        is_public=team.is_public,
        is_active=team.is_active,
        member_count=len(members),
        created_at=team.created_at,
        updated_at=team.updated_at,
        members=[
            TeamMemberResponse(
                id=m.id,
                user=user_to_brief(m.user),
                role=TeamRoleEnum(m.role.value),
                is_active=m.is_active,
                joined_at=m.joined_at,
            )
            for m in members
        ],
    )


@router.patch("/{team_id}", response_model=TeamResponse)
async def update_team(
    team_id: UUID,
    data: TeamUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update team (admin/owner only)."""
    result = await db.execute(
        select(Team).where(Team.id == team_id)
    )
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )

    # Check permission
    membership = await get_team_membership(team_id, current_user, db)
    if not membership or membership.role not in (TeamRole.OWNER, TeamRole.ADMIN):
        if not current_user.is_dev():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only team admins can update team settings",
            )

    update_data = data.model_dump(exclude_unset=True)

    # Handle name change (update slug too)
    if "name" in update_data:
        new_slug = slugify(update_data["name"])
        existing = await db.execute(
            select(Team).where(
                Team.id != team_id,
                (Team.name == update_data["name"]) | (Team.slug == new_slug)
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A team with this name already exists",
            )
        team.slug = new_slug

    for field, value in update_data.items():
        setattr(team, field, value)

    await db.commit()
    await db.refresh(team)

    member_count = (await db.execute(
        select(func.count()).where(
            TeamMembership.team_id == team.id,
            TeamMembership.is_active == True,
        )
    )).scalar() or 0

    return TeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        slug=team.slug,
        specialization=team.specialization,
        is_public=team.is_public,
        is_active=team.is_active,
        member_count=member_count,
        created_at=team.created_at,
        updated_at=team.updated_at,
    )


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Delete team (owner only) - soft delete."""
    result = await db.execute(
        select(Team).where(Team.id == team_id)
    )
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )

    # Check permission
    membership = await get_team_membership(team_id, current_user, db)
    if not membership or membership.role != TeamRole.OWNER:
        if not current_user.is_dev():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the team owner can delete the team",
            )

    team.is_active = False
    await db.commit()


# ============================================================
# Team Member Endpoints
# ============================================================

@router.post("/{team_id}/members", response_model=TeamMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_member(
    team_id: UUID,
    data: TeamMemberAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Add a member to the team (admin/owner only)."""
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.is_active == True)
    )
    team = result.scalar_one_or_none()

    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )

    # Check permission
    membership = await get_team_membership(team_id, current_user, db)
    if not membership or membership.role not in (TeamRole.OWNER, TeamRole.ADMIN):
        if not current_user.is_dev():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only team admins can add members",
            )

    # Check if user exists
    from app.services.auth_service import AuthService
    auth_service = AuthService(db)
    user = await auth_service.get_user_by_id(data.user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    # Check if already a member
    existing = await get_team_membership(team_id, user, db)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this team",
        )

    # Only owner can add owners/admins
    if data.role in (TeamRoleEnum.OWNER, TeamRoleEnum.ADMIN):
        if membership and membership.role != TeamRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the team owner can assign admin roles",
            )

    new_membership = TeamMembership(
        team_id=team_id,
        user_id=data.user_id,
        role=TeamRole(data.role.value),
        invited_by_id=current_user.id,
    )

    db.add(new_membership)
    await db.commit()
    await db.refresh(new_membership, ["user"])

    return TeamMemberResponse(
        id=new_membership.id,
        user=user_to_brief(new_membership.user),
        role=data.role,
        is_active=new_membership.is_active,
        joined_at=new_membership.joined_at,
    )


@router.patch("/{team_id}/members/{user_id}", response_model=TeamMemberResponse)
async def update_member_role(
    team_id: UUID,
    user_id: UUID,
    data: TeamMemberUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Update a member's role (owner only for admin roles)."""
    # Check team exists
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.is_active == True)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )

    # Check current user's permission
    current_membership = await get_team_membership(team_id, current_user, db)
    if not current_membership or current_membership.role not in (TeamRole.OWNER, TeamRole.ADMIN):
        if not current_user.is_dev():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only team admins can update roles",
            )

    # Get target membership
    result = await db.execute(
        select(TeamMembership)
        .options(selectinload(TeamMembership.user))
        .where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
            TeamMembership.is_active == True,
        )
    )
    target_membership = result.scalar_one_or_none()

    if not target_membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    # Only owner can change to/from admin/owner roles
    if data.role in (TeamRoleEnum.OWNER, TeamRoleEnum.ADMIN) or \
       target_membership.role in (TeamRole.OWNER, TeamRole.ADMIN):
        if current_membership and current_membership.role != TeamRole.OWNER:
            if not current_user.is_dev():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the team owner can modify admin roles",
                )

    target_membership.role = TeamRole(data.role.value)
    await db.commit()
    await db.refresh(target_membership)

    return TeamMemberResponse(
        id=target_membership.id,
        user=user_to_brief(target_membership.user),
        role=data.role,
        is_active=target_membership.is_active,
        joined_at=target_membership.joined_at,
    )


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    team_id: UUID,
    user_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Remove a member from the team."""
    # Check team exists
    result = await db.execute(
        select(Team).where(Team.id == team_id, Team.is_active == True)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found",
        )

    # Get target membership
    result = await db.execute(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
            TeamMembership.is_active == True,
        )
    )
    target_membership = result.scalar_one_or_none()

    if not target_membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found",
        )

    # Users can remove themselves
    if user_id == current_user.id:
        if target_membership.role == TeamRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Owner cannot leave the team. Transfer ownership first.",
            )
        target_membership.is_active = False
        await db.commit()
        return

    # Check permission for removing others
    current_membership = await get_team_membership(team_id, current_user, db)
    if not current_membership or current_membership.role not in (TeamRole.OWNER, TeamRole.ADMIN):
        if not current_user.is_dev():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only team admins can remove members",
            )

    # Only owner can remove admins
    if target_membership.role in (TeamRole.OWNER, TeamRole.ADMIN):
        if current_membership and current_membership.role != TeamRole.OWNER:
            if not current_user.is_dev():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the team owner can remove admins",
                )

    # Cannot remove owner
    if target_membership.role == TeamRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot remove the team owner",
        )

    target_membership.is_active = False
    await db.commit()


@router.post("/{team_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_team(
    team_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_analyst),
):
    """Leave a team."""
    membership = await get_team_membership(team_id, current_user, db)

    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="You are not a member of this team",
        )

    if membership.role == TeamRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Owner cannot leave the team. Transfer ownership first.",
        )

    membership.is_active = False
    await db.commit()
