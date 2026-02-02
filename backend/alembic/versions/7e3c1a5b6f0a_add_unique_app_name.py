"""add unique constraint for app names

Revision ID: 7e3c1a5b6f0a
Revises: 0933bd48a905
Create Date: 2026-01-05 17:22:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "7e3c1a5b6f0a"
down_revision: Union[str, Sequence[str], None] = "0933bd48a905"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_unique_constraint("uq_apps_name", "apps", ["name"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint("uq_apps_name", "apps", type_="unique")
