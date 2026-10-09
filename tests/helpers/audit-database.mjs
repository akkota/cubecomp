import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { generateBracket } from '../../src/lib/tournament/bracket-engine.ts';

const q = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const json = value => JSON.stringify(value);
const ok = result => assert.equal(result.success, true, json(result));
const fail = (result, pattern) => {
  assert.equal(result.success, false, json(result));
  if (pattern) assert.match(result.error, pattern);
};

export async function auditDatabaseTests(t, { sql: rawSql, asUser: rawUser, asUserAsync, rpc: rawRpc, database, owner, participant }) {
  const sql = query => rawSql(database, query);
  const as = (user, query) => rawUser(database, user, query);
  const rpc = (user, name, ...args) => rawRpc(database, user, name, ...args);
  const fixture = (details = {}, events = [{ key: '333', format: 'average', roundCount: 2 }]) => {
    const result = rpc(owner, 'create_competition', json({ name: 'Audit fixture', generate_scrambles: false, ...details }), json(events), details.visibility === 'private' ? 'secret-password' : null);
    ok(result);
    const rounds = JSON.parse(sql(`SELECT json_agg(r.id ORDER BY round_number) FROM rounds r JOIN competition_events ce ON ce.id=r.competition_event_id WHERE ce.competition_id=${q(result.id)};`));
    ok(rpc(participant, 'register_for_competition', result.id, 'secret-password'));
    const competitor = sql(`SELECT id FROM competitors WHERE competition_id=${q(result.id)} AND user_id=${q(participant)};`);
    return { id: result.id, rounds, competitor };
  };
  const times = (count = 5, time = 10000) => Array.from({ length: count }, (_, i) => ({ solve_number: i + 1, time_ms: time, penalty: 'none' }));
  const submit = (f, entries = times(), round = f.rounds[0]) => rpc(participant, 'submit_round_times', round, f.id, json(entries));
  const activate = f => sql(`UPDATE rounds SET status='active' WHERE id=${q(f.rounds[0])};`);

  await t.test('all privileged implementation helpers are inaccessible to client roles', () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal(sql(`SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND
        (p.proname IN ('place_competitor_in_match','clear_competitor_from_match','propagate_tournament_byes','advance_after_match_win','advance_after_solve_win') OR p.proname LIKE '\\_audit\\_%' ESCAPE '\\')
        AND has_function_privilege(${q(role)},p.oid,'EXECUTE');`), '0');
    }
    assert.throws(() => as(participant, `SELECT advance_after_match_win(${q(randomUUID())},${q(randomUUID())});`), /permission denied/);
    const f = fixture(); activate(f);
    assert.throws(() => as(participant, `INSERT INTO solves(round_id,competitor_id,solve_number,time_ms) VALUES(${q(f.rounds[0])},${q(f.competitor)},1,10);`), /permission denied/);
  });

  await t.test('atomic private creation and invalid events leave no partial competitions', () => {
    const before = sql('SELECT count(*) FROM competitions;');
    fail(rpc(owner, 'create_competition', json({ name: 'Invalid fixture', visibility: 'private' }), json([{ key: '333', format: 'average', roundCount: 1 }, { key: '333fm', format: 'mean', roundCount: 1 }]), 'secret-password'), /Unsupported/);
    assert.equal(sql('SELECT count(*) FROM competitions;'), before);
    const f = fixture({ visibility: 'private' });
    assert.equal(sql(`SELECT visibility FROM competitions WHERE id=${q(f.id)};`), 'private');
    assert.equal(sql(`SELECT count(*) FROM competition_secrets WHERE competition_id=${q(f.id)};`), '1');
    assert.equal(sql(`SELECT count(*) FROM rounds WHERE id IN (${f.rounds.map(q)});`), '2');
    assert.throws(() => as(participant, 'SELECT * FROM competition_secrets;'), /permission denied/);
  });

  await t.test('solve RPC rejects malformed batches, duplicates, cross-competition IDs, and closed rounds atomically', () => {
    const f = fixture(); const other = fixture(); activate(f);
    fail(submit(f, times(3)), /exactly/);
    const bad = times(); bad[4].time_ms = -1;
    fail(submit(f, bad), /Invalid/);
    bad[4].time_ms = null; fail(submit(f, bad), /Invalid/);
    bad[4] = { ...bad[0] }; fail(submit(f, bad), /Duplicate/);
    fail(rpc(participant, 'submit_round_times', f.rounds[0], other.id, json(times())), /not open/);
    fail(rpc(owner, 'submit_round_times', f.rounds[0], f.id, json(times())), /Not eligible/);
    assert.equal(sql(`SELECT count(*) FROM solves WHERE round_id=${q(f.rounds[0])};`), '0');
    ok(submit(f)); fail(submit(f), /already submitted/);
    assert.equal(sql(`SELECT count(*) FROM solves WHERE round_id=${q(f.rounds[0])} AND submitted_by=${q(participant)};`), '5');
    const expired = fixture();
    sql(`INSERT INTO scrambles(round_id,scramble_number,scramble) VALUES(${q(expired.rounds[0])},1,'R U'); UPDATE rounds SET status='active' WHERE id=${q(expired.rounds[0])}; UPDATE competitions SET ends_at=now()-interval '1 minute' WHERE id=${q(expired.id)};`);
    fail(submit(expired), /not open/);
    assert.equal(as(participant, `SELECT count(*) FROM scrambles WHERE round_id=${q(expired.rounds[0])};`), '0');
    const cancelled = fixture(); activate(cancelled);
    sql(`UPDATE competitions SET status='cancelled' WHERE id=${q(cancelled.id)};`);
    fail(submit(cancelled), /not open/);
    assert.throws(() => sql(`INSERT INTO solves(round_id,competitor_id,solve_number,time_ms) VALUES(${q(f.rounds[1])},${q(other.competitor)},1,100);`), /does not match/);
  });

  await t.test('concurrent solve batches serialize and persist exactly one submission', async () => {
    const f = fixture(); activate(f);
    const query = `SELECT submit_round_times(${q(f.rounds[0])},${q(f.id)},${q(json(times()))});`;
    const responses = await Promise.all([asUserAsync(database, participant, query), asUserAsync(database, participant, query)]);
    assert.equal(responses.map(JSON.parse).filter(r => r.success).length, 1);
    assert.equal(sql(`SELECT count(*) FROM solves WHERE round_id=${q(f.rounds[0])};`), '5');
  });

  await t.test('scramble batches freeze formats and incomplete batches cannot start', () => {
    const f = fixture({ generate_scrambles: true });
    sql(`INSERT INTO scrambles(round_id,scramble_number,scramble) VALUES(${q(f.rounds[0])},1,'R U');`);
    assert.throws(() => sql(`UPDATE rounds SET round_format='mean' WHERE id=${q(f.rounds[0])};`), /Format is locked/);
    assert.throws(() => activate(f), /complete scramble batch/);
    sql(`INSERT INTO scrambles(round_id,scramble_number,scramble) SELECT ${q(f.rounds[0])},n,'R U' FROM generate_series(2,5)n;`);
    activate(f);
  });

  await t.test('evidence can be supplied after times and rejected evidence can be corrected; qualification can be recalculated', () => {
    const f = fixture({ require_verified_solves: true }); activate(f); ok(submit(f));
    sql(`UPDATE rounds SET status='completed',advancement_mode='fixed',advancement_value=1 WHERE id=${q(f.rounds[0])};`);
    fail(rpc(owner, 'calculate_round_advancement', f.rounds[0]), /Review all/);
    fail(rpc(participant, 'submit_round_evidence', f.rounds[0], 'https://youtube.com.evil.test/watch?v=abc'), /valid HTTPS/);
    ok(rpc(participant, 'submit_round_evidence', f.rounds[0], 'https://youtu.be/abcdef'));
    sql(`UPDATE round_submissions SET verification_status='rejected',verified_by=${q(owner)},rejected_reason='wrong clip' WHERE round_id=${q(f.rounds[0])};`);
    ok(rpc(participant, 'submit_round_evidence', f.rounds[0], 'https://www.youtube.com/watch?v=corrected'));
    assert.equal(sql(`SELECT verification_status||':'||coalesce(rejected_reason,'') FROM round_submissions WHERE round_id=${q(f.rounds[0])};`), 'pending:');
    const submission = sql(`SELECT id FROM round_submissions WHERE round_id=${q(f.rounds[0])};`);
    fail(rpc(participant, 'review_round_evidence', submission, 'verified', null), /Not authorized/);
    ok(rpc(owner, 'review_round_evidence', submission, 'verified', null));
    ok(rpc(owner, 'calculate_round_advancement', f.rounds[0]));
    assert.equal(sql(`SELECT count(*) FROM round_participants WHERE round_id=${q(f.rounds[1])};`), '1');
    ok(rpc(owner, 'review_round_evidence', submission, 'rejected', 'incorrect video'));
    assert.equal(sql(`SELECT count(*) FROM round_participants WHERE round_id=${q(f.rounds[1])};`), '0');
    assert.throws(() => sql(`UPDATE rounds SET status='active' WHERE id=${q(f.rounds[1])};`), /Calculate qualification/);
    ok(rpc(owner, 'calculate_round_advancement', f.rounds[0]));
    assert.equal(sql(`SELECT count(*) FROM round_participants WHERE round_id=${q(f.rounds[1])};`), '0');
    sql(`UPDATE round_submissions SET verification_status='verified' WHERE round_id=${q(f.rounds[0])};`);
    ok(rpc(owner, 'calculate_round_advancement', f.rounds[0]));
    sql(`UPDATE rounds SET status='active' WHERE id=${q(f.rounds[1])};`);
    fail(rpc(owner, 'calculate_round_advancement', f.rounds[0]), /locked/);
    assert.throws(() => sql(`UPDATE round_submissions SET verification_status='rejected' WHERE round_id=${q(f.rounds[0])};`), /locked/);
    fail(rpc(participant, 'submit_round_evidence', f.rounds[0], 'https://youtu.be/next'), /locked/);
  });

  await t.test('evidence URLs remain private to their author and competition admins', () => {
    const f = fixture({ require_verified_solves: true }); activate(f);
    ok(rpc(participant, 'submit_round_evidence', f.rounds[0], 'https://youtu.be/privateVideo'));
    const stranger = randomUUID();
    sql(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(${q(stranger)},${q(stranger + '@example.test')},${q(json({ username: stranger }))});`);
    assert.equal(as(stranger, `SELECT count(*) FROM round_submissions WHERE round_id=${q(f.rounds[0])};`), '0');
    assert.equal(as(owner, `SELECT count(*) FROM round_submissions WHERE round_id=${q(f.rounds[0])};`), '1');
    assert.equal(as(participant, `SELECT count(*) FROM round_submissions WHERE round_id=${q(f.rounds[0])};`), '1');
    const publicStatus = JSON.parse(sql(`BEGIN; SET LOCAL ROLE anon; SELECT json_agg(s) FROM get_round_verification_statuses(${q(f.rounds[0])}) s; COMMIT;`));
    assert.deepEqual(Object.keys(publicStatus[0]).sort(), ['competitor_id', 'verification_status']);
  });

  await t.test('lifetime PB aggregation keeps formats and round boundaries distinct and exceeds 1000 solves', () => {
    const f = fixture({}, [{ key: '222', format: 'average', roundCount: 3 }]);
    sql(`UPDATE rounds SET round_format='mean' WHERE id=${q(f.rounds[2])};
      INSERT INTO solves(round_id,competitor_id,solve_number,time_ms,penalty)
        SELECT ${q(f.rounds[0])},${q(f.competitor)},n,CASE WHEN n<=2 THEN 1 ELSE 10000 END,'none' FROM generate_series(1,5)n;
      INSERT INTO solves(round_id,competitor_id,solve_number,time_ms,penalty)
        SELECT ${q(f.rounds[1])},${q(f.competitor)},n,CASE WHEN n<=2 THEN 1 ELSE 20000 END,'none' FROM generate_series(1,5)n;
      INSERT INTO solves(round_id,competitor_id,solve_number,time_ms,penalty)
        SELECT ${q(f.rounds[2])},${q(f.competitor)},n,3000,'none' FROM generate_series(1,3)n;
      INSERT INTO rounds(competition_event_id,round_number,round_format)
        SELECT competition_event_id,n,'average' FROM rounds CROSS JOIN generate_series(4,204)n WHERE id=${q(f.rounds[0])};
      INSERT INTO solves(round_id,competitor_id,solve_number,time_ms,penalty)
        SELECT r.id,${q(f.competitor)},n,50000,'none' FROM rounds r CROSS JOIN generate_series(1,5)n WHERE r.competition_event_id=(SELECT competition_event_id FROM rounds WHERE id=${q(f.rounds[0])}) AND r.round_number>=4;`);
    const stats = JSON.parse(as(participant, 'SELECT json_agg(p) FROM get_my_personal_bests() p;')).filter(p => p.event_key === '222');
    assert.equal(stats.find(p => p.format === 'mean').best_average, 3000);
    assert.equal(stats.find(p => p.format === 'average').best_average, 6667);
    assert.equal(stats.find(p => p.format === 'average').solve_count, 1015);
    assert.equal(JSON.parse(as(owner, 'SELECT coalesce(json_agg(p),\'[]\'::json) FROM get_my_personal_bests() p;')).length, 0);
  });

  await t.test('advancement includes results beyond 1000 solves and preserves cutoff ties', () => {
    const f = fixture();
    const users = Array.from({ length: 210 }, () => randomUUID());
    sql(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ${users.map(id => `(${q(id)},${q(id + '@example.test')},${q(json({ username: id }))})`).join(',')};
      INSERT INTO competitors(competition_id,user_id) SELECT ${q(f.id)},id FROM auth.users WHERE id IN (${users.map(q)});
      INSERT INTO solves(round_id,competitor_id,solve_number,time_ms,penalty)
      SELECT ${q(f.rounds[0])},c.id,n,10000,'none' FROM competitors c CROSS JOIN generate_series(1,5)n WHERE c.competition_id=${q(f.id)};
      UPDATE rounds SET status='completed',advancement_mode='fixed',advancement_value=1 WHERE id=${q(f.rounds[0])};`);
    const result = rpc(owner, 'calculate_round_advancement', f.rounds[0]); ok(result);
    assert.equal(result.total, 211); assert.equal(result.advanced, 211);
    assert.equal(sql(`SELECT count(*) FROM round_participants WHERE round_id=${q(f.rounds[1])};`), '211');
  });

  await t.test('profile UPDATE succeeds under RLS without granting profile INSERT', () => {
    assert.equal(as(participant, `UPDATE profiles SET display_name='Updated participant' WHERE id=${q(participant)} RETURNING display_name;`), 'Updated participant');
    assert.throws(() => as(participant, `INSERT INTO profiles(id,username) VALUES(${q(participant)},'other') ON CONFLICT(id) DO UPDATE SET display_name='bad';`), /row-level security/);
  });

  await t.test('private password verification is throttled through both unlock and registration RPCs', () => {
    const f = fixture({ visibility: 'private' });
    sql(`DELETE FROM competition_access WHERE competition_id=${q(f.id)}; DELETE FROM competitors WHERE id=${q(f.competitor)}; DELETE FROM competition_unlock_attempts WHERE competition_id=${q(f.id)};`);
    for (let i = 0; i < 10; i++) fail(rpc(participant, i % 2 ? 'register_for_competition' : 'unlock_private_competition', f.id, 'wrong'), /Incorrect/);
    fail(rpc(participant, 'unlock_private_competition', f.id, 'secret-password'), /Too many/);
    sql(`UPDATE competition_unlock_attempts SET window_started=now()-interval '16 minutes' WHERE competition_id=${q(f.id)};`);
    ok(rpc(participant, 'unlock_private_competition', f.id, 'secret-password'));
  });

  await t.test('tournament setup is atomic, generated attempts require scrambles, and registered access survives rotation', async () => {
    const f = fixture({ competition_type: 'head_to_head', visibility: 'private' }, [{ key: '333', format: 'average', roundCount: 1 }]);
    sql(`INSERT INTO competitors(competition_id,user_id) VALUES(${q(f.id)},${q(owner)});`);
    const c2 = sql(`SELECT id FROM competitors WHERE competition_id=${q(f.id)} AND user_id=${q(owner)};`);
    const tid = randomUUID();
    sql(`INSERT INTO tournaments(id,competition_id,created_by,name,event_key,tournament_type,seeding_type,match_format,scramble_source,status,competitor_count) VALUES(${q(tid)},${q(f.id)},${q(owner)},'Audit tournament','333','single','seeded','bo3','generated','draft',0);`);
    const selected = [{ competitor_id: f.competitor, qualifying_average: 10000 }, { competitor_id: c2, qualifying_average: 20000 }];
    ok(rpc(owner, 'replace_tournament_participants', tid, json(selected), '1'));
    fail(rpc(owner, 'replace_tournament_participants', tid, json([selected[0], { competitor_id: randomUUID() }]), '1'), /not registered/);
    assert.equal(sql(`SELECT count(*) FROM tournament_participants WHERE tournament_id=${q(tid)};`), '2');
    fail(rpc(participant, 'replace_tournament_participants', tid, json(selected), '1'), /Not authorized/);
    const def = generateBracket({ participantCount: 2, tournamentType: 'single', seedingType: 'seeded' });
    const matches = def.matches.map((m, i) => ({ bracket_type: m.bracketType, bracket_round: m.bracketRound, match_number: m.matchNumber, bracket_index: i,
      slot1_seed: m.slot1Seed, slot2_seed: m.slot2Seed, is_bye: m.isBye, next_match_idx: m.nextMatchIndex, next_match_slot: m.nextMatchSlot, loser_next_match_idx: m.loserNextMatchIndex, loser_next_match_slot: m.loserNextMatchSlot }));
    ok(rpc(owner, 'generate_tournament_bracket', tid, json(selected.map((p, i) => ({ ...p, seed: i + 1, initial_slot: i + 1 }))), json(matches)));
    fail(rpc(owner, 'activate_tournament', tid, '[]'), /scramble/);
    assert.equal(sql(`SELECT status FROM tournaments WHERE id=${q(tid)};`), 'ready');
    assert.equal(sql(`SELECT count(*) FROM tournament_match_sets s JOIN tournament_matches m ON m.id=s.match_id WHERE m.tournament_id=${q(tid)};`), '0');
    const mid = sql(`SELECT id FROM tournament_matches WHERE tournament_id=${q(tid)} AND NOT auto_advance LIMIT 1;`);
    ok(rpc(owner, 'activate_tournament', tid, json([{ id: mid, scramble: 'R U' }])));
    const sid = sql(`SELECT id FROM tournament_match_sets WHERE match_id=${q(mid)};`);
    let solve = sql(`SELECT id FROM tournament_match_solves WHERE set_id=${q(sid)} ORDER BY solve_number DESC LIMIT 1;`);
    const submitQuery = `SELECT submit_tournament_solve(${q(tid)},${q(mid)},${q(sid)},${q(solve)},1,1,10000,'none',11000,'none');`;
    const outcomes = await Promise.all([asUserAsync(database, owner, submitQuery), asUserAsync(database, owner, submitQuery)]);
    assert.equal(outcomes.map(JSON.parse).filter(r => r.success).length, 1);
    assert.equal(sql(`SELECT competitor1_solve_wins FROM tournament_match_sets WHERE id=${q(sid)};`), '1');
    solve = sql(`SELECT id FROM tournament_match_solves WHERE set_id=${q(sid)} AND status IN ('pending','active');`);
    assert.ok(solve);
    fail(rpc(owner, 'submit_tournament_solve', tid, mid, sid, solve, '1', '2', '10000', 'none', '11000', 'none'), /Generate a scramble/);
    ok(rpc(owner, 'prepare_tournament_match', tid, mid, 'F U'));
    ok(rpc(owner, 'submit_tournament_solve', tid, mid, sid, solve, '1', '2', '10000', 'none', '10000', 'none'));
    assert.equal(sql(`SELECT status FROM tournament_match_solves WHERE id=${q(solve)};`), 'tied');
    ok(rpc(owner, 're_solve_tournament_tie', tid, solve, 'L U'));
    assert.equal(sql(`SELECT status FROM tournament_match_solves WHERE id=${q(solve)};`), 'superseded');
    const retry = sql(`SELECT id FROM tournament_match_solves WHERE set_id=${q(sid)} AND solve_number=2 AND re_solve_attempt=1;`);
    ok(rpc(owner, 'submit_tournament_solve', tid, mid, sid, retry, '1', '2', '10000', 'none', '10000', 'none'));
    const winner = sql(`SELECT competitor1_id FROM tournament_matches WHERE id=${q(mid)};`);
    ok(rpc(owner, 'admin_resolve_tournament_tie', tid, retry, winner, 'Video review'));
    assert.equal(sql(`SELECT competitor1_solve_wins FROM tournament_match_sets WHERE id=${q(sid)};`), '2');
    ok(rpc(owner, 'undo_tournament_solve', tid, retry));
    assert.equal(sql(`SELECT competitor1_solve_wins FROM tournament_match_sets WHERE id=${q(sid)};`), '1');
    ok(rpc(owner, 'configure_competition_visibility', f.id, 'private', 'rotated-password'));
    assert.equal(as(participant, `SELECT count(*) FROM tournaments WHERE id=${q(tid)};`), '1');
    fail(rpc(participant, 'submit_tournament_solve', tid, mid, sid, solve, '1', '2', '10000', 'none', '11000', 'none'), /Not authorized/);
  });
  for (const [count, kind, reset] of [[3, 'single', false], [4, 'double', false], [5, 'double', true]]) {
    await t.test(`actual SQL bracket ${kind}, N=${count}, reset=${reset}: routing, champion and undo`, () => {
      const f = fixture({ competition_type: 'head_to_head' }, [{ key: '333', format: 'average', roundCount: 1 }]);
      const users = Array.from({ length: count - 1 }, () => randomUUID());
      sql(`INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES ${users.map(id => `(${q(id)},${q(id + '@example.test')},${q(json({ username: id }))})`).join(',')};
        INSERT INTO competitors(competition_id,user_id) SELECT ${q(f.id)},id FROM auth.users WHERE id IN (${users.map(q)});`);
      const ids = JSON.parse(sql(`SELECT json_agg(id ORDER BY id) FROM competitors WHERE competition_id=${q(f.id)};`));
      const tid = randomUUID();
      sql(`INSERT INTO tournaments(id,competition_id,created_by,name,event_key,tournament_type,seeding_type,match_format,scramble_source,status,competitor_count) VALUES(${q(tid)},${q(f.id)},${q(owner)},'Trace bracket','333',${q(kind)},'seeded','bo3','external','draft',0);`);
      const selected = ids.map((id, i) => ({ competitor_id: id, seed: i + 1, initial_slot: i + 1 }));
      ok(rpc(owner, 'replace_tournament_participants', tid, json(selected), '1'));
      const def = generateBracket({ participantCount: count, tournamentType: kind, seedingType: 'seeded' });
      const rows = def.matches.map((m, i) => ({ bracket_type: m.bracketType, bracket_round: m.bracketRound, match_number: m.matchNumber, bracket_index: i,
        slot1_seed: m.slot1Seed, slot2_seed: m.slot2Seed, is_bye: m.isBye, next_match_idx: m.nextMatchIndex, next_match_slot: m.nextMatchSlot,
        loser_next_match_idx: m.loserNextMatchIndex, loser_next_match_slot: m.loserNextMatchSlot }));
      ok(rpc(owner, 'generate_tournament_bracket', tid, json(selected), json(rows)));
      ok(rpc(owner, 'activate_tournament', tid, '[]'));
      let lastSolve; let lastWinner; let finished = false;
      for (let step = 0; step < 300; step++) {
        const state = JSON.parse(sql(`SELECT row_to_json(t) FROM tournaments t WHERE id=${q(tid)};`));
        if (state.status === 'completed') { assert.equal(state.champion_id, lastWinner); finished = true; break; }
        const m = JSON.parse(sql(`SELECT row_to_json(m) FROM tournament_matches m WHERE tournament_id=${q(tid)} AND status IN ('pending','active') AND NOT auto_advance AND competitor1_id IS NOT NULL AND competitor2_id IS NOT NULL ORDER BY bracket_index LIMIT 1;`) || 'null');
        assert.ok(m, 'bracket stalled'); assert.notEqual(m.competitor1_id, m.competitor2_id);
        ok(rpc(owner, 'prepare_tournament_match', tid, m.id, null));
        const set = JSON.parse(sql(`SELECT row_to_json(s) FROM tournament_match_sets s WHERE match_id=${q(m.id)} AND status='active';`));
        const solve = JSON.parse(sql(`SELECT row_to_json(s) FROM tournament_match_solves s WHERE set_id=${q(set.id)} AND status IN ('active','pending') ORDER BY solve_number DESC LIMIT 1;`));
        const winnerSlot = reset && m.bracket_type === 'grand_final' ? 2 : 1;
        lastWinner = winnerSlot === 1 ? m.competitor1_id : m.competitor2_id; lastSolve = solve.id;
        ok(rpc(owner, 'submit_tournament_solve', tid, m.id, set.id, solve.id, String(set.set_number), String(solve.solve_number), winnerSlot === 1 ? '1000' : '2000', 'none', winnerSlot === 2 ? '1000' : '2000', 'none'));
      }
      assert.ok(finished);
      const resetStatus = sql(`SELECT status FROM tournament_matches WHERE tournament_id=${q(tid)} AND bracket_type='reset_final';`);
      if (kind === 'double') assert.equal(resetStatus, reset ? 'completed' : 'void');
      ok(rpc(owner, 'undo_tournament_solve', tid, lastSolve));
      assert.equal(sql(`SELECT status FROM tournaments WHERE id=${q(tid)};`), 'active');
      assert.equal(sql(`SELECT champion_id IS NULL FROM tournaments WHERE id=${q(tid)};`), 't');
    });
  }

}
