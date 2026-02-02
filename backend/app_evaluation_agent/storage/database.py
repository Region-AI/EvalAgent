import logging

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app_evaluation_agent.utils.config import settings

logger = logging.getLogger(__name__)

# Create the async engine
engine = create_async_engine(
    settings.database.url,
    echo=True,
    pool_pre_ping=True,
)
logger.debug("Async engine created with echo=True")

# Create a configured "Session" class
AsyncSessionLocal = async_sessionmaker(
    bind=engine, autocommit=False, autoflush=False, expire_on_commit=False
)


async def get_db_session():
    """Dependency to get a DB session."""
    async with AsyncSessionLocal() as session:
        logger.debug("Yielding new database session")
        yield session
