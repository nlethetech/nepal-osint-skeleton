"""Add editorial control plane tables and moderation metadata.

Revision ID: 069
Revises: 068
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "069"
down_revision = "068"
branch_labels = None
depends_on = None


AUTOMATION_KEYS = (
    "fact_check_generation",
    "developing_story_bluf",
    "story_tracker_refresh",
    "haiku_relevance",
    "haiku_summary",
    "analyst_brief_generation",
)


def upgrade() -> None:
    op.create_table(
        "automation_controls",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("automation_key", sa.String(length=80), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("last_changed_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_rerun_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_status", sa.String(length=20), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["last_changed_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("automation_key"),
    )
    op.create_index(op.f("ix_automation_controls_automation_key"), "automation_controls", ["automation_key"], unique=True)

    op.create_table(
        "fact_check_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("fact_check_result_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("workflow_status", sa.String(length=30), nullable=False, server_default="pending_review"),
        sa.Column("final_verdict", sa.String(length=30), nullable=True),
        sa.Column("final_verdict_summary", sa.Text(), nullable=True),
        sa.Column("final_confidence", sa.Float(), nullable=True),
        sa.Column("final_key_finding", sa.Text(), nullable=True),
        sa.Column("final_context", sa.Text(), nullable=True),
        sa.Column("override_notes", sa.Text(), nullable=True),
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("needs_rerun", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("rerun_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rerun_requested_by_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["fact_check_result_id"], ["fact_check_results.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rejected_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["rerun_requested_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("fact_check_result_id"),
    )
    op.create_index(op.f("ix_fact_check_reviews_fact_check_result_id"), "fact_check_reviews", ["fact_check_result_id"], unique=True)
    op.create_index(op.f("ix_fact_check_reviews_workflow_status"), "fact_check_reviews", ["workflow_status"], unique=False)

    op.add_column("story_narratives", sa.Column("workflow_status", sa.String(length=20), nullable=False, server_default="approved"))
    op.add_column("story_narratives", sa.Column("review_notes", sa.Text(), nullable=True))
    op.add_column("story_narratives", sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("story_narratives", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("story_narratives", sa.Column("rejected_by_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("story_narratives", sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index(op.f("ix_story_narratives_workflow_status"), "story_narratives", ["workflow_status"], unique=False)
    op.create_foreign_key(
        "fk_story_narratives_approved_by_id_users",
        "story_narratives",
        "users",
        ["approved_by_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_story_narratives_rejected_by_id_users",
        "story_narratives",
        "users",
        ["rejected_by_id"],
        ["id"],
        ondelete="SET NULL",
    )

    for automation_key in AUTOMATION_KEYS:
        op.execute(
            sa.text(
                """
                INSERT INTO automation_controls (id, automation_key, is_enabled)
                VALUES (gen_random_uuid(), :automation_key, true)
                """
            ).bindparams(automation_key=automation_key)
        )

    op.execute(
        """
        INSERT INTO fact_check_reviews (
            id,
            fact_check_result_id,
            workflow_status,
            final_verdict,
            final_verdict_summary,
            final_confidence,
            final_key_finding,
            final_context,
            created_at,
            updated_at
        )
        SELECT
            gen_random_uuid(),
            fcr.id,
            'approved',
            fcr.verdict,
            fcr.verdict_summary,
            fcr.confidence,
            fcr.key_finding,
            fcr.context,
            now(),
            now()
        FROM fact_check_results fcr
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_story_narratives_rejected_by_id_users", "story_narratives", type_="foreignkey")
    op.drop_constraint("fk_story_narratives_approved_by_id_users", "story_narratives", type_="foreignkey")
    op.drop_index(op.f("ix_story_narratives_workflow_status"), table_name="story_narratives")
    op.drop_column("story_narratives", "rejected_at")
    op.drop_column("story_narratives", "rejected_by_id")
    op.drop_column("story_narratives", "approved_at")
    op.drop_column("story_narratives", "approved_by_id")
    op.drop_column("story_narratives", "review_notes")
    op.drop_column("story_narratives", "workflow_status")

    op.drop_index(op.f("ix_fact_check_reviews_workflow_status"), table_name="fact_check_reviews")
    op.drop_index(op.f("ix_fact_check_reviews_fact_check_result_id"), table_name="fact_check_reviews")
    op.drop_table("fact_check_reviews")

    op.drop_index(op.f("ix_automation_controls_automation_key"), table_name="automation_controls")
    op.drop_table("automation_controls")
