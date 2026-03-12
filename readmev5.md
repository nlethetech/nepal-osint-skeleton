# NARADA V5 Startup Runbook

This guide is the single source of truth for starting and running the **v5 stack** without port/data confusion.

## 1. Golden Rule

Always run v5 using:

- Compose file: `backend-v5/docker-compose.yml`
- Primary frontend URL: `http://localhost:5174`
- Primary API URL: `http://localhost:8001`

Do **not** use the root `docker-compose.yml` for day-to-day v5 work unless you intentionally want the legacy stack.

## 2. What Runs Where (V5)

- `nepal_v5_frontend` -> host `5174` (container `5173`)
- `nepal_v5_api` -> host `8001` (container `8000`)
- `nepal_v5_postgres` -> host `5433` (container `5432`)
- `nepal_v5_redis` -> host `6380` (container `6379`)
- `nepal_v5_worker` -> no host port (background jobs)

Persistent data volumes:

- `backend-v5_postgres_data`
- `backend-v5_redis_data`

## 3. Preflight (Avoid Stack Collision)

From project root:

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5
```

Stop legacy stack if it is running (recommended):

```bash
docker compose -f docker-compose.yml down --remove-orphans
```

Go to v5 compose directory:

```bash
cd backend-v5
```

## 4. First-Time Setup (or After Major Pull)

### 4.1 Environment file

`backend-v5/.env` must exist and include at least:

```env
JWT_SECRET_KEY=change-this-to-a-long-random-string
POSTGRES_PASSWORD=nepal_osint_dev
APP_ENV=development
CORS_ORIGINS=http://localhost:5174,http://localhost:5173
```

Optional integrations can be added later (`ANTHROPIC_API_KEY`, `TWITTER_BEARER_TOKEN`, `GEE_*`, etc.).

### 4.2 Build backend images

Run this when requirements or Dockerfiles changed:

```bash
docker compose build api worker migrate seed_elections
```

### 4.3 Start infrastructure

```bash
docker compose up -d postgres redis
```

### 4.4 Run migrations and seed (explicit, deterministic)

```bash
docker compose run --rm migrate
docker compose run --rm seed_elections
```

### 4.5 Start app services

```bash
docker compose up -d api worker frontend
```

## 5. Daily Startup (Normal)

From `backend-v5/`:

```bash
docker compose up -d
```

Then open:

- Frontend: `http://localhost:5174`
- API docs: `http://localhost:8001/docs`

## 6. Health Verification Checklist

From `backend-v5/`:

```bash
docker compose ps
curl -sS http://localhost:8001/health
```

Expected:

- API health returns `{"status":"healthy"}`
- `nepal_v5_api`, `nepal_v5_frontend`, `nepal_v5_postgres`, `nepal_v5_redis`, `nepal_v5_worker` are up

Check corporate endpoints are mounted:

```bash
curl -sS http://localhost:8001/openapi.json | rg '/api/v1/corporate' | head
```

Expected: multiple `/api/v1/corporate/...` routes.

Optional data sanity check:

```bash
docker exec nepal_v5_api python - <<'PY'
import os, asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def run():
    eng = create_async_engine(os.environ['DATABASE_URL'])
    async with eng.connect() as c:
        for t in ['company_registrations', 'ird_enrichments']:
            r = await c.execute(text(f"select count(*) from {t}"))
            print(t, r.scalar())
    await eng.dispose()

asyncio.run(run())
PY
```

## 7. Known Confusion Pattern (296 vs full dataset)

If you see small/empty corporate stats (example: `296` total and `0` enriched), you are almost certainly hitting the wrong stack.

Fix:

1. Use `http://localhost:5174` (not `5173`).
2. Confirm API is `http://localhost:8001`.
3. Stop legacy root stack:

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5
docker compose -f docker-compose.yml down --remove-orphans
```

4. Hard refresh browser (`Cmd+Shift+R`) and sign in again.

## 8. Common Errors and Exact Fixes

### Error: `Failed to resolve import "@blueprintjs/core"`

Cause: frontend `node_modules` out of sync.

Fix:

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5/backend-v5
docker exec nepal_v5_frontend sh -lc 'cd /app && npm install'
docker compose restart frontend
```

### Error: `service "migrate" didn't complete successfully`

Cause: migration container failed previously and blocks dependency chain.

Fix:

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5/backend-v5
docker compose rm -sf migrate seed_elections
docker compose run --rm migrate
docker compose run --rm seed_elections
docker compose up -d api worker frontend
```

### Error: frontend proxy `ECONNRESET`

Cause: API is restarting or unhealthy.

Fix:

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5/backend-v5
docker compose logs -f api
curl -sS http://localhost:8001/health
```

## 9. Stop / Restart / Clean Reset

### Stop services (keep DB data)

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5/backend-v5
docker compose down
```

### Restart services

```bash
docker compose restart
```

### Full reset (destructive: deletes DB data)

```bash
docker compose down -v --remove-orphans
```

Use full reset only if you intentionally want to wipe local DB/Redis state.

## 10. One-Command "Bring Me Back" Recovery

If things are unclear, run this exact sequence:

```bash
cd /Users/samriddhagc/Desktop/Projects/nepal_osint_v5
docker compose -f docker-compose.yml down --remove-orphans
cd backend-v5
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose run --rm seed_elections
docker compose up -d api worker frontend
curl -sS http://localhost:8001/health
```

Then open `http://localhost:5174`.

## 11. Operational Notes

- Use `backend-v5/docker-compose.yml` as the only v5 operational entrypoint.
- Keep the browser on `5174` to avoid cross-stack UI/API mismatch.
- Rebuild images (`docker compose build ...`) after backend dependency changes.
- If a route exists in code but not in `/openapi.json`, you are likely on an older image/container.
