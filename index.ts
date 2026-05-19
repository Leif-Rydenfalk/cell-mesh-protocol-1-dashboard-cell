#!/usr/bin/env bun
/**
 * 🌍 GLOBAL COMMAND CENTER DASHBOARD
 * Uses globe-viz cell for 3D/2D visualization.
 */

import { TypedRheoCell, router, procedure, z } from "cell-mesh-protocol-1";
import { networkInterfaces } from "node:os";

const PORT = 5180;
const GLOBE_VIZ_URL = "http://localhost:5175";

const cell = new TypedRheoCell(`Dashboard_${process.pid}`, 0);

// ============================================================================
// LOG CACHE (MISSING VARIABLE FIXED)
// ============================================================================
let recentLogs: { timestamp: number; level: string; msg: string; from: string }[] = [];
const MAX_LOGS = 200;

async function refreshLogs() {
    try {
        const result = await cell.askMesh("log/get", { limit: 50 }, {}, { maxWaitMs: 0 });
        if (result.ok && (result.value as any)?.logs) {
            const parsed = (result.value as any).logs.map((line: string) => {
                const match = line.match(/\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.*)/);
                if (match) {
                    return { timestamp: Date.parse(match[1]), level: "INFO", from: match[2], msg: match[3] };
                }
                return { timestamp: Date.now(), level: "INFO", from: "unknown", msg: line };
            });
            recentLogs = parsed.slice(-MAX_LOGS);
        }
    } catch (e) { /* ignore */ }
}

cell.registerInterval(setInterval(refreshLogs, 5000));
refreshLogs();

// ============================================================================
// DASHBOARD ROUTER
// ============================================================================
const dashboardRouter = router({
    dashboard: router({
        stats: procedure
            .input(z.void())
            .output(z.object({
                activeCells: z.number(),
                totalCapabilities: z.number(),
                lastLogsCount: z.number(),
            }))
            .query(async () => {
                const registry = await cell.mesh.registry.list({});
                const allCaps = new Set();
                (registry as any[]).forEach((c: any) => {
                    (c.caps || []).forEach((cap: string) => allCaps.add(cap));
                });
                return {
                    activeCells: (registry as any[]).length,
                    totalCapabilities: allCaps.size,
                    lastLogsCount: recentLogs.length,
                };
            }),
    }),
});

cell.useRouter(dashboardRouter);
cell.listen();

