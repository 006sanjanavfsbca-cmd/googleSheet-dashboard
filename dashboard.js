/* ============================================================
   1. CONFIG — the only part you normally edit
   ============================================================ */
const CONFIG = {
  // Paste the long id from your sheet URL between /d/ and /edit
  // https://docs.google.com/spreadsheets/d/THIS_PART_HERE/edit
  sheetId: "",
  // Tab names exactly as they appear at the bottom of the sheet
  trainees: ["Alvin","Goutham","Sarath","Ilfa","Sanjana","Sneha","Lena"],
  marksTab: "BCA MARKS",
  // Words in the Status column that count as finished
  doneWords: ["done","completed","complete","finished","yes","closed"],
  progressWords: ["progress","ongoing","working","started","wip"]
};

const LS = { id:"vonnue.sheetId", cache:"vonnue.cache" };
const $ = s => document.querySelector(s);

/* ============================================================
   2. Google Sheets loading
   ============================================================ */
function sheetId(){ return localStorage.getItem(LS.id) || CONFIG.sheetId; }

function csvUrl(tab){
  return "https://docs.google.com/spreadsheets/d/" + sheetId() +
         "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(tab);
}

async function fetchTab(tab){
  const res = await fetch(csvUrl(tab), { cache:"no-store" });
  if(!res.ok) throw new Error("Tab \u201c"+tab+"\u201d returned "+res.status);
  const text = await res.text();
  if(text.trim().startsWith("<")) throw new Error("Sheet is not readable. Set sharing to \u201cAnyone with the link\u201d.");
  return parseCSV(text);
}

function parseCSV(text){
  const rows=[]; let row=[], cur="", q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; }
      else cur+=c;
    }else{
      if(c==='"') q=true;
      else if(c===','){ row.push(cur); cur=""; }
      else if(c==='\n'){ row.push(cur); rows.push(row); row=[]; cur=""; }
      else if(c!=='\r') cur+=c;
    }
  }
  row.push(cur); rows.push(row);
  return rows.filter(r => r.some(v => v.trim() !== ""));
}

/* ============================================================
   3. Parsing helpers
   ============================================================ */
const norm = s => (s||"").toString().trim().toLowerCase().replace(/[^a-z]/g,"");

// Turns the raw rows from a trainee tab into easy-to-use objects.
// This is also where we read the new columns that were added to the
// sheet: Focus Time, Code Time, Screen Time, Language, Line of code, Total.
function toObjects(rows){
  if(!rows.length) return [];
  let h = 0;
  for(let i=0;i<Math.min(rows.length,8);i++){
    const line = rows[i].map(norm);
    if(line.includes("date") && line.includes("task")){ h=i; break; }
  }
  const head = rows[h].map(norm);
  const idx = n => head.indexOf(n);
  const col = {
    date:idx("date"), task:idx("task"), start:idx("starttime"),
    end:idx("endtime"), dur:idx("duration"), status:idx("status"),
    issue:idx("issuesanddoubts"),
    // --- new columns ---
    focus:idx("focustime"), code:idx("codetime"), screen:idx("screentime"),
    lang:idx("language"), loc:idx("lineofcode"), total:idx("total")
  };
  if(col.issue<0) col.issue = head.findIndex(x=>x.startsWith("issue"));
  const get=(r,i)=> i>=0 && r[i]!=null ? r[i].trim() : "";
  const objs = rows.slice(h+1).map(r=>({
    dateRaw:get(r,col.date), task:get(r,col.task), start:get(r,col.start),
    end:get(r,col.end), dur:get(r,col.dur), status:get(r,col.status),
    issue:get(r,col.issue),
    // --- new columns ---
    focus:get(r,col.focus), code:get(r,col.code), screen:get(r,col.screen),
    lang:get(r,col.lang), loc:get(r,col.loc), total:get(r,col.total)
  })).filter(r=> r.dateRaw || r.task);
  // Sheets are usually filled with the Date cell only on the first task of
  // the day, leaving it blank for later tasks that same day. Carry the last
  // seen date down onto those blank rows so they aren't dropped as undated.
  let lastDate = "";
  objs.forEach(o=>{
    if(o.dateRaw) lastDate = o.dateRaw;
    else o.dateRaw = lastDate;
  });
  return objs;
}

