-- 005_allow_spectators.sql
-- Allow competition creators to toggle guest/spectator access.
-- When true, non-registered users can view scrambles and the leaderboard
-- without registering for the competition. Time submission still requires registration.

ALTER TABLE competitions
ADD COLUMN allow_spectators BOOLEAN NOT NULL DEFAULT false;
