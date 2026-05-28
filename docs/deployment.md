# 部署指南

## 安全模型

GeoSurgical WebGIS 是一个**纯前端应用**，没有后端服务器。所有 `VITE_*` 环境变量都会在构建时注入浏览器 JavaScript。

**生产规则**：不要在生产前端构建中使用远程 API key（OpenAI、DeepSeek、SiliconFlow 等）。生产环境应使用同一网络中的**本地 Ollama**，或使用后端代理把 API key 保留在服务端。

## 快速开始（Docker Compose）

仓库内的 `docker-compose.yml` 会同时运行 WebGIS 应用和 Ollama 服务：

```bash
# 首次使用时先拉取模型
docker compose up -d ollama
docker exec geosurgical-ollama ollama pull qwen2.5:7b

# 构建并启动全部服务
docker compose up --build
```

打开 `http://localhost:8080` 查看应用。

## Docker 服务

| 服务 | 容器 | 端口 | 用途 |
| --- | --- | --- | --- |
| `webgis` | `geosurgical-webgis` | 8080 → 80 | Nginx 托管 Vite 构建产物 |
| `ollama` | `geosurgical-ollama` | 11434 | 本地 LLM 推理服务 |

## 构建时变量

Vite 会在**构建时**注入 `VITE_*` 变量，而不是运行时读取。修改 LLM 设置后需要重新构建：

```bash
# 切换到 mock 模式（不需要 Ollama）
VITE_BRAIN_MODE=mock docker compose up --build

# 使用不同模型
VITE_LLM_MODEL=llama3:8b docker compose up --build
```

## 环境变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_BRAIN_MODE` | 自动 | `mock` 或 `llm`。根据 endpoint 自动判断。 |
| `VITE_LLM_ENDPOINT` | `http://localhost:11434` | 生产/私有化部署推荐的 Ollama API URL。Docker 内使用 `http://ollama:11434`。开发环境也可以指向 OpenAI-compatible endpoint，但生产应使用本地 Ollama 或后端代理。 |
| `VITE_LLM_MODEL` | `qwen2.5:7b` | Ollama 使用的模型名。 |
| `WEBGIS_PORT` | `8080` | WebGIS 容器暴露到宿主机的端口。 |
| `OLLAMA_PORT` | `11434` | Ollama API 暴露到宿主机的端口。 |

## Ollama 模型管理

```bash
# 查看已安装模型
docker exec geosurgical-ollama ollama list

# 拉取模型
docker exec geosurgical-ollama ollama pull qwen2.5:7b

# 删除模型
docker exec geosurgical-ollama ollama rm qwen2.5:7b
```

## 离线 / 内网部署

1. 在有网络的机器上拉取 Ollama 模型：`ollama pull qwen2.5:7b`
2. 将 Ollama 数据卷（`ollama_data`）复制到目标机器
3. 构建 Docker 镜像：`docker compose build`
4. 导出镜像：`docker save geosurgical-webgis:local | gzip > webgis.tar.gz`
5. 在目标机器加载并启动：`docker load < webgis.tar.gz && docker compose up -d`

## 不使用 Docker 的独立部署

```bash
npm install
VITE_BRAIN_MODE=llm VITE_LLM_ENDPOINT=http://your-ollama:11434 npm run build
# 使用任意静态文件服务器托管 dist/ 目录
```

确保 Ollama 实例能被客户端浏览器访问，并且 CORS 允许当前页面来源。
