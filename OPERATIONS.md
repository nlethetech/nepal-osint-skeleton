# NARADA Operational Configuration

Production-tuned thresholds, weights, and intervals. These values are the result of months of iteration on Nepal-specific data.

---

## Story Clustering Thresholds

| Parameter | Value | Purpose |
|-----------|-------|---------|
| **Hybrid threshold** | **0.72** | Main clustering decision (Palantir-grade v4) |
| Smart threshold | 0.70 | v3 legacy (4-component weighted) |
| Similarity threshold | 0.60 | v2 legacy fallback |
| Min title similarity | 0.25 | Floor — reject if titles have zero overlap |
| Min semantic similarity | 0.50 | E5-Large cosine minimum |
| Max time window | **48 hours** | Stories only cluster within this window |
| LLM validation threshold | 2 members | Validate clusters with >2 stories via LLM |

### Hybrid Similarity Formula (v4)

```
score = 0.45 × semantic + 0.30 × lexical + 0.25 × structural
```

Where:
- **Semantic** (45%): E5-Large cosine similarity of embeddings
- **Lexical** (30%): Character 3-gram Jaccard overlap
- **Structural** (25%): Composite of:
  - Entity overlap: 40%
  - Geographic proximity: 30%
  - Temporal proximity: 30%

### Smart Similarity Formula (v3)

```
score = 0.40 × text + 0.25 × entity + 0.20 × geo + 0.15 × category
```

---

## Real-Time Deduplication

| Parameter | Value |
|-----------|-------|
| **Production threshold** | **0.58** |
| Default threshold | 0.65 |
| Cache size | 5,000 stories max |
| Cache TTL | 48 hours |
| Title weight (3-gram Jaccard) | 50% |
| Entity overlap weight | 35% |
| Time proximity weight | 15% |
| Max time difference | 48 hours |

**URL Normalization:** SHA256 of normalized URL + title (first 32 chars). Strips 30+ tracking params (utm_*, fbclid, gclid, msclkid, etc.)

---

## Source Priority & Reliability

### Priority Levels

| Priority | Poll Interval | Sources |
|----------|--------------|---------|
| **1 (Critical)** | 5-15 min | Kathmandu Post, OnlineKhabar (EN+NE), Setopati, eKantipur, Ratopati, Nagarik News, Annapurna Post, BBC Nepali, Himalayan Times, My Republica, BBC South Asia |
| **2 (Important)** | 15-30 min | Khabarhub, Rising Nepal, Gorkhapatra, Himal Press, Pahilo Post, Kantipur TV, AP1 TV, Image Channel, Mero Lagani |
| **3 (Regular)** | 30-60 min | All provincial sources (OnlineKhabar regional, Ratopati regional, eKantipur provincial), Spotlight Nepal, local outlets |
| **4 (Niche)** | 60+ min | Pokhara Hotline, niche local sites |

### Government Source Tiers

| Tier | Poll Interval | Sources |
|------|--------------|---------|
| **Critical** | 30 min | OPMCM (PM Office), MOHA (Home Affairs), Election Commission, Nepal Police, BIPAD Portal |
| **High** | 60 min | MOF, MOHP, MOD, MOFA, CIB, APF, Nepal Army, NRB, PSC, Parliament |
| **Medium** | 2 hours | All other ministries, regulatory bodies, Supreme Court |
| **Low** | 3 hours | Municipalities, minor departments |

### RL Confidence Threshold
- **0.60** for both category and priority predictions (RL model integration)

---

## Scheduler Intervals (VPS Background Jobs)

### Data Ingestion
| Job | Interval | Notes |
|-----|----------|-------|
| RSS Priority Sources | 5 min (300s) | Top 12 news sites |
| RSS All Sources | 15 min (900s) | All 55+ feeds |
| HTML News Scraping | 30 min (1800s) | Ratopati, eKantipur, Himalayan Times |
| Nitter Accounts | 15 min (900s) | 59 Twitter/X accounts via Nitter |
| Nitter Hashtags | 30 min (1800s) | 15 hashtags (EN + Nepali) |
| Twitter API | 12 hours (43200s) | Free tier: 100 tweets/month |
| BIPAD Disasters | 5 min (300s) | Earthquake, flood, landslide alerts |
| River Monitoring | 10 min (600s) | DHM river level stations |
| Weather | 1 hour (3600s) | DHM forecasts |
| Government Announcements | 3 hours (10800s) | Ministry press releases |
| Market Data | 1 hour (3600s) | NEPSE, forex, gold, fuel |
| Energy (NEA) | 1 hour (3600s) | Power grid status |
| Aviation (ADS-B) | 1 min (60s) | Aircraft positions |