function parseDate(s){
  if(!s) return null;
  s = s.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if(m){
    let a=+m[1], b=+m[2], y=+m[3]; if(y<100) y+=2000;
    // sheet shows MM/DD/YYYY; fall back to DD/MM when the first part can't be a month
    return a>12 ? new Date(y,b-1,a) : new Date(y,a-1,b);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function parseTime(s){
  if(!s) return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m) return null;
  let h=+m[1]; const min=+m[2]; const ap=(m[4]||"").toLowerCase();
  if(ap==="pm" && h<12) h+=12;
  if(ap==="am" && h===12) h=0;
  return h*60+min;
}

function parseDuration(s){
  if(!s) return 0;
  s = s.trim().toLowerCase();
  let m = s.match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?$/);
  if(m) return +m[1]*60 + +m[2];
  m = s.match(/(\d+(?:\.\d+)?)\s*h/);
  const mm = s.match(/(\d+(?:\.\d+)?)\s*m(?!s)/);
  if(m || mm) return Math.round((m?parseFloat(m[1])*60:0) + (mm?parseFloat(mm[1]):0));
  if(/^\d+(\.\d+)?$/.test(s)){
    const n = parseFloat(s);
    return n <= 24 ? Math.round(n*60) : Math.round(n); // <=24 read as hours, else minutes
  }
  return 0;
}

function minutesOf(r){
  const d = parseDuration(r.dur);
  if(d > 0) return d;
  const a = parseTime(r.start), b = parseTime(r.end);
  if(a==null || b==null) return 0;
  return b >= a ? b-a : b+1440-a;
}

// Minutes helpers for the new time-based columns. They reuse the same
// parseDuration() logic, since those columns can hold "1:30", "1.5h" etc.
const codeMinutesOf   = r => parseDuration(r.code);
const screenMinutesOf = r => parseDuration(r.screen);
const focusMinutesOf  = r => parseDuration(r.focus);

// "Line of code" is a plain number, e.g. "120".
const locOf = r => {
  const n = parseInt((r.loc||"").replace(/[^\d]/g,""), 10);
  return isNaN(n) ? 0 : n;
};

function statusOf(r){
  const s = norm(r.status);
  if(!s) return r.end ? "done" : "open";
  if(CONFIG.doneWords.some(w=>s.includes(w))) return "done";
  if(CONFIG.progressWords.some(w=>s.includes(w))) return "progress";
  return "open";
}

// Key used to match up rows that are really the same task logged on
// different days (e.g. "in progress" one day, "done" a later day).
const taskKey = s => (s||"").toString().trim().toLowerCase().replace(/\s+/g," ");

// For a set of rows, work out each task's CURRENT status: the status on
// its most recently dated row. A task marked "in progress" yesterday and
// "done" today counts as done everywhere it's used for totals/rates —
// while the raw per-day rows (task log table) still show what was
// actually recorded that day, unchanged.
function currentStatusMap(rs){
  const map = {}, seenDate = {};
  rs.forEach(r=>{
    const key = taskKey(r.task);
    if(!key) return;
    const d = r.date ? r.date.getTime() : -Infinity;
    if(!(key in seenDate) || d >= seenDate[key]){
      seenDate[key] = d;
      map[key] = statusOf(r);
    }
  });
  return map;
}
function effectiveStatus(r, map){
  const key = taskKey(r.task);
  return (key && map[key]) ? map[key] : statusOf(r);
}

const hm = mins => Math.floor(mins/60)+"h "+String(Math.round(mins%60)).padStart(2,"0")+"m";
const monthKey = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
const monthLabel = k => {
  const [y,m]=k.split("-");
  return ["January","February","March","April","May","June","July","August",
          "September","October","November","December"][+m-1]+" "+y;
};

/* ============================================================
   4. State
   ============================================================ */
let DATA = { rows:{}, marks:[], syncedAt:null };
let view = "one";

function rowsFor(name, mk){
  const rs = (DATA.rows[name]||[]).map(r=>({...r, date:parseDate(r.dateRaw)}));
  return mk ? rs.filter(r=> r.date && monthKey(r.date)===mk) : rs;
}

