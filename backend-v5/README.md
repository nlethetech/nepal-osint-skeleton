# Nepal OSINT v5 Backend

Clean, professional FastAPI backend for the Nepal OSINT platform with real-time news aggregation, story clustering, and WebSocket support.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Vite + React)                   │
│                         localhost:5173                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │   StoriesWidget      │     │     NewsFeedWidget           │  │
│  │   (Aggregated)       │     │     (Real-time)              │  │
│  │                      │     │                              │  │
│  │  GET /aggregated-news│     │  WebSocket /ws/news          │  │
│  │  - Clustered stories │     │  - Live feed on ingest       │  │
│  │  - Multi-source      │     │  - Nepal-only filtering      │  │
│  │  - 72h window        │     │  - Heartbeat every 30s       │  │
│  └──────────────────────┘     └──────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (FastAPI)                             │
│                      localhost:8001                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   API v1    │  │  WebSocket  │  │   Background Tasks      │  │
│  │  /api/v1/*  │  │   /ws/*     │  │   (APScheduler)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│         │                │                    │                  │
│         ▼                ▼                    ▼                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Services Layer                          │  │
│  │  • RelevanceService  (Nepal classification + categories)  │  │
│  │  • SeverityService   (critical/high/medium/low grading)   │  │
│  │  • ClusteringService (Union-Find story clustering)        │  │
│  │  • IngestionService  (RSS fetching + broadcasting)        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Data Layer                              │  │
│  │  • StoryRepository       • StoryClusterRepository          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
           ┌───────────────────┴───────────────────┐
           │                                       │
           ▼                                       ▼
┌─────────────────────┐               ┌─────────────────────┐
│   PostgreSQL        │               │      Redis          │
│   localhost:5433    │               │   localhost:6380    │
│   nepal_osint_v5    │               │   caching/pubsub    │
└─────────────────────┘               └─────────────────────┘
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.11+
- Node.js 18+ (for frontend)

### 1. Start Infrastructure

```bash
cd backend-v5
docker compose up -d postgres redis
```

### 2. Set Up Backend

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start the backend
uvicorn app.main:app --reload --port 8001
```

## Docker (Automatic Ingestion)

The live news feed updates automatically only when the scheduler is running.
In Docker, the scheduler runs in the `worker` service (`python -m app.worker`).

This Compose setup also includes a one-shot `migrate` service that runs `alembic upgrade head`
before `worker`/`api` start, so schema changes apply automatically on boot.

Start the full stack (includes `api` + `worker` + `postgres` + `redis`):
```bash
cd backend-v5
JWT_SECRET_KEY=dev-secret-change-me docker compose up -d --build
```

Frontend is also available via Docker (Vite dev server + proxy to the API).
By default it binds to host port `5174` (to avoid conflicting with other local Vite instances).
Override it if you want a different port:
```bash
cd backend-v5
JWT_SECRET_KEY=dev-secret-change-me FRONTEND_PORT=5173 docker compose up -d --build
```

If you start only `api`, Compose will also start `worker` (so ingestion stays automatic):
```bash
cd backend-v5
JWT_SECRET_KEY=dev-secret-change-me docker compose up -d --build api
```

### Runtime Toggles (Safe Defaults)

This backend is designed to keep the **rule-based pipeline as the safe default** and only
enable ML overrides when you explicitly opt in.

Set these environment variables (e.g., in `backend-v5/.env`) as needed:

- `CLUSTERING_SMART_THRESHOLD` (default: `0.70`): Higher = fewer merges (precision), lower = more merges (recall).
- `ML_ENABLE_PRIORITY_BANDIT` (default: off): Enable RL priority/severity suggestions at ingestion-time.
- `ML_ENABLE_EMBEDDING_CLASSIFIER` (default: off): Allow the trained embedding classifier to override the keyword model
  when the keyword model is low-confidence.
- `UNIFIED_CANDIDATE_READ_MODE` (default: `db_primary_json_fallback`): Candidate read strategy.
  Allowed values: `db_primary_json_fallback`, `db_only`, `json_only`.

### 3. Configure Frontend

Update `frontend/.env.development`:
```env
VITE_API_URL=http://localhost:8001
VITE_FEATURE_UNIFIED_CANDIDATE=true
```

### 4. Trigger Initial Data Fetch

```bash
curl -X POST http://localhost:8001/api/v1/ingest/trigger
```

## API Endpoints

### Stories API (`/api/v1/stories`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/stories` | GET | Paginated story list with filters |
| `/stories/{id}` | GET | Single story by ID |

**Query Parameters:**
- `page` (int, default: 1)
- `page_size` (int, default: 20, max: 100)
- `source_id` (string, optional)
- `nepal_only` (bool, default: true)
- `from_date` / `to_date` (datetime, optional)

### Analytics API (`/api/v1/analytics`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/consolidated-stories` | GET | Stories for StoriesWidget |
| `/aggregated-news` | GET | Clustered stories with multi-source |
| `/summary` | GET | KPI metrics for dashboard |
| `/threat-matrix` | GET | Threat levels by category |

**Aggregated News Parameters:**
- `hours` (int, default: 72, max: 168) - Time window
- `category` (string, optional) - Filter: political, economic, security, disaster, social
- `severity` (string, optional) - Filter: critical, high, medium, low

### WebSocket API

| Endpoint | Protocol | Description |
|----------|----------|-------------|
| `/ws/news` | WebSocket | Real-time Nepal news feed |
| `/ws/status` | GET | Connection stats |

**WebSocket Message Types:**

```typescript
// On connect - receive recent stories
{
  "type": "initial_stories",
  "timestamp": "2026-01-27T12:00:00Z",
  "data": [{ id, title, url, source_id, category, severity, ... }]
}

// New story ingested
{
  "type": "new_story",
  "timestamp": "2026-01-27T12:05:00Z",
  "data": { id, title, url, source_id, category, severity, ... }
}

// Keep-alive (every 30s)
{
  "type": "heartbeat",
  "timestamp": "2026-01-27T12:00:30Z"
}
```

### Ingestion API (`/api/v1/ingest`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/trigger` | POST | Manually trigger RSS ingestion |
| `/status` | GET | Check ingestion status |

## Database Schema

### stories

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `external_id` | VARCHAR(64) | SHA-256 hash of URL (dedup) |
| `source_id` | VARCHAR(50) | RSS source identifier |
| `source_name` | VARCHAR(255) | Human-readable source name |
| `title` | TEXT | Article title |
| `url` | TEXT | Original article URL |
| `summary` | TEXT | Article summary/description |
| `content` | TEXT | Full content (if available) |
| `language` | VARCHAR(10) | Language code (en/ne) |
| `nepal_relevance` | VARCHAR(30) | NEPAL_DOMESTIC / NEPAL_NEIGHBOR / INTERNATIONAL |
| `relevance_score` | NUMERIC(4,3) | 0.0 - 1.0 relevance confidence |
| `relevance_triggers` | JSONB | Keywords that triggered classification |
| `category` | VARCHAR(20) | political / economic / security / disaster / social |
| `severity` | VARCHAR(20) | critical / high / medium / low |
| `cluster_id` | UUID | FK to story_clusters (nullable) |
| `published_at` | TIMESTAMPTZ | Article publication time |
| `scraped_at` | TIMESTAMPTZ | When we fetched it |
| `created_at` | TIMESTAMPTZ | DB insertion time |

**Indexes:**
- `idx_stories_source_published` - (source_id, published_at)
- `idx_stories_relevance_published` - (nepal_relevance, published_at)
- `idx_stories_category_published` - (category, published_at)
- `idx_stories_severity_published` - (severity, published_at)

### story_clusters

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `headline` | TEXT | Representative headline (most recent) |
| `summary` | TEXT | Aggregated summary |
| `category` | VARCHAR(20) | Dominant category |
| `severity` | VARCHAR(20) | Highest severity in cluster |
| `story_count` | INTEGER | Number of stories in cluster |
| `source_count` | INTEGER | Number of unique sources |
| `first_published` | TIMESTAMPTZ | Earliest story timestamp |
| `last_updated` | TIMESTAMPTZ | Latest story timestamp |
| `created_at` | TIMESTAMPTZ | Cluster creation time |

## Classification System

### 5-Category Classification

| Category | Keywords |
|----------|----------|
| **political** | election, parliament, cabinet, minister, party, coalition, government, policy |
| **economic** | economy, market, nepse, inflation, budget, remittance, trade, bank, gdp |
| **security** | army, military, border, police, arrest, crime, terrorism, violence |
| **disaster** | earthquake, flood, landslide, avalanche, fire, accident, emergency |
| **social** | protest, strike, bandh, rally, health, education, culture, festival |

Priority order: disaster > security > political > economic > social

### 4-Level Severity Grading

| Severity | Criteria |
|----------|----------|
| **critical** | death, killed, bomb, explosion, earthquake magnitude >5, emergency declared |
| **high** | injured, arrest, flood, landslide, clash, violence, strike |
| **medium** | nepal_relevance=DOMESTIC + relevance_score > 0.7 |
| **low** | Everything else |

### Nepal Relevance Levels

| Level | Description |
|-------|-------------|
| **NEPAL_DOMESTIC** | Directly about Nepal (from Nepal source or contains Nepal markers) |
| **NEPAL_NEIGHBOR** | About India/China/neighbors with Nepal connection |
| **INTERNATIONAL** | Not relevant to Nepal (excluded from dashboard) |

## Story Clustering

The clustering system groups similar stories from multiple sources using a lightweight Union-Find algorithm.

### How It Works

1. **Similarity Scoring** (`similarity_engine.py`)
   - Title similarity using difflib SequenceMatcher
   - Entity overlap (shared keywords/names)
   - Category match bonus
   - Temporal proximity (stories within 24h window)

2. **Blocking Rules** (`blocking.py`)
   - Different categories → never cluster
   - Time gap > 48 hours → never cluster
   - Same source same day → candidate

3. **Clustering** (`clustering_service.py`)
   - Build similarity graph for candidates
   - Threshold: 0.6 similarity to cluster
   - Merge using Union-Find algorithm
   - Representative headline = most recent story

### Background Task

Clustering runs every 30 minutes via APScheduler, processing stories from the last 72 hours.

## Configuration Files

### `config/sources.yaml`

Defines 28 RSS feeds organized by priority:

```yaml
sources:
  # Priority 1 - Nepal English (5-min polling)
  - id: tkp
    name: The Kathmandu Post
    url: https://kathmandupost.com/rss
    language: en
    priority: 1

  # Priority 2 - Nepal Nepali (15-min polling)
  - id: onlinekhabar_ne
    name: Online Khabar Nepali
    url: https://www.onlinekhabar.com/feed
    language: ne
    priority: 2
```

### `config/relevance_rules.yaml`

Nepal relevance classification rules:

```yaml
nepal_sources:
  - tkp
  - himalayan
  - republica
  - onlinekhabar

nepal_markers:
  - nepal
  - kathmandu
  - pokhara
  - oli
  - prachanda
  # ... cities, politicians, parties

exclusion_patterns:
  - bollywood
  - ipl.*cricket
  - hollywood
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://...localhost:5433/nepal_osint_v5` | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6380/0` | Redis connection |
| `DEBUG` | `false` | Enable debug logging |

## Directory Structure

```
backend-v5/
├── app/
│   ├── __init__.py
│   ├── main.py                    # FastAPI application
│   ├── config.py                  # Pydantic settings
│   ├── core/
│   │   ├── database.py            # Async PostgreSQL engine
│   │   ├── redis.py               # Redis connection
│   │   └── websocket.py           # WebSocket connection manager
│   ├── models/
│   │   ├── base.py                # SQLAlchemy declarative base
│   │   ├── story.py               # Story model
│   │   ├── story_cluster.py       # StoryCluster model
│   │   └── source.py              # RSS source model
│   ├── schemas/
│   │   ├── story.py               # Pydantic story schemas
│   │   └── analytics.py           # Analytics response schemas
│   ├── repositories/
│   │   ├── story.py               # Story data access
│   │   └── story_cluster.py       # Cluster data access
│   ├── services/
│   │   ├── story_service.py       # Story business logic
│   │   ├── ingestion_service.py   # RSS orchestration + broadcasting
│   │   ├── relevance_service.py   # Nepal relevance + categories
│   │   ├── severity_service.py    # Severity grading
│   │   └── clustering/
│   │       ├── __init__.py
│   │       ├── similarity_engine.py
│   │       ├── blocking.py
│   │       └── clustering_service.py
│   ├── ingestion/
│   │   ├── rss_fetcher.py         # Async RSS fetcher
│   │   └── deduplicator.py        # URL hash deduplication
│   ├── api/
│   │   ├── deps.py                # Dependency injection
│   │   └── v1/
│   │       ├── router.py          # Route aggregator
│   │       ├── stories.py         # Stories endpoints
│   │       ├── analytics.py       # Analytics endpoints
│   │       ├── ingest.py          # Ingestion endpoints
│   │       └── websocket.py       # WebSocket endpoints
│   └── tasks/
│       └── scheduler.py           # APScheduler background tasks
├── config/
│   ├── sources.yaml               # RSS feed definitions
│   └── relevance_rules.yaml       # Nepal classification rules
├── alembic/
│   ├── versions/
│   │   ├── 001_initial_schema.py
│   │   └── 002_add_categories_clustering.py
│   └── env.py
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
└── README.md
```

## Frontend Integration

### StoriesWidget (Aggregated News)

Uses `GET /api/v1/analytics/aggregated-news`:

```typescript
interface AggregatedCluster {
  id: string;
  headline: string;
  summary?: string;
  category?: 'political' | 'economic' | 'security' | 'disaster' | 'social';
  severity?: 'critical' | 'high' | 'medium' | 'low';
  story_count: number;
  source_count: number;
  sources: string[];          // ["Kathmandu Post", "Republica", ...]
  first_published?: string;
  stories: ClusterStory[];    // Individual stories in cluster
}
```

### NewsFeedWidget (Real-time)

Uses WebSocket `ws://localhost:8001/ws/news`:

```typescript
// Hook: useNewsFeed
const { items, isConnected, error } = useNewsFeed();

// items = NewsItem[] - real-time feed
// isConnected = boolean - WebSocket connection status
// error = string | null - connection error message
```

## Migrations

### Run Migrations

```bash
# Apply all migrations
alembic upgrade head

# Create new migration
alembic revision --autogenerate -m "description"

# Check current version
alembic current
```

### Migration History

1. `001_initial_schema.py` - Stories table, sources table
2. `002_add_categories_clustering.py` - Added category, severity, cluster_id; created story_clusters table

## Health Checks

```bash
# Backend health
curl http://localhost:8001/health

# WebSocket status
curl http://localhost:8001/ws/status

# Database connectivity (via any API)
curl http://localhost:8001/api/v1/analytics/summary
```

## Development

### Running Tests

```bash
pytest tests/ -v
```

### Linting

```bash
ruff check app/
ruff format app/
```

### Logs

```bash
# Follow backend logs
uvicorn app.main:app --reload --port 8001 2>&1 | tee backend.log

# Docker logs
docker compose logs -f postgres redis
```

## Ports Summary

| Service | Port | Description |
|---------|------|-------------|
| Backend | 8001 | FastAPI application |
| PostgreSQL | 5433 | Database (mapped from 5432) |
| Redis | 6380 | Cache/pubsub (mapped from 6379) |
| Frontend | 5173 | Vite dev server |

## Next Steps (Planned)

- **Key Actors/Entities**: Named entity extraction and tracking
- **Event Timeline**: Discrete event model with relationships
- **Alerts System**: Configurable alert thresholds
- **District Mapping**: Nepal district-level geolocation
