#!/usr/bin/env python3
"""
DAO (District Administration Office) Scraper

Scrapes announcements from all 77 District Administration Offices in Nepal.
DAO offices issue important local orders including curfews (कर्फ्यु आदेश),
prohibitory orders, and emergency notifications.

URL Pattern: https://dao{district}.moha.gov.np
"""

import requests
from bs4 import BeautifulSoup
import re
import hashlib
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict, field
import urllib3

# Suppress SSL warnings for Nepal govt sites
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class DAOPost:
    """Structured data for a DAO post/notice."""
    id: str
    title: str
    url: str
    district: str
    province: str
    date_bs: Optional[str] = None
    date: Optional[str] = None
    category: str = "notice"
    has_attachment: bool = False
    source: str = ""
    source_name: str = ""
    scraped_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class DAOScraper:
    """
    Scraper for Nepal's 77 District Administration Office websites.

    DAO websites follow the pattern: https://dao{district}.moha.gov.np
    They use the same template as other government websites.
    """

    # All 77 districts with their provinces
    DISTRICTS = {
        # Koshi Province (Province 1) - 14 districts
        'taplejung': {'province': 'Koshi', 'name': 'Taplejung', 'name_ne': 'ताप्लेजुङ'},
        'panchthar': {'province': 'Koshi', 'name': 'Panchthar', 'name_ne': 'पाँचथर'},
        'ilam': {'province': 'Koshi', 'name': 'Ilam', 'name_ne': 'इलाम'},
        'jhapa': {'province': 'Koshi', 'name': 'Jhapa', 'name_ne': 'झापा'},
        'morang': {'province': 'Koshi', 'name': 'Morang', 'name_ne': 'मोरङ'},
        'sunsari': {'province': 'Koshi', 'name': 'Sunsari', 'name_ne': 'सुनसरी'},
        'dhankuta': {'province': 'Koshi', 'name': 'Dhankuta', 'name_ne': 'धनकुटा'},
        'terhathum': {'province': 'Koshi', 'name': 'Terhathum', 'name_ne': 'तेह्रथुम'},
        'sankhuwasabha': {'province': 'Koshi', 'name': 'Sankhuwasabha', 'name_ne': 'संखुवासभा'},
        'bhojpur': {'province': 'Koshi', 'name': 'Bhojpur', 'name_ne': 'भोजपुर'},
        'solukhumbu': {'province': 'Koshi', 'name': 'Solukhumbu', 'name_ne': 'सोलुखुम्बु'},
        'okhaldhunga': {'province': 'Koshi', 'name': 'Okhaldhunga', 'name_ne': 'ओखलढुङ्गा'},
        'khotang': {'province': 'Koshi', 'name': 'Khotang', 'name_ne': 'खोटाङ'},
        'udayapur': {'province': 'Koshi', 'name': 'Udayapur', 'name_ne': 'उदयपुर'},

        # Madhesh Province (Province 2) - 8 districts
        'saptari': {'province': 'Madhesh', 'name': 'Saptari', 'name_ne': 'सप्तरी'},
        'siraha': {'province': 'Madhesh', 'name': 'Siraha', 'name_ne': 'सिराहा'},
        'dhanusa': {'province': 'Madhesh', 'name': 'Dhanusa', 'name_ne': 'धनुषा'},
        'mahottari': {'province': 'Madhesh', 'name': 'Mahottari', 'name_ne': 'महोत्तरी'},
        'sarlahi': {'province': 'Madhesh', 'name': 'Sarlahi', 'name_ne': 'सर्लाही'},
        'rautahat': {'province': 'Madhesh', 'name': 'Rautahat', 'name_ne': 'रौतहट'},
        'bara': {'province': 'Madhesh', 'name': 'Bara', 'name_ne': 'बारा'},
        'parsa': {'province': 'Madhesh', 'name': 'Parsa', 'name_ne': 'पर्सा'},

        # Bagmati Province (Province 3) - 13 districts
        'dolakha': {'province': 'Bagmati', 'name': 'Dolakha', 'name_ne': 'दोलखा'},
        'sindhupalchok': {'province': 'Bagmati', 'name': 'Sindhupalchok', 'name_ne': 'सिन्धुपाल्चोक'},
        'rasuwa': {'province': 'Bagmati', 'name': 'Rasuwa', 'name_ne': 'रसुवा'},
        'dhading': {'province': 'Bagmati', 'name': 'Dhading', 'name_ne': 'धादिङ'},
        'nuwakot': {'province': 'Bagmati', 'name': 'Nuwakot', 'name_ne': 'नुवाकोट'},
        'kathmandu': {'province': 'Bagmati', 'name': 'Kathmandu', 'name_ne': 'काठमाडौं'},
        'bhaktapur': {'province': 'Bagmati', 'name': 'Bhaktapur', 'name_ne': 'भक्तपुर'},
        'lalitpur': {'province': 'Bagmati', 'name': 'Lalitpur', 'name_ne': 'ललितपुर'},
        'kavrepalanchok': {'province': 'Bagmati', 'name': 'Kavrepalanchok', 'name_ne': 'काभ्रेपलाञ्चोक'},
        'ramechhap': {'province': 'Bagmati', 'name': 'Ramechhap', 'name_ne': 'रामेछाप'},
        'sindhuli': {'province': 'Bagmati', 'name': 'Sindhuli', 'name_ne': 'सिन्धुली'},
        'makwanpur': {'province': 'Bagmati', 'name': 'Makwanpur', 'name_ne': 'मकवानपुर'},
        'chitwan': {'province': 'Bagmati', 'name': 'Chitwan', 'name_ne': 'चितवन'},

        # Gandaki Province (Province 4) - 11 districts
        'gorkha': {'province': 'Gandaki', 'name': 'Gorkha', 'name_ne': 'गोरखा'},
        'lamjung': {'province': 'Gandaki', 'name': 'Lamjung', 'name_ne': 'लमजुङ'},
        'tanahun': {'province': 'Gandaki', 'name': 'Tanahun', 'name_ne': 'तनहुँ'},
        'syangja': {'province': 'Gandaki', 'name': 'Syangja', 'name_ne': 'स्याङ्जा'},
        'kaski': {'province': 'Gandaki', 'name': 'Kaski', 'name_ne': 'कास्की'},
        'manang': {'province': 'Gandaki', 'name': 'Manang', 'name_ne': 'मनाङ'},
        'mustang': {'province': 'Gandaki', 'name': 'Mustang', 'name_ne': 'मुस्ताङ'},
        'myagdi': {'province': 'Gandaki', 'name': 'Myagdi', 'name_ne': 'म्याग्दी'},
        'parbat': {'province': 'Gandaki', 'name': 'Parbat', 'name_ne': 'पर्वत'},
        'baglung': {'province': 'Gandaki', 'name': 'Baglung', 'name_ne': 'बाग्लुङ'},
        'nawalpur': {'province': 'Gandaki', 'name': 'Nawalpur', 'name_ne': 'नवलपुर'},

        # Lumbini Province (Province 5) - 12 districts
        'parasi': {'province': 'Lumbini', 'name': 'Parasi', 'name_ne': 'पर्सा'},
        'rupandehi': {'province': 'Lumbini', 'name': 'Rupandehi', 'name_ne': 'रुपन्देही'},
        'kapilvastu': {'province': 'Lumbini', 'name': 'Kapilvastu', 'name_ne': 'कपिलवस्तु'},
        'palpa': {'province': 'Lumbini', 'name': 'Palpa', 'name_ne': 'पाल्पा'},
        'arghakhanchi': {'province': 'Lumbini', 'name': 'Arghakhanchi', 'name_ne': 'अर्घाखाँची'},
        'gulmi': {'province': 'Lumbini', 'name': 'Gulmi', 'name_ne': 'गुल्मी'},
        'pyuthan': {'province': 'Lumbini', 'name': 'Pyuthan', 'name_ne': 'प्यूठान'},
        'rolpa': {'province': 'Lumbini', 'name': 'Rolpa', 'name_ne': 'रोल्पा'},
        'rukumeast': {'province': 'Lumbini', 'name': 'Rukum East', 'name_ne': 'रुकुम पूर्व'},
        'dang': {'province': 'Lumbini', 'name': 'Dang', 'name_ne': 'दाङ'},
        'banke': {'province': 'Lumbini', 'name': 'Banke', 'name_ne': 'बाँके'},
        'bardiya': {'province': 'Lumbini', 'name': 'Bardiya', 'name_ne': 'बर्दिया'},

        # Karnali Province (Province 6) - 10 districts
        'dolpa': {'province': 'Karnali', 'name': 'Dolpa', 'name_ne': 'डोल्पा'},
        'mugu': {'province': 'Karnali', 'name': 'Mugu', 'name_ne': 'मुगु'},
        'humla': {'province': 'Karnali', 'name': 'Humla', 'name_ne': 'हुम्ला'},
        'jumla': {'province': 'Karnali', 'name': 'Jumla', 'name_ne': 'जुम्ला'},
        'kalikot': {'province': 'Karnali', 'name': 'Kalikot', 'name_ne': 'कालिकोट'},
        'dailekh': {'province': 'Karnali', 'name': 'Dailekh', 'name_ne': 'दैलेख'},
        'jajarkot': {'province': 'Karnali', 'name': 'Jajarkot', 'name_ne': 'जाजरकोट'},
        'rukumwest': {'province': 'Karnali', 'name': 'Rukum West', 'name_ne': 'रुकुम पश्चिम'},
        'salyan': {'province': 'Karnali', 'name': 'Salyan', 'name_ne': 'सल्यान'},
        'surkhet': {'province': 'Karnali', 'name': 'Surkhet', 'name_ne': 'सुर्खेत'},

        # Sudurpashchim Province (Province 7) - 9 districts
        'bajura': {'province': 'Sudurpashchim', 'name': 'Bajura', 'name_ne': 'बाजुरा'},
        'bajhang': {'province': 'Sudurpashchim', 'name': 'Bajhang', 'name_ne': 'बझाङ'},
        'achham': {'province': 'Sudurpashchim', 'name': 'Achham', 'name_ne': 'अछाम'},
        'doti': {'province': 'Sudurpashchim', 'name': 'Doti', 'name_ne': 'डोटी'},
        'kailali': {'province': 'Sudurpashchim', 'name': 'Kailali', 'name_ne': 'कैलाली'},
        'kanchanpur': {'province': 'Sudurpashchim', 'name': 'Kanchanpur', 'name_ne': 'कञ्चनपुर'},
        'dadeldhura': {'province': 'Sudurpashchim', 'name': 'Dadeldhura', 'name_ne': 'डडेलधुरा'},
        'baitadi': {'province': 'Sudurpashchim', 'name': 'Baitadi', 'name_ne': 'बैतडी'},
        'darchula': {'province': 'Sudurpashchim', 'name': 'Darchula', 'name_ne': 'दार्चुला'},
    }

    # Priority districts (metros/sub-metros with high population)
    PRIORITY_DISTRICTS = [
        'kathmandu', 'lalitpur', 'bhaktapur', 'kaski',  # Major metros
        'morang', 'sunsari', 'parsa', 'chitwan', 'rupandehi',  # Regional hubs
        'kailali', 'banke', 'dang', 'jhapa', 'sarlahi',  # Other important
    ]

    # Page URL patterns
    PAGES = {
        'press-release-en': '/en/page/press-release',
        'press-release-ne': '/page/press-release',
        'notice-en': '/en/page/notice',
        'notice-ne': '/page/notice',
        'circular-en': '/en/page/circular',
        'circular-ne': '/page/circular',
    }

    def __init__(self, delay: float = 0.5, verify_ssl: bool = False):
        """
        Initialize the scraper.

        Args:
            delay: Delay between requests in seconds
            verify_ssl: Whether to verify SSL certificates
        """
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,ne;q=0.8',
        })
        self.delay = delay
        self.verify_ssl = verify_ssl

    @staticmethod
    def get_dao_url(district: str) -> str:
        """Get DAO website URL for a district."""
        return f"https://dao{district.lower()}.moha.gov.np"

    def _fetch_page(self, url: str) -> Optional[BeautifulSoup]:
        """Fetch a page and return parsed BeautifulSoup object."""
        try:
            import time
            time.sleep(self.delay)

            response = self.session.get(url, verify=self.verify_ssl, timeout=30)
            response.raise_for_status()
            return BeautifulSoup(response.text, 'html.parser')
        except requests.RequestException as e:
            logger.error(f"Failed to fetch {url}: {e}")
            return None

    def _parse_table_posts(self, soup: BeautifulSoup, district_key: str, category: str) -> List[DAOPost]:
        """Parse posts from table-based layout."""
        posts = []
        district_info = self.DISTRICTS[district_key]
        base_url = self.get_dao_url(district_key)

        table = soup.find('table')
        if not table:
            return self._parse_card_posts(soup, district_key, category)

        tbody = table.find('tbody') or table

        for row in tbody.find_all('tr'):
            cells = row.find_all('td')
            if not cells:
                continue

            link = row.find('a', href=True)
            if not link:
                continue

            title = link.get_text(strip=True)
            title = re.sub(r'\d+\s*(month|day|week|year|hour|minute)s?\s*ago\s*$', '', title, flags=re.I).strip()

            if not title:
                continue

            url = link['href']
            if not url.startswith('http'):
                url = f"{base_url}{url}"

            date_bs = None
            for cell in cells:
                text = cell.get_text(strip=True)
                bs_match = re.search(r'(20\d{2}-\d{2}-\d{2})', text)
                if bs_match:
                    date_bs = bs_match.group(1)
                    break

            has_attachment = bool(row.find('a', href=re.compile(r'\.(pdf|doc|docx|xls|xlsx)$', re.I)))

            post_id = hashlib.md5(url.encode()).hexdigest()[:12]

            posts.append(DAOPost(
                id=post_id,
                title=title,
                url=url,
                district=district_info['name'],
                province=district_info['province'],
                date_bs=date_bs,
                category=category,
                has_attachment=has_attachment,
                source=f"dao{district_key}.moha.gov.np",
                source_name=f"DAO {district_info['name']}",
            ))

        return posts

    def _parse_card_posts(self, soup: BeautifulSoup, district_key: str, category: str) -> List[DAOPost]:
        """Parse posts from card/list layout."""
        posts = []
        district_info = self.DISTRICTS[district_key]
        base_url = self.get_dao_url(district_key)

        cards = soup.find_all('div', class_=re.compile(r'card|news-item|post-item|list-item', re.I))
        if not cards:
            cards = soup.find_all('article')
        if not cards:
            # Try ul/li structure
            ul = soup.find('ul', class_=re.compile(r'list|news|post', re.I))
            if ul:
                cards = ul.find_all('li')

        for card in cards:
            link = card.find('a', href=True)
            if not link:
                continue

            title_el = card.find(['h2', 'h3', 'h4', 'h5']) or link
            title = title_el.get_text(strip=True)

            if not title or len(title) < 5:
                continue

            url = link['href']
            if not url.startswith('http'):
                url = f"{base_url}{url}"

            date_bs = None
            date_el = card.find(class_=re.compile(r'date|time|posted', re.I))
            if date_el:
                text = date_el.get_text(strip=True)
                bs_match = re.search(r'(20\d{2}-\d{2}-\d{2})', text)
                if bs_match:
                    date_bs = bs_match.group(1)

            has_attachment = bool(card.find('a', href=re.compile(r'\.(pdf|doc|docx)$', re.I)))

            post_id = hashlib.md5(url.encode()).hexdigest()[:12]

            posts.append(DAOPost(
                id=post_id,
                title=title,
                url=url,
                district=district_info['name'],
                province=district_info['province'],
                date_bs=date_bs,
                category=category,
                has_attachment=has_attachment,
                source=f"dao{district_key}.moha.gov.np",
                source_name=f"DAO {district_info['name']}",
            ))

        return posts

    def _get_pagination_info(self, soup: BeautifulSoup) -> Dict[str, Any]:
        """Extract pagination information."""
        info = {
            'current_page': 1,
            'total_pages': 1,
            'next_url': None,
        }

        pagination = soup.find('nav', {'aria-label': 'Pagination Navigation'}) or \
                     soup.find('ul', class_=re.compile(r'pagination', re.I)) or \
                     soup.find('div', class_=re.compile(r'pagination', re.I))

        if not pagination:
            return info

        page_links = pagination.find_all('a', href=True)
        for link in page_links:
            text = link.get_text(strip=True)
            if text.isdigit():
                info['total_pages'] = max(info['total_pages'], int(text))

        next_link = pagination.find('a', {'rel': 'next'}) or \
                    pagination.find('a', string=re.compile(r'next|»|>', re.I))
        if next_link:
            info['next_url'] = next_link.get('href', '')

        return info

    def scrape_district(
        self,
        district_key: str,
        category: str = 'notice-en',
        max_pages: int = 3,
    ) -> List[DAOPost]:
        """
        Scrape posts from a specific district's DAO.

        Args:
            district_key: District identifier (e.g., 'kathmandu', 'lalitpur')
            category: Category key (see PAGES dict)
            max_pages: Maximum pages to scrape

        Returns:
            List of DAOPost objects
        """
        if district_key not in self.DISTRICTS:
            raise ValueError(f"Unknown district: {district_key}")

        if category not in self.PAGES:
            raise ValueError(f"Unknown category: {category}")

        base_url = f"{self.get_dao_url(district_key)}{self.PAGES[category]}"
        all_posts = []
        current_url = base_url

        for page_num in range(1, max_pages + 1):
            logger.info(f"Scraping DAO {district_key} {category} page {page_num}: {current_url}")

            soup = self._fetch_page(current_url)
            if not soup:
                logger.error(f"Failed to fetch page {page_num}")
                break

            posts = self._parse_table_posts(soup, district_key, category)
            if not posts:
                logger.info(f"No posts found on page {page_num}, stopping")
                break

            all_posts.extend(posts)
            logger.info(f"Found {len(posts)} posts on page {page_num}")

            pagination = self._get_pagination_info(soup)
            if pagination['next_url']:
                next_url = pagination['next_url']
                if not next_url.startswith('http'):
                    next_url = f"{self.get_dao_url(district_key)}{next_url}"
                current_url = next_url
            elif page_num < pagination['total_pages']:
                current_url = f"{base_url}?page={page_num + 1}"
            else:
                break

        # Deduplicate
        seen_urls = set()
        unique_posts = []
        for post in all_posts:
            if post.url not in seen_urls:
                seen_urls.add(post.url)
                unique_posts.append(post)

        logger.info(f"Total unique posts from DAO {district_key}: {len(unique_posts)}")
        return unique_posts

    def scrape_priority_districts(
        self,
        categories: List[str] = None,
        max_pages_per_category: int = 2,
    ) -> Dict[str, List[DAOPost]]:
        """
        Scrape from priority districts (metros/sub-metros).

        Args:
            categories: List of category keys
            max_pages_per_category: Max pages per category

        Returns:
            Dict mapping district to list of posts
        """
        if categories is None:
            categories = ['notice-en', 'circular-en']

        results = {}
        for district_key in self.PRIORITY_DISTRICTS:
            district_posts = []
            for category in categories:
                try:
                    posts = self.scrape_district(district_key, category, max_pages=max_pages_per_category)
                    district_posts.extend(posts)
                except Exception as e:
                    logger.error(f"Error scraping DAO {district_key} {category}: {e}")

            results[district_key] = district_posts

        return results

    def scrape_all_districts(
        self,
        categories: List[str] = None,
        max_pages_per_category: int = 1,
    ) -> Dict[str, List[DAOPost]]:
        """
        Scrape from all 77 districts.

        WARNING: This will make many requests. Use with caution.

        Args:
            categories: List of category keys
            max_pages_per_category: Max pages per category

        Returns:
            Dict mapping district to list of posts
        """
        if categories is None:
            categories = ['notice-en']

        results = {}
        for district_key in self.DISTRICTS:
            district_posts = []
            for category in categories:
                try:
                    posts = self.scrape_district(district_key, category, max_pages=max_pages_per_category)
                    district_posts.extend(posts)
                except Exception as e:
                    logger.error(f"Error scraping DAO {district_key} {category}: {e}")

            results[district_key] = district_posts

        return results


