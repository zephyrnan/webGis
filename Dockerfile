# 第一阶段：使用 Node 镜像安装依赖并构建 Vite 前端产物。
FROM node:22-alpine AS build

WORKDIR /app

# 先复制依赖清单，让 Docker 可以缓存 npm ci 这一层。
COPY package.json package-lock.json ./
RUN npm ci

# 再复制项目源码，执行生产构建，输出到 /app/dist。
COPY . .
RUN npm run build

# 第二阶段：使用轻量 Nginx 镜像托管静态文件。
FROM nginx:1.27-alpine

# 覆盖默认站点配置，保证 React 路由、Worker 和 WASM 都能正常访问。
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# 容器内部监听 80 端口；宿主机端口由 docker-compose.yml 映射。
EXPOSE 80

# Docker Desktop 用这个接口判断容器是否健康。
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/healthz || exit 1

# 前台运行 Nginx，这是容器保持运行的主进程。
CMD ["nginx", "-g", "daemon off;"]
