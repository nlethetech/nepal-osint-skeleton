# NARADA Agent Architecture

This document explains how to build and connect AI agents to the NARADA platform. The system uses a **pull → process → push** pattern: agents fetch data from the API, run analysis (locally or in the cloud), and POST results back.

## Architecture Overview

```
Your Machine (LLM of choice)              NARADA VPS (API + DB)
┌──────────────────────────────┐          ┌─────────────────────────┐
│                              │          │                         │
│  Briefing Agent (Sonnet)     │──POST──→ │  /briefs/ingest         │
│  Province Agent (Sonnet)     │──POST──→ │  /province-anomalies/   │
│  Clustering Agent (Haiku)    │──POST──→ │  /ml/clustering/merge   │
│  Tactical Agent (Haiku)      │──POST──→ │  /tactical/ingest       │
│  Fact-Check Agent (Sonnet)   │──POST──→ │  /fact-check/ingest     │
│  Relevance Agent (Haiku)     │──POST──→ │  /stories/haiku-results │
│  Summary Agent (Haiku)       │──POST──→ │  /stories/haiku-results │
│  Promise Tracker (Sonnet)    │──POST──→ │  /promises/ingest       │
│                              │          │                         │
│          ←── GET ────────────│──────────│  /stories/export        │
│          ←── GET ────────────│──────────│  /twitter/export        │
│          ←── GET ────────────│──────────│  /briefs/latest         │
│          ←── GET ────────────│──────────│  /fact-check/pending    │
│          ←── GET ────────────│──────────│  /stories/pending-haiku │
└──────────────────────────────┘          └─────────────────────────┘
              HTTPS + JWT Auth
```

**Why local agents?** If you have a Claude Max subscription ($20/mo), you get unlimited Claude CLI calls — no API credits needed. Run agents locally via `claude -p` and POST results to the VPS. This costs $0 extra.

---

## Quick Start

### 1. Authentication

All agent endpoints require JWT auth. Login first:

```python
import requests

VPS_URL = "http://your-vps-ip"
PASSWORD = "your-password"

# Login
r = requests.post(f"{VPS_URL}/api/v1/auth/login", json={
    "email": "dev@narada.dev",
    "password": PASSWORD,
})
TOKEN = r.json()["access_token"]
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
```

### 2. Fetch Data

```python
# Get recent stories for analysis
stories = requests.get(
    f"{VPS_URL}/api/v1/stories/export",
    params={"hours": 6, "limit": 500},
    headers=HEADERS,
).json()

# Get recent tweets
tweets = requests.get(
    f"{VPS_URL}/api/v1/twitter/export",
    params={"hours": 6, "limit": 500},
    headers=HEADERS,
).json()
```

### 3. Run Your LLM

Use any LLM — Claude, GPT-4, Llama, Gemini, or local models. The API only cares about the JSON output format.

```python
# Example: Claude CLI (free with Max subscription)
import subprocess

result = subprocess.run(
    ["claude", "-p", prompt, "--output-format", "text", "--model", "claude-haiku-4-5-20251001"],
    capture_output=True, text=True, timeout=60,
)
analysis = json.loads(result.stdout)
```

### 4. Push Results

```python
requests.post(
    f"{VPS_URL}/api/v1/briefs/ingest",
    json=analysis,
    headers=HEADERS,
)
```

---

## Agent Types

### 1. Briefing Agent (National Intelligence Brief)

**Model:** Sonnet-class (2 calls per run)
**Schedule:** Every 4-6 hours
**Purpose:** Generate a national situation brief with per-province threat assessment

#### Data Flow

```
GET /stories/export?hours=6&limit=500  →  Province Analysis Prompt  →  National Synthesis Prompt
GET /twitter/export?hours=6&limit=500                                        ↓
GET /briefs/latest                                              POST /briefs/ingest
                                                                POST /province-anomalies/ingest
```

#### Input: Story Export Format

