import { useState, useMemo } from "react";

const TYPES = ["network","subnet","firewall","waf","load_balancer","server","vm","container","cluster","gateway","openclaw_gateway","api_gateway","reverse_proxy","database","cache","message_queue","object_storage","api_service","web_service","microservice","saas_integration","third_party_api","cicd_pipeline","repository","monitoring","log_aggregator","dns","certificate","custom"];
const CRED_TYPES = ["api_key","password","oauth_token","ssh_key","certificate","bearer_token","connection_string"];
const ACCESS = ["none","read","read_write"];
const uid = () => Math.random().toString(36).slice(2, 10);

const TYPE_ICONS = { network:"🌐", subnet:"🔗", firewall:"🔥", waf:"🛡", load_balancer:"⚖", server:"🖥", vm:"💻", container:"📦", cluster:"🏗", gateway:"🚪", openclaw_gateway:"🦞", api_gateway:"🔌", reverse_proxy:"↩", database:"🗄", cache:"⚡", message_queue:"📨", object_storage:"💾", api_service:"🔧", web_service:"🌍", microservice:"🔬", saas_integration:"☁", third_party_api:"🔗", cicd_pipeline:"🔄", repository:"📁", monitoring:"📊", log_aggregator:"📋", dns:"🏷", certificate:"🔒", custom:"⚙" };

const SAMPLE = [
  { id:"net-prod",type:"network",name:"Production VPC",host:"10.0.0.0/16",port:null,description:"Main production network",environment:"production",relevant:true,status:"healthy",tags:["critical"],access:[{p:"*",l:"read"}],creds:[] },
  { id:"fw-edge",type:"firewall",name:"Edge Firewall",host:"fw.edge.internal",port:443,description:"Perimeter firewall with IDS/IPS",environment:"production",relevant:true,status:"healthy",tags:["security","critical"],access:[{p:"*",l:"read"}],creds:[{id:"cred-fw",name:"fw-admin",type:"password"}] },
  { id:"waf-cf",type:"waf",name:"Cloudflare WAF",host:"api.cloudflare.com",port:null,description:"Web application firewall",environment:"production",relevant:true,status:"healthy",tags:["security"],access:[{p:"*",l:"read"},{p:"Atlas-42",l:"read_write"}],creds:[{id:"cred-cf",name:"cf-api-token",type:"api_key"}] },
  { id:"srv-web-01",type:"server",name:"Web Server 01",host:"192.168.1.20",port:443,description:"Nginx frontend",environment:"production",relevant:true,status:"healthy",tags:["web"],access:[{p:"*",l:"read"},{p:"gw-0:*",l:"read_write"}],creds:[{id:"cred-ssh",name:"ssh-deploy-key",type:"ssh_key"}] },
  { id:"lb-prod",type:"load_balancer",name:"HAProxy LB",host:"192.168.1.5",port:80,description:"Layer 7 load balancer",environment:"production",relevant:true,status:"healthy",tags:["critical"],access:[{p:"*",l:"read"}],creds:[] },
  { id:"db-pg",type:"database",name:"PostgreSQL Primary",host:"db.internal",port:5432,description:"Primary OLTP database",environment:"production",relevant:true,status:"healthy",tags:["data","critical"],access:[{p:"*",l:"read"},{p:"Cipher-11",l:"read_write"}],creds:[{id:"cred-pg-ro",name:"pg-readonly",type:"password"},{id:"cred-pg-rw",name:"pg-readwrite",type:"password"}] },
  { id:"db-redis",type:"cache",name:"Redis Cluster",host:"redis.internal",port:6379,description:"Session cache",environment:"production",relevant:true,status:"healthy",tags:["data"],access:[{p:"*",l:"read"}],creds:[{id:"cred-redis",name:"redis-auth",type:"password"}] },
  { id:"mq-rabbit",type:"message_queue",name:"RabbitMQ",host:"mq.internal",port:5672,description:"Async task queue",environment:"production",relevant:true,status:"degraded",tags:[],access:[],creds:[] },
  { id:"gw-0",type:"openclaw_gateway",name:"OpenClaw GW-0",host:"192.168.1.10",port:18789,description:"Primary agent gateway",environment:"production",relevant:true,status:"healthy",tags:["agents","critical"],access:[{p:"*",l:"read"}],creds:[{id:"cred-gw0",name:"gw-0-token",type:"api_key"}] },
  { id:"gw-1",type:"openclaw_gateway",name:"OpenClaw GW-1",host:"192.168.1.11",port:18789,description:"Secondary gateway",environment:"production",relevant:true,status:"healthy",tags:["agents"],access:[{p:"*",l:"read"}],creds:[] },
  { id:"api-crm",type:"saas_integration",name:"Salesforce CRM",host:"api.salesforce.com",port:null,description:"CRM",environment:"production",relevant:true,status:"healthy",tags:["business"],access:[{p:"Echo-7",l:"read_write"},{p:"*",l:"read"}],creds:[{id:"cred-sf",name:"salesforce-oauth",type:"oauth_token"}] },
  { id:"api-stripe",type:"third_party_api",name:"Stripe API",host:"api.stripe.com",port:null,description:"Payment processing",environment:"production",relevant:true,status:"healthy",tags:["business","critical"],access:[{p:"*",l:"none"}],creds:[{id:"cred-stripe",name:"stripe-secret",type:"api_key"}] },
  { id:"ci-gh",type:"cicd_pipeline",name:"GitHub Actions",host:"github.com",port:null,description:"CI/CD",environment:"production",relevant:true,status:"healthy",tags:["devops"],access:[{p:"gw-0:*",l:"read_write"}],creds:[{id:"cred-gh",name:"github-pat",type:"api_key"}] },
  { id:"mon-graf",type:"monitoring",name:"Grafana",host:"grafana.internal",port:3000,description:"Metrics",environment:"production",relevant:true,status:"healthy",tags:["observability"],access:[{p:"*",l:"read"}],creds:[] },
  { id:"srv-stg",type:"server",name:"Staging Server",host:"192.168.2.10",port:null,description:"Staging env",environment:"staging",relevant:false,status:"unknown",tags:["staging"],access:[],creds:[] },
];

