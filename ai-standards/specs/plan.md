# Plan Técnico 001 — Plataforma Web B.L.A.Z.E v2

Basado en `docs/constitution.md` y `spec.md` (Spec 001). Solo el CÓMO: arquitectura y datos, sin código.

## Módulos

| Módulo | Responsabilidad |
|---|---|
| **Auth** | Login/registro con Supabase Auth; asocia cada usuario a una organización y un rol (`member` / `admin`). |
| **Organizations** | CRUD mínimo de organizaciones y su nivel de prioridad. Permite dar de alta grupos nuevos sin tocar código. |
| **Fleet** | Registro de impresoras del laboratorio y su estado (libre, imprimiendo, offline). |
| **MQTT Gateway** | Servicio local que habla MQTT con cada impresora (vía proxy TLS), mantiene el estado del fleet actualizado y ejecuta comandos de control. Es el único lugar que sabe si una impresora está libre. |
| **Queue Engine** | Calcula el orden de la cola (prioridad de organización + FIFO + overrides de admin) y decide qué trabajo se asigna cuando una impresora queda libre. |
| **Jobs** | Recibe archivos subidos, valida, persiste metadata, guarda el estado de cada trabajo. |
| **Notifications** | Genera y entrega avisos in-app (trabajo fallido, trabajo en lista de espera). |
| **Dashboard UI** | Monitoreo en tiempo real, control manual (pause/resume/stop), vista de cola, panel de reordenamiento para admin. |

## Modelo de datos

```
organizations
├─ id (uuid, PK)
├─ name
├─ priority_tier (int)     -- 1 = FrED-Factory, 2 = todos los demás
└─ created_at

user_profiles
├─ id (uuid, PK, = auth.users.id)
├─ email
├─ organization_id (FK → organizations)
├─ role ('member' | 'admin')
└─ created_at

printers
├─ id (serial, PK)
├─ serial_number
├─ name
├─ ip_address
├─ access_code
├─ status ('idle' | 'printing' | 'offline')
├─ last_seen_at
└─ created_at

jobs
├─ id (serial, PK)
├─ user_id (FK → user_profiles)
├─ organization_id (FK → organizations, denormalizado para ordenar sin join)
├─ printer_id (FK → printers, nullable hasta asignarse)
├─ file_name / file_path
├─ status ('queued' | 'waiting' | 'printing' | 'completed' | 'failed')
├─ manual_rank (int, nullable — override de un admin)
├─ failure_reason (nullable)
├─ created_at / started_at / finished_at

notifications
├─ id (serial, PK)
├─ user_id (FK → user_profiles)
├─ job_id (FK → jobs)
├─ type ('job_failed' | 'job_waiting')
├─ message
├─ read_at (nullable)
└─ created_at
```

El orden de la cola no se persiste como columna: se calcula en cada consulta a partir de `organization.priority_tier`, `jobs.created_at` (desempate FIFO) y `jobs.manual_rank` (si un admin lo fijó, manda sobre lo demás).

## Decisiones (con alternativa descartada)

1. **El estado del fleet y la asignación automática viven en un servicio Node local (extensión de `proxy.cjs`), no en el navegador.**
   Descartada: mantener el cliente MQTT solo en el navegador, como en el repo anterior. Se descarta porque la cola necesita asignar trabajos aunque nadie tenga una pestaña abierta; con MQTT solo en el navegador, la automatización se detendría al cerrar la pestaña.

2. **`organizations` es una tabla, no un enum fijo en código.**
   Descartada: lista fija de 3 organizaciones (como el repo anterior). Se descarta porque RF-9 pide una lista abierta, y un enum obligaría a tocar código cada vez que se sume un grupo nuevo.

3. **El orden de la cola se calcula dinámicamente en cada consulta.**
   Descartada: persistir un campo `queue_position` que se reescribe en cada cambio. Se descarta por el riesgo de inconsistencia si dos trabajos se insertan o reordenan casi al mismo tiempo; calcularlo al vuelo evita ese problema de concurrencia.

4. **Se mantiene Next.js con Pages Router**, igual que el repo de referencia.
   Descartada: migrar a App Router. Se descarta para esta iteración porque no aporta valor al alcance actual y permite reutilizar componentes existentes (Sidebar, Topbar, AddJobModal) casi sin cambios.

5. **Notificaciones in-app únicamente** (tabla `notifications` + Supabase Realtime o polling corto en el cliente).
   Descartada: envío por correo. Se descarta porque no hay proveedor de email configurado y el NFR de la spec ya limita esta iteración a in-app.

## Dependencias añadidas

- **`@supabase/supabase-js`**: cliente oficial para hablar con Supabase Auth desde el navegador (`AuthScreen`, T10). Es el módulo mínimo necesario para el módulo Auth ya definido en este plan; no hay alternativa sin dependencia razonable dado que Supabase es la elección de auth de la constitución.

## Estrategia de tests

| Test | Qué cubre |
|---|---|
| Unit: cálculo de orden de cola (tiers + FIFO + `manual_rank`) | RF-4, RF-13 |
| Unit: validación de archivo (extensión, tamaño) | RF-3 |
| Integración (MQTT mock): asignación automática al liberarse una impresora | RF-5 |
| Integración (MQTT mock): salto a la siguiente impresora libre si la asignada no responde | RF-6 |
| Integración (MQTT mock): impresora se desconecta a mitad de impresión → job fallido + notificación | RF-7 |
| Integración: cola sin impresoras libres → job en "waiting" + notificación | RF-10 |
| Integración: alta de una organización nueva y registro de un usuario en ella | RF-9 |
| E2E manual/Playwright: pause/resume/stop contra impresora mock | RF-1, RF-8 |
| E2E manual/Playwright: reordenamiento de un admin se refleja en la cola | RF-13 |
| UI: apartado de "ver cola" muestra posición, organización y estado | RF-12 |
| Persistencia: job guarda archivo, organización, impresora, estado y timestamps correctamente | RF-2, RF-11 |

## Cobertura de RF por módulo

- **Auth**: RF-9
- **Organizations**: RF-9
- **Fleet**: RF-1, RF-5, RF-6
- **MQTT Gateway**: RF-1, RF-5, RF-6, RF-7, RF-8
- **Queue Engine**: RF-4, RF-5, RF-6, RF-10, RF-13
- **Jobs**: RF-2, RF-3, RF-7, RF-10, RF-11
- **Notifications**: RF-7, RF-10
- **Dashboard UI**: RF-1, RF-8, RF-12, RF-13