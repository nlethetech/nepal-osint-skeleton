"""Parliament database models for MP Performance Index.

Models for storing parliament data scraped from hr.parliament.gov.np and na.parliament.gov.np.
Tracks MP performance metrics including:
- Legislative productivity (bills introduced/passed)
- Participation (session/committee attendance)
- Accountability (questions asked/answered)
- Committee work (memberships, leadership roles)
"""
from datetime import datetime, date
from enum import Enum
from typing import Optional, TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Text, Boolean, DateTime, Integer, Float, ForeignKey, Index, Date,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.political_entity import PoliticalEntity


class Chamber(str, Enum):
    """Parliament chamber."""
    HOR = "hor"  # House of Representatives (प्रतिनिधि सभा)
    NA = "na"    # National Assembly (राष्ट्रिय सभा)
    JOINT = "joint"


class ElectionTypeMP(str, Enum):
    """How the MP was elected."""
    FPTP = "fptp"  # First Past The Post (direct constituency)
    PR = "pr"      # Proportional Representation (party list)


class BillType(str, Enum):
    """Type of parliamentary bill."""
    GOVERNMENT = "government"
    PRIVATE_MEMBER = "private_member"
    MONEY = "money"
    AMENDMENT = "amendment"


class BillStatus(str, Enum):
    """Status of a bill in parliament."""
    REGISTERED = "registered"
    FIRST_READING = "first_reading"
    COMMITTEE = "committee"
    SECOND_READING = "second_reading"
    PASSED = "passed"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"


class CommitteeType(str, Enum):
    """Type of parliamentary committee."""
    THEMATIC = "thematic"
    PROCEDURAL = "procedural"
    SPECIAL = "special"
    JOINT = "joint"


class CommitteeRole(str, Enum):
    """Role in a committee."""
    CHAIR = "chair"
    VICE_CHAIR = "vice_chair"
    MEMBER = "member"


class QuestionType(str, Enum):
    """Type of parliamentary question."""
    ZERO_HOUR = "zero_hour"
    SPECIAL_HOUR = "special_hour"
    WRITTEN = "written"
    STARRED = "starred"


class PerformanceTier(str, Enum):
    """Performance tier classification."""
    TOP10 = "top10"
    ABOVE_AVG = "above_avg"
    AVERAGE = "average"
    BELOW_AVG = "below_avg"
    BOTTOM10 = "bottom10"


