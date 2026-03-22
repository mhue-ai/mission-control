import { useState, useEffect, useCallback, useRef } from "react";

const api = async (path, opts = {}) => {
  const token = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('mc_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers: { ...headers, ...opts.headers } });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || res.statusText); }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
};
const apiGet = p => api(p);
const apiPost = (p, b) => api(p, { method: 'POST', body: JSON.stringify(b) });
const apiPatch = (p, b) => api(p, { method: 'PATCH', body: JSON.stringify(b) });
const apiDelete = p => api(p, { method: 'DELETE' });

const ICONS = { network:"🌐",subnet:"🔗",firewall:"🔥",waf:"🛡",load_balancer:"⚖",server:"🖥",vm:"💻",container:"📦",cluster:"🏗",gateway:"🚪",openclaw_gateway:"🦞",api_gateway:"🔌",reverse_proxy:"↩",database:"🗄",cache:"⚡",message_queue:"📨",object_storage:"💾",api_service:"🔧",web_service:"🌍",microservice:"🔬",saas_integration:"☁",third_party_api:"🔗",cicd_pipeline:"🔄",repository:"📁",monitoring:"📊",log_aggregator:"📋",dns:"🏷",certificate:"🔒",custom:"⚙" };
const TYPES = ["server","database","cache","web_service","api_service","openclaw_gateway","firewall","waf","load_balancer","network","message_queue","monitoring","cicd_pipeline","saas_integration","third_party_api","custom"];

// ─── Micro components (matching OpenClaw Control UI style) ─────────
function Dot({status,size=8}){const c={healthy:"#22c55e",online:"#22c55e",degraded:"#f59e0b",unhealthy:"#ef4444",unknown:"#6b7280"};return<span style={{display:"inline-block",width:size,height:size,borderRadius:"50%",background:c[status]||"#6b7280"}}/>;}
function Badge({color,children}){const c={green:{bg:"#0d2818",t:"#22c55e",b:"#143d24"},red:{bg:"#2a0f0f",t:"#ef4444",b:"#3d1616"},yellow:{bg:"#2a2008",t:"#f59e0b",b:"#3d2e0f"},blue:{bg:"#0c1a2e",t:"#3b82f6",b:"#132d4a"},purple:{bg:"#1a0f2e",t:"#8b5cf6",b:"#26174a"},gray:{bg:"#1a1c22",t:"#6b7080",b:"#25272e"},orange:{bg:"#2a1508",t:"#e85d24",b:"#4a2812"},teal:{bg:"#0a2420",t:"#14b8a6",b:"#134d44"}}[color]||{bg:"#1a1c22",t:"#6b7080",b:"#25272e"};return<span style={{display:"inline-flex",alignItems:"center",fontSize:10,fontWeight:500,padding:"2px 8px",borderRadius:6,background:c.bg,color:c.t,border:`1px solid ${c.b}`,textTransform:"uppercase",letterSpacing:".03em"}}>{children}</span>;}
function Btn({onClick,children,v="default",sm,disabled}){const s={default:{bg:"#161a24",h:"#1e2230",b:"#1e2430",c:"#d4d8e0"},danger:{bg:"#2a0f0f",h:"#3d1616",b:"#3d1616",c:"#ef4444"},primary:{bg:"#2a1508",h:"#3d1f0f",b:"#4a2812",c:"#e85d24"},success:{bg:"#0d2818",h:"#143d24",b:"#143d24",c:"#22c55e"}}[v];return<button onClick={onClick} disabled={disabled} style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:sm?11:12,fontWeight:500,padding:sm?"4px 10px":"6px 14px",borderRadius:8,border:`1px solid ${s.b}`,background:s.bg,color:s.c,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1}} onMouseEnter={e=>{if(!disabled)e.target.style.background=s.h}} onMouseLeave={e=>{if(!disabled)e.target.style.background=s.bg}}>{children}</button>;}
function Card({children,style}){return<div style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:12,padding:16,...style}}>{children}</div>;}
const Input=({value,onChange,placeholder,style,...p})=><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:8,color:"#d4d8e0",padding:"8px 12px",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box",...style}} {...p}/>;

// Fixed modal — uses a close overlay that ignores pointer events on children
function Overlay({children,onClose,locked}) {
  const overlayRef = useRef(null);
  return <div ref={overlayRef} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}
    onClick={e => { if (!locked && e.target === overlayRef.current) onClose(); }}>
    <Card style={{width:520,maxHeight:"85vh",overflow:"auto"}} onClick={e => e.stopPropagation()}>
      {children}
    </Card>
  </div>;
}

