# Build: compila la SPA a estáticos (dist/). Las variables VITE_* se incrustan
# en el bundle aquí, por lo que deben llegar como build args (Dokploy: "Build Args",
# no variables de entorno de runtime). Ver docs/dokploy.md.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_API_BASE_URL
ARG VITE_HEALTH_URL
ARG VITE_MAX_PAGE_SIZE
RUN pnpm build

# Runtime: sirve dist/ como estáticos con fallback SPA (ver nginx.conf).
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