```json
{
  "stories": [
    {
      "id": "uuid",
      "title": "Story headline",
      "summary": "AI-generated or scraped summary",
      "source_name": "The Kathmandu Post",
      "published_at": "2025-01-15T10:30:00Z",
      "severity": "high",
      "category": "political",
      "districts": ["kathmandu", "lalitpur"],
      "cluster_tag": "cluster-abc123",
      "ai_summary": {"headline": "...", "summary": "...", "category": "..."}
    }
  ]
}
```

#### Output: Brief Ingest Schema

```json
{
  "period_start": "2025-01-15T04:00:00Z",
  "period_end": "2025-01-15T10:00:00Z",
  "national_summary": "3-5 sentence BLUF (Bottom Line Up Front) for decision-makers",
  "national_analysis": {
    "key_judgment": "Single most important analytical finding",
    "trend_vs_previous": "escalating|stable|de-escalating",
    "hotspots": [
      {"location": "Kathmandu Valley", "issue": "description", "severity": "high"}
    ],
    "national_risks": [
      {"risk": "description", "likelihood": "high|medium|low", "impact": "high|medium|low"}
    ]
  },
  "province_sitreps": [
    {
      "province_id": 1,
      "province_name": "Koshi Province",
      "bluf": "1-2 sentence summary",
      "security": "Security assessment text",
      "political": "Political assessment text",
      "economic": "Economic assessment text",
      "disaster": "Disaster/environmental assessment",
      "threat_level": "LOW|GUARDED|ELEVATED|CRITICAL",
      "threat_trajectory": "ESCALATING|STABLE|DE-ESCALATING",
      "hotspots": [{"location": "...", "issue": "..."}],
      "anomalies": [{"type": "...", "description": "..."}]
    }
  ],
  "stories_analyzed": 150,
  "clusters_analyzed": 25,
  "claude_calls": 2,
  "duration_seconds": 45
}
```

#### Province Anomaly Ingest (same run, second POST)

```json
{
  "stories_analyzed": 150,
  "tweets_analyzed": 30,
  "provinces": [
    {
      "province_id": 1,
      "province_name": "Koshi Province",
      "threat_level": "LOW",
      "threat_trajectory": "STABLE",
      "summary": "Brief situation summary",
      "political": "Political context",
      "economic": "Economic context",
      "security": "Security context",
      "anomalies": [
        {"type": "unusual_activity", "description": "...", "severity": "medium"}
      ],
      "story_count": 20,
      "tweet_count": 5
    }
  ]
}
```

#### Prompt Strategy

**Call 1 — Province Analysis (all 7 provinces in ONE call):**
- Group stories by district → province mapping
- For each province: assess security, political, economic, disaster situation
- Output threat_level and threat_trajectory per province
- Style: Reuters/AP wire quality, cite sources by name

**Call 2 — National Synthesis:**
- Input: All 7 province SITREPs + previous brief
- Generate key_judgment (analytical insight connecting trends across provinces)
- Identify national-level risks and hotspots
- Compare trend vs previous brief period

**Key context to include in prompts:**
- Nepal has 7 provinces, 77 districts
- Current political context (which party is in power, recent elections, etc.)
- Party name reference (prevent hallucination of party names)

---

### 2. Clustering Agent (Story Merge)

**Model:** Haiku-class (batch processing)
**Schedule:** Every 30 minutes - 2 hours
**Purpose:** Group stories about the same real-world event across sources and languages

#### Data Flow

```
GET /ml/clustering/merge-candidates?hours=48  →  Merge Prompt (per district batch)
                                                        ↓
                                              POST /ml/clustering/merge-results
```

#### Input: Merge Candidates

```json
{
  "batches": [
    {
      "district": "kathmandu",
      "stories": [
        {
          "id": "uuid",
          "title": "Story title",
          "source_name": "Setopati",
          "language": "ne",
          "summary": "...",
          "published_at": "2025-01-15T10:00:00Z"
        }
      ]
    }
  ],
  "total_stories": 85
}
```

#### Output: Merge Results

