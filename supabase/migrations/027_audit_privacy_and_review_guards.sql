BEGIN;
-- Review decisions and evidence are immutable once the next round uses qualification.
CREATE OR REPLACE FUNCTION public.guard_round_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_round rounds%ROWTYPE;
BEGIN
 SELECT * INTO STRICT v_round FROM rounds WHERE id=NEW.round_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM competitors c JOIN competition_events ce ON ce.competition_id=c.competition_id WHERE c.id=NEW.competitor_id AND ce.id=v_round.competition_event_id) THEN RAISE EXCEPTION 'Evidence does not belong to the round competition'; END IF;
 IF TG_OP='UPDATE' AND (NEW.round_id<>OLD.round_id OR NEW.competitor_id<>OLD.competitor_id) THEN RAISE EXCEPTION 'Evidence identity is immutable'; END IF;
 PERFORM 1 FROM rounds WHERE competition_event_id=v_round.competition_event_id AND round_number=v_round.round_number+1 FOR UPDATE;
 IF EXISTS(SELECT 1 FROM rounds WHERE competition_event_id=v_round.competition_event_id AND round_number>v_round.round_number AND status<>'pending') THEN RAISE EXCEPTION 'Review is locked after the next round starts'; END IF;
 UPDATE rounds SET qualification_calculated_at=NULL WHERE competition_event_id=v_round.competition_event_id AND round_number=v_round.round_number+1;
 DELETE FROM round_participants WHERE round_id IN(SELECT id FROM rounds WHERE competition_event_id=v_round.competition_event_id AND round_number=v_round.round_number+1);
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_round_review BEFORE INSERT OR UPDATE ON public.round_submissions FOR EACH ROW EXECUTE FUNCTION public.guard_round_review();

-- Keep review and evidence writes in the same parent-before-child lock order.
REVOKE UPDATE ON public.round_submissions FROM authenticated;
CREATE FUNCTION public.review_round_evidence(p_submission_id UUID,p_status TEXT,p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_round UUID; v_comp UUID;
BEGIN
 SELECT rs.round_id,ce.competition_id INTO STRICT v_round,v_comp FROM round_submissions rs JOIN rounds r ON r.id=rs.round_id JOIN competition_events ce ON ce.id=r.competition_event_id WHERE rs.id=p_submission_id;
 IF auth.uid() IS NULL OR NOT public.is_competition_admin(v_comp) THEN RAISE EXCEPTION 'Not authorized'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('verified','rejected') THEN RAISE EXCEPTION 'Invalid review status'; END IF;
 IF length(COALESCE(p_reason,''))>2000 THEN RAISE EXCEPTION 'Review reason is too long'; END IF;
 PERFORM 1 FROM rounds WHERE id=v_round FOR UPDATE;
 UPDATE round_submissions SET verification_status=p_status,verified_by=auth.uid(),verified_at=now(),
   rejected_reason=CASE WHEN p_status='rejected' THEN COALESCE(NULLIF(btrim(p_reason),''),'No reason given') ELSE NULL END WHERE id=p_submission_id;
 RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.review_round_evidence(UUID,TEXT,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_round_evidence(UUID,TEXT,TEXT) TO authenticated;

CREATE TABLE public.competition_unlock_attempts(
 user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
 window_started TIMESTAMPTZ NOT NULL DEFAULT now(),attempts INT NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,competition_id)
);
ALTER TABLE public.competition_unlock_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competition_unlock_attempts FROM anon,authenticated;
ALTER FUNCTION public.unlock_private_competition(UUID,TEXT) RENAME TO _audit_unlock_private_competition;
REVOKE ALL ON FUNCTION public._audit_unlock_private_competition(UUID,TEXT) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.unlock_private_competition(p_competition_id UUID,p_password TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_attempts INT;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success',false,'error','Not authenticated'); END IF;
 IF NOT EXISTS(SELECT 1 FROM competitions WHERE id=p_competition_id) THEN RETURN jsonb_build_object('success',false,'error','Competition not found'); END IF;
 IF (SELECT visibility FROM competitions WHERE id=p_competition_id)='public' THEN RETURN public._audit_unlock_private_competition(p_competition_id,p_password); END IF;
 INSERT INTO competition_unlock_attempts(user_id,competition_id,attempts) VALUES(auth.uid(),p_competition_id,1)
 ON CONFLICT(user_id,competition_id) DO UPDATE SET
   attempts=CASE WHEN competition_unlock_attempts.window_started<now()-interval '15 minutes' THEN 1 ELSE competition_unlock_attempts.attempts+1 END,
   window_started=CASE WHEN competition_unlock_attempts.window_started<now()-interval '15 minutes' THEN now() ELSE competition_unlock_attempts.window_started END
 RETURNING attempts INTO v_attempts;
 IF v_attempts>10 THEN RETURN jsonb_build_object('success',false,'error','Too many password attempts. Try again in 15 minutes.'); END IF;
 RETURN public._audit_unlock_private_competition(p_competition_id,p_password);
END; $$;
REVOKE ALL ON FUNCTION public.unlock_private_competition(UUID,TEXT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.unlock_private_competition(UUID,TEXT) TO authenticated;

-- Schema-only defaults: live reads always have a polling fallback in the app.
DO $$ DECLARE v_table TEXT; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime' AND NOT puballtables) THEN
  FOREACH v_table IN ARRAY ARRAY['solves','round_submissions','tournaments','tournament_matches','tournament_match_sets','tournament_match_solves'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
   END IF;
  END LOOP;
 END IF;
END $$;
COMMIT;
