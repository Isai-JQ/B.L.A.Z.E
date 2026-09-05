# Tareas 001 — Plataforma Web B.L.A.Z.E v2

Derivado de `plan.md` (Plan Técnico 001). Cada tarea es de menos de 30 min e incluye el/los RF que cubre y una línea "Hecho cuando:" verificable.

## Fase 0 — Setup del proyecto

- [ ] **T1.** Crear repo nuevo con Next.js (Pages Router) + TypeScript + Tailwind CSS, gestionado con pnpm.
  RF: — (infraestructura)
  Hecho cuando: `pnpm dev` levanta una página en blanco sin errores.

- [ ] **T2.** Crear proyecto en Supabase y archivo `.env.example` con las variables necesarias (`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_WS_PROXY_URL`).
  RF: — (infraestructura)
  Hecho cuando: `.env.example` existe en el repo y `.env` real está en `.gitignore`.

- [ ] **T3.** Configurar Drizzle ORM (`drizzle.config.ts`) apuntando al proyecto de Supabase.
  RF: — (infraestructura)
  Hecho cuando: `pnpm db:studio` conecta sin errores a la base de datos.

## Fase 1 — Modelo de datos

- [ ] **T4.** Definir tabla `organizations` (id, name, priority_tier) en el esquema Drizzle.
  RF: RF-9
  Hecho cuando: `pnpm db:push` crea la tabla y se puede insertar una fila de prueba.

- [ ] **T5.** Definir tabla `user_profiles` (id, email, organization_id, role) con FK a `organizations`.
  RF: RF-9
  Hecho cuando: `pnpm db:push` crea la tabla con la FK aplicada.

- [ ] **T6.** Definir tabla `printers` (id, serial_number, name, ip_address, access_code, status, last_seen_at).
  RF: RF-1, RF-5, RF-6
  Hecho cuando: `pnpm db:push` crea la tabla y admite los tres valores de `status`.

- [ ] **T7.** Definir tabla `jobs` (id, user_id, organization_id, printer_id, file_name, file_path, status, manual_rank, failure_reason, timestamps).
  RF: RF-2, RF-7, RF-10, RF-11, RF-13
  Hecho cuando: `pnpm db:push` crea la tabla con las FKs a `user_profiles`, `organizations` y `printers`.

- [ ] **T8.** Definir tabla `notifications` (id, user_id, job_id, type, message, read_at, created_at).
  RF: RF-7, RF-10
  Hecho cuando: `pnpm db:push` crea la tabla con las FKs correspondientes.

- [ ] **T9.** Sembrar (`seed`) las tres organizaciones conocidas (FrED-Factory tier 1, RoBorregos y VantTec tier 2).
  RF: RF-4, RF-9
  Hecho cuando: la tabla `organizations` tiene esas tres filas tras correr el script de seed.

## Fase 2 — Auth

- [ ] **T10.** Adaptar `AuthScreen.tsx` del repo anterior: login/registro con Supabase Auth.
  RF: RF-9
  Hecho cuando: un usuario nuevo puede registrarse e iniciar sesión.

- [ ] **T11.** Agregar selector de organización en el registro, con opción de escribir una organización nueva (lista abierta).
  RF: RF-9
  Hecho cuando: registrar un usuario con una organización no existente la crea automáticamente con `priority_tier` por defecto (2).

- [ ] **T11b.** Habilitar Row Level Security (RLS) en Supabase para `organizations` y `user_profiles`, con políticas mínimas: cualquier usuario autenticado puede leer `organizations`, pero solo insertar filas nuevas (no editar/borrar las existentes); cada usuario puede leer y actualizar su propia fila de `user_profiles`, nunca la de otro, y nunca su propio campo `role`.
  RF: RF-9
  Hecho cuando: con RLS activo, una llamada directa a la API de Supabase (no desde la UI) intentando leer el perfil de otro usuario o cambiar el propio `role` es rechazada.

- [ ] **T11c.** Envolver el script `db:push` (en `package.json`) para que, después de correr `drizzle-kit push`, siempre reaplique automáticamente las políticas RLS de `db/sql/001_auth_triggers.sql` (y cualquier archivo `db/sql/*.sql` que se agregue después). Nadie debe depender de acordarse de este paso a mano.
  RF: RF-9
  Hecho cuando: correr `pnpm db:push` una sola vez deja las políticas de `organizations` y `user_profiles` intactas y verificables, sin ningún paso manual adicional.

- [ ] **T12.** Asignar `role = 'member'` por defecto al registrarse; documentar cómo promover un usuario a `'admin'` manualmente (sin UI todavía).
  RF: RF-13
  Hecho cuando: existe al menos un usuario de prueba con `role = 'admin'` en la base de datos.

- [ ] **T13.** Middleware/guard: bloquear todas las páginas del dashboard a usuarios no autenticados.
  RF: RF-9
  Hecho cuando: acceder a `/` sin sesión redirige a la pantalla de login.

## Fase 3 — Fleet y MQTT Gateway