```json
{
  "merges": [
    {
      "district": "kathmandu",
      "groups": [[0, 3, 7], [1, 4]],
      "metadata": [
        {
          "event_type": "political",
          "severity": "medium",
          "headline": "PM addresses parliament on budget",
          "bluf": "Prime Minister presented annual budget...",
          "development_stage": "developing|ongoing|resolved",
          "key_updates": ["Budget figure announced", "Opposition responds"],
          "geographic_scope": "national",
          "cross_lingual": true,
          "source_agreement": "high",
          "confidence": 0.9
        }
      ]
    }
  ]
}
```

#### Prompt Rules
- Group stories covering the SAME real-world event (including updates, follow-ups)
- **CRITICAL:** Cross-lingual grouping — Nepali + English about same event MUST merge
- Cities within districts = same location (Dhangadhi = Kailali, Birgunj = Parsa)
- Max 10 stories per group
- Omit singletons (don't return groups of 1)
- When in doubt, group (false negatives worse than false positives)

---

### 3. Tactical Enrichment Agent (Map Intelligence)

**Model:** Haiku-class (batches of 20)
**Schedule:** Every 2-5 minutes (feeds live tactical map)
**Purpose:** Classify stories for the tactical situation map with geolocation

#### Data Flow

```
GET /stories/export?hours=48     →  Filter to tactical categories
POST /tactical/enriched-ids      →  Skip already-classified stories
                                          ↓
                                 POST /tactical/ingest
```

#### Output: Tactical Enrichment

```json
{
  "enrichments": [
    {
      "story_id": "uuid",
      "tactical_type": "ARREST",
      "tactical_subtype": "political_arrest",
      "municipality": "Kathmandu",
      "ward": 10,
      "latitude": 27.7172,
      "longitude": 85.324,
      "tactical_context": "Police arrested 3 opposition leaders ahead of planned protest at Maitighar",
      "actors": ["Nepal Police", "CPN-UML", "Maitighar Mandala"],
      "confidence": "HIGH"
    }
  ]
}
```

#### Tactical Types
```
SECURITY_DEPLOYMENT, ARREST, PROTEST, ELECTORAL_VIOLENCE,
BORDER_INCIDENT, STRIKE, POLITICAL_RALLY, CRIME, CURFEW,
RIOT, EXPLOSION, ACCIDENT, OTHER
```

#### Prompt Rules
- Only classify ACTUAL tactical events (not opinions, editorials, weather)
- Skip: routine political statements, economic news, international stories, sports
- Must geocode to a specific Nepal municipality
- Return EMPTY results array for non-tactical stories

---

### 4. Fact-Check Agent (Verification)

**Model:** Sonnet-class with web search tools
**Schedule:** Every 30 minutes - 4 hours
**Purpose:** Verify claims in stories flagged by users

#### Data Flow

```
GET /fact-check/pending?limit=10  →  Web Search + Cross-Reference
                                            ↓
                                   POST /fact-check/ingest
```

#### Input: Pending Stories

```json
{
  "stories": [
    {
      "story_id": "uuid",
      "title": "Story headline",
      "source_name": "Source",
      "summary": "Story content...",
      "url": "https://...",
      "request_count": 5,
      "first_requested": "2025-01-15T08:00:00Z"
    }
  ]
}
```

#### Output: Fact-Check Results

```json
{
  "results": [
    {
      "story_id": "uuid",
      "verdict": "mostly_true",
      "verdict_summary": "The core claim is accurate but the quoted figure of 500 was actually 350 according to official police records.",
      "confidence": 0.85,
      "key_finding": "Official count was 350, not 500 as claimed",
      "context": "The protest was peaceful and dispersed by evening",
      "claims_analyzed": [
        {
          "claim": "500 people were arrested",
          "verdict": "false",
          "evidence": "Nepal Police HQ press release confirms 350 detentions",
          "sources": ["https://nepalpolice.gov.np/..."]
        }
      ],
      "model_used": "sonnet"
    }
  ]
}
```

#### Verdicts
```
true | mostly_true | partially_true | misleading | false | unverifiable | satire
```

#### Prompt Strategy
1. If URL provided → fetch it. Otherwise → 1 web search
2. Identify 1-2 core factual claims (skip opinions)
3. Cross-reference with 1 additional search if needed
4. Output JSON verdict — be fast (1-2 searches max)
5. If insufficient evidence → `unverifiable` (never guess)

---

### 5. Relevance Filter Agent (Haiku)

**Model:** Haiku-class (fast, cheap)
**Schedule:** Continuous loop (every 2 minutes)
**Purpose:** Filter out non-Nepal stories from international sources

#### Data Flow

```
GET /stories/pending-haiku?task=relevance&limit=20  →  Classify
                                                           ↓
                                            POST /stories/haiku-results
```

#### Output

```json
{
  "task": "relevance",
  "results": [
    {"story_id": "uuid", "relevant": true},
    {"story_id": "uuid", "relevant": false}
  ]
}
```

#### Classification Rules
- **RELEVANT:** Events IN Nepal, Nepal government/economy/society, Nepal bilateral issues, disasters in Nepal, Nepali diaspora
- **NOT RELEVANT:** Foreign conflicts (Israel-Iran, Russia-Ukraine), other countries' elections, international sports where Nepal isn't competing, Nepal mentioned only in passing

---

### 6. Summary Agent (Haiku)

**Model:** Haiku-class
**Schedule:** Continuous loop (every 2 minutes)
**Purpose:** Generate intelligence-grade summaries of news stories

#### Data Flow

```
GET /stories/pending-haiku?task=summary&limit=20  →  Summarize
                                                          ↓
                                           POST /stories/haiku-results
```

#### Output

```json
{
  "task": "summary",
  "results": [
    {
      "story_id": "uuid",
      "ai_summary": {
        "headline": "Clear headline under 100 chars",
        "summary": "2-4 sentence intelligence summary",
        "category": "political",
        "severity": "medium",
        "key_entities": ["KP Sharma Oli", "CPN-UML", "Parliament"],
        "verified": true,
        "confidence": 0.8
      }
    }
  ]
}
```

#### Categories
```
political | economic | security | disaster | social
```

---

### 7. Promise Tracker Agent (Nightly)

**Model:** Sonnet-class
**Schedule:** Once daily (11 PM NPT)
**Purpose:** Track ruling party manifesto promises against news evidence

#### Data Flow

```
GET /stories/export?since=48h_ago&limit=100   →  Compare against manifesto
GET /announcements/summary?limit=30                     ↓
GET /promises/summary                          POST /promises/ingest
```

#### Output

```json
{
  "updates": [
    {
      "promise_id": "uuid",
      "status": "in_progress",
      "status_detail": "Finance Minister announced committee formed to study implementation",
      "evidence_urls": ["https://kathmandupost.com/..."]
    }
  ]
}
```

#### Promise Statuses
```
not_started | in_progress | partially_fulfilled | fulfilled | stalled
```

---

## Building Your Own Agent

Any agent that follows the pull → process → push pattern works. Here's a template:

```python
#!/usr/bin/env python3
"""Custom NARADA Agent Template"""

import json
import os
import requests
import subprocess

VPS_URL = os.environ.get("VPS_URL", "http://your-vps-ip")
PASSWORD = os.environ.get("OSINT_PASSWORD", "")

# 1. Login
token = requests.post(f"{VPS_URL}/api/v1/auth/login", json={
    "email": "dev@narada.dev", "password": PASSWORD
}).json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. Fetch data
stories = requests.get(
    f"{VPS_URL}/api/v1/stories/export",
    params={"hours": 6, "limit": 200},
    headers=headers,
).json()["stories"]

# 3. Process with your LLM
prompt = f"""Analyze these {len(stories)} stories and produce...
{json.dumps([{"title": s["title"], "summary": s.get("summary", "")} for s in stories[:50]])}
"""

# Option A: Claude CLI (free with Max subscription)
env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
result = subprocess.run(
    ["claude", "-p", prompt, "--output-format", "text", "--model", "claude-sonnet-4-6", "--max-turns", "1"],
    capture_output=True, text=True, timeout=120, env=env,
)
analysis = json.loads(result.stdout)

# Option B: Any API (OpenAI, Anthropic, local Ollama, etc.)
# from openai import OpenAI
# client = OpenAI()
# response = client.chat.completions.create(model="gpt-4o", messages=[...])

# 4. Push results
requests.post(
    f"{VPS_URL}/api/v1/briefs/ingest",
    json=analysis,
    headers=headers,
)
```

### Running via Cron

```bash
# Add to crontab -e
0 */4 * * * cd /path/to/agents && ./run_agents.sh briefing >> /tmp/agents.log 2>&1
*/30 * * * * cd /path/to/agents && ./run_agents.sh clustering >> /tmp/agents.log 2>&1
*/2  * * * * cd /path/to/agents && ./run_agents.sh tactical >> /tmp/agents.log 2>&1
0 1,5,9,13,17,21 * * * cd /path/to/agents && ./run_agents.sh factcheck >> /tmp/agents.log 2>&1
```

### Claude CLI Tips

```bash
# Filter CLAUDECODE env var (prevents nested session error)
env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}

# Use --max-turns 1 for single-shot analysis
claude -p "your prompt" --output-format text --model claude-haiku-4-5-20251001 --max-turns 1

# Use web tools for fact-checking
claude -p "fact check this claim..." --allowedTools "WebSearch,WebFetch" --max-turns 4
```

---

## API Endpoint Reference

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/v1/auth/login` | POST | Get JWT token | None |
| `/api/v1/stories/export` | GET | Fetch stories (agent input) | JWT |
| `/api/v1/twitter/export` | GET | Fetch tweets (agent input) | JWT |
| `/api/v1/briefs/latest` | GET | Previous brief for context | JWT |
| `/api/v1/briefs/ingest` | POST | Store briefing results | JWT |
| `/api/v1/province-anomalies/ingest` | POST | Store province assessments | JWT |
| `/api/v1/ml/clustering/merge-candidates` | GET | Unclustered stories by district | JWT |
| `/api/v1/ml/clustering/merge-results` | POST | Store merge groups | JWT |
| `/api/v1/tactical/enriched-ids` | POST | Check already-classified stories | JWT |
| `/api/v1/tactical/ingest` | POST | Store tactical enrichments | JWT |
| `/api/v1/fact-check/pending` | GET | Stories awaiting fact-check | JWT |
| `/api/v1/fact-check/ingest` | POST | Store fact-check verdicts | JWT |
| `/api/v1/stories/pending-haiku` | GET | Stories needing Haiku processing | JWT |
| `/api/v1/stories/haiku-results` | POST | Store relevance/summary results | JWT |
| `/api/v1/promises/summary` | GET | Current promise statuses | JWT |
| `/api/v1/promises/ingest` | POST | Update promise statuses | JWT |
| `/api/v1/announcements/summary` | GET | Recent govt announcements | JWT |

---

## Nepal Political Context (for prompts)

Include this in your agent prompts to prevent hallucination:

```
Key Nepal party names (use EXACT names):
- रास्वपा / RASWAPA = Rastriya Swatantra Party (RSP) — led by Rabi Lamichhane
- नेकपा एमाले = CPN-UML — led by KP Sharma Oli
- कांग्रेस = Nepali Congress (NC) — led by Sher Bahadur Deuba
- नेकपा माओवादी = CPN-Maoist Centre — led by Pushpa Kamal Dahal (Prachanda)
- जसपा = Janata Samajbadi Party (JSP)
- राप्रपा = RPP (Rastriya Prajatantra Party)

7 Provinces: Koshi, Madhesh, Bagmati, Gandaki, Lumbini, Karnali, Sudurpashchim
77 Districts total
```
