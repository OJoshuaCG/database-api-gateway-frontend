#!/usr/bin/env bash
# Hook UserPromptSubmit — recuerda el protocolo de gestión de tareas en cada prompt.
#
# Lo ejecuta el harness, no el modelo: por eso el recordatorio no se puede "olvidar"
# ni diluir cuando el contexto se comprime en una sesión larga. Lo que salga por stdout
# se inyecta en el contexto del turno.
#
# Protocolo completo: skill `clickup-task-flow-frontend`. Detalle de las tareas: TODO.md.
#
# REGLA DE ORO: este hook NUNCA debe fallar ni bloquear el prompt. Sin `set -e`, y
# `exit 0` incondicional al final. Tampoco hace llamadas de red: corre en cada turno.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
CLAIM="$PROJECT_DIR/.claude/.tarea-actual"

if [ -f "$CLAIM" ]; then
    # Una sola línea, acotada: el archivo es local y editable a mano.
    EN_CURSO="$(tr -d '\r\n' < "$CLAIM" 2>/dev/null | cut -c1-200)"
    if [ -n "$EN_CURSO" ]; then
        printf '[protocolo de tareas] TAREA EN CURSO: %s\nAl terminar cerrala con `/tarea fin <ID>` (pone `complete` en ClickUp + comentario FIN y mueve el ítem a Realizadas en TODO.md). Si la abandonás a mitad, o si el backend no entrega lo que el handoff prometía, va a `on hold` con el motivo — nunca se deja en `in progress` y nunca se usa `update required`, que significa "falta el frontend".\n' "$EN_CURSO"
        exit 0
    fi
fi

printf '%s\n' '[protocolo de tareas] Ninguna tarea reclamada en este repo. Si lo que sigue es implementar, arreglar, verificar o refactorizar algo, primero invocá la skill `clickup-task-flow-frontend` (o `/tarea frontend` para ver los handoff pendientes, `/tarea <ID>` para reclamar) y validá en ClickUp que nadie más la esté haciendo. Responder preguntas, leer código o explicar cosas NO requiere reclamar tarea.'
exit 0