- [ ] **T14.** Extender `proxy.cjs` a un servicio Node persistente que, además de hacer de bridge WS↔TLS, mantiene en memoria el estado de cada impresora conectada.
  RF: RF-1, RF-5, RF-6
  Hecho cuando: el servicio corre de forma independiente y expone el estado de al menos una impresora simulada.

- [ ] **T15.** En el servicio, suscribirse a `device/{serial}/report` y actualizar `printers.status` / `last_seen_at` en la base de datos.
  RF: RF-1
  Hecho cuando: al simular un reporte MQTT, la fila de esa impresora en `printers` se actualiza.

- [ ] **T16.** Endpoint `/api/printers` para registrar una impresora nueva (serial, ip, access_code, name).
  RF: RF-1
  Hecho cuando: un POST válido crea la fila en `printers` y uno inválido devuelve error.

- [ ] **T17.** Chequeo periódico: marcar una impresora como `offline` si no llega un reporte dentro de un umbral de tiempo.
  RF: RF-6
  Hecho cuando: al dejar de simular reportes de una impresora, su `status` cambia a `offline` tras el umbral.

## Fase 4 — Jobs

- [ ] **T18.** Endpoint de subida de archivo con validación de extensión (`.gcode`/`.3mf`) y tamaño máximo.
  RF: RF-3
  Hecho cuando: un archivo válido se acepta y uno con extensión o tamaño incorrecto se rechaza con mensaje claro.

- [ ] **T19.** Al subir un archivo válido, crear la fila en `jobs` con `status = 'queued'` y la `organization_id` del usuario.
  RF: RF-2
  Hecho cuando: tras subir un archivo, aparece una fila nueva en `jobs` con los datos correctos.

- [ ] **T20.** Guardar el archivo subido en almacenamiento (carpeta local o Supabase Storage) y enlazarlo en `jobs.file_path`.
  RF: RF-2, RF-11
  Hecho cuando: el archivo subido es recuperable a partir de `file_path`.

## Fase 5 — Queue Engine

- [ ] **T21.** Función pura que, dado un conjunto de jobs, calcula el orden de la cola (tier de organización → FIFO por `created_at` → `manual_rank` si existe).
  RF: RF-4, RF-13
  Hecho cuando: dado un set de jobs de prueba con tiers y timestamps distintos, la función devuelve el orden esperado.

- [ ] **T22.** Al liberarse una impresora (status pasa a `idle`), tomar el primer job de la cola calculada y asignarlo (`printer_id`, `status = 'assigned'`).
  RF: RF-5
  Hecho cuando: al simular que una impresora queda libre con jobs en cola, el primero se asigna automáticamente.

- [ ] **T23.** Si la impresora asignada está `offline` al momento de enviar el trabajo, reintentar con la siguiente impresora libre del fleet.
  RF: RF-6
  Hecho cuando: simulando una impresora offline al momento de asignar, el job termina asignado a otra impresora libre.

- [ ] **T24.** Si una impresora se desconecta mientras un job tiene `status = 'printing'`, marcar el job como `failed` y crear una notificación.
  RF: RF-7
  Hecho cuando: al simular la desconexión de una impresora con un job en curso, el job pasa a `failed` y aparece una fila en `notifications`.

- [ ] **T25.** Si no hay ninguna impresora libre al encolar un job, dejarlo en `status = 'waiting'` y crear una notificación de "en lista de espera".
  RF: RF-10
  Hecho cuando: con todas las impresoras ocupadas/offline, un job nuevo queda en `waiting` y genera una notificación.

- [ ] **T26.** Endpoint para que un admin fije `manual_rank` en uno o más jobs, y que el cálculo de la cola lo respete.
  RF: RF-13
  Hecho cuando: un usuario con `role = 'admin'` puede cambiar el orden de dos jobs y la cola calculada refleja el cambio; un usuario `member` recibe error al intentarlo.

## Fase 6 — Control de impresión

- [ ] **T27.** Endpoints/comandos para pausar, reanudar y detener un job en curso, enviados vía MQTT a la impresora asignada.
  RF: RF-8
  Hecho cuando: cada comando, al ejecutarse contra una impresora simulada, dispara el mensaje MQTT correspondiente en `device/{serial}/request`.

## Fase 7 — Notificaciones

- [ ] **T28.** Endpoint/lectura de notificaciones por usuario (listar, marcar como leídas).
  RF: RF-7, RF-10
  Hecho cuando: un usuario puede obtener sus notificaciones no leídas vía API.

- [ ] **T29.** Suscripción en el cliente (Supabase Realtime o polling corto) para mostrar notificaciones nuevas sin recargar la página.
  RF: RF-7, RF-10
  Hecho cuando: al crear una notificación en la base de datos, aparece en la interfaz sin recargar.

## Fase 8 — Dashboard UI

- [ ] **T30.** Adaptar `Topbar`, `Sidebar`, `MetricsRow` y `PrinterDetail` del repo anterior para mostrar el estado en tiempo real del fleet.
  RF: RF-1
  Hecho cuando: la interfaz muestra temperatura, progreso y estado de al menos una impresora simulada, actualizándose sola.

