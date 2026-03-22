import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import InfraPanel from "./InfraPanel";

/* ═══════════════════════════════════════════════════════════════════════
   OpenClaw Mission Control v2 — Execution-Driven Fleet Orchestrator
   ═══════════════════════════════════════════════════════════════════════ */

// ─── Data generators ───────────────────────────────────────────────────
const MODELS=["claude-opus-4-6","claude-sonnet-4-6","claude-haiku-4-5","gpt-5.4","gemini-3.1"];
const CHANNELS=["whatsapp","telegram","discord","slack","signal","webchat"];
const rand=a=>a[Math.floor(Math.random()*a.length)];
const uid=()=>Math.random().toString(36).slice(2,10);
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

function mkAgent(gwIdx){
  const st=Math.random()>.12?"online":Math.random()>.5?"degraded":"offline";
  const id=uid();
  return{id,name:rand(["Atlas","Orion","Nova","Helios","Echo","Nexus","Bolt","Cipher","Drift","Flux","Pulse","Zenith"])+"-"+Math.floor(Math.random()*99),gateway:`gw-${gwIdx}`,gatewayHost:`192.168.1.${10+gwIdx}`,model:rand(MODELS),status:st,channel:rand(CHANNELS),heartbeatAge:st==="online"?Math.floor(Math.random()*180):Math.floor(Math.random()*3600),tokensUsed:Math.floor(Math.random()*2e6),costUsd:+(Math.random()*15).toFixed(2),sessionsActive:Math.floor(Math.random()*5),uptimeHrs:+(Math.random()*720).toFixed(1),memoryMb:Math.floor(50+Math.random()*300),workspace:`~/.openclaw/workspace-${id}`,lastTask:rand(["Email triage","Code review","CRM sync","Report gen","Slack monitor","Calendar","Webhook handler","Data pipeline"]),restarts:Math.floor(Math.random()*5),consecutiveFailures:0};
}
function mkGateway(i){
  const on=Math.random()>.1;
  return{id:`gw-${i}`,host:`192.168.1.${10+i}`,port:18789,status:on?"connected":"disconnected",version:"2026.3."+Math.floor(Math.random()*20),uptime:`${Math.floor(Math.random()*30)}d ${Math.floor(Math.random()*24)}h`,tokensBudget:5e6,tokensUsed:Math.floor(Math.random()*5e6),config:{gateway:{port:18789,bind:"loopback",mode:"local",reload:"hybrid",auth:{mode:"token",token:"••••••••"}},agents:{defaults:{workspace:"~/.openclaw/workspace",model:{primary:on?rand(MODELS):"anthropic/claude-sonnet-4-6"},heartbeat:{every:"30m",target:"last"},maxConcurrent:5}},session:{dmScope:"main",reset:{mode:"daily",atHour:4}},cron:{enabled:true},models:{providers:{}}}};
}

// ─── Workplan templates ────────────────────────────────────────────────
const SAMPLE_WORKPLANS=[
  {id:uid(),name:"Q2 Customer Onboarding Automation",status:"active",createdAt:Date.now()-864e5,
   description:"Automate the full customer onboarding funnel from lead capture through first-value delivery",
   phases:[
    {id:uid(),name:"Lead Processing",order:0,tasks:[
      {id:uid(),name:"Monitor CRM for new signups",assignedAgent:null,status:"completed",priority:"high",instruction:"Poll Salesforce API every 15 minutes for new contacts with status='new'. Extract name, email, company, plan tier. Write results to workspace/leads/pending.json",retries:0,maxRetries:3},
      {id:uid(),name:"Enrich lead profiles",assignedAgent:null,status:"running",priority:"high",instruction:"For each lead in pending.json, use Clearbit API to enrich with company size, industry, revenue range. Update the lead record and move to workspace/leads/enriched.json",retries:0,maxRetries:3},
      {id:uid(),name:"Score and prioritize leads",assignedAgent:null,status:"queued",priority:"normal",instruction:"Apply scoring model: enterprise (>500 employees) = 90pts, mid-market = 60pts, SMB = 30pts. Add +20 for tech industry. Sort enriched leads by score descending. Output to workspace/leads/scored.json",retries:0,maxRetries:3},
    ]},
    {id:uid(),name:"Welcome Sequence",order:1,tasks:[
      {id:uid(),name:"Send personalized welcome emails",assignedAgent:null,status:"queued",priority:"high",instruction:"For each scored lead, draft a personalized welcome email using their company context. Use the email-drafting skill. Queue via SendGrid API. Log sent status.",retries:0,maxRetries:3},
      {id:uid(),name:"Schedule onboarding calls",assignedAgent:null,status:"queued",priority:"normal",instruction:"For enterprise leads (score >= 90), find available 30-min slots in the onboarding team calendar next week. Send calendar invites via Google Calendar API.",retries:0,maxRetries:3},
    ]},
   ]},
  {id:uid(),name:"Daily Operations Checklist",status:"draft",createdAt:Date.now()-432e5,
   description:"Recurring daily tasks for system health and business operations monitoring",
   phases:[
    {id:uid(),name:"Morning Checks",order:0,tasks:[
      {id:uid(),name:"Infrastructure health scan",assignedAgent:null,status:"idle",priority:"critical",instruction:"Check all production endpoints for HTTP 200. Verify database replication lag < 5s. Check disk usage < 80%. Report any anomalies immediately via Slack #ops-alerts.",retries:0,maxRetries:5},
      {id:uid(),name:"Email inbox triage",assignedAgent:null,status:"idle",priority:"high",instruction:"Scan primary inbox for urgent items. Categorize: urgent-response, FYI, spam, newsletter. Draft responses for urgent items. Summarize findings.",retries:0,maxRetries:3},
    ]},
   ]},
];

// ─── Icons ─────────────────────────────────────────────────────────────
const I=({t,s=16,c})=>{const st={width:s,height:s,display:"inline-block",verticalAlign:"middle"};c=c||"currentColor";const m={
  server:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="3" y="3" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><circle cx="7" cy="6" r="1" fill={c}/><circle cx="7" cy="16" r="1" fill={c}/></svg>,
  agent:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2a5 5 0 015 5v2a5 5 0 01-10 0V7a5 5 0 015-5z"/><path d="M8 14s-4 2-4 6h16c0-4-4-6-4-6"/></svg>,
  task:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12l2 2 4-4"/></svg>,
  alert:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2L2 20h20L12 2z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16" r=".5" fill={c}/></svg>,
  refresh:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>,
  play:<svg style={st} viewBox="0 0 24 24" fill={c}><polygon points="6,3 20,12 6,21"/></svg>,
  stop:<svg style={st} viewBox="0 0 24 24" fill={c}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  terminal:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="2" y="3" width="20" height="18" rx="3"/><path d="M7 8l4 4-4 4"/><line x1="13" y1="16" x2="17" y2="16"/></svg>,
  chart:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M3 3v18h18"/><path d="M7 16l4-6 4 3 5-7"/></svg>,
  gear:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  zap:<svg style={st} viewBox="0 0 24 24" fill={c} stroke="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>,
  ai:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M8 12a4 4 0 018 0"/><circle cx="9" cy="9" r="1" fill={c}/><circle cx="15" cy="9" r="1" fill={c}/></svg>,
  plan:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M4 4h16v16H4z" rx="2"/><path d="M4 9h16"/><path d="M9 4v16"/><path d="M13 13l2 2 3-3"/></svg>,
  dispatch:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>,
  shield:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M12 2l8 4v6c0 5.25-3.5 9.75-8 11-4.5-1.25-8-5.75-8-11V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>,
  edit:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  plus:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  eye:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  copy:<svg style={st} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>,
};return m[t]||null;};

// ─── Formatters ────────────────────────────────────────────────────────
const fmtTime=s=>s<60?s+"s ago":s<3600?Math.floor(s/60)+"m ago":Math.floor(s/3600)+"h ago";
const fmtTok=n=>n>=1e6?(n/1e6).toFixed(1)+"M":n>=1e3?Math.floor(n/1e3)+"K":""+n;

