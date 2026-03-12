"""Add story narratives for strategic tracker outputs.

Revision ID: 068
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "068"
down_revision = "067"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "story_narratives",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("category", sa.String(length=20), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("thesis", sa.Text(), nullable=True),
        sa.Column("direction", sa.String(length=20), nullable=True),
        sa.Column("momentum_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("cluster_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("lead_regions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("lead_entities", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index(op.f("ix_story_narratives_category"), "story_narratives", ["category"], unique=False)
    op.create_index(op.f("ix_story_narratives_first_seen_at"), "story_narratives", ["first_seen_at"], unique=False)
    op.create_index(op.f("ix_story_narratives_last_updated"), "story_narratives", ["last_updated"], unique=False)

    op.create_table(
        "story_narrative_clusters",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("narrative_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("cluster_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("similarity_score", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["narrative_id"], ["story_narratives.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["cluster_id"], ["story_clusters.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("narrative_id", "cluster_id", name="uq_story_narrative_cluster"),
    )
    op.create_index("idx_story_narrative_clusters_narrative", "story_narrative_clusters", ["narrative_id"], unique=False)
    op.create_index("idx_story_narrative_clusters_cluster", "story_narrative_clusters", ["cluster_id"], unique=False)


def downgrade():
    op.drop_index("idx_story_narrative_clusters_cluster", table_name="story_narrative_clusters")
    op.drop_index("idx_story_narrative_clusters_narrative", table_name="story_narrative_clusters")
    op.drop_table("story_narrative_clusters")

    op.drop_index(op.f("ix_story_narratives_last_updated"), table_name="story_narratives")
    op.drop_index(op.f("ix_story_narratives_first_seen_at"), table_name="story_narratives")
    op.drop_index(op.f("ix_story_narratives_category"), table_name="story_narratives")
    op.drop_table("story_narratives")
