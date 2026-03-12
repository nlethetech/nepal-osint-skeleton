"""Prompt for the Province Anomaly Agent.

Single Sonnet call analyses all 7 provinces at once.
Uses `claude -p --model sonnet` subprocess (covered by Claude Max — $0 cost).
"""

PROVINCE_ANOMALY_PROMPT = """You are a Nepal intelligence analyst. Analyze the following news stories and social media posts from each of Nepal's 7 provinces collected in the last 6 hours.

For EACH province, provide:
1. **threat_level**: One of LOW, GUARDED, ELEVATED, CRITICAL
2. **threat_trajectory**: One of ESCALATING, STABLE, DE-ESCALATING
3. **summary**: 2-3 sentence overview of the current situation
4. **political**: 1-2 sentences on political dynamics (or null if nothing notable)
5. **economic**: 1-2 sentences on economic conditions (or null if nothing notable)
6. **security**: 1-2 sentences on security situation (or null if nothing notable)
7. **anomalies**: Array of detected anomalies, each with:
   - type: protest, disaster, political_tension, economic_disruption, security_incident, infrastructure, other
   - description: 1 sentence
   - severity: low, medium, high, critical
   - district: which district (if identifiable)

IMPORTANT RULES:
- Generate an assessment for ALL 7 provinces (province_id 1 through 7)
- If a province has very few or zero data points, provide a conservative LOW/STABLE assessment
- Focus on actionable intelligence: what changed, what's unusual, what needs watching
- Keep assessments concise and factual
- Do NOT invent events not present in the data

Return ONLY a JSON object with this exact structure:
{
  "provinces": [
    {
      "province_id": 1,
      "province_name": "Koshi",
      "threat_level": "LOW",
      "threat_trajectory": "STABLE",
      "summary": "...",
      "political": "..." or null,
      "economic": "..." or null,
      "security": "..." or null,
      "anomalies": []
    }
  ]
}

=== PROVINCE DATA ===

"""


def build_prompt(province_contexts: dict[int, dict]) -> str:
    """Build the full prompt with province contexts.

    Args:
        province_contexts: {province_id: {name, stories: [...], tweets: [...]}}

    Returns:
        Full prompt string for Sonnet.
    """
    sections = []
    for pid in sorted(province_contexts.keys()):
        ctx = province_contexts[pid]
        section = f"--- Province {pid}: {ctx['name']} ---\n"

        if ctx["stories"]:
            section += f"\nNews Stories ({len(ctx['stories'])}):\n"
            for i, s in enumerate(ctx["stories"][:20], 1):
                section += f"  {i}. [{s['source']}] {s['title']}\n"
                if s.get("snippet"):
                    section += f"     {s['snippet'][:150]}\n"
        else:
            section += "\nNews Stories: None in this period\n"

        if ctx["tweets"]:
            section += f"\nSocial Media ({len(ctx['tweets'])}):\n"
            for i, t in enumerate(ctx["tweets"][:15], 1):
                section += f"  {i}. {t['title']}: {t['snippet'][:120]}\n"
        else:
            section += "\nSocial Media: None in this period\n"

        section += f"\nTotal: {len(ctx['stories'])} stories, {len(ctx['tweets'])} tweets\n"
        sections.append(section)

    return PROVINCE_ANOMALY_PROMPT + "\n".join(sections)
