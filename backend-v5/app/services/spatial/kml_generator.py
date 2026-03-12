"""KML/KMZ generation service for Google Earth export.

Generates:
- KML documents with styled placemarks
- Category/severity-based icons and colors
- TimeStamp elements for time-based visualization
- Folder organization by category
- KMZ compression with embedded resources
"""

import io
import zipfile
from datetime import datetime
from typing import List, Optional, Dict, Any
from xml.etree import ElementTree as ET
from xml.dom import minidom


# KML color format: AABBGGRR (alpha, blue, green, red) - opposite of hex!
SEVERITY_COLORS = {
    "CRITICAL": "ff0000ff",  # Red
    "HIGH": "ff0080ff",      # Orange
    "MEDIUM": "ff00ffff",    # Yellow
    "LOW": "ff00ff00",       # Green
}

CATEGORY_COLORS = {
    "DISASTER": "ff4444ef",   # Red
    "POLITICAL": "fff68a3b",  # Blue
    "ECONOMIC": "ff81b910",   # Green
    "SECURITY": "ff0b9ef5",   # Orange/Yellow
    "SOCIAL": "fff65c8b",     # Purple
    "GOVERNMENT": "ffba7c5c", # Steel blue
    "GENERAL": "ff8b7464",    # Gray
}

CATEGORY_ICONS = {
    "DISASTER": "http://maps.google.com/mapfiles/kml/shapes/caution.png",
    "POLITICAL": "http://maps.google.com/mapfiles/kml/shapes/politics.png",
    "SECURITY": "http://maps.google.com/mapfiles/kml/shapes/police.png",
    "ECONOMIC": "http://maps.google.com/mapfiles/kml/shapes/dollar.png",
    "SOCIAL": "http://maps.google.com/mapfiles/kml/shapes/man.png",
    "GOVERNMENT": "http://maps.google.com/mapfiles/kml/shapes/ranger_station.png",
    "GENERAL": "http://maps.google.com/mapfiles/kml/shapes/info-i.png",
}

SEVERITY_SCALES = {
    "CRITICAL": 1.5,
    "HIGH": 1.3,
    "MEDIUM": 1.0,
    "LOW": 0.8,
}


