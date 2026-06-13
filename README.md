# Sports Edge Tracker

Dashboard simple para actualizar manualmente datos reales de UFC, futbol y basquetbol antes de apostar. El boton **Actualizar datos** llama a una funcion serverless, obtiene cuotas desde The Odds API y guarda snapshots en Supabase.

## Estado actual

- No tiene modo demo: si falta una variable de entorno, la app muestra el error.
- Supabase esta configurado para el proyecto `todoalverde`.
- No expone la `SUPABASE_SERVICE_ROLE_KEY` al navegador; solo la usan las funciones `/api/*`.
- Las plantillas de analisis por deporte estan en `docs/analysis-prompts.md`.

## Variables de entorno

Copia `.env.example` a `.env.local` para desarrollo o configura estas variables en Vercel:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ODDS_API_KEY=
ODDS_API_SPORT_KEYS=mma_mixed_martial_arts,basketball_nba,soccer_fifa_world_cup
ODDS_API_REGIONS=us,eu
ODDS_API_MARKETS=h2h
ODDS_API_ODDS_FORMAT=decimal
ODDS_API_MAX_LOOKAHEAD_DAYS=60
ODDS_API_REQUIRE_UFC_OFFICIAL=true
ODDS_API_AUTO_MAJOR_TOURNAMENTS=true
```

`ODDS_API_KEY` es obligatoria. Sin esa key, la app no inventa datos.
`ODDS_API_REQUIRE_UFC_OFFICIAL=true` hace que las peleas MMA se crucen con la cartelera publicada en UFC.com antes de guardarlas como UFC. Si UFC.com no responde, la app no se cae, pero informa el aviso en los diagnosticos de la actualizacion.
`ODDS_API_AUTO_MAJOR_TOURNAMENTS=true` prioriza el Mundial en futbol y NBA en basquet, incluso si quedo configurada una liga antigua como MLS.

## Supabase

1. Usa el proyecto Supabase `todoalverde`.
2. El esquema esta en `supabase/schema.sql`.
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
