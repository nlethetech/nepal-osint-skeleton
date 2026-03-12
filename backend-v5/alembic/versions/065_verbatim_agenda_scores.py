"""Add agenda_items and speaker_scores JSONB to verbatim_sessions.

Revision ID: 065
Revises: 064
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "065"
down_revision = "064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("verbatim_sessions", sa.Column("agenda_items", JSONB, nullable=True))
    op.add_column("verbatim_sessions", sa.Column("speaker_scores", JSONB, nullable=True))
    # Reset all sessions so they get re-analyzed with the new schema
    op.execute("UPDATE verbatim_sessions SET is_analyzed = false")


def downgrade() -> None:
    op.drop_column("verbatim_sessions", "speaker_scores")
    op.drop_column("verbatim_sessions", "agenda_items")
