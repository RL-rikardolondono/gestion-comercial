# Agente-IA

Un producto de SkyNet Genesis · contacto@skynetgenesis.com · WhatsApp 304 437 5758

**Agente-IA es un agente de atención al cliente que trabaja para cada empresa, todos los días.** Su asistente, **SofIA** (cada empresa puede cambiarle el nombre), acompaña al cliente en todo el camino:

1. **Atiende** a quien escribe por la página web, Instagram, Facebook (Messenger), correo o formularios, a cualquier hora.
2. **Hace seguimiento** a los interesados hasta que compran (o dicen que no), con citas y un tablero de prospectos.
3. **Posventa:** cuando la persona compra pasa a *Clientes activos*. SofIA le pregunta cómo le fue a los 3 días, al mes, a los 6 meses y al año, y mide la satisfacción de 1 a 5.
4. **Fidelización:** felicita al cliente en su cumpleaños, en el de sus familiares (solo con autorización, Ley 1581) y en el aniversario de la compra.
5. **Soporte:** si un cliente reporta un problema, SofIA abre un caso, le avisa a una persona del equipo y alerta si el caso lleva días sin resolverse o si el cliente está en riesgo de irse.

Módulo de pago del Market: **SofIA con inteligencia artificial** (planes Profesional y Empresarial, después del primer pago). SofIA siempre responde primero con las reglas, sin costo; la IA solo entra cuando las reglas no saben la respuesta y la empresa tiene un paquete:

| Paquete (30 días) | Precio | Plan en el firmador Bold |
|---|---|---|
| 500 respuestas | $59.000 | `agente-ia:ia500` |
| 2.000 respuestas | $179.000 | `agente-ia:ia2000` |
| 6.000 respuestas | $449.000 | `agente-ia:ia6000` |

Para que nunca haya pérdidas, el servidor pone cinco topes: 1 crédito por respuesta con IA; tope de gasto por empresa del 45 % de lo que pagó; tope mensual de toda la plataforma (`AI_TOPE_USD_MES`, US$40); máximo 25 respuestas con IA por conversación al día; y sin créditos, sin plan, vencido o en la demostración, SofIA vuelve a las reglas. Los precios se calcularon con el modelo más caro posible (Haiku 4.5: US$1/US$5 por millón de tokens, dólar a $4.300) más la comisión de Bold; con Haiku 5.5 el costo real es unas 10 veces menor. Revisar los precios cada mes (directiva).

Módulo de pago del Market: **Asesor con IA para su página web** (basado en Dayana, de poliandes.com). En el chat de la página de la empresa, SofIA responde CADA mensaje con IA (usa los mismos paquetes y topes): lee la página web de la empresa (hasta 8 direcciones; se relee cada lunes y con «Leer la página ahora»), las Notas del asesor y la Base de conocimiento; lleva al visitante a comprar y no deja ir ningún contacto (pide nombre y celular con autorización Ley 1581). Solo responde en los dominios que registre la empresa; las tarjetas y claves que escriba un visitante se ocultan (no se guardan ni van a la IA); la lectura de páginas solo acepta direcciones públicas de internet. El texto que va a la IA tiene tope (≈7.000 letras de la página) para que cada respuesta cueste menos del 45 % de lo pagado (≈$20-30 por respuesta con Haiku 4.5). Panel con interesados, preguntas sin respuesta y resumen diario por correo. Sin paquete, el chat sigue con las respuestas automáticas.

Módulo opcional: **Recordatorios de pago** a los clientes de la empresa (apagado por defecto; respeta la Ley 2300).

Los mensajes de posventa también respetan la Ley 2300: nunca se envían los domingos ni los festivos, y los sábados solo de 8 a. m. a 3 p. m. Va un mensaje al día como máximo por cliente, y si hay un caso abierto no se envían saludos.

**Sin inteligencia artificial y con servicios gratuitos.** El asistente responde por reglas: palabras clave, la Base de conocimiento, un menú de opciones y la agenda. No hay costo por mensaje.

## Cómo queda funcionando (todo en planes gratuitos)

| Parte | Dónde | Costo |
|---|---|---|
| La aplicación (pantallas) | GitHub Pages · `comercial.skynetgenesis.com` | Gratis |
| El servidor | Render, plan gratuito · `api-comercial.skynetgenesis.com` | Gratis |
| La base de datos | Neon, plan gratuito | Gratis |
| Despertador del servidor | cron-job.org | Gratis |
| Correos (resúmenes, mensualidades) | Brevo, 300 correos al día | Gratis |
| Subdominios | SiteGround (dos registros DNS) | Ya lo tiene |

### Límites de los planes gratuitos y cómo se cuidan

