# Local Qwen Fallback

This setup adds a laptop-only local fallback model for the existing Claude-based pipeline.

It does not replace Claude by default:
- Claude stays primary.
- Qwen is only used if Claude fails.
- Nothing changes on the VPS unless you also add these settings there.

## What this runs

- Model family: `Qwen/Qwen3.5-9B`
- Local runtime: `llama.cpp` OpenAI-compatible server in Docker
- Quantized model file: `Qwen_Qwen3.5-9B-Q4_K_M.gguf`
- Local endpoint on the laptop: `http://127.0.0.1:8010/v1`

The quantized GGUF is used so the model can run locally on a Mac laptop without trying to load the full original weights.

## Start the local fallback

From the repo root:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local-llm.yml up -d local_llm_model local_llm
docker compose -f docker-compose.prod.yml -f docker-compose.local-llm.yml up -d backend worker
```

This does three things:
- downloads the GGUF model into `backend-v5/.models/`
- starts the local OpenAI-compatible model server
- recreates `backend` and `worker` with local fallback env vars enabled

## Verify that Qwen is live

Check the container:

```bash
docker ps | grep osint_local_llm
docker logs --tail=50 osint_local_llm
```

Test the endpoint directly from the laptop:

```bash
curl http://127.0.0.1:8010/health
```

Test a completion:

```bash
curl http://127.0.0.1:8010/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer local' \
  -d '{
    "model": "Qwen/Qwen3.5-9B",
    "messages": [
      {"role": "system", "content": "Reply in one short sentence."},
      {"role": "user", "content": "Say the local fallback is operational."}
    ],
    "temperature": 0.1,
    "max_tokens": 64
  }'
```

## Host-run scripts

If you run Python jobs directly on the laptop instead of through Docker, the backend default now points at:

```bash
LOCAL_LLM_BASE_URL=http://127.0.0.1:8010/v1
```

Recommended host env:

```bash
export LOCAL_LLM_FALLBACK_ENABLED=true
export LOCAL_LLM_PREFER_LOCAL=false
export LOCAL_LLM_BASE_URL=http://127.0.0.1:8010/v1
export LOCAL_LLM_API_KEY=local
export LOCAL_LLM_MODEL=Qwen/Qwen3.5-9B
```

If you want Qwen first and Claude second for host-run jobs:

```bash
export LOCAL_LLM_PREFER_LOCAL=true
```

## Go back to Claude-only

To return the Docker stack to Claude-only behavior:

```bash
docker compose -f docker-compose.prod.yml up -d backend worker
docker compose -f docker-compose.prod.yml -f docker-compose.local-llm.yml stop local_llm
```

If you also want to remove the local model container:

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.local-llm.yml rm -sf local_llm local_llm_model
```

Claude-only means:
- do not use `docker-compose.local-llm.yml`
- do not set `LOCAL_LLM_FALLBACK_ENABLED=true`
- do not set `LOCAL_LLM_PREFER_LOCAL=true`

For host-run jobs, clear the fallback env vars:

```bash
unset LOCAL_LLM_FALLBACK_ENABLED
unset LOCAL_LLM_PREFER_LOCAL
unset LOCAL_LLM_BASE_URL
unset LOCAL_LLM_API_KEY
unset LOCAL_LLM_MODEL
```

## Notes

- The local model runs only on this laptop unless you deliberately add the same compose override elsewhere.
- On Docker for macOS this is CPU-only, so it is best used as a fallback or draft model rather than your only high-stakes reasoning model.
- The model file is stored under `backend-v5/.models/`.
