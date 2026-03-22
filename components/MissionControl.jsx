import { useState, useEffect, useCallback, useMemo } from "react";
import InfraPanel from "./InfraPanel";

/* ═══════════════════════════════════════════════════════════════════════
   OpenClaw Mission Control v3 — Full API Integration
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

const I=({t,s=16,c})=>{const st={width:s,height:s,display:"inline-block",verticalAlign:"middle"};c=c||"currentColor";const m={
  server:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="3" y="3" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><circle cx="7" cy="6" r="1" fill={c}/><circle cx="7" cy="16" r="1" fill={c}/></svg>,
  agent:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2a5 5 0 015 5v2a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M8 14s-4 2-4 6h16c0-4-4-6-4-6"/></svg>,
  play:<svg style={st} viewBox="0 0 24 24" fill={c}><polygon points="6,3 20,12 6,21"/></svg>,
  pause:<svg style={st} viewBox="0 0 24 24" fill={c}><rect x="5" y="3" width="5" height="18" rx="1"/><rect x="14" y="3" width="5" height="18" rx="1"/></svg>,
  stop:<svg style={st} viewBox="0 0 24 24" fill={c}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  refresh:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>,
  chart:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-7"/></svg>,
  zap:<svg style={st} viewBox="0 0 24 24" fill={c} stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  plan:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M4 4h16v16H4z" rx="2"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>,
  shield:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2l8 4v6c0 5.25-3.5 9.75-8 11-4.5-1.25-8-5.75-8-11V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>,
  plus:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  kanban:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="2" y="3" width="6" height="18" rx="1.5"/><rect x="9" y="3" width="6" height="12" rx="1.5"/><rect x="16" y="3" width="6" height="15" rx="1.5"/></svg>,
  trash:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>,
  link:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
};return m[t]||null;};

const fmtTime=s=>{if(!s)return"never";const d=Math.floor((Date.now()-new Date(s).getTime())/1000);return d<60?d+"s ago":d<3600?Math.floor(d/60)+"m ago":Math.floor(d/3600)+"h ago";};
const fmtTok=n=>n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?Math.floor(n/1e3)+"K":""+n;

function Dot({status,size=8}){const c={online:"#22c55e",connected:"#22c55e",completed:"#22c55e",active:"#22c55e",healthy:"#22c55e",done:"#22c55e",running:"#3b82f6",degraded:"#f59e0b",paused:"#f59e0b",queued:"#8b5cf6",review:"#a855f7",offline:"#ef4444",disconnected:"#ef4444",failed:"#ef4444",stopped:"#ef4444",error:"#ef4444",idle:"#6b7280",draft:"#6b7280",onboarding:"#e85d24",archived:"#4b5563"};const pulse=["online","connected","running","active","healthy"].includes(status);return <span style={{position:"relative",display:"inline-block",width:size,height:size}}>{pulse&&<span style={{position:"absolute",inset:-2,borderRadius:"50%",background:c[status]||"#666",opacity:.3,animation:"pulse-ring 2s ease-out infinite"}}/>}<span style={{display:"block",width:size,height:size,borderRadius:"50%",background:c[status]||"#666"}}/></span>;}
function Card({children,style,...p}){return <div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:12,padding:16,...style}} {...p}>{children}</div>;}
function Badge({color,children}){const c={green:{bg:"#0d2818",t:"#22c55e",b:"#143d24"},red:{bg:"#2a0f0f",t:"#ef4444",b:"#3d1616"},yellow:{bg:"#2a2008",t:"#f59e0b",b:"#3d2e0f"},blue:{bg:"#0c1a2e",t:"#3b82f6",b:"#132d4a"},purple:{bg:"#1a0f2e",t:"#8b5cf6",b:"#26174a"},gray:{bg:"#1a1c22",t:"#6b7080",b:"#25272e"},orange:{bg:"#2a1508",t:"#e85d24",b:"#4a2812"},teal:{bg:"#0a2420",t:"#14b8a6",b:"#134d44"}}[color]||{bg:"#1a1c22",t:"#6b7080",b:"#25272e"};return <span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:6,background:c.bg,color:c.t,border:`1px solid ${c.b}`,textTransform:"uppercase",letterSpacing:".03em"}}>{children}</span>;}
function Btn({onClick,children,v="default",sm,disabled,title}){const s={default:{bg:"#161a24",h:"#1e2230",b:"#1e2430",c:"#d4d8e0"},danger:{bg:"#2a0f0f",h:"#3d1616",b:"#3d1616",c:"#ef4444"},primary:{bg:"#2a1508",h:"#3d1f0f",b:"#4a2812",c:"#e85d24"},success:{bg:"#0d2818",h:"#143d24",b:"#143d24",c:"#22c55e"}}[v];return <button onClick={onClick} disabled={disabled} title={title} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:sm?11:12,fontWeight:500,padding:sm?"4px 10px":"6px 14px",borderRadius:8,border:`1px solid ${s.b}`,background:s.bg,color:s.c,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,transition:"background .15s"}} onMouseEnter={e=>{if(!disabled)e.target.style.background=s.h}} onMouseLeave={e=>{if(!disabled)e.target.style.background=s.bg}}>{children}</button>;}
function Metric({label,value,sub,color,icon}){return <div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:10,padding:"14px 16px",flex:1,minWidth:110}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>{icon&&<I t={icon} s={13} c="#5a6070"/>}<span style={{fontSize:11,color:"#5a6070",textTransform:"uppercase",letterSpacing:".04em"}}>{label}</span></div><div style={{fontSize:22,fontWeight:600,color:color||"#f0f2f5"}}>{value}</div>{sub&&<div style={{fontSize:11,color:"#5a6070",marginTop:2}}>{sub}</div>}</div>;}
function Section({children,icon,action}){return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}><div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:500,color:"#8b90a0",textTransform:"uppercase",letterSpacing:".05em"}}>{icon&&<I t={icon} s={14}/>}{children}</div>{action}</div>;}
const Input=({value,onChange,placeholder,style,...p})=><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:8,color:"#d4d8e0",padding:"8px 12px",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box",...style}} {...p}/>;
const Select=({value,onChange,children,style})=><select value={value} onChange={e=>onChange(e.target.value)} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:6,color:"#d4d8e0",fontSize:11,padding:"6px 8px",...style}}>{children}</select>;
const Modal=({children,onClose})=><div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}><Card style={{width:520,maxHeight:"85vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>{children}</Card></div>;
const sBadge=s=>{const m={running:"blue",active:"green",completed:"green",done:"green",healthy:"green",connected:"green",paused:"yellow",queued:"purple",idle:"gray",draft:"gray",stopped:"red",error:"red",failed:"red",disconnected:"red",onboarding:"orange",archived:"gray"};return <Badge color={m[s]||"gray"}>{s}</Badge>;};
const pBadge=p=><Badge color={{critical:"red",high:"orange",normal:"gray",low:"gray"}[p]||"gray"}>{p}</Badge>;

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

  const agentAction = async(id,action)=>{ await apiPost(`/api/agents/${id}/${action}`); refresh(); };
  const deleteAgent = async(id)=>{ await apiDelete(`/api/agents/${id}`); refresh(); };

  const stats = useMemo(()=>({
    agents:agents.length, running:agents.filter(a=>a.status==='running').length,
    gateways:gateways.length, gwOnline:gateways.filter(g=>g.status==='connected').length,
    workplans:workplans.length, wpActive:workplans.filter(w=>w.status==='active').length,
    cards:kanban?.columns?.reduce((s,c)=>s+c.cards.length,0)||0,
  }),[agents,gateways,workplans,kanban]);

  const [currentUser, setCurrentUser] = useState(null);

  // Load current user on mount
  useEffect(() => {
    try { const u = sessionStorage.getItem('mc_user'); if (u) setCurrentUser(JSON.parse(u)); } catch {}
    apiGet('/api/auth/me').then(u => { if (u) setCurrentUser(u); }).catch(() => {});
  }, []);

  const isAdmin = currentUser?.role === 'admin';
  const canWrite = currentUser?.role === 'admin' || currentUser?.role === 'editor';

  const nav=[
    {id:"overview",label:"Overview",icon:"chart"},{id:"kanban",label:"Kanban",icon:"kanban"},
    {id:"agents",label:"Agents",icon:"agent"},{id:"workplans",label:"Workplans",icon:"plan"},
    {id:"infra",label:"Infrastructure",icon:"server"},{id:"gateways",label:"Gateways",icon:"link"},
    {id:"watchdog",label:"Watchdog",icon:"shield"},{id:"events",label:"Events",icon:"zap"},
  ];

  if(loading) return <div style={{fontFamily:"'DM Sans',sans-serif",background:"#0a0c10",color:"#5a6070",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{textAlign:"center"}}><div style={{fontSize:32,marginBottom:8}}>🦞</div><div style={{fontSize:13}}>Loading...</div></div></div>;

  return <div style={{fontFamily:"'DM Sans',sans-serif",background:"#0a0c10",color:"#d4d8e0",minHeight:"100vh",display:"flex"}}>
    <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');@keyframes pulse-ring{0%{transform:scale(1);opacity:.3}100%{transform:scale(2.2);opacity:0}}.mono{font-family:'JetBrains Mono',monospace}::-webkit-scrollbar{width:6px}::-webkit-scrollbar-thumb{background:#1a1e2c;border-radius:3px}`}</style>
    {/* Sidebar */}
    <nav style={{width:52,background:"#090b0f",borderRight:"1px solid #12151e",display:"flex",flexDirection:"column",alignItems:"center",padding:"12px 0",gap:4,flexShrink:0}}>
      <div style={{fontSize:22,marginBottom:12,cursor:"pointer"}} onClick={()=>setView("overview")}>🦞</div>
      {nav.map(n=><button key={n.id} onClick={()=>setView(n.id)} title={n.label} style={{width:40,height:40,borderRadius:10,border:"none",background:view===n.id?"#1a1e2c":"transparent",color:view===n.id?"#e85d24":"#5a6070",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><I t={n.icon} s={18}/></button>)}
      <div style={{flex:1}}/>
      {/* Settings gear — bottom left */}
      <button onClick={()=>setView("settings")} title="Settings" style={{width:40,height:40,borderRadius:10,border:"none",background:view==="settings"?"#1a1e2c":"transparent",color:view==="settings"?"#e85d24":"#5a6070",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:4}}><I t="gear" s={18}/></button>
      {/* User indicator */}
      {currentUser&&<div title={`${currentUser.username} (${currentUser.role})`} style={{width:30,height:30,borderRadius:"50%",background:"#1a1e2c",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:"#e85d24",marginBottom:4}}>{(currentUser.displayName||currentUser.username||'?')[0].toUpperCase()}</div>}
    </nav>
    <main style={{flex:1,overflow:"auto",position:"relative"}}>
      {/* Refresh button — top right */}
      <div style={{position:"sticky",top:0,zIndex:10,display:"flex",justifyContent:"flex-end",padding:"12px 20px 0"}}>
        <Btn sm onClick={refresh} title="Refresh data"><I t="refresh" s={14}/></Btn>
      </div>
      <div style={{padding:"0 20px 20px"}}>
        {view==="overview"&&<Overview stats={stats} agents={agents} health={health} workplans={workplans} setView={setView} agentAction={agentAction} canWrite={canWrite}/>}
        {view==="kanban"&&<Kanban kanban={kanban} agents={agents} refresh={refresh} canWrite={canWrite}/>}
        {view==="agents"&&<Agents agents={agents} gateways={gateways} agentAction={agentAction} deleteAgent={deleteAgent} refresh={refresh} canWrite={canWrite} isAdmin={isAdmin}/>}
        {view==="workplans"&&<Workplans workplans={workplans} refresh={refresh} canWrite={canWrite}/>}
        {view==="infra"&&<InfraPanel/>}
        {view==="gateways"&&<Gateways gateways={gateways} refresh={refresh} canWrite={canWrite}/>}
        {view==="watchdog"&&<Watchdog agents={agents} health={health} agentAction={agentAction} canWrite={canWrite}/>}
        {view==="events"&&<Events events={events}/>}
        {view==="settings"&&<Settings currentUser={currentUser} isAdmin={isAdmin}/>}
      </div>
    </main>
  </div>;
}

// ─── Overview ──────────────────────────────────────────────────────────
function Overview({stats,agents,health,workplans,setView,agentAction}){
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Mission Control</h1>
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      <Metric label="Agents" value={stats.agents} sub={`${stats.running} running`} color="#3b82f6" icon="agent"/>
      <Metric label="Gateways" value={stats.gateways} sub={`${stats.gwOnline} online`} color="#22c55e" icon="server"/>
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
        <div style={{display:"flex",gap:4}}>
          {!['running','onboarding'].includes(a.status)&&<Btn sm v="success" onClick={()=>agentAction(a.id,'start')}><I t="play" s={10}/></Btn>}
          {a.status==='running'&&<Btn sm onClick={()=>agentAction(a.id,'pause')}><I t="pause" s={10}/></Btn>}
          {['running','paused'].includes(a.status)&&<Btn sm v="danger" onClick={()=>agentAction(a.id,'stop')}><I t="stop" s={10}/></Btn>}
          {['stopped','error'].includes(a.status)&&<Btn sm onClick={()=>agentAction(a.id,'restart')}><I t="refresh" s={10}/></Btn>}
        </div>
      </Card>)}
    </div>
    <Section icon="plan" action={<Btn sm v="primary" onClick={()=>setView("workplans")}>View all</Btn>}>Recent workplans</Section>
    {workplans.slice(0,3).map(w=><Card key={w.id} style={{padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontWeight:500,fontSize:13}}>{w.name}</span>{sBadge(w.status)}</div></Card>)}
  </div>;
}

