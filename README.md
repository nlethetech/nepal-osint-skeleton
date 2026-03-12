# NARADA - Nepal OSINT Intelligence Platform

> **Open Source Intelligence platform for real-time monitoring and analysis of Nepal's political, economic, and institutional landscape**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-green.svg)](https://python.org)
[![React 18](https://img.shields.io/badge/React-18-blue.svg)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-teal.svg)](https://fastapi.tiangolo.com)

---

## Overview

NARADA (Nepal Analysis, Research, and Data Aggregation) is a **production-grade, enterprise-scale intelligence platform** designed for security analysts, researchers, journalists, and policy makers monitoring Nepal. The platform aggregates data from 28+ specialized sources, applies advanced NLP/ML classification, and presents actionable intelligence through a Palantir-inspired analyst interface.

The system provides **real-time monitoring** of:
- Political developments (elections, parliament, government announcements)
- Natural disasters (BIPAD integration, river monitoring, seismic events)
- Economic indicators (NEPSE, forex, commodities, fuel prices)
- Social dynamics (news sentiment, Twitter/X social listening)
- Geospatial intelligence (satellite imagery, change detection, damage assessment)

NARADA combines **automated data collection** with **human-in-the-loop analysis**, enabling collaborative investigations, peer verification, and evidence-based intelligence production.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NARADA ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        DATA SOURCES (28+ Scrapers)                   │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │   │
│  │  │ RSS     │ │ BIPAD   │ │ Govt    │ │ Market  │ │ Social  │       │   │
│  │  │ Feeds   │ │ Portal  │ │ Sites   │ │ Data    │ │ Media   │       │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘       │   │
│  └───────┼──────────┼──────────┼──────────┼──────────┼────────────────┘   │
│          │          │          │          │          │                     │
│          ▼          ▼          ▼          ▼          ▼                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      INGESTION LAYER (Python)                        │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │   │
│  │  │Deduplicator│  │ NLP/ML     │  │ Embeddings │  │ Clustering │    │   │
│  │  │(SHA-256)   │  │Classifier  │  │(BERT)      │  │ Service    │    │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        STORAGE LAYER                                 │   │
│  │  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐        │   │
│  │  │  PostgreSQL    │  │     Neo4j      │  │     Redis      │        │   │
│  │  │  + pgvector    │  │   (Graph DB)   │  │    (Cache)     │        │   │
│  │  │  60+ tables    │  │  Relationships │  │   Pub/Sub      │        │   │
│  │  └────────────────┘  └────────────────┘  └────────────────┘        │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     API LAYER (FastAPI)                              │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │   │
│  │  │ REST API   │  │ WebSocket  │  │ Auth/JWT   │  │ Rate Limit │    │   │
│  │  │ 150+ eps   │  │ Real-time  │  │ RBAC       │  │ Middleware │    │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │   │
│  └─────────────────────────────┬───────────────────────────────────────┘   │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    FRONTEND (React 18 + TypeScript)                  │   │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │   │
│  │  │ Dashboard  │  │ Map View   │  │ Graph      │  │ Analyst    │    │   │
│  │  │ (KPIs)     │  │ (Leaflet)  │  │ Explorer   │  │ Workspace  │    │   │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    EXTERNAL INTEGRATIONS                             │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                │   │
│  │  │ Google  │  │Anthropic│  │ Twitter │  │OpenStreet│                │   │
│  │  │ Earth   │  │ Claude  │  │   /X    │  │   Map   │                │   │
│  │  │ Engine  │  │ (AI)    │  │  API    │  │         │                │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### Data Collection & Processing
- [x] 28+ specialized scrapers (RSS feeds, government sites, market data)
- [x] BIPAD disaster portal integration (real-time alerts)
- [x] Twitter/X social media intelligence (free tier: 100 tweets/month)
- [x] Parliament scraping (MPs, bills, committees, attendance)
- [x] Market data (NEPSE, NRB forex, fuel prices, gold/silver)
- [x] Automatic deduplication (SHA-256 content hashing)
- [x] Nepal relevance classification (domestic vs. international)
- [x] Severity scoring (critical, high, medium, low)

### Intelligence Analysis
- [x] AI-powered story summarization (Claude Haiku)
- [x] Smart story clustering & deduplication
- [x] Entity extraction & relationship mapping
- [x] Network analysis (Neo4j graph queries)
- [x] Semantic search (pgvector embeddings)
- [x] Trend detection & anomaly alerting
- [x] Historical context tracking

### Geospatial Intelligence
- [x] Interactive map with 10+ layers
- [x] District/province heatmaps
- [x] Google Earth Engine satellite imagery
- [x] Change detection (NDVI, built-up, water)
- [x] Damage assessment workflows
- [x] Drawing tools for analyst annotations
- [x] River monitoring stations

### Political Intelligence
- [x] Election monitoring (165 constituencies)
- [x] MP Performance Index calculation
- [x] Parliamentary activity tracking
- [x] Candidate profiling & dossiers
- [x] Party dynamics analysis
- [x] Government announcement monitoring

### Disaster Management
- [x] BIPAD incident integration
- [x] Real-time disaster alerts
- [x] River level monitoring
- [x] Earthquake notifications
- [x] Weather forecasts
- [x] Satellite damage assessment

### Collaboration & Investigation
- [x] Case management system
- [x] Team-based collaboration
- [x] Peer verification workflows
- [x] Custom watchlists
- [x] Annotations & note-taking
- [x] Evidence linking

### Dashboard Widgets
| Category | Widgets |
|----------|---------|
| **Core** | Situation Map, KPI Metrics, Stories Feed, Live News Feed, Intel Briefing |
| **Disasters** | Disaster Alerts, Weather & Forecast, River Levels, Seismic Activity |
| **Politics** | Election Watchlist, Govt Announcements, Key Entities |
| **Infrastructure** | Infrastructure Status, Power Grid, Border Crossings |
| **Social/Media** | Social Feed, Rumor Tracker |
| **Markets** | Market & Exchange, Air Quality |
| **Emergency** | Emergency Contacts, Threat Matrix |

### Preset Layouts
- **Analyst View** - Comprehensive intelligence overview
- **Election Monitor** - Political tracking focus
- **Disaster Response** - Emergency monitoring
- **Compact View** - Essential widgets only

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 18 + TypeScript | Modern UI framework with type safety |
| **Build Tool** | Vite 5.1 | Fast development & production builds |
| **Styling** | Tailwind CSS 3.4 | Utility-first CSS framework |
| **State** | Zustand 4.5 | Lightweight state management |
| **Data Fetching** | Axios + React Query | HTTP client with caching |
| **Visualization** | D3.js, Recharts, Cytoscape | Charts, graphs, networks |
| **Mapping** | Leaflet + React Leaflet | Interactive geospatial maps |
| **Backend** | FastAPI 0.109+ | High-performance async Python API |
| **ORM** | SQLAlchemy 2.0 async | Database abstraction layer |
| **Database** | PostgreSQL 16 + pgvector | Primary storage with vector search |
| **Graph DB** | Neo4j 5.15 | Entity relationship storage |
| **Cache** | Redis 7 | Caching, pub/sub, job queue |
| **ML/NLP** | PyTorch, Transformers | Deep learning models |
| **Embeddings** | SentenceTransformers | Text embeddings (BERT-based) |
| **LLM** | Anthropic Claude (Haiku) | AI analysis & summarization |
| **Satellite** | Google Earth Engine | Remote sensing analysis |
| **Geospatial** | PostGIS, Shapely | Geographic queries |
| **Background Jobs** | APScheduler | Task scheduling |
| **Containerization** | Docker Compose | Local & production deployment |

---

## Project Structure

```
narada/
├── backend-v5/                 # Python FastAPI backend
│   ├── app/
│   │   ├── api/v1/            # 150+ REST API endpoints
│   │   ├── core/              # Database, Redis, WebSocket setup
│   │   ├── models/            # 40+ SQLAlchemy models
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── repositories/      # Data access layer (14 repositories)
│   │   ├── services/          # Business logic (36 services)
│   │   ├── ingestion/         # 28 specialized scrapers
│   │   ├── ml/                # Machine learning models
│   │   └── tasks/             # Background job scheduler
│   ├── config/                # YAML configuration files
│   ├── alembic/               # Database migrations
│   └── requirements.txt       # Python dependencies
│
├── frontend/                   # React 18 TypeScript frontend
│   ├── src/
│   │   ├── api/               # 60+ API client modules
│   │   ├── components/        # 200+ React components
│   │   ├── pages/             # 27 page views
│   │   ├── stores/            # Zustand state management
│   │   ├── hooks/             # Custom React hooks
│   │   ├── types/             # TypeScript definitions
│   │   └── styles/            # CSS/Tailwind stylesheets
│   ├── public/geo/            # GeoJSON boundaries (districts, provinces)
│   └── package.json           # Node.js dependencies
│
├── infrastructure/            # DevOps configuration
│   └── nginx/                # Nginx reverse proxy config
│
├── docs/                      # Project documentation
│   ├── SYSTEM_FLOWS.md       # Architecture flowcharts
│   ├── ALGORITHMS.md         # Algorithm documentation
│   ├── DATA_PIPELINE.md      # Data flow documentation
│   ├── COMPONENTS.md         # Frontend component catalog
│   ├── BACKEND.md            # Backend architecture
│   └── API_ENDPOINTS.md      # API reference
│
├── docker-compose.yml         # Development environment
├── docker-compose.prod.yml    # Production configuration
└── .env.example              # Environment template
```

---

## Getting Started

### Prerequisites

- **Docker & Docker Compose** (v2.0+)
- **Node.js** (v18+ for local frontend development)
- **Python** (3.11+ for local backend development)
- **Git**

### Environment Setup

```bash
# Clone the repository
git clone https://github.com/your-org/narada.git
cd narada

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
# Required: DATABASE_URL, REDIS_URL, NEO4J_URI
# Optional: ANTHROPIC_API_KEY, TWITTER_BEARER_TOKEN, GEE_SERVICE_ACCOUNT
```

### Quick Start (Docker)

```bash
# Start all services
docker-compose up -d

# Wait for services to initialize (first run may take 2-3 minutes)
docker-compose logs -f

# Access the application
# Frontend: http://localhost:5173
# Backend API: http://localhost:8001
# API Docs: http://localhost:8001/docs
```

### Development Setup

**Backend (Python):**
```bash
cd backend-v5

# Configure env (JWT secret required for APP_ENV=production)
cp ../.env.example .env
# Edit backend-v5/.env and set JWT_SECRET_KEY, CORS_ORIGINS, etc.

# Start PostgreSQL and Redis
docker compose up -d

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --port 8001
```

**Frontend (React):**
```bash
cd frontend
npm install
npm run dev
```

The frontend will be available at http://localhost:5173 and connects to the backend at http://localhost:8001.

---

## Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql+asyncpg://user:pass@localhost:5432/narada` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379/0` |
| `NEO4J_URI` | Neo4j connection URI | `bolt://localhost:7687` |
| `SECRET_KEY` | JWT signing key (32+ chars) | `your-secure-secret-key-here` |

### Optional Integrations

| Variable | Description | Required For |
|----------|-------------|--------------|
| `ANTHROPIC_API_KEY` | Claude API key | AI summarization |
| `TWITTER_BEARER_TOKEN` | Twitter/X API token | Social media intelligence |
| `GEE_SERVICE_ACCOUNT` | Google Earth Engine credentials | Satellite imagery |
| `BIPAD_API_KEY` | BIPAD portal API key | Disaster data |

### Frontend Environment (.env.development)
```
VITE_API_URL=http://localhost:8001
VITE_WS_URL=ws://localhost:8001/ws
```

---

## Data Sources

| Source | Type | Update Frequency | Description |
|--------|------|------------------|-------------|
| **RSS Feeds** | Scraper | 5-15 minutes | 20+ Nepali news outlets |
| **BIPAD Portal** | API | 5 minutes | Disaster incidents & alerts |
| **Parliament Website** | Scraper | Daily | MP data, bills, committees |
| **NEPSE** | Scraper | 15 minutes | Stock market data |
| **NRB Forex** | Scraper | Hourly | Currency exchange rates |
| **Twitter/X** | API | 5 minutes | Social media mentions |
| **Google Earth Engine** | API | On-demand | Satellite imagery analysis |

---

## User Roles

| Role | Access Level | Features |
|------|--------------|----------|
| **Consumer** | Read-only | Dashboard, elections, stories, map, disasters |
| **Analyst** | Full analysis | + Cases, teams, verification, collaboration |
| **Developer** | Admin | + System endpoints, data ingestion, ML training |

---

## API Endpoints

### Core Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/stories` | List stories with filters |
| `GET` | `/api/v1/analytics/consolidated-stories` | Aggregated news feed |
| `GET` | `/api/v1/analytics/summary` | Dashboard KPIs |
| `GET` | `/api/v1/map/events` | Geolocated events for map |
| `GET` | `/api/v1/elections` | Election data |
| `GET` | `/api/v1/disasters/incidents` | BIPAD disaster incidents |
| `GET` | `/api/v1/disasters/alerts` | Active disaster alerts |
| `WS` | `/ws/news` | Real-time news updates |

Full API documentation is available at `/docs` when the backend is running.

See [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md) for complete reference.

---

## Documentation

| Document | Description |
|----------|-------------|
| [System Flows](docs/SYSTEM_FLOWS.md) | Architecture flowcharts (Mermaid) |
| [Algorithms](docs/ALGORITHMS.md) | Core algorithm documentation |
| [Data Pipeline](docs/DATA_PIPELINE.md) | Data ingestion & processing |
| [Components](docs/COMPONENTS.md) | Frontend component catalog |
| [Backend](docs/BACKEND.md) | Backend architecture |
| [Tech Stack](docs/TECH_STACK.md) | Technology documentation |
| [System Understanding](docs/SYSTEM_UNDERSTANDING.md) | High-level overview |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting PRs.

---

## License

Proprietary - All Rights Reserved

---

## Acknowledgments

- [BIPAD Portal](https://bipadportal.gov.np/) - Disaster data
- [Election Commission of Nepal](https://election.gov.np/) - Election data
- [Nepal Parliament](https://parliament.gov.np/) - Parliamentary data
- [Google Earth Engine](https://earthengine.google.com/) - Satellite imagery
- [Anthropic](https://anthropic.com/) - Claude AI

---

## Support

For questions, issues, or feature requests:
- Open an 
- Contact: samriddhagc12@gmail.com

---

*NARADA v5 - Built with precision for Nepal's intelligence community.*