// ============================================================================
// HTTP SERVER
// ============================================================================
const UI_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OPENJAWS COMMAND CENTER</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { background:#050505; color:#00ffaa; font-family:monospace; overflow:hidden; height:100vh; }
    .split { display:flex; height:100vh; }
    .globe-pane { flex:3; background:#000; border-right:1px solid #00ffaa30; }
    .controls-pane { flex:1.2; background:rgba(0,0,0,0.85); backdrop-filter:blur(12px); padding:16px; overflow-y:auto; display:flex; flex-direction:column; gap:16px; }
    iframe { width:100%; height:100%; border:none; }
    .card { background:#0a0a0a; border:1px solid #1f3a2a; border-radius:8px; padding:12px; }
    .stat { font-size:24px; font-weight:bold; color:#00ffaa; }
    button { background:#0a2a1a; border:1px solid #00ffaa; color:#00ffaa; padding:6px 12px; border-radius:4px; cursor:pointer; font-size:12px; }
    button:hover { background:#00ffaa; color:black; }
    input { background:#111; border:1px solid #2a4a3a; color:#00ffaa; padding:6px; border-radius:4px; }
    .flex-between { display:flex; justify-content:space-between; align-items:center; }
    .badge { background:#00ffaa20; padding:2px 6px; border-radius:12px; font-size:10px; }
    .log-line { font-size:10px; border-bottom:1px solid #1a1a1a; padding:4px 0; white-space:nowrap; overflow-x:hidden; text-overflow:ellipsis; }
    .log-time { color:#888; margin-right:8px; }
  </style>
</head>
<body>
<div class="split">
  <div class="globe-pane">
    <iframe src="${GLOBE_VIZ_URL}" allow="geolocation"></iframe>
  </div>
  <div class="controls-pane">
    <div class="flex-between">
      <h1 class="text-lg font-bold">🌐 COMMAND</h1>
      <span class="badge" id="mesh-status">CONNECTING</span>
    </div>
    <div class="card">
      <div class="text-[10px] opacity-50">MESH HEALTH</div>
      <div class="stat" id="cell-count">0</div>
      <div class="text-[9px]">active cells</div>
      <div class="mt-2 text-[9px]"><span id="total-caps">0</span> capabilities</div>
    </div>
    <div class="card">
      <div class="font-bold mb-2">🎮 GLOBE CONTROLS</div>
      <div class="flex gap-2 flex-wrap">
        <button id="reset-view">Reset view</button>
        <button id="add-all-nodes">Add all cells as markers</button>
        <button id="clear-markers">Clear markers</button>
      </div>
      <div class="mt-2">
        <div class="text-[9px] mb-1">Fly to location</div>
        <div class="flex gap-2">
          <input type="text" id="fly-lat" placeholder="Lat" size="6">
          <input type="text" id="fly-lon" placeholder="Lon" size="6">
          <button id="fly-btn">Fly</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="flex-between">
        <span class="font-bold">📡 LATENCY MATRIX</span>
        <button id="refresh-latency" class="text-[8px]">⟳</button>
      </div>
      <div id="latency-list" class="text-[9px] mt-1 max-h-48 overflow-y-auto"></div>
    </div>
    <div class="card flex-1 overflow-hidden">
      <div class="flex-between mb-2">
        <span class="font-bold">📜 EVENT LOG</span>
        <button id="refresh-logs" class="text-[8px]">⟳</button>
      </div>
      <div id="log-container" class="overflow-y-auto h-48 text-[9px]"></div>
    </div>
    <div class="card">
      <div class="font-bold mb-2">➕ DEPLOY NEW CELL</div>
      <div class="flex gap-2">
        <input type="text" id="deploy-id" placeholder="Cell ID" class="flex-1">
        <input type="text" id="deploy-repo" placeholder="Git repo" class="flex-1">
        <button id="deploy-btn">Deploy</button>
      </div>
      <div class="text-[8px] opacity-50 mt-1">via Hetzner (requires API key)</div>
    </div>
  </div>
</div>
<script>
  async function meshCall(cap, args) {
    const res = await fetch('/_mesh/call', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({capability:cap, args:args})
    });
    return res.json();
  }
  async function fetchCells() {
    const res = await fetch('/api/registry/list');
    return res.json();
  }
  async function updateStats() {
    const cells = await fetchCells();
    document.getElementById('cell-count').innerText = cells.length;
    let capsSet = new Set();
    cells.forEach(c => (c.caps||[]).forEach(cap => capsSet.add(cap)));
    document.getElementById('total-caps').innerText = capsSet.size;
    document.getElementById('mesh-status').innerText = cells.length>1?'NOMINAL':'PARTIAL';
    return cells;
  }
  async function addAllNodesAsMarkers() {
    const cells = await fetchCells();
    for (const c of cells) {
      let lat=0, lon=0;
      if(c.addr){
        let parts = c.addr.split('.');
        if(parts.length>=2){
          lat = (parseInt(parts[parts.length-2]||'0')%90)-45;
          lon = (parseInt(parts[parts.length-1]||'0')%180)-90;
        }
      }else{
        lat = (c.id.charCodeAt(0)%90)-45;
        lon = (c.id.charCodeAt(1)%180)-90;
      }
      await meshCall('globe/add-marker', {
        id:c.id, lat:lat, lon:lon, label:c.id,
        html:"<b>"+c.id+"</b><br>Addr:"+(c.addr||'unknown')+"<br>Caps:"+(c.caps||[]).length,
        color:'#44ffaa'
      });
    }
    alert("Added "+cells.length+" markers");
  }
  async function clearMarkers() { await meshCall('globe/clear-markers',{}); }
  async function flyTo(lat,lon,alt){ await meshCall('globe/fly-to',{lat:lat,lon:lon,altitude:alt||5000,duration:2}); }
  async function refreshLatency(){
    try{
      const data = await meshCall('telemetry/latencyMatrix',{});
      const matrix = data.matrix||{};
      const container = document.getElementById('latency-list');
      container.innerHTML = '';
      for(let from in matrix){
        let entries = Object.entries(matrix[from]).filter(([_,ms])=>ms>0&&ms<500);
        if(!entries.length) continue;
        let div = document.createElement('div');
        div.className = 'text-[9px] mt-1';
        div.innerHTML = '<span class="opacity-50">'+from+'</span> → '+entries.map(e=>e[0]+':'+e[1]+'ms').join(', ');
        container.appendChild(div);
      }
    }catch(e){ console.error(e); }
  }
  async function refreshLogsUI() {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    const container = document.getElementById('log-container');
    container.innerHTML = logs.map(log=>{
      let levelClass = log.level==='ERROR'?'log-error':(log.level==='WARN'?'log-warn':'log-info');
      return '<div class="log-line"><span class="log-time">'+new Date(log.timestamp).toLocaleTimeString()+'</span> <span class="'+levelClass+'">['+log.from+']</span> '+escapeHtml(log.msg)+'</div>';
    }).join('');
  }
  function escapeHtml(s){ return s.replace(/[&<>]/g,function(m){if(m==='&')return'&amp;';if(m==='<')return'&lt;';if(m==='>')return'&gt;';return m;}); }
  async function deployCell(id,repo){
    const res = await fetch('/api/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cellId:id,cellRepo:repo,serverType:'cx22'})});
    const data = await res.json();
    alert('Deployed '+id+': '+(data.ip||'pending')+' - '+data.status);
  }

  setInterval(updateStats,10000);
  setInterval(refreshLatency,15000);
  setInterval(refreshLogsUI,3000);
  document.getElementById('reset-view').onclick = ()=>meshCall('globe/fly-to',{lat:0,lon:0,altitude:15000000});
  document.getElementById('add-all-nodes').onclick = addAllNodesAsMarkers;
  document.getElementById('clear-markers').onclick = clearMarkers;
  document.getElementById('fly-btn').onclick = ()=>{
    let lat = parseFloat(document.getElementById('fly-lat').value);
    let lon = parseFloat(document.getElementById('fly-lon').value);
    if(!isNaN(lat)&&!isNaN(lon)) flyTo(lat,lon);
  };
  document.getElementById('refresh-latency').onclick = refreshLatency;
  document.getElementById('refresh-logs').onclick = refreshLogsUI;
  document.getElementById('deploy-btn').onclick = ()=>{
    let id = document.getElementById('deploy-id').value;
    let repo = document.getElementById('deploy-repo').value;
    if(id&&repo) deployCell(id,repo);
    else alert('Enter cell ID and repo URL');
  };
  updateStats(); refreshLatency(); refreshLogsUI();
</script>
</body>
</html>`;

const uiServer = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/") return new Response(UI_HTML, { headers: { "Content-Type": "text/html" } });
        if (url.pathname === "/_mesh/call" && req.method === "POST") {
            const { capability, args } = await req.json();
            const result = await cell.askMesh(capability, args || {});
            return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
        }
        if (url.pathname === "/api/registry/list") {
            const cells = await cell.mesh.registry.list({});
            return Response.json(cells);
        }
        if (url.pathname === "/api/logs") return Response.json(recentLogs);
        if (url.pathname === "/api/deploy" && req.method === "POST") {
            const body = await req.json();
            const result = await cell.mesh.deploy.hetzner(body);
            return Response.json(result);
        }
        if (url.pathname === "/api/telemetry/latency") {
            const data = await cell.mesh.telemetry.latencyMatrix();
            return Response.json(data);
        }
        return new Response("Not Found", { status: 404 });
    }
});

cell.onShutdown(() => uiServer.stop());
cell.log("INFO", "Dashboard online at http://localhost:" + PORT);