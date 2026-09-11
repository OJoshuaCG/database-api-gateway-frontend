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

# Runtime: sirve dist/ como estáticos con fallback SPA y proxea la API bajo el mismo origen
# (ver nginx.conf.template y docs/dokploy.md §3).
FROM nginx:alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html

# La plantilla la procesa el entrypoint de la imagen con `envsubst` al arrancar. El filtro la
# acota a las variables `API_*` para que `$uri`, `$host` y demás variables de nginx no se
# sustituyan por cadena vacía.
# Los DOS archivos van a `templates/`: el include también lleva una variable (`API_HOST_HEADER`),
# y `envsubst` sólo procesa lo que está en ese directorio. Dejarlo en `conf.d/` hace que nginx vea
# el `${...}` literal y aborte con `unknown "api_host_header" variable`.
# El entrypoint le quita el sufijo `.template` y lo escribe en `conf.d/`, así que el
# `include /etc/nginx/conf.d/upstream-headers.inc` de la plantilla principal lo encuentra.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY upstream-headers.inc.template /etc/nginx/templates/upstream-headers.inc.template
ENV NGINX_ENVSUBST_FILTER=^API_

# Dónde alcanzar al backend desde ESTE contenedor, por la red interna de Dokploy: esquema +
# host + puerto, sin barra final ni path. Se sobreescribe como variable de entorno de RUNTIME
# de la app en Dokploy — no como build arg.
ENV API_UPSTREAM=http://gateway-api:8000

# DNS con el que se resuelve ese host en cada request. `127.0.0.11` es el resolver embebido de
# Docker en redes definidas por el usuario, que es lo que crea Dokploy.
ENV API_RESOLVER=127.0.0.11

# Valor del header `Host` hacia el backend. `$host` (el dominio del frontend) es lo correcto
# cuando `API_UPSTREAM` es un nombre de servicio interno. Si `API_UPSTREAM` es la URL PÚBLICA del
# backend, hay que ponerle el host del backend o el proxy de Dokploy devuelve el request al
# frontend. Ver upstream-headers.inc.template.
# `\$host` escapado: sin la barra, Docker expandiría `$host` en build y lo dejaría vacío.
ENV API_HOST_HEADER=\$host

EXPOSE 80
