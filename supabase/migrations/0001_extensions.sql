-- Layer 1 · extensions
-- PostGIS now, so proximity features later require zero schema migration.
create extension if not exists "uuid-ossp";
create extension if not exists postgis;