### Processing & Analysis
| Job | Interval | Notes |
|-----|----------|-------|
| Story Clustering | 5 min (300s) | Hybrid 0.72 threshold |
| Tweet Deduplication | 30 min (1800s) | Dedup + location extraction |
| Entity Extraction | 30 min (1800s) | Aho-Corasick + NER |
| Entity Mention Recount | 1 hour (3600s) | Update mention statistics |
| Entity Pattern Refresh | 24 hours (86400s) | Rebuild Aho-Corasick automaton |
| Embedding Generation | 30 min (1800s) | E5-Large vectors (HIGH CPU) |
| KPI Broadcast | 1 min (60s) | WebSocket push to dashboards |

### Political Data
| Job | Interval | Notes |
|-----|----------|-------|
| ECN Election Results | 3 min (180s) | Live counting (election day only) |
| Parliament Members | 24 hours (86400s) | MP profiles + candidate linking |
| Parliament Bills | 6 hours (21600s) | Bill status tracking |
| Parliament Committees | 24 hours (86400s) | Committee membership |
| Parliament Scores | 24 hours (86400s) | MP performance scoring |
| Election Sync | 24 hours (86400s) | Unified candidate data |

### Local-Only Agents (NOT on VPS)
| Job | Interval | Runner |
|-----|----------|--------|
| Briefing (Analyst+Province) | 4-6 hours | `run_local_api.py briefing` |
| Nitter Scraper | 2 hours | `run_local_api.py nitter` |
| Clustering Merge | 30 min - 2 hours | `run_local_api.py clustering` |
| Tactical Enrichment | 2-5 min | `run_local_api.py tactical` |
| Fact-Check | 30 min - 4 hours | `run_local_api.py factcheck` |
| Haiku Relevance + Summary | 2 min loop | `run_local_haiku.py --loop 120` |
| Promise Tracker | Daily 11 PM NPT | `run_promise_tracker.py` |

---

## Severity Classification Rules

### CRITICAL
Keywords: `death, killed, bomb, explosion, massacre, plane crash, building collapse`
Earthquake: magnitude > 5.0
Context: `emergency declared, state of emergency`
Nepali: `मृत्यु, हत्या, बम, विस्फोट, भूकम्प`

### HIGH
Keywords: `injured, arrest, flood, landslide, clash, violence, strike, protest, fire, robbery, murder, rape, riot`
Nepali: `घाइते, गिरफ्तार, बाढी, पहिरो, झडप, हिंसा, हड्ताल, प्रदर्शन, आगलागी`

### MEDIUM
Keywords: `warning, investigation, dispute, corruption, price hike, unemployment, disease outbreak`
OR: `nepal_relevance == NEPAL_DOMESTIC AND relevance_score > 0.7`

### LOW
Everything else

### Exclusion Contexts (Downgrade severity)
- **Sports:** cricket, football, IPL, Premier League, FIFA, Olympics (2+ sport indicators → downgrade)
- **Entertainment:** Bollywood, Hollywood, awards ceremony, film festival

---

## Embedding Configuration

| Parameter | Value |
|-----------|-------|
| **Model** | `intfloat/multilingual-e5-large` |
| Dimensions | 1024 |
| Batch size | 32 |
| Max sequence length | 512 tokens |
| Storage | pgvector (PostgreSQL extension) |

**Alternative models:**
- `e5-base`: 768 dimensions (lighter, less accurate)
- `minilm`: 384 dimensions (for <4GB RAM servers)

### NER Configuration
- Transformer model: `xlm-roberta-ner`
- Confidence threshold: 0.5
- Hybrid mode: Transformer + rule-based (Aho-Corasick for Nepal entities)

---

## Entity Linking Thresholds

| Service | Threshold | Purpose |
|---------|-----------|---------|
| Entity Linker | 0.80 | Story-entity match confidence |
| Parliament Linker | 0.85 | MP-company ownership linking |
| Speaker Match | 0.65 | Parliament speech attribution |
| Tweet Dedup | 0.60 | Tweet similarity threshold |
| Entity Search | 0.30 | Search relevance floor |
| Event Dedup (Ops) | 0.95 | Near-exact event matching |

