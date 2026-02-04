function getToken(){ return localStorage.getItem("evt_token"); }
function setToken(t){ localStorage.setItem("evt_token", t); }
function clearToken(){ localStorage.removeItem("evt_token"); }

function requireHttp() {
  if (location.protocol === "file:") {
    document.body.innerHTML = `
      <div class="container"><div class="card">
        <p class="h1">You opened this page as a file</p>
        <p class="sub">Start the server and open <span class="code">http://localhost:3000</span></p>
      </div></div>`;
    throw new Error("Opened via file://");
  }
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = Object.assign({}, options.headers || {});
  if (token) headers["Authorization"] = "Bearer " + token;
  return fetch(path, Object.assign({}, options, { headers }));
}

async function requireRole(roles) {
  requireHttp();
  let r, data;
  try {
    r = await api("/api/me");
    data = await r.json();
  } catch {
    alert("Cannot reach the server. Make sure it is running on http://localhost:3000");
    return null;
  }
  if (!data.user) return null;
  if (roles && !roles.includes(data.user.role)) return null;
  return data.user;
}

function esc(s){
  return (s ?? "").toString()
    .replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}


function fmtDate(iso){
  if(!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day:"numeric", month:"long", year:"numeric" }).format(d);
}
function fmtRange(startIso, endIso){
  if(!startIso && !endIso) return "";
  if(startIso === endIso) return fmtDate(startIso);
  return `${fmtDate(startIso)} → ${fmtDate(endIso)}`;
}
