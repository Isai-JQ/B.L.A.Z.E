# AGENTS.md — B.L.A.Z.E v2 (Plataforma Web)

## Proyecto
Plataforma web de B.L.A.Z.E v2 para monitorear y controlar un fleet de impresoras Bambu Lab P1S, con una cola de prioridad automática por organización. Next.js (Pages Router) + TypeScript + Tailwind CSS en el frontend; Supabase (Auth + Postgres) vía Drizzle ORM para persistencia; un servicio Node local, extensión de `proxy.cjs`, habla MQTT con las impresoras y corre la lógica de asignación de la cola.

## Comandos
- Ejecutar: `pnpm dev` (dashboard) + `node proxy.cjs <printer-ip> <access-code>` (gateway MQTT, en otra terminal)
- Tests: `pnpm test`
- Lint/formato: `pnpm lint`
- Base de datos: `pnpm db:push` / `pnpm db:studio`

## Estilo y convenciones
- TypeScript, Next.js con Pages Router (no App Router).
- Identificadores y comentarios de código en inglés; documentación de proyecto en español.
- Al adaptar componentes del repo de referencia, revisarlos y ajustarlos al modelo de datos nuevo, no copiarlos tal cual.

## Reglas
- Lee `ai-standards/constitution.md` y la spec activa (`ai-standards/specs/spec.md`) antes de tocar código.
- No modificar firmware ni hardware de las impresoras Bambu Lab.
- No depender de la Raspberry Pi todavía: la comunicación con impresoras es directa vía IP + access code.
- Este proyecto parte del código y las lecciones de `Automatize-3D-printers` (https://github.com/FrED-Factory-MTY/Automatize-3D-printers). No se depende de una ruta local fija a ese repo: si hace falta revisar el código original, clónalo aparte donde te convenga. Los componentes específicos a rescatar y adaptar (ej. `useMqtt`, `proxy.cjs`, `AuthScreen.tsx`) ya están listados en `plan.md` y `tasks.md`.
- Ninguna credencial (access code, claves Supabase) se commitea; solo vive en `.env`.
- Ninguna dependencia nueva sin justificarla en `plan.md`.
- Cualquier cambio de alcance se refleja primero en la spec, nunca directo en código.
- Nunca se trabaja directo sobre `main`. Cada feature o fix va en su propia branch (ej. `feature/T22-auto-asignacion`, `fix/validacion-archivo`) y se mergea a `main` vía pull request, para mantener `main` siempre limpio y desplegable.

## Al terminar cualquier tarea
- Correr `pnpm test` y `pnpm lint`. Marcar la tarea de `tasks.md` como hecha solo si ambos pasan.