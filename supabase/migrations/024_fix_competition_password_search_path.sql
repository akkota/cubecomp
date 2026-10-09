-- 024_fix_competition_password_search_path.sql
-- Migration 019 replaced the privacy RPCs and lost migration 011's pgcrypto
-- search path. Supabase installs pgcrypto in extensions, so password creation
-- and verification otherwise fail with missing gen_salt/crypt functions.
-- Alter only configuration to preserve the current RPC bodies and permissions,
-- including password-change revocation and public unlock behavior from 019.

BEGIN;

ALTER FUNCTION public.configure_competition_visibility(UUID, TEXT, TEXT)
  SET search_path = public, extensions;

ALTER FUNCTION public.unlock_private_competition(UUID, TEXT)
  SET search_path = public, extensions;

COMMIT;