- [ ] **T31.** Adaptar `AddJobModal` para subir un archivo con feedback visual de validación (aceptado/rechazado).
  RF: RF-3
  Hecho cuando: subir un archivo inválido muestra el mensaje de error en la UI, sin recargar la página.

- [ ] **T32.** Nueva vista "Cola" que lista los jobs actuales con su posición, organización y estado.
  RF: RF-12
  Hecho cuando: cualquier usuario autenticado puede ver la lista completa de jobs en cola, en el orden correcto.

- [ ] **T33.** Controles de reordenamiento manual visibles solo para `role = 'admin'` en la vista de cola.
  RF: RF-13
  Hecho cuando: un admin puede mover un job hacia arriba/abajo en la UI y el cambio persiste al recargar.

- [ ] **T34.** Componente de notificaciones (badge + lista desplegable) conectado a T29.
  RF: RF-7, RF-10
  Hecho cuando: una notificación nueva incrementa el badge y se puede marcar como leída desde la UI.

- [ ] **T35.** Botones de pausar/reanudar/detener en `PrinterDetail`, conectados a los endpoints de T27.
  RF: RF-1, RF-8
  Hecho cuando: presionar cada botón contra una impresora simulada dispara el comando correcto y la UI refleja el nuevo estado.

## Fase 9 — Tests formales

- [ ] **T36.** Tests unitarios de la función de orden de cola (T21): tiers, desempate FIFO y `manual_rank`.
  RF: RF-4, RF-13
  Hecho cuando: la suite de tests corre en verde para al menos 3 escenarios distintos.

- [ ] **T37.** Tests unitarios de validación de archivo (T18): extensión y tamaño.
  RF: RF-3
  Hecho cuando: la suite cubre casos válidos e inválidos y corre en verde.

- [ ] **T38.** Tests de integración con MQTT mock: asignación automática (T22) y fallback a otra impresora (T23).
  RF: RF-5, RF-6
  Hecho cuando: ambos escenarios simulados pasan en verde.

- [ ] **T39.** Test de integración: desconexión a mitad de impresión (T24) y cola sin impresoras libres (T25).
  RF: RF-7, RF-10
  Hecho cuando: ambos escenarios simulados pasan en verde, incluyendo la notificación generada.

- [ ] **T40.** Test de integración: alta de una organización nueva al registrarse (T11).
  RF: RF-9
  Hecho cuando: el test crea una organización nueva vía registro y verifica su `priority_tier` por defecto.

- [ ] **T41.** Test E2E (manual o Playwright) del flujo completo: login, subir job, ver estado en tiempo real, pausar/reanudar/detener.
  RF: RF-1, RF-8
  Hecho cuando: el flujo se completa sin errores contra al menos una impresora real o simulada.

- [ ] **T42.** Test E2E (manual o Playwright) del reordenamiento de admin reflejado en la vista de cola (T33).
  RF: RF-13
  Hecho cuando: el nuevo orden fijado por el admin se ve igual en la UI y en la base de datos.

## Decisiones

Decisiones de implementación (el *cómo*; el alcance sigue viviendo en la spec).

- **T20 — dónde se guarda el archivo subido: Supabase Storage, bucket privado `print-files` (`public = false`).**
  El endpoint de subida (`pages/api/jobs/upload.ts`) escribe los bytes con la service-role key —cliente solo-servidor en `lib/supabaseAdmin.ts`— y guarda `"<bucket>/<key>"` en `jobs.file_path`, reemplazando el sentinel `pending://T20-not-implemented` que dejaba T19. El archivo se recupera con `supabaseAdmin().storage.from(bucket).download(key)`. El bucket lo crea `db/sql/002_storage_bucket.sql` (se reaplica solo con `pnpm db:push`).
  - Alternativa descartada: guardar el archivo en el disco local del servidor (p. ej. `./uploads/`). Descartada porque no sobrevive a redeploys (el filesystem del contenedor es efímero) ni escala a múltiples instancias (cada réplica solo vería sus propios archivos).
  - El límite de tamaño se aplica sobre los bytes reales mientras se leen (`readCappedBody`), sin confiar en el `Content-Length` declarado (ver nota de T18): si el stream supera `MAX_UPLOAD_BYTES` se corta la subida, no se escribe en Storage y no se crea ninguna fila en `jobs`.

## Dependencias

Justificación de cada dependencia añadida fuera del scaffold inicial (constitución, regla 10).

- **`ws`** (T14) — servidor WebSocket del gateway (`proxy.cjs`). Node no trae servidor WS (solo cliente, desde v22), y el bridge WS↔TLS es la única forma de que el navegador hable MQTT con la impresora. Misma librería que usaba `proxy.cjs` en `Automatize-3D-printers`.
- **`mqtt`** (T14) — cliente MQTT del gateway contra la impresora (`mqtts://<ip>:8883`). El servicio necesita su propia sesión MQTT para mantener el estado del fleet en memoria aunque no haya ningún navegador abierto; implementar MQTT 3.1.1 a mano no se justifica. Ya era dependencia del repo de referencia.
