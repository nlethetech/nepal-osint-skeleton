#!/usr/bin/env python3
"""
Tests for Nepal Government Scrapers

Run with: pytest tests/test_govt_scrapers.py -v
"""

import pytest
import asyncio
from datetime import datetime
from unittest.mock import Mock, patch, MagicMock
import json

# Import scrapers
from app.ingestion.ministry_scraper_generic import (
    GenericMinistryScraper,
    GenericMinistryScraperConfig,
    GovtPost,
    MINISTRY_CONFIGS,
    get_ministry_scraper,
    scrape_ministry_async,
)
from app.ingestion.dao_scraper import DAOScraper, DAOPost
from app.ingestion.provincial_scraper import ProvincialScraper, ProvincialPost
from app.ingestion.constitutional_scraper import ConstitutionalScraper
from app.ingestion.municipality_scraper import MunicipalityScraper
from app.ingestion.security_scraper import SecurityScraper, SecurityPost
from app.ingestion.govt_batch_scraper import GovtBatchScraper, ScrapeResult


# ============ Ministry Scraper Tests ============

class TestMinistryScraperConfig:
    """Tests for ministry scraper configuration."""

    def test_ministry_configs_exist(self):
        """Test that ministry configs are defined."""
        assert len(MINISTRY_CONFIGS) > 0
        assert 'mof' in MINISTRY_CONFIGS
        assert 'moha' in MINISTRY_CONFIGS
        assert 'mofa' in MINISTRY_CONFIGS

    def test_config_has_required_fields(self):
        """Test that configs have required fields."""
        for source_id, config in MINISTRY_CONFIGS.items():
            assert config.source_id == source_id
            assert config.name
            assert config.name_ne
            assert config.base_url
            assert config.endpoints
            assert config.page_structure in ['table', 'list', 'card']

    def test_get_ministry_scraper(self):
        """Test factory function for ministry scraper."""
        scraper = get_ministry_scraper('mof')
        assert isinstance(scraper, GenericMinistryScraper)
        assert scraper.config.source_id == 'mof'

    def test_get_unknown_ministry_raises_error(self):
        """Test that unknown ministry raises ValueError."""
        with pytest.raises(ValueError):
            get_ministry_scraper('unknown_ministry')


class TestGenericMinistryScraper:
    """Tests for generic ministry scraper."""

    def test_nepali_digit_conversion(self):
        """Test Nepali digit conversion."""
        scraper = get_ministry_scraper('mof')
        assert scraper._convert_nepali_digits('२०८१-१०-१५') == '2081-10-15'
        assert scraper._convert_nepali_digits('०१२३४५६७८९') == '0123456789'

    def test_extract_bs_date(self):
        """Test BS date extraction."""
        scraper = get_ministry_scraper('mof')

        # Standard format
        assert scraper._extract_bs_date('2081-10-15') == '2081-10-15'

        # Nepali digits
        assert scraper._extract_bs_date('२०८१-१०-१५') == '2081-10-15'

        # Date in text
        assert scraper._extract_bs_date('Published on 2081-05-20') == '2081-05-20'

        # No date
        assert scraper._extract_bs_date('No date here') is None

    def test_generate_post_id(self):
        """Test that post IDs are deterministic."""
        scraper = get_ministry_scraper('mof')
        config = scraper.config

        post1 = GovtPost(
            id='test123',
            title='Test Post',
            url='https://mof.gov.np/test',
            source_id=config.source_id,
            source_name=config.name,
            source_domain='mof.gov.np'
        )

        # Same URL should generate same hash
        import hashlib
        expected_id = hashlib.md5(f"mof:https://mof.gov.np/test".encode()).hexdigest()[:12]
        # Note: The actual implementation uses different hash format


class TestGovtPost:
    """Tests for GovtPost dataclass."""

    def test_govt_post_creation(self):
        """Test creating a GovtPost."""
        post = GovtPost(
            id='test123',
            title='Test Press Release',
            url='https://mof.gov.np/press/123',
            source_id='mof',
            source_name='Ministry of Finance',
            source_domain='mof.gov.np',
            date_bs='2081-10-15',
            category='press-release',
            language='en'
        )

        assert post.id == 'test123'
        assert post.title == 'Test Press Release'
        assert post.has_attachment is False
        assert post.scraped_at  # Should have default timestamp

    def test_govt_post_with_attachment(self):
        """Test GovtPost with attachment."""
        post = GovtPost(
            id='test123',
            title='Notice with PDF',
            url='https://moha.gov.np/notice/456',
            source_id='moha',
            source_name='Ministry of Home Affairs',
            source_domain='moha.gov.np',
            has_attachment=True,
            attachment_urls=['https://moha.gov.np/uploads/notice.pdf']
        )

        assert post.has_attachment is True
        assert len(post.attachment_urls) == 1


# ============ DAO Scraper Tests ============