// ─── Micro components ──────────────────────────────────────────────────
function Dot({status,size=8}){
  const c={online:"#22c55e",connected:"#22c55e",completed:"#22c55e",active:"#22c55e",degraded:"#f59e0b",paused:"#f59e0b",running:"#3b82f6",offline:"#ef4444",disconnected:"#ef4444",failed:"#ef4444",stopped:"#ef4444",queued:"#8b5cf6",idle:"#6b7280",draft:"#6b7280"};
  const pulse=["online","connected","running","active"].includes(status);
  return <span style={{position:"relative",display:"inline-block",width:size,height:size}}>
    {pulse&&<span style={{position:"absolute",inset:-2,borderRadius:"50%",background:c[status]||"#666",opacity:.3,animation:"pulse-ring 2s ease-out infinite"}}/>}
    <span style={{display:"block",width:size,height:size,borderRadius:"50%",background:c[status]||"#666"}}/>
  </span>;
}
function Card({children,style,...p}){return <div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:12,padding:16,...style}} {...p}>{children}</div>;}
function Badge({color,children}){const c={green:{bg:"#0d2818",text:"#22c55e",bd:"#143d24"},red:{bg:"#2a0f0f",text:"#ef4444",bd:"#3d1616"},yellow:{bg:"#2a2008",text:"#f59e0b",bd:"#3d2e0f"},blue:{bg:"#0c1a2e",text:"#3b82f6",bd:"#132d4a"},purple:{bg:"#1a0f2e",text:"#8b5cf6",bd:"#26174a"},gray:{bg:"#1a1c22",text:"#6b7080",bd:"#25272e"},orange:{bg:"#2a1508",text:"#e85d24",bd:"#4a2812"}}[color]||{bg:"#1a1c22",text:"#6b7080",bd:"#25272e"};
  return <span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:6,background:c.bg,color:c.text,border:`1px solid ${c.bd}`,textTransform:"uppercase",letterSpacing:".03em"}}>{children}</span>;}
function Btn({onClick,children,v="default",sm,disabled}){const s={default:{bg:"#161a24",hbg:"#1e2230",bd:"#1e2430",c:"#d4d8e0"},danger:{bg:"#2a0f0f",hbg:"#3d1616",bd:"#3d1616",c:"#ef4444"},primary:{bg:"#2a1508",hbg:"#3d1f0f",bd:"#4a2812",c:"#e85d24"},success:{bg:"#0d2818",hbg:"#143d24",bd:"#143d24",c:"#22c55e"}}[v];
  return <button onClick={onClick} disabled={disabled} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:sm?11:12,fontWeight:500,padding:sm?"4px 10px":"6px 14px",borderRadius:8,border:`1px solid ${s.bd}`,background:s.bg,color:s.c,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,transition:"background .15s"}} onMouseEnter={e=>{if(!disabled)e.target.style.background=s.hbg}} onMouseLeave={e=>{if(!disabled)e.target.style.background=s.bg}}>{children}</button>;}
function Section({children,icon,action}){return <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}><div style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:500,color:"#8b90a0",textTransform:"uppercase",letterSpacing:".05em"}}>{icon&&<I t={icon} s={14}/>}{children}</div>{action}</div>;}
function Metric({label,value,sub,color,icon}){return <div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:10,padding:"14px 16px",flex:1,minWidth:110}}><div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>{icon&&<I t={icon} s={13} c="#5a6070"/>}<span style={{fontSize:11,color:"#5a6070",textTransform:"uppercase",letterSpacing:".04em"}}>{label}</span></div><div style={{fontSize:22,fontWeight:600,color:color||"#f0f2f5",letterSpacing:"-.02em"}}>{value}</div>{sub&&<div style={{fontSize:11,color:"#5a6070",marginTop:2}}>{sub}</div>}</div>;}
function Tab({active,onClick,children}){return <button onClick={onClick} style={{fontSize:11,padding:"5px 14px",borderRadius:6,border:"1px solid "+(active?"#e85d24":"#1e2430"),background:active?"#2a1508":"transparent",color:active?"#e85d24":"#5a6070",cursor:"pointer"}}>{children}</button>;}