const LEASES = [
  { id:"lease-001",credName:"pg-readonly",agent:"Cipher-11",task:"task-abc",expires:new Date(Date.now()+3600000).toISOString() },
  { id:"lease-002",credName:"salesforce-oauth",agent:"Echo-7",task:"task-def",expires:new Date(Date.now()+1800000).toISOString() },
];

// ─── Micro components (matching parent app) ──────────────────────
const st={fontFamily:"'DM Sans','Segoe UI',sans-serif"};
function Dot({status,size=8}){const c={healthy:"#22c55e",online:"#22c55e",degraded:"#f59e0b",unhealthy:"#ef4444",unknown:"#6b7280"};return<span style={{display:"inline-block",width:size,height:size,borderRadius:"50%",background:c[status]||"#6b7280"}}/>;}
function Bd({color,children}){const c={green:{bg:"#0d2818",t:"#22c55e",b:"#143d24"},red:{bg:"#2a0f0f",t:"#ef4444",b:"#3d1616"},yellow:{bg:"#2a2008",t:"#f59e0b",b:"#3d2e0f"},blue:{bg:"#0c1a2e",t:"#3b82f6",b:"#132d4a"},purple:{bg:"#1a0f2e",t:"#8b5cf6",b:"#26174a"},gray:{bg:"#1a1c22",t:"#6b7080",b:"#25272e"},orange:{bg:"#2a1508",t:"#e85d24",b:"#4a2812"},teal:{bg:"#0a2420",t:"#14b8a6",b:"#134d44"}}[color]||{bg:"#1a1c22",t:"#6b7080",b:"#25272e"};
  return<span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:6,background:c.bg,color:c.t,border:`1px solid ${c.b}`,textTransform:"uppercase",letterSpacing:".03em"}}>{children}</span>;}
