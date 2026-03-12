"""Province Anomaly Agent — main orchestrator.

Lightweight agent that:
1. Collects stories + tweets from the last 6 hours
2. Classifies them by province via keyword matching (pure Python)
3. Sends a single `claude -p --model sonnet` call for all 7 provinces
4. Stores results in province_anomaly_runs / province_anomalies tables

Uses existing claude_runner.py → call_claude_json() which runs CLI subprocess.
Covered by Claude Max subscription — $0 cost.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.province_anomaly import ProvinceAnomalyRun, ProvinceAnomaly
from app.services.province_anomaly_agent.data_collector import (
    collect_province_data,
    PROVINCE_NAMES,
)
from app.services.province_anomaly_agent.prompts import build_prompt
from app.services.analyst_agent.claude_runner import call_claude_json

logger = logging.getLogger(__name__)


class ProvinceAnomalyAgent:
    """Orchestrates province anomaly detection."""

    def __init__(self, db: AsyncSession, hours: int = 6):
        self.db = db
        self.hours = hours

    async def run(self) -> ProvinceAnomalyRun:
        """Execute a full anomaly detection run."""
        run = ProvinceAnomalyRun(
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        self.db.add(run)
        await self.db.flush()

        try:
            # 1. Collect & classify data
            logger.info("Province Anomaly Agent: collecting data (last %dh)...", self.hours)
            province_data = await collect_province_data(self.db, hours=self.hours)

            total_stories = sum(pd.story_count for pd in province_data.values())
            total_tweets = sum(pd.tweet_count for pd in province_data.values())

            run.stories_analyzed = total_stories
            run.tweets_analyzed = total_tweets

            # 2. Build prompt contexts
            province_contexts = {}
            for pid, pd in province_data.items():
                province_contexts[pid] = {
                    "name": pd.province_name,
                    "stories": [
                        {"source": s.source, "title": s.title, "snippet": s.snippet}
                        for s in pd.stories
                    ],
                    "tweets": [
                        {"title": t.title, "snippet": t.snippet}
                        for t in pd.tweets
                    ],
                }

            prompt = build_prompt(province_contexts)

            # 3. Single Sonnet call
            logger.info(
                "Province Anomaly Agent: calling Sonnet (%d stories, %d tweets)...",
                total_stories, total_tweets,
            )
            result = await call_claude_json(prompt, timeout=180, model="haiku")

            # 4. Parse and store results
            provinces_result = result.get("provinces", [])

            # Ensure we have all 7 provinces
            result_by_pid = {p["province_id"]: p for p in provinces_result}

            for pid in range(1, 8):
                pdata = result_by_pid.get(pid, {})
                pd = province_data.get(pid)

                anomaly = ProvinceAnomaly(
                    run_id=run.id,
                    province_id=pid,
                    province_name=PROVINCE_NAMES.get(pid, f"Province {pid}"),
                    threat_level=pdata.get("threat_level", "LOW"),
                    threat_trajectory=pdata.get("threat_trajectory", "STABLE"),
                    summary=pdata.get("summary", "No significant developments reported in this period."),
                    political=pdata.get("political"),
                    economic=pdata.get("economic"),
                    security=pdata.get("security"),
                    anomalies_data=pdata.get("anomalies", []),
                    story_count=pd.story_count if pd else 0,
                    tweet_count=pd.tweet_count if pd else 0,
                    key_sources=[],
                )
                self.db.add(anomaly)

            # 5. Mark run complete
            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)
            await self.db.commit()

            logger.info(
                "Province Anomaly Agent: complete (%d stories, %d tweets, 7 provinces assessed)",
                total_stories, total_tweets,
            )
            return run

        except Exception as exc:
            logger.exception("Province Anomaly Agent failed: %s", exc)
            run.status = "failed"
            run.error_message = str(exc)[:1000]
            run.completed_at = datetime.now(timezone.utc)
            await self.db.commit()
            return run
