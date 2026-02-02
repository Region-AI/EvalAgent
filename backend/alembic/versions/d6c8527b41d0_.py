"""empty message

Revision ID: d6c8527b41d0
Revises: 618517873f70
Create Date: 2025-12-13 15:32:36.837965

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "d6c8527b41d0"
down_revision: Union[str, Sequence[str], None] = "618517873f70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add SUMMARIZING value to evaluationstatus enum (PostgreSQL)
    op.execute("ALTER TYPE evaluationstatus ADD VALUE IF NOT EXISTS 'SUMMARIZING';")


def downgrade() -> None:
    """Downgrade schema."""
    # Downgrading enums in PostgreSQL requires recreation; implement if needed.
    # This downgrade is intentionally left as a no-op.
    pass
