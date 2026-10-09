-- Forward-only audit repair. Existing rows are preserved for administrator review.
BEGIN;
ALTER TABLE public.rounds ADD COLUMN qualification_calculated_at TIMESTAMPTZ;

-- Internal SECURITY DEFINER helpers are callable only by their owner/other RPCs.
REVOKE ALL ON FUNCTION public.place_competitor_in_match(UUID,UUID,INT),
  public.propagate_tournament_byes(UUID), public.clear_competitor_from_match(UUID,UUID),
  public.advance_after_match_win(UUID,UUID),
  public.advance_after_solve_win(UUID,UUID,INT,UUID,TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.competition_accepts_solves(p_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.competition_effective_status(p_id) NOT IN ('completed','cancelled'), false);
$$;
REVOKE ALL ON FUNCTION public.competition_accepts_solves(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.competition_accepts_solves(UUID) TO anon, authenticated;

DROP POLICY "Scrambles visible to eligible users" ON public.scrambles;
CREATE POLICY "Scrambles visible to eligible users" ON public.scrambles FOR SELECT USING (
  EXISTS (SELECT 1 FROM rounds r JOIN competition_events ce ON ce.id=r.competition_event_id
    JOIN competitions c ON c.id=ce.competition_id WHERE r.id=scrambles.round_id AND (
      public.is_competition_admin(c.id) OR (
        r.status='active' AND public.competition_accepts_solves(c.id) AND (
          public.user_can_access_round(r.id) OR (c.visibility='public' AND c.allow_spectators)
        )
      )
    ))
);

ALTER TABLE public.solves ADD CONSTRAINT solves_valid_time CHECK (
  (penalty IN ('DNF','DNS') AND time_ms IS NULL) OR
  (penalty IN ('none','+2') AND time_ms IS NOT NULL AND time_ms > 0 AND time_ms <= 2147481647)
) NOT VALID;

CREATE OR REPLACE FUNCTION public.validate_solve_relationship()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_comp UUID; v_format TEXT; v_owner UUID;
BEGIN
  SELECT ce.competition_id, COALESCE(r.round_format,ce.event_format)
    INTO v_comp,v_format FROM rounds r JOIN competition_events ce ON ce.id=r.competition_event_id
    WHERE r.id=NEW.round_id;
  SELECT c.user_id INTO v_owner FROM competitors c
    WHERE c.id=NEW.competitor_id AND c.competition_id=v_comp;
  IF v_owner IS NULL OR NEW.solve_number > (CASE WHEN v_format='mean' THEN 3 ELSE 5 END) THEN
    RAISE EXCEPTION 'Solve does not match round competition or format';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER validate_solve_relationship BEFORE INSERT OR UPDATE ON public.solves
  FOR EACH ROW EXECUTE FUNCTION public.validate_solve_relationship();
REVOKE INSERT, UPDATE, DELETE ON public.solves FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_round_times(p_round_id UUID,p_competition_id UUID,p_solves JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_round rounds%ROWTYPE; v_event competition_events%ROWTYPE;
  v_competitor UUID; v_count INT; v_solve JSONB; v_number INT; v_time INT; v_penalty TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO STRICT v_round FROM rounds WHERE id=p_round_id FOR UPDATE;
  SELECT * INTO STRICT v_event FROM competition_events WHERE id=v_round.competition_event_id;
  IF v_event.competition_id<>p_competition_id OR v_round.status<>'active'
    OR NOT public.competition_accepts_solves(p_competition_id) THEN
    RAISE EXCEPTION 'Round is not open for submissions';
  END IF;
  IF v_event.event_key IN ('333fm','333mbf') THEN RAISE EXCEPTION 'This event requires an unsupported result type'; END IF;
  SELECT id INTO v_competitor FROM competitors WHERE competition_id=p_competition_id AND user_id=auth.uid();
  IF v_competitor IS NULL OR NOT public.user_can_access_round(p_round_id) THEN RAISE EXCEPTION 'Not eligible for this round'; END IF;
  v_count := CASE WHEN COALESCE(v_round.round_format,v_event.event_format)='mean' THEN 3 ELSE 5 END;
  IF jsonb_typeof(p_solves) IS DISTINCT FROM 'array' OR jsonb_array_length(p_solves)<>v_count THEN
    RAISE EXCEPTION 'Submit exactly % solves',v_count;
  END IF;
  IF EXISTS(SELECT 1 FROM solves WHERE round_id=p_round_id AND competitor_id=v_competitor) THEN
    RAISE EXCEPTION 'Times already submitted for this round';
  END IF;
  IF (SELECT count(DISTINCT (s->>'solve_number')::INT) FROM jsonb_array_elements(p_solves) s)<>v_count THEN
    RAISE EXCEPTION 'Duplicate or missing solve number';
  END IF;
  FOR v_solve IN SELECT * FROM jsonb_array_elements(p_solves) LOOP
    v_number := (v_solve->>'solve_number')::INT;
    v_time := (v_solve->>'time_ms')::INT;
    v_penalty := v_solve->>'penalty';
    IF v_number IS NULL OR v_number NOT BETWEEN 1 AND v_count OR v_penalty IS NULL
      OR v_penalty NOT IN ('none','+2','DNF') OR
      (v_penalty='DNF' AND v_time IS NOT NULL) OR
      (v_penalty<>'DNF' AND (v_time IS NULL OR v_time<=0 OR v_time>2147481647)) THEN
      RAISE EXCEPTION 'Invalid solve';
    END IF;
    INSERT INTO solves(round_id,competitor_id,solve_number,time_ms,penalty,submitted_by)
      VALUES(p_round_id,v_competitor,v_number,v_time,v_penalty,auth.uid());
  END LOOP;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.submit_round_times(UUID,UUID,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round_times(UUID,UUID,JSONB) TO authenticated;

-- Freeze scramble format and require a complete batch when a round starts.
CREATE OR REPLACE FUNCTION public.guard_round_configuration()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_event competition_events%ROWTYPE; v_count INT;
BEGIN
  SELECT * INTO STRICT v_event FROM competition_events WHERE id=NEW.competition_event_id;
  IF NEW.round_format IS DISTINCT FROM OLD.round_format AND
    (OLD.status<>'pending' OR EXISTS(SELECT 1 FROM scrambles WHERE round_id=OLD.id)) THEN
    RAISE EXCEPTION 'Format is locked after scramble generation or round start';
  END IF;
  IF NEW.status='active' AND OLD.status<>'active' THEN
    IF NOT public.competition_accepts_solves(v_event.competition_id) THEN RAISE EXCEPTION 'Competition is closed'; END IF;
    IF v_event.event_key IN ('333fm','333mbf') THEN RAISE EXCEPTION 'Unsupported result type'; END IF;
    IF NEW.round_number>1 AND EXISTS(SELECT 1 FROM rounds WHERE competition_event_id=NEW.competition_event_id
       AND round_number<NEW.round_number AND status<>'completed') THEN RAISE EXCEPTION 'Complete previous rounds first'; END IF;
    IF NEW.round_number>1 AND NEW.qualification_calculated_at IS NULL THEN RAISE EXCEPTION 'Calculate qualification after all review decisions before starting'; END IF;
    v_count := CASE WHEN COALESCE(NEW.round_format,v_event.event_format)='mean' THEN 3 ELSE 5 END;
    IF (SELECT generate_scrambles FROM competitions WHERE id=v_event.competition_id) AND
      (SELECT count(*) FROM scrambles WHERE round_id=NEW.id)<>v_count THEN RAISE EXCEPTION 'Generate a complete scramble batch before starting'; END IF;
  END IF;
  IF NEW.advancement_mode IS DISTINCT FROM OLD.advancement_mode OR NEW.advancement_value IS DISTINCT FROM OLD.advancement_value OR NEW.advance_count IS DISTINCT FROM OLD.advance_count THEN
    PERFORM 1 FROM rounds WHERE competition_event_id=NEW.competition_event_id AND round_number=NEW.round_number+1 FOR UPDATE;
    IF EXISTS(SELECT 1 FROM rounds WHERE competition_event_id=NEW.competition_event_id AND round_number>NEW.round_number AND status<>'pending') THEN RAISE EXCEPTION 'Advancement rule is locked after the next round starts'; END IF;
    UPDATE rounds SET qualification_calculated_at=NULL WHERE competition_event_id=NEW.competition_event_id AND round_number=NEW.round_number+1;
    DELETE FROM round_participants WHERE round_id IN(SELECT id FROM rounds WHERE competition_event_id=NEW.competition_event_id AND round_number=NEW.round_number+1);
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER guard_round_configuration BEFORE UPDATE ON public.rounds
  FOR EACH ROW EXECUTE FUNCTION public.guard_round_configuration();

-- Serialize scramble writes with format changes and reject incompatible batches.
CREATE FUNCTION public.guard_round_scramble() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_round rounds%ROWTYPE; v_format TEXT;
BEGIN
 SELECT * INTO STRICT v_round FROM rounds WHERE id=NEW.round_id FOR UPDATE;
 SELECT COALESCE(v_round.round_format,event_format) INTO v_format FROM competition_events WHERE id=v_round.competition_event_id;
 IF v_round.status<>'pending' THEN RAISE EXCEPTION 'Scrambles are locked after round start'; END IF;
 IF NEW.scramble_number>(CASE WHEN v_format='mean' THEN 3 ELSE 5 END) OR length(btrim(NEW.scramble))=0 THEN RAISE EXCEPTION 'Scramble does not match round format'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_round_scramble BEFORE INSERT OR UPDATE ON public.scrambles FOR EACH ROW EXECUTE FUNCTION public.guard_round_scramble();
REVOKE UPDATE,DELETE ON public.scrambles FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_competition(p_details JSONB,p_events JSONB,p_password TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,extensions AS $$
DECLARE v_id UUID:=gen_random_uuid(); v_event JSONB; v_eid UUID; v_visibility TEXT;
  v_type TEXT; v_start TIMESTAMPTZ; v_end TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_visibility:=COALESCE(p_details->>'visibility','public'); v_type:=COALESCE(p_details->>'competition_type','standard');
  v_start:=NULLIF(p_details->>'starts_at','')::TIMESTAMPTZ; v_end:=NULLIF(p_details->>'ends_at','')::TIMESTAMPTZ;
  IF length(btrim(p_details->>'name')) NOT BETWEEN 3 AND 100 OR p_details->>'name' IS NULL
    OR length(COALESCE(p_details->>'description',''))>500 OR (v_start IS NOT NULL AND v_end<=v_start) THEN RAISE EXCEPTION 'Invalid competition details'; END IF;
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR jsonb_array_length(p_events)=0
    OR jsonb_array_length(p_events)>15 OR (v_type='head_to_head' AND jsonb_array_length(p_events)<>1) THEN RAISE EXCEPTION 'Invalid event selection'; END IF;
  -- This public insert and its private transition are invisible until the transaction commits.
  INSERT INTO competitions(id,created_by,name,description,competition_type,visibility,generate_scrambles,allow_spectators,require_verified_solves,starts_at,ends_at)
    VALUES(v_id,auth.uid(),btrim(p_details->>'name'),COALESCE(p_details->>'description',''),v_type,'public',
      CASE WHEN v_type='head_to_head' THEN true ELSE COALESCE((p_details->>'generate_scrambles')::BOOLEAN,true) END,
      COALESCE((p_details->>'allow_spectators')::BOOLEAN,false),COALESCE((p_details->>'require_verified_solves')::BOOLEAN,false),v_start,v_end);
  IF v_visibility='private' THEN
    IF p_password IS NULL OR length(btrim(p_password))<4 OR octet_length(btrim(p_password))>72 THEN RAISE EXCEPTION 'Password must be 4 to 72 bytes'; END IF;
    INSERT INTO competition_secrets(competition_id,password_hash) VALUES(v_id,crypt(btrim(p_password),gen_salt('bf')));
    UPDATE competitions SET visibility='private' WHERE id=v_id;
  ELSIF v_visibility<>'public' THEN RAISE EXCEPTION 'Invalid visibility'; END IF;
  FOR v_event IN SELECT * FROM jsonb_array_elements(p_events) LOOP
    IF (v_event->>'roundCount')::INT IS NULL OR (v_event->>'roundCount')::INT NOT BETWEEN 1 AND 5 OR (v_type='head_to_head' AND (v_event->>'roundCount')::INT<>1) THEN RAISE EXCEPTION 'Invalid round count'; END IF;
    IF v_event->>'key' IS NULL OR v_event->>'key' NOT IN ('333','222','444','555','666','777','333bf','333oh','clock','mega','pyra','skewb','sq1','444bf','555bf') THEN RAISE EXCEPTION 'Unsupported event'; END IF;
    INSERT INTO competition_events(competition_id,event_key,round_count,event_format)
      VALUES(v_id,v_event->>'key',(v_event->>'roundCount')::INT,v_event->>'format') RETURNING id INTO v_eid;
    INSERT INTO rounds(competition_event_id,round_number,round_format)
      SELECT v_eid,n,v_event->>'format' FROM generate_series(1,(v_event->>'roundCount')::INT) n;
  END LOOP;
  RETURN jsonb_build_object('success',true,'id',v_id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.create_competition(JSONB,JSONB,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_competition(JSONB,JSONB,TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_view_tournament(p_tournament_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM tournaments t JOIN competitions c ON c.id=t.competition_id WHERE t.id=p_tournament_id
    AND (public.is_competition_admin(c.id) OR c.visibility='public' OR public.user_has_competition_unlock(c.id)
      OR EXISTS(SELECT 1 FROM competitors co WHERE co.competition_id=c.id AND co.user_id=auth.uid())));
$$;

-- Evidence is private; owners can correct rejected evidence until qualification is used.
REVOKE INSERT,UPDATE,DELETE ON public.round_submissions FROM anon,authenticated;
GRANT UPDATE ON public.round_submissions TO authenticated; -- admin review is still supported by RLS
DROP POLICY "Competitors can update own submissions" ON public.round_submissions;
DROP POLICY "Competitors can insert own submissions" ON public.round_submissions;

CREATE OR REPLACE FUNCTION public.submit_round_evidence(p_round_id UUID,p_video_url TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_round rounds%ROWTYPE; v_comp UUID; v_competitor UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO STRICT v_round FROM rounds WHERE id=p_round_id FOR UPDATE;
  SELECT competition_id INTO v_comp FROM competition_events WHERE id=v_round.competition_event_id;
  SELECT id INTO v_competitor FROM competitors WHERE competition_id=v_comp AND user_id=auth.uid();
  IF v_competitor IS NULL OR NOT public.user_can_access_round(p_round_id) OR v_round.status='pending' THEN RAISE EXCEPTION 'Not eligible'; END IF;
  IF EXISTS(SELECT 1 FROM rounds WHERE competition_event_id=v_round.competition_event_id AND round_number>v_round.round_number AND status<>'pending') THEN RAISE EXCEPTION 'Evidence is locked after the next round starts'; END IF;
  IF (SELECT status FROM competitions WHERE id=v_comp)='cancelled' THEN RAISE EXCEPTION 'Competition cancelled'; END IF;
  IF p_video_url IS NULL OR length(p_video_url)>2048 OR p_video_url !~ '^https://(www\.)?(youtube\.com/watch\?v=[A-Za-z0-9_-]+|youtu\.be/[A-Za-z0-9_-]+)([?&#][^[:space:]]*)?$' THEN RAISE EXCEPTION 'Enter a valid HTTPS YouTube video URL'; END IF;
  IF EXISTS(SELECT 1 FROM round_submissions WHERE round_id=p_round_id AND competitor_id=v_competitor AND verification_status='verified') THEN RAISE EXCEPTION 'Verified evidence cannot be replaced'; END IF;
  INSERT INTO round_submissions(round_id,competitor_id,video_url,verification_status)
    VALUES(p_round_id,v_competitor,p_video_url,'pending') ON CONFLICT(round_id,competitor_id)
    DO UPDATE SET video_url=EXCLUDED.video_url,verification_status='pending',verified_by=NULL,verified_at=NULL,rejected_reason=NULL;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.submit_round_evidence(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_round_evidence(UUID,TEXT) TO authenticated;

-- Server-side aggregation is independent of the PostgREST response-row cap.
CREATE OR REPLACE FUNCTION public.round_result(p_times INT[],p_format TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN cardinality(p_times)<>CASE WHEN p_format='mean' THEN 3 ELSE 5 END THEN NULL
   WHEN p_format='mean' AND array_position(p_times,NULL) IS NOT NULL THEN NULL
   WHEN p_format='mean' THEN round((SELECT avg(t) FROM unnest(p_times) t))::INT
   ELSE (SELECT CASE WHEN count(t)=3 THEN round(avg(t))::INT END FROM
     (SELECT t FROM unnest(p_times) t ORDER BY t NULLS LAST OFFSET 1 LIMIT 3) m) END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_round_advancement(p_round_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_round rounds%ROWTYPE; v_next rounds%ROWTYPE; v_event competition_events%ROWTYPE;
  v_verified BOOLEAN; v_mode TEXT; v_value INT; v_total INT; v_advance INT; v_ids UUID[]; v_valid INT; v_dnf INT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO STRICT v_round FROM rounds WHERE id=p_round_id FOR UPDATE;
  SELECT * INTO STRICT v_event FROM competition_events WHERE id=v_round.competition_event_id;
  IF NOT public.is_competition_admin(v_event.competition_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_round.status<>'completed' THEN RAISE EXCEPTION 'Complete the round first'; END IF;
  SELECT * INTO STRICT v_next FROM rounds WHERE competition_event_id=v_event.id AND round_number=v_round.round_number+1 FOR UPDATE;
  IF v_next.status<>'pending' THEN RAISE EXCEPTION 'Qualification is locked after the next round starts'; END IF;
  v_mode:=COALESCE(v_round.advancement_mode,CASE WHEN v_round.advance_count IS NOT NULL THEN 'fixed' END);
  v_value:=COALESCE(v_round.advancement_value,v_round.advance_count);
  IF v_value IS NULL OR v_value<1 OR v_mode IS NULL OR (v_mode='percentage' AND v_value>100) THEN RAISE EXCEPTION 'Set a valid advancement rule'; END IF;
  SELECT require_verified_solves INTO STRICT v_verified FROM competitions WHERE id=v_event.competition_id;
  IF v_verified AND EXISTS(SELECT 1 FROM solves s LEFT JOIN round_submissions rs ON rs.round_id=s.round_id AND rs.competitor_id=s.competitor_id
    WHERE s.round_id=p_round_id AND (rs.id IS NULL OR rs.verification_status IN ('none','pending'))) THEN RAISE EXCEPTION 'Review all submitted results before calculating advancement'; END IF;
  SELECT count(DISTINCT competitor_id) INTO v_total FROM solves WHERE round_id=p_round_id;
  v_advance:=CASE WHEN v_mode='percentage' THEN GREATEST(1,ceil(v_total*v_value/100.0)::INT) ELSE v_value END;
  WITH results AS (
    SELECT s.competitor_id,public.round_result(array_agg(CASE WHEN s.penalty IN ('DNF','DNS') THEN NULL WHEN s.penalty='+2' THEN s.time_ms+2000 ELSE s.time_ms END ORDER BY s.solve_number),COALESCE(v_round.round_format,v_event.event_format)) result
    FROM solves s JOIN competitors c ON c.id=s.competitor_id AND c.competition_id=v_event.competition_id
    WHERE s.round_id=p_round_id AND (NOT v_verified OR EXISTS(SELECT 1 FROM round_submissions rs WHERE rs.round_id=p_round_id AND rs.competitor_id=s.competitor_id AND rs.verification_status='verified')) GROUP BY s.competitor_id
  ), ranked AS (SELECT *,rank() OVER(ORDER BY result) position FROM results WHERE result IS NOT NULL)
  SELECT COALESCE(array_agg(competitor_id) FILTER(WHERE position<=v_advance),'{}'::UUID[]),count(*) INTO v_ids,v_valid FROM ranked;
  SELECT count(*) INTO v_dnf FROM (SELECT public.round_result(array_agg(CASE WHEN s.penalty IN ('DNF','DNS') THEN NULL WHEN s.penalty='+2' THEN s.time_ms+2000 ELSE s.time_ms END ORDER BY s.solve_number),COALESCE(v_round.round_format,v_event.event_format)) result FROM solves s WHERE s.round_id=p_round_id GROUP BY s.competitor_id) r WHERE result IS NULL;
  DELETE FROM round_participants WHERE round_id=v_next.id;
  INSERT INTO round_participants(round_id,competitor_id) SELECT v_next.id,unnest(v_ids);
  UPDATE rounds SET qualification_calculated_at=now() WHERE id=v_next.id;
  RETURN jsonb_build_object('success',true,'advanced',cardinality(v_ids),'total',v_total,'dnfCount',v_dnf,'roundNumber',v_round.round_number,'nextRoundNumber',v_next.round_number);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.calculate_round_advancement(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_round_advancement(UUID) TO authenticated;
COMMIT;
