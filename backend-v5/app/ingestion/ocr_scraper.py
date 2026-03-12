#!/usr/bin/env python3
"""
Nepal Office of Company Registrar (OCR) Scraper

Scrapes company data from: https://application.ocr.gov.np/faces/CompanyDetails.jsp
Enumerates companies by registration number (sequential integers).

The site uses JSF (JavaServer Faces) with ViewState tokens. Each POST must
carry the current ViewState from the previous response.

Multiple companies can share the same registration number.
"""

import re
import hashlib
import logging
import time
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, asdict, field

import requests
from bs4 import BeautifulSoup
import urllib3

# Suppress SSL warnings for Nepal govt sites
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@dataclass
class OCRCompany:
    """Structured data for a single company from OCR."""
    registration_number: int
    name_nepali: str = ""
    name_english: str = ""
    registration_date_bs: str = ""  # BS date e.g. "2041-01-29"
    company_type: str = ""
    company_address: str = ""
    last_communication_bs: str = ""
    raw_data: Dict[str, Any] = field(default_factory=dict)


class OCRScraper:
    """
    Scraper for Nepal's Office of Company Registrar (OCR).

    Uses JSF form submission to search companies by sequential registration
    numbers. The site requires ViewState tokens for each request.
    """

    BASE_URL = "https://application.ocr.gov.np/faces/CompanyDetails.jsp"

    # JSF form IDs (static based on the page structure)
    FORM_ID = "j_id_jsp_826405674_6"
    REG_FIELD = f"{FORM_ID}:registrationNumber"
    SEARCH_BTN = f"{FORM_ID}:j_id_jsp_826405674_16"

    # Company type classification keywords
    TYPE_KEYWORDS = {
        "Private": ["प्राइभेट", "Private"],
        "Public": ["पब्लिक", "Public"],
        "Foreign": ["विदेशी", "Foreign"],
        "Non-profit": ["मुनाफा वितरण नगर्ने", "Non-profit", "Not for profit"],
    }

    def __init__(self, delay: float = 1.0):
        self.session = requests.Session()
        self.session.verify = False
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://application.ocr.gov.np",
            "Referer": "https://application.ocr.gov.np/faces/CompanyDetails.jsp",
        })
        self.delay = delay
        self.view_state: Optional[str] = None

    def _init_session(self) -> bool:
        """Establish session and get initial ViewState."""
        try:
            resp = self.session.get(self.BASE_URL, timeout=60)
            self.view_state = self._extract_view_state(resp.text)
            if not self.view_state:
                logger.warning("Could not extract ViewState, using default")
                self.view_state = "j_id12124:j_id12195"
            logger.info(f"OCR session established (ViewState: {self.view_state[:20]}...)")
            return True
        except requests.RequestException as e:
            logger.error(f"Failed to establish OCR session: {e}")
            return False

    @staticmethod
    def _extract_view_state(html: str) -> Optional[str]:
        """Extract javax.faces.ViewState from JSF page."""
        soup = BeautifulSoup(html, "html.parser")
        vs_input = soup.find("input", {"name": "javax.faces.ViewState"})
        if vs_input:
            return vs_input.get("value", "")
        match = re.search(r'name="javax\.faces\.ViewState"\s+value="([^"]+)"', html)
        return match.group(1) if match else None

    def _search_reg_number(self, reg_number: int) -> List[OCRCompany]:
        """Search for companies by registration number."""
        form_data = {
            self.FORM_ID: self.FORM_ID,
            self.REG_FIELD: str(reg_number),
            self.SEARCH_BTN: "Search",
            "javax.faces.ViewState": self.view_state,
        }

        try:
            resp = self.session.post(self.BASE_URL, data=form_data, timeout=30)
            if resp.status_code != 200:
                return []

            # Update ViewState for next request
            new_vs = self._extract_view_state(resp.text)
            if new_vs:
                self.view_state = new_vs

            return self._parse_results(resp.text, reg_number)

        except requests.exceptions.Timeout:
            logger.warning(f"Timeout for reg #{reg_number}, retrying...")
            time.sleep(5)
            try:
                resp = self.session.post(self.BASE_URL, data=form_data, timeout=60)
                new_vs = self._extract_view_state(resp.text)
                if new_vs:
                    self.view_state = new_vs
                return self._parse_results(resp.text, reg_number)
            except Exception:
                return []
        except Exception as e:
            logger.debug(f"Error for reg #{reg_number}: {e}")
            return []

    def _parse_results(self, html: str, reg_number: int) -> List[OCRCompany]:
        """Parse the company results table from JSF response.

        The OCR site uses a non-standard JSF table where ALL data cells are in
        the first <tr>. Structure:
        - 9 <th> cells: "Company Details" (title, colspan=8) + 8 column headers
        - <td>[0]: Garbage summary cell with concatenated text
        - <td>[1..8]: First company data
        - <td>[9..16]: Second company data
        - ... repeating in groups of 8
        """
        if "Invalid Registration Number" in html:
            return []

        soup = BeautifulSoup(html, "html.parser")
        companies = []

        for table in soup.find_all("table"):
            first_row = table.find("tr")
            if not first_row:
                continue

            # Check for Company Details headers
            ths = first_row.find_all("th")
            th_texts = [th.get_text(strip=True) for th in ths]
            if not any("Registration" in t or "Nepali" in t for t in th_texts):
                continue

            # All data is in <td> cells of the first row
            tds = first_row.find_all("td")
            if len(tds) < 9:  # Need garbage cell + at least 8 data cells
                continue

            data_cells = tds[1:]  # Skip first garbage summary cell

            # Chunk into groups of 8: S/No, Nepali, English, RegNo, DateBS, Type, Address, LastComm
            COLS = 8
            for i in range(0, len(data_cells) - COLS + 1, COLS):
                chunk = data_cells[i:i + COLS]
                texts = [re.sub(r'\s+', ' ', c.get_text(strip=True)) for c in chunk]

                name_nepali = texts[1]
                name_english = texts[2]
                reg_date_bs = texts[4]
                company_type = texts[5]
                address = texts[6]
                last_comm = texts[7]

                if not name_english and not name_nepali:
                    continue

                # Filter out fallback results: OCR returns the last company
                # for any number beyond max registration. Detect by checking
                # if the returned reg number matches our query.
                returned_reg = texts[3].strip()
                if returned_reg and returned_reg.isdigit() and int(returned_reg) != reg_number:
                    continue

                companies.append(OCRCompany(
                    registration_number=reg_number,
                    name_nepali=name_nepali,
                    name_english=name_english or name_nepali,
                    registration_date_bs=reg_date_bs,
                    company_type=company_type,
                    company_address=address,
                    last_communication_bs=last_comm,
                    raw_data={
                        "serial": texts[0],
                        "name_nepali": name_nepali,
                        "name_english": name_english,
                        "registration_number": texts[3],
                        "registration_date_bs": reg_date_bs,
                        "company_type": company_type,
                        "company_address": address,
                        "last_communication_bs": last_comm,
                    },
                ))

        return companies

    def scrape_range(
        self,
        start: int = 1,
        end: int = 100,
        max_empty_streak: int = 50,
    ) -> List[OCRCompany]:
        """
        Scrape a range of registration numbers.

        Args:
            start: First registration number to query.
            end: Last registration number to query.
            max_empty_streak: Stop after this many consecutive empty results.

        Returns:
            List of OCRCompany objects.
        """
        if not self._init_session():
            return []

        all_companies: List[OCRCompany] = []
        empty_streak = 0
        total = end - start + 1

        logger.info(f"Scraping OCR reg numbers {start} to {end} ({total} queries)")

        for i, reg_num in enumerate(range(start, end + 1)):
            if i > 0 and i % 100 == 0:
                logger.info(f"Progress: {i}/{total} ({i*100//total}%) | Companies found: {len(all_companies)}")

            companies = self._search_reg_number(reg_num)

            if companies:
                all_companies.extend(companies)
                empty_streak = 0
                if len(companies) >= 3:
                    logger.info(f"Reg #{reg_num}: {len(companies)} companies")
            else:
                empty_streak += 1

            if empty_streak >= max_empty_streak:
                logger.info(f"{max_empty_streak} consecutive empty results at reg #{reg_num}. Stopping.")
                break

            time.sleep(self.delay)

            # Re-establish session every 500 requests
            if i > 0 and i % 500 == 0:
                logger.info("Re-establishing OCR session...")
                self._init_session()

        logger.info(f"OCR scrape complete: {len(all_companies)} companies from {i+1} queries")
        return all_companies

    @staticmethod
    def classify_company_type(type_str: str) -> Optional[str]:
        """Classify company type into broad category.

        Returns: 'Private', 'Public', 'Foreign', 'Non-profit', or None.
        """
        if not type_str:
            return None
        for category, keywords in OCRScraper.TYPE_KEYWORDS.items():
            if any(kw in type_str for kw in keywords):
                return category
        return None

    @staticmethod
    def extract_district(address: str) -> Optional[str]:
        """Extract district name from address string.

        Address format: "ललितपुर उप म.न.पा.-१५,ललितपुर,बाग्मती"
        Last two parts are district and province.
        """
        if not address:
            return None
        parts = [p.strip() for p in address.split(",")]
        if len(parts) >= 2:
            return parts[-2]
        return None

    @staticmethod
    def extract_province(address: str) -> Optional[str]:
        """Extract province name from address string."""
        if not address:
            return None
        parts = [p.strip() for p in address.split(",")]
        if len(parts) >= 3:
            return parts[-1]
        return None

    @staticmethod
    def generate_external_id(reg_number: int, name_english: str, reg_date_bs: str) -> str:
        """Generate a deterministic external ID for deduplication."""
        key = f"{reg_number}|{name_english.strip()}|{reg_date_bs.strip()}"
        return hashlib.sha256(key.encode()).hexdigest()[:40]


