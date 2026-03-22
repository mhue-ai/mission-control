import { useState, useEffect, useCallback, useMemo } from "react";
import InfraPanel from "./InfraPanel";

/* ═══════════════════════════════════════════════════════════════════════
   Mission Control v4 — OpenClaw-aligned layout
   ═══════════════════════════════════════════════════════════════════════ */

const api = async (path, opts = {}) => {
  const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('mc_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...opts.headers } });
  if (res.status === 401 && typeof window !== 'undefined') { window.location.href = '/login'; return null; }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
};
const apiGet = (p) => api(p);
const apiPost = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const apiPatch = (p, b) => api(p, { method: 'PATCH', body: JSON.stringify(b) });
const apiDelete = (p) => api(p, { method: 'DELETE' });

// ─── Icons (compact) ───────────────────────────────────────────────
const I=({t,s=16,c})=>{const st={width:s,height:s,display:"inline-block",verticalAlign:"middle",flexShrink:0};c=c||"currentColor";const m={
  chart:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-7"/></svg>,
  kanban:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="2" y="3" width="6" height="18" rx="1.5"/><rect x="9" y="3" width="6" height="12" rx="1.5"/><rect x="16" y="3" width="6" height="15" rx="1.5"/></svg>,
  agent:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2a5 5 0 015 5v2a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M8 14s-4 2-4 6h16c0-4-4-6-4-6"/></svg>,
  plan:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>,
  server:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="3" y="3" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><circle cx="7" cy="6" r="1" fill={c}/><circle cx="7" cy="16" r="1" fill={c}/></svg>,
  link:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
  shield:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2l8 4v6c0 5.25-3.5 9.75-8 11-4.5-1.25-8-5.75-8-11V6l8-4z"/></svg>,
  zap:<svg style={st} viewBox="0 0 24 24" fill={c} stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  gear:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  play:<svg style={st} viewBox="0 0 24 24" fill={c}><polygon points="6,3 20,12 6,21"/></svg>,
  pause:<svg style={st} viewBox="0 0 24 24" fill={c}><rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/></svg>,
  stop:<svg style={st} viewBox="0 0 24 24" fill={c}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  refresh:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>,
  plus:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  trash:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>,
};return m[t]||null;};

const fmtTime=s=>{if(!s)return"never";const d=Math.floor((Date.now()-new Date(s).getTime())/1000);return d<60?d+"s ago":d<3600?Math.floor(d/60)+"m ago":Math.floor(d/3600)+"h ago";};
const fmtTok=n=>n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?Math.floor(n/1e3)+"K":""+n;

// ─── UI primitives ─────────────────────────────────────────────────
function Dot({status,size=8}){const c={online:"#22c55e",connected:"#22c55e",completed:"#22c55e",active:"#22c55e",healthy:"#22c55e",done:"#22c55e",running:"#3b82f6",degraded:"#f59e0b",paused:"#f59e0b",queued:"#8b5cf6",offline:"#ef4444",disconnected:"#ef4444",failed:"#ef4444",stopped:"#ef4444",error:"#ef4444",idle:"#6b7280",draft:"#6b7280",onboarding:"#e85d24",archived:"#4b5563"};const pulse=["online","connected","running","active","healthy"].includes(status);return <span style={{position:"relative",display:"inline-block",width:size,height:size}}>{pulse&&<span style={{position:"absolute",inset:-2,borderRadius:"50%",background:c[status]||"#666",opacity:.3,animation:"pulse-ring 2s ease-out infinite"}}/>}<span style={{display:"block",width:size,height:size,borderRadius:"50%",background:c[status]||"#666"}}/></span>;}
function Card({children,style,...p}){return <div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:12,padding:16,...style}} {...p}>{children}</div>;}
function Badge({color,children}){const c={green:{bg:"#0d2818",t:"#22c55e",b:"#143d24"},red:{bg:"#2a0f0f",t:"#ef4444",b:"#3d1616"},yellow:{bg:"#2a2008",t:"#f59e0b",b:"#3d2e0f"},blue:{bg:"#0c1a2e",t:"#3b82f6",b:"#132d4a"},purple:{bg:"#1a0f2e",t:"#8b5cf6",b:"#26174a"},gray:{bg:"#1a1c22",t:"#6b7080",b:"#25272e"},orange:{bg:"#2a1508",t:"#e85d24",b:"#4a2812"}}[color]||{bg:"#1a1c22",t:"#6b7080",b:"#25272e"};return <span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:6,background:c.bg,color:c.t,border:`1px solid ${c.b}`,textTransform:"uppercase",letterSpacing:".03em"}}>{children}</span>;}
function Btn({onClick,children,v="default",sm,disabled,title}){const s={default:{bg:"#161a24",h:"#1e2230",b:"#1e2430",c:"#d4d8e0"},danger:{bg:"#2a0f0f",h:"#3d1616",b:"#3d1616",c:"#ef4444"},primary:{bg:"#2a1508",h:"#3d1f0f",b:"#4a2812",c:"#e85d24"},success:{bg:"#0d2818",h:"#143d24",b:"#143d24",c:"#22c55e"}}[v];return <button onClick={onClick} disabled={disabled} title={title} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:sm?11:12,fontWeight:500,padding:sm?"4px 10px":"6px 14px",borderRadius:8,border:`1px solid ${s.b}`,background:s.bg,color:s.c,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1}} onMouseEnter={e=>{if(!disabled)e.target.style.background=s.h}} onMouseLeave={e=>{if(!disabled)e.target.style.background=s.bg}}>{children}</button>;}
function Metric({label,value,sub,color,icon}){return <div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:10,padding:"14px 16px",flex:1,minWidth:110}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>{icon&&<I t={icon} s={13} c="#5a6070"/>}<span style={{fontSize:10,color:"#5a6070",textTransform:"uppercase",letterSpacing:".04em"}}>{label}</span></div><div style={{fontSize:22,fontWeight:600,color:color||"#f0f2f5"}}>{value}</div>{sub&&<div style={{fontSize:11,color:"#5a6070",marginTop:2}}>{sub}</div>}</div>;}
function Section({children,icon,action}){return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}><div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:500,color:"#8b90a0",textTransform:"uppercase",letterSpacing:".05em"}}>{icon&&<I t={icon} s={14}/>}{children}</div>{action}</div>;}
const Input=({value,onChange,placeholder,style,...p})=><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:8,color:"#d4d8e0",padding:"8px 12px",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box",...style}} {...p}/>;
const Select=({value,onChange,children,style})=><select value={value} onChange={e=>onChange(e.target.value)} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:6,color:"#d4d8e0",fontSize:11,padding:"6px 8px",...style}}>{children}</select>;
function Overlay({children,onClose,locked}){const ref=useState(null);return <div ref={r=>ref[1]?null:null} onClick={e=>{if(!locked&&e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}><Card style={{width:520,maxHeight:"85vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>{children}</Card></div>;}

const sBadge=s=>{const m={running:"blue",active:"green",completed:"green",done:"green",healthy:"green",connected:"green",paused:"yellow",queued:"purple",idle:"gray",draft:"gray",stopped:"red",error:"red",failed:"red",disconnected:"red",onboarding:"orange",archived:"gray"};return <Badge color={m[s]||"gray"}>{s}</Badge>;};
const pBadge=p=><Badge color={{critical:"red",high:"orange",normal:"gray",low:"gray"}[p]||"gray"}>{p}</Badge>;

// ─── Sidebar nav item ──────────────────────────────────────────────
function NavItem({icon,label,active,onClick}){
  return <button onClick={onClick} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 16px",border:"none",borderRadius:8,background:active?"#1a1e2c":"transparent",color:active?"#f0f2f5":"#6b7080",cursor:"pointer",fontSize:13,fontWeight:active?500:400,textAlign:"left",transition:"all .1s"}} onMouseEnter={e=>{if(!active)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent"}}>
    <I t={icon} s={16} c={active?"#e85d24":"#5a6070"}/>{label}
  </button>;
}
function NavSection({label}){
  return <div style={{fontSize:10,fontWeight:500,color:"#3a3e50",textTransform:"uppercase",letterSpacing:".08em",padding:"16px 16px 6px"}}>{label}</div>;
}

// ═══════════════════════════════════════════════════════════════════════
export default function MissionControl(){
  const [view,setView]=useState("overview");
  const [health,setHealth]=useState(null);
  const [agents,setAgents]=useState([]);
  const [gateways,setGateways]=useState([]);
  const [workplans,setWorkplans]=useState([]);
  const [events,setEvents]=useState([]);
  const [kanban,setKanban]=useState(null);
  const [loading,setLoading]=useState(true);
  const [currentUser,setCurrentUser]=useState(null);
  const [sidebarW,setSidebarW]=useState(200);

  const refresh = useCallback(async () => {
    try {
      const [h,ag,gw,wp,ev,kb] = await Promise.all([
        apiGet('/api/health'), apiGet('/api/agents'), apiGet('/api/managed-gateways'),
        apiGet('/api/workplans'), apiGet('/api/events').catch(()=>[]),
        apiGet('/api/kanban/boards/main').catch(()=>null),
      ]);
      setHealth(h); setAgents(ag||[]); setGateways(gw||[]); setWorkplans(wp||[]);
      setEvents(ev||[]); setKanban(kb); setLoading(false);
    } catch(e){ console.error('Refresh:',e); setLoading(false); }
  },[]);

  useEffect(()=>{ refresh(); const iv=setInterval(refresh,8000); return ()=>clearInterval(iv); },[refresh]);
  useEffect(()=>{
    try { const u = sessionStorage.getItem('mc_user'); if (u) setCurrentUser(JSON.parse(u)); } catch {}
    apiGet('/api/auth/me').then(u => { if (u) setCurrentUser(u); }).catch(() => {});
  }, []);

  const agentAction = async(id,action)=>{ await apiPost(`/api/agents/${id}/${action}`); refresh(); };
  const deleteAgent = async(id)=>{ await apiDelete(`/api/agents/${id}`); refresh(); };

  const isAdmin = currentUser?.role === 'admin';
  const canWrite = currentUser?.role === 'admin' || currentUser?.role === 'editor';

  const stats = useMemo(()=>({
    agents:agents.length, running:agents.filter(a=>a.status==='running').length,
    gateways:gateways.length, gwOnline:gateways.filter(g=>g.status==='connected').length,
    workplans:workplans.length, wpActive:workplans.filter(w=>w.status==='active').length,
    cards:kanban?.columns?.reduce((s,c)=>s+c.cards.length,0)||0,
  }),[agents,gateways,workplans,kanban]);

  if(loading) return <div style={{fontFamily:"'DM Sans',sans-serif",background:"#0a0c10",color:"#5a6070",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>🦞</div><div style={{fontSize:13}}>Loading...</div></div></div>;

  return <div style={{fontFamily:"'DM Sans',sans-serif",background:"#0a0c10",color:"#d4d8e0",minHeight:"100vh",display:"flex"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');@keyframes pulse-ring{0%{transform:scale(1);opacity:.3}100%{transform:scale(2.2);opacity:0}}.mono{font-family:'JetBrains Mono',monospace}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#1a1e2c;border-radius:3px}`}</style>

    {/* ─── Sidebar ─────────────────────────────────────────── */}
    <nav style={{width:sidebarW,minWidth:180,maxWidth:280,background:"#090b0f",borderRight:"1px solid #12151e",display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
      {/* Logo */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"16px 16px 8px",cursor:"pointer"}} onClick={()=>setView("overview")}>
        <span style={{fontSize:22}}>🦞</span>
        <span style={{fontSize:14,fontWeight:600,color:"#f0f2f5"}}>Mission Control</span>
      </div>

      {/* Nav sections */}
      <div style={{flex:1,overflow:"auto",padding:"4px 8px"}}>
        <NavSection label="Dashboard"/>
        <NavItem icon="chart" label="Overview" active={view==="overview"} onClick={()=>setView("overview")}/>
        <NavItem icon="kanban" label="Kanban" active={view==="kanban"} onClick={()=>setView("kanban")}/>
        <NavItem icon="plan" label="Workplans" active={view==="workplans"} onClick={()=>setView("workplans")}/>
        <NavItem icon="zap" label="Events" active={view==="events"} onClick={()=>setView("events")}/>

        <NavSection label="Agents"/>
        <NavItem icon="agent" label="Agents" active={view==="agents"} onClick={()=>setView("agents")}/>
        <NavItem icon="link" label="Nodes" active={view==="nodes"} onClick={()=>setView("nodes")}/>
        <NavItem icon="shield" label="Watchdog" active={view==="watchdog"} onClick={()=>setView("watchdog")}/>

        <NavSection label="Infrastructure"/>
        <NavItem icon="server" label="Components" active={view==="infra"} onClick={()=>setView("infra")}/>
      </div>

      {/* Settings — always visible at bottom */}
      <div style={{borderTop:"1px solid #12151e",padding:"8px"}}>
        <NavItem icon="gear" label="Settings" active={view==="settings"} onClick={()=>setView("settings")}/>
      </div>
    </nav>

    {/* ─── Resize handle ───────────────────────────────────── */}
    <div style={{width:4,cursor:"col-resize",background:sidebarW>180?"transparent":"#1a1e2c",flexShrink:0}} onMouseDown={e=>{const startX=e.clientX;const startW=sidebarW;const onMove=ev=>setSidebarW(Math.max(180,Math.min(280,startW+(ev.clientX-startX))));const onUp=()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);};window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);}} onMouseEnter={e=>e.currentTarget.style.background="#1a1e2c"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}/>

    {/* ─── Main ────────────────────────────────────────────── */}
    <main style={{flex:1,overflow:"auto",position:"relative"}}>
      <div style={{position:"sticky",top:0,zIndex:10,display:"flex",justifyContent:"flex-end",alignItems:"center",gap:12,padding:"12px 20px 0"}}>
        <a href="https://mhue.ai" target="_blank" rel="noopener noreferrer" style={{fontSize:12,fontWeight:500,color:"#5a6070",textDecoration:"none"}} onMouseEnter={e=>e.target.style.color="#e85d24"} onMouseLeave={e=>e.target.style.color="#5a6070"}>Mhue.AI</a>
        <Btn sm onClick={refresh} title="Refresh"><I t="refresh" s={14}/></Btn>
      </div>
      <div style={{padding:"0 20px 20px"}}>
        {view==="overview"&&<Overview stats={stats} agents={agents} health={health} workplans={workplans} setView={setView} agentAction={agentAction} canWrite={canWrite}/>}
        {view==="kanban"&&<Kanban kanban={kanban} agents={agents} refresh={refresh} canWrite={canWrite}/>}
        {view==="agents"&&<Agents agents={agents} gateways={gateways} agentAction={agentAction} deleteAgent={deleteAgent} refresh={refresh} canWrite={canWrite} isAdmin={isAdmin}/>}
        {view==="workplans"&&<Workplans workplans={workplans} refresh={refresh} canWrite={canWrite}/>}
        {view==="infra"&&<InfraPanel/>}
        {view==="nodes"&&<Nodes gateways={gateways} refresh={refresh} canWrite={canWrite}/>}
        {view==="watchdog"&&<Watchdog agents={agents} health={health} agentAction={agentAction} canWrite={canWrite}/>}
        {view==="events"&&<Events events={events}/>}
        {view==="settings"&&<Settings currentUser={currentUser} isAdmin={isAdmin}/>}
      </div>
    </main>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
function Overview({stats,agents,health,workplans,setView,agentAction,canWrite}){
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Overview</h1>
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      <Metric label="Agents" value={stats.agents} sub={`${stats.running} running`} color="#3b82f6" icon="agent"/>
      <Metric label="Nodes" value={stats.gateways} sub={`${stats.gwOnline} online`} color="#22c55e" icon="link"/>
      <Metric label="Workplans" value={stats.workplans} sub={`${stats.wpActive} active`} color="#8b5cf6" icon="plan"/>
      <Metric label="Kanban" value={stats.cards} sub="cards" color="#e85d24" icon="kanban"/>
      <Metric label="Uptime" value={health?.uptime?Math.floor(health.uptime/3600)+'h':'—'} color="#6b7080" icon="chart"/>
    </div>
    <Section icon="agent" action={<Btn sm v="primary" onClick={()=>setView("agents")}>Manage</Btn>}>Agents</Section>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10,marginBottom:20}}>
      {agents.map(a=><Card key={a.id} style={{padding:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><Dot status={a.status} size={10}/><span style={{fontWeight:500,fontSize:13}}>{a.name}</span></div>
          {sBadge(a.status)}
        </div>
        <div style={{fontSize:11,color:"#5a6070",marginBottom:8}}>{a.role} · {a.model||'—'}</div>
        {canWrite&&<div style={{display:"flex",gap:4}}>
          {!['running','onboarding'].includes(a.status)&&<Btn sm v="success" onClick={()=>agentAction(a.id,'start')}><I t="play" s={10}/></Btn>}
          {a.status==='running'&&<Btn sm onClick={()=>agentAction(a.id,'pause')}><I t="pause" s={10}/></Btn>}
          {['running','paused'].includes(a.status)&&<Btn sm v="danger" onClick={()=>agentAction(a.id,'stop')}><I t="stop" s={10}/></Btn>}
          {['stopped','error'].includes(a.status)&&<Btn sm onClick={()=>agentAction(a.id,'restart')}><I t="refresh" s={10}/></Btn>}
        </div>}
      </Card>)}
    </div>
    <Section icon="plan" action={<Btn sm v="primary" onClick={()=>setView("workplans")}>View all</Btn>}>Workplans</Section>
    {workplans.slice(0,3).map(w=><Card key={w.id} style={{padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontWeight:500,fontSize:13}}>{w.name}</span>{sBadge(w.status)}</div></Card>)}
  </div>;
}

// ─── Kanban ────────────────────────────────────────────────────────
function Kanban({kanban,agents,refresh,canWrite}){
  const [addTo,setAddTo]=useState(null);
  const [nc,setNc]=useState({title:'',description:'',priority:'normal',assignedAgent:''});
  const [edit,setEdit]=useState(null);
  const add=async()=>{if(!nc.title||!addTo)return;await apiPost('/api/kanban/cards',{boardId:'main',columnId:addTo,...nc,assignedAgent:nc.assignedAgent||null});setNc({title:'',description:'',priority:'normal',assignedAgent:''});setAddTo(null);refresh();};
  const move=async(id,col)=>{try{await apiPost(`/api/kanban/cards/${id}/move`,{columnId:col,order:0});refresh();}catch(e){alert(e.message);}};
  const del=async id=>{await apiDelete(`/api/kanban/cards/${id}`);refresh();};
  if(!kanban)return<div style={{color:"#5a6070",textAlign:"center",padding:40}}>No board.</div>;
  const cc={backlog:"#6b7280",queued:"#8b5cf6",in_progress:"#3b82f6",review:"#a855f7",done:"#22c55e"};
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Kanban</h1>
      <span style={{fontSize:12,color:"#5a6070"}}>{kanban.columns.reduce((s,c)=>s+c.cards.length,0)} cards</span>
    </div>
    <div style={{display:"flex",gap:10,overflow:"auto",paddingBottom:12}}>
      {kanban.columns.map(col=><div key={col.id} style={{minWidth:220,maxWidth:260,flex:1,background:"#0d0f14",border:"1px solid #1a1e2c",borderRadius:10,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 140px)"}}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #1a1e2c",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:cc[col.id]||"#6b7280"}}/><span style={{fontSize:12,fontWeight:500}}>{col.title}</span><span style={{fontSize:10,color:"#5a6070",background:"#161a24",padding:"1px 6px",borderRadius:4}}>{col.count}</span></div>
          {canWrite&&<button onClick={()=>setAddTo(col.id)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>+</button>}
        </div>
        <div style={{flex:1,overflow:"auto",padding:8,display:"flex",flexDirection:"column",gap:6}}>
          {col.cards.map(card=><div key={card.id} onClick={()=>setEdit(card)} style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:8,padding:10,cursor:"pointer",borderLeft:`3px solid ${cc[col.id]||"#6b7280"}`}}>
            <div style={{fontSize:12,fontWeight:500,color:"#f0f2f5",marginBottom:4}}>{card.title}</div>
            {card.description&&<div style={{fontSize:11,color:"#5a6070",marginBottom:6,lineHeight:1.3,maxHeight:32,overflow:"hidden"}}>{card.description}</div>}
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{pBadge(card.priority)}{card.assigned_agent&&<Badge color="blue">{agents.find(a=>a.id===card.assigned_agent)?.name||card.assigned_agent}</Badge>}</div>
          </div>)}
        </div>
        {col.wip_limit>0&&<div style={{padding:"4px 12px",borderTop:"1px solid #1a1e2c",fontSize:10,color:col.count>=col.wip_limit?"#ef4444":"#5a6070"}}>WIP: {col.count}/{col.wip_limit}</div>}
      </div>)}
    </div>
    {addTo&&<Overlay onClose={()=>setAddTo(null)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Add card</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Input value={nc.title} onChange={v=>setNc({...nc,title:v})} placeholder="Title"/>
        <Input value={nc.description} onChange={v=>setNc({...nc,description:v})} placeholder="Description"/>
        <div style={{display:"flex",gap:8}}>
          <Select value={nc.priority} onChange={v=>setNc({...nc,priority:v})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></Select>
          <Select value={nc.assignedAgent} onChange={v=>setNc({...nc,assignedAgent:v})} style={{flex:1}}><option value="">Unassigned</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setAddTo(null)}>Cancel</Btn><Btn v="primary" onClick={add} disabled={!nc.title}>Add</Btn></div>
      </div>
    </Overlay>}
    {edit&&<Overlay onClose={()=>setEdit(null)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 8px"}}>{edit.title}</h3>
      {edit.description&&<p style={{fontSize:12,color:"#8b90a0",margin:"0 0 12px"}}>{edit.description}</p>}
      <div style={{fontSize:11,color:"#5a6070",marginBottom:8}}>Move to:</div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
        {kanban.columns.map(c=><Btn key={c.id} sm v={edit.column_id===c.id?"primary":"default"} onClick={()=>{move(edit.id,c.id);setEdit(null);}}>{c.title}</Btn>)}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>{canWrite&&<Btn sm v="danger" onClick={()=>{del(edit.id);setEdit(null);}}>Delete</Btn>}<Btn sm onClick={()=>setEdit(null)}>Close</Btn></div>
    </Overlay>}
  </div>;
}

// ─── Agents ────────────────────────────────────────────────────────
function Agents({agents,gateways,agentAction,deleteAgent,refresh,canWrite,isAdmin}){
  const [sel,setSel]=useState(null);
  const [showOb,setShowOb]=useState(false);
  const [na,setNa]=useState({name:'',gatewayId:'',model:'claude-sonnet-4-6',role:'general',channel:'webchat',notes:''});
  const [confirmDel,setConfirmDel]=useState(null);
  const onboard=async()=>{if(!na.name)return;await apiPost('/api/agents',na);setNa({name:'',gatewayId:'',model:'claude-sonnet-4-6',role:'general',channel:'webchat',notes:''});setShowOb(false);refresh();};
  const a=sel?agents.find(x=>x.id===sel):null;
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Agents</h1>
      {canWrite&&<Btn v="primary" onClick={()=>setShowOb(true)}><I t="plus" s={12}/> Onboard</Btn>}
    </div>
    <div style={{display:"grid",gridTemplateColumns:sel?"1fr 340px":"1fr",gap:14}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>{["","Name","Role","Model","Node","Status","Controls"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{agents.map(ag=><tr key={ag.id} onClick={()=>setSel(ag.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===ag.id?"#151820":"transparent"}} onMouseEnter={e=>{if(sel!==ag.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==ag.id)e.currentTarget.style.background="transparent"}}>
            <td style={{padding:"8px 10px"}}><Dot status={ag.status} size={10}/></td>
            <td style={{padding:"8px 10px",fontWeight:500,color:"#f0f2f5"}}>{ag.name}</td>
            <td style={{padding:"8px 10px",color:"#8b90a0"}}>{ag.role}</td>
            <td style={{padding:"8px 10px"}} className="mono"><span style={{fontSize:10,color:"#5a6070"}}>{ag.model||'—'}</span></td>
            <td style={{padding:"8px 10px",color:"#5a6070"}}>{ag.gateway_label||'—'}</td>
            <td style={{padding:"8px 10px"}}>{sBadge(ag.status)}</td>
            <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
              {canWrite&&<div style={{display:"flex",gap:3}}>
                {ag.status==='onboarding'&&<Btn sm v="success" onClick={()=>agentAction(ag.id,'activate')}>Activate</Btn>}
                {!['running','onboarding'].includes(ag.status)&&<Btn sm v="success" onClick={()=>agentAction(ag.id,'start')}><I t="play" s={10}/></Btn>}
                {ag.status==='running'&&<Btn sm onClick={()=>agentAction(ag.id,'pause')}><I t="pause" s={10}/></Btn>}
                {['running','paused'].includes(ag.status)&&<Btn sm v="danger" onClick={()=>agentAction(ag.id,'stop')}><I t="stop" s={10}/></Btn>}
                {['stopped','error'].includes(ag.status)&&<Btn sm onClick={()=>agentAction(ag.id,'restart')}><I t="refresh" s={10}/></Btn>}
              </div>}
            </td>
          </tr>)}</tbody>
        </table>
      </Card>
      {a&&<Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><div><div style={{fontSize:14,fontWeight:600,color:"#f0f2f5"}}>{a.name}</div><div style={{fontSize:11,color:"#5a6070"}}>{a.id}</div></div><button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>×</button></div>
        {[["Status",sBadge(a.status)],["Role",a.role],["Model",a.model||'—'],["Node",a.gateway_label||'—'],["Channel",a.channel||'—'],["Tokens",fmtTok(a.tokens_used||0)],["Cost","$"+(a.cost_usd||0).toFixed(2)],["Restarts",a.restarts||0],["Heartbeat",fmtTime(a.last_heartbeat)]].map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #12141b",fontSize:12}}><span style={{color:"#5a6070"}}>{k}</span><span style={{color:"#d4d8e0"}}>{v}</span></div>)}
        {a.notes&&<div style={{marginTop:10,fontSize:11,color:"#5a6070",lineHeight:1.4}}>{a.notes}</div>}
        {canWrite&&<div style={{display:"flex",gap:6,marginTop:14}}>
          {a.gateway_id&&<Btn sm v="primary" onClick={async()=>{try{await apiPost(`/api/agents/${a.id}/pull-config`);alert('Config pulled.');}catch(e){alert(e.message);}}}>Pull config</Btn>}
          <Btn sm v="danger" onClick={()=>setConfirmDel(a.id)}>Remove</Btn>
        </div>}
      </Card>}
    </div>
    {showOb&&<Overlay onClose={()=>setShowOb(false)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Onboard agent</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Name</div><Input value={na.name} onChange={v=>setNa({...na,name:v})} placeholder="e.g. Cipher"/></div>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Node</div><Select value={na.gatewayId} onChange={v=>setNa({...na,gatewayId:v})} style={{width:"100%"}}><option value="">None</option>{gateways.map(g=><option key={g.id} value={g.id}>{g.label} ({g.host})</option>)}</Select></div>
        <div style={{display:"flex",gap:8}}><div style={{flex:1}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Model</div><Input value={na.model} onChange={v=>setNa({...na,model:v})}/></div><div style={{flex:1}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Role</div><Input value={na.role} onChange={v=>setNa({...na,role:v})}/></div></div>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Notes</div><Input value={na.notes} onChange={v=>setNa({...na,notes:v})} placeholder="Purpose"/></div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShowOb(false)}>Cancel</Btn><Btn v="primary" onClick={onboard} disabled={!na.name}>Create</Btn></div>
      </div>
    </Overlay>}
    {confirmDel&&<Overlay onClose={()=>setConfirmDel(null)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#ef4444",margin:"0 0 14px"}}>Remove agent?</h3>
      <p style={{fontSize:12,color:"#8b90a0",marginBottom:14}}>Removes from Mission Control. The OpenClaw instance continues running.</p>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setConfirmDel(null)}>Cancel</Btn><Btn v="danger" onClick={()=>{deleteAgent(confirmDel);setConfirmDel(null);setSel(null);}}>Remove</Btn></div>
    </Overlay>}
  </div>;
}

// ─── Workplans ─────────────────────────────────────────────────────
function Workplans({workplans,refresh,canWrite}){
  const [sel,setSel]=useState(null);
  const [showCreate,setShowCreate]=useState(false);
  const [nw,setNw]=useState({name:'',description:''});
  const wp=sel?workplans.find(w=>w.id===sel):null;
  const act=async(id,status)=>{await apiPatch(`/api/workplans/${id}`,{status});refresh();};
  const create=async()=>{if(!nw.name)return;await apiPost('/api/workplans',{name:nw.name,description:nw.description,status:'draft'});setNw({name:'',description:''});setShowCreate(false);refresh();};
  const del=async id=>{await apiDelete(`/api/workplans/${id}`);setSel(null);refresh();};
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Workplans</h1>
      {canWrite&&<Btn v="primary" onClick={()=>setShowCreate(true)}><I t="plus" s={12}/> Create</Btn>}
    </div>
    <Card style={{padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>{["","Name","Status","Created",""].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{workplans.map(w=><tr key={w.id} onClick={()=>setSel(w.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===w.id?"#151820":"transparent"}} onMouseEnter={e=>{if(sel!==w.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==w.id)e.currentTarget.style.background="transparent"}}>
          <td style={{padding:"8px 10px"}}><Dot status={w.status}/></td>
          <td style={{padding:"8px 10px",fontWeight:500,color:"#f0f2f5"}}>{w.name}</td>
          <td style={{padding:"8px 10px"}}>{sBadge(w.status)}</td>
          <td style={{padding:"8px 10px",color:"#5a6070"}}>{new Date(w.created_at).toLocaleDateString()}</td>
          <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
            {canWrite&&<div style={{display:"flex",gap:3}}>
              {w.status==='draft'&&<Btn sm v="success" onClick={()=>act(w.id,'active')}>Activate</Btn>}
              {w.status==='active'&&<Btn sm onClick={()=>act(w.id,'paused')}><I t="pause" s={10}/></Btn>}
              {w.status==='paused'&&<Btn sm v="success" onClick={()=>act(w.id,'active')}><I t="play" s={10}/></Btn>}
              {['active','paused'].includes(w.status)&&<Btn sm v="success" onClick={()=>act(w.id,'completed')}>Done</Btn>}
              {w.status==='completed'&&<Btn sm onClick={()=>act(w.id,'archived')}>Archive</Btn>}
            </div>}
          </td>
        </tr>)}</tbody>
      </table>
      {workplans.length===0&&<div style={{padding:30,textAlign:"center",color:"#3a3e50",fontSize:12}}>No workplans yet.</div>}
    </Card>
    {showCreate&&<Overlay onClose={()=>setShowCreate(false)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Create workplan</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Input value={nw.name} onChange={v=>setNw({...nw,name:v})} placeholder="Name"/>
        <Input value={nw.description} onChange={v=>setNw({...nw,description:v})} placeholder="Description"/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShowCreate(false)}>Cancel</Btn><Btn v="primary" onClick={create} disabled={!nw.name}>Create</Btn></div>
      </div>
    </Overlay>}
  </div>;
}

// ─── Nodes (OpenClaw) ──────────────────────────────────────────────
function Nodes({gateways,refresh,canWrite}){
  const [show,setShow]=useState(false);
  const [ng,setNg]=useState({label:'',host:'',port:'18789',token:''});
  const add=async()=>{if(!ng.host)return;await apiPost('/api/managed-gateways',{...ng,port:parseInt(ng.port)||18789});setNg({label:'',host:'',port:'18789',token:''});setShow(false);refresh();};
  const del=async id=>{await apiDelete(`/api/managed-gateways/${id}`);refresh();};
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Nodes</h1>
      {canWrite&&<Btn v="primary" onClick={()=>setShow(true)}><I t="plus" s={12}/> Add</Btn>}
    </div>
    <p style={{fontSize:12,color:"#5a6070",marginBottom:16}}>OpenClaw runtime instances hosting AI agents.</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
      {gateways.map(g=><Card key={g.id} style={{padding:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8}}><Dot status={g.status} size={10}/><span style={{fontWeight:500,fontSize:13}}>{g.label}</span></div>{sBadge(g.status)}</div>
        <div className="mono" style={{fontSize:11,color:"#5a6070",marginBottom:8}}>{g.host}:{g.port}</div>
        {canWrite&&<Btn sm v="danger" onClick={()=>del(g.id)}><I t="trash" s={10}/> Remove</Btn>}
      </Card>)}
      {gateways.length===0&&<Card style={{textAlign:"center",color:"#3a3e50",fontSize:12,padding:30}}>No nodes. Add one to connect agents.</Card>}
    </div>
    {show&&<Overlay onClose={()=>setShow(false)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Add node</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Input value={ng.label} onChange={v=>setNg({...ng,label:v})} placeholder="Label"/>
        <div style={{display:"flex",gap:8}}><div style={{flex:2}}><Input value={ng.host} onChange={v=>setNg({...ng,host:v})} placeholder="192.168.1.10" className="mono"/></div><div style={{flex:1}}><Input value={ng.port} onChange={v=>setNg({...ng,port:v})} className="mono"/></div></div>
        <Input type="password" value={ng.token} onChange={v=>setNg({...ng,token:v})} placeholder="Auth token"/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShow(false)}>Cancel</Btn><Btn v="primary" onClick={add} disabled={!ng.host}>Add</Btn></div>
      </div>
    </Overlay>}
  </div>;
}

// ─── Watchdog ──────────────────────────────────────────────────────
function Watchdog({agents,health,agentAction,canWrite}){
  const bad=agents.filter(a=>['error','stopped'].includes(a.status));
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Watchdog</h1>
    <div style={{display:"flex",gap:10,marginBottom:16}}>
      <Metric label="Status" value={health?.watchdog||'—'} color={health?.watchdog==='active'?"#22c55e":"#f59e0b"} icon="shield"/>
      <Metric label="Unhealthy" value={bad.length} color={bad.length?"#ef4444":"#22c55e"} icon="agent"/>
    </div>
    {bad.map(a=><Card key={a.id} style={{padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",alignItems:"center",gap:8}}><Dot status={a.status}/><span style={{fontWeight:500,fontSize:13}}>{a.name}</span>{sBadge(a.status)}</div>{canWrite&&<div style={{display:"flex",gap:4}}><Btn sm v="success" onClick={()=>agentAction(a.id,'restart')}>Restart</Btn></div>}</div></Card>)}
    {bad.length===0&&<Card style={{textAlign:"center",color:"#22c55e",fontSize:13,padding:30}}>All agents healthy.</Card>}
  </div>;
}

// ─── Events ────────────────────────────────────────────────────────
function Events({events}){
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Events</h1>
    <Card style={{padding:0,maxHeight:"calc(100vh - 120px)",overflow:"auto"}}>
      {events.length===0&&<div style={{padding:30,textAlign:"center",color:"#3a3e50",fontSize:12}}>No events.</div>}
      {events.slice(0,100).map((ev,i)=><div key={ev.id||i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderBottom:"1px solid #12141b",fontSize:12}}>
        <span className="mono" style={{fontSize:10,color:"#3a3e50",minWidth:60}}>{new Date(ev.created_at).toLocaleTimeString()}</span>
        <Badge color={ev.event_type?.includes('fail')?"red":ev.event_type?.includes('complete')?"green":"gray"}>{ev.event_type}</Badge>
        <span style={{color:"#8b90a0",flex:1}}>{ev.message}</span>
      </div>)}
    </Card>
  </div>;
}

// ─── Settings ──────────────────────────────────────────────────────
function Settings({currentUser,isAdmin}){
  const [tab,setTab]=useState("users");
  const [users,setUsers]=useState([]);
  const [showAdd,setShowAdd]=useState(false);
  const [nu,setNu]=useState({username:'',password:'',displayName:'',role:'viewer'});
  const [editUser,setEditUser]=useState(null);
  const [toast,setToast]=useState(null);
  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast(null),3000);};
  const loadUsers=async()=>{try{setUsers(await apiGet('/api/users')||[]);}catch{setUsers([]);}};
  useEffect(()=>{loadUsers();},[]);
  const createUser=async()=>{if(!nu.username||!nu.password)return;try{await apiPost('/api/users',nu);setNu({username:'',password:'',displayName:'',role:'viewer'});setShowAdd(false);showToast('Created');loadUsers();}catch(e){showToast(e.message,false);}};
  const updateUser=async(id,u)=>{try{await apiPatch(`/api/users/${id}`,u);showToast('Updated');loadUsers();setEditUser(null);}catch(e){showToast(e.message,false);}};
  const deleteUser=async id=>{try{await apiDelete(`/api/users/${id}`);showToast('Removed');loadUsers();}catch(e){showToast(e.message,false);}};
  const logout=()=>{apiPost('/api/auth/logout').catch(()=>{});sessionStorage.clear();window.location.href='/login';};
  const rb=r=><Badge color={r==='admin'?'orange':r==='editor'?'blue':'gray'}>{r}</Badge>;

  return <div>
    {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:200,background:toast.ok?"#0d2818":"#2a0f0f",color:toast.ok?"#22c55e":"#ef4444",border:`1px solid ${toast.ok?"#143d24":"#3d1616"}`,borderRadius:8,padding:"8px 16px",fontSize:12}}>{toast.msg}</div>}
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Settings</h1>
    <Card style={{padding:14,marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div><div style={{fontSize:13,fontWeight:500,color:"#f0f2f5"}}>{currentUser?.displayName||currentUser?.username||'User'}</div><div style={{fontSize:11,color:"#5a6070"}}>{currentUser?.username} · {rb(currentUser?.role||'viewer')}</div></div>
        <Btn sm v="danger" onClick={logout}>Sign out</Btn>
      </div>
    </Card>
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {[["users","Users"],["roles","Roles"],["models","Models"],["system","System"]].map(([id,label])=>
        <button key={id} onClick={()=>setTab(id)} style={{fontSize:11,padding:"5px 14px",borderRadius:6,border:"1px solid "+(tab===id?"#e85d24":"#1e2430"),background:tab===id?"#2a1508":"transparent",color:tab===id?"#e85d24":"#5a6070",cursor:"pointer"}}>{label}</button>
      )}
    </div>

    {tab==="users"&&<div>
      {isAdmin&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}><Btn v="primary" onClick={()=>setShowAdd(true)}><I t="plus" s={12}/> Add user</Btn></div>}
      <Card style={{padding:0}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>{["Username","Name","Role","Status","Last login",isAdmin?"":""].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{users.map(u=><tr key={u.id} style={{borderBottom:"1px solid #12141b"}}>
            <td style={{padding:"8px 10px",fontWeight:500,color:"#f0f2f5"}}>{u.username}</td>
            <td style={{padding:"8px 10px",color:"#8b90a0"}}>{u.display_name||'—'}</td>
            <td style={{padding:"8px 10px"}}>{rb(u.role)}</td>
            <td style={{padding:"8px 10px"}}><Badge color={u.enabled?"green":"red"}>{u.enabled?"active":"disabled"}</Badge></td>
            <td style={{padding:"8px 10px",color:"#5a6070",fontSize:11}}>{u.last_login?new Date(u.last_login).toLocaleString():'never'}</td>
            <td style={{padding:"8px 10px"}}>{isAdmin&&u.id!==currentUser?.userId&&<div style={{display:"flex",gap:3}}><Btn sm onClick={()=>setEditUser(u)}>Edit</Btn><Btn sm v="danger" onClick={()=>deleteUser(u.id)}>Remove</Btn></div>}</td>
          </tr>)}</tbody>
        </table>
      </Card>
      {showAdd&&<Overlay onClose={()=>setShowAdd(false)}>
        <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Add user</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <Input value={nu.username} onChange={v=>setNu({...nu,username:v})} placeholder="Username"/>
          <Input value={nu.displayName} onChange={v=>setNu({...nu,displayName:v})} placeholder="Display name"/>
          <Input type="password" value={nu.password} onChange={v=>setNu({...nu,password:v})} placeholder="Password"/>
          <Select value={nu.role} onChange={v=>setNu({...nu,role:v})} style={{width:"100%"}}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></Select>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShowAdd(false)}>Cancel</Btn><Btn v="primary" onClick={createUser} disabled={!nu.username||!nu.password}>Create</Btn></div>
        </div>
      </Overlay>}
      {editUser&&<Overlay onClose={()=>setEditUser(null)}>
        <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Edit: {editUser.username}</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <Select value={editUser.role} onChange={v=>setEditUser({...editUser,role:v})} style={{width:"100%"}}><option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option></Select>
          <Input type="password" value={editUser.newPw||''} onChange={v=>setEditUser({...editUser,newPw:v})} placeholder="New password (blank to keep)"/>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setEditUser(null)}>Cancel</Btn><Btn v="primary" onClick={()=>updateUser(editUser.id,{role:editUser.role,password:editUser.newPw||undefined})}>Save</Btn></div>
        </div>
      </Overlay>}
    </div>}

    {tab==="roles"&&<Card>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>{["Permission","Admin","Editor","Viewer"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"center",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
        <tbody>{[["View everything","read"],["Create & edit","write"],["Delete items","delete"],["Network scans","scan"],["System config","config"],["User management","admin"]].map(([l,p])=><tr key={p} style={{borderBottom:"1px solid #12141b"}}>
          <td style={{padding:"8px 10px",color:"#d4d8e0"}}>{l}</td>
          {["admin","editor","viewer"].map(r=><td key={r} style={{padding:"8px 10px",textAlign:"center"}}>{(r==='admin'||(r==='editor'&&['read','write','delete','scan'].includes(p))||(r==='viewer'&&p==='read'))?<span style={{color:"#22c55e"}}>✓</span>:<span style={{color:"#3a3e50"}}>—</span>}</td>)}
        </tr>)}</tbody>
      </table>
    </Card>}

    {tab==="models"&&<Card>
      <div style={{fontSize:13,fontWeight:500,color:"#f0f2f5",marginBottom:12}}>LLM models</div>
      {[{p:"Anthropic",m:["claude-opus-4-6","claude-sonnet-4-6","claude-haiku-4-5"]},{p:"OpenAI",m:["gpt-5.4","gpt-4.1","o4-mini"]},{p:"Google",m:["gemini-3.1-pro","gemini-3.1-flash"]},{p:"Local",m:["LM Studio","Ollama"]}].map(x=><div key={x.p} style={{marginBottom:12,padding:12,background:"#0d0f14",borderRadius:8}}>
        <div style={{fontSize:12,fontWeight:500,color:"#d4d8e0",marginBottom:6}}>{x.p}</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>{x.m.map(m=><Badge key={m} color="purple">{m}</Badge>)}</div>
      </div>)}
    </Card>}

    {tab==="system"&&<Card>
      {[["Path","/opt/mission-control"],["Database","SQLite WAL"],["Config","/opt/mission-control/.env"],["Logs","pm2 logs mission-control"]].map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #12141b",fontSize:12}}><span style={{color:"#5a6070"}}>{k}</span><span className="mono" style={{color:"#d4d8e0",fontSize:11}}>{v}</span></div>)}
    </Card>}
  </div>;
}
