import { useState } from "react";
import PartnerApplication from "./PartnerApplication";
import PlatformReview from "./PlatformReview";
import "./partner.css";
import { BookOpen, GraduationCap, Building2, Users, ClipboardCheck, CalendarDays, BarChart3, Settings, Bell, Search, ArrowUpRight, ShieldCheck, Menu, X, ChevronDown, Sparkles, FileText, CircleHelp, Layers3, Clock3 } from "lucide-react";

const nav = [
  { label: "Overview", icon: BarChart3 },
  { label: "Institutions", icon: Building2 },
  { label: "Learners & staff", icon: Users },
  { label: "Learning", icon: BookOpen },
  { label: "Assessments", icon: ClipboardCheck },
  { label: "Academic calendar", icon: CalendarDays },
  { label: "Reports", icon: FileText },
];
const activities = [
  { title: "New institution request", detail: "Mundri Technical Training Centre", time: "18 minutes ago", state: "Review required", tone: "amber" },
  { title: "Semester results submitted", detail: "School of Applied and Industrial Sciences", time: "1 hour ago", state: "Awaiting approval", tone: "blue" },
  { title: "Capacity notice", detail: "Juba Learning Institute · 80% of active-user limit", time: "3 hours ago", state: "Notice sent", tone: "green" },
];
function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? "brand-small" : ""}`}><img src="/brand/sawalearn-mark.svg" alt="" /><span>Sawa<span className="brand-accent">Learn</span><small>LEARN. GROW. LEAD.</small></span></div>;
}
function App() {
  const [active, setActive] = useState("Overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showNotice, setShowNotice] = useState(true);
  if (window.location.pathname === "/partners/apply") return <PartnerApplication />;
  if (window.location.pathname === "/platform/review") return <PlatformReview />;
  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
      <div className="sidebar-top"><Brand /><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X size={19}/></button></div>
      <div className="workspace-label">PLATFORM WORKSPACE</div>
      <button className="workspace-switch"><span className="workspace-avatar"><ShieldCheck size={17}/></span><span><b>Platform control</b><small>Super administrator</small></span><ChevronDown size={16}/></button>
      <nav aria-label="Main navigation">{nav.map(({label,icon:Icon}) => <button key={label} className={`nav-item ${active===label?"nav-active":""}`} onClick={() => {setActive(label);setMenuOpen(false)}}><Icon size={18}/><span>{label}</span>{label==="Institutions" && <span className="nav-count">12</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><span className="help-icon"><CircleHelp size={18}/></span><b>Need a hand?</b><p>Explore the SawaLearn admin guide and platform support.</p><button onClick={() => setActive("Help centre")}>Open help centre <ArrowUpRight size={14}/></button></div><button className="nav-item" onClick={() => setActive("Settings")}><Settings size={18}/> Settings</button><div className="profile-row"><div className="profile-avatar">SA</div><span><b>Platform owner</b><small>Owner workspace</small></span><ChevronDown size={16}/></div></div>
    </aside>
    {menuOpen && <button className="scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={20}/></button><div className="breadcrumbs">Platform <span>/</span> <b>{active}</b></div><div className="top-actions"><a className="partner-entry-link" href="/partners/apply">Partner application <ArrowUpRight size={14}/></a><label className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search anything..." aria-label="Search platform"/><kbd>⌘ K</kbd></label><button className="icon-button notification-button" aria-label="Notifications"><Bell size={19}/><i/></button><div className="top-avatar">SA</div></div></header>
      <div className="page-content">
        <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> PLATFORM OVERVIEW</div><h1>{active==="Overview"?"Good morning.":active}</h1><p className="subtitle">{active==="Overview"?"Here’s what’s happening across your learning network today.":"Manage your learning network with clear oversight and institution-level control."}</p></div><div className="date-pill"><CalendarDays size={16}/> Friday, 23 October 2026</div></div>
        {showNotice && <div className="notice-banner"><div className="notice-symbol"><Sparkles size={18}/></div><div><b>Your learning network, in one place</b><p>Review institution requests, monitor capacity and keep academic operations moving.</p></div><button className="notice-link" onClick={()=>setActive("Institutions")}>Review institutions <ArrowUpRight size={15}/></button><button className="notice-close" onClick={()=>setShowNotice(false)} aria-label="Dismiss announcement"><X size={16}/></button></div>}
        <div className="demo-data-warning"><ShieldCheck size={16}/><span><b>Preview mode:</b> dashboard figures and institution records are sample data, not live partner records.</span><a href="/partners/apply">Open partner application <ArrowUpRight size={13}/></a></div><section className="stats-grid" aria-label="Platform metrics">
          <article className="stat-card"><div className="stat-head"><span>Institutions</span><span className="stat-icon indigo"><Building2 size={18}/></span></div><div className="stat-value">12</div><div className="stat-foot"><span className="positive">+2 this month</span><span>Across your network</span></div><div className="mini-bars"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></article>
          <article className="stat-card"><div className="stat-head"><span>Active learners</span><span className="stat-icon teal"><GraduationCap size={19}/></span></div><div className="stat-value">8,426</div><div className="stat-foot"><span className="positive">+8.4%</span><span>vs. last month</span></div><div className="stat-line"><i style={{width:"72%"}}/></div><small className="stat-caption">Network active-user capacity</small></article>
          <article className="stat-card"><div className="stat-head"><span>Teaching staff</span><span className="stat-icon blue"><Users size={18}/></span></div><div className="stat-value">684</div><div className="stat-foot"><span className="neutral">Across all institutions</span></div><div className="avatar-stack"><i>JM</i><i>AK</i><i>PW</i><i>+681</i></div></article>
          <article className="stat-card"><div className="stat-head"><span>Pending reviews</span><span className="stat-icon amber"><Clock3 size={18}/></span></div><div className="stat-value">7</div><div className="stat-foot"><span className="warning-text">Needs attention</span><span>Institution & results</span></div><button className="text-action" onClick={()=>setActive("Institutions")}>Review queue <ArrowUpRight size={14}/></button></article>
        </section>
        <section className="content-grid">
          <article className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Updates across the platform</p></div><button className="subtle-button" onClick={()=>setActive("Reports")}>View activity <ArrowUpRight size={14}/></button></div><div className="activity-list">{activities.filter(a=>(a.title+" "+a.detail).toLowerCase().includes(search.toLowerCase())).map((item,i)=><div className="activity-item" key={item.title}><div className={`activity-icon activity-${item.tone}`}>{i===0?<Building2 size={17}/>:i===1?<ClipboardCheck size={17}/>:<Users size={17}/>}</div><div className="activity-copy"><b>{item.title}</b><p>{item.detail}</p><small>{item.time}</small></div><span className={`status status-${item.tone}`}>{item.state}</span></div>)}{activities.filter(a=>(a.title+" "+a.detail).toLowerCase().includes(search.toLowerCase())).length===0&&<p className="empty-state">No recent activity matches “{search}”.</p>}</div></article>
          <article className="panel quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common platform tasks</p></div><Layers3 size={19} className="muted-icon"/></div><button className="quick-action" onClick={()=>setActive("Institutions")}><span className="quick-icon quick-indigo"><Building2 size={18}/></span><span><b>Review institution requests</b><small>Approve eligible institutions</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={()=>setActive("Learners & staff")}><span className="quick-icon quick-teal"><Users size={18}/></span><span><b>Manage users</b><small>Roles, status and access</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={()=>setActive("Reports")}><span className="quick-icon quick-blue"><BarChart3 size={18}/></span><span><b>View platform reports</b><small>Usage and institution health</small></span><ArrowUpRight size={16}/></button><button className="quick-action" onClick={()=>setActive("Settings")}><span className="quick-icon quick-amber"><Settings size={18}/></span><span><b>Configure platform</b><small>Plans, policies and preferences</small></span><ArrowUpRight size={16}/></button></article>
        </section>
        <section className="bottom-grid"><article className="panel institution-panel"><div className="panel-heading"><div><h2>Institution health</h2><p>Illustrative dashboard preview · connect live data during integration</p></div><button className="subtle-button" onClick={()=>setActive("Institutions")}>All institutions <ArrowUpRight size={14}/></button></div><div className="institution-table"><div className="table-head"><span>INSTITUTION</span><span>ACTIVE USERS</span><span>PLAN</span><span>STATUS</span></div>{[{name:"Juba Learning Institute",type:"University",users:"1,240 / 1,500",plan:"Professional",status:"Active",tone:"green",initial:"JL"},{name:"Mundri Technical Centre",type:"Vocational centre",users:"186 / 200",plan:"Starter",status:"Capacity notice",tone:"amber",initial:"MT"},{name:"Bright Future Academy",type:"School",users:"640 / 1,000",plan:"Standard",status:"Active",tone:"green",initial:"BF"}].map(row=><div className="table-row" key={row.name}><div className="institution-name"><span className="institution-avatar">{row.initial}</span><span><b>{row.name}</b><small>{row.type}</small></span></div><span className="table-users">{row.users}</span><span className="plan-label">{row.plan}</span><span className={`status status-${row.tone}`}>{row.status}</span></div>)}</div></article><article className="panel readiness-panel"><div className="panel-heading"><div><h2>Platform readiness</h2><p>Implementation milestones</p></div><span className="readiness-count">1 of 7</span></div><div className="readiness-progress"><i/></div><div className="milestone"><span className="milestone-check"><ShieldCheck size={16}/></span><span><b>Stage 1 · Foundation</b><small>Initial setup and brand system</small></span><span className="milestone-state">In progress</span></div><div className="milestone muted-milestone"><span className="milestone-empty">2</span><span><b>Stage 2 · Platform admin</b><small>Approvals, plans and receipts</small></span><span className="lock-label">Planned</span></div><p className="readiness-note">Sample interface only. Operational metrics, actions and institution records must be connected to the secured backend before production use.</p></article></section>
        <footer className="footer"><Brand small/><span>© 2026 SawaLearn · One platform. Every learning journey.</span><span className="footer-secure"><ShieldCheck size={14}/> Security-first by design</span></footer>
      </div>
    </main>
  </div>;
}
export default App;