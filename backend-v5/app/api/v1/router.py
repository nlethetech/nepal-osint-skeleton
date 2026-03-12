"""API v1 router aggregator."""
import os

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, require_analyst, require_dev

CONSUMER_MODE = os.getenv("CONSUMER_MODE", "false").lower() == "true"

# ── Always-loaded modules (consumer + dev) ──
from app.api.v1 import (
    stories, analytics, ingest, analysis, embeddings,
    disasters, disaster_alerts, map, kpi, weather,
    announcements, market, infrastructure, seismic, curfew,
    twitter, elections, energy, auth,
    # Public feed endpoints (consumer accounts)
    public_events,
    # Parliament (MP Performance Index)
    parliament,
    # Dynamic Alerts
    alerts,
    # Dev Workstation
    system, admin, notifications, ml,
    editorial,
    # Fact-check system (user-requested verification)
    fact_check,
    # OmniSearch (unified search across all data types)
    unified_search,
    # Corporate Intelligence (stats: any auth; analyst endpoints enforce per-endpoint)
    corporate,
    # Situation Briefs (Narada Analyst Agent)
    briefs,
    # Province Anomalies (Province Anomaly Agent)
    province_anomalies,
    # Tactical enrichments (tactical map agent)
    tactical,
    # Live election results (ECN)
    election_results,
    # Manifesto Promise Tracker
    promises,
    # Verbatim / Parliamentary Speeches
    verbatim,
)

# ── Analyst-only modules (skipped in consumer mode) ──
if not CONSUMER_MODE:
    from app.api.v1 import (
        feedback,
        ops,
        # Company registrations (OCR)
        companies,
        # Collaboration APIs
        cases, teams, verification, watchlists, activity, notes, sources, peer_reviews,
        # Political Entities (Key Actors)
        entities,
        # Spatial Analysis (Google Earth, Hotspots, Proximity)
        spatial,
        # Google Earth Engine (Satellite Imagery, Environmental, Change Detection)
        earth_engine,
        # Damage Assessment (Palantir-grade Geospatial Analysis)
        damage_assessment,
        damage_assessment_v2,
        # Command Center Phase 3 - Advanced Geospatial
        layers, drawing, temporal, reports,
        # Connected analyst graph
        graph,
        # Connected analyst multi-layer graph
        multi_layer_graph,
        # Connected analyst trade
        trade,
        # Connected analyst PWTT persistence
        pwtt,
        # Connected analyst hypotheses
        hypotheses,
        # Government procurement (Bolpatra)
        procurement,
        # Procurement analysis (risk scoring, investigation workbench)
        procurement_analysis,
        # Corporate Analytics (advanced beneficial ownership, shell scoring, etc.)
        corporate_analytics,
        # Anomaly Detection (cross-domain anomaly scanning)
        anomalies,
        # Investigation Case Management
        investigation_cases,
        # Unified Graph (NARADA Palantir-grade graph exploration)
        unified_graph,
    )

router = APIRouter(prefix="/api/v1")

# Authentication (contains both public + protected endpoints)
router.include_router(auth.router)

# Dependency buckets
any_auth = [Depends(get_current_user)]
analyst_auth = [Depends(require_analyst)]
dev_auth = [Depends(require_dev)]

# ============================================================
# Consumer-safe (JWT required)
# ============================================================
router.include_router(stories.router, dependencies=any_auth)
router.include_router(analytics.router, dependencies=any_auth)
router.include_router(disasters.router, dependencies=any_auth)
router.include_router(disaster_alerts.router, dependencies=any_auth)
router.include_router(map.router, dependencies=any_auth)
router.include_router(kpi.router, dependencies=any_auth)
router.include_router(weather.router, dependencies=any_auth)
router.include_router(announcements.router, dependencies=any_auth)
router.include_router(market.router, dependencies=any_auth)
router.include_router(infrastructure.router, dependencies=any_auth)
router.include_router(seismic.router, dependencies=any_auth)
router.include_router(curfew.router, dependencies=any_auth)
router.include_router(twitter.router, dependencies=any_auth)
router.include_router(elections.router, dependencies=any_auth)
router.include_router(energy.router, dependencies=any_auth)
router.include_router(public_events.router, dependencies=any_auth)
router.include_router(alerts.router, dependencies=any_auth)
router.include_router(parliament.router, dependencies=any_auth)
router.include_router(notifications.router, dependencies=any_auth)
router.include_router(unified_search.router, dependencies=any_auth)
router.include_router(corporate.router, dependencies=any_auth)
router.include_router(briefs.router, dependencies=any_auth)
router.include_router(province_anomalies.router, dependencies=any_auth)
router.include_router(fact_check.router, dependencies=any_auth)
router.include_router(tactical.router, dependencies=any_auth)
router.include_router(election_results.router)  # Public — election data is open
router.include_router(promises.router, dependencies=any_auth)
router.include_router(verbatim.router, dependencies=any_auth)

# ============================================================
# Analyst+ (JWT + role required) — skipped in consumer mode
# ============================================================
if not CONSUMER_MODE:
    router.include_router(ops.router, dependencies=analyst_auth)
    router.include_router(cases.router, dependencies=analyst_auth)
    router.include_router(teams.router, dependencies=analyst_auth)
    router.include_router(verification.router, dependencies=analyst_auth)
    router.include_router(watchlists.router, dependencies=analyst_auth)
    router.include_router(activity.router, dependencies=analyst_auth)
    router.include_router(notes.router, dependencies=analyst_auth)
    router.include_router(sources.router, dependencies=analyst_auth)
    router.include_router(peer_reviews.router, dependencies=analyst_auth)
    router.include_router(entities.router, dependencies=analyst_auth)
    router.include_router(spatial.router, dependencies=analyst_auth)
    router.include_router(feedback.router, dependencies=analyst_auth)
    router.include_router(layers.router, dependencies=analyst_auth)
    router.include_router(drawing.router, dependencies=analyst_auth)
    router.include_router(temporal.router, dependencies=analyst_auth)
    router.include_router(reports.router, dependencies=analyst_auth)
    router.include_router(graph.router, dependencies=analyst_auth)
    router.include_router(multi_layer_graph.router, dependencies=analyst_auth)
    router.include_router(trade.router, dependencies=analyst_auth)
    router.include_router(pwtt.router, dependencies=analyst_auth)
    router.include_router(hypotheses.router, dependencies=analyst_auth)
    router.include_router(procurement.router, dependencies=analyst_auth)
    router.include_router(companies.router, dependencies=analyst_auth)
    router.include_router(procurement_analysis.router, dependencies=analyst_auth)
    router.include_router(earth_engine.router, dependencies=analyst_auth)
    router.include_router(damage_assessment.router, dependencies=analyst_auth)
    router.include_router(damage_assessment_v2.router, dependencies=analyst_auth)
    router.include_router(corporate_analytics.router, dependencies=analyst_auth)
    router.include_router(anomalies.router, dependencies=analyst_auth)
    router.include_router(investigation_cases.router, dependencies=analyst_auth)
    router.include_router(unified_graph.router, dependencies=analyst_auth)

# ============================================================
# Dev-only (JWT + dev role required) — always loaded
# ============================================================
router.include_router(ingest.router, dependencies=dev_auth)
router.include_router(analysis.router, dependencies=dev_auth)
router.include_router(embeddings.router, dependencies=dev_auth)
router.include_router(ml.router, dependencies=dev_auth)
router.include_router(system.router, dependencies=dev_auth)
router.include_router(admin.router, dependencies=dev_auth)
router.include_router(editorial.router, dependencies=dev_auth)