---

## Relevance Classification (Rules-Based)

### Auto-NEPAL_DOMESTIC Sources (skip LLM check)
All 55+ Nepal news sources in sources.yaml (Kathmandu Post, OnlineKhabar, Setopati, etc.)

### Keyword-Based Classification
- **NEPAL_DOMESTIC:** "nepal", "nepali", "kathmandu", all 77 district names, all 7 province names, all major political figures, all party names
- **NEPAL_NEIGHBOR:** "india nepal", "china nepal", "border", bilateral keywords
- **IRRELEVANT:** 50+ regex patterns for foreign sports, entertainment, other countries' domestic politics

---

## Infrastructure Specs

### Recommended Server
| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 8 GB | 16 GB |
| Storage | 80 GB SSD | 160 GB SSD |
| Cost | ~$10/mo (Hetzner CX32) | ~$16/mo (Hetzner CX42) |

### Container Memory
| Service | Reserved | Limit | Notes |
|---------|----------|-------|-------|
| PostgreSQL | 256 MB | 768 MB | pgvector + 50 connections |
| Redis | 64 MB | 64 MB | LRU eviction |
| Backend API | 256 MB | 768 MB | 1 Uvicorn worker |
| Worker | 512 MB | 3 GB | ML models peak during embedding |
| Frontend (Nginx) | 32 MB | 128 MB | Static files only |

### PostgreSQL Tuning
```
max_connections = 50
shared_buffers = 64MB
effective_cache_size = 256MB
statement_timeout = 60s
idle_in_transaction_session_timeout = 30s
```

### Redis Config
```
maxmemory 64mb
maxmemory-policy allkeys-lru
```

### Nginx Rate Limits
```
API: 15 req/s per IP (burst 30)
Login: 5 req/min per IP (burst 5)
WebSocket timeout: 300s
Static cache: 1 year (immutable)
```

---

## Deployment Commands

```bash
# Initial deploy
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml up migrate
docker compose -f docker-compose.prod.yml up -d backend worker frontend

# Update (after code changes)
docker compose -f docker-compose.prod.yml build backend worker
docker compose -f docker-compose.prod.yml up -d backend worker
# IMPORTANT: Restart frontend too (nginx caches DNS of backend container)
docker compose -f docker-compose.prod.yml restart frontend

# Database backup
docker compose exec postgres pg_dump -U nepal_osint -Fc nepal_osint > backup_$(date +%Y%m%d).dump

# View logs
docker compose -f docker-compose.prod.yml logs -f worker --tail=50
```

---

## Cron Schedule (Local Agents)

```bash
# Briefing: merged analyst + province (2 Sonnet calls)
0 */6 * * * cd /path/to/backend && ./run_agents.sh briefing

# Nitter: scrape Twitter via Nitter (VPS IP blocked)
15 */2 * * * cd /path/to/backend && ./run_agents.sh nitter

# Clustering: merge stories by event
30 */2 * * * cd /path/to/backend && ./run_agents.sh clustering

# Tactical: classify for situation map
45 */4 * * * cd /path/to/backend && ./run_agents.sh tactical

# Fact-check: verify flagged stories
0 1,5,9,13,17,21 * * * cd /path/to/backend && ./run_agents.sh factcheck

# Promise tracker: nightly manifesto check
0 17 * * * cd /path/to/backend && python run_promise_tracker.py

# Haiku: continuous relevance + summary
# Run as daemon, not cron:
# OSINT_PASSWORD=xxx python run_local_haiku.py --loop 120
```

---

## Daily Budget (Claude Max 5x)

| Agent | Model | Calls/Day | Cost |
|-------|-------|-----------|------|
| Briefing | Sonnet | ~8 (4 runs × 2 calls) | Free (Max) |
| Clustering | Haiku | ~60 (12 runs × 5 batches) | Free (Max) |
| Tactical | Haiku | ~72 (6 runs × 12 batches) | Free (Max) |
| Fact-Check | Sonnet | ~24 (6 runs × 4 stories) | Free (Max) |
| Relevance | Haiku | ~100 (continuous) | Free (Max) |
| Summary | Haiku | ~80 (continuous) | Free (Max) |
| Promise | Sonnet | ~2 (1 nightly run) | Free (Max) |
| **Total** | | **~346 calls/day** | **$0** |
