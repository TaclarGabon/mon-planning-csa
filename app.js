(()=>{
const DATA=window.CSA_DATA;
const $=id=>document.getElementById(id);
const DAYS=['Lundi','Mardi','Mercredi','Jeudi','Vendredi'];
const PROFILE_KEY='csa-mon-planning-profile-v2';
const ATT_KEY='csa-mon-planning-attendance-v2';
const CONN_KEY='csa-mon-planning-connections-v1';
const STUDENT_ATT_KEY='csa-student-attendance-v1';
let profile=null;
let selectedTeacher=DATA.teachers[0]?.id||'';
let selectedLoginTeacher='';
let filter='all';
let studentPreview=null,parentPreview=null;
let attendance={},connections={},studentAttendance={};
let teacherSlotCache={},currentCall=null;
try{attendance=JSON.parse(localStorage.getItem(ATT_KEY)||'{}')}catch(e){attendance={}}
try{connections=JSON.parse(localStorage.getItem(CONN_KEY)||'{}')}catch(e){connections={}}
try{studentAttendance=JSON.parse(localStorage.getItem(STUDENT_ATT_KEY)||'{}')}catch(e){studentAttendance={}}

const DEMO_STUDENT_NAMES=['Mathis','Alicia','Kevin','Grâce','Jean-Paul','Naomi','Lucas','Ethan','Sarah','Junior'];
const PERIOD_SLOTS=[['07h30','08h20'],['08h20','09h10'],['09h40','10h30'],['10h30','11h20'],['11h35','12h25'],['12h25','13h15'],['13h15','14h00'],['14h00','14h50'],['14h50','15h40'],['15h50','16h40'],['16h40','17h30']];

const firebaseConfig={
  apiKey:"AIzaSyCGRnVyRCJRb_s_9nogLiqiPFN3HQfTm94",
  authDomain:"mon-planning-csa.firebaseapp.com",
  databaseURL:"https://mon-planning-csa-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:"mon-planning-csa",
  storageBucket:"mon-planning-csa.firebasestorage.app",
  messagingSenderId:"92295051541",
  appId:"1:92295051541:web:ddb0e44c2be7d030b1911c"
};
let firebaseDb=null;
let firebaseInitPromise=null;
let firebaseWatchStarted=false;
let myPresenceRef=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const teacherById=id=>DATA.teachers.find(t=>t.id===id);
const classNames=Object.keys(DATA.classes);
const mins=t=>{const[a,b]=t.replace('h',':').split(':').map(Number);return a*60+b};

function nowLibreville(){
  const p=new Intl.DateTimeFormat('fr-FR',{timeZone:'Africa/Libreville',weekday:'long',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const o={};p.forEach(x=>o[x.type]=x.value);
  return{day:o.weekday.charAt(0).toUpperCase()+o.weekday.slice(1),time:`${o.hour}:${o.minute}`,minutes:+o.hour*60 + +o.minute,dateKey:`${o.year}-${o.month}-${o.day}`};
}
function presenceStatus(t){const a=attendance[t.id];if(a?.absent===true)return{key:'absent',label:'Absent'};if(a?.present===true)return{key:'present',label:'Présent'};return{key:'unknown',label:'À confirmer'}}
function onlineStatus(t){return connections[t.id]?{key:'online',label:'Connecté'}:{key:'offline',label:'Hors ligne'}}
function courseStatus(t){
  const n=nowLibreville();
  const lesson=t.schedule.find(x=>x.day===n.day&&mins(x.start)<=n.minutes&&n.minutes<mins(x.end));
  return lesson?{key:'teaching',label:`En cours • ${lesson.classes.join(', ')}`}:{key:'free',label:'Libre'};
}
function currentStatus(t){if(attendance[t.id]?.absent)return{key:'absent',label:'Absent'};return courseStatus(t)}
function todayLessonsCount(){const d=nowLibreville().day;return Object.values(DATA.classes).reduce((n,a)=>n+a.filter(x=>x.day===d).length,0)}
function attendancePath(){return `schools/csa/attendance/${nowLibreville().dateKey}`}
function presencePath(){return 'schools/csa/presence'}
function refreshLiveUI(){
  if(profile?.role==='direction')renderDirection();
  if(profile?.role==='teacher'&&profile.teacherId&&$('teacherView')?.classList.contains('active')){
    const t=teacherById(profile.teacherId);if(t)renderTeacherAbsence(t);
  }
  if($('teacherLoginStep')?.classList.contains('active')&&!selectedLoginTeacher)renderTeacherLoginList($('profLoginSearch').value);
}
function startFirebaseListeners(){
  if(firebaseWatchStarted||!firebaseDb)return;
  firebaseWatchStarted=true;
  firebaseDb.ref(attendancePath()).on('value',snap=>{
    attendance=snap.val()||{};
    localStorage.setItem(ATT_KEY,JSON.stringify(attendance));
    refreshLiveUI();
  },err=>console.warn('Firebase présence école:',err));
  firebaseDb.ref(presencePath()).on('value',snap=>{
    const raw=snap.val()||{},next={};
    Object.entries(raw).forEach(([teacherId,sessions])=>{next[teacherId]=!!(sessions&&typeof sessions==='object'&&Object.keys(sessions).length)});
    connections=next;
    localStorage.setItem(CONN_KEY,JSON.stringify(connections));
    refreshLiveUI();
  },err=>console.warn('Firebase connexion application:',err));
}
function initFirebase(){
  if(firebaseInitPromise)return firebaseInitPromise;
  firebaseInitPromise=(async()=>{
    try{
      if(!window.firebase)throw new Error('SDK Firebase non chargé');
      if(!firebase.apps.length)firebase.initializeApp(firebaseConfig);
      await firebase.auth().signInAnonymously();
      firebaseDb=firebase.database();
      startFirebaseListeners();
      return true;
    }catch(err){
      console.warn('Firebase indisponible : mode local conservé.',err);
      return false;
    }
  })();
  return firebaseInitPromise;
}
async function syncTeacherAttendance(id){
  const ok=await initFirebase();if(!ok||!firebaseDb)return false;
  try{
    const ref=firebaseDb.ref(`${attendancePath()}/${id}`);
    if(attendance[id])await ref.set(attendance[id]);else await ref.remove();
    return true;
  }catch(err){console.warn('Synchronisation présence impossible',err);return false}
}
async function syncAllAttendance(){
  const ok=await initFirebase();if(!ok||!firebaseDb)return false;
  try{await firebaseDb.ref(attendancePath()).set(attendance||{});return true}catch(err){console.warn('Synchronisation présence impossible',err);return false}
}
async function markTeacherOnline(id){
  const ok=await initFirebase();if(!ok||!firebaseDb)return false;
  try{
    const user=firebase.auth().currentUser;if(!user)return false;
    if(myPresenceRef)try{await myPresenceRef.remove()}catch(_){}
    myPresenceRef=firebaseDb.ref(`${presencePath()}/${id}/${user.uid}`);
    await myPresenceRef.set({online:true,lastSeen:firebase.database.ServerValue.TIMESTAMP});
    myPresenceRef.onDisconnect().remove();
    connections[id]=true;localStorage.setItem(CONN_KEY,JSON.stringify(connections));
    return true;
  }catch(err){console.warn('Connexion temps réel impossible',err);return false}
}
async function markTeacherOffline(id){
  connections[id]=false;localStorage.setItem(CONN_KEY,JSON.stringify(connections));
  try{
    if(myPresenceRef){await myPresenceRef.remove();myPresenceRef=null;return true}
    const ok=await initFirebase();if(!ok||!firebaseDb)return false;
    const user=firebase.auth().currentUser;if(user&&id)await firebaseDb.ref(`${presencePath()}/${id}/${user.uid}`).remove();
    return true;
  }catch(err){console.warn('Déconnexion temps réel impossible',err);return false}
}
async function resetFirebaseDemo(){
  const ok=await initFirebase();if(!ok||!firebaseDb)return false;
  try{
    await Promise.all([firebaseDb.ref(attendancePath()).remove(),firebaseDb.ref(presencePath()).remove()]);
    myPresenceRef=null;
    return true;
  }catch(err){console.warn('Réinitialisation Firebase impossible',err);return false}
}
function saveAttendance(id=null){
  localStorage.setItem(ATT_KEY,JSON.stringify(attendance));
  if(id)syncTeacherAttendance(id);else syncAllAttendance();
}
function saveConnections(){localStorage.setItem(CONN_KEY,JSON.stringify(connections))}

function initOptions(){
  const topts=DATA.teachers.map(t=>`<option value="${t.id}">${esc(t.name)} — ${esc(t.subjects.join(' / '))}</option>`).join('');
  $('teacherSelect').innerHTML=topts;
  $('directionSearch').innerHTML='<option value="">Tous les professeurs</option>'+topts;
  $('settingsTeacher').innerHTML=topts;
  const blank='<option value="">— Choisir une classe —</option>';
  const copts=classNames.map(c=>`<option>${esc(c)}</option>`).join('');
  ['studentLoginClass','directionClassSelect','directorStudentClass','directorParentClass','parentClassSelect'].forEach(id=>$(id).innerHTML=blank+copts);
  $('directionClassSelect').value=classNames[0]||'';
  updateSettingsTeacherCode();
}

function showGateStep(id){
  document.querySelectorAll('.gateStep').forEach(x=>x.classList.toggle('active',x.id===id));
  $('profileGate').classList.add('show');
}
function showProfileChooser(){
  $('directionError').textContent='';
  $('studentError').textContent='';
  $('directionPin').value='';
  $('studentLoginName').value='';
  $('studentLoginClass').value='';
  $('profLoginSearch').value='';
  selectedLoginTeacher='';
  $('teacherLoginStep').classList.remove('teacherLoginStepSelected');
  $('profLoginPanel').innerHTML='<div class="empty">Sélectionnez votre nom dans la liste.</div>';
  renderTeacherLoginList();
  showGateStep('profileChooser');
}
function hideGate(){$('profileGate').classList.remove('show')}

function openRoleLogin(role){
  if(role==='direction')showGateStep('directionLoginStep');
  if(role==='teacher'){selectedLoginTeacher='';$('teacherLoginStep').classList.remove('teacherLoginStepSelected');$('profLoginPanel').innerHTML='<div class="empty">Sélectionnez votre nom dans la liste.</div>';renderTeacherLoginList();showGateStep('teacherLoginStep')}
  if(role==='student')showGateStep('studentLoginStep');
}

function loginDirection(){
  $('directionError').textContent='';
  if($('directionPin').value.trim()!==DATA.school.directorPin){$('directionError').textContent='Code Direction incorrect.';return}
  profile={role:'direction',firstName:DATA.school.director};
  localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
  applyProfile();
}
function loginStudent(){
  $('studentError').textContent='';
  const name=$('studentLoginName').value.trim(),className=$('studentLoginClass').value;
  if(!className){$('studentError').textContent='Choisissez votre classe.';return}
  if(!name){$('studentError').textContent='Renseignez votre nom.';return}
  profile={role:'student',firstName:name,className};
  localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
  applyProfile();
}

function renderTeacherLoginList(q=''){
  const needle=q.trim().toLowerCase();
  const list=DATA.teachers.filter(t=>!needle||t.name.toLowerCase().includes(needle)||t.subjects.join(' ').toLowerCase().includes(needle));
  $('profLoginList').innerHTML=list.map(t=>{
    const p=presenceStatus(t),o=onlineStatus(t);
    return `<button class="profNameItem ${selectedLoginTeacher===t.id?'selected':''}" data-id="${t.id}">
      <div class="profAvatar">${esc(t.name.split(' ').map(x=>x[0]).join('').slice(0,2))}</div>
      <div class="profNameText"><b>${esc(t.name)}</b><small>${esc(t.subjects.join(' • '))}</small></div>
      <div class="profMiniStatus"><span class="dot ${p.key}"></span><span>${p.label}</span><span class="dot ${o.key}"></span><span>${o.label}</span></div>
      <span class="loginAction ${o.key==='online'?'connected':''}">${o.key==='online'?'✓ Connecté':'Se connecter'}</span>
    </button>`;
  }).join('')||'<div class="empty">Aucun professeur trouvé.</div>';
  document.querySelectorAll('.profNameItem').forEach(b=>b.onclick=()=>selectLoginTeacher(b.dataset.id));
}
function selectLoginTeacher(id){
  selectedLoginTeacher=id;
  $('teacherLoginStep').classList.add('teacherLoginStepSelected');
  renderTeacherLoginPanel();
}
function backToTeacherList(){
  selectedLoginTeacher='';
  $('teacherLoginStep').classList.remove('teacherLoginStepSelected');
  $('profLoginPanel').innerHTML='<div class="empty">Sélectionnez votre nom dans la liste.</div>';
  renderTeacherLoginList($('profLoginSearch').value);
}
function renderTeacherLoginPanel(){
  const t=teacherById(selectedLoginTeacher);
  if(!t){$('profLoginPanel').innerHTML='<div class="empty">Sélectionnez votre nom dans la liste.</div>';return}
  $('profLoginPanel').innerHTML=`<div class="selectedProf">
    <button id="changeTeacherBtn" class="changeTeacherBtn" type="button">← Choisir un autre professeur</button>
    <div class="selectedProfHead"><div class="bigProfAvatar">${esc(t.name.split(' ').map(x=>x[0]).join('').slice(0,2))}</div><div><small>PROFESSEUR</small><h3>${esc(t.name)}</h3><p>${esc(t.subjects.join(' • '))}</p></div></div>
    <label>Entrez votre code PIN</label>
    <input id="professorLoginPin" inputmode="numeric" autocomplete="off" placeholder="Code PIN">
    <button id="professorLoginBtn" class="primary">Se connecter</button>
    <div id="professorLoginError" class="error"></div>
  </div>`;
  $('changeTeacherBtn').onclick=backToTeacherList;
  $('professorLoginBtn').onclick=()=>loginTeacher(t.id);
}
function renderTeacherPresenceQuestion(t){
  $('profLoginPanel').innerHTML=`<div class="presenceQuestion">
    <div class="bigProfAvatar">${esc(t.name.split(' ').map(x=>x[0]).join('').slice(0,2))}</div>
    <small class="eyebrow">✓ CONNECTÉ À MON PLANNING</small>
    <h3>${esc(t.name)}</h3>
    <p>Êtes-vous présent(e) à l’école aujourd’hui ?</p>
    <div class="presenceQuestionButtons">
      <button id="presenceYesBtn" class="presenceYes">✓ Oui, présent(e)</button>
      <button id="presenceNoBtn" class="presenceNo">✕ Non, absent(e)</button>
    </div>
  </div>`;
  $('presenceYesBtn').onclick=()=>finishTeacherPresence(t,true);
  $('presenceNoBtn').onclick=()=>finishTeacherPresence(t,false);
}
function finishTeacherPresence(t,present){
  attendance[t.id]=present
    ?{present:true,absent:false,replacementId:'',replacementName:''}
    :{present:false,absent:true,replacementId:'',replacementName:''};
  saveAttendance(t.id);
  profile={role:'teacher',firstName:t.name,teacherId:t.id};
  selectedTeacher=t.id;
  localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
  applyProfile();
}
async function loginTeacher(id){
  const t=teacherById(id),err=$('professorLoginError'),pin=$('professorLoginPin').value.trim();
  err.textContent='';
  if(pin!==t.pin){err.textContent='Code professeur incorrect.';return}
  connections[id]=true;
  saveConnections();
  await markTeacherOnline(id);
  const btn=$('professorLoginBtn');
  btn.textContent='✓ Connecté';
  btn.classList.add('connectedBtn');
  btn.disabled=true;
  setTimeout(()=>renderTeacherPresenceQuestion(t),350);
}

function roleLabel(r){return({direction:'Direction',teacher:'Professeur',student:'Élève',parent:'Parent'})[r]||r}
function applyProfile(){
  if(!profile){showProfileChooser();return}
  $('userName').textContent=profile.firstName;
  $('userRole').textContent=roleLabel(profile.role);
  $('settingsBtn').style.display=profile.role==='direction'?'inline-block':'none';
  const btns=[...document.querySelectorAll('.role')];btns.forEach(b=>b.classList.remove('hiddenRole'));
  let view='direction';
  if(profile.role==='teacher'){btns.forEach(b=>{if(b.dataset.view!=='teacher')b.classList.add('hiddenRole')});view='teacher';selectedTeacher=profile.teacherId}
  else if(profile.role==='student'){btns.forEach(b=>{if(b.dataset.view!=='student')b.classList.add('hiddenRole')});view='student'}
  else if(profile.role==='parent'){btns.forEach(b=>{if(b.dataset.view!=='parent')b.classList.add('hiddenRole')});view='parent'}
  hideGate();activate(view);
}
function logout(){
  if(profile?.role==='teacher'&&profile.teacherId){const id=profile.teacherId;connections[id]=false;saveConnections();markTeacherOffline(id)}
  localStorage.removeItem(PROFILE_KEY);profile=null;showProfileChooser();
}

function activate(v){
  document.querySelectorAll('.role').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id===v+'View'));
  if(v==='direction')renderDirection();
  if(v==='teacher')renderTeacher('today');
  if(v==='classes')renderDirectionClass('week');
  if(v==='student')prepareStudent();
  if(v==='parent')prepareParent();
}

function renderDirection(){
  const n=nowLibreville();
  $('directorHello').textContent=DATA.school.director;
  $('librevilleClock').textContent=n.time;$('librevilleDay').textContent=n.day;
  $('mClasses').textContent=classNames.length;$('mTeachers').textContent=DATA.teachers.length;$('mSubjects').textContent=DATA.subjects.length;$('mAbsent').textContent=DATA.teachers.filter(t=>attendance[t.id]?.absent===true).length;
  renderStaff();
}
function renderStaff(){
  const q=$('directionSearch').value;
  let list=q?DATA.teachers.filter(t=>t.id===q):DATA.teachers.slice();
  if(filter!=='all')list=list.filter(t=>currentStatus(t).key===filter);
  $('staffList').innerHTML=list.map(t=>{
    const p=presenceStatus(t),o=onlineStatus(t),c=courseStatus(t);
    return `<article class="staffCard" data-id="${t.id}">
      <div class="staffTop"><b>${esc(t.name)}</b><span class="pill ${c.key}">${esc(c.label)}</span></div>
      <p>${esc(t.subjects.join(' • '))}</p>
      <div class="dualStatus"><span class="statusChip ${p.key}">${p.label}</span><span class="statusChip ${o.key}">${o.label}</span></div>
    </article>`;
  }).join('')||'<div class="empty">Aucun professeur dans ce filtre.</div>';
  document.querySelectorAll('.staffCard').forEach(c=>c.onclick=()=>showTeacherDetail(c.dataset.id));
}
function showTeacherDetail(id){
  const t=teacherById(id);if(!t)return;
  const c=courseStatus(t),p=presenceStatus(t),o=onlineStatus(t),a=attendance[id];
  const compatible=DATA.teachers.filter(x=>x.id!==id&&x.subjects.some(sub=>t.subjects.includes(sub))).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
  $('directionTeacherPanel').innerHTML=`<div class="teacherDetail">
    <div class="teacherDetailHead"><div><small class="eyebrow">PROFESSEUR</small><h3>${esc(t.name)}</h3><p>${esc(t.subjects.join(' • '))}</p></div><div class="detailBadges"><span class="statusChip ${p.key}">${p.label}</span><span class="statusChip ${o.key}">${o.label}</span><span class="pill ${c.key}">${esc(c.label)}</span></div></div>
    <div class="replacementBox"><select id="detailStatus"><option value="unknown" ${!a||(!a.present&&!a.absent)?'selected':''}>Présence à confirmer</option><option value="present" ${a?.present===true?'selected':''}>Présent</option><option value="absent" ${a?.absent===true?'selected':''}>Absent aujourd’hui</option></select><select id="detailReplacement"><option value="">— Sans remplaçant —</option>${compatible}<option value="__external__">Remplaçant externe</option></select><button id="detailSave">Valider</button></div>
    <input id="externalReplacement" class="hidden" placeholder="Nom du remplaçant externe" style="margin-top:8px">
  </div>`;
  if(a?.replacementId)$('detailReplacement').value=a.replacementId;
  if(a?.replacementName&&!a?.replacementId){$('detailReplacement').value='__external__';$('externalReplacement').classList.remove('hidden');$('externalReplacement').value=a.replacementName}
  $('detailReplacement').onchange=()=>$('externalReplacement').classList.toggle('hidden',$('detailReplacement').value!=='__external__');
  $('detailSave').onclick=()=>{
    const status=$('detailStatus').value;
    if(status==='unknown')delete attendance[id];
    else if(status==='present')attendance[id]={present:true,absent:false,replacementId:'',replacementName:''};
    else{
      const rid=$('detailReplacement').value;
      attendance[id]={present:false,absent:true,replacementId:rid&&rid!=='__external__'?rid:'',replacementName:rid==='__external__'?$('externalReplacement').value.trim():(rid?teacherById(rid)?.name:'')};
    }
    saveAttendance(id);renderDirection();showTeacherDetail(id);
  };
}

function scheduleMarkup(items,byClass=false){
  if(!items.length)return'<div class="empty">Aucun cours prévu.</div>';
  const groups={};DAYS.forEach(d=>groups[d]=[]);items.forEach(x=>(groups[x.day]||(groups[x.day]=[])).push(x));
  return DAYS.map(d=>{
    const arr=groups[d]||[];if(!arr.length)return'';
    return `<section class="dayBlock"><div class="dayHead"><b>${d}</b><span>${d===nowLibreville().day?'Aujourd’hui':'Semaine'}</span></div>${arr.map(x=>`<div class="lesson"><time>${x.start}–${x.end}</time><div><strong>${esc(x.subject)}</strong><small>${byClass?esc(x.teacher):esc((x.classes||[]).join(', '))}</small></div><em>${byClass?'Prof.':'Classe'} ${byClass?'':esc((x.classes||[]).join(', '))}</em></div>`).join('')}</section>`;
  }).join('');
}
function renderTeacher(mode='today'){
  const t=teacherById(profile?.role==='teacher'?profile.teacherId:$('teacherSelect').value||selectedTeacher);if(!t)return;
  selectedTeacher=t.id;$('teacherSelect').value=t.id;$('teacherSelect').classList.toggle('hidden',profile?.role==='teacher');
  $('teacherTitle').textContent=profile?.role==='teacher'?'Mon planning':t.name;
  $('teacherSubjects').textContent=t.subjects.join(' • ');
  const d=nowLibreville().day,items=mode==='today'?t.schedule.filter(x=>x.day===d):t.schedule;
  $('teacherSchedule').innerHTML=scheduleMarkup(items,false);
  $('teacherTodayBtn').classList.toggle('active',mode==='today');$('teacherWeekBtn').classList.toggle('active',mode==='week');
  renderTeacherAbsence(t);
}
function renderTeacherAbsence(t){
  const p=presenceStatus(t),o=onlineStatus(t);
  $('teacherAbsencePanel').innerHTML=`<div class="absenceCard teacherPresenceCard"><div><b>Statut du jour</b><small style="display:block;color:var(--muted)">Application : <strong>${o.label}</strong></small></div><div class="presenceButtons compact"><button id="teacherPresentBtn" class="${p.key==='present'?'active present':''}">✓ Présent</button><button id="teacherAbsentBtn" class="${p.key==='absent'?'active absent':''}">✕ Absent</button></div></div>`;
  $('teacherPresentBtn').onclick=()=>{attendance[t.id]={present:true,absent:false,replacementId:'',replacementName:''};saveAttendance(t.id);renderTeacher('today')};
  $('teacherAbsentBtn').onclick=()=>{attendance[t.id]={present:false,absent:true,replacementId:'',replacementName:''};saveAttendance(t.id);renderTeacher('today')};
}

function classItems(c,day=null){const arr=DATA.classes[c]||[];return day?arr.filter(x=>x.day===day):arr}
function classMarkup(c,day=null){const arr=classItems(c,day);if(!arr.length)return'<div class="empty">Aucun cours prévu.</div>';return scheduleMarkup(arr.map(x=>({...x,classes:[c]})),true)}
function renderDirectionClass(mode='week'){const c=$('directionClassSelect').value||classNames[0];$('directionClassSelect').value=c;$('directionClassSchedule').innerHTML=classMarkup(c,mode==='today'?nowLibreville().day:null)}

function prepareStudent(){
  if(profile?.role==='direction'){studentPreview=null;$('directorStudentLogin').style.display='grid';$('studentProfileContent').style.display='none';$('directorStudentName').value='';$('directorStudentClass').value='';return}
  $('directorStudentLogin').style.display='none';$('studentProfileContent').style.display='block';renderStudent('today');
}
function renderStudent(mode='today'){
  const c=profile?.role==='direction'?studentPreview?.className:profile?.className;if(!c)return;
  $('studentIdentity').textContent=profile?.role==='direction'?`Élève : ${studentPreview?.name||''} • Classe : ${c}`:`${profile.firstName} • Classe : ${c}`;
  $('studentSchedule').innerHTML=classMarkup(c,mode==='today'?nowLibreville().day:null);
  $('studentTodayBtn').classList.toggle('active',mode==='today');$('studentWeekBtn').classList.toggle('active',mode==='week');
}
function prepareParent(){
  if(profile?.role==='direction'){parentPreview=null;$('directorParentLogin').style.display='grid';$('parentProfileContent').style.display='none';$('directorParentName').value='';$('directorParentClass').value='';return}
  $('directorParentLogin').style.display='none';$('parentProfileContent').style.display='block';$('parentClassSelect').value=profile.className;renderParent('today');
}
function renderParent(mode='today'){
  const c=$('parentClassSelect').value||(profile?.role==='direction'?parentPreview?.className:profile?.className);if(!c)return;
  $('parentClassSelect').value=c;$('parentSchedule').innerHTML=classMarkup(c,mode==='today'?nowLibreville().day:null);
}

function updateSettingsTeacherCode(){const t=teacherById($('settingsTeacher').value||DATA.teachers[0]?.id);if(t)$('settingsTeacherCode').innerHTML=`${esc(t.name)} — <strong>${t.pin}</strong>`}

function wire(){
  document.querySelectorAll('.profileChoice').forEach(b=>b.onclick=()=>openRoleLogin(b.dataset.profile));
  document.querySelectorAll('.backProfiles').forEach(b=>b.onclick=showProfileChooser);
  $('directionLoginBtn').onclick=loginDirection;
  $('studentLoginBtn').onclick=loginStudent;
  $('profLoginSearch').oninput=()=>renderTeacherLoginList($('profLoginSearch').value);
  $('logoutBtn').onclick=logout;
  document.querySelectorAll('.role').forEach(b=>b.onclick=()=>activate(b.dataset.view));
  $('directionSearch').onchange=renderStaff;
  document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderStaff()});
  $('teacherSelect').onchange=()=>renderTeacher('today');
  $('teacherTodayBtn').onclick=()=>renderTeacher('today');$('teacherWeekBtn').onclick=()=>renderTeacher('week');
  $('directionClassToday').onclick=()=>renderDirectionClass('today');$('directionClassWeek').onclick=()=>renderDirectionClass('week');$('directionClassSelect').onchange=()=>renderDirectionClass('week');
  $('studentTodayBtn').onclick=()=>renderStudent('today');$('studentWeekBtn').onclick=()=>renderStudent('week');
  $('parentTodayBtn').onclick=()=>renderParent('today');$('parentWeekBtn').onclick=()=>renderParent('week');$('parentClassSelect').onchange=()=>renderParent('week');
  $('directorStudentEnter').onclick=()=>{const name=$('directorStudentName').value.trim(),className=$('directorStudentClass').value;if(!name||!className)return;studentPreview={name,className};$('directorStudentLogin').style.display='none';$('studentProfileContent').style.display='block';renderStudent('week')};
  $('directorParentEnter').onclick=()=>{const name=$('directorParentName').value.trim(),className=$('directorParentClass').value;if(!name||!className)return;parentPreview={name,className};$('directorParentLogin').style.display='none';$('parentProfileContent').style.display='block';$('parentClassSelect').value=className;renderParent('week')};
  $('settingsBtn').onclick=()=>$('settingsModal').classList.add('show');$('settingsClose').onclick=()=>$('settingsModal').classList.remove('show');
  $('settingsTeacher').onchange=updateSettingsTeacherCode;
  $('resetDemoBtn').onclick=async()=>{if(!confirm('Réinitialiser la démo ? Les présences repasseront à confirmer, tous les professeurs seront hors ligne et les remplacements seront supprimés.'))return;attendance={};connections={};localStorage.setItem(ATT_KEY,'{}');saveConnections();await resetFirebaseDemo();renderDirection();$('resetDemoBtn').textContent='✓ Démo réinitialisée';setTimeout(()=>$('resetDemoBtn').textContent='↻ Réinitialiser la démo',1400)};
}
function boot(){
  initOptions();wire();renderTeacherLoginList();
  setInterval(()=>{if(profile?.role==='direction')renderDirection()},60000);
  setTimeout(()=>$('splash').classList.add('hide'),1650);
  try{profile=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')}catch(e){profile=null}
  initFirebase().then(ok=>{if(ok&&profile?.role==='teacher'&&profile.teacherId)markTeacherOnline(profile.teacherId)});
  if(profile)applyProfile();else showProfileChooser();
}
window.addEventListener('storage',e=>{
  if(e.key===ATT_KEY){try{attendance=JSON.parse(e.newValue||'{}')}catch(_){attendance={}}}
  if(e.key===CONN_KEY){try{connections=JSON.parse(e.newValue||'{}')}catch(_){connections={}}}
  if(profile?.role==='direction')renderDirection();
  if($('teacherLoginStep')?.classList.contains('active')){renderTeacherLoginList($('profLoginSearch').value);if(selectedLoginTeacher)renderTeacherLoginPanel()}
});

/* ===== V5 : appel élèves + profil Parent ===== */
function safeKey(v){return encodeURIComponent(String(v||'')).replace(/\./g,'%2E')}
function rosterForClass(className){
  const prefix=safeKey(className).replace(/%/g,'').slice(0,12)||'classe';
  return DEMO_STUDENT_NAMES.map((name,i)=>({id:`${prefix}_s${String(i+1).padStart(2,'0')}`,name}));
}
function studentAttendancePath(){return `schools/csa/studentAttendance/${nowLibreville().dateKey}`}
function splitLessonPeriods(lesson,className,teacherId,teacherName){
  const a=mins(lesson.start),b=mins(lesson.end);
  let pairs=PERIOD_SLOTS.filter(([s,e])=>mins(s)>=a&&mins(e)<=b);
  if(!pairs.length)pairs=[[lesson.start,lesson.end]];
  const groupKey=[lesson.day,lesson.start,lesson.end,lesson.subject,className,teacherId||teacherName||''].join('|');
  const slots=pairs.map(([start,end],i)=>({
    day:lesson.day,start,end,subject:lesson.subject,className,
    teacherId:teacherId||'',teacherName:teacherName||lesson.teacher||'',
    groupKey,slotIndex:i,slotCount:pairs.length
  }));
  slots.forEach((x,i)=>{
    x.callKey=[x.start.replace('h',''),x.end.replace('h',''),String(x.className).replace(/[^A-Za-z0-9]+/g,'_'),String(x.subject).replace(/[^A-Za-z0-9]+/g,'_'),x.teacherId||String(x.teacherName).replace(/[^A-Za-z0-9]+/g,'_')].join('_');
    x.inheritKey=slots[0].callKey;
  });
  return slots;
}
function teacherTodaySlots(t){
  const day=nowLibreville().day,out=[];
  t.schedule.filter(x=>x.day===day).forEach(lesson=>{
    (lesson.classes||[]).forEach(c=>out.push(...splitLessonPeriods(lesson,c,t.id,t.name)));
  });
  return out.sort((a,b)=>mins(a.start)-mins(b.start)||a.className.localeCompare(b.className));
}
function classTodaySlots(className){
  const day=nowLibreville().day,out=[];
  (DATA.classes[className]||[]).filter(x=>x.day===day).forEach(lesson=>{
    const t=DATA.teachers.find(z=>z.name===lesson.teacher);
    out.push(...splitLessonPeriods(lesson,className,t?.id||'',lesson.teacher));
  });
  return out.sort((a,b)=>mins(a.start)-mins(b.start));
}
function classCalls(className){return studentAttendance[safeKey(className)]||{}}
function callForSlot(slot){
  const calls=classCalls(slot.className);
  if(calls[slot.callKey])return{record:calls[slot.callKey],inherited:false};
  if(slot.slotIndex>0&&calls[slot.inheritKey])return{record:calls[slot.inheritKey],inherited:true};
  return{record:null,inherited:false};
}
function callCounts(record){
  const values=record?Object.values(record.students||{}):[];
  return{present:values.filter(x=>x==='present').length,absent:values.filter(x=>x==='absent').length};
}
async function syncStudentCall(slot,record){
  const ok=await initFirebase();if(!ok||!firebaseDb)return false;
  try{
    await firebaseDb.ref(`${studentAttendancePath()}/${safeKey(slot.className)}/${slot.callKey}`).set(record);
    return true;
  }catch(err){console.warn('Synchronisation appel élèves impossible',err);return false}
}
function refreshLiveUI(){
  if(profile?.role==='direction'){
    renderDirection();
    if($('studentView')?.classList.contains('active'))renderDirectionStudentAttendance();
  }
  if(profile?.role==='teacher'&&profile.teacherId&&$('teacherView')?.classList.contains('active')){
    const mode=$('teacherTodayBtn')?.classList.contains('active')?'today':'week';
    renderTeacher(mode);
  }
  if(profile?.role==='parent'&&$('parentView')?.classList.contains('active')){
    const mode=$('parentTodayBtn')?.classList.contains('active')?'today':'week';
    renderParent(mode);
  }
  if($('teacherLoginStep')?.classList.contains('active')&&!selectedLoginTeacher)renderTeacherLoginList($('profLoginSearch').value);
}
function startFirebaseListeners(){
  if(firebaseWatchStarted||!firebaseDb)return;
  firebaseWatchStarted=true;
  firebaseDb.ref(attendancePath()).on('value',snap=>{
    attendance=snap.val()||{};
    localStorage.setItem(ATT_KEY,JSON.stringify(attendance));
    refreshLiveUI();
  },err=>console.warn('Firebase présence école:',err));
  firebaseDb.ref(presencePath()).on('value',snap=>{
    const raw=snap.val()||{},next={};
    Object.entries(raw).forEach(([teacherId,sessions])=>{next[teacherId]=!!(sessions&&typeof sessions==='object'&&Object.keys(sessions).length)});
    connections=next;
    localStorage.setItem(CONN_KEY,JSON.stringify(connections));
    refreshLiveUI();
  },err=>console.warn('Firebase connexion application:',err));
  firebaseDb.ref(studentAttendancePath()).on('value',snap=>{
    studentAttendance=snap.val()||{};
    localStorage.setItem(STUDENT_ATT_KEY,JSON.stringify(studentAttendance));
    refreshLiveUI();
  },err=>console.warn('Firebase appel élèves:',err));
}
async function resetFirebaseDemo(){
  const ok=await initFirebase();if(!ok||!firebaseDb)return false;
  try{
    await Promise.all([
      firebaseDb.ref(attendancePath()).remove(),
      firebaseDb.ref(presencePath()).remove(),
      firebaseDb.ref(studentAttendancePath()).remove()
    ]);
    myPresenceRef=null;studentAttendance={};localStorage.setItem(STUDENT_ATT_KEY,'{}');
    return true;
  }catch(err){console.warn('Réinitialisation Firebase impossible',err);return false}
}
function initOptions(){
  const topts=DATA.teachers.map(t=>`<option value="${t.id}">${esc(t.name)} — ${esc(t.subjects.join(' / '))}</option>`).join('');
  $('teacherSelect').innerHTML=topts;
  $('directionSearch').innerHTML='<option value="">Tous les professeurs</option>'+topts;
  $('settingsTeacher').innerHTML=topts;
  const blank='<option value="">— Choisir une classe —</option>';
  const copts=classNames.map(c=>`<option>${esc(c)}</option>`).join('');
  ['studentLoginClass','parentLoginClass','directionClassSelect','directorStudentClass','directorParentClass','parentClassSelect'].forEach(id=>$(id).innerHTML=blank+copts);
  $('directionClassSelect').value=classNames[0]||'';
  updateSettingsTeacherCode();
}
function populateParentChildren(){
  const c=$('parentLoginClass').value,sel=$('parentLoginChild');
  if(!c){sel.disabled=true;sel.innerHTML='<option value="">— Choisir d’abord une classe —</option>';return}
  const roster=rosterForClass(c);
  sel.disabled=false;
  sel.innerHTML='<option value="">— Choisir mon enfant —</option>'+roster.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('');
}
function showProfileChooser(){
  $('directionError').textContent='';$('studentError').textContent='';$('parentError').textContent='';
  $('directionPin').value='';$('studentLoginName').value='';$('studentLoginClass').value='';
  $('parentLoginName').value='';$('parentLoginClass').value='';populateParentChildren();
  $('profLoginSearch').value='';selectedLoginTeacher='';
  $('teacherLoginStep').classList.remove('teacherLoginStepSelected');
  $('profLoginPanel').innerHTML='<div class="empty">Sélectionnez votre nom dans la liste.</div>';
  renderTeacherLoginList();showGateStep('profileChooser');
}
function openRoleLogin(role){
  if(role==='direction')showGateStep('directionLoginStep');
  if(role==='teacher'){selectedLoginTeacher='';$('teacherLoginStep').classList.remove('teacherLoginStepSelected');$('profLoginPanel').innerHTML='<div class="empty">Sélectionnez votre nom dans la liste.</div>';renderTeacherLoginList();showGateStep('teacherLoginStep')}
  if(role==='student')showGateStep('studentLoginStep');
  if(role==='parent'){populateParentChildren();showGateStep('parentLoginStep')}
}
function loginParent(){
  $('parentError').textContent='';
  const className=$('parentLoginClass').value,childId=$('parentLoginChild').value;
  if(!className){$('parentError').textContent='Choisissez la classe de votre enfant.';return}
  if(!childId){$('parentError').textContent='Choisissez votre enfant.';return}
  const child=rosterForClass(className).find(x=>x.id===childId);
  const parentName=$('parentLoginName').value.trim()||`Parent de ${child?.name||''}`;
  profile={role:'parent',firstName:parentName,className,childId,childName:child?.name||''};
  localStorage.setItem(PROFILE_KEY,JSON.stringify(profile));
  applyProfile();
}
function renderTeacherTodayBoard(t){
  const slots=teacherTodaySlots(t);
  teacherSlotCache={};slots.forEach(x=>teacherSlotCache[x.callKey]=x);
  if(!slots.length)return'<div class="empty">Aucun cours prévu aujourd’hui.</div>';
  const rows=slots.map(slot=>{
    const info=callForSlot(slot),counts=callCounts(info.record),done=!!info.record;
    let action;
    if(info.inherited){
      action=`<button class="callRowAction inherited" data-call="${slot.callKey}">ℹ Reprend automatiquement l’appel précédent<small>Mise à jour possible</small></button>`;
    }else if(done){
      action=`<button class="callRowAction done" data-call="${slot.callKey}">✓ Appel effectué</button>`;
    }else{
      action=`<button class="callRowAction" data-call="${slot.callKey}">☷ Faire l’appel</button>`;
    }
    return `<div class="attendanceRow">
      <div class="attendanceTime">${slot.start}–<br>${slot.end}</div>
      <div class="attendanceSubject">${esc(slot.subject)}</div>
      <div class="attendanceMetric present ${done?'done':''}"><span>Présents</span><b>${done?counts.present:'—'}</b></div>
      <div class="attendanceMetric absent ${done?'done':''}"><span>Absents</span><b>${done?counts.absent:'—'}</b></div>
      <div class="attendanceMetric calltime ${done?'done':''}"><span>${done?'Appel fait à':'Appel à faire'}</span><b>${done?esc(info.record.calledAt||'—'):'—'}</b></div>
      ${action}
    </div>`;
  }).join('');
  return `<div class="teacherTodayBoard"><div class="teacherTodayHeader"><div><h3>Mes cours du jour</h3><small>${slots.length} tranche(s) horaire(s) • ${nowLibreville().day}</small></div></div>${rows}</div>`;
}
function renderTeacher(mode='today'){
  const t=teacherById(profile?.role==='teacher'?profile.teacherId:$('teacherSelect').value||selectedTeacher);if(!t)return;
  selectedTeacher=t.id;$('teacherSelect').value=t.id;$('teacherSelect').classList.toggle('hidden',profile?.role==='teacher');
  $('teacherTitle').textContent=mode==='today'?'Mon planning du jour':(profile?.role==='teacher'?'Mon planning de la semaine':t.name);
  $('teacherSubjects').textContent=mode==='today'?'Consultez vos cours et lancez l’appel de chaque classe.':t.subjects.join(' • ');
  $('teacherSchedule').innerHTML=mode==='today'?renderTeacherTodayBoard(t):scheduleMarkup(t.schedule,false);
  $('teacherTodayBtn').classList.toggle('active',mode==='today');$('teacherWeekBtn').classList.toggle('active',mode==='week');
  renderTeacherAbsence(t);
  if(mode==='today')document.querySelectorAll('[data-call]').forEach(b=>b.onclick=()=>openStudentCall(b.dataset.call));
}
function openStudentCall(callKey){
  const slot=teacherSlotCache[callKey];if(!slot)return;
  const info=callForSlot(slot),roster=rosterForClass(slot.className);
  const statuses={};
  roster.forEach(x=>statuses[x.id]=info.record?.students?.[x.id]||'present');
  currentCall={slot,statuses,baseRecord:info.record||null};
  $('callTitle').textContent=`Appel — ${slot.className}`;
  $('callSubtitle').textContent=`${slot.subject} • ${slot.start}–${slot.end}`;
  $('callTimeLabel').textContent=info.record?.calledAt||'À faire';
  $('callSearch').value='';
  renderCallStudentList();
  $('studentCallModal').classList.add('show');
}
function renderCallStudentList(){
  if(!currentCall)return;
  const q=($('callSearch').value||'').trim().toLowerCase(),roster=rosterForClass(currentCall.slot.className);
  const filtered=roster.filter(x=>!q||x.name.toLowerCase().includes(q));
  $('callStudentList').innerHTML=filtered.map((x,i)=>{
    const st=currentCall.statuses[x.id]||'present';
    const initials=x.name.split(/[- ]/).map(v=>v[0]).join('').slice(0,2).toUpperCase();
    return `<div class="callStudentRow"><div class="studentNameCell"><span class="studentAvatar">${initials}</span><span>${i+1}. ${esc(x.name)}</span></div>
      <button class="attendanceToggle ${st==='present'?'active present':''}" data-sid="${x.id}" data-state="present">✓ Présent</button>
      <button class="attendanceToggle ${st==='absent'?'active absent':''}" data-sid="${x.id}" data-state="absent">✕ Absent</button></div>`;
  }).join('');
  document.querySelectorAll('.attendanceToggle').forEach(b=>b.onclick=()=>{
    currentCall.statuses[b.dataset.sid]=b.dataset.state;renderCallStudentList();
  });
  const counts=callCounts({students:currentCall.statuses});
  $('callPresentCount').textContent=counts.present;$('callAbsentCount').textContent=counts.absent;
}
function closeStudentCall(){$('studentCallModal').classList.remove('show');currentCall=null}
async function finishStudentCall(){
  if(!currentCall)return;
  const slot=currentCall.slot,record={
    calledAt:nowLibreville().time,teacherId:slot.teacherId,teacherName:slot.teacherName,
    className:slot.className,subject:slot.subject,start:slot.start,end:slot.end,
    students:{...currentCall.statuses}
  };
  const ck=safeKey(slot.className);
  if(!studentAttendance[ck])studentAttendance[ck]={};
  studentAttendance[ck][slot.callKey]=record;
  localStorage.setItem(STUDENT_ATT_KEY,JSON.stringify(studentAttendance));
  await syncStudentCall(slot,record);
  closeStudentCall();renderTeacher('today');
  if(profile?.role==='direction')renderDirectionStudentAttendance();
}
function renderDirectionStudentAttendance(){
  const el=$('directionStudentAttendance');if(!el)return;
  if(profile?.role!=='direction'){el.innerHTML='';return}
  let present=0,absent=0,calledClasses=0;const absentees=[];
  classNames.forEach(c=>{
    const calls=classCalls(c),records=Object.values(calls);
    if(!records.length)return;
    records.sort((a,b)=>String(a.calledAt||'').localeCompare(String(b.calledAt||'')));
    const rec=records[records.length-1];calledClasses++;
    const roster=rosterForClass(c);
    roster.forEach(st=>{
      const v=rec.students?.[st.id];
      if(v==='present')present++;
      if(v==='absent'){absent++;absentees.push(`${st.name} • ${c}`)}
    });
  });
  el.innerHTML=`<div class="directionAttendanceSummary"><div class="eyebrow">PRÉSENCE DES ÉLÈVES • AUJOURD’HUI</div><h3>Suivi des appels de classe</h3>
    <div class="studentStatRow"><div class="studentStat present"><span>Présents</span><b>${present}</b></div><div class="studentStat absent"><span>Absents</span><b>${absent}</b></div><div class="studentStat pending"><span>Classes appelées</span><b>${calledClasses}/${classNames.length}</b></div></div>
    ${absentees.length?`<div class="absenteeList">${absentees.slice(0,20).map(x=>`<span class="absenteeTag">${esc(x)}</span>`).join('')}</div>`:'<p class="muted">Aucune absence élève enregistrée pour le moment.</p>'}
  </div>`;
}
function prepareStudent(){
  if(profile?.role==='direction'){
    renderDirectionStudentAttendance();
    studentPreview=null;$('directorStudentLogin').style.display='grid';$('studentProfileContent').style.display='none';$('directorStudentName').value='';$('directorStudentClass').value='';return;
  }
  $('directionStudentAttendance').innerHTML='';
  $('directorStudentLogin').style.display='none';$('studentProfileContent').style.display='block';renderStudent('today');
}
function parentTodayMarkup(className,childId,childName){
  const slots=classTodaySlots(className);
  if(!slots.length)return'<div class="empty">Aucun cours prévu aujourd’hui.</div>';
  return `<div class="parentChildBanner"><div><b>${esc(childName)}</b><span>${esc(className)}</span></div><strong>Suivi du jour</strong></div>
  <section class="dayBlock"><div class="dayHead"><b>${nowLibreville().day}</b><span>Aujourd’hui</span></div>
  ${slots.map(slot=>{
    const info=callForSlot(slot),state=info.record?.students?.[childId],time=info.record?.calledAt||'';
    let badge='<span class="childPresence pending">À venir</span>';
    if(state==='present')badge=`<span class="childPresence present">✓ Présent • ${esc(time)}</span>`;
    if(state==='absent')badge=`<span class="childPresence absent">✕ Absent • ${esc(time)}</span>`;
    return `<div class="parentAttendanceRow"><time>${slot.start}–${slot.end}</time><div><strong>${esc(slot.subject)}</strong><small>${esc(slot.teacherName)}</small></div>${badge}</div>`;
  }).join('')}</section>`;
}
function prepareParent(){
  if(profile?.role==='direction'){
    parentPreview=null;$('directorParentLogin').style.display='grid';$('parentProfileContent').style.display='none';$('directorParentName').value='';$('directorParentClass').value='';return;
  }
  $('directorParentLogin').style.display='none';$('parentProfileContent').style.display='block';
  $('parentClassSelect').value=profile.className;
  $('parentClassSelect').style.display=profile?.role==='parent'?'none':'block';
  $('parentIdentity').textContent=profile?.role==='parent'?`${profile.childName} • ${profile.className} — présence en classe et heure de l’appel.`:'Les cours de la classe, avec les horaires et les professeurs.';
  renderParent('today');
}
function renderParent(mode='today'){
  const c=profile?.role==='parent'?profile.className:($('parentClassSelect').value||(profile?.role==='direction'?parentPreview?.className:profile?.className));
  if(!c)return;
  $('parentClassSelect').value=c;
  $('parentSchedule').innerHTML=(profile?.role==='parent'&&mode==='today')
    ?parentTodayMarkup(c,profile.childId,profile.childName)
    :classMarkup(c,mode==='today'?nowLibreville().day:null);
  $('parentTodayBtn').classList.toggle('active',mode==='today');
  $('parentWeekBtn').classList.toggle('active',mode==='week');
}
function wire(){
  document.querySelectorAll('.profileChoice').forEach(b=>b.onclick=()=>openRoleLogin(b.dataset.profile));
  document.querySelectorAll('.backProfiles').forEach(b=>b.onclick=showProfileChooser);
  $('directionLoginBtn').onclick=loginDirection;$('studentLoginBtn').onclick=loginStudent;$('parentLoginBtn').onclick=loginParent;
  $('parentLoginClass').onchange=populateParentChildren;
  $('profLoginSearch').oninput=()=>renderTeacherLoginList($('profLoginSearch').value);
  $('logoutBtn').onclick=logout;
  document.querySelectorAll('.role').forEach(b=>b.onclick=()=>activate(b.dataset.view));
  $('directionSearch').onchange=renderStaff;
  document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderStaff()});
  $('teacherSelect').onchange=()=>renderTeacher('today');
  $('teacherTodayBtn').onclick=()=>renderTeacher('today');$('teacherWeekBtn').onclick=()=>renderTeacher('week');
  $('directionClassToday').onclick=()=>renderDirectionClass('today');$('directionClassWeek').onclick=()=>renderDirectionClass('week');$('directionClassSelect').onchange=()=>renderDirectionClass('week');
  $('studentTodayBtn').onclick=()=>renderStudent('today');$('studentWeekBtn').onclick=()=>renderStudent('week');
  $('parentTodayBtn').onclick=()=>renderParent('today');$('parentWeekBtn').onclick=()=>renderParent('week');$('parentClassSelect').onchange=()=>renderParent('week');
  $('directorStudentEnter').onclick=()=>{const name=$('directorStudentName').value.trim(),className=$('directorStudentClass').value;if(!name||!className)return;studentPreview={name,className};$('directorStudentLogin').style.display='none';$('studentProfileContent').style.display='block';renderStudent('week')};
  $('directorParentEnter').onclick=()=>{const name=$('directorParentName').value.trim(),className=$('directorParentClass').value;if(!name||!className)return;parentPreview={name,className};$('directorParentLogin').style.display='none';$('parentProfileContent').style.display='block';$('parentClassSelect').style.display='block';$('parentClassSelect').value=className;renderParent('week')};
  $('callClose').onclick=closeStudentCall;$('callCancel').onclick=closeStudentCall;$('callFinish').onclick=finishStudentCall;$('callSearch').oninput=renderCallStudentList;
  $('settingsBtn').onclick=()=>$('settingsModal').classList.add('show');$('settingsClose').onclick=()=>$('settingsModal').classList.remove('show');
  $('settingsTeacher').onchange=updateSettingsTeacherCode;
  $('resetDemoBtn').onclick=async()=>{if(!confirm('Réinitialiser la démo ? Les présences repasseront à confirmer, tous les professeurs seront hors ligne, les appels élèves et les remplacements seront supprimés.'))return;attendance={};connections={};studentAttendance={};localStorage.setItem(ATT_KEY,'{}');localStorage.setItem(STUDENT_ATT_KEY,'{}');saveConnections();await resetFirebaseDemo();renderDirection();renderDirectionStudentAttendance();$('resetDemoBtn').textContent='✓ Démo réinitialisée';setTimeout(()=>$('resetDemoBtn').textContent='↻ Réinitialiser la démo',1400)};
}
function boot(){
  initOptions();wire();renderTeacherLoginList();
  setInterval(()=>{if(profile?.role==='direction')renderDirection()},60000);
  setTimeout(()=>$('splash').classList.add('hide'),1650);
  try{profile=JSON.parse(localStorage.getItem(PROFILE_KEY)||'null')}catch(e){profile=null}
  initFirebase().then(ok=>{if(ok&&profile?.role==='teacher'&&profile.teacherId)markTeacherOnline(profile.teacherId)});
  if(profile)applyProfile();else showProfileChooser();
}
window.addEventListener('storage',e=>{
  if(e.key===STUDENT_ATT_KEY){try{studentAttendance=JSON.parse(e.newValue||'{}')}catch(_){studentAttendance={}};refreshLiveUI()}
});

boot();
})();