# ============ Async wrapper for FastAPI ============

async def scrape_ocr_async(
    start: int = 1,
    end: int = 100,
    delay: float = 1.0,
    max_empty_streak: int = 50,
) -> List[Dict[str, Any]]:
    """
    Async wrapper for OCR scraping.

    For use in FastAPI endpoints — runs sync code in executor.
    """
    import asyncio

    def _scrape():
        scraper = OCRScraper(delay=delay)
        companies = scraper.scrape_range(start=start, end=end, max_empty_streak=max_empty_streak)
        return [asdict(c) for c in companies]

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _scrape)


# ============ CLI ============

def main():
    print("=" * 60)
    print("Nepal OCR Company Registrar Scraper")
    print("=" * 60)

    scraper = OCRScraper(delay=1.0)
    companies = scraper.scrape_range(start=1, end=10)

    print(f"\nFound {len(companies)} companies:")
    print("-" * 60)

    for i, c in enumerate(companies[:20], 1):
        print(f"[{i}] Reg #{c.registration_number}: {c.name_english}")
        print(f"    Nepali: {c.name_nepali}")
        print(f"    Date (BS): {c.registration_date_bs}")
        print(f"    Type: {c.company_type[:60]}")
        cat = OCRScraper.classify_company_type(c.company_type)
        print(f"    Category: {cat}")
        print(f"    Address: {c.company_address}")
        district = OCRScraper.extract_district(c.company_address)
        province = OCRScraper.extract_province(c.company_address)
        print(f"    District: {district}, Province: {province}")
        print()


if __name__ == "__main__":
    main()
