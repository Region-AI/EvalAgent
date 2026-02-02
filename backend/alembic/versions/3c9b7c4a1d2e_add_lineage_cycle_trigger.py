"""add lineage cycle prevention trigger

Revision ID: 3c9b7c4a1d2e
Revises: 2b6e1e8b3b0a
Create Date: 2026-01-07 12:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "3c9b7c4a1d2e"
down_revision: Union[str, Sequence[str], None] = "2b6e1e8b3b0a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_app_version_lineage_cycles()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.app_version_id = NEW.previous_version_id THEN
                RAISE EXCEPTION 'app_version_lineage cannot reference itself';
            END IF;

            IF EXISTS (
                WITH RECURSIVE ancestors(id) AS (
                    SELECT previous_version_id
                    FROM app_version_lineage
                    WHERE app_version_id = NEW.previous_version_id
                    UNION
                    SELECT avl.previous_version_id
                    FROM app_version_lineage avl
                    JOIN ancestors a ON avl.app_version_id = a.id
                )
                SELECT 1
                FROM ancestors
                WHERE id = NEW.app_version_id
            ) THEN
                RAISE EXCEPTION 'app_version_lineage cycle detected';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """)
    op.execute("""
        CREATE TRIGGER app_version_lineage_prevent_cycles
        BEFORE INSERT OR UPDATE ON app_version_lineage
        FOR EACH ROW
        EXECUTE FUNCTION prevent_app_version_lineage_cycles();
        """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("""
        DROP TRIGGER IF EXISTS app_version_lineage_prevent_cycles
        ON app_version_lineage;
        """)
    op.execute("DROP FUNCTION IF EXISTS prevent_app_version_lineage_cycles();")
