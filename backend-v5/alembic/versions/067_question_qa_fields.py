"""Add questioner_name, answer_text, session_label to parliament_questions.

Revision ID: 067
"""
from alembic import op
import sqlalchemy as sa

revision = "067"
down_revision = "066"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "parliament_questions",
        sa.Column("questioner_name", sa.String(200), nullable=True),
    )
    op.add_column(
        "parliament_questions",
        sa.Column("answer_text", sa.Text, nullable=True),
    )
    op.add_column(
        "parliament_questions",
        sa.Column("session_label", sa.String(100), nullable=True),
    )


def downgrade():
    op.drop_column("parliament_questions", "session_label")
    op.drop_column("parliament_questions", "answer_text")
    op.drop_column("parliament_questions", "questioner_name")