function Btn({onClick,children,v="default",sm,disabled}){const s={default:{bg:"#161a24",h:"#1e2230",b:"#1e2430",c:"#d4d8e0"},danger:{bg:"#2a0f0f",h:"#3d1616",b:"#3d1616",c:"#ef4444"},primary:{bg:"#2a1508",h:"#3d1f0f",b:"#4a2812",c:"#e85d24"},success:{bg:"#0d2818",h:"#143d24",b:"#143d24",c:"#22c55e"}}[v];
  return<button onClick={onClick} disabled={disabled} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:sm?11:12,fontWeight:500,padding:sm?"4px 10px":"6px 14px",borderRadius:8,border:`1px solid ${s.b}`,background:s.bg,color:s.c,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1}}onMouseEnter={e=>{if(!disabled)e.target.style.background=s.h}}onMouseLeave={e=>{if(!disabled)e.target.style.background=s.bg}}>{children}</button>;}
function Card({children,style}){return<div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:12,padding:16,...style}}>{children}</div>;}

const accessColor = l => l === "read_write" ? "teal" : l === "read" ? "blue" : l === "none" ? "red" : "gray";
const credTypeIcon = t => ({ api_key:"🔑", password:"🔐", oauth_token:"🎫", ssh_key:"🗝", certificate:"📜", bearer_token:"🎟", connection_string:"🔗" }[t] || "🔒");