// The BCA MARKS tab has a "Semester" column (values like 1, 2) merged down
// across each block of subjects, same as Date is merged in the task sheet.
// Carry that (and Subject, merged per-trainee-block) down over blank rows,
// then group into one table per semester instead of one long flat table.
function renderMarksBySemester(marks){
  if(!marks || !marks.length) return '<p class="empty">The BCA MARKS tab is empty or has not been synced yet.</p>';
  const head = marks[0];
  const semIdx  = head.findIndex(h=>norm(h).includes("semester"));
  const subjIdx = head.findIndex(h=>norm(h).includes("subject"));
  if(semIdx<0){
    // No Semester column found — fall back to the old flat table so
    // nothing breaks if the sheet's header text changes.
    return `<table><thead><tr>`+head.map(c=>`<th>${esc(c)}</th>`).join("")+`</tr></thead><tbody>`+
      marks.slice(1).map(r=>`<tr>`+r.map(c=>`<td>${esc(c)}</td>`).join("")+`</tr>`).join("")+
      `</tbody></table>`;
  }

  const groups = {}; // semester label -> rows (each row still has all columns)
  let lastSem = "", lastSubj = "";
  for(let i=1;i<marks.length;i++){
    const row = marks[i].slice();
    if(!row.some(c=>(c||"").toString().trim()!=="")) continue; // fully blank row
    const semVal = (row[semIdx]||"").toString().trim();
    if(semVal) lastSem = semVal; else row[semIdx] = lastSem;
    if(subjIdx>=0){
      const subjVal = (row[subjIdx]||"").toString().trim();
      if(subjVal) lastSubj = subjVal; else row[subjIdx] = lastSubj;
    }
    const key = lastSem || "Unspecified";
    (groups[key] = groups[key] || []).push(row);
  }

  const cols = head.map((c,i)=>i).filter(i=>i!==semIdx); // hide the Semester column — the heading already says it
  const semesters = Object.keys(groups).sort((a,b)=>{
    const na=parseFloat(a), nb=parseFloat(b);
    return (!isNaN(na)&&!isNaN(nb)) ? na-nb : a.localeCompare(b);
  });

  return semesters.map(sem=>{
    const rows = groups[sem];
    return `<h4 class="sem-heading">Semester ${esc(sem)}</h4>
      <table><thead><tr>`+cols.map(i=>`<th>${esc(head[i])}</th>`).join("")+`</tr></thead><tbody>`+
      rows.map(r=>`<tr>`+cols.map(i=>`<td>${esc(r[i]||"")}</td>`).join("")+`</tr>`).join("")+
      `</tbody></table>`;
  }).join("");
}

function stats(name, mk){
  const rs = rowsFor(name, mk).filter(r=>r.task || r.dur || r.start);
  const statusMap = currentStatusMap(rs);

  // Completion counts, rate, and the donut should reflect distinct TASKS,
  // not log rows — a task worked on across 3 rows is 1 task, not 3.
  // Rows with no task name have nothing to group by, so each counts as
  // its own task.
  const taskGroups = {};
  let anon = 0;
  rs.forEach(r=>{
    const key = taskKey(r.task) || ("__row"+(anon++));
    (taskGroups[key] = taskGroups[key] || []).push(r);
  });
  const tasks = Object.keys(taskGroups).length;
  let done=0, prog=0, open=0;
  Object.keys(taskGroups).forEach(key=>{
    const s = statusMap[key] || statusOf(taskGroups[key][taskGroups[key].length-1]);
    if(s==="done") done++; else if(s==="progress") prog++; else open++;
  });

  let mins=0, issues=0;
  let codeMins=0, screenMins=0, totalLOC=0, langTasks=0;
  const langCount = {};
  const days = new Set();
  rs.forEach(r=>{
    const m = minutesOf(r);
    // Focus Time is its own column in the sheet (like Code/Screen Time) —
    // usually filled once per day rather than per task row — so the total
    // must come from that column, not be re-derived from Duration/Start-End.
    mins += focusMinutesOf(r);
    if(m>0 && r.date) days.add(r.date.toDateString());
    if(r.issue) issues++;

    // --- new columns ---
    codeMins += codeMinutesOf(r);
    screenMins += screenMinutesOf(r);
    totalLOC += locOf(r);
    if(r.lang){ langCount[r.lang] = (langCount[r.lang]||0) + 1; langTasks++; }
  });

  // Pick whichever language shows up the most for this trainee.
  let mainLang = "—";
  let best = 0;
  Object.keys(langCount).forEach(l=>{
    if(langCount[l] > best){ best = langCount[l]; mainLang = l; }
  });

  return { name, rows:rs, minutes:mins, tasks, done, prog, open, issues,
           activeDays:days.size,
           rate: tasks ? Math.round(done/tasks*100) : 0,
           perDay: days.size ? mins/days.size : 0,
           codeMins, screenMins, totalLOC, mainLang, langTasks, statusMap };
}

