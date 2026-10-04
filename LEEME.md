# Gestión ComercIAl

Atención automática, CRM de prospectos, seguimiento, agenda, cobros (Ley 2300), mensualidades y facturación para vender a empresas.

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
  - El despertador lo llama cada 10 minutos **solo de 6:00 a. m. a 10:00 p. m.** (unas 500 horas al mes). Así queda margen.
  - De noche duerme. Si llega un mensaje, despierta en cerca de un minuto y lo responde. Meta reintenta el envío, así que no se pierde nada.
  - **Importante:** si SkyNet está en el mismo espacio de trabajo de Render, comparten las 750 horas. Cree un espacio de trabajo aparte para Gestión ComercIAl.
- **Neon gratis**: 100 horas de cómputo al mes y 1 GB de datos. Se duerme a los 5 minutos sin uso.
  - El servidor responde desde su memoria las revisiones que la app hace cada pocos segundos, y solo consulta la base cuando algo cambió o hay algo por enviar.
  - Revise el consumo en neon.tech › Usage. Si se acerca al límite, el plan pago de Neon se cobra por uso.

## Puesta en marcha (una sola vez)

1. **GitHub**: crear el repositorio `gestion-comercial` y subir esta carpeta. En Configuración › Pages: rama `main`, carpeta `/docs`, dominio `comercial.skynetgenesis.com`.
2. **Neon** (neon.tech): crear el proyecto `gestion-comercial` en la región de EE. UU. (Ohio). Copiar la cadena de conexión **con "pooler"**.
3. **Render**: New › Blueprint › elegir el repositorio (lee `render.yaml`). Llenar:
   - `DATABASE_URL`: la cadena de Neon.
   - `ADMIN_EMAIL` y `ADMIN_PASSWORD`: su cuenta de proveedor.
   - `BREVO_API_KEY` (opcional): para enviar correos.
4. **Render › Settings › Custom Domains**: agregar `api-comercial.skynetgenesis.com`.
5. **SiteGround › DNS**: dos registros CNAME:
   - `comercial` → `<su-usuario>.github.io`
   - `api-comercial` → la dirección `.onrender.com` que muestra Render
6. **cron-job.org**: crear la tarea:
   - Dirección: `https://api-comercial.skynetgenesis.com/api/cron?key=<CRON_SECRET>`. El valor de `CRON_SECRET` está en Render › Environment.
   - Cada 10 minutos, de 6:00 a 22:00, zona horaria America/Bogota.
7. Entrar a `https://comercial.skynetgenesis.com` con el correo y la contraseña del paso 3.

## WhatsApp y redes (cuando tenga la verificación de Meta)

1. En developers.facebook.com crear la app de Meta (tipo Empresa) con WhatsApp, Messenger e Instagram.
2. Webhook: `https://api-comercial.skynetgenesis.com/webhooks/meta` con el `META_VERIFY_TOKEN` de Render. Suscribirse a `messages` y `leadgen`.
3. Copiar la clave secreta de la app en Render como `META_APP_SECRET`.
4. Por cada empresa cliente, en **Formularios y conexiones › WhatsApp** (como proveedor): pegar el *Phone number ID*, el token permanente y la plantilla aprobada.
5. Plantilla para mensajes fuera de las 24 horas (categoría Utilidad): nombre `aviso_general`, cuerpo `Hola, le escribimos de {{1}}. {{2}}`.

## Probar en su computador

```
npm install
cp .env.example .env    # y llenar los datos
npm start               # http://localhost:3000
npm test                # pruebas de extremo a extremo (con el servidor encendido)
```

## Inteligencia artificial (opcional, apagada)

El código queda listo por si algún día la quiere usar. Para encenderla: en Render poner `AI_ENABLED=true` y `ANTHROPIC_API_KEY`. Tiene costo por uso.