class MPPerformance(Base, TimestampMixin):
    """MP profile with performance scores.

    Central table for tracking MP parliamentary activity and computing
    the MP Performance Index with percentile rankings.
    """
    __tablename__ = "mp_performance"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    mp_id: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)  # Parliament website ID

    # Identity
    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_ne: Mapped[Optional[str]] = mapped_column(String(255))
    party: Mapped[Optional[str]] = mapped_column(String(100))
    constituency: Mapped[Optional[str]] = mapped_column(String(100))
    province_id: Mapped[Optional[int]] = mapped_column(Integer)
    election_type: Mapped[Optional[str]] = mapped_column(String(20))  # 'fptp' or 'pr'
    chamber: Mapped[Optional[str]] = mapped_column(String(10))  # 'hor' or 'na'
    term: Mapped[Optional[str]] = mapped_column(String(20))  # e.g., '2079-2084'
    photo_url: Mapped[Optional[str]] = mapped_column(Text)

    # Candidate linking (to election candidates table)
    linked_candidate_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("candidates.id", ondelete="SET NULL")
    )
    link_confidence: Mapped[Optional[float]] = mapped_column(Float)

    # Linked PoliticalEntity (canonical hub)
    linked_entity_id: Mapped[Optional[UUID]] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("political_entities.id", ondelete="SET NULL"),
        index=True,
    )
    entity_link_confidence: Mapped[Optional[float]] = mapped_column(Float)

    # Legislative Productivity (30%)
    bills_introduced: Mapped[int] = mapped_column(Integer, default=0)
    bills_passed: Mapped[int] = mapped_column(Integer, default=0)
    bills_pending: Mapped[int] = mapped_column(Integer, default=0)
    amendments_proposed: Mapped[int] = mapped_column(Integer, default=0)
    legislative_score: Mapped[float] = mapped_column(Float, default=0.0)
    legislative_percentile: Mapped[Optional[int]] = mapped_column(Integer)

    # Participation (25%)
    sessions_total: Mapped[int] = mapped_column(Integer, default=0)
    sessions_attended: Mapped[int] = mapped_column(Integer, default=0)
    session_attendance_pct: Mapped[Optional[float]] = mapped_column(Float)
    voting_participation_pct: Mapped[Optional[float]] = mapped_column(Float)
    participation_score: Mapped[float] = mapped_column(Float, default=0.0)
    participation_percentile: Mapped[Optional[int]] = mapped_column(Integer)

    # Accountability (25%)
    questions_asked: Mapped[int] = mapped_column(Integer, default=0)
    questions_answered: Mapped[int] = mapped_column(Integer, default=0)  # If minister
    motions_proposed: Mapped[int] = mapped_column(Integer, default=0)
    resolutions_proposed: Mapped[int] = mapped_column(Integer, default=0)
    accountability_score: Mapped[float] = mapped_column(Float, default=0.0)
    accountability_percentile: Mapped[Optional[int]] = mapped_column(Integer)

    # Committee Work (20%)
    committee_memberships: Mapped[int] = mapped_column(Integer, default=0)
    committee_leadership_roles: Mapped[int] = mapped_column(Integer, default=0)
    committee_attendance_pct: Mapped[Optional[float]] = mapped_column(Float)
    reports_contributed: Mapped[int] = mapped_column(Integer, default=0)
    committee_score: Mapped[float] = mapped_column(Float, default=0.0)
    committee_percentile: Mapped[Optional[int]] = mapped_column(Integer)

    # Parliament Speeches (tracked from video archives)
    # Contributes to participation score
    speeches_count: Mapped[int] = mapped_column(Integer, default=0)

    # Composite Score
    performance_score: Mapped[float] = mapped_column(Float, default=0.0)
    performance_percentile: Mapped[Optional[int]] = mapped_column(Integer)
    performance_tier: Mapped[Optional[str]] = mapped_column(String(20))

    # Peer group rankings
    peer_group: Mapped[Optional[str]] = mapped_column(String(50))  # e.g., 'fptp_madhesh'
    peer_rank: Mapped[Optional[int]] = mapped_column(Integer)
    peer_total: Mapped[Optional[int]] = mapped_column(Integer)

    # Metadata
    is_minister: Mapped[bool] = mapped_column(Boolean, default=False)
    ministry_portfolio: Mapped[Optional[str]] = mapped_column(String(255))
    is_current_member: Mapped[bool] = mapped_column(Boolean, default=True)

    # Prime Minister history (sourced from OPMCM)
    is_former_pm: Mapped[bool] = mapped_column(Boolean, default=False)
    pm_terms: Mapped[int] = mapped_column(Integer, default=0)
    notable_roles: Mapped[Optional[str]] = mapped_column(Text)

    scraped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    score_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Relationships
    bills_presented: Mapped[list["ParliamentBill"]] = relationship(
        "ParliamentBill", back_populates="presenting_mp",
        foreign_keys="ParliamentBill.presenting_mp_id"
    )
    bill_sponsorships: Mapped[list["BillSponsor"]] = relationship(
        "BillSponsor", back_populates="mp", cascade="all, delete-orphan"
    )
    committee_roles: Mapped[list["CommitteeMembership"]] = relationship(
        "CommitteeMembership", back_populates="mp", cascade="all, delete-orphan"
    )
    questions: Mapped[list["ParliamentQuestion"]] = relationship(
        "ParliamentQuestion", back_populates="asker",
        foreign_keys="ParliamentQuestion.mp_id",
        cascade="all, delete-orphan"
    )
    attendance_records: Mapped[list["SessionAttendance"]] = relationship(
        "SessionAttendance", back_populates="mp", cascade="all, delete-orphan"
    )
    political_entity: Mapped[Optional["PoliticalEntity"]] = relationship(
        "PoliticalEntity",
        back_populates="mp_records",
        foreign_keys=[linked_entity_id],
    )

    __table_args__ = (
        Index("idx_mp_performance_name", "name_en", "name_ne"),
        Index("idx_mp_performance_linked", "linked_candidate_id"),
        Index("idx_mp_performance_score", "performance_score"),
        Index("idx_mp_performance_peer", "peer_group", "peer_rank"),
        Index("idx_mp_performance_chamber", "chamber"),
        Index("idx_mp_performance_party", "party"),
    )

    def to_dict(self) -> dict:
        """Convert to dictionary for API response."""
        return {
            "id": str(self.id),
            "mp_id": self.mp_id,
            "name_en": self.name_en,
            "name_ne": self.name_ne,
            "party": self.party,
            "constituency": self.constituency,
            "province_id": self.province_id,
            "election_type": self.election_type,
            "chamber": self.chamber,
            "term": self.term,
            "photo_url": self.photo_url,
            "linked_candidate_id": str(self.linked_candidate_id) if self.linked_candidate_id else None,
            "link_confidence": self.link_confidence,
            # Legislative
            "bills_introduced": self.bills_introduced,
            "bills_passed": self.bills_passed,
            "legislative_score": self.legislative_score,
            "legislative_percentile": self.legislative_percentile,
            # Participation
            "sessions_total": self.sessions_total,
            "sessions_attended": self.sessions_attended,
            "session_attendance_pct": self.session_attendance_pct,
            "participation_score": self.participation_score,
            "participation_percentile": self.participation_percentile,
            # Accountability
            "questions_asked": self.questions_asked,
            "accountability_score": self.accountability_score,
            "accountability_percentile": self.accountability_percentile,
            # Committee
            "committee_memberships": self.committee_memberships,
            "committee_leadership_roles": self.committee_leadership_roles,
            "committee_score": self.committee_score,
            "committee_percentile": self.committee_percentile,
            # Speeches
            "speeches_count": self.speeches_count,
            # Composite
            "performance_score": self.performance_score,
            "performance_percentile": self.performance_percentile,
            "performance_tier": self.performance_tier,
            "peer_group": self.peer_group,
            "peer_rank": self.peer_rank,
            "peer_total": self.peer_total,
            # Metadata
            "is_minister": self.is_minister,
            "ministry_portfolio": self.ministry_portfolio,
            "is_current_member": self.is_current_member,
            # Prime Minister history
            "is_former_pm": self.is_former_pm,
            "pm_terms": self.pm_terms,
            "notable_roles": self.notable_roles,
        }