function allMonths(){
  const set = new Set();
  CONFIG.trainees.forEach(n => (DATA.rows[n]||[]).forEach(r=>{
    const d = parseDate(r.dateRaw); if(d) set.add(monthKey(d));
  }));
  return [...set].sort().reverse();
}

/* ============================================================
   5. Charts (hand-drawn SVG, no libraries)
   ============================================================ */
function barsByDay(rs, mk){
  if(!mk || !rs.length) return '<p class="empty">No entries for this month yet.</p>';
  const [y,m] = mk.split("-").map(Number);
  const n = new Date(y, m, 0).getDate();
  const vals = Array(n).fill(0);
  rs.forEach(r=>{ if(r.date) vals[r.date.getDate()-1] += focusMinutesOf(r); });
  const max = Math.max(60, ...vals);
  const W=560, H=190, pad=26, bw=(W-pad*2)/n;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Focus minutes per day">`;
  [0,.5,1].forEach(f=>{
    const yy = H-30-(H-60)*f;
    s += `<line x1="${pad}" x2="${W-pad}" y1="${yy}" y2="${yy}" stroke="#eae4f2"/>`;
    s += `<text x="0" y="${yy+4}" font-size="9" fill="#9a8fab">${(max*f/60).toFixed(1)}h</text>`;
  });
  vals.forEach((v,i)=>{
    const h = (H-60)*(v/max);
    const x = pad+i*bw;
    s += `<rect x="${x+1}" y="${H-30-h}" width="${Math.max(bw-2,1.5)}" height="${h}" rx="2" fill="${v?'#7d5cc6':'#ece7f4'}"><title>${i+1}: ${hm(v)}</title></rect>`;
    if(n<=31 && (i===0 || (i+1)%5===0))
      s += `<text x="${x+bw/2}" y="${H-16}" font-size="9" fill="#9a8fab" text-anchor="middle">${i+1}</text>`;
  });
  return s+"</svg>";
}

function donut(st){
  const parts = [["Completed",st.done,"#5b3f9e"],["In progress",st.prog,"#c98a2e"],["Open",st.open,"#c2545f"]];
  const total = st.tasks;
  if(!total) return '<p class="empty">No tasks logged for this month.</p>';
  const R=58, C=2*Math.PI*R; let off=0;
  let s = `<svg viewBox="0 0 220 150"><g transform="translate(110,75)">`;
  parts.forEach(([,v,c])=>{
    if(!v) return;
    const len = C*v/total;
    s += `<circle r="${R}" fill="none" stroke="${c}" stroke-width="20"
           stroke-dasharray="${len} ${C-len}" stroke-dashoffset="${-off}"
           transform="rotate(-90)"/>`;
    off += len;
  });
  s += `<text text-anchor="middle" y="-2" font-size="26" font-weight="700" font-family="Outfit" fill="#241a33">${st.rate}%</text>
        <text text-anchor="middle" y="16" font-size="11" fill="#736a84">completed</text></g></svg>`;
  s += '<div class="legend">'+parts.map(([n,v,c])=>`<span><i style="background:${c}"></i>${n} · ${v}</span>`).join("")+"</div>";
  return s;
}

