"""add app_version_lineage table

Revision ID: 2b6e1e8b3b0a
Revises: 7e3c1a5b6f0a
Create Date: 2026-01-07 12:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "2b6e1e8b3b0a"
down_revision: Union[str, Sequence[str], None] = "7e3c1a5b6f0a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "app_version_lineage",
        sa.Column("app_version_id", sa.Integer(), nullable=False),
        sa.Column("previous_version_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["app_version_id"],
            ["app_versions.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["previous_version_id"],
            ["app_versions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("app_version_id", "previous_version_id"),
    )
    op.create_index(
        "ix_app_version_lineage_app_version_id",
        "app_version_lineage",
        ["app_version_id"],
        unique=False,
    )
    op.create_index(
        "ix_app_version_lineage_previous_version_id",
        "app_version_lineage",
        ["previous_version_id"],
        unique=False,
    )
    op.execute("""
        INSERT INTO app_version_lineage (app_version_id, previous_version_id)
        SELECT id, previous_version_id
        FROM app_versions
        WHERE previous_version_id IS NOT NULL
        """)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        "ix_app_version_lineage_previous_version_id",
        table_name="app_version_lineage",
    )
    op.drop_index(
        "ix_app_version_lineage_app_version_id",
        table_name="app_version_lineage",
    )
    op.drop_table("app_version_lineage")
