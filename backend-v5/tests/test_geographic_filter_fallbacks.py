from dataclasses import dataclass

from app.api.v1.alerts import _filter_stories_by_districts as filter_alert_stories
from app.api.v1.analytics import _filter_stories_by_districts as filter_analytics_stories
from app.api.v1.map import get_coordinates_for_province, normalize_province_name


@dataclass
class _StoryStub:
    title: str
    districts: list[str] | None = None
    provinces: list[str] | None = None


def test_analytics_filter_includes_province_only_story():
    stories = [
        _StoryStub(title="Province update", districts=None, provinces=["Gandaki"]),
        _StoryStub(title="Kathmandu notice", districts=["Kathmandu"], provinces=["Bagmati"]),
    ]

    filtered = filter_analytics_stories(stories, ["Kaski", "Myagdi"])
    assert len(filtered) == 1
    assert filtered[0].provinces == ["Gandaki"]


def test_alert_filter_matches_district_variants_with_underscores():
    stories = [
        _StoryStub(title="Nawalparasi update", districts=["Nawalparasi_East"], provinces=["Gandaki"]),
    ]

    filtered = filter_alert_stories(stories, ["Nawalparasi East"])
    assert len(filtered) == 1


def test_map_province_normalization_and_coordinates():
    assert normalize_province_name(4) == "Gandaki"
    assert normalize_province_name("gandaki") == "Gandaki"
    assert get_coordinates_for_province("gandaki") is not None
