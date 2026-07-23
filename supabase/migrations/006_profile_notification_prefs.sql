-- 006_profile_notification_prefs.sql
-- Add notification preferences and WCA ID fields to profiles.

ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS wca_id TEXT,
ADD COLUMN IF NOT EXISTS notify_round_start BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_advancement BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS notify_pb_beaten BOOLEAN NOT NULL DEFAULT false;
