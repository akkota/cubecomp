"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { ScrambleCard } from "@/components/competitions/scramble-card";
import { WCA_EVENTS } from "@/lib/wca-events";
import { deriveCompetitionStatus } from "@/lib/competition-status";
import { storeScramblesAction } from "@/actions/generateScrambles";
import { generateScrambles } from "@/lib/scramble";
import { calculateAdvancementAction } from "@/actions/calculateAdvancement";
import {
  configureCompetitionVisibilityAction,
  registerForCompetitionAction,
} from "@/actions/competitionPrivacy";
import { formatTime } from "@/lib/wca-events";
import type { AdvancementResult } from "@/types/advancement";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ArrowUp,
  Play,
  Square,
  ShuffleIcon,
  Users,
  Trophy,
  CheckCircle2,
  CuboidIcon as CubeIcon,
  Shield,
  UserPlus,
  UserX,
  UserCheck,
  Video,
  XCircle,
  Clock,
  ExternalLink,
  Lock,
  Globe,
  Settings,
} from "lucide-react";

const V: Record<string, "default" | "destructive" | "secondary" | "outline"> = {
  upcoming: "default",
  ongoing: "destructive",
  completed: "secondary",
  cancelled: "outline",
};

export default function CompetitionAdminPage() {
  const { id } = useParams<{ id: string }>();
  const [competition, setCompetition] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [allRounds, setAllRounds] = useState<any[]>([]);
  const [scrambles, setScrambles] = useState<Record<string, any[]>>({});
  const [isOwner, setIsOwner] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<Record<string, boolean>>({});
  const [calculating, setCalculating] = useState<Record<string, boolean>>({});
  const [startingRound, setStartingRound] = useState<string | null>(null);
  const [endingRound, setEndingRound] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const genRef = useRef<Set<string>>(new Set());
  const startRef = useRef<string | null>(null);
  const endRef = useRef<string | null>(null);
  const regRef = useRef(false);
  const router = useRouter();
  const supabase = createClient();

  // ── Admin management state ──
  const [admins, setAdmins] = useState<any[]>([]);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminResults, setAdminResults] = useState<any[]>([]);
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [searchingAdmin, setSearchingAdmin] = useState(false);

  // ── Verification queue state ──
  const [pendingSubmissions, setPendingSubmissions] = useState<any[]>([]);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [rejectText, setRejectText] = useState<Record<string, string>>({});

  // ── Visibility / password settings ──
  const [editVisibility, setEditVisibility] = useState<"public" | "private">(
    "public",
  );
  const [editPassword, setEditPassword] = useState("");
  const [savingVisibility, setSavingVisibility] = useState(false);

  // ── Initial data fetch ──
  const fetchData = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }
    const { data: comp } = await supabase
      .from("competitions")
      .select("*")
      .eq("id", id)
      .single();
    if (!comp) {
      toast.error("Not found");
      router.push("/");
      return;
    }

    // Check if user is creator or admin
    const isCreator = comp.created_by === user.id;
    const { data: adminRow } = await supabase
      .from("competition_admins")
      .select("id")
      .eq("competition_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!isCreator && !adminRow) {
      toast.error("Not authorized");
      router.push("/");
      return;
    }

    setCompetition(comp);
    setIsOwner(isCreator);
    setEditVisibility(comp.visibility === "private" ? "private" : "public");
    setEditPassword("");
    const { data: reg } = await supabase
      .from("competitors")
      .select("id")
      .eq("competition_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    setIsRegistered(!!reg);
    const { data: ce } = await supabase
      .from("competition_events")
      .select("*")
      .eq("competition_id", id)
      .order("event_key");
    setEvents(ce ?? []);
    if (ce) {
      const eids = ce.map((e) => e.id);
      const { data: rds } = await supabase
        .from("rounds")
        .select("*")
        .in("competition_event_id", eids)
        .order("round_number");
      setAllRounds(rds ?? []);
      const rids = (rds ?? []).map((r) => r.id);
      if (rids.length > 0) {
        const { data: s } = await supabase
          .from("scrambles")
          .select("*")
          .in("round_id", rids)
          .order("scramble_number");
        const g: Record<string, any[]> = {};
        for (const sc of s ?? []) {
          if (!g[sc.round_id]) g[sc.round_id] = [];
          g[sc.round_id].push(sc);
        }
        setScrambles(g);
      }
    }
    setLoading(false);
  };

  // ── Admin list fetch ──
  const fetchAdmins = async () => {
    const { data } = await supabase
      .from("competition_admins")
      .select("*,user:user_id(id,username,display_name)")
      .eq("competition_id", id);
    setAdmins(data ?? []);
  };

  // ── Verification queue fetch ──
  const fetchVerificationQueue = async () => {
    // Get all round IDs
    const eids = events.map((e) => e.id);
    const { data: rds } = await supabase
      .from("rounds")
      .select("id,round_number,competition_event_id")
      .in("competition_event_id", eids);
    if (!rds) return;
    const roundIds = rds.map((r) => r.id);
    if (roundIds.length === 0) return;
    const { data: subs } = await supabase
      .from("round_submissions")
      .select(
        "*,competitor:competitor_id(*,user:user_id(id,username,display_name)),round:round_id(*,competition_event:competition_event_id(event_key))",
      )
      .in("round_id", roundIds)
      .not("video_url", "is", null)
      .order("created_at", { ascending: false });
    setPendingSubmissions(subs ?? []);
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const grf = (eid: string) =>
    allRounds.filter((r) => r.competition_event_id === eid);
  const we = (k: string) => WCA_EVENTS.find((e) => e.key === k);

  const hgs = async (r: any, ek: string, sc: number) => {
    if (genRef.current.has(r.id)) return;
    genRef.current.add(r.id);
    setGenerating((p) => ({ ...p, [r.id]: true }));
    try {
      // Generate in the browser — cubing.js workers are reliable there.
      // The server only persists (avoids serverless worker hangs / fake timeouts).
      const texts = await generateScrambles(ek, sc);
      await storeScramblesAction(r.id, ek, texts);
      const { data: f } = await supabase
        .from("scrambles")
        .select("*")
        .eq("round_id", r.id)
        .order("scramble_number");
      setScrambles((p) => ({ ...p, [r.id]: f ?? [] }));
      toast.success(`Scrambles generated`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate scrambles");
    } finally {
      setGenerating((p) => ({ ...p, [r.id]: false }));
      genRef.current.delete(r.id);
    }
  };

  const updateRoundField = async (
    roundId: string,
    field: string,
    value: any,
  ) => {
    const { error } = await supabase
      .from("rounds")
      .update({ [field]: value })
      .eq("id", roundId);
    if (!error)
      setAllRounds((p) =>
        p.map((r) => (r.id === roundId ? { ...r, [field]: value } : r)),
      );
  };

  const syncCompStatus = async (rounds: any[]) => {
    const { data: eff } = await supabase.rpc("refresh_competition_status", { comp_id: id });
    const status =
      (typeof eff === "string" && eff) ||
      deriveCompetitionStatus(rounds, {
        status: competition?.status,
        startsAt: competition?.starts_at,
        endsAt: competition?.ends_at,
        competitionType: competition?.competition_type,
      });
    setCompetition((prev: any) =>
      prev
        ? {
            ...prev,
            status: status === "cancelled" ? "cancelled" : status,
            ends_at:
              status === "completed" && !prev.ends_at
                ? new Date().toISOString()
                : prev.ends_at,
          }
        : prev,
    );
  };

  const hsr = async (rid: string) => {
    if (startRef.current) return;
    startRef.current = rid;
    setStartingRound(rid);
    const { error } = await supabase
      .from("rounds")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", rid);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Round started!");
      const up = allRounds.map((r) =>
        r.id === rid
          ? { ...r, status: "active", started_at: new Date().toISOString() }
          : r,
      );
      setAllRounds(up);
      syncCompStatus(up);
    }
    setStartingRound(null);
    startRef.current = null;
  };

  const hasAdvancementRule = (r: {
    advancement_mode?: string | null;
    advancement_value?: number | null;
    advance_count?: number | null;
  }) => {
    const mode = r.advancement_mode || (r.advance_count ? "fixed" : null);
    const value = r.advancement_value ?? r.advance_count ?? null;
    if (!mode || value === null || value === undefined || Number(value) < 1)
      return false;
    if (mode === "percentage" && Number(value) > 100) return false;
    return true;
  };

  const her = async (rid: string, hasNextRound: boolean) => {
    if (endRef.current) return;
    const round = allRounds.find((r) => r.id === rid);
    if (hasNextRound && (!round || !hasAdvancementRule(round))) {
      toast.error(
        "Set a qualification method (fixed count or percentage) and value before ending this round.",
      );
      return;
    }
    endRef.current = rid;
    setEndingRound(rid);
    const { error } = await supabase
      .from("rounds")
      .update({ status: "completed", ended_at: new Date().toISOString() })
      .eq("id", rid);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Round ended!");
      const up = allRounds.map((r) =>
        r.id === rid
          ? { ...r, status: "completed", ended_at: new Date().toISOString() }
          : r,
      );
      setAllRounds(up);
      syncCompStatus(up);
    }
    setEndingRound(null);
    endRef.current = null;
  };

  const hca = async (r: any) => {
    setCalculating((p) => ({ ...p, [r.id]: true }));
    try {
      const res = await calculateAdvancementAction(r.id);
      if (!res.success) toast.error(res.error);
      else if (res.alreadyCalculated)
        toast.success(`Already calculated — ${res.advanced} advanced`);
      else if (res.advanced === 0) toast.warning(`No one advanced`);
      else toast.success(`${res.advanced} of ${res.total} advanced`);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCalculating((p) => ({ ...p, [r.id]: false }));
    }
  };

  const hrc = async () => {
    if (regRef.current) return;
    regRef.current = true;
    setRegistering(true);
    try {
      const result = await registerForCompetitionAction(id);
      if (!result.success) {
        if (result.error.includes("Already registered")) {
          toast.success("Already registered!");
          setIsRegistered(true);
        } else toast.error(result.error);
      } else {
        toast.success("Registered as competitor!");
        setIsRegistered(true);
      }
    } finally {
      setRegistering(false);
      regRef.current = false;
    }
  };

  const saveVisibility = async () => {
    if (
      editVisibility === "private" &&
      competition?.visibility !== "private" &&
      editPassword.trim().length < 4
    ) {
      toast.error(
        "Private competitions require a password of at least 4 characters",
      );
      return;
    }
    if (
      editVisibility === "private" &&
      editPassword.trim().length > 0 &&
      editPassword.trim().length < 4
    ) {
      toast.error("Password must be at least 4 characters");
      return;
    }
    setSavingVisibility(true);
    try {
      const result = await configureCompetitionVisibilityAction(
        id,
        editVisibility,
        editPassword.trim() ? editPassword.trim() : null,
      );
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setCompetition((prev: any) =>
        prev
          ? { ...prev, visibility: result.visibility ?? editVisibility }
          : prev,
      );
      setEditPassword("");
      toast.success(
        editVisibility === "private"
          ? "Visibility updated. Registered competitors keep access."
          : "Competition is now public.",
      );
    } finally {
      setSavingVisibility(false);
    }
  };

  // ── Admin search ──
  const searchUsers = async (q: string) => {
    setAdminSearch(q);
    if (q.length < 2) {
      setAdminResults([]);
      return;
    }
    setSearchingAdmin(true);
    const { data } = await supabase
      .from("profiles")
      .select("id,username,display_name")
      .ilike("username", `%${q}%`)
      .limit(10);
    setAdminResults(data ?? []);
    setSearchingAdmin(false);
  };

  const addAdmin = async (profileId: string) => {
    setAddingAdmin(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("competition_admins")
      .insert({ competition_id: id, user_id: profileId, added_by: user.id });
    if (error) {
      if (error.code === "23505") toast.warning("Already an admin");
      else toast.error(error.message);
    } else {
      toast.success("Admin added!");
      await fetchAdmins();
    }
    setAddingAdmin(false);
    setAdminSearch("");
    setAdminResults([]);
  };

  const removeAdmin = async (adminId: string) => {
    const { error } = await supabase
      .from("competition_admins")
      .delete()
      .eq("id", adminId);
    if (error) toast.error(error.message);
    else {
      toast.success("Admin removed");
      await fetchAdmins();
    }
  };

  // ── Verification actions ──
  const verifySubmission = async (subId: string) => {
    setVerifyingId(subId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("round_submissions")
      .update({
        verification_status: "verified",
        verified_by: user?.id,
        verified_at: new Date().toISOString(),
        rejected_reason: null,
      })
      .eq("id", subId);
    if (error) toast.error(error.message);
    else {
      toast.success("Verified!");
      await fetchVerificationQueue();
    }
    setVerifyingId(null);
  };

  const rejectSubmission = async (subId: string) => {
    const reason = rejectText[subId]?.trim();
    setVerifyingId(subId);
    const { error } = await supabase
      .from("round_submissions")
      .update({
        verification_status: "rejected",
        rejected_reason: reason || "No reason given",
      })
      .eq("id", subId);
    if (error) toast.error(error.message);
    else {
      toast.success("Rejected");
      await fetchVerificationQueue();
    }
    setVerifyingId(null);
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20">
        <CubeIcon className="h-8 w-8 text-text-tertiary/30 animate-pulse" />
      </div>
    );
  if (!competition)
    return (
      <div className="text-center py-20 text-text-secondary">Not found.</div>
    );

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-border bg-surface p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cube-orange/10 p-2">
              <Shield className="h-5 w-5 text-cube-orange" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                {competition.name}
              </h1>
              <p className="text-sm text-text-secondary">
                Manage rounds, scrambles, admins, and verifications
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline">{competition.status}</Badge>
            {competition.visibility === "private" ? (
              <Badge
                variant="outline"
                className="gap-1 border-cube-orange/40 text-cube-orange"
              >
                <Lock className="h-3 w-3" />
                Private
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <Globe className="h-3 w-3" />
                Public
              </Badge>
            )}
            {isRegistered ? (
              <Badge variant="secondary" className="gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-cube-green" />
                Competing
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={hrc}
                disabled={registering}
                className="gap-2"
              >
                <Trophy className="h-4 w-4" />
                {registering ? "…" : "Compete as Competitor"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs
        defaultValue="rounds"
        onValueChange={(v) => {
          if (v === "admins") fetchAdmins();
          if (v === "verification") fetchVerificationQueue();
        }}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="rounds" className="gap-2">
            <ShuffleIcon className="h-4 w-4 text-cube-blue" />
            Rounds
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4 text-cube-orange" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="admins" className="gap-2">
            <UserCheck className="h-4 w-4 text-cube-green" />
            Admins
          </TabsTrigger>
          {competition.require_verified_solves && (
            <TabsTrigger value="verification" className="gap-2">
              <Video className="h-4 w-4 text-cube-red" />
              Verification Queue
            </TabsTrigger>
          )}
        </TabsList>

        {/* ═══════════════ ROUNDS TAB ═══════════════ */}
        <TabsContent value="rounds">
          <div className="grid gap-6">
            {events.map((ce) => {
              const ei = we(ce.event_key);
              const ers = grf(ce.id);
              const sc = ei?.solveCount ?? 5;
              return (
                <Card key={ce.id} className="overflow-hidden">
                  <CardHeader className="border-b border-border bg-muted pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {ei?.icon} {ei?.name}
                      <Badge variant="outline" className="ml-auto text-xs">
                        {ce.round_count} rounds
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 divide-y divide-border/30">
                    {ers.map((r) => {
                      const rs = scrambles[r.id] || [];
                      const hs = rs.length > 0;
                      const hnr = r.round_number < ce.round_count;
                      const rf = (r.round_format || ce.event_format) as
                        | "average"
                        | "mean";
                      const rSolveCount = rf === "mean" ? 3 : 5;
                      const advMode =
                        r.advancement_mode ||
                        (r.advance_count ? "fixed" : null);
                      const advVal =
                        r.advancement_value ?? r.advance_count ?? null;
                      const advancementReady = hasAdvancementRule(r);
                      const canEndRound = !hnr || advancementReady;
                      return (
                        <div key={r.id} className="px-4 py-4 sm:px-6">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                              <h3 className="font-semibold">
                                Round {r.round_number}
                              </h3>
                              <Badge variant={V[r.status] ?? "outline"}>
                                {r.status}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {r.status === "pending" && (
                                <>
                                  {competition.generate_scrambles !== false && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={generating[r.id] || hs}
                                      onClick={() =>
                                        hgs(r, ce.event_key, rSolveCount)
                                      }
                                      className="gap-1.5"
                                    >
                                      <ShuffleIcon className="h-3.5 w-3.5" />
                                      {generating[r.id]
                                        ? "Generating…"
                                        : hs
                                          ? "Has Scrambles"
                                          : "Generate Scrambles"}
                                    </Button>
                                  )}
                                  {(hs ||
                                    competition.generate_scrambles ===
                                      false) && (
                                    <Button
                                      variant="default"
                                      size="sm"
                                      disabled={!!startingRound}
                                      onClick={() => hsr(r.id)}
                                      className="gap-1.5"
                                    >
                                      <Play className="h-3.5 w-3.5" />
                                      {startingRound === r.id
                                        ? "Starting…"
                                        : "Start"}
                                    </Button>
                                  )}
                                </>
                              )}
                              {r.status === "active" && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={!!endingRound || !canEndRound}
                                  onClick={() => her(r.id, hnr)}
                                  className="gap-1.5"
                                  title={
                                    !canEndRound
                                      ? "Set a qualification method before ending this round"
                                      : undefined
                                  }
                                >
                                  <Square className="h-3.5 w-3.5" />
                                  {endingRound === r.id
                                    ? "Ending…"
                                    : "End Round"}
                                </Button>
                              )}
                              {r.status === "completed" && hnr && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  disabled={calculating[r.id]}
                                  onClick={() => hca(r)}
                                  className="gap-1.5"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                  {calculating[r.id]
                                    ? "Calculating…"
                                    : "Calculate Advancement"}
                                </Button>
                              )}
                            </div>
                          </div>
                          {r.status === "pending" && (
                            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="text-text-secondary">
                                  Format:
                                </span>
                                <Select
                                  value={rf}
                                  onValueChange={(v) =>
                                    updateRoundField(r.id, "round_format", v)
                                  }
                                >
                                  <SelectTrigger className="h-8 w-24 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="average">Ao5</SelectItem>
                                    <SelectItem value="mean">Mo3</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                          {hnr &&
                            (r.status === "pending" ||
                              r.status === "active") && (
                              <div className="mt-3 flex flex-col gap-2">
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                  <Users className="h-4 w-4 text-text-tertiary" />
                                  <span className="text-text-secondary">
                                    Qualification:
                                  </span>
                                  <Select
                                    value={advMode || ""}
                                    onValueChange={(v) => {
                                      if (!v) {
                                        updateRoundField(
                                          r.id,
                                          "advancement_mode",
                                          null,
                                        );
                                        updateRoundField(
                                          r.id,
                                          "advancement_value",
                                          null,
                                        );
                                        return;
                                      }
                                      updateRoundField(
                                        r.id,
                                        "advancement_mode",
                                        v,
                                      );
                                    }}
                                  >
                                    <SelectTrigger className="h-8 w-36 text-xs">
                                      <SelectValue placeholder="Required" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="fixed">
                                        Fixed count
                                      </SelectItem>
                                      <SelectItem value="percentage">
                                        Percentage
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {advMode && (
                                    <Input
                                      type="number"
                                      className="w-16 h-8 text-xs"
                                      min={1}
                                      max={advMode === "percentage" ? 100 : 999}
                                      placeholder={
                                        advMode === "fixed" ? "8" : "60"
                                      }
                                      value={advVal ?? ""}
                                      onChange={(e) => {
                                        const v = parseInt(
                                          e.target.value || "0",
                                        );
                                        if (v > 0) {
                                          updateRoundField(
                                            r.id,
                                            "advancement_value",
                                            v,
                                          );
                                          updateRoundField(
                                            r.id,
                                            "advancement_mode",
                                            advMode,
                                          );
                                        } else {
                                          updateRoundField(
                                            r.id,
                                            "advancement_value",
                                            null,
                                          );
                                        }
                                      }}
                                    />
                                  )}
                                  {advMode === "fixed" && (
                                    <span className="text-xs text-text-tertiary">
                                      advance to round {r.round_number + 1}
                                    </span>
                                  )}
                                  {advMode === "percentage" && (
                                    <span className="text-xs text-text-tertiary">
                                      % advance to round {r.round_number + 1}
                                    </span>
                                  )}
                                </div>
                                {r.status === "active" && !advancementReady && (
                                  <p className="text-xs text-cube-orange">
                                    Choose a qualification method and value
                                    before ending this round.
                                  </p>
                                )}
                              </div>
                            )}
                          {hs && (
                            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                              {rs.map((s) => (
                                <ScrambleCard
                                  key={s.id}
                                  eventKey={ce.event_key}
                                  scramble={s.scramble}
                                  label={s.scramble_number}
                                  compact
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* ═══════════════ SETTINGS TAB ═══════════════ */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                {editVisibility === "private" ? (
                  <Lock className="h-5 w-5 text-cube-orange" />
                ) : (
                  <Globe className="h-5 w-5 text-cube-blue" />
                )}
                Visibility &amp; password
              </CardTitle>
              <CardDescription>
                Private competitions require a password before registration.
                Changing the password does not remove existing registered
                competitors.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditVisibility("public")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    editVisibility === "public"
                      ? "border-cube-blue/40 bg-cube-blue/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  <Globe className="h-4 w-4" /> Public
                </button>
                <button
                  type="button"
                  onClick={() => setEditVisibility("private")}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all ${
                    editVisibility === "private"
                      ? "border-cube-orange/40 bg-cube-orange/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  <Lock className="h-4 w-4" /> Private
                </button>
              </div>
              {editVisibility === "private" && (
                <div className="space-y-2">
                  <Label htmlFor="admin-comp-password">
                    {competition.visibility === "private"
                      ? "New password (optional)"
                      : "Competition password *"}
                  </Label>
                  <Input
                    id="admin-comp-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      competition.visibility === "private"
                        ? "Leave blank to keep current password"
                        : "At least 4 characters"
                    }
                    value={editPassword}
                    onChange={(e) => setEditPassword(e.target.value)}
                    className="h-10"
                  />
                  <p className="text-xs text-text-secondary">
                    Passwords are hashed server-side and never returned to the
                    client. Knowing the password alone does not grant scramble
                    or submit access.
                  </p>
                </div>
              )}
              <Button
                onClick={saveVisibility}
                disabled={savingVisibility}
                className="gap-2"
              >
                {savingVisibility ? "Saving…" : "Save visibility"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════ ADMINS TAB ═══════════════ */}
        <TabsContent value="admins">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-cube-green" /> Competition
                Admins
              </CardTitle>
              <CardDescription>
                Admins can manage rounds, scrambles, and verify solves. They
                cannot remove the creator or manage other admins.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Current admins */}
              {admins.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {admins.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-3.5 sm:px-5"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cube-green/10">
                          <UserCheck className="h-4 w-4 text-cube-green" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold tracking-tight">
                            {a.user?.display_name || a.user?.username || 'Admin'}
                          </p>
                          {a.user?.username && (
                            <p className="truncate text-xs text-text-tertiary">
                              @{a.user.username}
                            </p>
                          )}
                        </div>
                      </div>
                      {isOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeAdmin(a.id)}
                          className="cursor-pointer text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <UserX className="h-4 w-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Add admin — only creator */}
              {isOwner && (
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">Add Admin</h4>
                  <Input
                    type="text"
                    placeholder="Search by username…"
                    value={adminSearch}
                    onChange={(e) => searchUsers(e.target.value)}
                    className="h-10"
                  />
                  {searchingAdmin && (
                    <p className="text-xs text-text-secondary">Searching…</p>
                  )}
                  {adminResults.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {adminResults
                        .filter((r) => r.id !== competition.created_by)
                        .map((r) => (
                          <li
                            key={r.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted px-4 py-3 sm:px-5"
                          >
                            <span className="truncate text-sm font-medium">
                              {r.display_name || r.username}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => addAdmin(r.id)}
                              disabled={addingAdmin}
                              className="cursor-pointer gap-1"
                            >
                              <UserPlus className="h-3.5 w-3.5" /> Add
                            </Button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {adminSearch.length >= 2 &&
                    adminResults.length === 0 &&
                    !searchingAdmin && (
                      <p className="text-xs text-text-secondary">
                        No matching users found.
                      </p>
                    )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══════════════ VERIFICATION QUEUE TAB ═══════════════ */}
        {competition.require_verified_solves && (
          <TabsContent value="verification">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Video className="h-5 w-5 text-cube-red" /> Verification Queue
                </CardTitle>
                <CardDescription>
                  Review video submissions and verify or reject them. Only
                  verified competitors can advance.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {pendingSubmissions.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <CheckCircle2 className="h-8 w-8 text-cube-green/40" />
                    <p className="text-sm text-text-secondary">
                      No submissions pending verification.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/20">
                    {pendingSubmissions
                      .filter((s) => s.verification_status !== "verified")
                      .map((sub) => {
                        const wca = WCA_EVENTS.find(
                          (e) =>
                            e.key === sub.round?.competition_event?.event_key,
                        );
                        const statusIcon =
                          sub.verification_status === "pending" ? (
                            <Clock className="h-3.5 w-3.5 text-cube-yellow" />
                          ) : sub.verification_status === "rejected" ? (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-cube-green" />
                          );
                        const statusLabel =
                          sub.verification_status === "pending"
                            ? "Pending"
                            : sub.verification_status === "rejected"
                              ? "Rejected"
                              : "Verified";
                        const statusColor =
                          sub.verification_status === "pending"
                            ? "bg-cube-yellow/10 text-cube-yellow border-cube-yellow/20"
                            : sub.verification_status === "rejected"
                              ? "bg-destructive/10 text-destructive border-destructive/20"
                              : "bg-cube-green/10 text-cube-green border-cube-green/20";
                        return (
                          <div
                            key={sub.id}
                            className="py-4 first:pt-0 last:pb-0"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{wca?.icon}</span>
                                  <span className="font-medium truncate">
                                    {sub.competitor?.user?.display_name ||
                                      sub.competitor?.user?.username}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${statusColor}`}
                                  >
                                    {statusIcon}
                                    {statusLabel}
                                  </Badge>
                                </div>
                                <p className="text-xs text-text-secondary mt-1">
                                  {wca?.name} — Round {sub.round?.round_number}
                                  {sub.rejected_reason && (
                                    <span className="block text-destructive mt-1">
                                      Reason: {sub.rejected_reason}
                                    </span>
                                  )}
                                </p>
                                {sub.video_url && (
                                  <a
                                    href={sub.video_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 mt-2 text-xs text-cube-blue hover:underline"
                                  >
                                    <ExternalLink className="h-3 w-3" /> Watch
                                    Video
                                  </a>
                                )}
                              </div>
                              {sub.verification_status !== "verified" && (
                                <div className="flex items-start gap-2 shrink-0">
                                  <div className="flex flex-col gap-1">
                                    {sub.verification_status === "rejected" && (
                                      <Input
                                        type="text"
                                        placeholder="Rejection reason…"
                                        value={rejectText[sub.id] || ""}
                                        onChange={(e) =>
                                          setRejectText((p) => ({
                                            ...p,
                                            [sub.id]: e.target.value,
                                          }))
                                        }
                                        className="h-8 w-40 text-xs"
                                      />
                                    )}
                                    <div className="flex gap-2">
                                      <Button
                                        variant="default"
                                        size="sm"
                                        disabled={verifyingId === sub.id}
                                        onClick={() => verifySubmission(sub.id)}
                                        className="gap-1 h-8 text-xs"
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                        {verifyingId === sub.id
                                          ? "…"
                                          : "Verify"}
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={verifyingId === sub.id}
                                        onClick={() => rejectSubmission(sub.id)}
                                        className="gap-1 h-8 text-xs text-destructive"
                                      >
                                        <XCircle className="h-3.5 w-3.5" />{" "}
                                        Reject
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
