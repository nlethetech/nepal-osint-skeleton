"""
Entity Index Generator - Auto-populates entity patterns from database.

Generates recognition patterns from:
- Election candidates (name_en, name_ne, party, party_ne)
- Parliament MPs (name_en, name_ne, constituency, ministry)
- Political entities KB (canonical with aliases)
- Constituencies (165 districts, 7 provinces)
"""
import re
import logging
from typing import Dict, List, Optional, Set
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.services.nlp.entity_patterns import EntityPattern

logger = logging.getLogger(__name__)


class EntityIndexGenerator:
    """
    Generates entity recognition patterns from database sources.

    Sources (in priority order):
    1. PoliticalEntity KB - highest confidence (curated)
    2. MPPerformance - parliament members
    3. Candidates - election candidates
    4. Constituencies - geographic entities
    """

    # Party name normalization
    PARTY_CANONICAL_MAP = {
        "nepali congress": "nepali_congress",
        "नेपाली काँग्रेस": "nepali_congress",
        "communist party of nepal (unified marxist-leninist)": "cpn_uml",
        "cpn (uml)": "cpn_uml",
        "cpn-uml": "cpn_uml",
        "नेकपा एमाले": "cpn_uml",
        "communist party of nepal (maoist centre)": "cpn_maoist",
        "cpn (maoist centre)": "cpn_maoist",
        "नेकपा माओवादी केन्द्र": "cpn_maoist",
        "rastriya swatantra party": "rsp",
        "राष्ट्रिय स्वतन्त्र पार्टी": "rsp",
        "rastriya prajatantra party": "rpp",
        "राष्ट्रिय प्रजातन्त्र पार्टी": "rpp",
        "janata samajwadi party": "jsp",
        "जनता समाजवादी पार्टी": "jsp",
        "loktantrik samajwadi party": "lsp",
        "लोकतान्त्रिक समाजवादी पार्टी": "lsp",
        "cpn (unified socialist)": "cpn_us",
        "नेकपा एकीकृत समाजवादी": "cpn_us",
        "independent": "independent",
        "स्वतन्त्र": "independent",
    }

    def __init__(self):
        self._generated_patterns: Dict[str, EntityPattern] = {}
        self._seen_canonicals: Set[str] = set()

    def _slugify(self, text: str) -> str:
        """Convert text to slug for canonical ID."""
        text = text.lower().strip()
        text = re.sub(r'[^\w\s-]', '', text)
        text = re.sub(r'[\s_-]+', '_', text)
        return text[:50]

    def _is_devanagari(self, text: str) -> bool:
        """Check if text contains Devanagari characters."""
        return any('\u0900' <= c <= '\u097F' for c in text)

    def _party_to_canonical(self, party: str) -> str:
        """Convert party name to canonical ID."""
        if not party:
            return "unknown_party"
        party_lower = party.lower().strip()
        return self.PARTY_CANONICAL_MAP.get(party_lower, f"party_{self._slugify(party)}")

    async def generate_all_patterns(self, session: AsyncSession) -> Dict[str, EntityPattern]:
        """
        Generate all entity patterns from database.

        Returns:
            Dict mapping pattern text to EntityPattern
        """
        self._generated_patterns = {}
        self._seen_canonicals = set()

        # Generate in priority order (later sources don't overwrite)
        self._generate_common_entities()  # Add common hardcoded entities first
        await self._generate_kb_patterns(session)
        await self._generate_mp_patterns(session)
        await self._generate_candidate_patterns(session)
        await self._generate_location_patterns(session)
        await self._generate_party_patterns(session)

        logger.info(f"Generated {len(self._generated_patterns)} entity patterns")
        return self._generated_patterns

    def _generate_common_entities(self):
        """Generate common hardcoded entity patterns for high-coverage."""
        # Common organizations
        common_orgs = {
            # Government institutions
            ("निर्वाचन आयोग", "election_commission"): 0.95,
            ("निर्वाचन", "election_commission"): 0.88,  # Short form
            ("election commission", "election_commission"): 0.92,
            ("प्रतिनिधिसभा", "house_of_representatives"): 0.95,
            ("प्रतिनिधि सभा", "house_of_representatives"): 0.95,
            ("house of representatives", "house_of_representatives"): 0.92,
            ("राष्ट्रिय सभा", "national_assembly"): 0.95,
            ("national assembly", "national_assembly"): 0.92,
            ("संसद", "parliament"): 0.90,
            ("parliament", "parliament"): 0.88,
            ("सर्वोच्च अदालत", "supreme_court"): 0.95,
            ("supreme court", "supreme_court"): 0.92,
            ("नेपाल राष्ट्र बैंक", "nepal_rastra_bank"): 0.95,
            ("nepal rastra bank", "nepal_rastra_bank"): 0.92,
            ("nrb", "nepal_rastra_bank"): 0.85,
            ("अख्तियार", "ciaa"): 0.92,
            ("ciaa", "ciaa"): 0.88,
            # Political parties
            ("एमाले", "cpn_uml"): 0.92,
            ("नेकपा एमाले", "cpn_uml"): 0.95,
            ("uml", "cpn_uml"): 0.88,
            ("कांग्रेस", "nepali_congress"): 0.90,
            ("नेपाली कांग्रेस", "nepali_congress"): 0.95,
            ("नेपाली काँग्रेस", "nepali_congress"): 0.95,
            ("nepali congress", "nepali_congress"): 0.92,
            ("माओवादी", "cpn_maoist"): 0.88,
            ("माओवादी केन्द्र", "cpn_maoist"): 0.92,
            # Security
            ("नेपाल प्रहरी", "nepal_police"): 0.95,
            ("nepal police", "nepal_police"): 0.92,
            ("सशस्त्र प्रहरी", "apf"): 0.92,
            ("armed police force", "apf"): 0.90,
            ("नेपाली सेना", "nepal_army"): 0.95,
            ("nepal army", "nepal_army"): 0.92,
            # Sports
            ("एन्फा", "anfa"): 0.90,
            ("anfa", "anfa"): 0.88,
            ("साफ", "saff"): 0.90,
            ("saff", "saff"): 0.88,
            # Media
            ("नेपाल टेलिभिजन", "nepal_television"): 0.92,
            ("nepal television", "nepal_television"): 0.90,
            # Financial
            ("नेप्से", "nepse"): 0.92,
            ("nepse", "nepse"): 0.90,
        }

        for (text, canonical), confidence in common_orgs.items():
            self._add_pattern(text, EntityPattern(
                canonical_id=canonical,
                entity_type="ORGANIZATION",
                confidence=confidence,
                context_hints={},
                source="common",
            ))

        # Common political figures (aliases)
        common_persons = {
            # KP Oli
            ("ओली", "oli"): 0.90,
            ("केपी ओली", "oli"): 0.95,
            ("ke.p. oli", "oli"): 0.92,
            ("kp oli", "oli"): 0.92,
            # Prachanda
            ("प्रचण्ड", "prachanda"): 0.95,
            ("पुष्पकमल दाहाल", "prachanda"): 0.95,
            ("prachanda", "prachanda"): 0.92,
            ("dahal", "prachanda"): 0.85,
            # Deuba
            ("देउवा", "deuba"): 0.92,
            ("शेरबहादुर देउवा", "deuba"): 0.95,
            ("sher bahadur deuba", "deuba"): 0.92,
            # Karki
            ("कार्की", "karki"): 0.88,
            ("सुशिला कार्की", "karki"): 0.95,
            ("sushila karki", "karki"): 0.92,
            # President Poudel
            ("पौडेल", "rc_poudel"): 0.85,
            ("रामचन्द्र पौडेल", "rc_poudel"): 0.95,
            ("राष्ट्रपति पौडेल", "rc_poudel"): 0.95,
            ("ram chandra poudel", "rc_poudel"): 0.92,
            # Gagan Thapa
            ("गगन थापा", "gagan_thapa"): 0.95,
            ("gagan thapa", "gagan_thapa"): 0.92,
            # Rabi Lamichhane
            ("लामिछाने", "lamichhane"): 0.88,
            ("रवि लामिछाने", "lamichhane"): 0.95,
            ("rabi lamichhane", "lamichhane"): 0.92,
            # Madhav Nepal
            ("माधव नेपाल", "madhav_nepal"): 0.95,
            ("माधवकुमार नेपाल", "madhav_nepal"): 0.95,
            ("madhav nepal", "madhav_nepal"): 0.92,
            # Upendra Yadav
            ("यादव", "upendra_yadav"): 0.80,  # Lower - common surname
            ("उपेन्द्र यादव", "upendra_yadav"): 0.95,
            ("upendra yadav", "upendra_yadav"): 0.92,
            # Bhattarai
            ("भट्टराई", "bhattarai"): 0.80,  # Lower - common surname
            ("बाबुराम भट्टराई", "bhattarai"): 0.95,
            ("baburam bhattarai", "bhattarai"): 0.92,
            # Balen
            ("बालेन", "balen"): 0.92,
            ("बालेन शाह", "balen"): 0.95,
            ("balen", "balen"): 0.90,
            ("balen shah", "balen"): 0.92,
            # Generic titles that indicate person
            ("थापा", "thapa_generic"): 0.70,  # Common surname
            # Common last names with political context
            ("श्रेष्ठ", "shrestha_generic"): 0.65,
            ("पौडेल", "poudel_generic"): 0.70,
        }

        for (text, canonical), confidence in common_persons.items():
            self._add_pattern(text, EntityPattern(
                canonical_id=canonical,
                entity_type="PERSON",
                confidence=confidence,
                context_hints={},
                source="common",
            ))

        # Common locations (neighboring countries, major cities)
        common_locations = {
            # Neighboring countries
            ("भारत", "india"): 0.92,
            ("india", "india"): 0.90,
            ("चीन", "china"): 0.92,
            ("china", "china"): 0.90,
            ("जापान", "japan"): 0.92,
            ("japan", "japan"): 0.90,
            ("अमेरिका", "usa"): 0.92,
            ("usa", "usa"): 0.88,
            ("पाकिस्तान", "pakistan"): 0.92,
            ("pakistan", "pakistan"): 0.90,
            ("बंगलादेश", "bangladesh"): 0.92,
            ("bangladesh", "bangladesh"): 0.90,
            ("भुटान", "bhutan"): 0.92,
            ("bhutan", "bhutan"): 0.90,
            # Major cities - Nepali spellings
            ("काठमाडौं", "kathmandu"): 0.95,
            ("काठमाण्डौ", "kathmandu"): 0.95,
            ("काठमाण्डौं", "kathmandu"): 0.95,
            ("kathmandu", "kathmandu"): 0.92,
            ("पोखरा", "pokhara"): 0.95,
            ("pokhara", "pokhara"): 0.92,
            ("ललितपुर", "lalitpur"): 0.95,
            ("lalitpur", "lalitpur"): 0.92,
            ("पाटन", "lalitpur"): 0.90,
            ("भक्तपुर", "bhaktapur"): 0.95,
            ("bhaktapur", "bhaktapur"): 0.92,
            ("विराटनगर", "biratnagar"): 0.95,
            ("biratnagar", "biratnagar"): 0.92,
            ("वीरगञ्ज", "birgunj"): 0.95,
            ("birgunj", "birgunj"): 0.92,
            ("भरतपुर", "bharatpur"): 0.95,
            ("bharatpur", "bharatpur"): 0.92,
            ("धरान", "dharan"): 0.95,
            ("dharan", "dharan"): 0.92,
            ("दमक", "damak"): 0.95,
            ("damak", "damak"): 0.92,
            # Provinces
            ("बागमती", "bagmati_province"): 0.90,
            ("bagmati", "bagmati_province"): 0.88,
            ("मधेस", "madhesh_province"): 0.90,
            ("madhesh", "madhesh_province"): 0.88,
            ("गण्डकी", "gandaki_province"): 0.90,
            ("gandaki", "gandaki_province"): 0.88,
            ("लुम्बिनी", "lumbini_province"): 0.90,
            ("lumbini", "lumbini_province"): 0.88,
            ("कर्णाली", "karnali_province"): 0.90,
            ("karnali", "karnali_province"): 0.88,
            ("सुदूरपश्चिम", "sudurpashchim_province"): 0.90,
            ("कोशी", "koshi_province"): 0.90,
            ("प्रदेश", "province_generic"): 0.70,  # Generic - lower confidence
        }

        for (text, canonical), confidence in common_locations.items():
            self._add_pattern(text, EntityPattern(
                canonical_id=canonical,
                entity_type="LOCATION",
                confidence=confidence,
                context_hints={},
                source="common",
            ))

        logger.info(f"Added {len(common_orgs) + len(common_persons) + len(common_locations)} common entity patterns")

    def _add_pattern(self, text: str, pattern: EntityPattern, overwrite: bool = False):
        """Add pattern if not already present (or if overwrite=True)."""
        if not text or len(text.strip()) < 2:
            return

        text_key = text.strip()
        # For English, use lowercase key
        if not self._is_devanagari(text_key):
            text_key = text_key.lower()

        if text_key not in self._generated_patterns or overwrite:
            self._generated_patterns[text_key] = pattern

    async def _generate_kb_patterns(self, session: AsyncSession):
        """Generate patterns from PoliticalEntity KB (highest priority)."""
        try:
            from app.models.political_entity import PoliticalEntity, EntityType

            result = await session.execute(select(PoliticalEntity))
            entities = result.scalars().all()

            for entity in entities:
                base_confidence = 0.95 if entity.entity_type == EntityType.PERSON else 0.92

                # Map entity type
                entity_type_map = {
                    EntityType.PERSON: "PERSON",
                    EntityType.PARTY: "ORGANIZATION",
                    EntityType.ORGANIZATION: "ORGANIZATION",
                    EntityType.INSTITUTION: "ORGANIZATION",
                }
                etype = entity_type_map.get(entity.entity_type, "OTHER")

                context = {
                    "party": entity.party,
                    "role": entity.role,
                    "kb_id": str(entity.id),
                }

                # Primary English name
                self._add_pattern(entity.name_en, EntityPattern(
                    canonical_id=entity.canonical_id,
                    entity_type=etype,
                    confidence=base_confidence,
                    context_hints=context,
                    source="kb",
                ), overwrite=True)

                # Nepali name (higher confidence)
                if entity.name_ne:
                    self._add_pattern(entity.name_ne, EntityPattern(
                        canonical_id=entity.canonical_id,
                        entity_type=etype,
                        confidence=min(base_confidence + 0.03, 1.0),
                        context_hints=context,
                        source="kb",
                    ), overwrite=True)

                # All aliases
                if entity.aliases:
                    for alias in entity.aliases:
                        alias_conf = base_confidence - 0.02  # Slightly lower for aliases
                        self._add_pattern(alias, EntityPattern(
                            canonical_id=entity.canonical_id,
                            entity_type=etype,
                            confidence=alias_conf,
                            context_hints=context,
                            source="kb_alias",
                        ))

            logger.info(f"Generated {len(entities)} KB entity patterns")

        except Exception as e:
            logger.warning(f"Could not load PoliticalEntity KB: {e}")

    async def _generate_mp_patterns(self, session: AsyncSession):
        """Generate patterns from Parliament MPs."""
        try:
            from app.models.parliament import MPPerformance
            from app.models.political_entity import PoliticalEntity

            result = await session.execute(select(MPPerformance))
            mps = result.scalars().all()

            # Build entity UUID → canonical_id mapping for linked MPs
            entity_map = {}
            entity_result = await session.execute(select(PoliticalEntity.id, PoliticalEntity.canonical_id))
            for eid, cid in entity_result.all():
                entity_map[eid] = cid

            for mp in mps:
                # Use linked_entity_id's canonical_id if available
                canonical = entity_map.get(mp.linked_entity_id) if mp.linked_entity_id else None
                if not canonical:
                    canonical = f"mp_{mp.mp_id}"
                base_confidence = 0.90

                # Boost for ministers/former PMs
                if mp.is_minister:
                    base_confidence = 0.94
                if mp.is_former_pm:
                    base_confidence = 0.96

                context = {
                    "party": mp.party,
                    "constituency": mp.constituency,
                    "province_id": mp.province_id,
                    "is_minister": mp.is_minister,
                    "ministry": mp.ministry_portfolio,
                    "chamber": mp.chamber,
                }

                # English name
                self._add_pattern(mp.name_en, EntityPattern(
                    canonical_id=canonical,
                    entity_type="PERSON",
                    confidence=base_confidence,
                    context_hints=context,
                    source="mp",
                ))

                # Nepali name
                if mp.name_ne:
                    self._add_pattern(mp.name_ne, EntityPattern(
                        canonical_id=canonical,
                        entity_type="PERSON",
                        confidence=base_confidence + 0.02,
                        context_hints=context,
                        source="mp",
                    ))

            logger.info(f"Generated patterns for {len(mps)} MPs")

        except Exception as e:
            logger.warning(f"Could not load MPs: {e}")

    async def _generate_candidate_patterns(self, session: AsyncSession):
        """Generate patterns from Election candidates."""
        try:
            from app.models.election import Candidate, Constituency
            from app.models.political_entity import PoliticalEntity

            result = await session.execute(
                select(Candidate).options(selectinload(Candidate.constituency))
            )
            candidates = result.scalars().all()

            # Build entity UUID → canonical_id mapping
            entity_map = {}
            entity_result = await session.execute(select(PoliticalEntity.id, PoliticalEntity.canonical_id))
            for eid, cid in entity_result.all():
                entity_map[eid] = cid

            for candidate in candidates:
                # Use linked_entity_id's canonical_id if available
                canonical = entity_map.get(candidate.linked_entity_id) if candidate.linked_entity_id else None
                if not canonical:
                    canonical = f"candidate_{candidate.external_id}"
                base_confidence = 0.85

                # Boost for winners
                if candidate.is_winner:
                    base_confidence = 0.90

                context = {
                    "party": candidate.party,
                    "party_ne": candidate.party_ne,
                    "is_winner": candidate.is_winner,
                    "votes": candidate.votes,
                }

                if candidate.constituency:
                    context.update({
                        "constituency": candidate.constituency.name_en,
                        "constituency_code": candidate.constituency.constituency_code,
                        "district": candidate.constituency.district,
                        "province_id": candidate.constituency.province_id,
                    })

                # English name
                self._add_pattern(candidate.name_en, EntityPattern(
                    canonical_id=canonical,
                    entity_type="PERSON",
                    confidence=base_confidence,
                    context_hints=context,
                    source="candidate",
                ))

                # Nepali name
                if candidate.name_ne:
                    self._add_pattern(candidate.name_ne, EntityPattern(
                        canonical_id=canonical,
                        entity_type="PERSON",
                        confidence=base_confidence + 0.03,
                        context_hints=context,
                        source="candidate",
                    ))

                # Romanized English name (high-quality transliteration)
                if candidate.name_en_roman:
                    self._add_pattern(candidate.name_en_roman, EntityPattern(
                        canonical_id=canonical,
                        entity_type="PERSON",
                        confidence=base_confidence,
                        context_hints=context,
                        source="candidate_roman",
                    ))

                # Candidate aliases (2-4 per candidate)
                if candidate.aliases:
                    for alias in candidate.aliases:
                        if alias and len(alias.strip()) >= 3:
                            self._add_pattern(alias, EntityPattern(
                                canonical_id=canonical,
                                entity_type="PERSON",
                                confidence=base_confidence - 0.02,
                                context_hints=context,
                                source="candidate_alias",
                            ))

            logger.info(f"Generated patterns for {len(candidates)} candidates")

        except Exception as e:
            logger.warning(f"Could not load candidates: {e}")

    async def _generate_location_patterns(self, session: AsyncSession):
        """Generate patterns for constituencies, districts, provinces."""
        try:
            from app.models.election import Constituency

            result = await session.execute(select(Constituency))
            constituencies = result.scalars().all()

            seen_districts = set()
            seen_provinces = set()

            for const in constituencies:
                # Constituency
                canonical = f"constituency_{const.constituency_code}"
                context = {
                    "district": const.district,
                    "province": const.province,
                    "province_id": const.province_id,
                }

                self._add_pattern(const.name_en, EntityPattern(
                    canonical_id=canonical,
                    entity_type="LOCATION",
                    confidence=0.88,
                    context_hints=context,
                    source="constituency",
                ))

                if const.name_ne:
                    self._add_pattern(const.name_ne, EntityPattern(
                        canonical_id=canonical,
                        entity_type="LOCATION",
                        confidence=0.92,
                        context_hints=context,
                        source="constituency",
                    ))

                # District (avoid duplicates)
                if const.district and const.district not in seen_districts:
                    seen_districts.add(const.district)
                    district_canonical = f"district_{self._slugify(const.district)}"
                    self._add_pattern(const.district, EntityPattern(
                        canonical_id=district_canonical,
                        entity_type="LOCATION",
                        confidence=0.85,
                        context_hints={"province_id": const.province_id},
                        source="district",
                    ))

                # Province (avoid duplicates)
                if const.province and const.province not in seen_provinces:
                    seen_provinces.add(const.province)
                    province_canonical = f"province_{const.province_id}"
                    self._add_pattern(const.province, EntityPattern(
                        canonical_id=province_canonical,
                        entity_type="LOCATION",
                        confidence=0.90,
                        context_hints={"province_id": const.province_id},
                        source="province",
                    ))

            logger.info(f"Generated location patterns: {len(constituencies)} constituencies, {len(seen_districts)} districts, {len(seen_provinces)} provinces")

        except Exception as e:
            logger.warning(f"Could not load locations: {e}")

    async def _generate_party_patterns(self, session: AsyncSession):
        """Generate patterns for political parties."""
        try:
            from app.models.election import Candidate

            # Get distinct parties from candidates
            result = await session.execute(
                select(Candidate.party, Candidate.party_ne).distinct()
            )
            parties = result.all()

            seen_parties = set()
            for party_en, party_ne in parties:
                if not party_en or party_en in seen_parties:
                    continue
                seen_parties.add(party_en)

                canonical = self._party_to_canonical(party_en)

                # English party name
                self._add_pattern(party_en, EntityPattern(
                    canonical_id=canonical,
                    entity_type="ORGANIZATION",
                    confidence=0.88,
                    context_hints={"party_type": "political"},
                    source="party",
                ))

                # Nepali party name
                if party_ne:
                    self._add_pattern(party_ne, EntityPattern(
                        canonical_id=canonical,
                        entity_type="ORGANIZATION",
                        confidence=0.92,
                        context_hints={"party_type": "political"},
                        source="party",
                    ))

            # Add common party abbreviations
            abbreviations = {
                "NC": "nepali_congress",
                "UML": "cpn_uml",
                "CPN-UML": "cpn_uml",
                "CPN(UML)": "cpn_uml",
                "Maoist": "cpn_maoist",
                "RSP": "rsp",
                "RPP": "rpp",
                "JSP": "jsp",
            }
            for abbrev, canonical in abbreviations.items():
                self._add_pattern(abbrev, EntityPattern(
                    canonical_id=canonical,
                    entity_type="ORGANIZATION",
                    confidence=0.80,  # Lower for abbreviations
                    context_hints={"party_type": "political", "is_abbreviation": True},
                    source="party_abbrev",
                ))

            logger.info(f"Generated patterns for {len(seen_parties)} parties")

        except Exception as e:
            logger.warning(f"Could not load parties: {e}")

    def get_pattern_stats(self) -> Dict[str, int]:
        """Get statistics about generated patterns."""
        stats = {
            "total": len(self._generated_patterns),
            "by_type": {},
            "by_source": {},
        }

        for pattern in self._generated_patterns.values():
            etype = pattern.entity_type
            source = pattern.source

            stats["by_type"][etype] = stats["by_type"].get(etype, 0) + 1
            stats["by_source"][source] = stats["by_source"].get(source, 0) + 1

        return stats
