"""add bug tracing tables

Revision ID: 4f1c2d9a8b7e
Revises: 3c9b7c4a1d2e
Create Date: 2026-01-07 16:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

# revision identifiers, used by Alembic.
revision: str = "4f1c2d9a8b7e"
down_revision: Union[str, Sequence[str], None] = "3c9b7c4a1d2e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bugseverity') THEN
                CREATE TYPE bugseverity AS ENUM ('P0', 'P1', 'P2', 'P3');
            END IF;
        END$$;
        """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bugstatus') THEN
                CREATE TYPE bugstatus AS ENUM (
                    'NEW',
                    'IN_PROGRESS',
                    'PENDING_VERIFICATION',
                    'CLOSED',
                    'REOPENED'
                );
            END IF;
        END$$;
        """)
    bugseverity = pg.ENUM("P0", "P1", "P2", "P3", name="bugseverity", create_type=False)
    bugstatus = pg.ENUM(
        "NEW",
        "IN_PROGRESS",
        "PENDING_VERIFICATION",
        "CLOSED",
        "REOPENED",
        name="bugstatus",
        create_type=False,
    )

    op.create_table(
        "bugs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("app_id", sa.Integer(), sa.ForeignKey("apps.id"), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("severity_level", bugseverity, nullable=False, server_default="P2"),
        sa.Column("priority", sa.Integer(), nullable=True),
        sa.Column("status", bugstatus, nullable=False, server_default="NEW"),
        sa.Column(
            "discovered_version_id",
            sa.Integer(),
            sa.ForeignKey("app_versions.id"),
            nullable=True,
        ),
        sa.Column("fingerprint", sa.String(), nullable=True),
        sa.Column("environment", sa.JSON(), nullable=True),
        sa.Column("reproduction_steps", sa.JSON(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("app_id", "fingerprint", name="uq_bugs_app_fingerprint"),
    )
    op.create_index("ix_bugs_app_id", "bugs", ["app_id"])
    op.create_index("ix_bugs_discovered_version_id", "bugs", ["discovered_version_id"])
    op.create_index("ix_bugs_fingerprint", "bugs", ["fingerprint"])

    op.create_table(
        "bug_occurrences",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bug_id", sa.Integer(), sa.ForeignKey("bugs.id"), nullable=False),
        sa.Column(
            "evaluation_id",
            sa.Integer(),
            sa.ForeignKey("evaluations.id"),
            nullable=True,
        ),
        sa.Column(
            "test_case_id",
            sa.Integer(),
            sa.ForeignKey("test_cases.id"),
            nullable=True,
        ),
        sa.Column(
            "app_version_id",
            sa.Integer(),
            sa.ForeignKey("app_versions.id"),
            nullable=True,
        ),
        sa.Column("step_index", sa.Integer(), nullable=True),
        sa.Column("action", sa.JSON(), nullable=True),
        sa.Column("expected", sa.Text(), nullable=True),
        sa.Column("actual", sa.Text(), nullable=True),
        sa.Column("result_snapshot", sa.JSON(), nullable=True),
        sa.Column("screenshot_uri", sa.String(), nullable=True),
        sa.Column("log_uri", sa.String(), nullable=True),
        sa.Column("raw_model_coords", sa.JSON(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("executor_id", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_bug_occurrences_bug_id", "bug_occurrences", ["bug_id"])
    op.create_index(
        "ix_bug_occurrences_evaluation_id", "bug_occurrences", ["evaluation_id"]
    )
    op.create_index(
        "ix_bug_occurrences_test_case_id", "bug_occurrences", ["test_case_id"]
    )
    op.create_index(
        "ix_bug_occurrences_app_version_id", "bug_occurrences", ["app_version_id"]
    )

    op.create_table(
        "bug_fixes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bug_id", sa.Integer(), sa.ForeignKey("bugs.id"), nullable=False),
        sa.Column(
            "fixed_in_version_id",
            sa.Integer(),
            sa.ForeignKey("app_versions.id"),
            nullable=False,
        ),
        sa.Column(
            "verified_by_evaluation_id",
            sa.Integer(),
            sa.ForeignKey("evaluations.id"),
            nullable=True,
        ),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
        sa.UniqueConstraint(
            "bug_id", "fixed_in_version_id", name="uq_bug_fixes_bug_version"
        ),
    )
    op.create_index("ix_bug_fixes_bug_id", "bug_fixes", ["bug_id"])
    op.create_index(
        "ix_bug_fixes_fixed_in_version_id", "bug_fixes", ["fixed_in_version_id"]
    )
    op.create_index(
        "ix_bug_fixes_verified_by_evaluation_id",
        "bug_fixes",
        ["verified_by_evaluation_id"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_bug_fixes_verified_by_evaluation_id", table_name="bug_fixes")
    op.drop_index("ix_bug_fixes_fixed_in_version_id", table_name="bug_fixes")
    op.drop_index("ix_bug_fixes_bug_id", table_name="bug_fixes")
    op.drop_table("bug_fixes")

    op.drop_index("ix_bug_occurrences_app_version_id", table_name="bug_occurrences")
    op.drop_index("ix_bug_occurrences_test_case_id", table_name="bug_occurrences")
    op.drop_index("ix_bug_occurrences_evaluation_id", table_name="bug_occurrences")
    op.drop_index("ix_bug_occurrences_bug_id", table_name="bug_occurrences")
    op.drop_table("bug_occurrences")

    op.drop_index("ix_bugs_fingerprint", table_name="bugs")
    op.drop_index("ix_bugs_discovered_version_id", table_name="bugs")
    op.drop_index("ix_bugs_app_id", table_name="bugs")
    op.drop_table("bugs")

    op.execute("DROP TYPE IF EXISTS bugstatus;")
    op.execute("DROP TYPE IF EXISTS bugseverity;")
