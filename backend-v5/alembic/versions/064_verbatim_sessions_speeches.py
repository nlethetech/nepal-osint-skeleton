"""Verbatim sessions and parliamentary speeches tables.

Revision ID: 064
Revises: 063
Create Date: 2026-03-08
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "064"
down_revision = "063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "verbatim_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("pdf_url", sa.Text(), nullable=False, unique=True),
        sa.Column("title_ne", sa.Text()),
        sa.Column("session_no", sa.Integer()),
        sa.Column("meeting_no", sa.Integer()),
        sa.Column("session_date_bs", sa.String(50)),
        sa.Column("session_date", sa.Date()),
        sa.Column("chamber", sa.String(10), server_default="hor"),
        sa.Column("raw_text", sa.Text()),
        sa.Column("page_count", sa.Integer(), server_default="0"),
        sa.Column("speech_count", sa.Integer(), server_default="0"),
        sa.Column("is_processed", sa.Boolean(), server_default="false"),
        sa.Column("is_analyzed", sa.Boolean(), server_default="false"),
        sa.Column("session_summary", sa.Text()),
        sa.Column("key_topics", JSONB()),
        sa.Column("bills_discussed", JSONB()),
        sa.Column("scraped_at", sa.DateTime(timezone=True)),
        sa.Column("analyzed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_verbatim_session_date", "verbatim_sessions", ["session_date"])
    op.create_index("idx_verbatim_session_no", "verbatim_sessions", ["session_no", "meeting_no"])
    op.create_index("idx_verbatim_processed", "verbatim_sessions", ["is_processed"])

    op.create_table(
        "parliamentary_speeches",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("verbatim_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("speaker_name_ne", sa.String(255), nullable=False),
        sa.Column("speaker_name_en", sa.String(255)),
        sa.Column("speaker_party_ne", sa.String(255)),
        sa.Column("speaker_party_en", sa.String(255)),
        sa.Column("speaker_role", sa.String(100)),
        sa.Column("mp_id", UUID(as_uuid=True), sa.ForeignKey("mp_performance.id", ondelete="SET NULL")),
        sa.Column("timestamp", sa.String(20)),
        sa.Column("speech_text", sa.Text(), nullable=False),
        sa.Column("word_count", sa.Integer(), server_default="0"),
        sa.Column("speech_order", sa.Integer(), server_default="0"),
        sa.Column("topics", JSONB()),
        sa.Column("bills_referenced", JSONB()),
        sa.Column("stance", sa.String(50)),
        sa.Column("key_quotes", JSONB()),
        sa.Column("summary_en", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_speech_session", "parliamentary_speeches", ["session_id", "speech_order"])
    op.create_index("idx_speech_mp", "parliamentary_speeches", ["mp_id"])
    op.create_index("idx_speech_speaker", "parliamentary_speeches", ["speaker_name_ne"])
    op.create_index("idx_speech_party", "parliamentary_speeches", ["speaker_party_ne"])


def downgrade() -> None:
    op.drop_table("parliamentary_speeches")
    op.drop_table("verbatim_sessions")