// ─── Kanban ────────────────────────────────────────────────────────────
function Kanban({kanban,agents,refresh}){
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
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Kanban board</h1>
      <span style={{fontSize:12,color:"#5a6070"}}>{kanban.columns.reduce((s,c)=>s+c.cards.length,0)} cards</span>
    </div>
    <div style={{display:"flex",gap:10,overflow:"auto",paddingBottom:12}}>
      {kanban.columns.map(col=><div key={col.id} style={{minWidth:220,maxWidth:260,flex:1,background:"#0d0f14",border:"1px solid #1a1e2c",borderRadius:10,display:"flex",flexDirection:"column",maxHeight:"calc(100vh - 140px)"}}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #1a1e2c",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:cc[col.id]||"#6b7280"}}/><span style={{fontSize:12,fontWeight:500}}>{col.title}</span><span style={{fontSize:10,color:"#5a6070",background:"#161a24",padding:"1px 6px",borderRadius:4}}>{col.count}</span></div>
          <button onClick={()=>setAddTo(col.id)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>+</button>
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
    {addTo&&<Modal onClose={()=>setAddTo(null)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Add card to {kanban.columns.find(c=>c.id===addTo)?.title}</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <Input value={nc.title} onChange={v=>setNc({...nc,title:v})} placeholder="Card title" autoFocus/>
        <Input value={nc.description} onChange={v=>setNc({...nc,description:v})} placeholder="Description"/>
        <div style={{display:"flex",gap:8}}>
          <Select value={nc.priority} onChange={v=>setNc({...nc,priority:v})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></Select>
          <Select value={nc.assignedAgent} onChange={v=>setNc({...nc,assignedAgent:v})} style={{flex:1}}><option value="">Unassigned</option>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</Select>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setAddTo(null)}>Cancel</Btn><Btn v="primary" onClick={add} disabled={!nc.title}>Add</Btn></div>
      </div>
    </Modal>}
    {edit&&<Modal onClose={()=>setEdit(null)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 8px"}}>{edit.title}</h3>
      {edit.description&&<p style={{fontSize:12,color:"#8b90a0",margin:"0 0 12px"}}>{edit.description}</p>}
      <div style={{fontSize:11,color:"#5a6070",marginBottom:12}}>Move to:</div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14}}>
        {kanban.columns.map(c=><Btn key={c.id} sm v={edit.column_id===c.id?"primary":"default"} onClick={()=>{move(edit.id,c.id);setEdit(null);}}>{c.title}</Btn>)}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn sm v="danger" onClick={()=>{del(edit.id);setEdit(null);}}>Delete</Btn><Btn sm onClick={()=>setEdit(null)}>Close</Btn></div>
    </Modal>}
  </div>;
}

// ─── Agents ────────────────────────────────────────────────────────────
function Agents({agents,gateways,agentAction,deleteAgent,refresh}){
  const [sel,setSel]=useState(null);
  const [showOb,setShowOb]=useState(false);
  const [na,setNa]=useState({name:'',gatewayId:'',model:'claude-sonnet-4-6',role:'general',channel:'webchat',notes:''});
  const [confirmDel,setConfirmDel]=useState(null);
  const onboard=async()=>{if(!na.name)return;await apiPost('/api/agents',na);setNa({name:'',gatewayId:'',model:'claude-sonnet-4-6',role:'general',channel:'webchat',notes:''});setShowOb(false);refresh();};
  const a=sel?agents.find(x=>x.id===sel):null;
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Agents ({agents.length})</h1>
      <Btn v="primary" onClick={()=>setShowOb(true)}><I t="plus" s={12}/> Onboard agent</Btn>
    </div>
    <div style={{display:"grid",gridTemplateColumns:sel?"1fr 340px":"1fr",gap:14}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>{["","Name","Role","Model","Gateway","Status","Controls"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{agents.map(ag=><tr key={ag.id} onClick={()=>setSel(ag.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===ag.id?"#151820":"transparent"}} onMouseEnter={e=>{if(sel!==ag.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==ag.id)e.currentTarget.style.background="transparent"}}>
            <td style={{padding:"8px 10px"}}><Dot status={ag.status} size={10}/></td>
            <td style={{padding:"8px 10px",fontWeight:500,color:"#f0f2f5"}}>{ag.name}</td>
            <td style={{padding:"8px 10px",color:"#8b90a0"}}>{ag.role}</td>
            <td style={{padding:"8px 10px"}} className="mono"><span style={{fontSize:10,color:"#5a6070"}}>{ag.model||'—'}</span></td>
            <td style={{padding:"8px 10px",color:"#5a6070"}}>{ag.gateway_label||'—'}</td>
            <td style={{padding:"8px 10px"}}>{sBadge(ag.status)}</td>
            <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",gap:3}}>
                {ag.status==='onboarding'&&<Btn sm v="success" onClick={()=>agentAction(ag.id,'activate')}>Activate</Btn>}
                {!['running','onboarding'].includes(ag.status)&&<Btn sm v="success" onClick={()=>agentAction(ag.id,'start')}><I t="play" s={10}/></Btn>}
                {ag.status==='running'&&<Btn sm onClick={()=>agentAction(ag.id,'pause')}><I t="pause" s={10}/></Btn>}
                {['running','paused'].includes(ag.status)&&<Btn sm v="danger" onClick={()=>agentAction(ag.id,'stop')}><I t="stop" s={10}/></Btn>}
                {['stopped','error'].includes(ag.status)&&<Btn sm onClick={()=>agentAction(ag.id,'restart')}><I t="refresh" s={10}/></Btn>}
              </div>
            </td>
          </tr>)}</tbody>
        </table>
      </Card>
      {a&&<Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><div><div style={{fontSize:14,fontWeight:600,color:"#f0f2f5"}}>{a.name}</div><div style={{fontSize:11,color:"#5a6070"}}>{a.id}</div></div><button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>×</button></div>
        {[["Status",sBadge(a.status)],["Role",a.role],["Model",a.model||'—'],["Gateway",a.gateway_label||'—'],["Channel",a.channel||'—'],["Max concurrent",a.max_concurrent],["Tokens",fmtTok(a.tokens_used||0)],["Cost","$"+(a.cost_usd||0).toFixed(2)],["Sessions",a.sessions_active||0],["Restarts",a.restarts||0],["Last heartbeat",fmtTime(a.last_heartbeat)],["Created",new Date(a.created_at).toLocaleDateString()]].map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #12141b",fontSize:12}}><span style={{color:"#5a6070"}}>{k}</span><span style={{color:"#d4d8e0"}}>{v}</span></div>)}
        {a.notes&&<div style={{marginTop:10,fontSize:11,color:"#5a6070",lineHeight:1.4}}>{a.notes}</div>}
        <div style={{display:"flex",gap:6,marginTop:14}}>
          {canWrite&&a.gateway_id&&<Btn sm v="primary" onClick={async()=>{try{const r=await apiPost(`/api/agents/${a.id}/pull-config`);if(r.ok)alert('Config pulled and saved.');}catch(e){alert('Failed: '+e.message);}}}>Pull config</Btn>}
          {canWrite&&<Btn sm onClick={async()=>{try{const r=await apiGet(`/api/agents/${a.id}/config`);alert(JSON.stringify(r.config,null,2).slice(0,500));}catch(e){alert(e.message);}}}>View config</Btn>}
          {canWrite&&<Btn sm v="danger" onClick={()=>setConfirmDel(a.id)}>Remove agent</Btn>}
        </div>
      </Card>}
    </div>
    {showOb&&<Modal onClose={()=>setShowOb(false)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Onboard new agent</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Name</div><Input value={na.name} onChange={v=>setNa({...na,name:v})} placeholder="e.g. Cipher" autoFocus/></div>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Gateway</div><Select value={na.gatewayId} onChange={v=>setNa({...na,gatewayId:v})} style={{width:"100%"}}><option value="">None</option>{gateways.map(g=><option key={g.id} value={g.id}>{g.label} ({g.host})</option>)}</Select></div>
        <div style={{display:"flex",gap:8}}><div style={{flex:1}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Model</div><Input value={na.model} onChange={v=>setNa({...na,model:v})}/></div><div style={{flex:1}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Role</div><Input value={na.role} onChange={v=>setNa({...na,role:v})}/></div></div>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Channel</div><Select value={na.channel} onChange={v=>setNa({...na,channel:v})} style={{width:"100%"}}><option value="webchat">Webchat</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="discord">Discord</option><option value="slack">Slack</option></Select></div>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Notes</div><Input value={na.notes} onChange={v=>setNa({...na,notes:v})} placeholder="What does this agent do?"/></div>
        <div style={{background:"#0d0f14",borderRadius:8,padding:12,fontSize:11,color:"#8b90a0"}}>Agent starts in <Badge color="orange">onboarding</Badge> status. Configure gateway, install skills, then click <strong style={{color:"#22c55e"}}>Activate</strong>.</div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShowOb(false)}>Cancel</Btn><Btn v="primary" onClick={onboard} disabled={!na.name}>Create</Btn></div>
      </div>
    </Modal>}
    {confirmDel&&<Modal onClose={()=>setConfirmDel(null)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#ef4444",margin:"0 0 14px"}}>Remove agent?</h3>
      <p style={{fontSize:12,color:"#8b90a0",marginBottom:14}}>Removes from Mission Control only. The OpenClaw instance continues running on its gateway.</p>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setConfirmDel(null)}>Cancel</Btn><Btn v="danger" onClick={()=>{deleteAgent(confirmDel);setConfirmDel(null);setSel(null);}}>Remove</Btn></div>
    </Modal>}
  </div>;
}

// ─── Workplans ─────────────────────────────────────────────────────────
function Workplans({workplans,refresh}){
  const [sel,setSel]=useState(null);
  const wp=sel?workplans.find(w=>w.id===sel):null;
  const act=async(id,status)=>{await apiPatch(`/api/workplans/${id}`,{status});refresh();};
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Workplans ({workplans.length})</h1>
    <div style={{display:"grid",gridTemplateColumns:sel?"1fr 360px":"1fr",gap:14}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>{["","Name","Status","Created","Controls"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}</tr></thead>
          <tbody>{workplans.map(w=><tr key={w.id} onClick={()=>setSel(w.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===w.id?"#151820":"transparent"}} onMouseEnter={e=>{if(sel!==w.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==w.id)e.currentTarget.style.background="transparent"}}>
            <td style={{padding:"8px 10px"}}><Dot status={w.status}/></td>
            <td style={{padding:"8px 10px",fontWeight:500,color:"#f0f2f5"}}>{w.name}</td>
            <td style={{padding:"8px 10px"}}>{sBadge(w.status)}</td>
            <td style={{padding:"8px 10px",color:"#5a6070"}}>{new Date(w.created_at).toLocaleDateString()}</td>
            <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
              <div style={{display:"flex",gap:3}}>
                {w.status==='draft'&&<Btn sm v="success" onClick={()=>act(w.id,'active')}>Activate</Btn>}
                {w.status==='active'&&<Btn sm onClick={()=>act(w.id,'paused')}><I t="pause" s={10}/></Btn>}
                {w.status==='paused'&&<Btn sm v="success" onClick={()=>act(w.id,'active')}><I t="play" s={10}/></Btn>}
                {['active','paused'].includes(w.status)&&<Btn sm v="success" onClick={()=>act(w.id,'completed')}>Done</Btn>}
                {w.status==='completed'&&<Btn sm onClick={()=>act(w.id,'archived')}>Archive</Btn>}
              </div>
            </td>
          </tr>)}</tbody>
        </table>
        {workplans.length===0&&<div style={{padding:30,textAlign:"center",color:"#3a3e50",fontSize:12}}>No workplans.</div>}
      </Card>
      {wp&&<Card>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}><div style={{fontSize:14,fontWeight:600,color:"#f0f2f5"}}>{wp.name}</div><button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>×</button></div>
        <div style={{fontSize:12,color:"#8b90a0",marginBottom:8}}>{wp.description||'—'}</div>
        {sBadge(wp.status)}
        {wp.phases&&wp.phases.map(ph=><div key={ph.id} style={{marginTop:12}}><div style={{fontSize:12,fontWeight:500,color:"#8b90a0",marginBottom:6}}>{ph.name}</div>{ph.tasks&&ph.tasks.map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:"1px solid #12141b",fontSize:11}}><Dot status={t.status} size={6}/><span style={{flex:1,color:"#d4d8e0"}}>{t.name}</span>{sBadge(t.status)}</div>)}</div>)}
      </Card>}
    </div>
  </div>;
}

// ─── Gateways ──────────────────────────────────────────────────────────
function Gateways({gateways,refresh}){
  const [show,setShow]=useState(false);
  const [ng,setNg]=useState({label:'',host:'',port:'18789',token:''});
  const add=async()=>{if(!ng.host)return;await apiPost('/api/managed-gateways',{...ng,port:parseInt(ng.port)||18789});setNg({label:'',host:'',port:'18789',token:''});setShow(false);refresh();};
  const del=async id=>{await apiDelete(`/api/managed-gateways/${id}`);refresh();};
  return <div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Gateways ({gateways.length})</h1>
      <Btn v="primary" onClick={()=>setShow(true)}><I t="plus" s={12}/> Add gateway</Btn>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:10}}>
      {gateways.map(g=><Card key={g.id} style={{padding:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}><div style={{display:"flex",alignItems:"center",gap:8}}><Dot status={g.status} size={10}/><span style={{fontWeight:500,fontSize:13}}>{g.label}</span></div>{sBadge(g.status)}</div>
        <div className="mono" style={{fontSize:11,color:"#5a6070",marginBottom:8}}>{g.host}:{g.port}</div>
        <Btn sm v="danger" onClick={()=>del(g.id)}><I t="trash" s={10}/> Remove</Btn>
      </Card>)}
      {gateways.length===0&&<Card style={{textAlign:"center",color:"#3a3e50",fontSize:12,padding:30}}>No gateways. Add one to connect agents.</Card>}
    </div>
    {show&&<Modal onClose={()=>setShow(false)}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Add gateway</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Label</div><Input value={ng.label} onChange={v=>setNg({...ng,label:v})} placeholder="e.g. Primary Gateway" autoFocus/></div>
        <div style={{display:"flex",gap:8}}><div style={{flex:2}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Host</div><Input value={ng.host} onChange={v=>setNg({...ng,host:v})} placeholder="192.168.1.10" className="mono"/></div><div style={{flex:1}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Port</div><Input value={ng.port} onChange={v=>setNg({...ng,port:v})} className="mono"/></div></div>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Auth token</div><Input type="password" value={ng.token} onChange={v=>setNg({...ng,token:v})} placeholder="Gateway token"/></div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShow(false)}>Cancel</Btn><Btn v="primary" onClick={add} disabled={!ng.host}>Add</Btn></div>
      </div>
    </Modal>}
  </div>;
}

// ─── Watchdog ──────────────────────────────────────────────────────────
function Watchdog({agents,health,agentAction}){
  const bad=agents.filter(a=>['error','stopped'].includes(a.status));
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Watchdog</h1>
    <div style={{display:"flex",gap:10,marginBottom:16}}>
      <Metric label="Status" value={health?.watchdog||'—'} color={health?.watchdog==='active'?"#22c55e":"#f59e0b"} icon="shield"/>
      <Metric label="Unhealthy" value={bad.length} color={bad.length?"#ef4444":"#22c55e"} icon="agent"/>
    </div>
    {bad.length>0&&<>{bad.map(a=><Card key={a.id} style={{padding:12,marginBottom:8}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}><div style={{display:"flex",alignItems:"center",gap:8}}><Dot status={a.status}/><span style={{fontWeight:500,fontSize:13}}>{a.name}</span>{sBadge(a.status)}</div><div style={{display:"flex",gap:4}}><Btn sm v="success" onClick={()=>agentAction(a.id,'restart')}>Restart</Btn><Btn sm onClick={()=>agentAction(a.id,'start')}>Start</Btn></div></div></Card>)}</>}
    {bad.length===0&&<Card style={{textAlign:"center",color:"#22c55e",fontSize:13,padding:30}}>All agents healthy.</Card>}
  </div>;
}

// ─── Events ────────────────────────────────────────────────────────────
function Events({events}){
  return <div>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Events ({events.length})</h1>
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

// ═══════════════════════════════════════════════════════════════════════
// SETTINGS — User management, RBAC, system config
// ═══════════════════════════════════════════════════════════════════════
function Settings({currentUser, isAdmin}){
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({username:'',password:'',displayName:'',role:'viewer'});
  const [editUser, setEditUser] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null), 3000); };

  const loadUsers = async () => {
    try { const u = await apiGet('/api/users'); setUsers(u || []); }
    catch { setUsers([]); }
  };
  useEffect(() => { loadUsers(); }, []);

  const createUser = async () => {
    if (!newUser.username || !newUser.password) return;
    try {
      await apiPost('/api/users', newUser);
      setNewUser({username:'',password:'',displayName:'',role:'viewer'});
      setShowAdd(false);
      showToast('User created');
      loadUsers();
    } catch(e) { showToast(e.message, false); }
  };

  const updateUser = async (id, updates) => {
    try {
      await apiPatch(`/api/users/${id}`, updates);
      showToast('User updated');
      loadUsers();
      setEditUser(null);
    } catch(e) { showToast(e.message, false); }
  };

  const deleteUser = async (id) => {
    try {
      await apiDelete(`/api/users/${id}`);
      showToast('User removed');
      loadUsers();
    } catch(e) { showToast(e.message, false); }
  };

  const logout = () => {
    apiPost('/api/auth/logout').catch(()=>{});
    sessionStorage.clear();
    window.location.href = '/login';
  };

  const roleBadge = r => <Badge color={r==='admin'?'orange':r==='editor'?'blue':'gray'}>{r}</Badge>;

  return <div>
    {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:200,background:toast.ok?"#0d2818":"#2a0f0f",color:toast.ok?"#22c55e":"#ef4444",border:`1px solid ${toast.ok?"#143d24":"#3d1616"}`,borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:500}}>{toast.msg}</div>}

    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:"0 0 16px"}}>Settings</h1>

    {/* Current user info */}
    <Card style={{padding:14,marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:36,height:36,borderRadius:"50%",background:"#1a1e2c",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:600,color:"#e85d24"}}>{(currentUser?.displayName||currentUser?.username||'?')[0].toUpperCase()}</div>
          <div>
            <div style={{fontSize:13,fontWeight:500,color:"#f0f2f5"}}>{currentUser?.displayName||currentUser?.username||'Unknown'}</div>
            <div style={{fontSize:11,color:"#5a6070"}}>{currentUser?.username} · {roleBadge(currentUser?.role||'viewer')}</div>
          </div>
        </div>
        <Btn sm v="danger" onClick={logout}>Sign out</Btn>
      </div>
    </Card>

    {/* Tabs */}
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {[["users","Users & access"],["roles","Role permissions"],["system","System"]].map(([id,label])=>
        <button key={id} onClick={()=>setTab(id)} style={{fontSize:11,padding:"5px 14px",borderRadius:6,border:"1px solid "+(tab===id?"#e85d24":"#1e2430"),background:tab===id?"#2a1508":"transparent",color:tab===id?"#e85d24":"#5a6070",cursor:"pointer"}}>{label}</button>
      )}
    </div>

    {/* Users tab */}
    {tab==="users"&&<div>
      {isAdmin&&<div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
        <Btn v="primary" onClick={()=>setShowAdd(true)}><I t="plus" s={12}/> Add user</Btn>
      </div>}

      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
            {["Username","Display name","Role","Status","Last login",isAdmin?"Actions":""].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}
          </tr></thead>
          <tbody>{users.map(u=><tr key={u.id} style={{borderBottom:"1px solid #12141b"}}>
            <td style={{padding:"8px 10px",fontWeight:500,color:"#f0f2f5"}}>{u.username}</td>
            <td style={{padding:"8px 10px",color:"#8b90a0"}}>{u.display_name||'—'}</td>
            <td style={{padding:"8px 10px"}}>{roleBadge(u.role)}</td>
            <td style={{padding:"8px 10px"}}><Badge color={u.enabled?"green":"red"}>{u.enabled?"active":"disabled"}</Badge></td>
            <td style={{padding:"8px 10px",color:"#5a6070",fontSize:11}}>{u.last_login?new Date(u.last_login).toLocaleString():'never'}</td>
            <td style={{padding:"8px 10px"}}>
              {isAdmin&&u.id!==currentUser?.userId&&<div style={{display:"flex",gap:3}}>
                <Btn sm onClick={()=>setEditUser(u)}>Edit</Btn>
                <Btn sm v="danger" onClick={()=>deleteUser(u.id)}>Remove</Btn>
              </div>}
            </td>
          </tr>)}</tbody>
        </table>
        {!isAdmin&&<div style={{padding:20,textAlign:"center",color:"#5a6070",fontSize:12}}>Only admins can manage users.</div>}
      </Card>

      {/* Add user modal */}
      {showAdd&&<Modal onClose={()=>setShowAdd(false)}>
        <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Add user</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Username</div><Input value={newUser.username} onChange={v=>setNewUser({...newUser,username:v})} placeholder="e.g. jsmith" autoFocus/></div>
          <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Display name</div><Input value={newUser.displayName} onChange={v=>setNewUser({...newUser,displayName:v})} placeholder="e.g. John Smith"/></div>
          <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Password</div><Input type="password" value={newUser.password} onChange={v=>setNewUser({...newUser,password:v})} placeholder="Strong password"/></div>
          <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Role</div>
            <Select value={newUser.role} onChange={v=>setNewUser({...newUser,role:v})} style={{width:"100%"}}>
              <option value="admin">Admin — full access</option>
              <option value="editor">Editor — read + write</option>
              <option value="viewer">Viewer — read only</option>
            </Select>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}><Btn onClick={()=>setShowAdd(false)}>Cancel</Btn><Btn v="primary" onClick={createUser} disabled={!newUser.username||!newUser.password}>Create</Btn></div>
        </div>
      </Modal>}

      {/* Edit user modal */}
      {editUser&&<Modal onClose={()=>setEditUser(null)}>
        <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Edit: {editUser.username}</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Role</div>
            <Select value={editUser.role} onChange={v=>setEditUser({...editUser,role:v})} style={{width:"100%"}}>
              <option value="admin">Admin</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
            </Select>
          </div>
          <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>New password (leave blank to keep)</div><Input type="password" value={editUser.newPassword||''} onChange={v=>setEditUser({...editUser,newPassword:v})} placeholder="Leave blank to keep current"/></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <label style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"#8b90a0",cursor:"pointer"}}>
              <input type="checkbox" checked={editUser.enabled!==false&&editUser.enabled!==0} onChange={e=>setEditUser({...editUser,enabled:e.target.checked})} style={{accentColor:"#e85d24"}}/>
              Account enabled
            </label>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={()=>setEditUser(null)}>Cancel</Btn>
            <Btn v="primary" onClick={()=>updateUser(editUser.id, {role:editUser.role, enabled:editUser.enabled!==false&&editUser.enabled!==0, password:editUser.newPassword||undefined})}>Save</Btn>
          </div>
        </div>
      </Modal>}
    </div>}

    {/* Roles tab */}
    {tab==="roles"&&<Card>
      <div style={{fontSize:13,fontWeight:500,color:"#f0f2f5",marginBottom:12}}>Role-based access control</div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
          {["Permission","Admin","Editor","Viewer"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"center",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}
        </tr></thead>
        <tbody>
          {[
            ["View dashboards, agents, kanban, infra","read"],
            ["Create & edit agents, cards, workplans","write"],
            ["Delete agents, cards, components","delete"],
            ["Run network scans","scan"],
            ["Manage gateway configs","config"],
            ["Manage users & system settings","admin"],
          ].map(([label,perm])=><tr key={perm} style={{borderBottom:"1px solid #12141b"}}>
            <td style={{padding:"8px 10px",color:"#d4d8e0"}}>{label}</td>
            {["admin","editor","viewer"].map(role=><td key={role} style={{padding:"8px 10px",textAlign:"center"}}>
              {(role==='admin'||(['editor'].includes(role)&&['read','write','delete','scan'].includes(perm))||(['viewer'].includes(role)&&perm==='read'))
                ?<span style={{color:"#22c55e"}}>✓</span>
                :<span style={{color:"#3a3e50"}}>—</span>}
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </Card>}

    {/* System tab */}
    {tab==="system"&&<Card>
      <div style={{fontSize:13,fontWeight:500,color:"#f0f2f5",marginBottom:12}}>System information</div>
      {[
        ["Install path","/opt/mission-control"],
        ["Database","SQLite (WAL mode)"],
        ["Config","/opt/mission-control/.env"],
        ["Logs","pm2 logs mission-control"],
      ].map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #12141b",fontSize:12}}>
        <span style={{color:"#5a6070"}}>{k}</span><span className="mono" style={{color:"#d4d8e0",fontSize:11}}>{v}</span>
      </div>)}
    </Card>}
  </div>;
}