class ParliamentBill(Base):
    """Parliamentary bill with status tracking.

    Tracks bills from registration through passage/rejection.
    """
    __tablename__ = "parliament_bills"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    external_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True)

    title_en: Mapped[str] = mapped_column(Text, nullable=False)
    title_ne: Mapped[Optional[str]] = mapped_column(Text)

    bill_type: Mapped[Optional[str]] = mapped_column(String(50))
    status: Mapped[Optional[str]] = mapped_column(String(50))

    presented_date: Mapped[Optional[date]] = mapped_column(Date)
    passed_date: Mapped[Optional[date]] = mapped_column(Date)

    presenting_mp_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="SET NULL")
    )
    ministry: Mapped[Optional[str]] = mapped_column(String(200))

    presented_by: Mapped[Optional[str]] = mapped_column(String(255))
    summary: Mapped[Optional[str]] = mapped_column(Text)
    pdf_url: Mapped[Optional[str]] = mapped_column(Text)
    ocr_text: Mapped[Optional[str]] = mapped_column(Text)
    ai_analysis: Mapped[Optional[str]] = mapped_column(Text)

    chamber: Mapped[Optional[str]] = mapped_column(String(10))
    term: Mapped[Optional[str]] = mapped_column(String(20))

    scraped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    presenting_mp: Mapped[Optional["MPPerformance"]] = relationship(
        "MPPerformance", back_populates="bills_presented",
        foreign_keys=[presenting_mp_id]
    )
    sponsors: Mapped[list["BillSponsor"]] = relationship(
        "BillSponsor", back_populates="bill", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_bills_status", "status", "presented_date"),
        Index("idx_bills_mp", "presenting_mp_id"),
        Index("idx_bills_chamber", "chamber"),
        Index("idx_bills_type", "bill_type"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "external_id": self.external_id,
            "title_en": self.title_en,
            "title_ne": self.title_ne,
            "bill_type": self.bill_type,
            "status": self.status,
            "presented_date": self.presented_date.isoformat() if self.presented_date else None,
            "passed_date": self.passed_date.isoformat() if self.passed_date else None,
            "presenting_mp_id": str(self.presenting_mp_id) if self.presenting_mp_id else None,
            "ministry": self.ministry,
            "chamber": self.chamber,
            "term": self.term,
        }


class BillSponsor(Base):
    """Bill sponsor (many-to-many relationship).

    Tracks primary sponsors and co-sponsors for each bill.
    """
    __tablename__ = "bill_sponsors"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    bill_id: Mapped[UUID] = mapped_column(
        ForeignKey("parliament_bills.id", ondelete="CASCADE"), nullable=False
    )
    mp_id: Mapped[UUID] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="CASCADE"), nullable=False
    )
    sponsor_type: Mapped[Optional[str]] = mapped_column(String(20))  # 'primary', 'co-sponsor'
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    bill: Mapped["ParliamentBill"] = relationship("ParliamentBill", back_populates="sponsors")
    mp: Mapped["MPPerformance"] = relationship("MPPerformance", back_populates="bill_sponsorships")

    __table_args__ = (
        Index("idx_bill_sponsors_bill", "bill_id"),
        Index("idx_bill_sponsors_mp", "mp_id"),
    )


