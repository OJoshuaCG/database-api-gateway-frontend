# Cabeceras comunes a todo lo que se proxea al backend. Vive en un archivo aparte porque
# repetirlas en cada `location` es exactamente como se desincronizan.

# El backend ve el host y el esquema que usó el NAVEGADOR, no los del contenedor. Importa por
# dos motivos concretos:
#  - La cookie de sesión es `Secure` en producción: sin `X-Forwarded-Proto` correcto, el backend
#    puede decidir mal si la emite.
#  - El guard de CSRF valida el header `Origin` contra `CORS_ORIGINS`. Ese origen es el del
#    navegador, así que `CORS_ORIGINS` tiene que listar el origen público de la SPA.
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;

proxy_http_version 1.1;

# Las exportaciones de bases pueden ser grandes y el dump lo genera el motor: el tope de cuerpo
# y los tiempos de espera los decide el backend, no este proxy.
client_max_body_size 0;
proxy_request_buffering off;
proxy_buffering off;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