function hbars(list, valueFn, labelFn, selected, color){
  if(!list.length) return '<p class="empty">Nothing to compare yet.</p>';
  const max = Math.max(1, ...list.map(valueFn));
  const rowH=30, W=560, labelW=74, H=list.length*rowH+8;
  let s = `<svg viewBox="0 0 ${W} ${H}">`;
  list.forEach((d,i)=>{
    const v=valueFn(d), y=i*rowH+6, w=(W-labelW-70)*(v/max);
    const fill = d.name===selected ? color : "#ddd5ea";
    s += `<text x="0" y="${y+15}" font-size="12" fill="#4a3f5c" font-weight="${d.name===selected?600:400}">${d.name}</text>`;
    s += `<rect x="${labelW}" y="${y+3}" width="${Math.max(w,2)}" height="16" rx="4" fill="${fill}"/>`;
    s += `<text x="${labelW+Math.max(w,2)+8}" y="${y+16}" font-size="11.5" fill="#736a84">${labelFn(d)}</text>`;
  });
  return s+"</svg>";
}

/* ============================================================
   6. Rendering
   ============================================================ */
function kpi(name, rows){
  return `<div class="card kpi"><div class="name">${name}</div>`+
    rows.map(r=>`<div class="row ${r[2]?'sub':''}"><span>${r[0]}</span><b>${r[1]}</b></div>`).join("")+
  `</div>`;
}

