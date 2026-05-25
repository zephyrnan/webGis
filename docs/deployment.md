# Deployment Guide

## Security Model

GeoSurgical WebGIS is a **pure frontend application** — there is no backend server. All `VITE_*` environment variables are injected into browser JavaScript at build time.

**Production rule**: Do not use remote API keys (OpenAI, DeepSeek, etc.) in production builds. Use a **local Ollama instance** on the same network.

## Quick Start (Docker Compose)

The included `docker-compose.yml` runs both the WebGIS app and an Ollama service:

```bash
# Pull the model you want (first time only)
docker compose up -d ollama
docker exec geosurgical-ollama ollama pull qwen2.5:7b

# Build and start everything
docker compose up --build
```

Open the app at `http://localhost:8080`.

## Docker Services

| Service | Container | Port | Purpose |
| --- | --- | --- | --- |
| `webgis` | `geosurgical-webgis` | 8080 → 80 | Nginx serving the Vite build |
| `ollama` | `geosurgical-ollama` | 11434 | Local LLM inference |

## Build-Time Variables

Vite injects `VITE_*` values at **build time**, not runtime. To change LLM settings, rebuild:

```bash
# Switch to mock mode (no Ollama needed)
VITE_BRAIN_MODE=mock docker compose up --build

# Use a different model
VITE_LLM_MODEL=llama3:8b docker compose up --build
```

## Environment Variables

| Name | Default | Description |
| --- | --- | --- |
| `VITE_BRAIN_MODE` | (auto) | `mock` or `llm`. Auto-detects based on endpoint. |
| `VITE_LLM_ENDPOINT` | `http://localhost:11434` | Ollama API URL. In Docker, use `http://ollama:11434`. |
| `VITE_LLM_MODEL` | `qwen2.5:7b` | Model name for Ollama. |
| `WEBGIS_PORT` | `8080` | Host port for the WebGIS container. |
| `OLLAMA_PORT` | `11434` | Host port for the Ollama API. |

## Ollama Model Management

```bash
# List installed models
docker exec geosurgical-ollama ollama list

# Pull a model
docker exec geosurgical-ollama ollama pull qwen2.5:7b

# Remove a model
docker exec geosurgical-ollama ollama rm qwen2.5:7b
```

## Offline / Air-Gapped Deployment

1. On a machine with internet, pull the Ollama model: `ollama pull qwen2.5:7b`
2. Copy the Ollama data volume (`ollama_data`) to the target machine
3. Build the Docker image: `docker compose build`
4. Transfer the image: `docker save geosurgical-webgis:local | gzip > webgis.tar.gz`
5. On the target: `docker load < webgis.tar.gz && docker compose up -d`

## Standalone Deployment (No Docker)

```bash
npm install
VITE_BRAIN_MODE=llm VITE_LLM_ENDPOINT=http://your-ollama:11434 npm run build
# Serve the dist/ directory with any static file server
```

Make sure the Ollama instance is reachable from the client browser (CORS must allow the origin).
