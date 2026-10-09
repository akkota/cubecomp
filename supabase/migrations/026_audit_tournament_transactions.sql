BEGIN;
-- Serialize public tournament mutations on the parent row before taking child locks.
-- Preserve the tested advancement bodies; make their implementations owner-only.
DO $$
DECLARE v_name TEXT; v_proc RECORD; v_args TEXT; v_call TEXT; v_types TEXT; v_extra TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['generate_tournament_bracket','submit_tournament_solve','admin_resolve_tournament_tie','undo_tournament_solve','re_solve_tournament_tie'] LOOP
    SELECT p.*,pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity_args
      INTO STRICT v_proc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=v_name;
    v_args:=v_proc.args;
    SELECT string_agg(format('%I',a),',') INTO v_call FROM unnest(v_proc.proargnames) WITH ORDINALITY x(a,i) WHERE i<=v_proc.pronargs;
    v_types:=v_proc.identity_args;
    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I',v_name,v_types,'_audit_'||v_name);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated','_audit_'||v_name,v_types);
    v_extra:='';
    IF v_name IN ('submit_tournament_solve','admin_resolve_tournament_tie','re_solve_tournament_tie') THEN
      v_extra:=$body$
        IF (SELECT status FROM tournaments WHERE id=p_tournament_id)<>'active' OR NOT competition_accepts_solves((SELECT competition_id FROM tournaments WHERE id=p_tournament_id)) THEN
          RETURN jsonb_build_object('success',false,'error','Tournament is not open for results'); END IF;
      $body$;
    END IF;
    IF v_name='generate_tournament_bracket' THEN
      v_extra:=$body$
        IF (SELECT status FROM tournaments WHERE id=p_tournament_id)<>'draft' THEN
          RETURN jsonb_build_object('success',false,'error','Bracket can only be generated from a draft'); END IF;
      $body$;
    END IF;
    EXECUTE format($ddl$
      CREATE FUNCTION public.%I(%s) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
      DECLARE v_result JSONB;
      BEGIN
        IF auth.uid() IS NULL OR NOT public.user_is_tournament_admin(p_tournament_id) THEN
          RETURN jsonb_build_object('success',false,'error','Not authorized'); END IF;
        PERFORM 1 FROM tournaments WHERE id=p_tournament_id FOR UPDATE;
        %s
        v_result:=public.%I(%s);
        IF (v_result->>'success')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION '%%',COALESCE(v_result->>'error','Operation failed'); END IF;
        RETURN v_result;
      EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
      END; $fn$;
    $ddl$,v_name,v_args,v_extra,'_audit_'||v_name,v_call);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon',v_name,v_types);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',v_name,v_types);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.replace_tournament_participants(p_tournament_id UUID,p_participants JSONB,p_shuffle_seed BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_t tournaments%ROWTYPE; v_p JSONB; v_n INT:=0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO STRICT v_t FROM tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF v_t.status<>'draft' THEN RAISE EXCEPTION 'Participants can only change in draft'; END IF;
  IF jsonb_typeof(p_participants) IS DISTINCT FROM 'array' OR jsonb_array_length(p_participants) NOT BETWEEN 2 AND 1024 THEN RAISE EXCEPTION 'Select 2 to 1024 participants'; END IF;
  IF (SELECT count(DISTINCT p->>'competitor_id') FROM jsonb_array_elements(p_participants) p)<>jsonb_array_length(p_participants) THEN RAISE EXCEPTION 'Duplicate participant'; END IF;
  FOR v_p IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
    IF NOT EXISTS(SELECT 1 FROM competitors WHERE id=(v_p->>'competitor_id')::UUID AND competition_id=v_t.competition_id) THEN RAISE EXCEPTION 'Participant is not registered in this competition'; END IF;
    IF NULLIF(v_p->>'qualifying_average','')::INT<=0 THEN RAISE EXCEPTION 'Qualifying average must be positive integer milliseconds'; END IF;
  END LOOP;
  DELETE FROM tournament_participants WHERE tournament_id=p_tournament_id;
  FOR v_p IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
    v_n:=v_n+1;
    INSERT INTO tournament_participants(tournament_id,competitor_id,display_name_snapshot,seed,qualifying_average,initial_slot)
      SELECT p_tournament_id,c.id,'@'||p.username,v_n,NULLIF(v_p->>'qualifying_average','')::INT,v_n
      FROM competitors c JOIN profiles p ON p.id=c.user_id WHERE c.id=(v_p->>'competitor_id')::UUID;
  END LOOP;
  UPDATE tournaments SET competitor_count=v_n,shuffle_seed=COALESCE(shuffle_seed,p_shuffle_seed) WHERE id=p_tournament_id;
  RETURN jsonb_build_object('success',true,'count',v_n);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;

CREATE OR REPLACE FUNCTION public.prepare_tournament_match(p_tournament_id UUID,p_match_id UUID,p_scramble TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_t tournaments%ROWTYPE; v_m tournament_matches%ROWTYPE; v_s tournament_match_sets%ROWTYPE;
 v_solve tournament_match_solves%ROWTYPE; v_num INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO STRICT v_t FROM tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF v_t.event_key IS NULL OR v_t.event_key IN ('333fm','333mbf') THEN RAISE EXCEPTION 'Unsupported result type'; END IF;
  IF v_t.status<>'active' OR NOT public.competition_accepts_solves(v_t.competition_id) THEN RAISE EXCEPTION 'Tournament is not active'; END IF;
  SELECT * INTO STRICT v_m FROM tournament_matches WHERE id=p_match_id AND tournament_id=p_tournament_id FOR UPDATE;
  IF v_m.status NOT IN ('pending','active') OR v_m.auto_advance OR v_m.competitor1_id IS NULL OR v_m.competitor2_id IS NULL THEN RAISE EXCEPTION 'Match is not playable'; END IF;
  SELECT * INTO v_s FROM tournament_match_sets WHERE match_id=p_match_id AND status='active' ORDER BY set_number DESC LIMIT 1;
  IF NOT FOUND THEN
    SELECT COALESCE(max(set_number),0)+1 INTO v_num FROM tournament_match_sets WHERE match_id=p_match_id;
    INSERT INTO tournament_match_sets(match_id,set_number,status) VALUES(p_match_id,v_num,'active') RETURNING * INTO v_s;
  END IF;
  SELECT * INTO v_solve FROM tournament_match_solves WHERE set_id=v_s.id AND status IN ('pending','active','tied') ORDER BY solve_number DESC,re_solve_attempt DESC LIMIT 1;
  IF v_t.scramble_source='generated' AND (v_solve.id IS NULL OR v_solve.scramble IS NULL) AND (p_scramble IS NULL OR length(btrim(p_scramble)) NOT BETWEEN 1 AND 2000) THEN RAISE EXCEPTION 'A generated scramble is required'; END IF;
  IF v_solve.id IS NULL THEN
    SELECT COALESCE(max(solve_number),0)+1 INTO v_num FROM tournament_match_solves WHERE set_id=v_s.id;
    INSERT INTO tournament_match_solves(set_id,solve_number,scramble,status) VALUES(v_s.id,v_num,p_scramble,'pending');
  ELSIF v_solve.scramble IS NULL AND v_t.scramble_source='generated' THEN
    UPDATE tournament_match_solves SET scramble=p_scramble WHERE id=v_solve.id AND scramble IS NULL;
  END IF;
  UPDATE tournament_matches SET status='active' WHERE id=p_match_id;
  RETURN jsonb_build_object('success',true,'setId',v_s.id);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;

CREATE OR REPLACE FUNCTION public.activate_tournament(p_tournament_id UUID,p_matches JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_t tournaments%ROWTYPE; v_m RECORD; v_scramble TEXT; v_result JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_is_tournament_admin(p_tournament_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  SELECT * INTO STRICT v_t FROM tournaments WHERE id=p_tournament_id FOR UPDATE;
  IF v_t.status='active' THEN RETURN jsonb_build_object('success',true); END IF;
  IF v_t.status<>'ready' OR NOT public.competition_accepts_solves(v_t.competition_id) THEN RAISE EXCEPTION 'Tournament must be ready and competition open'; END IF;
  UPDATE tournaments SET status='active' WHERE id=p_tournament_id;
  FOR v_m IN SELECT id FROM tournament_matches WHERE tournament_id=p_tournament_id AND status='pending' AND NOT auto_advance AND bracket_round=1 AND competitor1_id IS NOT NULL AND competitor2_id IS NOT NULL LOOP
    SELECT e->>'scramble' INTO v_scramble FROM jsonb_array_elements(p_matches) e WHERE e->>'id'=v_m.id::TEXT;
    v_result:=public.prepare_tournament_match(p_tournament_id,v_m.id,v_scramble);
    IF (v_result->>'success')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION '%',v_result->>'error'; END IF;
  END LOOP;
  RETURN jsonb_build_object('success',true);
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success',false,'error',SQLERRM);
END; $$;
REVOKE ALL ON FUNCTION public.replace_tournament_participants(UUID,JSONB,BIGINT),public.prepare_tournament_match(UUID,UUID,TEXT),public.activate_tournament(UUID,JSONB) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.replace_tournament_participants(UUID,JSONB,BIGINT),public.prepare_tournament_match(UUID,UUID,TEXT),public.activate_tournament(UUID,JSONB) TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.tournament_participants,public.tournament_matches,public.tournament_match_sets,public.tournament_match_solves FROM anon,authenticated;

-- Reject generated-mode result submission before the pending attempt is ready.
CREATE OR REPLACE FUNCTION public.guard_tournament_scramble()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status IN ('completed','tied') AND NEW.scramble IS NULL AND EXISTS(
   SELECT 1 FROM tournament_match_sets s JOIN tournament_matches m ON m.id=s.match_id JOIN tournaments t ON t.id=m.tournament_id WHERE s.id=NEW.set_id AND t.scramble_source='generated') THEN RAISE EXCEPTION 'Generate a scramble before entering results'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_tournament_scramble BEFORE INSERT OR UPDATE ON public.tournament_match_solves FOR EACH ROW EXECUTE FUNCTION public.guard_tournament_scramble();

-- A winners-bracket champion needs no reset; do not display an orphan pending final.
CREATE FUNCTION public.finish_unused_reset_final() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status THEN
   UPDATE tournament_matches SET status='void' WHERE tournament_id=NEW.id AND bracket_type='reset_final' AND status='pending';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER finish_unused_reset_final AFTER UPDATE ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.finish_unused_reset_final();

CREATE OR REPLACE FUNCTION public.get_my_personal_bests()
RETURNS TABLE(event_key TEXT,format TEXT,best_single INT,best_average INT,solve_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH attempts AS (
   SELECT ce.event_key,COALESCE(r.round_format,ce.event_format) format,r.id round_id,s.solve_number,
     CASE WHEN s.penalty IN ('DNF','DNS') THEN NULL WHEN s.penalty='+2' THEN s.time_ms+2000 ELSE s.time_ms END time_ms
   FROM solves s JOIN competitors c ON c.id=s.competitor_id JOIN rounds r ON r.id=s.round_id
   JOIN competition_events ce ON ce.id=r.competition_event_id
   WHERE c.user_id=auth.uid() AND c.competition_id=ce.competition_id AND ce.event_key NOT IN ('333fm','333mbf')
 ), results AS (
   SELECT event_key,format,round_id,min(time_ms) single,public.round_result(array_agg(time_ms ORDER BY solve_number),format) average,count(*) count
   FROM attempts GROUP BY event_key,format,round_id
 ) SELECT event_key,format,min(single),min(average),sum(count)::BIGINT FROM results GROUP BY event_key,format;
$$;
REVOKE ALL ON FUNCTION public.get_my_personal_bests() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_personal_bests() TO authenticated;
COMMIT;