// ═══════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════
export default function MissionControl(){
  const [view,setView]=useState("overview");
  const [gateways]=useState(()=>[0,1,2].map(mkGateway));
  const [agents,setAgents]=useState(()=>{const a=[];for(let g=0;g<3;g++)for(let i=0;i<2+Math.floor(Math.random()*4);i++)a.push(mkAgent(g));return a;});
  const [workplans,setWorkplans]=useState(SAMPLE_WORKPLANS);
  const [events,setEvents]=useState([]);
  const [watchdogEnabled,setWatchdogEnabled]=useState(true);
  const [watchdogPolicy,setWatchdogPolicy]=useState({maxRetries:5,cooldownSec:30,escalateAfter:3});
  const [clock,setClock]=useState(Date.now());
  const [selectedWp,setSelectedWp]=useState(null);
  const [editingConfig,setEditingConfig]=useState(null);

  // Clock tick
  useEffect(()=>{const iv=setInterval(()=>setClock(Date.now()),2000);return()=>clearInterval(iv);},[]);

  // Simulated events
  useEffect(()=>{const iv=setInterval(()=>{const a=rand(agents);const types=["heartbeat","task_complete","task_failed","agent_connected","cron_run","tool_invoke","approval_request","agent_stopped","agent_restarted"];const type=rand(types);
    const ev={id:uid(),ts:Date.now(),type,agent:a.name,gateway:a.gateway,message:""};
    const msgs={heartbeat:`HEARTBEAT_OK from ${a.name}`,task_complete:`Task completed by ${a.name}`,task_failed:`Task failed: ${a.name} — TIMEOUT`,agent_connected:`Agent ${a.name} connected via ${a.channel}`,cron_run:`Cron job fired for ${a.name}`,tool_invoke:`Tool invocation: system.run on ${a.name}`,approval_request:`Exec approval requested: ${a.name}`,agent_stopped:`Agent ${a.name} STOPPED unexpectedly`,agent_restarted:`Watchdog restarted ${a.name} (attempt ${a.restarts+1})`};
    ev.message=msgs[type];
    // Simulate agent stopping and watchdog restart
    if(type==="agent_stopped"&&watchdogEnabled){
      setAgents(prev=>prev.map(ag=>ag.id===a.id?{...ag,status:"offline",consecutiveFailures:ag.consecutiveFailures+1}:ag));
      setTimeout(()=>{
        setAgents(prev=>prev.map(ag=>ag.id===a.id&&ag.status==="offline"?{...ag,status:"online",restarts:ag.restarts+1,consecutiveFailures:0,heartbeatAge:0}:ag));
        setEvents(prev=>[{id:uid(),ts:Date.now(),type:"agent_restarted",agent:a.name,gateway:a.gateway,message:`Watchdog auto-restarted ${a.name} successfully`},...prev].slice(0,200));
      },watchdogPolicy.cooldownSec*200);
    }
    setEvents(prev=>[ev,...prev].slice(0,200));
  },4000);return()=>clearInterval(iv);},[agents,watchdogEnabled,watchdogPolicy]);

  // Stats
  const stats=useMemo(()=>{
    const onA=agents.filter(a=>a.status==="online").length;const totT=agents.reduce((s,a)=>s+a.tokensUsed,0);const totC=agents.reduce((s,a)=>s+a.costUsd,0);
    const allTasks=workplans.flatMap(wp=>wp.phases.flatMap(p=>p.tasks));
    const running=allTasks.filter(t=>t.status==="running").length;const failed=allTasks.filter(t=>t.status==="failed").length;const completed=allTasks.filter(t=>t.status==="completed").length;
    const connGw=gateways.filter(g=>g.status==="connected").length;
    const activeWp=workplans.filter(w=>w.status==="active").length;
    const totalRestarts=agents.reduce((s,a)=>s+a.restarts,0);
    return{onA,totA:agents.length,totT,totC,running,failed,completed,connGw,totGw:gateways.length,activeWp,totalRestarts,allTasks:allTasks.length};
  },[agents,gateways,workplans,clock]);

  // Dispatch task to agent
  const dispatchTask=(wpId,phaseId,taskId,agentId)=>{
    setWorkplans(prev=>prev.map(wp=>wp.id===wpId?{...wp,phases:wp.phases.map(ph=>ph.id===phaseId?{...ph,tasks:ph.tasks.map(t=>t.id===taskId?{...t,assignedAgent:agentId,status:"running"}:t)}:ph)}:wp));
    const agent=agents.find(a=>a.id===agentId);
    setEvents(prev=>[{id:uid(),ts:Date.now(),type:"task_dispatched",agent:agent?.name||"?",gateway:agent?.gateway||"?",message:`Task dispatched to ${agent?.name} via openclaw message agent`},...prev].slice(0,200));
  };

  const restartAllFailed=useCallback(()=>{
    setWorkplans(prev=>prev.map(wp=>({...wp,phases:wp.phases.map(ph=>({...ph,tasks:ph.tasks.map(t=>t.status==="failed"?{...t,status:"queued",retries:t.retries+1}:t)}))})));
    setEvents(prev=>[{id:uid(),ts:Date.now(),type:"bulk_restart",agent:"operator",gateway:"all",message:"All failed tasks requeued"},...prev]);
  },[]);

  const navItems=[
    {id:"overview",label:"Overview",icon:"chart"},
    {id:"workplans",label:"Workplans",icon:"plan"},
    {id:"dispatch",label:"Dispatch",icon:"dispatch"},
    {id:"agents",label:"Agents",icon:"agent"},
    {id:"infra",label:"Infrastructure",icon:"server"},
    {id:"watchdog",label:"Watchdog",icon:"shield"},
    {id:"config",label:"Config",icon:"gear"},
    {id:"events",label:"Events",icon:"zap"},
    {id:"terminal",label:"Terminal",icon:"terminal"},
    {id:"analysis",label:"AI Assist",icon:"ai"},
  ];

  return <div style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",background:"#0a0c10",color:"#d4d8e0",minHeight:"100vh",display:"flex",flexDirection:"column"}}>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
      @keyframes pulse-ring{0%{transform:scale(1);opacity:.4}100%{transform:scale(2.2);opacity:0}}
      @keyframes fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      *{box-sizing:border-box;margin:0;padding:0;scrollbar-width:thin;scrollbar-color:#1e2230 transparent}
      input,textarea,select,button{font-family:inherit}
      ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:#1e2230;border-radius:3px}
      .mono{font-family:'JetBrains Mono',monospace}
    `}</style>

    {/* Header */}
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px",background:"linear-gradient(180deg,#0f1118,#0a0c10)",borderBottom:"1px solid #161a24",position:"sticky",top:0,zIndex:50}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#e85d24,#f2a623)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🦞</div>
        <div>
          <div style={{fontWeight:600,fontSize:15,color:"#f0f2f5",letterSpacing:"-.02em"}}>Mission Control</div>
          <div style={{fontSize:11,color:"#5a6070",letterSpacing:".04em",textTransform:"uppercase"}}>Execution Orchestrator v2</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:16,fontSize:12}}>
        <span style={{display:"flex",alignItems:"center",gap:4}}><Dot status={watchdogEnabled?"online":"offline"} size={6}/><span style={{color:watchdogEnabled?"#22c55e":"#ef4444",fontSize:11}}>Watchdog {watchdogEnabled?"ON":"OFF"}</span></span>
        <span style={{color:"#5a6070"}} className="mono">{new Date(clock).toLocaleTimeString()}</span>
      </div>
    </header>

    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* Sidebar */}
      <nav style={{width:56,background:"#0d0f15",borderRight:"1px solid #161a24",display:"flex",flexDirection:"column",alignItems:"center",paddingTop:12,gap:4,flexShrink:0}}>
        {navItems.map(n=><button key={n.id} onClick={()=>setView(n.id)} title={n.label} style={{width:40,height:40,borderRadius:10,border:"none",background:view===n.id?"#1a1e2c":"transparent",color:view===n.id?"#e85d24":"#5a6070",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s",position:"relative"}}>
          <I t={n.icon} s={18}/>
          {n.id==="watchdog"&&watchdogEnabled&&<span style={{position:"absolute",top:6,right:6,width:6,height:6,borderRadius:"50%",background:"#22c55e"}}/>}
          {n.id==="workplans"&&stats.activeWp>0&&<span style={{position:"absolute",top:4,right:2,fontSize:9,background:"#e85d24",color:"#fff",borderRadius:8,padding:"0 4px",fontWeight:600}}>{stats.activeWp}</span>}
        </button>)}
      </nav>

      {/* Main */}
      <main style={{flex:1,overflow:"auto",padding:20}}>
        {view==="overview"&&<OverviewPanel stats={stats} agents={agents} workplans={workplans} events={events} gateways={gateways} setView={setView} restartAllFailed={restartAllFailed} watchdogEnabled={watchdogEnabled}/>}
        {view==="workplans"&&<WorkplanPanel workplans={workplans} setWorkplans={setWorkplans} agents={agents} selectedWp={selectedWp} setSelectedWp={setSelectedWp} dispatchTask={dispatchTask}/>}
        {view==="dispatch"&&<DispatchPanel workplans={workplans} agents={agents} dispatchTask={dispatchTask} setWorkplans={setWorkplans}/>}
        {view==="agents"&&<AgentsPanel agents={agents}/>}
        {view==="infra"&&<InfraPanel/>}
        {view==="watchdog"&&<WatchdogPanel agents={agents} watchdogEnabled={watchdogEnabled} setWatchdogEnabled={setWatchdogEnabled} policy={watchdogPolicy} setPolicy={setWatchdogPolicy} events={events}/>}
        {view==="config"&&<ConfigPanel gateways={gateways} editingConfig={editingConfig} setEditingConfig={setEditingConfig}/>}
        {view==="events"&&<EventsPanel events={events}/>}
        {view==="terminal"&&<TerminalPanel agents={agents} stats={stats}/>}
        {view==="analysis"&&<AIAssistPanel workplans={workplans} setWorkplans={setWorkplans} agents={agents} stats={stats}/>}
      </main>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// OVERVIEW
// ═══════════════════════════════════════════════════════════════════════
function OverviewPanel({stats,agents,workplans,events,gateways,setView,restartAllFailed,watchdogEnabled}){
  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>Fleet overview</h1>
      <div style={{display:"flex",gap:8}}>
        {stats.failed>0&&<Btn v="danger" onClick={restartAllFailed}><I t="refresh" s={12}/> Restart {stats.failed} failed</Btn>}
      </div>
    </div>
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      <Metric label="Gateways" value={`${stats.connGw}/${stats.totGw}`} icon="server" color="#3b82f6" sub="connected"/>
      <Metric label="Agents" value={`${stats.onA}/${stats.totA}`} icon="agent" color="#22c55e" sub="online"/>
      <Metric label="Active workplans" value={stats.activeWp} icon="plan" color="#e85d24"/>
      <Metric label="Tasks running" value={stats.running} icon="zap" color="#f59e0b"/>
      <Metric label="Failed" value={stats.failed} icon="alert" color={stats.failed>0?"#ef4444":"#22c55e"}/>
      <Metric label="Watchdog restarts" value={stats.totalRestarts} icon="shield" color="#8b5cf6" sub={watchdogEnabled?"active":"disabled"}/>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {/* Active Workplans */}
      <Card>
        <Section icon="plan" action={<button onClick={()=>setView("workplans")} style={{fontSize:11,color:"#5a6070",background:"none",border:"none",cursor:"pointer"}}>Manage →</button>}>Active workplans</Section>
        {workplans.filter(w=>w.status==="active").map(wp=>{
          const tasks=wp.phases.flatMap(p=>p.tasks);const done=tasks.filter(t=>t.status==="completed").length;const pct=tasks.length?Math.round(done/tasks.length*100):0;
          return <div key={wp.id} style={{padding:"10px 12px",borderRadius:8,background:"#0d0f15",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontSize:12,fontWeight:500,color:"#f0f2f5"}}>{wp.name}</span>
              <Badge color="orange">{pct}%</Badge>
            </div>
            <div style={{height:4,background:"#1a1e2c",borderRadius:2,overflow:"hidden"}}>
              <div style={{width:`${pct}%`,height:"100%",background:"#e85d24",borderRadius:2,transition:"width .3s"}}/>
            </div>
            <div style={{display:"flex",gap:8,marginTop:6,fontSize:10,color:"#5a6070"}}>
              <span>{tasks.filter(t=>t.status==="running").length} running</span>
              <span>{tasks.filter(t=>t.status==="queued").length} queued</span>
              <span>{tasks.filter(t=>t.status==="failed").length} failed</span>
            </div>
          </div>;
        })}
        {workplans.filter(w=>w.status==="active").length===0&&<div style={{color:"#5a6070",fontSize:12,textAlign:"center",padding:20}}>No active workplans. Create one to start driving execution.</div>}
      </Card>

      {/* Agent Fleet Quick View */}
      <Card>
        <Section icon="agent" action={<button onClick={()=>setView("agents")} style={{fontSize:11,color:"#5a6070",background:"none",border:"none",cursor:"pointer"}}>View all →</button>}>Agent fleet</Section>
        {agents.slice(0,7).map(a=><div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",borderRadius:6,fontSize:12,marginBottom:2}}>
          <Dot status={a.status}/>
          <span style={{fontWeight:500,color:"#d4d8e0",flex:1}}>{a.name}</span>
          <span className="mono" style={{fontSize:10,color:"#5a6070"}}>{a.model.split("/").pop().slice(0,18)}</span>
          {a.restarts>0&&<Badge color="purple">{a.restarts} restarts</Badge>}
          <Badge color={a.status==="online"?"green":a.status==="degraded"?"yellow":"red"}>{a.status}</Badge>
        </div>)}
      </Card>

      {/* Gateway Health */}
      <Card>
        <Section icon="server" action={<button onClick={()=>setView("config")} style={{fontSize:11,color:"#5a6070",background:"none",border:"none",cursor:"pointer"}}>Configure →</button>}>Gateways</Section>
        {gateways.map(gw=>{const pct=Math.round(gw.tokensUsed/gw.tokensBudget*100);
          return <div key={gw.id} style={{padding:"8px 12px",borderRadius:8,background:"#0d0f15",marginBottom:6}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}><Dot status={gw.status}/><span className="mono" style={{fontSize:11}}>{gw.host}:{gw.port}</span></div>
              <span style={{fontSize:10,color:"#5a6070"}}>v{gw.version}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1,height:4,background:"#1a1e2c",borderRadius:2,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>80?"#ef4444":pct>60?"#f59e0b":"#22c55e",borderRadius:2}}/></div>
              <span className="mono" style={{fontSize:10,color:"#5a6070"}}>{pct}%</span>
            </div>
          </div>;
        })}
      </Card>

      {/* Live Events */}
      <Card>
        <Section icon="zap" action={<button onClick={()=>setView("events")} style={{fontSize:11,color:"#5a6070",background:"none",border:"none",cursor:"pointer"}}>View all →</button>}>Live events</Section>
        {events.slice(0,8).map((ev,i)=><div key={ev.id} style={{display:"flex",gap:8,padding:"3px 8px",fontSize:11,opacity:1-i*.08,animation:i===0?"fade-in .3s":undefined}}>
          <span className="mono" style={{fontSize:9,color:"#3a3e50",width:50,flexShrink:0}}>{new Date(ev.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
          <span style={{color:ev.type.includes("fail")||ev.type.includes("stop")?"#ef4444":ev.type.includes("complete")||ev.type.includes("restart")?"#22c55e":ev.type.includes("dispatch")?"#e85d24":"#5a6070"}}>{ev.message}</span>
        </div>)}
      </Card>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// WORKPLAN MANAGER
// ═══════════════════════════════════════════════════════════════════════
function WorkplanPanel({workplans,setWorkplans,agents,selectedWp,setSelectedWp,dispatchTask}){
  const [editTask,setEditTask]=useState(null);
  const [aiDraft,setAiDraft]=useState("");
  const [aiLoading,setAiLoading]=useState(false);

  const wp=selectedWp?workplans.find(w=>w.id===selectedWp):null;

  const addWorkplan=()=>{
    const nw={id:uid(),name:"New Workplan",status:"draft",createdAt:Date.now(),description:"",phases:[{id:uid(),name:"Phase 1",order:0,tasks:[]}]};
    setWorkplans(prev=>[nw,...prev]);setSelectedWp(nw.id);
  };

  const addPhase=(wpId)=>{
    setWorkplans(prev=>prev.map(w=>w.id===wpId?{...w,phases:[...w.phases,{id:uid(),name:`Phase ${w.phases.length+1}`,order:w.phases.length,tasks:[]}]}:w));
  };

  const addTask=(wpId,phaseId)=>{
    setWorkplans(prev=>prev.map(w=>w.id===wpId?{...w,phases:w.phases.map(p=>p.id===phaseId?{...p,tasks:[...p.tasks,{id:uid(),name:"New task",assignedAgent:null,status:"idle",priority:"normal",instruction:"",retries:0,maxRetries:3}]}:p)}:w));
  };

  const updateTask=(wpId,phaseId,taskId,updates)=>{
    setWorkplans(prev=>prev.map(w=>w.id===wpId?{...w,phases:w.phases.map(p=>p.id===phaseId?{...p,tasks:p.tasks.map(t=>t.id===taskId?{...t,...updates}:t)}:p)}:w));
  };

  const aiRefineTask=async(task)=>{
    setAiLoading(true);
    await new Promise(r=>setTimeout(r,1200));
    const refined=task.instruction+"\n\n[AI Enhancement]: Add error handling — if the API returns a 429 rate limit, implement exponential backoff with max 3 retries. Log all actions to workspace/logs/ with timestamps. On completion, update task status via webhook to Mission Control API.";
    setAiDraft(refined);setAiLoading(false);
  };

  const activateWorkplan=(wpId)=>{
    setWorkplans(prev=>prev.map(w=>w.id===wpId?{...w,status:"active",phases:w.phases.map(p=>({...p,tasks:p.tasks.map(t=>t.status==="idle"?{...t,status:"queued"}:t)}))}:w));
  };

  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>Workplan manager</h1>
      <Btn v="primary" onClick={addWorkplan}><I t="plus" s={12}/> New workplan</Btn>
    </div>

    <div style={{display:"grid",gridTemplateColumns:selectedWp?"260px 1fr":"1fr",gap:14}}>
      {/* Workplan list */}
      <Card style={{padding:8}}>
        {workplans.map(w=>{
          const tasks=w.phases.flatMap(p=>p.tasks);const done=tasks.filter(t=>t.status==="completed").length;const pct=tasks.length?Math.round(done/tasks.length*100):0;
          return <div key={w.id} onClick={()=>setSelectedWp(w.id)} style={{padding:"10px 12px",borderRadius:8,cursor:"pointer",background:selectedWp===w.id?"#1a1e2c":"transparent",marginBottom:4,transition:"background .1s"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:12,fontWeight:500,color:"#f0f2f5"}}>{w.name}</span>
              <Badge color={w.status==="active"?"green":w.status==="completed"?"blue":"gray"}>{w.status}</Badge>
            </div>
            <div style={{fontSize:10,color:"#5a6070",marginTop:4}}>{tasks.length} tasks · {pct}% complete</div>
            {w.status==="active"&&<div style={{height:3,background:"#1a1e2c",borderRadius:2,marginTop:6,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:"#e85d24",borderRadius:2}}/></div>}
          </div>;
        })}
      </Card>

      {/* Workplan detail */}
      {wp&&<div>
        <Card style={{marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div>
              <input value={wp.name} onChange={e=>setWorkplans(prev=>prev.map(w=>w.id===wp.id?{...w,name:e.target.value}:w))} style={{background:"transparent",border:"none",fontSize:16,fontWeight:600,color:"#f0f2f5",outline:"none",width:"100%"}}/>
              <input value={wp.description} onChange={e=>setWorkplans(prev=>prev.map(w=>w.id===wp.id?{...w,description:e.target.value}:w))} placeholder="Describe this workplan..." style={{background:"transparent",border:"none",fontSize:12,color:"#5a6070",outline:"none",width:"100%",marginTop:4}}/>
            </div>
            <div style={{display:"flex",gap:6}}>
              {wp.status==="draft"&&<Btn v="success" onClick={()=>activateWorkplan(wp.id)}><I t="play" s={11}/> Activate</Btn>}
              {wp.status==="active"&&<Btn v="danger" onClick={()=>setWorkplans(prev=>prev.map(w=>w.id===wp.id?{...w,status:"paused"}:w))}><I t="stop" s={11}/> Pause</Btn>}
            </div>
          </div>

          {/* Phases */}
          {wp.phases.map(phase=><div key={phase.id} style={{marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <input value={phase.name} onChange={e=>setWorkplans(prev=>prev.map(w=>w.id===wp.id?{...w,phases:w.phases.map(p=>p.id===phase.id?{...p,name:e.target.value}:p)}:w))} style={{background:"transparent",border:"none",fontSize:13,fontWeight:500,color:"#8b90a0",outline:"none"}}/>
              <Btn sm onClick={()=>addTask(wp.id,phase.id)}><I t="plus" s={10}/> Add task</Btn>
            </div>

            {phase.tasks.map(task=><div key={task.id} style={{padding:"10px 12px",borderRadius:8,background:"#0d0f15",marginBottom:4,border:editTask===task.id?"1px solid #e85d24":"1px solid transparent"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Dot status={task.status} size={7}/>
                <input value={task.name} onChange={e=>updateTask(wp.id,phase.id,task.id,{name:e.target.value})} style={{flex:1,background:"transparent",border:"none",fontSize:12,fontWeight:500,color:"#d4d8e0",outline:"none"}}/>
                <select value={task.priority} onChange={e=>updateTask(wp.id,phase.id,task.id,{priority:e.target.value})} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:4,color:"#d4d8e0",fontSize:10,padding:"2px 6px"}}>
                  <option value="critical">Critical</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
                </select>
                <select value={task.assignedAgent||""} onChange={e=>updateTask(wp.id,phase.id,task.id,{assignedAgent:e.target.value||null})} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:4,color:"#d4d8e0",fontSize:10,padding:"2px 6px",maxWidth:120}}>
                  <option value="">Unassigned</option>
                  {agents.filter(a=>a.status==="online").map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <Btn sm onClick={()=>setEditTask(editTask===task.id?null:task.id)}><I t="edit" s={10}/></Btn>
                {task.status==="queued"&&task.assignedAgent&&<Btn v="primary" sm onClick={()=>dispatchTask(wp.id,phase.id,task.id,task.assignedAgent)}><I t="dispatch" s={10}/> Go</Btn>}
                {task.status==="failed"&&<Btn v="danger" sm onClick={()=>updateTask(wp.id,phase.id,task.id,{status:"queued",retries:task.retries+1})}><I t="refresh" s={10}/> Retry</Btn>}
              </div>
              {editTask===task.id&&<div style={{marginTop:10}}>
                <div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Agent instruction (sent via <code className="mono" style={{fontSize:10,background:"#161a24",padding:"1px 4px",borderRadius:3}}>openclaw message agent</code>):</div>
                <textarea value={task.instruction} onChange={e=>updateTask(wp.id,phase.id,task.id,{instruction:e.target.value})} rows={4} placeholder="Detailed instructions for the agent..." style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:8,color:"#d4d8e0",padding:10,fontSize:12,resize:"vertical",outline:"none"}}/>
                <div style={{display:"flex",gap:6,marginTop:8}}>
                  <Btn sm v="primary" onClick={()=>aiRefineTask(task)} disabled={aiLoading}><I t="ai" s={10}/> {aiLoading?"Refining...":"AI refine"}</Btn>
                  {aiDraft&&<Btn sm v="success" onClick={()=>{updateTask(wp.id,phase.id,task.id,{instruction:aiDraft});setAiDraft("");}}><I t="task" s={10}/> Apply AI draft</Btn>}
                </div>
                {aiDraft&&<div style={{marginTop:8,padding:10,background:"#0d1520",border:"1px solid #132d4a",borderRadius:8,fontSize:11,color:"#85B7EB",whiteSpace:"pre-wrap",maxHeight:150,overflow:"auto"}}><div style={{fontSize:10,color:"#3b82f6",marginBottom:4,fontWeight:500}}>AI-refined draft (not yet applied — click "Apply" to accept):</div>{aiDraft}</div>}
              </div>}
            </div>)}
          </div>)}

          <Btn sm onClick={()=>addPhase(wp.id)}><I t="plus" s={10}/> Add phase</Btn>
        </Card>
      </div>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// DISPATCH CENTER
// ═══════════════════════════════════════════════════════════════════════
function DispatchPanel({workplans,agents,dispatchTask,setWorkplans}){
  const activeWps=workplans.filter(w=>w.status==="active");
  const onlineAgents=agents.filter(a=>a.status==="online");
  const allTasks=activeWps.flatMap(wp=>wp.phases.flatMap(p=>p.tasks.map(t=>({...t,wpId:wp.id,wpName:wp.name,phaseId:p.id,phaseName:p.name}))));

  const dispatchAll=()=>{
    const queued=allTasks.filter(t=>t.status==="queued"&&!t.assignedAgent);
    queued.forEach((task,i)=>{
      const agent=onlineAgents[i%onlineAgents.length];
      if(agent)dispatchTask(task.wpId,task.phaseId,task.id,agent.id);
    });
  };

  const stateColor={queued:"purple",running:"blue",completed:"green",failed:"red",paused:"yellow",idle:"gray"};

  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>Dispatch center</h1>
        <p style={{fontSize:12,color:"#5a6070",marginTop:2}}>Assign workplan tasks to agents and push execution via <code className="mono" style={{fontSize:11,background:"#161a24",padding:"1px 6px",borderRadius:3}}>openclaw message agent --session --message</code></p>
      </div>
      <div style={{display:"flex",gap:8}}>
        <Btn v="primary" onClick={dispatchAll} disabled={!allTasks.some(t=>t.status==="queued"&&!t.assignedAgent)}><I t="dispatch" s={12}/> Auto-assign all queued</Btn>
      </div>
    </div>

    <div style={{display:"flex",gap:10,marginBottom:16}}>
      {["queued","running","completed","failed"].map(state=>{
        const count=allTasks.filter(t=>t.status===state).length;
        return <Metric key={state} label={state} value={count} color={{queued:"#8b5cf6",running:"#3b82f6",completed:"#22c55e",failed:"#ef4444"}[state]}/>;
      })}
    </div>

    <Card style={{padding:0,overflow:"hidden"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
          {["State","Task","Workplan","Phase","Priority","Agent","Actions"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase",letterSpacing:".04em"}}>{h}</th>)}
        </tr></thead>
        <tbody>{allTasks.slice(0,25).map(t=><tr key={t.id} style={{borderBottom:"1px solid #12141b"}}>
          <td style={{padding:"8px 12px"}}><Badge color={stateColor[t.status]}>{t.status}</Badge></td>
          <td style={{padding:"8px 12px",fontWeight:500,color:"#d4d8e0"}}>{t.name}</td>
          <td style={{padding:"8px 12px",color:"#8b90a0",fontSize:11}}>{t.wpName}</td>
          <td style={{padding:"8px 12px",color:"#5a6070",fontSize:11}}>{t.phaseName}</td>
          <td style={{padding:"8px 12px"}}><Badge color={t.priority==="critical"?"red":t.priority==="high"?"yellow":"gray"}>{t.priority}</Badge></td>
          <td style={{padding:"8px 12px"}}>
            {t.assignedAgent?<span style={{fontSize:11}}>{agents.find(a=>a.id===t.assignedAgent)?.name||"?"}</span>:
            <select onChange={e=>{if(e.target.value)dispatchTask(t.wpId,t.phaseId,t.id,e.target.value);}} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:4,color:"#d4d8e0",fontSize:10,padding:"3px 6px"}}>
              <option value="">Assign...</option>
              {onlineAgents.map(a=><option key={a.id} value={a.id}>{a.name} ({a.model.split("/").pop().slice(0,12)})</option>)}
            </select>}
          </td>
          <td style={{padding:"8px 12px"}}><div style={{display:"flex",gap:4}}>
            {t.status==="queued"&&t.assignedAgent&&<Btn v="primary" sm onClick={()=>dispatchTask(t.wpId,t.phaseId,t.id,t.assignedAgent)}><I t="dispatch" s={10}/></Btn>}
            {t.status==="failed"&&<Btn v="danger" sm onClick={()=>setWorkplans(prev=>prev.map(w=>w.id===t.wpId?{...w,phases:w.phases.map(p=>p.id===t.phaseId?{...p,tasks:p.tasks.map(tk=>tk.id===t.id?{...tk,status:"queued",retries:tk.retries+1}:tk)}:p)}:w))}><I t="refresh" s={10}/></Btn>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT FLEET
// ═══════════════════════════════════════════════════════════════════════
function AgentsPanel({agents}){
  const [sel,setSel]=useState(null);
  const [filter,setFilter]=useState("all");
  const filtered=filter==="all"?agents:agents.filter(a=>a.status===filter);
  const a=sel?agents.find(x=>x.id===sel):null;

  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>Agent fleet</h1>
      <div style={{display:"flex",gap:6}}>
        {["all","online","degraded","offline"].map(f=><Tab key={f} active={filter===f} onClick={()=>setFilter(f)}>{f==="all"?`All (${agents.length})`:`${f} (${agents.filter(x=>x.status===f).length})`}</Tab>)}
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:sel?"1fr 320px":"1fr",gap:14}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
            {["","Agent","Gateway","Model","Channel","Heartbeat","Restarts","Sessions"].map(h=><th key={h} style={{padding:"10px 12px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase",letterSpacing:".04em"}}>{h}</th>)}
          </tr></thead>
          <tbody>{filtered.map(ag=><tr key={ag.id} onClick={()=>setSel(ag.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===ag.id?"#151820":"transparent"}} onMouseEnter={e=>{if(sel!==ag.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==ag.id)e.currentTarget.style.background="transparent"}}>
            <td style={{padding:"8px 12px"}}><Dot status={ag.status}/></td>
            <td style={{padding:"8px 12px",fontWeight:500,color:"#f0f2f5"}}>{ag.name}</td>
            <td style={{padding:"8px 12px"}} className="mono"><span style={{fontSize:10,color:"#5a6070"}}>{ag.gatewayHost}</span></td>
            <td style={{padding:"8px 12px",fontSize:10}}>{ag.model.split("/").pop()}</td>
            <td style={{padding:"8px 12px"}}><Badge color="blue">{ag.channel}</Badge></td>
            <td style={{padding:"8px 12px",color:ag.heartbeatAge<300?"#22c55e":ag.heartbeatAge<1800?"#f59e0b":"#ef4444"}} className="mono"><span style={{fontSize:10}}>{fmtTime(ag.heartbeatAge)}</span></td>
            <td style={{padding:"8px 12px",color:ag.restarts>3?"#ef4444":ag.restarts>0?"#f59e0b":"#5a6070"}}>{ag.restarts}</td>
            <td style={{padding:"8px 12px"}}>{ag.sessionsActive}</td>
          </tr>)}</tbody>
        </table>
      </Card>
      {a&&<Card style={{animation:"fade-in .2s"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><Dot status={a.status} size={10}/><span style={{fontSize:14,fontWeight:600,color:"#f0f2f5"}}>{a.name}</span></div>
          <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>×</button>
        </div>
        {[["Gateway",a.gatewayHost],["Model",a.model],["Channel",a.channel],["Workspace",a.workspace],["Heartbeat",fmtTime(a.heartbeatAge)],["Uptime",a.uptimeHrs+"h"],["Memory",a.memoryMb+"MB"],["Tokens",fmtTok(a.tokensUsed)],["Cost (24h)","$"+a.costUsd],["Restarts",a.restarts],["Last Task",a.lastTask]].map(([k,v])=><div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #12141b",fontSize:12}}>
          <span style={{color:"#5a6070"}}>{k}</span>
          <span style={{color:"#d4d8e0"}} className={k!=="Last Task"&&k!=="Channel"&&k!=="Workspace"?"mono":""}>{v}</span>
        </div>)}
        <div style={{display:"flex",gap:6,marginTop:14}}>
          <Btn v="primary" sm><I t="refresh" s={11}/> Heartbeat</Btn>
          <Btn sm><I t="terminal" s={11}/> Shell</Btn>
          <Btn v="danger" sm><I t="stop" s={11}/> Stop</Btn>
        </div>
      </Card>}
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// WATCHDOG
// ═══════════════════════════════════════════════════════════════════════
function WatchdogPanel({agents,watchdogEnabled,setWatchdogEnabled,policy,setPolicy,events}){
  const restartEvents=events.filter(e=>e.type==="agent_restarted"||e.type==="agent_stopped");
  const agentsByRestarts=[...agents].sort((a,b)=>b.restarts-a.restarts);

  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>Agent watchdog</h1>
        <p style={{fontSize:12,color:"#5a6070",marginTop:2}}>Auto-detects stopped agents and restarts them. Prevents your fleet from going dark.</p>
      </div>
      <Btn v={watchdogEnabled?"danger":"success"} onClick={()=>setWatchdogEnabled(!watchdogEnabled)}>
        <I t={watchdogEnabled?"stop":"shield"} s={12}/> {watchdogEnabled?"Disable watchdog":"Enable watchdog"}
      </Btn>
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {/* Policy config */}
      <Card>
        <Section icon="gear">Restart policy</Section>
        {[["Max retries before escalation","maxRetries",1,20],["Cooldown between retries (sec)","cooldownSec",5,300],["Escalate after N consecutive failures","escalateAfter",1,10]].map(([label,key,min,max])=>
          <div key={key} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:4}}>
              <span style={{color:"#8b90a0"}}>{label}</span>
              <span className="mono" style={{color:"#f0f2f5",fontWeight:500}}>{policy[key]}</span>
            </div>
            <input type="range" min={min} max={max} value={policy[key]} onChange={e=>setPolicy({...policy,[key]:+e.target.value})} style={{width:"100%",accentColor:"#e85d24"}}/>
          </div>
        )}
        <div style={{padding:"10px 12px",background:"#0d0f15",borderRadius:8,marginTop:8}}>
          <div style={{fontSize:11,color:"#5a6070",marginBottom:6}}>Watchdog behavior:</div>
          <div style={{fontSize:12,color:"#d4d8e0",lineHeight:1.6}}>
            When an agent stops or misses {policy.escalateAfter} consecutive heartbeats, the watchdog will automatically issue <code className="mono" style={{fontSize:10,background:"#161a24",padding:"1px 4px",borderRadius:3}}>openclaw gateway restart</code> on the target gateway. It will retry up to {policy.maxRetries} times with a {policy.cooldownSec}s cooldown. After exhausting retries, it escalates to the operator via alert.
          </div>
        </div>
      </Card>

      {/* Agent health table */}
      <Card>
        <Section icon="agent">Agent restart history</Section>
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          {agentsByRestarts.map(a=><div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,background:"#0d0f15",fontSize:12}}>
            <Dot status={a.status}/>
            <span style={{fontWeight:500,color:"#d4d8e0",flex:1}}>{a.name}</span>
            <span className="mono" style={{fontSize:10,color:"#5a6070"}}>{a.gateway}</span>
            <div style={{width:60,height:4,background:"#1a1e2c",borderRadius:2,overflow:"hidden"}}>
              <div style={{width:`${Math.min(100,a.restarts*20)}%`,height:"100%",background:a.restarts>3?"#ef4444":a.restarts>1?"#f59e0b":"#22c55e",borderRadius:2}}/>
            </div>
            <span className="mono" style={{fontSize:10,color:a.restarts>3?"#ef4444":"#5a6070",minWidth:28,textAlign:"right"}}>{a.restarts}×</span>
          </div>)}
        </div>
      </Card>
    </div>

    {/* Restart event log */}
    <Card style={{marginTop:14}}>
      <Section icon="zap">Watchdog event log</Section>
      <div className="mono" style={{fontSize:11,maxHeight:250,overflowY:"auto"}}>
        {restartEvents.length===0&&<div style={{color:"#5a6070",textAlign:"center",padding:16}}>No restart events yet.</div>}
        {restartEvents.map(ev=><div key={ev.id} style={{display:"flex",gap:12,padding:"4px 8px",borderBottom:"1px solid #12141b"}}>
          <span style={{width:70,flexShrink:0,color:"#3a3e50"}}>{new Date(ev.ts).toLocaleTimeString()}</span>
          <span style={{width:10}}><Dot status={ev.type==="agent_restarted"?"online":"failed"} size={6}/></span>
          <span style={{color:ev.type==="agent_restarted"?"#22c55e":"#ef4444"}}>{ev.message}</span>
        </div>)}
      </div>
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION MANAGER
// ═══════════════════════════════════════════════════════════════════════
function ConfigPanel({gateways,editingConfig,setEditingConfig}){
  const [selGw,setSelGw]=useState(gateways[0]?.id);
  const gw=gateways.find(g=>g.id===selGw);
  const [configText,setConfigText]=useState("");
  const [dirty,setDirty]=useState(false);

  useEffect(()=>{
    if(gw){setConfigText(JSON.stringify(gw.config,null,2));setDirty(false);}
  },[selGw]);

  const applyConfig=()=>{
    setDirty(false);
    // In production: sends config.patch or config.apply RPC to the gateway WebSocket
    alert(`Configuration would be applied to ${selGw} via config.patch RPC.\n\nThe gateway watches the config file and hot-reloads most settings automatically.`);
  };

  const configSections=[
    {key:"gateway",label:"Gateway",desc:"Port, bind, auth, reload mode",fields:["port","bind","mode","reload","auth.mode"]},
    {key:"agents.defaults",label:"Agent defaults",desc:"Model, heartbeat, workspace, concurrency",fields:["model.primary","heartbeat.every","heartbeat.target","workspace","maxConcurrent"]},
    {key:"session",label:"Sessions",desc:"DM scope, reset behavior",fields:["dmScope","reset.mode","reset.atHour"]},
    {key:"cron",label:"Cron jobs",desc:"Scheduler enabled/disabled",fields:["enabled"]},
    {key:"models",label:"Models & providers",desc:"LLM provider configs, fallbacks, routing",fields:["providers"]},
  ];

  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <div>
        <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>Configuration manager</h1>
        <p style={{fontSize:12,color:"#5a6070",marginTop:2}}>Edit <code className="mono" style={{fontSize:11,background:"#161a24",padding:"1px 6px",borderRadius:3}}>openclaw.json</code> for each gateway. Changes are applied via <code className="mono" style={{fontSize:11,background:"#161a24",padding:"1px 6px",borderRadius:3}}>config.patch</code> RPC — most settings hot-reload without restart.</p>
      </div>
    </div>

    {/* Gateway selector */}
    <div style={{display:"flex",gap:8,marginBottom:14}}>
      {gateways.map(g=><button key={g.id} onClick={()=>setSelGw(g.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",borderRadius:8,border:"1px solid "+(selGw===g.id?"#e85d24":"#1e2430"),background:selGw===g.id?"#2a1508":"#11131a",color:selGw===g.id?"#e85d24":"#d4d8e0",cursor:"pointer",fontSize:12}}>
        <Dot status={g.status} size={6}/>
        <span className="mono">{g.host}:{g.port}</span>
        <Badge color={g.status==="connected"?"green":"red"}>{g.status}</Badge>
      </button>)}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:14}}>
      {/* Section navigator */}
      <Card style={{padding:8}}>
        <Section icon="gear">Config sections</Section>
        {configSections.map(sec=><div key={sec.key} style={{padding:"8px 12px",borderRadius:8,cursor:"pointer",marginBottom:4,background:editingConfig===sec.key?"#1a1e2c":"transparent"}} onClick={()=>setEditingConfig(sec.key)}>
          <div style={{fontSize:12,fontWeight:500,color:"#f0f2f5"}}>{sec.label}</div>
          <div style={{fontSize:10,color:"#5a6070",marginTop:2}}>{sec.desc}</div>
        </div>)}
        <div style={{borderTop:"1px solid #1a1e2c",marginTop:8,paddingTop:8}}>
          <div style={{fontSize:11,color:"#5a6070",marginBottom:6}}>Quick actions:</div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <Btn sm><I t="eye" s={10}/> Validate config</Btn>
            <Btn sm><I t="copy" s={10}/> Export JSON5</Btn>
            <Btn sm><I t="refresh" s={10}/> Reload gateway</Btn>
          </div>
        </div>
      </Card>

      {/* Editor */}
      <Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <Section icon="edit">{gw?.id} — openclaw.json {dirty&&<Badge color="orange">unsaved</Badge>}</Section>
          <div style={{display:"flex",gap:6}}>
            <Btn sm v="primary" onClick={applyConfig} disabled={!dirty}><I t="dispatch" s={10}/> Apply via RPC</Btn>
          </div>
        </div>
        <div style={{position:"relative"}}>
          <textarea value={configText} onChange={e=>{setConfigText(e.target.value);setDirty(true);}} className="mono" spellCheck={false}
            style={{width:"100%",minHeight:420,background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:8,color:"#d4d8e0",padding:14,fontSize:12,lineHeight:1.6,resize:"vertical",outline:"none",tabSize:2}}/>
          <div style={{position:"absolute",top:8,right:8,fontSize:10,color:"#3a3e50"}}>JSON5 · hot-reload</div>
        </div>
        <div style={{marginTop:8,fontSize:11,color:"#3a3e50"}}>
          Hot-reloadable: model, heartbeat, cron, channel policies, tools.  Restart-required: port, bind, sandbox, plugins.
        </div>
      </Card>
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════
function EventsPanel({events}){
  const typeColors={heartbeat:"#22c55e",task_complete:"#22c55e",task_failed:"#ef4444",agent_connected:"#3b82f6",cron_run:"#f59e0b",tool_invoke:"#06b6d4",approval_request:"#f59e0b",task_dispatched:"#e85d24",agent_stopped:"#ef4444",agent_restarted:"#22c55e",bulk_restart:"#e85d24"};
  return <div style={{animation:"fade-in .3s ease"}}>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",marginBottom:16}}>Live event stream</h1>
    <Card className="mono" style={{fontSize:11,maxHeight:"72vh",overflowY:"auto"}}>
      {events.map((ev,i)=><div key={ev.id} style={{display:"flex",gap:12,padding:"5px 8px",borderBottom:"1px solid #12141b",animation:i===0?"fade-in .3s":undefined}}>
        <span style={{width:70,flexShrink:0,color:"#3a3e50"}}>{new Date(ev.ts).toLocaleTimeString()}</span>
        <span style={{width:10}}><Dot status={ev.type.includes("fail")||ev.type.includes("stop")?"failed":ev.type.includes("complete")||ev.type.includes("restart")?"online":"running"} size={6}/></span>
        <span style={{width:100,flexShrink:0,color:typeColors[ev.type]||"#5a6070",fontSize:10}}>{ev.type}</span>
        <span style={{color:"#8b90a0",flex:1}}>{ev.message}</span>
        <span style={{color:"#3a3e50",fontSize:10}}>{ev.gateway}</span>
      </div>)}
    </Card>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// TERMINAL
// ═══════════════════════════════════════════════════════════════════════
function TerminalPanel({agents,stats}){
  const [input,setInput]=useState("");
  const [log,setLog]=useState([]);
  const ref=useRef(null);
  useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[log]);

  const exec=cmd=>{
    if(!cmd.trim())return;
    const l={ts:Date.now(),cmd,output:""};
    const p=cmd.trim().split(/\s+/);
    if(p[0]==="openclaw"){
      const sub=p[1];
      if(sub==="status")l.output=`Gateways: ${stats.connGw}/${stats.totGw} connected\nAgents: ${stats.onA}/${stats.totA} online\nTasks: ${stats.running} running, ${stats.failed} failed\nWatchdog restarts: ${stats.totalRestarts}`;
      else if(sub==="agents"||sub==="nodes")l.output=agents.map(a=>`  ${a.name.padEnd(14)} ${a.status.toUpperCase().padEnd(10)} ${a.model.padEnd(22)} hb:${fmtTime(a.heartbeatAge).padEnd(8)} restarts:${a.restarts}`).join("\n");
      else if(sub==="config"&&p[2]==="get")l.output=`agents.defaults.model.primary: "anthropic/claude-sonnet-4-6"\nagents.defaults.heartbeat.every: "30m"\ngateway.port: 18789\ngateway.bind: "loopback"\ngateway.auth.mode: "token"`;
      else if(sub==="config"&&p[2]==="set")l.output=`✓ Set ${p[3]} = ${p[4]}\nHot-reloading configuration...`;
      else if(sub==="cron")l.output=`Cron status: active\nJobs: ${3+Math.floor(Math.random()*5)} scheduled\nNext wake: ${1+Math.floor(Math.random()*20)}m`;
      else if(sub==="health")l.output=`Health: OK\nWebSocket: connected\nHeartbeats: ${agents.filter(a=>a.heartbeatAge<300).length}/${agents.length} current\nGateway uptime: ${Math.floor(Math.random()*30)}d`;
      else if(sub==="doctor")l.output=`Running diagnostics...\n✓ Config valid\n✓ Gateway accessible\n✓ Channels connected\n✓ Auth token configured\n✓ Heartbeat active\n\nAll checks passed.`;
      else if(sub==="message"&&p[2]==="agent")l.output=`Message dispatched to agent session.\nWaiting for acknowledgment... ✓ Received.`;
      else if(sub==="gateway"&&p[2]==="restart")l.output=`Restarting gateway...\n✓ Gateway restarted successfully.\nReloading configuration...`;
      else l.output=`Usage: openclaw [status|agents|config get|config set|cron|health|doctor|message agent|gateway restart]`;
    }else l.output=`$ ${cmd}\nCommand executed.`;
    setLog(prev=>[...prev,l]);setInput("");
  };

  return <div style={{animation:"fade-in .3s ease"}}>
    <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",marginBottom:16}}>Gateway terminal</h1>
    <Card style={{padding:0,overflow:"hidden"}} className="mono">
      <div ref={ref} style={{padding:16,minHeight:350,maxHeight:"62vh",overflowY:"auto",background:"#090b0f",fontSize:12}}>
        <div style={{color:"#5a6070",marginBottom:8}}>OpenClaw Mission Control Terminal v2.0.0{"\n"}Connected to {stats.totGw} gateways · Watchdog {stats.totalRestarts} restarts{"\n"}Commands: openclaw [status|agents|config|cron|health|doctor|message|gateway]{"\n"}─────────────────────────────</div>
        {log.map((l,i)=><div key={i} style={{marginBottom:8}}>
          <div><span style={{color:"#e85d24"}}>operator@mc</span><span style={{color:"#5a6070"}}>:</span><span style={{color:"#3b82f6"}}>~</span><span style={{color:"#5a6070"}}>$ </span><span style={{color:"#d4d8e0"}}>{l.cmd}</span></div>
          <pre style={{margin:0,whiteSpace:"pre-wrap",color:"#8b90a0",lineHeight:1.5}}>{l.output}</pre>
        </div>)}
      </div>
      <div style={{display:"flex",alignItems:"center",borderTop:"1px solid #161a24",padding:"0 16px",background:"#0a0c10"}}>
        <span style={{color:"#e85d24",whiteSpace:"nowrap",fontSize:11}}>operator@mc:~$</span>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&exec(input)} placeholder="openclaw status" style={{flex:1,background:"transparent",border:"none",color:"#d4d8e0",padding:"12px 8px",fontSize:12,outline:"none",fontFamily:"'JetBrains Mono',monospace"}}/>
      </div>
    </Card>
    <div style={{marginTop:8,fontSize:11,color:"#3a3e50"}}>
      Try: openclaw status · openclaw config get · openclaw config set agents.defaults.heartbeat.every "15m" · openclaw doctor · openclaw message agent · openclaw gateway restart
    </div>
  </div>;
}

// ═══════════════════════════════════════════════════════════════════════
// AI ASSIST (Workplan Editing)
// ═══════════════════════════════════════════════════════════════════════
function AIAssistPanel({workplans,setWorkplans,agents,stats}){
  const [prompt,setPrompt]=useState("");
  const [response,setResponse]=useState("");
  const [loading,setLoading]=useState(false);
  const [mode,setMode]=useState("analyze");

  const runAI=async()=>{
    if(!prompt.trim())return;setLoading(true);setResponse("");
    await new Promise(r=>setTimeout(r,1500));

    const responses={
      analyze:`Fleet analysis for ${stats.totA} agents across ${stats.totGw} gateways:\n\n• Agent availability: ${Math.round(stats.onA/stats.totA*100)}% (${stats.onA}/${stats.totA} online)\n• Watchdog has performed ${stats.totalRestarts} auto-restarts — primary failure mode appears to be heartbeat timeouts\n• Token burn rate: ~${fmtTok(Math.round(stats.totT/24))}/hr ($${(stats.totC/24).toFixed(2)}/hr)\n• ${stats.failed} tasks currently failed across ${stats.activeWp} active workplans\n\nRecommendations:\n1. Reduce heartbeat interval from 30m to 15m for critical agents — faster failure detection\n2. Enable model failover on all gateways: add "fallbacks": ["claude-haiku-4-5"] to reduce timeout failures\n3. Set maxConcurrent: 3 to prevent agent overload on smaller instances\n4. Consider adding a cron job for hourly health reports via Slack`,
      refine:`Workplan optimization suggestions:\n\n${workplans.filter(w=>w.status==="active").map(wp=>{
        const tasks=wp.phases.flatMap(p=>p.tasks);
        const unassigned=tasks.filter(t=>!t.assignedAgent).length;
        return `"${wp.name}":\n• ${unassigned} tasks are unassigned — auto-assign to balance load across ${stats.onA} online agents\n• Consider parallelizing tasks within each phase where dependencies allow\n• Add retry logic: set maxRetries to 3 for API-dependent tasks with exponential backoff\n• Insert a verification task at the end of each phase to validate outputs before proceeding`;
      }).join("\n\n")}\n\nGeneral:\n• Break long-running tasks (>5min expected) into sub-tasks for better progress visibility\n• Add error-handling instructions to each task: what to do on timeout, rate limit, or tool denial`,
      generate:`Generated workplan draft based on your prompt:\n\n📋 Workplan: "${prompt.slice(0,50)}..."\n\nPhase 1 — Setup & validation\n  → Task: Verify all required API credentials and permissions\n  → Task: Create workspace directories and initialize logging\n  → Task: Run a dry-run test against staging environment\n\nPhase 2 — Execution\n  → Task: Execute primary workflow with progress checkpoints\n  → Task: Monitor for errors and rate limits during execution\n  → Task: Log results to workspace/results/ with timestamps\n\nPhase 3 — Verification & reporting\n  → Task: Validate outputs against expected schema/format\n  → Task: Generate summary report with metrics\n  → Task: Send completion notification via configured channel\n\nThis is a shadow draft — review and modify before activating. Click "Apply to workplans" to create it.`,
    };

    setResponse(responses[mode]||responses.analyze);setLoading(false);
  };

  const applyGeneratedPlan=()=>{
    const nw={id:uid(),name:prompt.slice(0,60)||"AI-Generated Workplan",status:"draft",createdAt:Date.now(),description:"Generated by AI analysis assistant",
      phases:[
        {id:uid(),name:"Setup & validation",order:0,tasks:[
          {id:uid(),name:"Verify API credentials",assignedAgent:null,status:"idle",priority:"high",instruction:"Check all required API keys and OAuth tokens are valid. Test connectivity to each external service.",retries:0,maxRetries:3},
          {id:uid(),name:"Initialize workspace",assignedAgent:null,status:"idle",priority:"normal",instruction:"Create working directories, initialize log files, set up error tracking.",retries:0,maxRetries:3},
        ]},
        {id:uid(),name:"Execution",order:1,tasks:[
          {id:uid(),name:"Execute primary workflow",assignedAgent:null,status:"idle",priority:"high",instruction:prompt,retries:0,maxRetries:3},
        ]},
        {id:uid(),name:"Verification",order:2,tasks:[
          {id:uid(),name:"Validate and report",assignedAgent:null,status:"idle",priority:"normal",instruction:"Validate all outputs, generate summary report, send completion notification.",retries:0,maxRetries:3},
        ]},
      ]};
    setWorkplans(prev=>[nw,...prev]);
  };

  return <div style={{animation:"fade-in .3s ease"}}>
    <div style={{marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5"}}>AI assistant</h1>
      <p style={{fontSize:12,color:"#5a6070",marginTop:2}}>Analyze fleet health, refine workplans, or generate new execution plans — all as shadow drafts that don't touch running agents until you explicitly apply them.</p>
    </div>

    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {[["analyze","Analyze fleet"],["refine","Refine workplans"],["generate","Generate workplan"]].map(([m,l])=>
        <Tab key={m} active={mode===m} onClick={()=>setMode(m)}>{l}</Tab>
      )}
    </div>

    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      <Card>
        <Section icon="ai">{mode==="analyze"?"Fleet analysis":mode==="refine"?"Workplan refinement":"Workplan generation"}</Section>
        <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} rows={5} placeholder={mode==="generate"?"Describe the work to be done...":mode==="refine"?"What should be improved?":"Ask about fleet health, costs, performance..."} style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:8,color:"#d4d8e0",padding:12,fontSize:12,resize:"vertical",outline:"none"}}/>
        <div style={{display:"flex",gap:6,marginTop:10}}>
          <Btn v="primary" onClick={runAI} disabled={loading}><I t="ai" s={12}/> {loading?"Processing...":"Run"}</Btn>
          {mode==="analyze"&&<Btn onClick={()=>setPrompt("Analyze fleet health and suggest optimizations")}>Quick: Health audit</Btn>}
          {mode==="refine"&&<Btn onClick={()=>setPrompt("Optimize active workplans for speed and reliability")}>Quick: Optimize</Btn>}
          {mode==="generate"&&<Btn onClick={()=>setPrompt("Daily automated monitoring: check infrastructure, triage emails, update CRM")}>Quick: Daily ops</Btn>}
        </div>
      </Card>

      <Card>
        <Section icon="chart">Context snapshot</Section>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:11}}>
          {[["Agents online",`${stats.onA}/${stats.totA}`],["Active workplans",stats.activeWp],["Tasks running",stats.running],["Tasks failed",stats.failed],["Total tokens",fmtTok(stats.totT)],["Total cost","$"+stats.totC.toFixed(2)],["Watchdog restarts",stats.totalRestarts],["Avg heartbeat",Math.round(agents.reduce((s,a)=>s+a.heartbeatAge,0)/agents.length)+"s"]].map(([k,v])=>
            <div key={k} style={{padding:"6px 8px",background:"#0d0f15",borderRadius:6,display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"#5a6070"}}>{k}</span>
              <span className="mono" style={{color:"#d4d8e0",fontWeight:500}}>{v}</span>
            </div>
          )}
        </div>
      </Card>
    </div>

    {response&&<Card style={{marginTop:14,animation:"fade-in .3s"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <Section icon="ai">Results <Badge color="blue">shadow draft</Badge></Section>
        {mode==="generate"&&<Btn v="success" sm onClick={applyGeneratedPlan}><I t="plus" s={10}/> Apply to workplans</Btn>}
      </div>
      <pre style={{fontSize:12,lineHeight:1.7,color:"#d4d8e0",whiteSpace:"pre-wrap",margin:0}}>{response}</pre>
      <div style={{marginTop:10,padding:"8px 12px",background:"#0d1520",borderRadius:6,fontSize:11,color:"#5a6070"}}>
        This is a shadow draft — it does not affect running agents or active workplans until you explicitly apply changes.
      </div>
    </Card>}
  </div>;
}