# ============ Async wrapper for FastAPI ============

async def fetch_dao_posts_async(
    district_key: str,
    category: str = 'notice-en',
    max_pages: int = 2,
) -> List[Dict[str, Any]]:
    """
    Async wrapper for DAO scraping.

    For use in FastAPI endpoints - runs sync code in executor.
    """
    import asyncio

    def _scrape():
        scraper = DAOScraper(delay=0.5, verify_ssl=False)
        posts = scraper.scrape_district(district_key, category, max_pages=max_pages)
        return [asdict(p) for p in posts]

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _scrape)


async def fetch_priority_dao_posts_async(
    categories: List[str] = None,
    max_pages: int = 2,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Async wrapper to fetch from priority districts.
    """
    import asyncio

    if categories is None:
        categories = ['notice-en', 'circular-en']

    def _scrape():
        scraper = DAOScraper(delay=0.5, verify_ssl=False)
        results = scraper.scrape_priority_districts(categories, max_pages_per_category=max_pages)
        return {dist: [asdict(p) for p in posts] for dist, posts in results.items()}

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _scrape)


async def scrape_all_daos_async(
    max_pages: int = 1,
    max_concurrent: int = 10,
    categories: List[str] = None,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """
    Async wrapper to scrape all 77 DAOs concurrently.

    Args:
        max_pages: Max pages per category per district
        max_concurrent: Maximum concurrent scraping tasks
        categories: List of category keys to scrape

    Returns:
        Dict mapping district -> category -> list of posts
    """
    import asyncio

    if categories is None:
        categories = ['notice-en']

    semaphore = asyncio.Semaphore(max_concurrent)

    async def scrape_district(district_key: str) -> tuple:
        async with semaphore:
            def _scrape():
                scraper = DAOScraper(delay=0.3, verify_ssl=False)
                district_results = {}
                for category in categories:
                    try:
                        posts = scraper.scrape_district(district_key, category, max_pages=max_pages)
                        district_results[category] = [asdict(p) for p in posts]
                    except Exception as e:
                        logger.error(f"Error scraping DAO {district_key} {category}: {e}")
                        district_results[category] = []
                return district_results

            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, _scrape)
            return district_key, result

    tasks = [scrape_district(d) for d in DAOScraper.DISTRICTS.keys()]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    final_results = {}
    for item in results:
        if isinstance(item, Exception):
            logger.error(f"District scraping failed: {item}")
            continue
        district_key, district_data = item
        final_results[district_key] = district_data

    return final_results


# ============ CLI ============

def main():
    print("=" * 60)
    print("DAO (District Administration Office) Scraper - Nepal")
    print("=" * 60)
    print(f"\nTotal districts: {len(DAOScraper.DISTRICTS)}")
    print(f"Priority districts: {len(DAOScraper.PRIORITY_DISTRICTS)}")
    print()

    scraper = DAOScraper(delay=0.5, verify_ssl=False)

    print("[1] Scraping DAO Kathmandu notices (page 1)...")
    posts = scraper.scrape_district('kathmandu', 'notice-en', max_pages=1)

    print(f"\nFound {len(posts)} posts:")
    print("-" * 60)

    for i, post in enumerate(posts[:5], 1):
        print(f"[{i}] {post.title[:60]}")
        print(f"    District: {post.district} ({post.province})")
        print(f"    Date (BS): {post.date_bs}")
        print(f"    URL: {post.url}")
        print()

    if len(posts) > 5:
        print(f"... and {len(posts) - 5} more")


if __name__ == "__main__":
    main()