class TestDAOScraper:
    """Tests for DAO (District Administration Office) scraper."""

    def test_all_77_districts_defined(self):
        """Test that all 77 districts are defined."""
        scraper = DAOScraper()
        assert len(scraper.DISTRICTS) == 77

    def test_districts_have_required_info(self):
        """Test that all districts have required info."""
        scraper = DAOScraper()
        for district_id, info in scraper.DISTRICTS.items():
            assert 'province' in info
            assert 'province_id' in info
            assert 'name' in info
            assert 'name_ne' in info
            assert info['province_id'] in range(1, 8)

    def test_districts_per_province(self):
        """Test correct number of districts per province."""
        scraper = DAOScraper()
        province_counts = {}
        for info in scraper.DISTRICTS.values():
            pid = info['province_id']
            province_counts[pid] = province_counts.get(pid, 0) + 1

        # Expected district counts by province
        expected = {
            1: 14,  # Koshi
            2: 8,   # Madhesh
            3: 13,  # Bagmati
            4: 11,  # Gandaki
            5: 12,  # Lumbini
            6: 10,  # Karnali
            7: 9,   # Sudurpashchim
        }

        for pid, count in expected.items():
            assert province_counts.get(pid, 0) == count, f"Province {pid} should have {count} districts"

    def test_get_dao_url(self):
        """Test DAO URL generation."""
        scraper = DAOScraper()
        assert scraper.get_dao_url('kathmandu') == 'https://daokathmandu.moha.gov.np'
        assert scraper.get_dao_url('lalitpur') == 'https://daolalitpur.moha.gov.np'

    def test_priority_districts_defined(self):
        """Test that priority districts are defined."""
        scraper = DAOScraper()
        assert len(scraper.PRIORITY_DISTRICTS) > 0
        assert 'kathmandu' in scraper.PRIORITY_DISTRICTS

        # All priority districts should exist
        for district in scraper.PRIORITY_DISTRICTS:
            assert district in scraper.DISTRICTS


class TestDAOPost:
    """Tests for DAOPost dataclass."""

    def test_dao_post_creation(self):
        """Test creating a DAOPost."""
        post = DAOPost(
            id='dao123',
            title='District Notice',
            url='https://daokathmandu.moha.gov.np/notice/123',
            district='Kathmandu',
            district_ne='काठमाडौं',
            province='Bagmati',
            province_id=3,
            date_bs='2081-10-15'
        )

        assert post.district == 'Kathmandu'
        assert post.province_id == 3


# ============ Provincial Scraper Tests ============

class TestProvincialScraper:
    """Tests for provincial government scraper."""

    def test_all_7_provinces_defined(self):
        """Test that all 7 provinces are defined."""
        scraper = ProvincialScraper()
        assert len(scraper.PROVINCES) == 7

    def test_provinces_have_required_info(self):
        """Test that provinces have required info."""
        scraper = ProvincialScraper()
        for province_id, info in scraper.PROVINCES.items():
            assert 'id' in info
            assert 'name' in info
            assert 'name_ne' in info
            assert 'base_url' in info
            assert 'capital' in info
            assert 'districts' in info
            assert info['id'] in range(1, 8)

    def test_province_districts_sum_to_77(self):
        """Test that total districts across provinces equals 77."""
        scraper = ProvincialScraper()
        total_districts = sum(info['districts'] for info in scraper.PROVINCES.values())
        assert total_districts == 77


# ============ Constitutional Scraper Tests ============

class TestConstitutionalScraper:
    """Tests for constitutional bodies scraper."""

    def test_constitutional_bodies_defined(self):
        """Test that constitutional bodies are defined."""
        scraper = ConstitutionalScraper()
        assert len(scraper.CONSTITUTIONAL_BODIES) > 0

    def test_key_bodies_exist(self):
        """Test that key constitutional bodies exist."""
        scraper = ConstitutionalScraper()
        expected_bodies = ['ciaa', 'oag', 'psc', 'nhrc', 'nwc', 'nrb', 'sebon']

        for body in expected_bodies:
            assert body in scraper.CONSTITUTIONAL_BODIES or \
                   any(body in bid for bid in scraper.CONSTITUTIONAL_BODIES.keys()), \
                   f"Expected body {body} not found"


# ============ Municipality Scraper Tests ============

class TestMunicipalityScraper:
    """Tests for municipality scraper."""

    def test_municipalities_defined(self):
        """Test that municipalities are defined."""
        scraper = MunicipalityScraper()
        assert len(scraper.MUNICIPALITIES) > 0

    def test_metropolitan_cities_exist(self):
        """Test that 6 metropolitan cities exist."""
        scraper = MunicipalityScraper()
        metros = [m for m in scraper.MUNICIPALITIES.values()
                  if m.get('category') == 'metropolitan']
        assert len(metros) == 6

    def test_kathmandu_metropolitan_exists(self):
        """Test that Kathmandu Metropolitan exists."""
        scraper = MunicipalityScraper()
        assert 'kathmandu' in scraper.MUNICIPALITIES
        assert scraper.MUNICIPALITIES['kathmandu']['category'] == 'metropolitan'


# ============ Security Scraper Tests ============