class KMLGenerator:
    """Service for generating KML/KMZ files from map events."""

    def __init__(self, base_url: str = ""):
        """Initialize with optional base URL for links."""
        self.base_url = base_url

    def generate_kml(
        self,
        events: List[Dict[str, Any]],
        title: str = "NARADA Nepal OSINT",
        include_styles: bool = True,
    ) -> str:
        """Generate KML XML string from events.

        Args:
            events: List of event dicts with coordinates, category, severity, etc.
            title: Document title
            include_styles: Whether to include category/severity styles

        Returns:
            KML XML string
        """
        # Create root KML element with namespace
        kml = ET.Element("kml", xmlns="http://www.opengis.net/kml/2.2")
        document = ET.SubElement(kml, "Document")

        # Document metadata
        ET.SubElement(document, "name").text = title
        ET.SubElement(document, "description").text = (
            f"Nepal OSINT events exported from NARADA platform.\n"
            f"Generated: {datetime.utcnow().isoformat()}Z\n"
            f"Total events: {len(events)}"
        )

        # Add styles if requested
        if include_styles:
            self._add_styles(document)

        # Group events by category for folder organization
        events_by_category: Dict[str, List[Dict]] = {}
        for event in events:
            category = event.get("category", "GENERAL").upper()
            if category not in events_by_category:
                events_by_category[category] = []
            events_by_category[category].append(event)

        # Create folder for each category
        for category, category_events in events_by_category.items():
            folder = ET.SubElement(document, "Folder")
            ET.SubElement(folder, "name").text = category.title()
            ET.SubElement(folder, "description").text = f"{len(category_events)} {category.lower()} events"

            # Add placemarks
            for event in category_events:
                self._add_placemark(folder, event)

        # Pretty print XML
        xml_str = ET.tostring(kml, encoding="unicode")
        return self._prettify_xml(xml_str)

    def generate_kmz(
        self,
        events: List[Dict[str, Any]],
        title: str = "NARADA Nepal OSINT",
    ) -> bytes:
        """Generate KMZ (zipped KML) from events.

        Args:
            events: List of event dicts
            title: Document title

        Returns:
            KMZ file as bytes
        """
        kml_content = self.generate_kml(events, title)

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("doc.kml", kml_content)

        return buffer.getvalue()

    def generate_network_link(
        self,
        data_url: str,
        refresh_interval: int = 300,
        title: str = "NARADA Live Feed",
    ) -> str:
        """Generate KML NetworkLink document for live data feed.

        Args:
            data_url: Full URL to the KML export endpoint
            refresh_interval: Refresh interval in seconds
            title: Network link title

        Returns:
            KML XML string with NetworkLink
        """
        kml = ET.Element("kml", xmlns="http://www.opengis.net/kml/2.2")
        document = ET.SubElement(kml, "Document")

        ET.SubElement(document, "name").text = title
        ET.SubElement(document, "description").text = (
            f"Live data feed from NARADA Nepal OSINT platform.\n"
            f"Refreshes every {refresh_interval // 60} minutes."
        )

        # Network Link
        network_link = ET.SubElement(document, "NetworkLink")
        ET.SubElement(network_link, "name").text = "Nepal OSINT Live Data"
        ET.SubElement(network_link, "visibility").text = "1"
        ET.SubElement(network_link, "flyToView").text = "0"

        link = ET.SubElement(network_link, "Link")
        ET.SubElement(link, "href").text = data_url
        ET.SubElement(link, "refreshMode").text = "onInterval"
        ET.SubElement(link, "refreshInterval").text = str(refresh_interval)
        ET.SubElement(link, "viewRefreshMode").text = "never"

        xml_str = ET.tostring(kml, encoding="unicode")
        return self._prettify_xml(xml_str)

    def _add_styles(self, document: ET.Element) -> None:
        """Add category/severity style definitions to document."""
        # Create combined styles for each category-severity combination
        for category in CATEGORY_COLORS:
            for severity in SEVERITY_COLORS:
                style_id = f"{category.lower()}-{severity.lower()}"
                style = ET.SubElement(document, "Style", id=style_id)

                # Icon style
                icon_style = ET.SubElement(style, "IconStyle")
                ET.SubElement(icon_style, "color").text = SEVERITY_COLORS[severity]
                ET.SubElement(icon_style, "scale").text = str(SEVERITY_SCALES.get(severity, 1.0))
                icon = ET.SubElement(icon_style, "Icon")
                ET.SubElement(icon, "href").text = CATEGORY_ICONS.get(category, CATEGORY_ICONS["GENERAL"])

                # Label style
                label_style = ET.SubElement(style, "LabelStyle")
                ET.SubElement(label_style, "color").text = "ffffffff"
                ET.SubElement(label_style, "scale").text = "0.8"

                # Balloon style for popup
                balloon_style = ET.SubElement(style, "BalloonStyle")
                ET.SubElement(balloon_style, "bgColor").text = "ff1a1a1a"
                ET.SubElement(balloon_style, "textColor").text = "ffffffff"

    def _add_placemark(self, parent: ET.Element, event: Dict[str, Any]) -> None:
        """Add a placemark element for an event."""
        placemark = ET.SubElement(parent, "Placemark")

        # Basic info
        title = event.get("title", "Unknown Event")
        ET.SubElement(placemark, "name").text = title[:100]  # Truncate long titles

        # Description with HTML formatting
        description = self._format_description(event)
        desc_elem = ET.SubElement(placemark, "description")
        desc_elem.text = description

        # Style reference
        category = event.get("category", "GENERAL").upper()
        severity = event.get("severity", "MEDIUM").upper()
        style_id = f"{category.lower()}-{severity.lower()}"
        ET.SubElement(placemark, "styleUrl").text = f"#{style_id}"

        # TimeStamp for time-based visualization
        timestamp_str = event.get("timestamp")
        if timestamp_str:
            try:
                # Parse and format timestamp
                if isinstance(timestamp_str, str):
                    dt = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
                else:
                    dt = timestamp_str
                timestamp = ET.SubElement(placemark, "TimeStamp")
                ET.SubElement(timestamp, "when").text = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            except (ValueError, AttributeError):
                pass

        # Extended data for additional attributes
        extended_data = ET.SubElement(placemark, "ExtendedData")
        self._add_data_element(extended_data, "category", category)
        self._add_data_element(extended_data, "severity", severity)
        if event.get("district"):
            self._add_data_element(extended_data, "district", event["district"])
        if event.get("source_url"):
            self._add_data_element(extended_data, "source_url", event["source_url"])

        # Point geometry
        coords = event.get("coordinates", [])
        if len(coords) >= 2:
            point = ET.SubElement(placemark, "Point")
            # KML uses lng,lat,altitude format
            lng, lat = coords[0], coords[1]
            ET.SubElement(point, "coordinates").text = f"{lng},{lat},0"

    def _format_description(self, event: Dict[str, Any]) -> str:
        """Format event data as HTML description for KML balloon."""
        parts = ["<![CDATA["]
        parts.append('<div style="font-family: Arial, sans-serif; color: #e0e0e0;">')

        # Category and severity badges
        category = event.get("category", "GENERAL").upper()
        severity = event.get("severity", "MEDIUM").upper()
        sev_color = {"CRITICAL": "#ef4444", "HIGH": "#f97316", "MEDIUM": "#eab308", "LOW": "#22c55e"}.get(severity, "#888")

        parts.append(f'<p><span style="background: {sev_color}; padding: 2px 6px; border-radius: 3px; font-size: 11px;">{severity}</span>')
        parts.append(f' <span style="background: #333; padding: 2px 6px; border-radius: 3px; font-size: 11px;">{category}</span></p>')

        # District
        if event.get("district"):
            parts.append(f'<p><b>District:</b> {event["district"]}</p>')

        # Timestamp
        if event.get("timestamp"):
            parts.append(f'<p><b>Time:</b> {event["timestamp"]}</p>')

        # Summary
        if event.get("summary"):
            parts.append(f'<p>{event["summary"][:500]}</p>')

        # Casualties if any
        deaths = event.get("deaths")
        injured = event.get("injured")
        if deaths or injured:
            parts.append('<p>')
            if deaths:
                parts.append(f'<span style="color: #ef4444;">Deaths: {deaths}</span> ')
            if injured:
                parts.append(f'<span style="color: #f97316;">Injured: {injured}</span>')
            parts.append('</p>')

        # Source link
        if event.get("source_url"):
            parts.append(f'<p><a href="{event["source_url"]}" style="color: #3b82f6;">View Source</a></p>')

        parts.append('</div>')
        parts.append("]]>")

        return "".join(parts)

    def _add_data_element(self, parent: ET.Element, name: str, value: str) -> None:
        """Add a Data element to ExtendedData."""
        data = ET.SubElement(parent, "Data", name=name)
        ET.SubElement(data, "value").text = str(value)

    def _prettify_xml(self, xml_str: str) -> str:
        """Pretty print XML with proper indentation."""
        try:
            parsed = minidom.parseString(xml_str)
            return parsed.toprettyxml(indent="  ", encoding=None)
        except Exception:
            # Fall back to raw XML if prettification fails
            return f'<?xml version="1.0" encoding="UTF-8"?>\n{xml_str}'
