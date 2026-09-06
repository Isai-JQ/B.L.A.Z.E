# Spec 001 — Plataforma Web B.L.A.Z.E v2 (Dashboard + Cola de Prioridad)

## Contexto y objetivo
Mientras se espera el CAD y la llegada de la Raspberry Pi y demás hardware, el equipo puede adelantar la plataforma web que después se conectará a la Raspberry Pi. Esta primera iteración conecta directo con cada impresora Bambu Lab (IP + access code, vía MQTT y un proxy local WS↔TLS), sin depender todavía de la Raspberry Pi ni de la lógica de expulsión/sensores. Cubre el dashboard de monitoreo y control que ya existía, y la cola de prioridad, que es funcionalidad nueva de B.L.A.Z.E v2.

## Usuarios / actores
- Estudiantes de FrED-Factory, RoBorregos, VantTec y cualquier otro grupo estudiantil habilitado, autenticados con correo institucional.
- Usuarios con permisos para operar impresoras (pausar/reanudar/detener trabajos en curso).
- Administradores: personal de FrED-Factory encargado de administrar las impresoras, con permiso para reordenar manualmente la cola completa, sin importar la organización de cada trabajo.

## Historias de usuario
- H1: Como estudiante de un grupo habilitado, quiero subir un archivo de impresión para que se encole y se imprima sin que yo tenga que elegir manualmente una impresora.
- H2: Como estudiante, quiero ver el estado en tiempo real de las impresoras del fleet (temperaturas, progreso, tiempo restante) para saber cuándo estará lista mi pieza.
- H3: Como usuario con permisos, quiero pausar, reanudar o detener un trabajo en curso para intervenir si algo sale mal.
- H4: Como miembro de FrED-Factory, quiero que mis trabajos tengan prioridad sobre los de otros grupos para aprovechar que la plataforma es del laboratorio.
- H5: Como administrador, quiero poder reordenar manualmente la cola en casos excepcionales que la prioridad automática no resuelve bien.
- H6: Como estudiante, quiero ver la lista de trabajos en cola (los míos y los de otros) para saber cuánto voy a esperar.

## Requisitos funcionales (criterios de aceptación en EARS)
- RF-1: EL SISTEMA mostrará el estado en tiempo real de cada impresora del fleet (temperatura de nozzle/cama/cámara, progreso, capa actual, tiempo restante, estado g-code, filamento AMS) recibido vía MQTT.
- RF-2: CUANDO un usuario autenticado suba un archivo de trabajo, EL SISTEMA lo encolará asignándole la prioridad correspondiente a la organización del usuario.
- RF-3: SI el archivo subido no tiene extensión `.gcode` o `.3mf`, o excede el tamaño máximo permitido, ENTONCES EL SISTEMA rechazará la subida con un mensaje de error claro antes de encolarlo.
- RF-4: EL SISTEMA ordenará la cola por prioridad de organización: FrED-Factory tiene el nivel más alto; RoBorregos, VantTec y cualquier otro grupo estudiantil comparten el mismo nivel de prioridad, sin distinción entre ellos. Dentro de un mismo nivel de prioridad, EL SISTEMA usará el orden de llegada (FIFO) como criterio de desempate.
- RF-5: CUANDO una impresora del fleet quede libre, EL SISTEMA asignará automáticamente el trabajo de mayor prioridad en la cola a esa impresora.
- RF-6: SI la impresora asignada a un trabajo está offline o no responde al momento del envío, ENTONCES EL SISTEMA probará automáticamente con la siguiente impresora libre del fleet.
- RF-7: SI la impresora asignada a un trabajo se desconecta mientras la impresión ya está en curso, ENTONCES EL SISTEMA marcará el trabajo como fallido y emitirá una notificación al usuario que lo envió.
- RF-8: CUANDO el dueño de un trabajo en curso, o un administrador, solicite pausarlo, reanudarlo o detenerlo, EL SISTEMA enviará el comando correspondiente vía MQTT a la impresora asignada. Cualquier otro usuario recibe un error de permisos.
- RF-9: EL SISTEMA restringirá el acceso a usuarios autenticados cuyo correo pertenezca a una organización registrada; el conjunto de organizaciones es abierto, se pueden agregar nuevas sin cambios de código.
- RF-10: MIENTRAS un trabajo espere porque ninguna impresora del fleet está libre, EL SISTEMA lo marcará como "en lista de espera" y notificará ese estado al usuario que lo envió.
- RF-11: EL SISTEMA persistirá cada trabajo (archivo, organización, prioridad, impresora asignada, estado, timestamps) para consulta posterior.
- RF-12: EL SISTEMA proveerá un apartado donde cualquier usuario autenticado pueda consultar los trabajos actualmente en la cola (posición, organización que lo envió, estado).
- RF-13: CUANDO un administrador de las impresoras de FrED-Factory reordene manualmente la cola, EL SISTEMA aplicará ese nuevo orden por encima de la prioridad automática para los trabajos afectados, sin importar la organización a la que pertenezca cada trabajo.

## Requisitos no funcionales
- Ninguna credencial (access code de impresora, claves Supabase) se expone en el cliente; solo vive en variables de entorno del servidor.
- Las actualizaciones de estado de impresora deben reflejarse en la interfaz con baja latencia perceptible (referencia: <2s).
- Las notificaciones de esta iteración son in-app (banner/indicador en la interfaz); no se define un canal externo (email, etc.) todavía.
- Interfaz en español; código (identificadores, comentarios) en inglés.
- Debe funcionar en navegador de escritorio moderno (Chrome/Firefox) sin instalación adicional del lado del usuario.

## Casos límite
- Se sube un archivo con el mismo nombre que uno ya en cola.
- El proxy MQTT pierde conexión con el navegador (sin que la impresora en sí esté afectada) y necesita reconectar sin alterar los trabajos en curso.
- Un administrador reordena la cola justo cuando el sistema está a punto de asignar automáticamente el siguiente trabajo (condición de carrera entre reordenamiento manual y asignación automática).

## Fuera de alcance
- Integración con Raspberry Pi (orquestación MQTT vía Pi 5, GPIO, lectura de sensores).
- Expulsión pasiva de piezas por movimiento del eje Z y confirmación de cama despejada (IR + limit switches).
- Cualquier modificación de firmware o hardware de las impresoras Bambu Lab.

## Criterios de finalización
- Todos los RF (RF-1 a RF-13) con al menos un test en verde.
- Demo manual: login multi-organización (incluyendo un grupo fuera de los tres conocidos), subida de un archivo válido y uno inválido, verificación de que la cola respeta FrED-Factory por encima de RoBorregos/VantTec/otros (estos empatados entre sí, desempatados por orden de llegada), asignación automática a la primera impresora libre, salto automático a otra impresora si la asignada está offline, notificación de trabajo fallido si la impresora se desconecta a mitad de impresión, notificación de "en lista de espera" cuando no hay impresoras libres, vista de cola visible para cualquier usuario, reordenamiento manual exitoso por parte de un administrador, monitoreo en tiempo real y control manual (pause/resume/stop) funcionando contra al menos una impresora física.

## Dudas abiertas
Ninguna por el momento. Todas las dudas de la primera versión (desempate, organizaciones, desconexión a mitad de impresión, cola llena, alcance del rol admin) quedaron resueltas arriba.