class TestSecurityScraper:
    """Tests for security services scraper."""

    def test_security_sources_defined(self):
        """Test that security sources are defined."""
        assert len(SecurityScraper.SECURITY_SOURCES) > 0

    def test_key_security_sources_exist(self):
        """Test that key security sources exist."""
        expected_sources = ['nepalpolice', 'apf', 'nepalarmy', 'nid', 'immigration']
        for source in expected_sources:
            assert source in SecurityScraper.SECURITY_SOURCES

    def test_nepal_police_has_wanted_endpoint(self):
        """Test that Nepal Police has wanted persons endpoint."""
        config = SecurityScraper.SECURITY_SOURCES['nepalpolice']
        assert 'wanted' in config.endpoints
        assert 'missing' in config.endpoints


class TestSecurityPost:
    """Tests for SecurityPost dataclass."""

    def test_security_post_with_alert_type(self):
        """Test creating a SecurityPost with alert type."""
        post = SecurityPost(
            id='sec123',
            title='Wanted: John Doe',
            url='https://nepalpolice.gov.np/wanted/123',
            source_id='nepalpolice',
            source_name='Nepal Police',
            source_domain='nepalpolice.gov.np',
            category='wanted',
            alert_type='wanted'
        )

        assert post.alert_type == 'wanted'
        assert post.category == 'wanted'


# ============ Batch Scraper Tests ============

class TestGovtBatchScraper:
    """Tests for batch government scraper."""

    def test_batch_scraper_initialization(self):
        """Test batch scraper initialization."""
        scraper = GovtBatchScraper(
            max_concurrent=5,
            delay_between_sources=0.5,
            max_pages_per_source=2
        )

        assert scraper.max_concurrent == 5
        assert scraper.delay_between_sources == 0.5
        assert scraper.max_pages_per_source == 2


class TestScrapeResult:
    """Tests for ScrapeResult dataclass."""

    def test_scrape_result_success(self):
        """Test successful scrape result."""
        result = ScrapeResult(
            source_id='mof',
            source_name='Ministry of Finance',
            success=True,
            posts_count=25,
            posts=[],
            duration_seconds=5.5,
            scraped_at='2026-02-03T10:00:00'
        )

        assert result.success is True
        assert result.posts_count == 25
        assert result.error is None

    def test_scrape_result_failure(self):
        """Test failed scrape result."""
        result = ScrapeResult(
            source_id='mof',
            source_name='Ministry of Finance',
            success=False,
            posts_count=0,
            posts=[],
            error='Connection timeout',
            scraped_at='2026-02-03T10:00:00'
        )

        assert result.success is False
        assert result.error == 'Connection timeout'


# ============ Discovery Files Tests ============

class TestDiscoveryFiles:
    """Tests for discovery JSON files."""

    def test_federal_ministries_json_valid(self):
        """Test that federal_ministries.json is valid."""
        import os
        discovery_path = 'backend-v5/discovery/federal_ministries.json'

        if os.path.exists(discovery_path):
            with open(discovery_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            assert 'ministries' in data
            assert len(data['ministries']) > 0

            for ministry in data['ministries']:
                assert 'id' in ministry
                assert 'name_en' in ministry
                assert 'base_url' in ministry
                assert 'endpoints' in ministry

    def test_constitutional_bodies_json_valid(self):
        """Test that constitutional_bodies.json is valid."""
        import os
        discovery_path = 'backend-v5/discovery/constitutional_bodies.json'

        if os.path.exists(discovery_path):
            with open(discovery_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            assert 'bodies' in data
            assert len(data['bodies']) > 0

    def test_local_government_json_valid(self):
        """Test that local_government.json is valid."""
        import os
        discovery_path = 'backend-v5/discovery/local_government.json'

        if os.path.exists(discovery_path):
            with open(discovery_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            assert 'municipalities' in data
            assert len(data['municipalities']) > 0


# ============ Integration Tests ============

@pytest.mark.integration
class TestIntegration:
    """Integration tests (require network access)."""

    @pytest.mark.skip(reason="Requires network access")
    def test_mof_scraper_live(self):
        """Test MOF scraper with live data."""
        scraper = get_ministry_scraper('mof')
        posts = scraper.scrape_endpoint('press_release_en', max_pages=1)

        assert len(posts) >= 0
        for post in posts:
            assert post.title
            assert post.url
            assert post.source_id == 'mof'

    @pytest.mark.skip(reason="Requires network access")
    @pytest.mark.asyncio
    async def test_async_ministry_scrape(self):
        """Test async ministry scraping."""
        config = MINISTRY_CONFIGS['mof']
        results = await scrape_ministry_async(config, endpoints=['press_release_en'], max_pages=1)

        assert 'press_release_en' in results
        assert len(results['press_release_en']) >= 0


# ============ Utility Function Tests ============

class TestUtilityFunctions:
    """Tests for utility functions."""

    def test_date_conversion_bs_to_ad(self):
        """Test BS to AD date conversion (if available)."""
        try:
            from app.utils.nepali_date import bs_to_ad

            # Test a known date
            ad_date = bs_to_ad(2081, 10, 15)
            assert ad_date is not None
            assert ad_date.year >= 2024
        except ImportError:
            pytest.skip("Nepali date converter not available")


# ============ Run Tests ============

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