function render(){
  const mk = $("#monthSel").value || null;
  const who = $("#traineeSel").value;
  const all = CONFIG.trainees.map(n=>stats(n, mk));
  const me = all.find(s=>s.name===who) || stats(who, mk);
  const teamMins = all.reduce((a,s)=>a+s.minutes,0);
  const teamRate = Math.round(all.reduce((a,s)=>a+s.rate,0)/all.length);
  const teamTasks = all.reduce((a,s)=>a+s.tasks,0);
  const teamCodeMins = all.reduce((a,s)=>a+s.codeMins,0);
  const teamScreenMins = all.reduce((a,s)=>a+s.screenMins,0);
  const teamLOC = all.reduce((a,s)=>a+s.totalLOC,0);

  /* --- individual --- */
  // Most recent logged day's numbers (not team data) for the first row of
  // each KPI card; the second row is this trainee's own month total.
  const datedRows = me.rows.filter(r=>r.date);
  // "Today" is the real calendar date — a day already in the past (like
  // yesterday) should show its full numbers, not get skipped. We only
  // treat a day as "still in progress" (and skip to the day before it)
  // when it's actually today's real date, since that day's log may not
  // be finished yet.
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  let pastRows = datedRows.filter(r=>r.date.getTime() < todayStart.getTime());
  if(!pastRows.length && datedRows.length){
    // Nothing strictly before today (e.g. everything so far is dated
    // today, or the device clock is off) — fall back to the day before
    // whatever the newest logged entry is, so the card isn't left empty.
    const newestLogged = Math.max(...datedRows.map(r=>r.date));
    pastRows = datedRows.filter(r=>r.date.getTime() < newestLogged);
  }
  const lastDate = pastRows.length ? new Date(Math.max(...pastRows.map(r=>r.date))) : null;
  const dayRows = lastDate ? pastRows.filter(r=>r.date.toDateString()===lastDate.toDateString()) : [];
  const dayShort = lastDate ? lastDate.toLocaleDateString(undefined, {month:"short", day:"numeric"}) : "no entry";
  const totalLabel = me.name+" total";

  const lastDayMins   = dayRows.reduce((a,r)=>a+focusMinutesOf(r),0);
  // Distinct tasks touched on this day, using each one's current
  // (latest-known) status — same rule as the totals and the donut.
  const dayTaskKeys = new Set(dayRows.map(r=>taskKey(r.task)).filter(Boolean));
  const lastDayTasks = dayTaskKeys.size || dayRows.length;
  let lastDayDoneCount = 0;
  if(dayTaskKeys.size){
    dayTaskKeys.forEach(k=>{ if((me.statusMap[k]||"")==="done") lastDayDoneCount++; });
  } else {
    lastDayDoneCount = dayRows.filter(r=>statusOf(r)==="done").length;
  }
  const lastDayDone = lastDayDoneCount;
  const lastDayRate = lastDayTasks ? Math.round(lastDayDone/lastDayTasks*100) : 0;
  const lastDayCode   = dayRows.reduce((a,r)=>a+codeMinutesOf(r),0);
  const lastDayScreen = dayRows.reduce((a,r)=>a+screenMinutesOf(r),0);
  const lastDayLOC    = dayRows.reduce((a,r)=>a+locOf(r),0);

  $("#oneKpis").innerHTML =
    kpi("TOTAL FOCUS TIME", [["Focus · "+dayShort, hm(lastDayMins)], [totalLabel, hm(me.minutes), 1]]) +
    kpi("TASKS LOGGED",     [["Tasks · "+dayShort, lastDayTasks], [totalLabel, me.tasks, 1]]) +
    kpi("COMPLETION RATE",  [["Rate · "+dayShort, lastDayRate+"%"], [totalLabel, me.rate+"%", 1]]) +
    kpi("AVG PER ACTIVE DAY",[[me.name, hm(me.perDay)], ["Active days", me.activeDays, 1]]);

  // New KPI row for the columns added to the sheet — same latest-day-vs-own-total pattern.
  $("#codeKpis").innerHTML =
    kpi("TOTAL CODE TIME",  [["Code · "+dayShort, hm(lastDayCode)], [totalLabel, hm(me.codeMins), 1]]) +
    kpi("TOTAL SCREEN TIME",[["Screen · "+dayShort, hm(lastDayScreen)], [totalLabel, hm(me.screenMins), 1]]) +
    kpi("LINES OF CODE",    [["Lines · "+dayShort, lastDayLOC], [totalLabel, me.totalLOC, 1]]) +
    kpi("MAIN LANGUAGE",    [[me.name, me.mainLang], ["Tasks with a language", me.langTasks, 1]]);

  $("#dailyChart").innerHTML = barsByDay(me.rows, mk);
  $("#statusChart").innerHTML = donut(me);

  const log = [...me.rows].sort((a,b)=>(b.date||0)-(a.date||0));
  $("#taskTable").innerHTML = log.length ? `<table><thead><tr>
      <th>Date</th><th>Task</th><th>Start</th><th>End</th><th>Duration</th>
      <th>Focus Time</th><th>Status</th><th>Code Time</th><th>Screen Time</th>
      <th>Language</th><th>Lines of code</th><th>Total</th></tr></thead><tbody>`+
      log.map(r=>{
        const s=statusOf(r);
        const cls = s==="done"?"p-done":s==="progress"?"p-prog":"p-open";
        const txt = s==="done"?"Completed":s==="progress"?"In progress":(r.status||"Open");
        return `<tr><td>${r.date?r.date.toLocaleDateString():r.dateRaw}</td><td>${esc(r.task)||"—"}</td>
        <td>${esc(r.start)||"—"}</td><td>${esc(r.end)||"—"}</td><td>${minutesOf(r)?hm(minutesOf(r)):"—"}</td>
        <td>${esc(r.focus)||"—"}</td>
        <td><span class="pill ${cls}">${esc(txt)}</span></td>
        <td>${esc(r.code)||"—"}</td><td>${esc(r.screen)||"—"}</td>
        <td>${esc(r.lang)||"—"}</td><td>${esc(r.loc)||"—"}</td><td>${esc(r.total)||"—"}</td></tr>`;
      }).join("")+`</tbody></table>`
    : '<p class="empty">No rows for this trainee in the selected month.</p>';


  /* --- team --- */
  const top = [...all].sort((a,b)=>b.minutes-a.minutes)[0];
  $("#teamKpis").innerHTML =
    kpi("TOTAL TEAM FOCUS", [["All trainees", hm(teamMins)], [me.name, hm(me.minutes), 1]]) +
    kpi("TEAM COMPLETION",  [["Team avg", teamRate+"%"], [me.name, me.rate+"%", 1]]) +
    kpi("TASKS THIS MONTH", [["All trainees", teamTasks], [me.name, me.tasks, 1]]) +
    kpi("MOST FOCUS TIME",  [[top.name, hm(top.minutes)], ["Team avg", hm(teamMins/all.length), 1]]);

  const byHours = [...all].sort((a,b)=>b.minutes-a.minutes);
  $("#teamHours").innerHTML = hbars(byHours, d=>d.minutes, d=>hm(d.minutes), who, "#5b3f9e");
  $("#teamRate").innerHTML  = hbars([...all].sort((a,b)=>b.rate-a.rate), d=>d.rate, d=>d.rate+"%", who, "#c4577c");

  $("#teamTable").innerHTML = `<table><thead><tr>
      <th>#</th><th>Trainee</th><th>Focus time</th><th>Active days</th><th>Avg / day</th>
      <th>Tasks</th><th>Completed</th><th>Rate</th>
      <th>Code time</th><th>Lines of code</th></tr></thead><tbody>`+
      byHours.map((s,i)=>`<tr class="${s.name===who?'me':''}">
        <td class="rank">${i+1}</td><td><b>${s.name}</b></td><td>${hm(s.minutes)}</td>
        <td>${s.activeDays}</td><td>${hm(s.perDay)}</td><td>${s.tasks}</td>
        <td>${s.done}</td><td>${s.rate}%</td>
        <td>${hm(s.codeMins)}</td><td>${s.totalLOC}</td></tr>`).join("")+
    `</tbody></table>`;

  /* --- marks --- */
  $("#marksTable").innerHTML = renderMarksBySemester(DATA.marks);

  $("#footnote").textContent =
    "Focus time uses the Duration column; when it is blank the dashboard works it out from StartTime and EndTime. " +
    "Code Time, Screen Time, Language and Lines of code come straight from the matching columns in the sheet.";
}

