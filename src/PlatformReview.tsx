import { useEffect, useState, type FormEvent } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import { ArrowLeft, CheckCircle2, LogIn, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type Application = {
  id: string; legal_name: string; display_name: string; institution_type: string; country_code: string;
  contact_name: string; contact_email: string; contact_phone: string; website: string | null;
  estimated_learners: number; message: string | null; status: string; created_at: string;
  reviewed_at: string | null; review_notes: string | null;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "");
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

export default function PlatformReview() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [applications, setApplications] = useState<Application[]>([]);
  const [filter, setFilter] = useState("pending_review");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  async function loadQueue(current = session, selected = filter) {
    if (!current || !apiBase) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/v1/platform/partner-applications?status=${encodeURIComponent(selected)}`, {
        headers: { Authorization: `Bearer ${current.access_token}` },
      });
      const result = await response.json() as { applications?: Application[]; message?: string };
      if (!response.ok) throw new Error(result.message || "Unable to load the application queue.");
      setApplications(result.applications || []);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load applications."); }
    finally { setBusy(false); }
  }

  useEffect(() => { if (session) void loadQueue(session, filter); }, [session, filter]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      if (!supabase) throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the frontend build environment.");
      if (!apiBase) throw new Error("Set VITE_API_BASE_URL to the deployed SawaLearn Worker API.");
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) throw authError;
    } catch (e) { setError(e instanceof Error ? e.message : "Sign-in failed."); }
    finally { setBusy(false); }
  }

  async function review(application: Application, status: "under_review" | "rejected") {
    if (!session || !apiBase) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/v1/platform/partner-applications/${application.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status, reviewNotes: notes[application.id] || "" }),
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message || "Could not save the review decision.");
      setNotice(status === "rejected" ? "Application marked as rejected." : "Application moved to under review.");
      await loadQueue(session, filter);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save review."); }
    finally { setBusy(false); }
  }

  async function signOut() { await supabase?.auth.signOut(); setApplications([]); }

  return <main className="review-page">
    <header className="review-header"><a href="/" className="partner-brand"><img src="/brand/sawalearn-mark.svg" alt=""/><span>Sawa<span>Learn</span><small>PLATFORM OPERATIONS</small></span></a><a href="/" className="partner-back"><ArrowLeft size={16}/> Dashboard</a></header>
    <section className="review-content">
      {!session ? <div className="review-login">
        <div className="review-icon"><ShieldCheck size={24}/></div><p className="review-kicker">RESTRICTED ACCESS</p><h1>Platform review</h1><p className="review-muted">Sign in with an approved platform operator account to review partner applications.</p>
        {!supabase && <div className="review-error">Frontend Supabase credentials are not configured.</div>}
        {error && <div className="review-error" role="alert">{error}</div>}
        <form onSubmit={signIn}><label>Email address<input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Password<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="partner-submit" disabled={busy || !supabase}>{busy ? "Signing in…" : "Sign in to review"} <LogIn size={16}/></button></form>
        <p className="review-footnote">Sign-in alone does not grant review permission. The API checks platform membership on every request.</p>
      </div> : <>
        <div className="review-title-row"><div><p className="review-kicker">PARTNER ONBOARDING</p><h1>Application review queue</h1><p className="review-muted">Review applications submitted by institutions. Approval and administrator invitations are intentionally not enabled until the secure provisioning workflow is complete.</p></div><button className="review-signout" onClick={signOut}>Sign out</button></div>
        <div className="review-toolbar"><div className="review-tabs">{[{value:"pending_review",label:"New applications"},{value:"under_review",label:"Under review"},{value:"rejected",label:"Rejected"}].map(t=><button key={t.value} className={filter===t.value?"review-tab active":"review-tab"} onClick={()=>setFilter(t.value)}>{t.label}</button>)}</div><button className="review-refresh" onClick={()=>void loadQueue()} disabled={busy}><RefreshCw size={15}/> Refresh</button></div>
        {error && <div className="review-error" role="alert">{error}</div>}{notice && <div className="review-notice"><CheckCircle2 size={16}/>{notice}</div>}
        {busy && applications.length===0 ? <div className="review-empty">Loading applications…</div> : applications.length===0 ? <div className="review-empty"><CheckCircle2 size={24}/><b>No applications in this queue</b><span>New partner submissions will appear here once saved in Supabase.</span></div> :
          <div className="review-list">{applications.map(a=><article className="review-card" key={a.id}>
            <div className="review-card-head"><div><span className="review-status">{a.status.replaceAll("_"," ")}</span><h2>{a.display_name}</h2><p>{a.legal_name} · {a.country_code} · {a.institution_type.replaceAll("_"," ")}</p></div><time>{new Date(a.created_at).toLocaleDateString()}</time></div>
            <div className="review-details"><div><small>CONTACT</small><b>{a.contact_name}</b><a href={`mailto:${a.contact_email}`}>{a.contact_email}</a><span>{a.contact_phone}</span></div><div><small>ESTIMATED LEARNERS</small><b>{a.estimated_learners.toLocaleString()}</b>{a.website && <a href={a.website} target="_blank" rel="noreferrer">Institution website ↗</a>}</div></div>
            {a.message && <p className="review-message">{a.message}</p>}
            <label className="review-notes-label">Internal review notes<textarea rows={2} maxLength={1000} value={notes[a.id] ?? a.review_notes ?? ""} onChange={e=>setNotes(v=>({...v,[a.id]:e.target.value}))} placeholder="Add notes for the review record (optional)"/></label>
            {a.status!=="rejected" && <div className="review-actions"><button className="review-under" disabled={busy} onClick={()=>void review(a,"under_review")}><CheckCircle2 size={15}/> Mark under review</button><button className="review-reject" disabled={busy} onClick={()=>void review(a,"rejected")}><XCircle size={15}/> Reject application</button></div>}
          </article>)}</div>}
      </>}
    </section>
    <footer className="partner-footer"><span>© 2026 SawaLearn</span><span>Platform access is role-checked by the API.</span><span><ShieldCheck size={14}/> Restricted operations</span></footer>
  </main>;
}