// ═══════════════════════════════════════════════════════════════════
export default function InfraPanel() {
  const [components, setComponents] = useState(SAMPLE);
  const [leases] = useState(LEASES);
  const [tab, setTab] = useState("registry");
  const [sel, setSel] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [showIrrelevant, setShowIrrelevant] = useState(false);
  const [addMode, setAddMode] = useState(null); // null | "component" | "credential" | "access"
  const [newComp, setNewComp] = useState({ type:"server",name:"",host:"",port:"",description:"",environment:"production",relevant:true });
  const [newAccess, setNewAccess] = useState({ componentId:"",agentPattern:"*",level:"read" });

  const comp = sel ? components.find(c => c.id === sel) : null;
  const filtered = useMemo(() => {
    let r = components;
    if (!showIrrelevant) r = r.filter(c => c.relevant);
    if (typeFilter !== "all") r = r.filter(c => c.type === typeFilter);
    return r;
  }, [components, typeFilter, showIrrelevant]);

  const stats = useMemo(() => ({
    total: components.length,
    relevant: components.filter(c => c.relevant).length,
    healthy: components.filter(c => c.status === "healthy").length,
    degraded: components.filter(c => c.status === "degraded").length,
    totalCreds: components.reduce((s, c) => s + c.creds.length, 0),
    activeLeases: leases.length,
    types: [...new Set(components.map(c => c.type))].length,
  }), [components, leases]);

  const addComponent = () => {
    const c = { ...newComp, id: uid(), status: "unknown", tags: [], access: [], creds: [] };
    if (c.port) c.port = parseInt(c.port);
    setComponents(prev => [...prev, c]);
    setNewComp({ type:"server",name:"",host:"",port:"",description:"",environment:"production",relevant:true });
    setAddMode(null);
  };

  const toggleRelevant = (id) => {
    setComponents(prev => prev.map(c => c.id === id ? { ...c, relevant: !c.relevant } : c));
  };

  const setAccessRule = (compId, pattern, level) => {
    setComponents(prev => prev.map(c => {
      if (c.id !== compId) return c;
      const existing = c.access.findIndex(a => a.p === pattern);
      const newAccess = [...c.access];
      if (existing >= 0) newAccess[existing] = { p: pattern, l: level };
      else newAccess.push({ p: pattern, l: level });
      return { ...c, access: newAccess };
    }));
  };

  const removeAccessRule = (compId, pattern) => {
    setComponents(prev => prev.map(c => c.id === compId ? { ...c, access: c.access.filter(a => a.p !== pattern) } : c));
  };

  return <div style={{ ...st, animation: "fade-in .3s ease" }}>
    <style>{`@keyframes fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.mono{font-family:'JetBrains Mono',monospace}`}</style>

    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
      <div>
        <h1 style={{ fontSize:18, fontWeight:600, color:"#f0f2f5" }}>Infrastructure registry</h1>
        <p style={{ fontSize:12, color:"#5a6070", marginTop:2 }}>Define your operating environment. Control what each agent can see, read, and write.</p>
      </div>
      <Btn v="primary" onClick={() => setAddMode("component")}>+ Add component</Btn>
    </div>

    {/* Stats */}
    <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
      {[["Components",stats.relevant+"/"+stats.total,"#3b82f6"],["Healthy",stats.healthy,"#22c55e"],["Degraded",stats.degraded,"#f59e0b"],["Credentials",stats.totalCreds,"#8b5cf6"],["Active leases",stats.activeLeases,"#e85d24"],["Types",stats.types,"#6b7080"]].map(([l,v,c])=>
        <div key={l} style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:10,padding:"12px 16px",flex:1,minWidth:100}}>
          <div style={{fontSize:11,color:"#5a6070",textTransform:"uppercase",letterSpacing:".04em",marginBottom:4}}>{l}</div>
          <div style={{fontSize:20,fontWeight:600,color:c}}>{v}</div>
        </div>
      )}
    </div>

    {/* Tabs */}
    <div style={{ display:"flex", gap:6, marginBottom:14 }}>
      {[["registry","Component registry"],["access","Access matrix"],["vault","Credential vault"],["leases","Active leases"]].map(([id,label])=>
        <button key={id} onClick={()=>setTab(id)} style={{fontSize:11,padding:"5px 14px",borderRadius:6,border:"1px solid "+(tab===id?"#e85d24":"#1e2430"),background:tab===id?"#2a1508":"transparent",color:tab===id?"#e85d24":"#5a6070",cursor:"pointer"}}>{label}</button>
      )}
    </div>

    {/* ─── Registry Tab ─────────────────────────────────────── */}
    {tab === "registry" && <div style={{ display:"grid", gridTemplateColumns: sel ? "1fr 340px" : "1fr", gap:14 }}>
      <Card style={{ padding:0, overflow:"hidden" }}>
        {/* Filters */}
        <div style={{ display:"flex", gap:6, padding:"10px 12px", borderBottom:"1px solid #1a1e2c", flexWrap:"wrap", alignItems:"center" }}>
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:6,color:"#d4d8e0",fontSize:11,padding:"4px 8px"}}>
            <option value="all">All types ({filtered.length})</option>
            {[...new Set(components.map(c=>c.type))].sort().map(t=><option key={t} value={t}>{t} ({components.filter(c=>c.type===t).length})</option>)}
          </select>
          <label style={{display:"flex",alignItems:"center",gap:4,fontSize:11,color:"#5a6070",cursor:"pointer"}}>
            <input type="checkbox" checked={showIrrelevant} onChange={e=>setShowIrrelevant(e.target.checked)} style={{accentColor:"#e85d24"}}/>
            Show irrelevant
          </label>
        </div>

        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
          <thead><tr style={{ borderBottom:"1px solid #1a1e2c" }}>
            {["","Type","Component","Host","Env","Status","Access","Creds",""].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase",letterSpacing:".04em"}}>{h}</th>)}
          </tr></thead>
          <tbody>{filtered.map(c=><tr key={c.id} onClick={()=>setSel(c.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===c.id?"#151820":"transparent",opacity:c.relevant?1:.5}} onMouseEnter={e=>{if(sel!==c.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==c.id)e.currentTarget.style.background="transparent"}}>
            <td style={{padding:"6px 10px"}}><Dot status={c.status}/></td>
            <td style={{padding:"6px 10px"}}><span style={{fontSize:14,marginRight:4}}>{TYPE_ICONS[c.type]||"⚙"}</span><span style={{fontSize:10,color:"#5a6070"}}>{c.type}</span></td>
            <td style={{padding:"6px 10px",fontWeight:500,color:"#f0f2f5"}}>{c.name}</td>
            <td style={{padding:"6px 10px"}} className="mono"><span style={{fontSize:10,color:"#5a6070"}}>{c.host}{c.port?`:${c.port}`:""}</span></td>
            <td style={{padding:"6px 10px"}}><Bd color={c.environment==="production"?"green":"gray"}>{c.environment}</Bd></td>
            <td style={{padding:"6px 10px"}}><Bd color={c.status==="healthy"?"green":c.status==="degraded"?"yellow":"gray"}>{c.status}</Bd></td>
            <td style={{padding:"6px 10px"}}>{c.access.length>0?c.access.map((a,i)=><Bd key={i} color={accessColor(a.l)}>{a.p==="*"?"all":a.p}:{a.l.replace("_"," ")}</Bd>):<span style={{fontSize:10,color:"#3a3e50"}}>none</span>}</td>
            <td style={{padding:"6px 10px",color:"#5a6070"}}>{c.creds.length||"—"}</td>
            <td style={{padding:"6px 10px"}}><button onClick={e=>{e.stopPropagation();toggleRelevant(c.id)}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:c.relevant?"#22c55e":"#3a3e50"}} title={c.relevant?"Mark irrelevant":"Mark relevant"}>{c.relevant?"✓":"○"}</button></td>
          </tr>)}</tbody>
        </table>
      </Card>

      {/* Detail panel */}
      {comp && <Card style={{ animation:"fade-in .2s" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:20 }}>{TYPE_ICONS[comp.type]}</span>
            <div>
              <div style={{ fontSize:14, fontWeight:600, color:"#f0f2f5" }}>{comp.name}</div>
              <div style={{ fontSize:11, color:"#5a6070" }}>{comp.type}</div>
            </div>
          </div>
          <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>×</button>
        </div>

        <div style={{ fontSize:12, color:"#8b90a0", marginBottom:12 }}>{comp.description}</div>

        {[["Host",comp.host+(comp.port?`:${comp.port}`:"")],["Environment",comp.environment],["Status",comp.status],["Relevant",comp.relevant?"Yes":"No"]].map(([k,v])=>
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #12141b",fontSize:12}}>
            <span style={{color:"#5a6070"}}>{k}</span>
            <span style={{color:"#d4d8e0"}} className="mono">{v}</span>
          </div>
        )}

        {/* Access rules */}
        <div style={{ marginTop:14, fontSize:12 }}>
          <div style={{ fontWeight:500, color:"#8b90a0", marginBottom:8, textTransform:"uppercase", fontSize:11, letterSpacing:".04em" }}>Agent access</div>
          {comp.access.length === 0 && <div style={{color:"#3a3e50",fontSize:11}}>No access rules — agents cannot see this component.</div>}
          {comp.access.map((a,i) => <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"4px 0"}}>
            <span className="mono" style={{fontSize:11}}>{a.p}</span>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <Bd color={accessColor(a.l)}>{a.l.replace("_"," ")}</Bd>
              <button onClick={()=>removeAccessRule(comp.id,a.p)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:12}}>×</button>
            </div>
          </div>)}
          <div style={{display:"flex",gap:4,marginTop:8}}>
            <input placeholder="Agent or *" value={newAccess.agentPattern} onChange={e=>setNewAccess({...newAccess,agentPattern:e.target.value})} style={{flex:1,background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:4,color:"#d4d8e0",padding:"4px 8px",fontSize:11,outline:"none"}}/>
            <select value={newAccess.level} onChange={e=>setNewAccess({...newAccess,level:e.target.value})} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:4,color:"#d4d8e0",fontSize:10,padding:"2px 6px"}}>
              {ACCESS.map(l=><option key={l} value={l}>{l.replace("_"," ")}</option>)}
            </select>
            <Btn sm v="success" onClick={()=>{setAccessRule(comp.id,newAccess.agentPattern,newAccess.level);setNewAccess({...newAccess,agentPattern:"*"});}}>+</Btn>
          </div>
        </div>

        {/* Credentials */}
        <div style={{ marginTop:14, fontSize:12 }}>
          <div style={{ fontWeight:500, color:"#8b90a0", marginBottom:8, textTransform:"uppercase", fontSize:11, letterSpacing:".04em" }}>Credentials</div>
          {comp.creds.length === 0 && <div style={{color:"#3a3e50",fontSize:11}}>No credentials linked.</div>}
          {comp.creds.map(cr => <div key={cr.id} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 0",borderBottom:"1px solid #12141b"}}>
            <span>{credTypeIcon(cr.type)}</span>
            <span style={{color:"#d4d8e0",flex:1}}>{cr.name}</span>
            <Bd color="purple">{cr.type}</Bd>
          </div>)}
        </div>

        <div style={{display:"flex",gap:6,marginTop:14}}>
          <Btn sm v="primary" onClick={()=>toggleRelevant(comp.id)}>{comp.relevant?"Mark irrelevant":"Mark relevant"}</Btn>
          <Btn sm v="danger" onClick={()=>{setComponents(prev=>prev.filter(c=>c.id!==comp.id));setSel(null);}}>Delete</Btn>
        </div>
      </Card>}
    </div>}

    {/* ─── Access Matrix Tab ────────────────────────────────── */}
    {tab === "access" && <Card style={{ padding:0, overflow:"auto" }}>
      <div style={{ padding:"10px 12px", borderBottom:"1px solid #1a1e2c", fontSize:12, color:"#5a6070" }}>
        Rows = components · Columns = agent patterns · Cells = access level (click to cycle: none → read → read_write → none)
      </div>
      {(() => {
        const allPatterns = [...new Set(components.flatMap(c => c.access.map(a => a.p)))].sort();
        if (allPatterns.length === 0) return <div style={{padding:20,textAlign:"center",color:"#3a3e50",fontSize:12}}>No access rules defined yet. Open a component and add access rules.</div>;
        return <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
              <th style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,position:"sticky",left:0,background:"#11131a",zIndex:1,minWidth:160}}>Component</th>
              {allPatterns.map(p=><th key={p} style={{padding:"8px 10px",textAlign:"center",fontSize:10,color:"#5a6070",fontWeight:500,minWidth:90}} className="mono">{p}</th>)}
            </tr></thead>
            <tbody>{components.filter(c=>c.relevant).map(c=>{
              return <tr key={c.id} style={{borderBottom:"1px solid #12141b"}}>
                <td style={{padding:"6px 10px",fontWeight:500,color:"#d4d8e0",position:"sticky",left:0,background:"#11131a",zIndex:1}}>
                  <span style={{marginRight:4}}>{TYPE_ICONS[c.type]}</span>{c.name}
                </td>
                {allPatterns.map(p=>{
                  const rule = c.access.find(a=>a.p===p);
                  const level = rule?.l || "none";
                  const cycle = () => {
                    const next = level === "none" ? "read" : level === "read" ? "read_write" : "none";
                    if (next === "none") removeAccessRule(c.id, p);
                    else setAccessRule(c.id, p, next);
                  };
                  return <td key={p} style={{padding:"4px 6px",textAlign:"center",cursor:"pointer"}} onClick={cycle}>
                    <Bd color={accessColor(level)}>{level === "none" ? "—" : level.replace("_"," ")}</Bd>
                  </td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>;
      })()}
    </Card>}

    {/* ─── Vault Tab ─────────────────────────────────────────── */}
    {tab === "vault" && <div>
      <Card style={{ padding:0, overflow:"hidden" }}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #1a1e2c",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:12,color:"#5a6070"}}>Credentials are AES-256-GCM encrypted at rest. Agents receive time-limited leases, never raw secrets.</span>
          <Btn sm v="primary" onClick={()=>setAddMode("credential")}>+ Add credential</Btn>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
            {["","Name","Type","Username","Linked component","Actions"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase",letterSpacing:".04em"}}>{h}</th>)}
          </tr></thead>
          <tbody>{components.flatMap(c=>c.creds.map(cr=>({...cr,compName:c.name,compId:c.id}))).map(cr=>
            <tr key={cr.id} style={{borderBottom:"1px solid #12141b"}}>
              <td style={{padding:"6px 10px"}}>{credTypeIcon(cr.type)}</td>
              <td style={{padding:"6px 10px",fontWeight:500,color:"#d4d8e0"}}>{cr.name}</td>
              <td style={{padding:"6px 10px"}}><Bd color="purple">{cr.type}</Bd></td>
              <td style={{padding:"6px 10px",color:"#5a6070"}} className="mono">{cr.username||"—"}</td>
              <td style={{padding:"6px 10px",color:"#8b90a0"}}>{cr.compName}</td>
              <td style={{padding:"6px 10px"}}><div style={{display:"flex",gap:4}}>
                <Btn sm>Rotate</Btn>
                <Btn sm v="danger">Revoke</Btn>
              </div></td>
            </tr>
          )}</tbody>
        </table>
      </Card>
    </div>}

    {/* ─── Leases Tab ────────────────────────────────────────── */}
    {tab === "leases" && <Card style={{ padding:0, overflow:"hidden" }}>
      <div style={{padding:"10px 12px",borderBottom:"1px solid #1a1e2c",fontSize:12,color:"#5a6070"}}>
        Active credential leases — agents with checked-out secrets. Revoke to immediately invalidate.
      </div>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
          {["Lease ID","Credential","Agent","Task","Expires","Actions"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase",letterSpacing:".04em"}}>{h}</th>)}
        </tr></thead>
        <tbody>{leases.map(l=>{
          const remaining = Math.max(0, Math.round((new Date(l.expires).getTime() - Date.now()) / 60000));
          return <tr key={l.id} style={{borderBottom:"1px solid #12141b"}}>
            <td style={{padding:"6px 10px"}} className="mono">{l.id}</td>
            <td style={{padding:"6px 10px",fontWeight:500,color:"#d4d8e0"}}>{l.credName}</td>
            <td style={{padding:"6px 10px"}}><Bd color="blue">{l.agent}</Bd></td>
            <td style={{padding:"6px 10px",color:"#5a6070"}} className="mono">{l.task}</td>
            <td style={{padding:"6px 10px",color:remaining<15?"#ef4444":"#f59e0b"}} className="mono">{remaining}m remaining</td>
            <td style={{padding:"6px 10px"}}><Btn sm v="danger">Revoke</Btn></td>
          </tr>;
        })}</tbody>
      </table>
      {leases.length === 0 && <div style={{padding:20,textAlign:"center",color:"#3a3e50",fontSize:12}}>No active leases.</div>}
    </Card>}

    {/* ─── Add component modal ──────────────────────────────── */}
    {addMode === "component" && <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}} onClick={()=>setAddMode(null)}>
      <Card style={{width:480,maxHeight:"80vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:14,fontWeight:600,color:"#f0f2f5",marginBottom:14}}>Add infrastructure component</div>
        {[["Type",<select value={newComp.type} onChange={e=>setNewComp({...newComp,type:e.target.value})} style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12}}>{TYPES.map(t=><option key={t} value={t}>{TYPE_ICONS[t]||""} {t}</option>)}</select>],
          ["Name",<input value={newComp.name} onChange={e=>setNewComp({...newComp,name:e.target.value})} placeholder="e.g. Production PostgreSQL" style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12,outline:"none"}}/>],
          ["Host / Address",<input value={newComp.host} onChange={e=>setNewComp({...newComp,host:e.target.value})} placeholder="e.g. 192.168.1.20 or db.internal" className="mono" style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12,outline:"none"}}/>],
          ["Port",<input type="number" value={newComp.port} onChange={e=>setNewComp({...newComp,port:e.target.value})} placeholder="e.g. 5432" className="mono" style={{width:120,background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12,outline:"none"}}/>],
          ["Description",<input value={newComp.description} onChange={e=>setNewComp({...newComp,description:e.target.value})} placeholder="What does this component do?" style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12,outline:"none"}}/>],
          ["Environment",<select value={newComp.environment} onChange={e=>setNewComp({...newComp,environment:e.target.value})} style={{background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12}}><option>production</option><option>staging</option><option>development</option><option>testing</option></select>],
        ].map(([label, input]) => <div key={label} style={{marginBottom:10}}>
          <div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>{label}</div>
          {input}
        </div>)}
        <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
          <Btn onClick={()=>setAddMode(null)}>Cancel</Btn>
          <Btn v="primary" onClick={addComponent} disabled={!newComp.name}>Add component</Btn>
        </div>
      </Card>
    </div>}
  </div>;
}
