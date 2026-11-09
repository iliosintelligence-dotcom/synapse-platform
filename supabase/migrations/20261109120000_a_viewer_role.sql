-- Viewer: an agency member who can see and cannot change anything (contract: Owner / Manager / Editor / Viewer).
-- Alone in its own migration: Postgres will not let a new enum value be used in the transaction that adds it.
alter type public.user_role add value if not exists 'agency_viewer';
