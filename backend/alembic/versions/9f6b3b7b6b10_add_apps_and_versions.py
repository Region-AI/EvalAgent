"""add apps and app_versions

Revision ID: 9f6b3b7b6b10
Revises: d6c8527b41d0
Create Date: 2025-12-24 15:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "9f6b3b7b6b10"
down_revision: Union[str, Sequence[str], None] = "d6c8527b41d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    app_type_enum = postgresql.ENUM(
        "desktop_app",
        "web_app",
        name="apptype",
        create_type=False,
    )
    op.create_table(
        "apps",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("app_type", app_type_enum, nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_apps_id"), "apps", ["id"], unique=False)
    op.create_index(op.f("ix_apps_name"), "apps", ["name"], unique=False)

    op.create_table(
        "app_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("app_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(), nullable=False),
        sa.Column("artifact_uri", sa.String(), nullable=True),
        sa.Column("app_url", sa.String(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["app_id"], ["apps.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("app_id", "version", name="uq_app_version"),
    )
    op.create_index(
        op.f("ix_app_versions_app_id"), "app_versions", ["app_id"], unique=False
    )
    op.create_index(op.f("ix_app_versions_id"), "app_versions", ["id"], unique=False)

    op.add_column(
        "evaluations", sa.Column("app_version_id", sa.Integer(), nullable=True)
    )
    op.create_index(
        op.f("ix_evaluations_app_version_id"),
        "evaluations",
        ["app_version_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_evaluations_app_version_id",
        "evaluations",
        "app_versions",
        ["app_version_id"],
        ["id"],
    )

    op.execute("""
        INSERT INTO apps (name, app_type, created_at)
        SELECT DISTINCT
            COALESCE(app_url, app_path, CONCAT('legacy-app-', id)),
            app_type,
            created_at
        FROM evaluations
        """)

    op.execute("""
        INSERT INTO app_versions (app_id, version, artifact_uri, app_url, created_at)
        SELECT
            a.id,
            CONCAT('legacy-', e.id),
            e.app_path,
            e.app_url,
            e.created_at
        FROM evaluations e
        JOIN apps a
          ON a.name = COALESCE(e.app_url, e.app_path, CONCAT('legacy-app-', e.id))
         AND a.app_type = e.app_type
        """)

    op.execute("""
        UPDATE evaluations e
        SET app_version_id = av.id
        FROM app_versions av
        JOIN apps a ON av.app_id = a.id
        WHERE av.version = CONCAT('legacy-', e.id)
          AND a.name = COALESCE(e.app_url, e.app_path, CONCAT('legacy-app-', e.id))
          AND a.app_type = e.app_type
        """)

    op.alter_column("evaluations", "app_version_id", nullable=False)
    op.drop_column("evaluations", "app_path")
    op.drop_column("evaluations", "app_url")
    op.drop_column("evaluations", "app_type")


def downgrade() -> None:
    """Downgrade schema."""
    app_type_enum = postgresql.ENUM(
        "desktop_app",
        "web_app",
        name="apptype",
        create_type=False,
    )
    op.add_column(
        "evaluations",
        sa.Column(
            "app_type",
            app_type_enum,
            nullable=True,
        ),
    )
    op.add_column("evaluations", sa.Column("app_url", sa.String(), nullable=True))
    op.add_column("evaluations", sa.Column("app_path", sa.String(), nullable=True))

    op.execute("""
        UPDATE evaluations e
        SET app_url = av.app_url,
            app_path = av.artifact_uri,
            app_type = a.app_type
        FROM app_versions av
        JOIN apps a ON av.app_id = a.id
        WHERE e.app_version_id = av.id
        """)

    op.drop_constraint(
        "fk_evaluations_app_version_id", "evaluations", type_="foreignkey"
    )
    op.drop_index(op.f("ix_evaluations_app_version_id"), table_name="evaluations")
    op.drop_column("evaluations", "app_version_id")

    op.drop_index(op.f("ix_app_versions_id"), table_name="app_versions")
    op.drop_index(op.f("ix_app_versions_app_id"), table_name="app_versions")
    op.drop_table("app_versions")

    op.drop_index(op.f("ix_apps_id"), table_name="apps")
    op.drop_index(op.f("ix_apps_name"), table_name="apps")
    op.drop_table("apps")