- **Render gratis**: 750 horas al mes por espacio de trabajo y se duerme a los 15 minutos sin uso.
  - El despertador lo llama cada 10 minutos las 24 horas (máximo 744 horas al mes). Por eso Agente-IA debe estar solo en su espacio de trabajo de Render.
  - **Importante:** si SkyNet está en el mismo espacio de trabajo de Render, comparten las 750 horas. Cree un espacio de trabajo aparte para Agente-IA.
- **Neon gratis**: 100 horas de cómputo al mes y 1 GB de datos. Se duerme a los 5 minutos sin uso.
  - El servidor responde desde su memoria las revisiones que la app hace cada pocos segundos, y solo consulta la base cuando algo cambió o hay algo por enviar.
  - Revise el consumo en neon.tech › Usage. Si se acerca al límite, el plan pago de Neon se cobra por uso.

## Puesta en marcha (una sola vez)

1. **GitHub**: crear el repositorio `gestion-comercial` y subir esta carpeta. En Configuración › Pages: rama `main`, carpeta `/docs`, dominio `comercial.skynetgenesis.com`.
2. **Neon** (neon.tech): crear el proyecto `gestion-comercial` en la región de EE. UU. (Ohio). Copiar la cadena de conexión **con "pooler"**.
3. **Render**: New › Blueprint › elegir el repositorio (lee `render.yaml`). Llenar:
   - `DATABASE_URL`: la cadena de Neon.
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD`: la cuenta del Superadministrador, `superadmin.agente@skynetgenesis.com` (directiva: cada app tiene su propio correo; si la variable queda con el correo viejo `superadmin@`, se ignora y la cuenta existente cambia de correo conservando su contraseña).
   - `BREVO_API_KEY`: la clave de la cuenta Brevo de SkyNet Genesis, para enviar correos (avisos de pago, resúmenes, recordatorios). El remitente es el buzón propio sofia@skynetgenesis.com (créelo en SiteGround › Correo y verifíquelo en Brevo como remitente).
   - `DEMO_PASSWORD` (opcional): crea la cuenta demo@skynetgenesis.com.
4. **Render › Settings › Custom Domains**: agregar `api-comercial.skynetgenesis.com`.
5. **SiteGround › DNS**: dos registros CNAME:
   - `comercial` → `<su-usuario>.github.io`
   - `api-comercial` → la dirección `.onrender.com` que muestra Render
6. **cron-job.org**: crear la tarea:
   - Dirección: `https://api-comercial.skynetgenesis.com/api/cron?key=<CRON_SECRET>`. El valor de `CRON_SECRET` está en Render › Environment.
   - Cada 10 minutos, **todo el día** (las 24 horas), zona horaria America/Bogota. Agente-IA tiene su propio espacio de trabajo en Render, así que le alcanzan las 750 horas gratis del mes (un mes tiene como máximo 744). Si el servidor se duerme, Render responde con una página de «cargando» que cron-job.org rechaza y el despertador se desactiva solo.
7. Entrar a `https://comercial.skynetgenesis.com` con el correo y la contraseña del paso 3.

## Cobro de las mensualidades (regla de SkyNet Genesis)

- **Solo con Bold de SkyNet Genesis**, mes a mes (tarjeta, PSE, Nequi, llave Bre-B por la pasarela). No hay llave propia, ni «Ya pagué», ni comprobantes, ni configuración inicial.
- Empresa nueva: **15 días de prueba gratis** sin renovación; cada mañana el administrador recibe un correo con los días que le quedan. Si al terminar no ha pagado, el acceso se cierra solo.
- **Pagado hasta** queda siempre a fin de mes. Si el día 5 del mes siguiente no ha pagado, el **servidor** cierra el acceso (sin aviso previo ni multa) y el asistente deja de responder. Al pagar se reabre en el momento en que Bold confirma, pagando desde el mes en curso (no se cobran los meses cerrados).
- **Primer pago:** el resto del mes va gratis (si paga del 1 al 5, cubre solo ese mes). Si paga durante la prueba, cuenta desde el día siguiente al fin de la prueba.
- Cómo funciona: la app pide la firma al firmador central (`skynetgenesis.com/bold-firma.php`) con el plan de la empresa (`agente-ia:basico|pro|empresarial`, o `agente-ia:paq_empresarial_sede-xN` con N sedes adicionales); Bold avisa al receptor central, que llama a `POST /api/bold/aplicar` de este servidor. El servidor confirma cada pago con `bold-verificar.php` y lo aplica una sola vez. Al volver de la pasarela, `GET /api/bold/volver` sirve de respaldo.
- Nadie regala meses: «Pagado hasta», la prueba y el número de sedes solo los cambia el servidor. Si un pago no cuadra queda en **Mensualidades › Pagos con Bold** para revisar; si Bold aprobó un pago que no llegó, se aplica con su número de transacción (el sistema lo confirma con Bold).
- **Falta para publicar (lo hace usted, guiado):** agregar a `$PLANES` de `bold-firma.php` los planes `agente-ia:basico` 190000, `agente-ia:pro` 390000, `agente-ia:empresarial` 790000, `agente-ia:sede` 150000, `agente-ia:ia500` 59000, `agente-ia:ia2000` 179000, `agente-ia:ia6000` 449000 y `agente-ia:prueba` 1000; crear `bold-app-agente-ia.php` (tipo "url" → `https://<servidor>/api/bold/aplicar`, sin secreto); hacer un pago real de prueba de $1.000 desde **Mensualidades › Pago de prueba de $1.000**.