export default function InfraPanel() {
  const [components, setComponents] = useState([]);
  const [credentials, setCredentials] = useState([]);
  const [leases, setLeases] = useState([]);
  const [tab, setTab] = useState("registry");
  const [sel, setSel] = useState(null);
  const [typeFilter, setTypeFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [scanInfo, setScanInfo] = useState(null);
  const [showScan, setShowScan] = useState(false);
  const [scanSubnet, setScanSubnet] = useState('');
  const [toast, setToast] = useState(null);
  const [newComp, setNewComp] = useState({ type:"server",name:"",host:"",port:"",description:"",environment:"production" });

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null), 3000); };

  const refresh = useCallback(async () => {
    try {
      const [comps, creds, ls, si] = await Promise.all([
        apiGet('/api/infra/components'),
        apiGet('/api/vault/credentials').catch(()=>[]),
        apiGet('/api/vault/leases').catch(()=>[]),
        apiGet('/api/infra/scan/info').catch(()=>null),
      ]);
      setComponents(comps || []); setCredentials(creds || []); setLeases(ls || []); setScanInfo(si);
    } catch(e) { console.error('InfraPanel refresh:', e); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const comp = sel ? components.find(c => c.id === sel) : null;
  const filtered = typeFilter === "all" ? components : components.filter(c => c.type === typeFilter);
  const types = [...new Set(components.map(c => c.type))].sort();

  const addComponent = async () => {
    if (!newComp.name) return;
    try {
      await apiPost('/api/infra/components', { ...newComp, port: newComp.port ? parseInt(newComp.port) : null, relevant: true });
      setNewComp({ type:"server",name:"",host:"",port:"",description:"",environment:"production" });
      setShowAdd(false);
      showToast("Component added");
      refresh();
    } catch(e) { showToast(e.message, false); }
  };

  const deleteComponent = async (id) => {
    await apiDelete(`/api/infra/components/${id}`);
    setSel(null);
    showToast("Removed");
    refresh();
  };

  const toggleRelevant = async (id) => {
    const c = components.find(x => x.id === id);
    if (!c) return;
    await apiPatch(`/api/infra/components/${id}`, { relevant: !c.relevant });
    refresh();
  };

  const openScan = () => { setScanSubnet(scanInfo?.subnet || '192.168.1.0/24'); setShowScan(true); };
  const runScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await apiPost('/api/infra/scan', { subnet: scanSubnet });
      setScanResult(result);
      showToast(`Scan: ${result.added} added, ${result.skipped} skipped`);
      refresh();
      setShowScan(false);
    } catch(e) { showToast(`Scan failed: ${e.message}`, false); }
    setScanning(false);
  };

  const stats = {
    total: components.length,
    relevant: components.filter(c => c.relevant).length,
    creds: credentials.length,
    leases: leases.length,
  };

  return <div style={{fontFamily:"'DM Sans',sans-serif"}}>
    <style>{`.mono{font-family:'JetBrains Mono',monospace}@keyframes spin{to{transform:rotate(360deg)}}`}</style>

    {toast&&<div style={{position:"fixed",top:20,right:20,zIndex:200,background:toast.ok?"#0d2818":"#2a0f0f",color:toast.ok?"#22c55e":"#ef4444",border:`1px solid ${toast.ok?"#143d24":"#3d1616"}`,borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:500}}>{toast.msg}</div>}

    {/* Header */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
      <h1 style={{fontSize:18,fontWeight:600,color:"#f0f2f5",margin:0}}>Infrastructure</h1>
      <div style={{display:"flex",gap:6}}>
        <Btn v="success" onClick={openScan} disabled={scanning}>{scanning?"Scanning...":"Scan"}</Btn>
        <Btn v="primary" onClick={()=>setShowAdd(true)}>+ Add</Btn>
      </div>
    </div>

    {/* Stats row */}
    <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
      {[["Components",stats.total,"#3b82f6"],["Active",stats.relevant,"#22c55e"],["Credentials",stats.creds,"#8b5cf6"],["Leases",stats.leases,"#f59e0b"]].map(([l,v,c])=>
        <div key={l} style={{background:"#11131a",border:"1px solid #1a1e2c",borderRadius:10,padding:"12px 16px",flex:1,minWidth:90}}>
          <div style={{fontSize:10,color:"#5a6070",textTransform:"uppercase",letterSpacing:".04em",marginBottom:4}}>{l}</div>
          <div style={{fontSize:20,fontWeight:600,color:c}}>{v}</div>
        </div>
      )}
    </div>

    {/* Tabs */}
    <div style={{display:"flex",gap:6,marginBottom:14}}>
      {[["registry","Components"],["map","Map"],["vault","Credentials"],["leases","Leases"]].map(([id,label])=>
        <button key={id} onClick={()=>setTab(id)} style={{fontSize:11,padding:"5px 14px",borderRadius:6,border:"1px solid "+(tab===id?"#e85d24":"#1e2430"),background:tab===id?"#2a1508":"transparent",color:tab===id?"#e85d24":"#5a6070",cursor:"pointer"}}>{label}</button>
      )}
    </div>

    {/* ─── Registry ─────────────────────────────────────────── */}
    {tab==="registry"&&<div style={{display:"grid",gridTemplateColumns:sel?"1fr 340px":"1fr",gap:14}}>
      <Card style={{padding:0,overflow:"hidden"}}>
        <div style={{display:"flex",gap:6,padding:"10px 12px",borderBottom:"1px solid #1a1e2c",alignItems:"center"}}>
          <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={{background:"#161a24",border:"1px solid #1e2430",borderRadius:6,color:"#d4d8e0",fontSize:11,padding:"4px 8px"}}>
            <option value="all">All ({components.length})</option>
            {types.map(t=><option key={t} value={t}>{t} ({components.filter(c=>c.type===t).length})</option>)}
          </select>
          {scanInfo&&<span style={{fontSize:10,color:"#3a3e50",marginLeft:"auto"}} className="mono">{scanInfo.subnet}</span>}
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
            {["","Type","Name","Host","Status",""].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}
          </tr></thead>
          <tbody>{filtered.map(c=><tr key={c.id} onClick={()=>setSel(c.id)} style={{borderBottom:"1px solid #12141b",cursor:"pointer",background:sel===c.id?"#151820":"transparent",opacity:c.relevant?1:.5}} onMouseEnter={e=>{if(sel!==c.id)e.currentTarget.style.background="#0f1118"}} onMouseLeave={e=>{if(sel!==c.id)e.currentTarget.style.background="transparent"}}>
            <td style={{padding:"6px 10px"}}><Dot status={c.status||"unknown"}/></td>
            <td style={{padding:"6px 10px"}}><span style={{fontSize:13,marginRight:4}}>{ICONS[c.type]||"⚙"}</span><span style={{fontSize:10,color:"#5a6070"}}>{c.type}</span></td>
            <td style={{padding:"6px 10px",fontWeight:500,color:"#f0f2f5"}}>{c.name}</td>
            <td style={{padding:"6px 10px"}} className="mono"><span style={{fontSize:10,color:"#5a6070"}}>{c.host}{c.port?`:${c.port}`:""}</span></td>
            <td style={{padding:"6px 10px"}}><Badge color={c.status==="healthy"?"green":c.status==="degraded"?"yellow":"gray"}>{c.status||"unknown"}</Badge></td>
            <td style={{padding:"6px 10px"}}><button onClick={e=>{e.stopPropagation();toggleRelevant(c.id)}} style={{background:"none",border:"none",cursor:"pointer",fontSize:12,color:c.relevant?"#22c55e":"#3a3e50"}}>{c.relevant?"✓":"○"}</button></td>
          </tr>)}</tbody>
        </table>
        {components.length===0&&<div style={{padding:30,textAlign:"center",color:"#3a3e50",fontSize:12}}>No components. Scan your network or add manually.</div>}
      </Card>

      {comp&&<Card>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>{ICONS[comp.type]}</span>
            <div><div style={{fontSize:14,fontWeight:600,color:"#f0f2f5"}}>{comp.name}</div><div style={{fontSize:11,color:"#5a6070"}}>{comp.type}</div></div>
          </div>
          <button onClick={()=>setSel(null)} style={{background:"none",border:"none",color:"#5a6070",cursor:"pointer",fontSize:16}}>×</button>
        </div>
        {comp.description&&<div style={{fontSize:12,color:"#8b90a0",marginBottom:12}}>{comp.description}</div>}
        {[["Host",(comp.host||"—")+(comp.port?`:${comp.port}`:"")],["Protocol",comp.protocol||"—"],["Environment",comp.environment],["Status",comp.status||"unknown"]].map(([k,v])=>
          <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #12141b",fontSize:12}}>
            <span style={{color:"#5a6070"}}>{k}</span><span style={{color:"#d4d8e0"}} className="mono">{v}</span>
          </div>
        )}
        <div style={{display:"flex",gap:6,marginTop:14}}>
          <Btn sm v="primary" onClick={()=>toggleRelevant(comp.id)}>{comp.relevant?"Disable":"Enable"}</Btn>
          <Btn sm v="danger" onClick={()=>deleteComponent(comp.id)}>Delete</Btn>
        </div>
      </Card>}
    </div>}

    {/* ─── Map ──────────────────────────────────────────────── */}
    {tab==="map"&&<NetworkMap components={components}/>}

    {/* ─── Credentials ──────────────────────────────────────── */}
    {tab==="vault"&&<Card style={{padding:0}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
          {["Name","Type","Username","Component"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}
        </tr></thead>
        <tbody>{credentials.map(cr=><tr key={cr.id} style={{borderBottom:"1px solid #12141b"}}>
          <td style={{padding:"6px 10px",fontWeight:500,color:"#d4d8e0"}}>{cr.name}</td>
          <td style={{padding:"6px 10px"}}><Badge color="purple">{cr.credential_type}</Badge></td>
          <td style={{padding:"6px 10px",color:"#5a6070"}} className="mono">{cr.username||"—"}</td>
          <td style={{padding:"6px 10px",color:"#8b90a0"}}>{cr.component_id||"—"}</td>
        </tr>)}</tbody>
      </table>
      {credentials.length===0&&<div style={{padding:30,textAlign:"center",color:"#3a3e50",fontSize:12}}>No credentials.</div>}
    </Card>}

    {/* ─── Leases ────────────────────────────────────────────── */}
    {tab==="leases"&&<Card style={{padding:0}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead><tr style={{borderBottom:"1px solid #1a1e2c"}}>
          {["Lease","Agent","Expires"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",fontSize:10,color:"#5a6070",fontWeight:500,textTransform:"uppercase"}}>{h}</th>)}
        </tr></thead>
        <tbody>{leases.map(l=><tr key={l.id} style={{borderBottom:"1px solid #12141b"}}>
          <td style={{padding:"6px 10px"}} className="mono">{l.id}</td>
          <td style={{padding:"6px 10px"}}><Badge color="blue">{l.agent_id}</Badge></td>
          <td style={{padding:"6px 10px",color:"#f59e0b"}} className="mono">{new Date(l.expires_at).toLocaleString()}</td>
        </tr>)}</tbody>
      </table>
      {leases.length===0&&<div style={{padding:30,textAlign:"center",color:"#3a3e50",fontSize:12}}>No active leases.</div>}
    </Card>}

    {/* ─── Add component ────────────────────────────────────── */}
    {showAdd&&<Overlay onClose={()=>setShowAdd(false)}>
      <div style={{fontSize:14,fontWeight:600,color:"#f0f2f5",marginBottom:14}}>Add component</div>
      {[["Type",<select value={newComp.type} onChange={e=>setNewComp({...newComp,type:e.target.value})} style={{width:"100%",background:"#090b0f",border:"1px solid #1a1e2c",borderRadius:6,color:"#d4d8e0",padding:"8px 10px",fontSize:12}}>{TYPES.map(t=><option key={t} value={t}>{ICONS[t]||""} {t}</option>)}</select>],
        ["Name",<Input value={newComp.name} onChange={v=>setNewComp({...newComp,name:v})} placeholder="e.g. Production PostgreSQL"/>],
        ["Host",<Input value={newComp.host} onChange={v=>setNewComp({...newComp,host:v})} placeholder="192.168.1.20" className="mono"/>],
        ["Port",<Input type="number" value={newComp.port} onChange={v=>setNewComp({...newComp,port:v})} placeholder="5432" className="mono" style={{width:120}}/>],
        ["Description",<Input value={newComp.description} onChange={v=>setNewComp({...newComp,description:v})} placeholder="What is this?"/>],
      ].map(([label,input])=><div key={label} style={{marginBottom:10}}><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>{label}</div>{input}</div>)}
      <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
        <Btn onClick={()=>setShowAdd(false)}>Cancel</Btn>
        <Btn v="primary" onClick={addComponent} disabled={!newComp.name}>Add</Btn>
      </div>
    </Overlay>}

    {/* ─── Scan network ─────────────────────────────────────── */}
    {showScan&&<Overlay onClose={()=>{if(!scanning)setShowScan(false);}} locked={scanning}>
      <h3 style={{fontSize:14,fontWeight:600,color:"#f0f2f5",margin:"0 0 14px"}}>Scan network</h3>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        <div><div style={{fontSize:11,color:"#5a6070",marginBottom:4}}>Subnet</div><Input value={scanSubnet} onChange={v=>setScanSubnet(v)} placeholder="192.168.1.0/24" className="mono" disabled={scanning}/></div>
        <div style={{fontSize:11,color:"#5a6070"}}>Method: {scanInfo?.nmapAvailable?"nmap":"TCP connect"} · Ports: SSH, HTTP, DBs, queues, monitoring, OpenClaw</div>
        {scanning&&<div style={{display:"flex",alignItems:"center",gap:8,padding:12,background:"#0c1a2e",borderRadius:8,border:"1px solid #132d4a"}}>
          <div style={{width:14,height:14,border:"2px solid #3b82f6",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          <span style={{fontSize:12,color:"#3b82f6"}}>Scanning {scanSubnet}...</span>
        </div>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn onClick={()=>setShowScan(false)} disabled={scanning}>Cancel</Btn>
          <Btn v="success" onClick={runScan} disabled={!scanSubnet||scanning}>{scanning?"Scanning...":"Start"}</Btn>
        </div>
      </div>
    </Overlay>}
  </div>;
}

// ─── Network map ───────────────────────────────────────────────────
function NetworkMap({components}) {
  const groups = {};
  components.filter(c => c.relevant !== false && c.relevant !== 0).forEach(c => {
    const cat = categoryOf(c.type);
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(c);
  });

  const cats = [
    { key:"network", label:"Network", color:"#3b82f6", y:40 },
    { key:"compute", label:"Compute", color:"#22c55e", y:160 },
    { key:"data", label:"Data", color:"#8b5cf6", y:280 },
    { key:"services", label:"Services", color:"#e85d24", y:400 },
    { key:"agents", label:"Agents", color:"#f59e0b", y:520 },
  ];

  if (components.length === 0) {
    return <Card style={{textAlign:"center",color:"#3a3e50",fontSize:12,padding:40}}>No components to map.</Card>;
  }

  const W = 900, nW = 120, nH = 40, pad = 30;

  return <Card style={{padding:12,overflow:"auto"}}>
    <svg width="100%" viewBox={`0 0 ${W} ${cats.length * 120 + 60}`} style={{fontFamily:"'DM Sans',sans-serif"}}>
      {cats.map((cat, ci) => {
        const items = groups[cat.key] || [];
        const y = cat.y;
        return <g key={cat.key}>
          <text x={12} y={y - 8} fill="#5a6070" fontSize={10} fontWeight={500}>{cat.label}</text>
          <line x1={0} y1={y - 2} x2={W} y2={y - 2} stroke="#1a1e2c" strokeWidth={0.5}/>
          {items.map((c, i) => {
            const x = pad + i * (nW + 16);
            const sc = c.status === 'healthy' ? '#22c55e' : c.status === 'degraded' ? '#f59e0b' : '#6b7280';
            return <g key={c.id}>
              <rect x={x} y={y + 4} width={nW} height={nH} rx={6} fill="#11131a" stroke={cat.color} strokeWidth={0.8} opacity={0.9}/>
              <circle cx={x + 10} cy={y + 24} r={4} fill={sc}/>
              <text x={x + 20} y={y + 20} fill="#d4d8e0" fontSize={10} fontWeight={500}>{c.name.length > 13 ? c.name.slice(0, 12) + '…' : c.name}</text>
              <text x={x + 20} y={y + 34} fill="#5a6070" fontSize={8}>{c.host ? (c.host.length > 15 ? c.host.slice(0, 14) + '…' : c.host) : c.type}</text>
            </g>;
          })}
          {items.length === 0 && <text x={pad} y={y + 26} fill="#2a2c34" fontSize={11} fontStyle="italic">None</text>}
          {ci < cats.length - 1 && items.length > 0 && (groups[cats[ci+1]?.key]||[]).length > 0 && items.slice(0, 3).map((c, i) => {
            const x1 = pad + i * (nW + 16) + nW / 2;
            const y1 = y + 4 + nH;
            const next = groups[cats[ci+1].key] || [];
            return next.slice(0, 2).map((nc, ni) => {
              const x2 = pad + ni * (nW + 16) + nW / 2;
              const y2 = cats[ci+1].y + 4;
              return <line key={`${c.id}-${nc.id}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1a1e2c" strokeWidth={0.5} strokeDasharray="4 4"/>;
            });
          })}
        </g>;
      })}
    </svg>
  </Card>;
}

function categoryOf(type) {
  if (['network','subnet','firewall','waf','load_balancer','dns','certificate','vpn','vlan'].includes(type)) return 'network';
  if (['server','vm','container','cluster','reverse_proxy'].includes(type)) return 'compute';
  if (['database','cache','message_queue','object_storage'].includes(type)) return 'data';
  if (['api_service','web_service','microservice','saas_integration','third_party_api','cicd_pipeline','repository','monitoring','log_aggregator','webhook_endpoint'].includes(type)) return 'services';
  if (['gateway','openclaw_gateway','api_gateway'].includes(type)) return 'agents';
  return 'services';
}
