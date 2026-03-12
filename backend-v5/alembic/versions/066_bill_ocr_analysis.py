"""Add ocr_text and ai_analysis columns to parliament_bills.

Revision ID: 066
"""
from alembic import op
import sqlalchemy as sa

revision = "066"
down_revision = "065"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("parliament_bills", sa.Column("ocr_text", sa.Text(), nullable=True))
    op.add_column("parliament_bills", sa.Column("ai_analysis", sa.Text(), nullable=True))
    op.add_column("parliament_bills", sa.Column("presented_by", sa.String(255), nullable=True))


def downgrade():
    op.drop_column("parliament_bills", "ocr_text")
    op.drop_column("parliament_bills", "ai_analysis")
    op.drop_column("parliament_bills", "presented_by")