## Años de servicio (lo que hace solo el servidor)

- **Mensualidades:** se generan solas el día 1 de cada mes para cada empresa activa (si ya pagó por adelantado, no se le cobra). Un pago que sobra queda como **saldo a favor** y se descuenta en la siguiente mensualidad.
- **Archivo:** los prospectos con más de 6 meses sin actividad (3 meses si ya se ganaron o perdieron), los cobros pagados con más de un año y las citas viejas salen de la vista diaria para que la app siga rápida. No se pierden: se descargan con el botón **Archivados (CSV)**, y si el cliente vuelve a escribir, su historial se recupera solo.
- **Limpieza:** los comprobantes de pago se borran del servidor al confirmarlos o rechazarlos; la bitácora guarda 90 días y los registros de pagos 2 años.
- Se probó con una simulación de 3 años (`node server/simular.js`, solo con una base de datos local): 4 empresas, casi 17.000 conversaciones, cobros, moras y cierres, sin errores. La base creció unos 45 MB y la app abre en menos de 4 segundos.

## Recuperar la contraseña

En la pantalla de ingreso, «¿Olvidó su contraseña?» envía un enlace al correo (vale 1 hora). Requiere Brevo configurado.

Las cuentas del dueño (el Superadministrador, contacto@skynetgenesis.com, poliandes@poliandes.com, anglo@anglocolombiano.com, contacto@reinaelizabeth.com y las que se agreguen en la variable `DUENO_CUENTAS`) reciben el enlace directo en rikardolondono@gmail.com, con la cuenta y la empresa en el mensaje.

## Cuentas y accesos (Superadministrador)

Pantalla «🔐 Cuentas y accesos»: empresa, persona, correo, perfil, si ya creó su contraseña y su último ingreso; buscador, CSV, «Enviar enlace» y «Bloquear» con motivo (el bloqueo queda por correo, así que sigue aunque la empresa borre el usuario y lo vuelva a crear). Las contraseñas están cifradas y nadie puede verlas (Ley 1581).

En «Mis clientes», «Hacer interna» deja una empresa propia de SkyNet Genesis (POLIANDES, Clínica Reina Elizabeth, Anglocolombiano, SkyNet Genesis) activa siempre, sin prueba ni cobros; no puede pagar ni comprar paquetes. Queda en la bitácora con su motivo.

## Cuenta demo

En Render › Environment ponga `DEMO_PASSWORD` (una contraseña) y reinicie: se crea la cuenta **demo@skynetgenesis.com** con una «Empresa Demo». En la pantalla de ingreso aparece **Probar la demostración**, que entra sin contraseña como Administrador, Supervisor o Asesor (no puede ver otras empresas ni cambiar contraseñas).

## Messenger, Instagram y anuncios de Meta (opcional)

Agente-IA **no usa WhatsApp** (directiva de SkyNet Genesis: sin mensajes automáticos por WhatsApp ni SMS). WhatsApp solo aparece como botón de soporte de SkyNet Genesis. Los clientes de cada empresa escriben por el chat de la página, el formulario, el correo, Messenger o Instagram, y la posventa sale por correo.

1. En developers.facebook.com crear la app de Meta (tipo Empresa) con Messenger e Instagram.
2. Webhook: `https://<servidor>/webhooks/meta` con el `META_VERIFY_TOKEN` de Render. Suscribirse a `messages` y `leadgen`.
3. Copiar la clave secreta de la app en Render como `META_APP_SECRET`.
4. Por cada empresa cliente, en **Formularios y conexiones** (como Superadministrador): pegar el identificador de la página y su token.

## Probar en su computador

```
npm install
cp .env.example .env    # y llenar los datos
npm start               # http://localhost:3000
npm test                # pruebas de extremo a extremo (con el servidor encendido)
```

## Inteligencia artificial (opcional, apagada)

El código queda listo por si algún día la quiere usar. Para encenderla: en Render poner `AI_ENABLED=true` y `ANTHROPIC_API_KEY`. Tiene costo por uso.
