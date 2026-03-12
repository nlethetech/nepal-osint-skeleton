"""Data repositories for database access."""
from app.repositories.story import StoryRepository
from app.repositories.story_cluster import StoryClusterRepository
from app.repositories.embedding import EmbeddingRepository
from app.repositories.disaster import DisasterIncidentRepository, DisasterAlertRepository
from app.repositories.kpi_repository import KPIRepository
from app.repositories.weather import WeatherForecastRepository
from app.repositories.announcement import AnnouncementRepository
from app.repositories.parliament import (
    MPPerformanceRepository,
    BillRepository,
    CommitteeRepository,
    QuestionRepository,
    AttendanceRepository,
)

__all__ = [
    "StoryRepository",
    "StoryClusterRepository",
    "EmbeddingRepository",
    "DisasterIncidentRepository",
    "DisasterAlertRepository",
    "KPIRepository",
    "WeatherForecastRepository",
    "AnnouncementRepository",
    # Parliament
    "MPPerformanceRepository",
    "BillRepository",
    "CommitteeRepository",
    "QuestionRepository",
    "AttendanceRepository",
]
