# Sports Edge Tracker

Dashboard simple para actualizar manualmente datos de UFC, futbol y basquetbol antes de apostar. El boton **Actualizar datos** llama a una funcion serverless, obtiene cuotas desde The Odds API si hay API key, y guarda snapshots en Supabase si las variables estan configuradas.

## Estado actual

- Funciona en modo demo sin pagar nada.
- Esta listo para Supabase Free, pero la creacion automatica del proyecto fue bloqueada porque la organizacion Supabase conectada ya llego al limite de proyectos activos gratis.
- No expone la `SUPABASE_SERVICE_ROLE_KEY` al navegador; solo la usan las funciones `/api/*`.

## Variables de entorno

Copia `.env.example` a `.env.local` para desarrollo o configura estas variables en Vercel:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ODDS_API_KEY=
ODDS_API_SPORT_KEYS=mma_mixed_martial_arts,basketball_nba,soccer_epl
ODDS_API_REGIONS=us,eu
ODDS_API_MARKETS=h2h
ODDS_API_ODDS_FORMAT=decimal
```

`ODDS_API_KEY` es opcional. Sin esa key, la app devuelve datos demo.

## Supabase

1. Crea o reutiliza un proyecto Supabase gratis.
2. Ejecuta `supabase/schema.sql` en el SQL editor.
3. Copia `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` a Vercel.

Las tablas tienen RLS activado y no dan permisos a `anon` ni `authenticated`. La app escribe/lee por funciones serverless usando `service_role`.

## Despliegue

Este proyecto no necesita build. Vercel puede desplegarlo como proyecto estatico con funciones Node en `/api`.

```bash
npm install -g vercel
vercel deploy
```

Para produccion:

```bash
vercel deploy --prod
```
