import enum
from sqlalchemy import (
    Column,
    Integer,
    String,
    DateTime,
    Enum,
    JSON,
    Boolean,
    ForeignKey,
    Text,
    UniqueConstraint,
    Table,
    Index,
)
from sqlalchemy.orm import declarative_base, relationship
from sqlalchemy.sql import func

Base = declarative_base()

app_version_lineage = Table(
    "app_version_lineage",
    Base.metadata,
    Column(
        "app_version_id",
        Integer,
        ForeignKey("app_versions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "previous_version_id",
        Integer,
        ForeignKey("app_versions.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)

Index(
    "ix_app_version_lineage_app_version_id",
    app_version_lineage.c.app_version_id,
)
Index(
    "ix_app_version_lineage_previous_version_id",
    app_version_lineage.c.previous_version_id,
)


class EvaluationStatus(enum.Enum):
    PENDING = "PENDING"
    GENERATING = "GENERATING"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    SUMMARIZING = "SUMMARIZING"
    READY = "READY"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class AppType(enum.Enum):
    DESKTOP_APP = "desktop_app"
    WEB_APP = "web_app"


class TestPlanStatus(enum.Enum):
    PENDING = "PENDING"
    GENERATING = "GENERATING"
    READY = "READY"
    COMPLETED = "COMPLETED"


class TestCaseStatus(enum.Enum):
    PENDING = "PENDING"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class BugStatus(enum.Enum):
    NEW = "NEW"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    CLOSED = "CLOSED"
    REOPENED = "REOPENED"


class BugSeverity(enum.Enum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(Integer, primary_key=True, index=True)

    app_version_id = Column(
        Integer, ForeignKey("app_versions.id"), nullable=False, index=True
    )

    status = Column(
        Enum(
            EvaluationStatus,
            name="evaluationstatus",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        default=EvaluationStatus.PENDING,
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    execution_mode = Column(
        String, nullable=False, default="cloud"
    )  # 'cloud' or 'local'
    assigned_executor_id = Column(String, nullable=True, index=True)
    results = Column(JSON, nullable=True)
    local_application_path = Column(String, nullable=True)
    high_level_goal = Column(String, nullable=True)
    run_on_current_screen = Column(Boolean, nullable=False, default=False)

    # Relationships
    app_version = relationship("AppVersion", back_populates="evaluations")
    test_plans = relationship(
        "TestPlan",
        back_populates="evaluation",
        cascade="all, delete-orphan",
    )
    test_cases = relationship(
        "TestCase",
        back_populates="evaluation",
        cascade="all, delete-orphan",
    )

    @property
    def app_name(self) -> str | None:
        if not self.app_version or not self.app_version.app:
            return None
        return self.app_version.app.name

    @property
    def app_url(self) -> str | None:
        if not self.app_version:
            return None
        return self.app_version.app_url

    @property
    def app_path(self) -> str | None:
        if not self.app_version:
            return None
        return self.app_version.artifact_uri


class App(Base):
    __tablename__ = "apps"
    __table_args__ = (UniqueConstraint("name", name="uq_apps_name"),)

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    app_type = Column(
        Enum(
            AppType,
            name="apptype",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=AppType.DESKTOP_APP,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    versions = relationship(
        "AppVersion",
        back_populates="app",
        cascade="all, delete-orphan",
    )


class AppVersion(Base):
    __tablename__ = "app_versions"
    __table_args__ = (UniqueConstraint("app_id", "version", name="uq_app_version"),)

    id = Column(Integer, primary_key=True, index=True)
    app_id = Column(Integer, ForeignKey("apps.id"), nullable=False, index=True)
    previous_version_id = Column(
        Integer, ForeignKey("app_versions.id"), nullable=True, index=True
    )
    version = Column(String, nullable=False)
    artifact_uri = Column(String, nullable=True)
    app_url = Column(String, nullable=True)
    release_date = Column(DateTime(timezone=True), nullable=True)
    change_log = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    app = relationship("App", back_populates="versions")
    evaluations = relationship("Evaluation", back_populates="app_version")
    previous_version = relationship(
        "AppVersion", remote_side=[id], foreign_keys=[previous_version_id]
    )
    previous_versions = relationship(
        "AppVersion",
        secondary=app_version_lineage,
        primaryjoin=id == app_version_lineage.c.app_version_id,
        secondaryjoin=id == app_version_lineage.c.previous_version_id,
        backref="next_versions",
        lazy="selectin",
    )

    @property
    def previous_version_ids(self) -> list[int]:
        if not self.previous_versions:
            return []
        return [version.id for version in self.previous_versions]


class TestPlan(Base):
    __tablename__ = "test_plans"

    id = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(
        Integer, ForeignKey("evaluations.id"), nullable=False, index=True
    )
    status = Column(
        Enum(
            TestPlanStatus,
            name="testplanstatus",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=TestPlanStatus.PENDING,
    )
    summary = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    evaluation = relationship("Evaluation", back_populates="test_plans")
    test_cases = relationship(
        "TestCase",
        back_populates="plan",
        cascade="all, delete-orphan",
    )


class TestCase(Base):
    __tablename__ = "test_cases"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("test_plans.id"), nullable=False, index=True)
    evaluation_id = Column(
        Integer, ForeignKey("evaluations.id"), nullable=False, index=True
    )
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    input_data = Column(JSON, nullable=True)
    status = Column(
        Enum(
            TestCaseStatus,
            name="testcasestatus",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=TestCaseStatus.PENDING,
    )
    result = Column(JSON, nullable=True)
    execution_order = Column(Integer, nullable=True)
    assigned_executor_id = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships
    plan = relationship("TestPlan", back_populates="test_cases")
    evaluation = relationship("Evaluation", back_populates="test_cases")


class Bug(Base):
    __tablename__ = "bugs"
    __table_args__ = (
        UniqueConstraint("app_id", "fingerprint", name="uq_bugs_app_fingerprint"),
    )

    id = Column(Integer, primary_key=True, index=True)
    app_id = Column(Integer, ForeignKey("apps.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    severity_level = Column(
        Enum(
            BugSeverity,
            name="bugseverity",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=BugSeverity.P2,
    )
    priority = Column(Integer, nullable=True)
    status = Column(
        Enum(
            BugStatus,
            name="bugstatus",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        nullable=False,
        default=BugStatus.NEW,
    )
    discovered_version_id = Column(
        Integer, ForeignKey("app_versions.id"), nullable=True, index=True
    )
    fingerprint = Column(String, nullable=True, index=True)
    environment = Column(JSON, nullable=True)
    reproduction_steps = Column(JSON, nullable=True)
    first_seen_at = Column(DateTime(timezone=True), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    app = relationship("App")
    discovered_version = relationship(
        "AppVersion", foreign_keys=[discovered_version_id]
    )
    occurrences = relationship(
        "BugOccurrence",
        back_populates="bug",
        cascade="all, delete-orphan",
    )
    fixes = relationship(
        "BugFix",
        back_populates="bug",
        cascade="all, delete-orphan",
    )


class BugOccurrence(Base):
    __tablename__ = "bug_occurrences"
    __table_args__ = (
        Index("ix_bug_occurrences_bug_id", "bug_id"),
        Index("ix_bug_occurrences_evaluation_id", "evaluation_id"),
        Index("ix_bug_occurrences_test_case_id", "test_case_id"),
        Index("ix_bug_occurrences_app_version_id", "app_version_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    bug_id = Column(Integer, ForeignKey("bugs.id"), nullable=False, index=True)
    evaluation_id = Column(
        Integer, ForeignKey("evaluations.id"), nullable=True, index=True
    )
    test_case_id = Column(
        Integer, ForeignKey("test_cases.id"), nullable=True, index=True
    )
    app_version_id = Column(
        Integer, ForeignKey("app_versions.id"), nullable=True, index=True
    )
    step_index = Column(Integer, nullable=True)
    action = Column(JSON, nullable=True)
    expected = Column(Text, nullable=True)
    actual = Column(Text, nullable=True)
    result_snapshot = Column(JSON, nullable=True)
    screenshot_uri = Column(String, nullable=True)
    log_uri = Column(String, nullable=True)
    raw_model_coords = Column(JSON, nullable=True)
    observed_at = Column(DateTime(timezone=True), nullable=True)
    executor_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    bug = relationship("Bug", back_populates="occurrences")
    evaluation = relationship("Evaluation")
    test_case = relationship("TestCase")
    app_version = relationship("AppVersion")


class BugFix(Base):
    __tablename__ = "bug_fixes"
    __table_args__ = (
        UniqueConstraint(
            "bug_id", "fixed_in_version_id", name="uq_bug_fixes_bug_version"
        ),
        Index("ix_bug_fixes_bug_id", "bug_id"),
        Index("ix_bug_fixes_fixed_in_version_id", "fixed_in_version_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    bug_id = Column(Integer, ForeignKey("bugs.id"), nullable=False, index=True)
    fixed_in_version_id = Column(
        Integer, ForeignKey("app_versions.id"), nullable=False, index=True
    )
    verified_by_evaluation_id = Column(
        Integer, ForeignKey("evaluations.id"), nullable=True, index=True
    )
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    bug = relationship("Bug", back_populates="fixes")
    fixed_in_version = relationship("AppVersion")
    verified_by_evaluation = relationship("Evaluation")
