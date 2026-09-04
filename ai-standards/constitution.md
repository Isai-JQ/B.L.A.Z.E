# Constitución — B.L.A.Z.E v2

1. Stack: Next.js + TypeScript + Tailwind CSS, gestionado con pnpm.
2. Persistencia y auth: Supabase (Postgres + Auth) vía Drizzle ORM.
3. Comunicación con impresoras (fase web): mqtt.js en el navegador + proxy local WS↔TLS; sin depender de Raspberry Pi hasta que llegue el hardware.
4. Cero modificación de firmware o hardware de las impresoras Bambu Lab.
5. Repositorio nuevo para B.L.A.Z.E v2; se reutiliza código de `Automatize-3D-printers` como referencia, pero no se continúa trabajando sobre ese repo. Lo descartado se justifica en `plan.md`.
6. Identificadores y comentarios de código en inglés; documentación de proyecto en español.
7. Ninguna credencial (access code, claves Supabase) se commitea: solo vive en `.env`, ignorado por git.
8. Toda ruta de API y todo hook crítico (ej. `useMqtt`) lleva al menos un test antes de mergear a `main`.
9. Autenticación multi-organización (FrED-Factory, RoBorregos, VantTec) se mantiene igual que en el repo anterior.
10. Ninguna dependencia nueva se añade sin justificarla en `plan.md`.
11. Cualquier cambio de alcance se refleja primero en la spec activa, nunca directo en código.