class ParliamentCommittee(Base):
    """Parliamentary committee.

    Tracks committees across both houses with their mandates.
    """
    __tablename__ = "parliament_committees"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    external_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True)

    name_en: Mapped[str] = mapped_column(String(255), nullable=False)
    name_ne: Mapped[Optional[str]] = mapped_column(String(255))

    committee_type: Mapped[Optional[str]] = mapped_column(String(50))
    chamber: Mapped[Optional[str]] = mapped_column(String(10))
    term: Mapped[Optional[str]] = mapped_column(String(20))

    description: Mapped[Optional[str]] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    total_meetings: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    memberships: Mapped[list["CommitteeMembership"]] = relationship(
        "CommitteeMembership", back_populates="committee", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_committees_chamber", "chamber"),
        Index("idx_committees_active", "is_active"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "external_id": self.external_id,
            "name_en": self.name_en,
            "name_ne": self.name_ne,
            "committee_type": self.committee_type,
            "chamber": self.chamber,
            "term": self.term,
            "is_active": self.is_active,
            "total_meetings": self.total_meetings,
        }


class CommitteeMembership(Base):
    """Committee membership with role and attendance.

    Tracks which MPs serve on which committees, their roles,
    and their attendance records.
    """
    __tablename__ = "committee_memberships"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    committee_id: Mapped[UUID] = mapped_column(
        ForeignKey("parliament_committees.id", ondelete="CASCADE"), nullable=False
    )
    mp_id: Mapped[UUID] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="CASCADE"), nullable=False
    )

    role: Mapped[str] = mapped_column(String(50), nullable=False)

    meetings_total: Mapped[int] = mapped_column(Integer, default=0)
    meetings_attended: Mapped[int] = mapped_column(Integer, default=0)
    attendance_pct: Mapped[Optional[float]] = mapped_column(Float)

    joined_date: Mapped[Optional[date]] = mapped_column(Date)
    left_date: Mapped[Optional[date]] = mapped_column(Date)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    committee: Mapped["ParliamentCommittee"] = relationship(
        "ParliamentCommittee", back_populates="memberships"
    )
    mp: Mapped["MPPerformance"] = relationship(
        "MPPerformance", back_populates="committee_roles"
    )

    __table_args__ = (
        Index("idx_committee_memberships_committee", "committee_id"),
        Index("idx_committee_memberships_mp", "mp_id"),
        Index("idx_committee_memberships_role", "role"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "committee_id": str(self.committee_id),
            "mp_id": str(self.mp_id),
            "role": self.role,
            "meetings_total": self.meetings_total,
            "meetings_attended": self.meetings_attended,
            "attendance_pct": self.attendance_pct,
            "joined_date": self.joined_date.isoformat() if self.joined_date else None,
            "is_current": self.is_current,
        }


class ParliamentQuestion(Base):
    """Parliamentary question asked/answered.

    Tracks questions asked during Zero Hour, Special Hour, etc.
    """
    __tablename__ = "parliament_questions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    external_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True)

    mp_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="CASCADE")
    )

    question_type: Mapped[Optional[str]] = mapped_column(String(50))
    question_text: Mapped[Optional[str]] = mapped_column(Text)
    question_date: Mapped[Optional[date]] = mapped_column(Date)

    answered: Mapped[bool] = mapped_column(Boolean, default=False)
    answered_by_mp_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="SET NULL")
    )
    answer_date: Mapped[Optional[date]] = mapped_column(Date)

    ministry_addressed: Mapped[Optional[str]] = mapped_column(String(200))

    # For HoR Q&A records where we have the questioner name but no mp_id link
    questioner_name: Mapped[Optional[str]] = mapped_column(String(200))
    answer_text: Mapped[Optional[str]] = mapped_column(Text)
    session_label: Mapped[Optional[str]] = mapped_column(String(100))

    scraped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    asker: Mapped[Optional["MPPerformance"]] = relationship(
        "MPPerformance", back_populates="questions",
        foreign_keys=[mp_id]
    )

    __table_args__ = (
        Index("idx_questions_mp", "mp_id"),
        Index("idx_questions_date", "question_date"),
        Index("idx_questions_type", "question_type"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "external_id": self.external_id,
            "mp_id": str(self.mp_id) if self.mp_id else None,
            "questioner_name": self.questioner_name,
            "question_type": self.question_type,
            "question_text": self.question_text,
            "question_date": self.question_date.isoformat() if self.question_date else None,
            "answered": self.answered,
            "ministry_addressed": self.ministry_addressed,
            "answer_text": self.answer_text,
            "session_label": self.session_label,
        }


class SessionAttendance(Base):
    """Daily session attendance record.

    Tracks whether an MP was present for each parliamentary session.
    """
    __tablename__ = "session_attendance"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    mp_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="CASCADE")
    )

    session_date: Mapped[date] = mapped_column(Date, nullable=False)
    session_type: Mapped[Optional[str]] = mapped_column(String(50))

    present: Mapped[bool] = mapped_column(Boolean, nullable=False)

    chamber: Mapped[Optional[str]] = mapped_column(String(10))
    term: Mapped[Optional[str]] = mapped_column(String(20))

    scraped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    mp: Mapped[Optional["MPPerformance"]] = relationship(
        "MPPerformance", back_populates="attendance_records"
    )

    __table_args__ = (
        Index("idx_attendance_mp", "mp_id"),
        Index("idx_attendance_date", "session_date"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "mp_id": str(self.mp_id) if self.mp_id else None,
            "session_date": self.session_date.isoformat(),
            "session_type": self.session_type,
            "present": self.present,
            "chamber": self.chamber,
            "term": self.term,
        }


class VerbatimSession(Base):
    """A parliamentary verbatim session PDF.

    Each row = one PDF downloaded from hr.parliament.gov.np/np/verbatims.
    Contains metadata about the session and processing status.
    """
    __tablename__ = "verbatim_sessions"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    # Source metadata
    pdf_url: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    title_ne: Mapped[Optional[str]] = mapped_column(Text)  # Nepali title from listing
    session_no: Mapped[Optional[int]] = mapped_column(Integer)  # e.g., 16, 17 (अधिवेशन)
    meeting_no: Mapped[Optional[int]] = mapped_column(Integer)  # e.g., 37 (बैठक सङ्ख्या)
    session_date_bs: Mapped[Optional[str]] = mapped_column(String(50))  # BS date string
    session_date: Mapped[Optional[date]] = mapped_column(Date)  # AD date
    chamber: Mapped[str] = mapped_column(String(10), default="hor")

    # Processing
    raw_text: Mapped[Optional[str]] = mapped_column(Text)  # Full extracted text
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    speech_count: Mapped[int] = mapped_column(Integer, default=0)
    is_processed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_analyzed: Mapped[bool] = mapped_column(Boolean, default=False)  # Agent analysis done

    # AI analysis summary (from Haiku agent)
    session_summary: Mapped[Optional[str]] = mapped_column(Text)
    key_topics: Mapped[Optional[list]] = mapped_column(JSONB)  # ["education bill", "road budget", ...]
    bills_discussed: Mapped[Optional[list]] = mapped_column(JSONB)  # bill IDs/names
    agenda_items: Mapped[Optional[list]] = mapped_column(JSONB)  # [{topic, description, intensity, supporters, opponents, outcome}]
    speaker_scores: Mapped[Optional[list]] = mapped_column(JSONB)  # [{speaker_name_ne, name_en, party, scores...}]

    scraped_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    analyzed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    speeches: Mapped[list["ParliamentarySpeech"]] = relationship(
        "ParliamentarySpeech", back_populates="session", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("idx_verbatim_session_date", "session_date"),
        Index("idx_verbatim_session_no", "session_no", "meeting_no"),
        Index("idx_verbatim_processed", "is_processed"),
    )

    def to_dict(self) -> dict:
        return {
            "id": str(self.id),
            "pdf_url": self.pdf_url,
            "title_ne": self.title_ne,
            "session_no": self.session_no,
            "meeting_no": self.meeting_no,
            "session_date_bs": self.session_date_bs,
            "session_date": self.session_date.isoformat() if self.session_date else None,
            "chamber": self.chamber,
            "page_count": self.page_count,
            "speech_count": self.speech_count,
            "is_processed": self.is_processed,
            "is_analyzed": self.is_analyzed,
            "session_summary": self.session_summary,
            "key_topics": self.key_topics,
            "bills_discussed": self.bills_discussed,
            "agenda_items": self.agenda_items,
            "speaker_scores": self.speaker_scores,
        }


class ParliamentarySpeech(Base):
    """Individual speech extracted from a verbatim session PDF.

    Pattern: (13:24 बजे)माननीय Name (Party):- speech text...
    """
    __tablename__ = "parliamentary_speeches"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    session_id: Mapped[UUID] = mapped_column(
        ForeignKey("verbatim_sessions.id", ondelete="CASCADE"), nullable=False
    )

    # Speaker identity (extracted from PDF)
    speaker_name_ne: Mapped[str] = mapped_column(String(255), nullable=False)
    speaker_name_en: Mapped[Optional[str]] = mapped_column(String(255))
    speaker_party_ne: Mapped[Optional[str]] = mapped_column(String(255))
    speaker_party_en: Mapped[Optional[str]] = mapped_column(String(255))
    speaker_role: Mapped[Optional[str]] = mapped_column(String(100))  # "अध्यक्ष", "माननीय", etc.

    # Linked MP (matched by name)
    mp_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("mp_performance.id", ondelete="SET NULL")
    )

    # Speech content
    timestamp: Mapped[Optional[str]] = mapped_column(String(20))  # "13:24"
    speech_text: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    speech_order: Mapped[int] = mapped_column(Integer, default=0)  # Order within session

    # AI analysis (from Sonnet agent)
    topics: Mapped[Optional[list]] = mapped_column(JSONB)  # ["education", "budget"]
    bills_referenced: Mapped[Optional[list]] = mapped_column(JSONB)  # bill names/IDs mentioned
    stance: Mapped[Optional[str]] = mapped_column(String(50))  # "support", "oppose", "question", "neutral"
    key_quotes: Mapped[Optional[list]] = mapped_column(JSONB)  # Notable quotes
    summary_en: Mapped[Optional[str]] = mapped_column(Text)  # English summary of speech

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default="now()"
    )

    # Relationships
    session: Mapped["VerbatimSession"] = relationship(
        "VerbatimSession", back_populates="speeches"
    )
    mp: Mapped[Optional["MPPerformance"]] = relationship("MPPerformance")

    __table_args__ = (
        Index("idx_speech_session", "session_id", "speech_order"),
        Index("idx_speech_mp", "mp_id"),
        Index("idx_speech_speaker", "speaker_name_ne"),
        Index("idx_speech_party", "speaker_party_ne"),
    )