const esc = s => (s==null?"":String(s)).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));

/* ============================================================
   7. Sync + wiring
   ============================================================ */
async function sync(){
  if(!sheetId()){ $("#setup").hidden=false; return; }
  const btn = $("#syncBtn");
  btn.disabled = true; btn.textContent = "Syncing…";
  $("#error").hidden = true;
  try{
    const rows = {};
    for(const name of CONFIG.trainees){
      rows[name] = toObjects(await fetchTab(name));
    }
    let marks = [];
    try { marks = await fetchTab(CONFIG.marksTab); } catch(e){ marks = []; }
    DATA = { rows, marks, syncedAt:new Date().toISOString() };
    localStorage.setItem(LS.cache, JSON.stringify(DATA));
    $("#setup").hidden = true;
    buildMonths();
    render();
  }catch(err){
    $("#error").hidden = false;
    $("#error").innerHTML = esc(err.message) +
      ' — check the tab names in CONFIG and set sharing to "Anyone with the link". ' +
      '<button class="linkbtn" id="changeSheet">Use a different sheet</button>';
    $("#changeSheet").onclick = ()=>{ $("#setup").hidden=false; };
  }finally{
    btn.disabled = false; btn.textContent = "Sync from Google Sheets";
    stamp();
  }
}

function stamp(){
  $("#synced").textContent = DATA.syncedAt
    ? "Last synced: " + new Date(DATA.syncedAt).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})
    : "Not synced yet";
}

function buildMonths(){
  const months = allMonths();
  const sel = $("#monthSel"), keep = sel.value;
  sel.innerHTML = months.length
    ? months.map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("")
    : `<option value="">No dates found</option>`;
  if(months.includes(keep)) sel.value = keep;
  else{
    // First load: prefer today's real month over just "the latest date
    // found in the sheet", so a stray future/old test row can't hijack
    // the default view.
    const nowKey = monthKey(new Date());
    sel.value = months.includes(nowKey) ? nowKey : (months[0] || "");
  }
}

function init(){
  $("#traineeSel").innerHTML = CONFIG.trainees.map(n=>`<option>${n}</option>`).join("");
  document.querySelectorAll(".tab").forEach(t=>{
    t.onclick = ()=>{
      view = t.dataset.view;
      document.querySelectorAll(".tab").forEach(x=>x.setAttribute("aria-selected", String(x===t)));
      $("#view-one").hidden   = view!=="one";
      $("#view-team").hidden  = view!=="team";
      $("#view-marks").hidden = view!=="marks";
    };
  });
  $("#monthSel").onchange = render;
  $("#traineeSel").onchange = render;
  $("#syncBtn").onclick = sync;
  $("#saveSheet").onclick = ()=>{
    const raw = $("#sheetInput").value.trim();
    const m = raw.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const id = m ? m[1] : raw;
    if(!id) return;
    localStorage.setItem(LS.id, id);
    $("#setup").hidden = true;
    sync();
  };

  const cached = localStorage.getItem(LS.cache);
  if(cached){ try{ DATA = JSON.parse(cached); }catch(e){} }
  stamp(); buildMonths(); render();

  if(sheetId()) sync(); else $("#setup").hidden = false;
}
init();
