import { initializeApp }            from “https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js”;
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile }
from “https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js”;
import { getFirestore, doc, setDoc, getDoc, updateDoc, addDoc, deleteDoc,
collection, query, where, orderBy, onSnapshot, getDocs,
serverTimestamp, increment, limit }
from “https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js”;

// ── Firebase Config ──
const app  = initializeApp({
apiKey:“AIzaSyDE4KSopK_w6A2_ex7-hP0GrAel5Qx_E7o”,
authDomain:“webook-c6485.firebaseapp.com”,
projectId:“webook-c6485”,
storageBucket:“webook-c6485.firebasestorage.app”,
messagingSenderId:“571719069521”,
appId:“1:571719069521:web:499ca4529192160223ad70”
});
// ⚠️ مهم: في Firebase Console → Storage → Rules، أضف هذا:
// rules_version = ‘2’;
// service firebase.storage {
//   match /b/{bucket}/o {
//     match /{allPaths=**} {
//       allow read, write: if request.auth != null;
//     }
//   }
// }
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Global State ──
const G = {
auth, db,
user: null,      // Firebase Auth user
userData: null,  // Firestore user doc
page: ‘feed-page’,
theme: localStorage.getItem(‘wb-theme’) || ‘light’,
isAdmin: false,
unsubs: {},      // active listeners
currentChatId: null,
currentChatOtherUid: null,
pubProfileUid: null,
currentPostId: null, // for comments
npImgData: null,
nrVideoFile: null,
epAvData: null,
nsImgData: null,
profileTab: ‘posts’,
allMyPosts: [],
allMySaved: [],
};
window.G = G;

// ── Cloudinary Config (مجاني 25GB) ──
const CLOUDINARY = {
cloudName: ‘dooaagbr8’,
uploadPreset: ‘ml_default’, // غيّره لـ Unsigned من Cloudinary Settings
};

async function uploadToCloudinary(file, type=‘video’){
const formData = new FormData();
formData.append(‘file’, file);
formData.append(‘upload_preset’, CLOUDINARY.uploadPreset);
formData.append(‘cloud_name’, CLOUDINARY.cloudName);
const res = await fetch(
`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/${type}/upload`,
{ method:‘POST’, body:formData }
);
if(!res.ok){
const err = await res.json();
throw new Error(err.error?.message || ‘Cloudinary upload failed’);
}
const data = await res.json();
return { url: data.secure_url, thumbnail: data.secure_url.replace(/.[^.]+$/, ‘.jpg’) };
}
function compressImg(file, maxPx=1080, quality=.8) {
return new Promise(res => {
const r = new FileReader();
r.onload = e => {
const img = new Image();
img.onload = () => {
const c = document.createElement(‘canvas’);
let w=img.width, h=img.height;
if(w>maxPx){h=h*maxPx/w;w=maxPx;}
if(h>maxPx){w=w*maxPx/h;h=maxPx;}
c.width=w; c.height=h;
c.getContext(‘2d’).drawImage(img,0,0,w,h);
res(c.toDataURL(‘image/jpeg’, quality));
};
img.src = e.target.result;
};
r.readAsDataURL(file);
});
}

// ── Splash Screen Logic ──
function hideSplash(callback) {
const splash = document.getElementById(‘splash-screen’);
splash.classList.add(‘hidden’);
setTimeout(() => { splash.style.display = ‘none’; if(callback) callback(); }, 650);
}

// ── Auth State ──
onAuthStateChanged(auth, async user => {
if(user) {
G.user = user;
try {
let snap = await getDoc(doc(db,‘wb_users’,user.uid));
// إذا لم يوجد document للمستخدم أنشئه تلقائياً
if(!snap.exists()) {
const fallbackName = user.displayName || user.email?.split(’@’)[0] || ‘مستخدم’;
await setDoc(doc(db,‘wb_users’,user.uid),{
uid:user.uid,
name:fallbackName,
username:fallbackName.toLowerCase().replace(/\s+/g,’_’),
email:user.email||’’,
avatar:’’, bio:’’, link:’’,
followers:0, following:0, posts:0,
isPrivate:false, isVerified:false, isAdmin:false,
blockedUsers:[], mutedUsers:[],
createdAt:serverTimestamp()
});
snap = await getDoc(doc(db,‘wb_users’,user.uid));
}
G.userData = snap.data();
applyTheme(G.theme);
// مستخدم مسجّل — أخفِ الـ splash ثم افتح التطبيق مباشرة
hideSplash(() => {
showApp();
loadFeed();
loadStories();
loadExplore();
listenNotifs();
listenMsgBadge();
listenIncomingCalls();
getDoc(doc(db,‘wb_settings’,‘newsbot’)).then(s=>{
if(s.exists()&&s.data().enabled&&!_botRunning) startBotSchedule(s.data().intervalHours||1);
}).catch(()=>{});
});
// مراقبة تغييرات بيانات المستخدم
if(G.unsubs.userData) G.unsubs.userData();
G.unsubs.userData = onSnapshot(doc(db,‘wb_users’,user.uid), udSnap=>{
if(udSnap.exists()) G.userData = udSnap.data();
});
} catch(e) {
console.error(‘خطأ في تحميل بيانات المستخدم:’, e);
G.userData = { name: user.displayName||‘مستخدم’, username:‘user’, email:user.email||’’, avatar:’’, bio:’’, followers:0, following:0, posts:0 };
applyTheme(G.theme);
hideSplash(() => { showApp(); loadFeed(); });
}
} else {
G.user = null; G.userData = null;
// غير مسجّل — أظهر الـ splash ثانيتين ثم صفحة الدخول
setTimeout(() => {
hideSplash(() => {
document.getElementById(‘auth-screen’).classList.remove(‘hidden’);
});
}, 2000);
// أعد تعيين الأزرار
const lb=document.getElementById(‘l-btn’); if(lb){lb.textContent=‘دخول’;lb.disabled=false;}
const rb=document.getElementById(‘r-btn’); if(rb){rb.textContent=‘إنشاء الحساب’;rb.disabled=false;}
}
});

// ══════════════════════════════
// AUTH
// ══════════════════════════════
window.switchTab = t => {
document.querySelectorAll(’.auth-tab’).forEach((b,i)=>b.classList.toggle(‘active’,(i===0&&t===‘login’)||(i===1&&t===‘reg’)));
document.getElementById(‘login-f’).style.display = t===‘login’ ? ‘block’:‘none’;
document.getElementById(‘reg-f’).style.display   = t===‘reg’   ? ‘block’:‘none’;
};
// ── ntfy.sh Notifications ──
async function sendNtfy(title, message, tags=’’, channel=‘webookwelcome’){
try{
// إرسال بدون Content-Type لتجاوز CORS preflight
await fetch(`https://ntfy.sh/${channel}`, {
method: ‘POST’,
mode: ‘no-cors’,
body: JSON.stringify({
topic: channel,
title: title,
message: message,
tags: tags ? tags.split(’,’) : [],
priority: 3
}),
headers: { ‘Content-Type’: ‘application/json’ }
});
}catch(e){ console.log(‘ntfy error:’,e); }
}

window.doLogin = async () => {
const email=document.getElementById(‘l-email’).value.trim();
const pass=document.getElementById(‘l-pass’).value;
if(!email||!pass){return authErr(‘أدخل البريد وكلمة المرور’);}
const btn=document.getElementById(‘l-btn’); btn.textContent=‘جاري…’; btn.disabled=true;
try{
const cred = await signInWithEmailAndPassword(auth,email,pass);
// إشعار تسجيل دخول
const uSnap = await getDoc(doc(db,‘wb_users’,cred.user.uid)).catch(()=>null);
const uName = uSnap?.data()?.name || email;
sendNtfy(‘🔑 تسجيل دخول — Webook’, `المستخدم: ${uName}\nالبريد: ${email}\nالوقت: ${new Date().toLocaleString('ar')}`, ‘key’);
// onAuthStateChanged سيتولى الباقي
} catch(e){
btn.textContent=‘دخول’; btn.disabled=false;
if(e.code===‘auth/user-not-found’||e.code===‘auth/invalid-credential’||e.code===‘auth/wrong-password’){
authErr(‘البريد أو كلمة المرور غير صحيحة’);
} else if(e.code===‘auth/too-many-requests’){
authErr(‘محاولات كثيرة، انتظر قليلاً’);
} else if(e.code===‘auth/network-request-failed’){
authErr(‘تحقق من الاتصال بالإنترنت’);
} else {
authErr(‘خطأ في تسجيل الدخول: ‘+e.message);
}
}
};
window.doRegister = async () => {
const name=document.getElementById(‘r-name’).value.trim();
const username=document.getElementById(‘r-username’).value.trim().replace(’@’,’’).toLowerCase().replace(/\s+/g,’*’);
const email=document.getElementById(‘r-email’).value.trim();
const pass=document.getElementById(‘r-pass’).value;
if(!name||!username||!email||!pass){return authErr(‘أكمل جميع الحقول’);}
if(pass.length<6){return authErr(‘كلمة المرور 6 أحرف على الأقل’);}
if(!/^[a-z0-9*]+$/.test(username)){return authErr(‘اسم المستخدم: أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط’);}
if(username.length<3){return authErr(‘اسم المستخدم 3 أحرف على الأقل’);}

const btn=document.getElementById(‘r-btn’); btn.textContent=‘جاري التحقق…’; btn.disabled=true;

try{
// ── فحص تكرار اليوزر ──
const usernameCheck=await getDocs(query(collection(db,‘wb_users’),where(‘username’,’==’,username)));
if(!usernameCheck.empty){
btn.textContent=‘إنشاء الحساب’; btn.disabled=false;
return authErr(`❌ اسم المستخدم @${username} مأخوذ — اختر اسماً آخر`);
}

```
btn.textContent='جاري الإنشاء...';
// 1. إنشاء الحساب في Firebase Auth
const cred = await createUserWithEmailAndPassword(auth,email,pass);
// 2. حفظ البيانات في Firestore
const userData = {
  uid:cred.user.uid, name, username, email,
  avatar:'', bio:'', link:'',
  followers:0, following:0, posts:0,
  isPrivate:false, isVerified:false, isAdmin:false,
  blockedUsers:[], mutedUsers:[],
  createdAt:serverTimestamp()
};
try {
  await setDoc(doc(db,'wb_users',cred.user.uid), userData);
} catch(dbErr) {
  await new Promise(r=>setTimeout(r,1500));
  await setDoc(doc(db,'wb_users',cred.user.uid), userData);
}
// إشعار تسجيل حساب جديد
sendNtfy('🎉 حساب جديد — Webook', `الاسم: ${name}\nاليوزر: @${username}\nالبريد: ${email}\nالوقت: ${new Date().toLocaleString('ar')}`, 'tada,new');
```

} catch(e){
btn.textContent=‘إنشاء الحساب’; btn.disabled=false;
if(e.code===‘auth/email-already-in-use’) authErr(‘البريد مستخدم بالفعل — جرب تسجيل الدخول’);
else if(e.code===‘auth/invalid-email’) authErr(‘البريد الإلكتروني غير صحيح’);
else if(e.code===‘auth/weak-password’) authErr(‘كلمة المرور ضعيفة جداً’);
else authErr(‘خطأ: ‘+e.message);
}
};
window.doLogout = async () => {
if(!confirm(‘هل تريد تسجيل الخروج؟’))return;
// إيقاف كل المستمعين
Object.values(G.unsubs||{}).forEach(fn=>{ try{ if(typeof fn===‘function’) fn(); }catch(e){} });
G.unsubs={};
// إيقاف المكالمة إن كانت نشطة
if(CALL?.roomId) endCall().catch(()=>{});
// إيقاف observer الريلز
if(G._reelObserver){ G._reelObserver.disconnect(); G._reelObserver=null; }
G.user=null; G.userData=null;
document.getElementById(‘main-hdr’).style.display=‘none’;
document.getElementById(‘stories-wrap’).style.display=‘none’;
document.getElementById(‘bnav’).style.display=‘none’;
document.querySelectorAll(’.page’).forEach(p=>p.classList.remove(‘active’));
await signOut(auth);
};
// فحص توفر اليوزر أثناء الكتابة
let _usernameTimer=null;
window.checkUsernameAvail=async(val)=>{
const username=val.trim().replace(’@’,’’).toLowerCase();
const el=document.getElementById(‘username-avail’);
if(!el) return;
clearTimeout(*usernameTimer);
if(!username){ el.style.display=‘none’; return; }
if(username.length<3){
el.style.display=‘block’;
el.innerHTML=’<span style="color:#e67e22">⚠️ اسم المستخدم 3 أحرف على الأقل</span>’;
return;
}
if(!/^[a-z0-9*]+$/.test(username)){
el.style.display=‘block’;
el.innerHTML=’<span style="color:#e74c3c">❌ أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط</span>’;
return;
}
el.style.display=‘block’;
el.innerHTML=’<span style="color:#6b7a5a">🔍 جاري التحقق…</span>’;
_usernameTimer=setTimeout(async()=>{
try{
const snap=await getDocs(query(collection(db,‘wb_users’),where(‘username’,’==’,username)));
if(snap.empty){
el.innerHTML=`<span style="color:#27ae60">✅ @${username} متاح!</span>`;
} else {
el.innerHTML=`<span style="color:#e74c3c">❌ @${username} مأخوذ — اختر اسماً آخر</span>`;
}
}catch(e){ el.style.display=‘none’; }
},600);
};

function authErr(msg){const el=document.getElementById(‘auth-err’);el.textContent=msg;el.style.display=‘block’;setTimeout(()=>el.style.display=‘none’,3500);}

window.doResetPass = async () => {
const email = document.getElementById(‘l-email’).value.trim();
if(!email){ return authErr(‘أدخل بريدك الإلكتروني أولاً’); }
try{
const { sendPasswordResetEmail } = await import(“https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js”);
await sendPasswordResetEmail(auth, email);
alert(‘✅ تم إرسال رابط إعادة تعيين كلمة المرور لبريدك’);
} catch(e){
authErr(‘خطأ: تحقق من البريد الإلكتروني’);
}
};

// ══════════════════════════════
// APP INIT
// ══════════════════════════════
function showApp(){
document.getElementById(‘auth-screen’).classList.add(‘hidden’);
document.getElementById(‘main-hdr’).style.display=‘flex’;
document.getElementById(‘stories-wrap’).style.display=‘block’;
document.getElementById(‘bnav’).style.display=‘flex’;
// Admin
if(G.userData?.isAdmin){G.isAdmin=true;document.getElementById(‘admin-hbtn’).style.display=‘flex’;}
goPage(‘feed-page’);
}

// ══════════════════════════════
// NAVIGATION
// ══════════════════════════════
window.goPage = (pageId) => {
document.querySelectorAll(’.page’).forEach(p=>p.classList.remove(‘active’));
document.getElementById(pageId)?.classList.add(‘active’);
document.querySelectorAll(’.bn’).forEach(b=>b.classList.remove(‘active’));
const map={
‘feed-page’:‘bn-feed’,‘reels-page’:‘bn-reels’,
‘friends-page’:‘bn-friends’,‘search-page’:‘bn-search-nav’,‘profile-page’:‘bn-profile’,
‘messages-page’:null,‘notif-page’:null,‘settings-page’:null,‘explore-page’:null
};
if(map[pageId]) document.getElementById(map[pageId])?.classList.add(‘active’);
document.getElementById(‘stories-wrap’).style.display = pageId===‘feed-page’ ? ‘block’:‘none’;
// FAB نشر ريل
const fab = document.getElementById(‘new-reel-fab’);
if(fab) fab.style.display = pageId===‘reels-page’ ? ‘block’:‘none’;
// إيقاف فيديوهات الريلز عند مغادرة الصفحة
if(pageId!==‘reels-page’){
document.querySelectorAll(’#reels-list video’).forEach(v=>v.pause());
}
G.page = pageId;
if(pageId===‘profile-page’) loadMyProfile();
if(pageId===‘messages-page’) loadChats();
if(pageId===‘friends-page’) loadFriendsPage();
if(pageId===‘notif-page’) markNotifsRead();
if(pageId===‘settings-page’) loadSettingsPage();
if(pageId===‘reels-page’){ loadReels(); setTimeout(setupReelAutoplay, 500); }
};

// ══════════════════════════════
// THEME
// ══════════════════════════════
function applyTheme(t){
G.theme = t;
localStorage.setItem(‘wb-theme’, t);
const isDark = t===‘dark’ || (t===‘auto’ && window.matchMedia(’(prefers-color-scheme:dark)’).matches);
document.body.classList.toggle(‘dark’, isDark);
document.getElementById(‘dark-btn’).innerHTML = isDark ? ‘<i class="fas fa-sun"></i>’ : ‘<i class="fas fa-moon"></i>’;
[‘th-light’,‘th-dark’,‘th-auto’].forEach(id=>document.getElementById(id)?.classList.remove(‘active’));
document.getElementById(‘th-’+t)?.classList.add(‘active’);
}
window.toggleDark = () => applyTheme(G.theme===‘dark’?‘light’:‘dark’);
window.setTheme = t => applyTheme(t);
applyTheme(G.theme);

// ══════════════════════════════
// STORIES
// ══════════════════════════════
function loadStories(){
const scroll = document.getElementById(‘stories-scroll’);
while(scroll.children.length > 1) scroll.removeChild(scroll.lastChild);
const yesterday = new Date(Date.now()-24*60*60*1000);
const q = query(collection(db,‘wb_stories’));
if(G.unsubs.stories) G.unsubs.stories();
G.unsubs.stories = onSnapshot(q, snap => {
SV.groups = buildStoryGroups(snap);
while(scroll.children.length > 1) scroll.removeChild(scroll.lastChild);

```
// فلتر 24 ساعة
let recentGroups = SV.groups.filter(g =>
  g.stories.some(s => (s.createdAt?.seconds||0)*1000 > yesterday.getTime())
);

// ترتيب: الموثّقون أولاً، ثم الباقون حسب آخر قصة
recentGroups.sort((a, b) => {
  if(a.verified && !b.verified) return -1;
  if(!a.verified && b.verified) return 1;
  const aTime = Math.max(...a.stories.map(s=>s.createdAt?.seconds||0));
  const bTime = Math.max(...b.stories.map(s=>s.createdAt?.seconds||0));
  return bTime - aTime;
});

SV.groups = recentGroups;

recentGroups.forEach(group => {
  const firstStory = group.stories[0];
  const isVerified = group.verified || false;
  const btn = document.createElement('button');
  btn.className = 'story-item';
  btn.onclick = () => openSV(firstStory);
  btn.innerHTML = `
    <div class="story-ring unseen${isVerified?' verified-ring':''}">
      <div class="story-av">${group.avatar?`<img src="${group.avatar}">`:(group.name?.[0]||'م')}</div>
      ${isVerified?'<div class="story-vbadge"><i class="fas fa-check"></i></div>':''}
    </div>
    <span class="story-name">${group.name||'مستخدم'}</span>`;
  scroll.appendChild(btn);
});
```

}, err => console.error(‘Stories error:’, err));
}

window.previewStoryImg = async (input) => {
const file = input.files[0]; if(!file) return;
G.nsImgData = await compressImg(file, 1080, .85);
document.getElementById(‘ns-img-prev’).src = G.nsImgData;
document.getElementById(‘ns-img-wrap’).style.display = ‘block’;
};
window.clearStoryImg = () => { G.nsImgData=null; document.getElementById(‘ns-img-wrap’).style.display=‘none’; };
// خصوصية القصة
let _storyPrivacy = ‘public’;
window.setStoryPrivacy = (val) => {
_storyPrivacy = val;
const pubBtn = document.getElementById(‘ns-priv-public’);
const friBtn = document.getElementById(‘ns-priv-friends’);
if(!pubBtn||!friBtn) return;
if(val === ‘public’){
pubBtn.style.background=’#5c7a4e’; pubBtn.style.color=’#fff’; pubBtn.style.borderColor=’#5c7a4e’;
friBtn.style.background=‘transparent’; friBtn.style.color=’#6b7a5a’; friBtn.style.borderColor=‘rgba(92,122,78,.3)’;
} else {
friBtn.style.background=’#5c7a4e’; friBtn.style.color=’#fff’; friBtn.style.borderColor=’#5c7a4e’;
pubBtn.style.background=‘transparent’; pubBtn.style.color=’#6b7a5a’; pubBtn.style.borderColor=‘rgba(92,122,78,.3)’;
}
};

window.submitStory = async () => {
const text = document.getElementById(‘ns-text’).value.trim();
if(!text && !G.nsImgData) return;
const u=G.user, ud=G.userData;
try {
await addDoc(collection(db,‘wb_stories’),{
text, imageUrl:G.nsImgData||’’,
privacy: _storyPrivacy,
authorId:u.uid, authorName:ud.name,
authorAvatar:ud.avatar||’’,
authorVerified:ud.isVerified||false,
authorIsAdmin:ud.isAdmin||false,
createdAt:serverTimestamp()
});
// ntfy إشعار قصة جديدة
sendNtfy(‘⭕ قصة جديدة — Webook’, `${ud.name} (@${ud.username||''})\n${text.substring(0,100)||'(صورة فقط)'}`, ‘fire’, ‘wepost’);
document.getElementById(‘ns-text’).value=’’;
G.nsImgData=null;
document.getElementById(‘ns-img-wrap’).style.display=‘none’;
_storyPrivacy = ‘public’;
setStoryPrivacy(‘public’);
closeOverlay(‘new-story-overlay’);
} catch(e){ alert(’خطأ: ’+e.message); }
};

// صفحة الأصدقاء
let _friendsTab = ‘requests’;
window.switchFriendsTab = (tab) => {
_friendsTab = tab;
[‘requests’,‘suggestions’,‘following’].forEach(t => {
const btn = document.getElementById(‘tab-’+t);
if(btn){
btn.style.borderBottom = t===tab ? ‘2.5px solid #5c7a4e’ : ‘none’;
btn.style.color = t===tab ? ‘#3d5236’ : ‘#6b7a5a’;
btn.style.fontWeight = t===tab ? ‘800’ : ‘600’;
}
});
loadFriendsContent(tab);
};

async function loadFriendsPage(){
switchFriendsTab(‘requests’);
}

async function loadFriendsContent(tab){
const cont = document.getElementById(‘friends-content’);
if(!cont) return;
cont.innerHTML = ‘<div class="spin" style="padding:30px"><i class="fas fa-circle-notch"></i></div>’;
try{
if(tab === ‘requests’){
// طلبات المتابعة المعلقة
const snap = await getDocs(query(collection(db,‘wb_follow_requests’),where(‘toUserId’,’==’,G.user.uid),where(‘status’,’==’,‘pending’)));
const reqs = []; snap.forEach(d=>reqs.push({id:d.id,…d.data()}));
if(!reqs.length){ cont.innerHTML=’<div class="empty"><i class="fas fa-user-clock"></i><p>لا توجد طلبات متابعة</p></div>’; return; }
cont.innerHTML = ‘’;
reqs.forEach(r => {
const el = document.createElement(‘div’);
el.style.cssText = ‘display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML = ` <div style="width:46px;height:46px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:1rem;flex-shrink:0"> ${r.fromUserAvatar?`<img src="${r.fromUserAvatar}" style="width:100%;height:100%;object-fit:cover">`:r.fromUserName?.[0]||'م'} </div> <div style="flex:1"><div style="font-weight:700;font-size:.9rem">${r.fromUserName}</div><div style="font-size:.75rem;color:#6b7a5a">يريد متابعتك</div></div> <div style="display:flex;gap:6px"> <button onclick="acceptFollowReq('${r.id}','${r.fromUserId}',this.parentElement.parentElement)" class="btn-primary" style="padding:7px 14px;font-size:.8rem">قبول</button> <button onclick="rejectFollowReq('${r.id}',this.parentElement.parentElement)" class="btn-secondary" style="padding:7px 14px;font-size:.8rem">رفض</button> </div>`;
cont.appendChild(el);
});
} else if(tab === ‘suggestions’){
// مقترحون — أحدث المستخدمين غير المتابَعين
const [usersSnap, followsSnap] = await Promise.all([
getDocs(collection(db,‘wb_users’)),
getDocs(query(collection(db,‘wb_follows’),where(‘followerId’,’==’,G.user.uid)))
]);
const following = new Set(); followsSnap.forEach(d=>following.add(d.data().followingId));
const users = []; usersSnap.forEach(d=>{
const u=d.data();
if(u.uid !== G.user.uid && !following.has(u.uid)) users.push(u);
});
users.sort(()=>Math.random()-.5);
const shown = users.slice(0,10);
if(!shown.length){ cont.innerHTML=’<div class="empty"><i class="fas fa-users"></i><p>لا يوجد مقترحون حالياً</p></div>’; return; }
cont.innerHTML = ‘’;
shown.forEach(u => {
const el = document.createElement(‘div’);
el.style.cssText = ‘display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML = ` <div onclick="openPubProfile('${u.uid}')" style="width:46px;height:46px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:1rem;flex-shrink:0;cursor:pointer"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:u.name?.[0]||'م'} </div> <div style="flex:1;cursor:pointer" onclick="openPubProfile('${u.uid}')"> <div style="font-weight:700;font-size:.9rem">${u.name} ${u.isVerified?'✅':''}</div> <div style="font-size:.75rem;color:#6b7a5a">@${u.username||''} · ${u.followers||0} متابع</div> </div> <button onclick="quickFollow('${u.uid}',this)" style="padding:7px 16px;border-radius:20px;border:1.5px solid #5c7a4e;background:transparent;color:#5c7a4e;font-family:Cairo,sans-serif;font-weight:700;font-size:.8rem;cursor:pointer">متابعة</button>`;
cont.appendChild(el);
});
} else if(tab === ‘following’){
// المتابَعون
const snap = await getDocs(query(collection(db,‘wb_follows’),where(‘followerId’,’==’,G.user.uid)));
const ids = []; snap.forEach(d=>ids.push(d.data().followingId));
if(!ids.length){ cont.innerHTML=’<div class="empty"><i class="fas fa-heart"></i><p>لا تتابع أحداً بعد</p></div>’; return; }
cont.innerHTML = ‘’;
for(const uid of ids.slice(0,20)){
const uSnap = await getDoc(doc(db,‘wb_users’,uid));
if(!uSnap.exists()) continue;
const u = uSnap.data();
const el = document.createElement(‘div’);
el.style.cssText = ‘display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML = ` <div onclick="openPubProfile('${uid}')" style="width:46px;height:46px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0;cursor:pointer"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:u.name?.[0]||'م'} </div> <div style="flex:1;cursor:pointer" onclick="openPubProfile('${uid}')"> <div style="font-weight:700;font-size:.9rem">${u.name} ${u.isVerified?'✅':''}</div> <div style="font-size:.75rem;color:#6b7a5a">@${u.username||''}</div> </div> <button onclick="quickUnfollow('${uid}',this)" style="padding:7px 14px;border-radius:20px;border:1.5px solid rgba(92,122,78,.3);background:rgba(92,122,78,.1);color:#5c7a4e;font-family:Cairo,sans-serif;font-weight:700;font-size:.8rem;cursor:pointer">متابَع ✓</button>`;
cont.appendChild(el);
}
}
} catch(e){ cont.innerHTML=`<div class="empty"><i class="fas fa-exclamation-triangle"></i><p>خطأ: ${e.message}</p></div>`; }
}

window.acceptFollowReq=async(reqId,fromUid,el)=>{
try{
await updateDoc(doc(db,‘wb_follow_requests’,reqId),{status:‘accepted’});
await setDoc(doc(db,‘wb_follows’,`${fromUid}_${G.user.uid}`),{followerId:fromUid,followingId:G.user.uid,createdAt:serverTimestamp()});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{followers:increment(1)});
await updateDoc(doc(db,‘wb_users’,fromUid),{following:increment(1)});
el.style.opacity=’.3’; setTimeout(()=>el.remove(),300);
}catch(err){alert(‘خطأ: ‘+err.message);}
};
window.rejectFollowReq=async(reqId,el)=>{
await updateDoc(doc(db,‘wb_follow_requests’,reqId),{status:‘rejected’});
el.style.opacity=’.3’; setTimeout(()=>el.remove(),300);
};
window.quickFollow=async(uid,btn)=>{
btn.textContent=‘متابَع ✓’; btn.style.background=‘rgba(92,122,78,.1)’;
const chatId=[G.user.uid,uid].sort().join(’_’);
await setDoc(doc(db,‘wb_follows’,`${G.user.uid}_${uid}`),{followerId:G.user.uid,followingId:uid,createdAt:serverTimestamp()});
await updateDoc(doc(db,‘wb_users’,uid),{followers:increment(1)});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{following:increment(1)});
};
window.quickUnfollow=async(uid,btn)=>{
if(!confirm(‘إلغاء المتابعة؟’))return;
btn.textContent=‘متابعة’; btn.style.background=‘transparent’;
await deleteDoc(doc(db,‘wb_follows’,`${G.user.uid}_${uid}`));
await updateDoc(doc(db,‘wb_users’,uid),{followers:increment(-1)});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{following:increment(-1)});
};

// ══════════════════════════════
// STORY VIEWER — Instagram Style
// ══════════════════════════════
const SV = {
groups: [],      // [{uid, stories:[]}]
groupIdx: 0,     // current user index
storyIdx: 0,     // current story index within user
timer: null,
duration: 5000,
};

// Build story groups from snapshot
function buildStoryGroups(snap){
const byUser = {};
snap.forEach(d => {
const s = {id:d.id,…d.data()};
if(!byUser[s.authorId]) byUser[s.authorId] = {uid:s.authorId, name:s.authorName, avatar:s.authorAvatar||’’, verified:s.authorVerified||false, isAdmin:s.authorIsAdmin||false, stories:[]};
byUser[s.authorId].stories.push(s);
});
// Sort each user’s stories oldest→newest
Object.values(byUser).forEach(g => g.stories.sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0)));
return Object.values(byUser);
}

// Open story viewer at specific group
function openSV(story){
// Find which group this story belongs to
const gIdx = SV.groups.findIndex(g => g.uid === story.authorId);
SV.groupIdx = gIdx >= 0 ? gIdx : 0;
SV.storyIdx = 0;
// Find exact story index
if(gIdx >= 0){
const sIdx = SV.groups[gIdx].stories.findIndex(s => s.id === story.id);
if(sIdx >= 0) SV.storyIdx = sIdx;
}
document.getElementById(‘sv’).classList.add(‘open’);
svRender();
}

function svRender(){
const group = SV.groups[SV.groupIdx];
if(!group){ closeSV(); return; }
const story = group.stories[SV.storyIdx];
if(!story){ closeSV(); return; }

// Header
document.getElementById(‘sv-av’).innerHTML = group.avatar
? `<img src="${group.avatar}" style="width:100%;height:100%;object-fit:cover">`
: (group.name?.[0]||‘م’);
document.getElementById(‘sv-name’).innerHTML = (group.name||‘مستخدم’) + vbadge(group.verified) + (group.isAdmin?’<span style="background:#e74c3c;color:#fff;border-radius:6px;padding:1px 5px;font-size:.55rem;font-weight:700;margin-right:2px">أدمن</span>’:’’);
document.getElementById(‘sv-time’).textContent = story.createdAt?.toDate ? timeAgo(story.createdAt.toDate()) : ‘’;

// Progress bars
const progWrap = document.getElementById(‘sv-prog-wrap’);
progWrap.innerHTML = ‘’;
group.stories.forEach((s, i) => {
const bar = document.createElement(‘div’);
bar.className = ‘sv-prog-bar’;
const fill = document.createElement(‘div’);
fill.className = ‘sv-prog-fill’;
fill.id = `sv-fill-${i}`;
// Already seen
fill.style.width = i < SV.storyIdx ? ‘100%’ : ‘0%’;
fill.style.transition = ‘none’;
bar.appendChild(fill);
progWrap.appendChild(bar);
});

// Body
const body = document.getElementById(‘sv-body’);
body.innerHTML = ‘’;
if(story.imageUrl){
const img = document.createElement(‘img’);
img.src = story.imageUrl;
img.className = ‘sv-img’;
body.appendChild(img);
}
if(story.text){
const t = document.createElement(‘div’);
t.className = ‘sv-text’;
t.textContent = story.text;
// Put text over image or standalone
if(story.imageUrl){
t.style.cssText=‘position:absolute;bottom:100px;right:0;left:0;text-align:center;padding:0 20px;font-size:1.1rem;text-shadow:0 2px 8px rgba(0,0,0,.8)’;
}
body.appendChild(t);
}

// Start progress animation
clearTimeout(SV.timer);
const currentFill = document.getElementById(`sv-fill-${SV.storyIdx}`);
if(currentFill){
requestAnimationFrame(()=>{
currentFill.style.transition = `width ${SV.duration}ms linear`;
currentFill.style.width = ‘100%’;
});
}
SV.timer = setTimeout(() => svNav(1), SV.duration);

// تسجيل المشاهدة
const currentStory = group.stories[SV.storyIdx];
if(currentStory) recordStoryView(currentStory.id, group.uid);

// أغلق لوحة المشاهدين دائماً عند الانتقال لأي قصة
const panel = document.getElementById(‘sv-viewers-panel’);
const hint  = document.getElementById(‘sv-viewers-hint’);
if(panel){ panel.style.bottom=’-100%’; setTimeout(()=>{ panel.style.display=‘none’; },350); }

// إظهار/إخفاء عداد المشاهدين
const isOwner = group.uid === G.user?.uid;
if(hint){
hint.style.display = isOwner ? ‘flex’ : ‘none’;
if(isOwner && currentStory){
const countEl = document.getElementById(‘sv-viewers-count’);
getDocs(query(collection(db,‘wb_story_views’),where(‘storyId’,’==’,currentStory.id))).then(s=>{
if(countEl) countEl.textContent = `${s.size} مشاهد`;
});
hint.style.pointerEvents=‘all’;
hint.style.cursor=‘pointer’;
hint.onclick = ()=>openSVViewers(currentStory.id);
}
}
// حفظ القصة الحالية للتعديل/الحذف
SV.currentStoryId = currentStory?.id;
SV.currentStoryData = currentStory;
// إعداد السحب
if(currentStory) setupStorySwipe(currentStory.id, isOwner);
}

// Navigate: dir = 1 (next) or -1 (prev)
window.svNav = (dir) => {
clearTimeout(SV.timer);
const group = SV.groups[SV.groupIdx];
if(!group) { closeSV(); return; }

if(dir === 1){
if(SV.storyIdx < group.stories.length - 1){
SV.storyIdx++;
svRender();
} else {
// Move to next user’s stories
if(SV.groupIdx < SV.groups.length - 1){
SV.groupIdx++;
SV.storyIdx = 0;
svRender();
} else {
closeSV();
}
}
} else {
if(SV.storyIdx > 0){
SV.storyIdx–;
svRender();
} else if(SV.groupIdx > 0){
SV.groupIdx–;
SV.storyIdx = 0;
svRender();
}
// If first story of first user, stay
}
};

// إيقاف مؤقت عند التركيز على حقل الرد
window.svPauseForReply = () => {
clearTimeout(SV.timer);
SV.paused = true;
// أوقف شريط التقدم
const fill = document.getElementById(`sv-fill-${SV.storyIdx}`);
if(fill){
const computed = getComputedStyle(fill).width;
const parent = fill.parentElement;
const pct = parent ? (parseFloat(computed)/parent.offsetWidth*100)+’%’ : fill.style.width;
fill.style.transition = ‘none’;
fill.style.width = pct;
SV._pausedWidth = pct;
}
};

// استئناف بعد الرد
window.svResumeAfterReply = () => {
const inp = document.getElementById(‘sv-reply-inp’);
if(inp && inp.value.trim()) return; // لا تستأنف إذا كان يكتب
SV.paused = false;
const fill = document.getElementById(`sv-fill-${SV.storyIdx}`);
if(fill && SV._pausedWidth){
const pct = parseFloat(SV._pausedWidth);
const remaining = SV.duration * (1 - pct/100);
fill.style.transition = `width ${remaining}ms linear`;
fill.style.width = ‘100%’;
SV.timer = setTimeout(() => svNav(1), remaining);
}
};

// تسجيل مشاهدة القصة
async function recordStoryView(storyId, authorId){
if(!G.user || authorId === G.user.uid) return;
try{
await setDoc(doc(db,‘wb_story_views’,`${storyId}_${G.user.uid}`),{
storyId, viewerId:G.user.uid,
viewerName:G.userData?.name||’’,
viewerAvatar:G.userData?.avatar||’’,
viewerUsername:G.userData?.username||’’,
authorId, viewedAt:serverTimestamp()
});
}catch(e){}
}

// تحميل المشاهدين (للمالك فقط)
async function loadStoryViewers(storyId){
try{
const snap = await getDocs(query(collection(db,‘wb_story_views’),where(‘storyId’,’==’,storyId)));
const viewers = [];
snap.forEach(d=>viewers.push(d.data()));
const list = document.getElementById(‘sv-viewers-list’);
const total = document.getElementById(‘sv-viewers-total’);
if(total) total.textContent = `${viewers.length} مشاهد`;
if(!list) return;
if(!viewers.length){
list.innerHTML=’<div style="color:rgba(255,255,255,.4);text-align:center;padding:30px">لا يوجد مشاهدون بعد</div>’;
return;
}
list.innerHTML=’’;
viewers.forEach(v=>{
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);cursor:pointer’;
el.onclick=()=>{ closeSVViewers(); closeSV(); openPubProfile(v.viewerId); };
el.innerHTML=` <div style="width:42px;height:42px;border-radius:50%;background:#5c7a4e;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff"> ${v.viewerAvatar?`<img src="${v.viewerAvatar}" style="width:100%;height:100%;object-fit:cover">`:(v.viewerName?.[0]||'م')} </div> <div style="flex:1"> <div style="color:#fff;font-weight:700;font-size:.88rem">${v.viewerName||'مستخدم'}</div> <div style="color:rgba(255,255,255,.4);font-size:.72rem">@${v.viewerUsername||''}</div> </div> <i class="fas fa-chevron-left" style="color:rgba(255,255,255,.3);font-size:.75rem"></i>`;
list.appendChild(el);
});
}catch(e){}
}

window.openSVViewers = async(storyId) => {
svPauseForReply();
const panel = document.getElementById(‘sv-viewers-panel’);
panel.style.display=‘block’;
panel.style.bottom=‘0’;
await loadStoryViewers(storyId);
};

window.closeSVViewers = () => {
const panel = document.getElementById(‘sv-viewers-panel’);
panel.style.bottom=’-100%’;
setTimeout(()=>panel.style.display=‘none’, 300);
svResumeAfterReply();
};

// إعداد السحب للأعلى في القصة
function setupStorySwipe(storyId, isOwner){
const sv = document.getElementById(‘sv’);
let startY = 0;
sv.ontouchstart = e => { startY = e.touches[0].clientY; };
sv.ontouchend = e => {
const diff = startY - e.changedTouches[0].clientY;
if(diff > 60 && isOwner) openSVViewers(storyId);   // سحب للأعلى = مشاهدون
};

// سحب للأسفل على لوحة المشاهدين لإغلاقها
const handle = document.getElementById(‘sv-viewers-handle’);
if(!handle) return;
let panelStartY = 0;
handle.ontouchstart = e => { panelStartY = e.touches[0].clientY; };
handle.ontouchend = e => {
const diff = e.changedTouches[0].clientY - panelStartY;
if(diff > 50) closeSVViewers();
};
}

// تعديل القصة
window.svEditStory = async() => {
const story = SV.currentStoryData;
if(!story) return;
const newText = prompt(‘تعديل نص القصة:’, story.text||’’);
if(newText === null) return;
try{
await updateDoc(doc(db,‘wb_stories’,story.id),{text:newText});
closeSVViewers();
svRender(); // تحديث العرض
alert(‘✅ تم التعديل’);
}catch(e){ alert(’خطأ: ’+e.message); }
};

// حذف القصة
window.svDeleteStory = async() => {
const story = SV.currentStoryData;
if(!story) return;
if(!confirm(‘هل تريد حذف هذه القصة نهائياً؟’)) return;
try{
await deleteDoc(doc(db,‘wb_stories’,story.id));
closeSVViewers();
svNav(1); // انتقل للتالي أو أغلق
alert(‘✅ تم الحذف’);
}catch(e){ alert(’خطأ: ’+e.message); }
};

window.closeSV = () => {
document.getElementById(‘sv’).classList.remove(‘open’);
clearTimeout(SV.timer);
};

window.svSendReply = async () => {
const inp = document.getElementById(‘sv-reply-inp’);
const text = inp.value.trim(); if(!text) return;
const group = SV.groups[SV.groupIdx];
if(!group || !G.user) return;
inp.value = ‘’;
// Start a chat with story author
try {
const chatId = [G.user.uid, group.uid].sort().join(’_’);
const ref = doc(db,‘wb_chats’,chatId);
const snap = await getDoc(ref);
if(!snap.exists()) await setDoc(ref,{participants:[G.user.uid,group.uid],lastMessage:’’,lastMessageAt:serverTimestamp(),unreadCount:0,createdAt:serverTimestamp()});
await addDoc(collection(db,‘wb_messages’),{chatId,senderId:G.user.uid,senderName:G.userData?.name||’’,senderAvatar:G.userData?.avatar||’’,text:`↩️ ردّ على قصتك: ${text}`,read:false,createdAt:serverTimestamp()});
await updateDoc(ref,{lastMessage:text,lastMessageAt:serverTimestamp(),unreadCount:increment(1)});
alert(‘✅ تم إرسال الرد!’);
} catch(e){ console.error(e); }
};

// ══════════════════════════════
// FEED
// ══════════════════════════════
function loadFeed(){
const c = document.getElementById(‘feed-list’);
c.innerHTML = ‘<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
if(G.unsubs.feed) G.unsubs.feed();
const q = query(collection(db,‘wb_posts’),limit(30));
G.unsubs.feed = onSnapshot(q, snap => {
c.innerHTML=’’;
const blocked=G.userData?.blockedUsers||[];
const muted=G.userData?.mutedUsers||[];
const posts=[];
snap.forEach(d=>{
const p={id:d.id,…d.data()};
if(blocked.includes(p.authorId)||muted.includes(p.authorId)) return;
posts.push(p);
});
posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
if(!posts.length){ c.innerHTML=’<div class="empty"><i class="fas fa-newspaper"></i><p>لا توجد منشورات — كن الأول!</p></div>’; return; }
posts.forEach(p=>c.appendChild(buildPostCard(p)));
}, err => {
console.error(‘Feed error:’,err);
c.innerHTML=`<div class="empty"> <i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i> <p style="font-weight:700;margin-bottom:8px">خطأ في تحميل المنشورات</p> <p style="font-size:.78rem;color:#6b7a5a">${err.message}</p> <button onclick="fixFirestoreRules()" class="btn-primary" style="margin-top:12px;font-size:.82rem">🔧 إصلاح الإعدادات</button> </div>`;
});
}

const POST_PREVIEW_LIMIT = 180; // عدد الحروف قبل “قراءة المزيد”

function buildPostText(text, postId){
if(!text) return ‘’;
if(text.length <= POST_PREVIEW_LIMIT) return highlightText(text);
const preview = text.substring(0, POST_PREVIEW_LIMIT);
const rest    = text.substring(POST_PREVIEW_LIMIT);
return `${highlightText(preview)}<span id="rest-${postId}" style="display:none">${highlightText(rest)}</span>... <button onclick="expandPost('${postId}')" id="more-btn-${postId}" style="background:none;border:none;color:#5c7a4e;font-weight:700;cursor:pointer;font-family:Cairo,sans-serif;font-size:.88rem;padding:0">قراءة المزيد ▾</button>`;
}

window.expandPost=(postId)=>{
const rest=document.getElementById(‘rest-’+postId);
const btn=document.getElementById(‘more-btn-’+postId);
if(!rest||!btn) return;
if(rest.style.display===‘none’){
rest.style.display=‘inline’;
btn.textContent=‘عرض أقل ▴’;
} else {
rest.style.display=‘none’;
btn.textContent=‘قراءة المزيد ▾’;
}
};

function buildPostCard(post, forceOwner=false){
const card = document.createElement(‘div’);
card.className = ‘post-card’;
card.dataset.postId = post.id;
const uid = G.user?.uid||’’;
const liked = (post.likedBy||[]).includes(uid);
const saved = (post.savedBy||[]).includes(uid);
const isOwner = forceOwner || post.authorId===uid;
const t = post.createdAt?.toDate ? timeAgo(post.createdAt.toDate()) : ‘’;
const tags = (post.tags||[]).map(tg=>`<span style="color:#5c7a4e;font-weight:700;cursor:pointer">${tg}</span>`).join(’ ’);

card.innerHTML = ` <div class="post-header"> <div class="post-av" onclick="openPubProfile('${post.authorId}')"> ${post.authorAvatar?`<img src="${post.authorAvatar}">`:(post.authorName?.[0]||'م')} </div> <div class="post-meta"> <div class="post-uname" onclick="openPubProfile('${post.authorId}')" style="display:flex;align-items:center;gap:4px">${post.authorName||'مستخدم'}${vbadge(post.authorVerified)}${post.authorIsAdmin?'<span style="background:#e74c3c;color:#fff;border-radius:6px;padding:1px 5px;font-size:.55rem;font-weight:700">أدمن</span>':''}</div> <div class="post-time">${t}</div> </div> ${isOwner ? `
<div style="position:relative">
<button style="background:none;border:none;color:#6b7a5a;font-size:1rem;cursor:pointer;padding:6px 10px" class="pmenu-btn"><i class="fas fa-ellipsis-h"></i></button>
<div class="pmenu-dd" style="display:none;position:absolute;left:0;top:36px;background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.15);z-index:100;min-width:150px;overflow:hidden">
<button class="pmenu-edit" style="width:100%;padding:12px 16px;border:none;background:none;font-family:'Cairo',sans-serif;font-size:.85rem;color:#2c3a1e;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px"><i class="fas fa-pen" style="color:#5c7a4e"></i> تعديل</button>
<button class="pmenu-del" style="width:100%;padding:12px 16px;border:none;background:none;font-family:'Cairo',sans-serif;font-size:.85rem;color:#e74c3c;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px"><i class="fas fa-trash"></i> حذف</button>
</div>
</div>`:`<button style="background:none;border:none;color:#6b7a5a;font-size:1rem;cursor:pointer;padding:6px 10px"><i class="fas fa-ellipsis-h"></i></button>`} </div> ${post.text ? `<div class="post-text" id="pt-${post.id}">${buildPostText(post.text, post.id)}</div>`: ''} ${post.imageUrl ?`<img class="post-img" src="${post.imageUrl}" loading="lazy">`: ''} ${post.videoUrl ?`<video class="post-video" src="${post.videoUrl}" controls playsinline></video>` : ''} <div class="post-actions"> <button class="pact like-btn ${liked?'liked':''}" data-id="${post.id}"><i class="${liked?'fas':'far'} fa-heart"></i> ${post.likes||0}</button> <button class="pact comment-btn" data-id="${post.id}"><i class="far fa-comment"></i> ${post.comments||0}</button> <button class="pact save-btn ${saved?'saved':''}" data-id="${post.id}"><i class="${saved?'fas':'far'} fa-bookmark"></i></button> <button class="pact share-btn" data-id="${post.id}"><i class="fas fa-share-alt"></i></button> </div>`;

// Menu
if(isOwner){
const menuBtn  = card.querySelector(’.pmenu-btn’);
const dd       = card.querySelector(’.pmenu-dd’);
const editBtn  = card.querySelector(’.pmenu-edit’);
const delBtn   = card.querySelector(’.pmenu-del’);
menuBtn.onclick = e => { e.stopPropagation(); document.querySelectorAll(’.pmenu-dd’).forEach(d=>{ if(d!==dd) d.style.display=‘none’; }); dd.style.display=dd.style.display===‘none’?‘block’:‘none’; };
editBtn.onclick = async e => { e.stopPropagation(); dd.style.display=‘none’; const nt=prompt(‘تعديل المنشور:’,post.text||’’); if(nt===null||nt===post.text)return; await updateDoc(doc(db,‘wb_posts’,post.id),{text:nt.trim()}); };
delBtn.onclick  = async e => { e.stopPropagation(); dd.style.display=‘none’; if(!confirm(‘حذف المنشور؟’))return; card.style.opacity=’.4’; try{ await deleteDoc(doc(db,‘wb_posts’,post.id)); await updateDoc(doc(db,‘wb_users’,G.user.uid),{posts:increment(-1)}); card.remove(); }catch(err){ card.style.opacity=‘1’; alert(err.message); } };
document.addEventListener(‘click’,()=>dd.style.display=‘none’);
}

// Like
card.querySelector(’.like-btn’).onclick = () => toggleLike(post.id, card.querySelector(’.like-btn’));
// Comment
card.querySelector(’.comment-btn’).onclick = () => openComments(post.id);
// Save
card.querySelector(’.save-btn’).onclick = () => toggleSave(post.id, card.querySelector(’.save-btn’));
// Share
card.querySelector(’.share-btn’).onclick = () => sharePost(post.id, post.text);

return card;
}

function highlightText(text){
return text.split(/(\s+)/).map(w => {
if(w.startsWith(’#’)||w.startsWith(’@’)) return `<span style="color:#5c7a4e;font-weight:700;cursor:pointer">${w}</span>`;
return w;
}).join(’’);
}

// Like
async function toggleLike(postId, btn){
if(!G.user){return;}
if(btn.dataset.locking) return; btn.dataset.locking=‘1’;
const wasLiked = btn.classList.contains(‘liked’);
const cur = parseInt(btn.textContent.trim().split(’ ‘)[1]||‘0’)||0;
btn.className=‘pact like-btn’+(wasLiked?’’:’ liked’);
btn.innerHTML=`<i class="${wasLiked?'far':'fas'} fa-heart"></i> ${wasLiked?cur-1:cur+1}`;
try{
const ref=doc(db,‘wb_posts’,postId), snap=await getDoc(ref), data=snap.data();
const likedBy=data?.likedBy||[], isLiked=likedBy.includes(G.user.uid);
await updateDoc(ref,{likes:increment(isLiked?-1:1),likedBy:isLiked?likedBy.filter(u=>u!==G.user.uid):[…likedBy,G.user.uid]});
// Notification
if(!isLiked && data?.authorId && data.authorId!==G.user.uid){
await addDoc(collection(db,‘wb_notifications’),{userId:data.authorId,type:‘like’,actorId:G.user.uid,actorName:G.userData?.name||’’,postId,read:false,createdAt:serverTimestamp()});
// ntfy إشعار إعجاب
sendNtfy(‘❤️ إعجاب جديد — Webook’,`${G.userData?.name||'مستخدم'} أعجب بمنشور ${data?.authorName||''}`, ‘heart’, ‘welikecomm’);
}
}catch(e){}
delete btn.dataset.locking;
}

// Save
async function toggleSave(postId, btn){
if(!G.user) return;
const wasSaved = btn.classList.contains(‘saved’);
btn.className=‘pact save-btn’+(wasSaved?’’:’ saved’);
btn.innerHTML=`<i class="${wasSaved?'far':'fas'} fa-bookmark"></i>`;
try{
const ref=doc(db,‘wb_posts’,postId), snap=await getDoc(ref), data=snap.data();
const savedBy=data?.savedBy||[], isSaved=savedBy.includes(G.user.uid);
await updateDoc(ref,{savedBy:isSaved?savedBy.filter(u=>u!==G.user.uid):[…savedBy,G.user.uid]});
}catch(e){}
}

// ══════════════════════════════
// SHARE SYSTEM — Instagram / WhatsApp / Telegram / Copy
// ══════════════════════════════
const SS = { postId: null, postData: null, cardBlob: null };

async function sharePost(postId, text) {
// جلب بيانات المنشور
try {
const snap = await getDoc(doc(db, ‘wb_posts’, postId));
if (!snap.exists()) return;
SS.postData = { id: postId, …snap.data() };
SS.postId   = postId;
SS.cardBlob = null;
buildShareCard(SS.postData);
// إغلاق كل القوائم المفتوحة قبل فتح نافذة المشاركة
document.querySelectorAll(’.pmenu-dd’).forEach(d => d.style.display = ‘none’);
document.getElementById(‘share-sheet-overlay’).classList.add(‘open’);
// توليد صورة البطاقة في الخلفية
setTimeout(() => generateShareImage(), 300);
} catch(e) { console.error(e); }
}

function buildShareCard(p) {
// صورة المستخدم
const av = document.getElementById(‘sc-avatar’);
av.innerHTML = p.authorAvatar
? `<img src="${p.authorAvatar}">`
: (p.authorName?.[0] || ‘م’);

document.getElementById(‘sc-name’).textContent   = p.authorName || ‘مستخدم’;
document.getElementById(‘sc-handle’).textContent = p.authorUsername ? ‘@’+p.authorUsername : ‘’;
document.getElementById(‘sc-time’).textContent   = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : ‘’;

// صورة المنشور
const img = document.getElementById(‘sc-post-img’);
if (p.imageUrl) {
img.src = p.imageUrl;
img.style.display = ‘block’;
} else {
img.style.display = ‘none’;
}

// النص
document.getElementById(‘sc-text’).textContent = p.text
? (p.text.length > 120 ? p.text.substring(0,120)+’…’ : p.text)
: ‘’;

// الإحصائيات
document.getElementById(‘sc-stats’).innerHTML =
`<span class="sc-stat">❤️ <b>${p.likes||0}</b> إعجاب</span> <span class="sc-stat">💬 <b>${p.comments||0}</b> تعليق</span>`;

// معاينة مصغرة في الشيت
const prev = document.getElementById(‘ss-card-preview’);
prev.innerHTML = `<div style="background:linear-gradient(160deg,#1a2614,#0a1208);border-radius:14px;padding:14px;color:#f0ede8;font-family:'Cairo',sans-serif"> <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"> <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#5c7a4e,#8aab7a);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.9rem;overflow:hidden;flex-shrink:0"> ${p.authorAvatar ?`<img src="${p.authorAvatar}" style="width:100%;height:100%;object-fit:cover">`: (p.authorName?.[0]||'م')} </div> <div> <div style="font-weight:800;font-size:.85rem">${p.authorName||'مستخدم'}</div> <div style="font-size:.7rem;opacity:.45">${p.authorUsername?'@'+p.authorUsername:''}</div> </div> </div> ${p.imageUrl ?`<img src="${p.imageUrl}" style="width:100%;max-height:140px;object-fit:cover;border-radius:10px;margin-bottom:8px;display:block">`: ''} ${p.text ?`<div style="font-size:.82rem;opacity:.88;line-height:1.6">${p.text.length>100?p.text.substring(0,100)+’…’:p.text}</div>` : ''} <div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between"> <div style="display:flex;align-items:center;gap:6px"> <div style="width:22px;height:22px;border-radius:6px;background:linear-gradient(135deg,#5c7a4e,#8aab7a);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:900">W</div> <span style="font-size:.72rem;font-weight:800">Webook</span> </div> <span style="font-size:.65rem;background:rgba(92,122,78,.2);color:#8aab7a;border-radius:20px;padding:3px 8px;font-weight:700">🌿 webook.app</span> </div> </div>`;
}

async function generateShareImage() {
try {
const el = document.getElementById(‘sc-inner’);
// ضع العنصر مؤقتاً بعرض ثابت ليُرسم بشكل صحيح
document.getElementById(‘share-card-hidden’).style.left = ‘-9999px’;
const canvas = await html2canvas(el, {
scale: 2,
useCORS: true,
allowTaint: true,
backgroundColor: null,
logging: false
});
canvas.toBlob(blob => { SS.cardBlob = blob; }, ‘image/png’, 0.95);
} catch(e) { console.warn(‘html2canvas:’, e); }
}

function closeShareSheet() {
document.getElementById(‘share-sheet-overlay’).classList.remove(‘open’);
SS.postData = null; SS.postId = null; SS.cardBlob = null;
}

// ── مشاركة في قصة انستغرام ──
async function shareToInstagram() {
if (!SS.cardBlob && SS.postData) {
// محاولة أخيرة لتوليد الصورة
await generateShareImage();
await new Promise(r => setTimeout(r, 800));
}

if (SS.cardBlob) {
try {
// حفظ الصورة ثم فتح انستغرام
const url = URL.createObjectURL(SS.cardBlob);
const a = document.createElement(‘a’);
a.href = url; a.download = ‘webook-post.png’;
a.click();
URL.revokeObjectURL(url);
// فتح انستغرام على شاشة القصة
setTimeout(() => {
window.location.href = ‘instagram://story-camera’;
// إذا لم يفتح انستغرام بعد ثانيتين
setTimeout(() => {
const installed = confirm(‘هل تريد فتح متجر التطبيقات لتحميل انستغرام؟’);
if (installed) window.open(‘https://www.instagram.com’, ‘_blank’);
}, 2000);
}, 500);
} catch(e) {
// Web Share API كبديل
if (navigator.share && SS.cardBlob) {
const file = new File([SS.cardBlob], ‘webook-post.png’, { type: ‘image/png’ });
if (navigator.canShare && navigator.canShare({ files: [file] })) {
await navigator.share({ files: [file], title: ‘Webook’ });
return;
}
}
window.location.href = ‘instagram://story-camera’;
}
} else {
// بدون صورة — فتح انستغرام مباشرة
window.location.href = ‘instagram://story-camera’;
setTimeout(() => {
alert(‘📸 احفظ البطاقة يدوياً ثم شاركها في قصتك!’);
}, 1500);
}
closeShareSheet();
}

// ── مشاركة في واتساب ──
function shareToWhatsApp() {
const url = location.origin + location.pathname + ‘?post=’ + SS.postId;
const text = SS.postData?.text
? `${SS.postData.text.substring(0,80)}...\n\n🌿 شاهده على Webook:\n${url}`
: `🌿 شاهد هذا المنشور على Webook:\n${url}`;
window.open(‘https://wa.me/?text=’ + encodeURIComponent(text), ‘_blank’);
closeShareSheet();
}

// ── مشاركة في تيليغرام ──
function shareToTelegram() {
const url  = location.origin + location.pathname + ‘?post=’ + SS.postId;
const text = SS.postData?.text ? SS.postData.text.substring(0,80)+’…’ : ‘منشور من Webook 🌿’;
window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, ‘_blank’);
closeShareSheet();
}

// ── نسخ الرابط ──
function copyPostLink() {
const url = location.origin + location.pathname + ‘?post=’ + SS.postId;
navigator.clipboard?.writeText(url).then(() => {
const btn = document.querySelector(’.ss-btn.copy’);
if (btn) { btn.innerHTML = ‘<i class="fas fa-check"></i>تم النسخ’; setTimeout(() => { btn.innerHTML = ‘<i class="fas fa-link"></i>نسخ الرابط’; }, 2000); }
}).catch(() => {
prompt(‘انسخ الرابط:’, url);
});
}

// New Post
window.openNewPost = () => {
document.getElementById(‘np-text’).value=’’;
G.npImgData=null;
document.getElementById(‘np-img-wrap’).style.display=‘none’;
openOverlay(‘new-post-overlay’);
};
window.previewPostImg = async input => {
const file=input.files[0]; if(!file)return;
// ضغط الصورة دائماً قبل الرفع
G.npImgData = await compressImg(file, 1080, .8);
document.getElementById(‘np-img-prev’).src=G.npImgData;
document.getElementById(‘np-img-wrap’).style.display=‘block’;
};
window.clearPostImg = () => { G.npImgData=null; document.getElementById(‘np-img-wrap’).style.display=‘none’; };
window.submitPost = async () => {
const text=document.getElementById(‘np-text’).value.trim();
if(!text&&!G.npImgData)return;
const btn=document.getElementById(‘np-submit’); btn.textContent=‘جاري…’; btn.disabled=true;
try{
const tags=text.match(/#[\w\u0600-\u06FF]+/g)||[];
const mentions=text.match(/@[\w\u0600-\u06FF]+/g)||[];
await addDoc(collection(db,‘wb_posts’),{
text, imageUrl:G.npImgData||’’, videoUrl:’’,
authorId:G.user.uid, authorName:G.userData.name,
authorUsername:G.userData.username||’’,
authorAvatar:G.userData.avatar||’’,
authorVerified:G.userData.isVerified||false,
authorIsAdmin:G.userData.isAdmin||false,
likes:0, likedBy:[], comments:0, savedBy:[],
tags, mentions, createdAt:serverTimestamp()
});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{posts:increment(1)});
// ntfy إشعار منشور جديد
sendNtfy(‘📝 منشور جديد — Webook’, `${G.userData.name} (@${G.userData.username||''})\n${text.substring(0,100)||'(صورة فقط)'}`, ‘newspaper’, ‘wepost’);
document.getElementById(‘np-text’).value=’’; G.npImgData=null;
document.getElementById(‘np-img-wrap’).style.display=‘none’;
closeOverlay(‘new-post-overlay’);
}catch(e){ alert(’خطأ: ’+e.message); }
finally{ btn.textContent=‘نشر ✨’; btn.disabled=false; }
};

// ══════════════════════════════
// REELS
// ══════════════════════════════
function loadReels(){
const list=document.getElementById(‘reels-list’);
list.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
if(G.unsubs.reels) G.unsubs.reels();
G.unsubs.reels=onSnapshot(collection(db,‘wb_reels’),snap=>{
list.innerHTML=’’;
if(snap.empty){
list.innerHTML=’<div class="reel-empty"><i class="fas fa-clapperboard"></i><p style="font-weight:700">لا توجد ريلز بعد</p><button onclick="openOverlay(\'new-reel-overlay\')" class="btn-primary" style="margin-top:16px">نشر ريل 🎬</button></div>’;
return;
}
const reels=[];
snap.forEach(d=>reels.push({id:d.id,…d.data()}));
reels.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
reels.forEach(r=>{
const el=document.createElement(‘div’);
el.className=‘reel-item’;
const liked=(r.likedBy||[]).includes(G.user?.uid||’’);
el.innerHTML=`${r.videoUrl ?`<video class="reel-video" src="${r.videoUrl}" loop playsinline webkit-playsinline x5-playsinline muted preload="metadata" disablepictureinpicture disableremoteplayback></video>`: r.thumbnailUrl ?`<img src="${r.thumbnailUrl}" class="reel-video">`:`<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.3);z-index:1"><i class="fas fa-clapperboard" style="font-size:4rem"></i></div>` } <div class="reel-overlay"></div> <div class="reel-tap-overlay" id="tap-${r.id}"></div> <!-- أيقونتان بالوسط: كتم فوق، تشغيل/إيقاف تحت --> <div class="reel-center-icons" id="cicons-${r.id}"> <div class="reel-mute-icon" id="micon-${r.id}"><i class="fas fa-volume-mute"></i></div> <div class="reel-play-icon" id="picon-${r.id}"><i class="fas fa-play"></i></div> </div> <!-- قلب اللايك --> <div class="reel-heart-pop" id="heart-${r.id}"><i class="fas fa-heart"></i></div> <div class="reel-info"> <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"> <div onclick="openPubProfile('${r.authorId}')" style="width:40px;height:40px;border-radius:50%;border:2px solid rgba(255,255,255,.8);overflow:hidden;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;flex-shrink:0;cursor:pointer"> ${r.authorAvatar?`<img src="${r.authorAvatar}" style="width:100%;height:100%;object-fit:cover">`:(r.authorName?.[0]||'م')} </div> <div> <div style="color:#fff;font-weight:800;font-size:.92rem;display:flex;align-items:center;gap:4px">${r.authorName||'مستخدم'}${vbadge(r.authorVerified)}${r.authorIsAdmin?'<span style="background:#e74c3c;color:#fff;border-radius:6px;padding:1px 5px;font-size:.55rem;font-weight:700">أدمن</span>':''}</div> <div style="color:rgba(255,255,255,.65);font-size:.75rem">@${r.authorUsername||''}</div> </div> </div> <div style="color:rgba(255,255,255,.9);font-size:.88rem;line-height:1.5">${r.caption||''}</div> </div> <div class="reel-actions"> <button class="reel-act reel-like ${liked?'liked':''}" id="like-btn-${r.id}"> <i class="${liked?'fas':'far'} fa-heart" style="${liked?'color:#e74c3c':''}"></i> <span id="like-count-${r.id}">${r.likes||0}</span> </button> <button class="reel-act" onclick="openComments('${r.id}')"><i class="far fa-comment"></i><span>${r.comments||0}</span></button> <button class="reel-act" onclick="sharePost('${r.id}','')"><i class="fas fa-share-alt"></i><span>مشاركة</span></button> </div>`;
el.querySelector(’.reel-like’).onclick=function(e){e.stopPropagation();toggleReelLike(r.id,this);};
// منطق الضغط: مرة = تشغيل/إيقاف، مرتان = لايك
setupReelTap(el, r.id);
list.appendChild(el);
});
// شغّل الأول تلقائياً
setTimeout(setupReelAutoplay, 300);
}, err=>{ list.innerHTML=`<div class="reel-empty"><i class="fas fa-exclamation-triangle" style="color:#e74c3c"></i><p>${err.message}</p></div>`; });
}

async function toggleReelLike(reelId, btn){
if(!G.user)return;
const wasLiked=btn.classList.contains(‘liked’);
const cur=parseInt(btn.querySelector(‘span’).textContent)||0;
btn.classList.toggle(‘liked’);
btn.querySelector(‘i’).className=(wasLiked?‘far’:‘fas’)+’ fa-heart’;
btn.querySelector(‘i’).style.color=wasLiked?’’:’#e74c3c’;
btn.querySelector(‘span’).textContent=wasLiked?cur-1:cur+1;
const ref=doc(db,‘wb_reels’,reelId), snap=await getDoc(ref), data=snap.data();
const likedBy=data?.likedBy||[], isLiked=likedBy.includes(G.user.uid);
await updateDoc(ref,{likes:increment(isLiked?-1:1),likedBy:isLiked?likedBy.filter(u=>u!==G.user.uid):[…likedBy,G.user.uid]});
}

// ── Reel Tap Logic ──
let _reelMuted = false; // صوت مفعّل بشكل افتراضي

function setupReelTap(el, reelId){
const tapOverlay = el.querySelector(`#tap-${reelId}`);
const cicons     = el.querySelector(`#cicons-${reelId}`);
const picon      = el.querySelector(`#picon-${reelId}`);
const micon      = el.querySelector(`#micon-${reelId}`);
let lastTap = 0;

// الضغط المباشر على أيقونة الكتم
if(micon){
micon.addEventListener(‘click’, (e) => {
e.stopPropagation();
const video = el.querySelector(‘video.reel-video’);
if(video){ video.muted = !video.muted; _reelMuted = video.muted; }
micon.querySelector(‘i’).className = _reelMuted ? ‘fas fa-volume-mute’ : ‘fas fa-volume-up’;
cicons.classList.add(‘show’);
setTimeout(()=>cicons.classList.remove(‘show’), 1500);
});
}

// الضغط على باقي الشاشة = تشغيل/إيقاف أو لايك مزدوج
tapOverlay.addEventListener(‘click’, (e) => {
e.stopPropagation();
const now = Date.now();
const delta = now - lastTap;
lastTap = now;

```
if(delta < 300){
  // ضغطتان = لايك
  const likeBtn = el.querySelector(`#like-btn-${reelId}`);
  if(likeBtn && !likeBtn.classList.contains('liked')) toggleReelLike(reelId, likeBtn);
  const heart = el.querySelector(`#heart-${reelId}`);
  if(heart){ heart.classList.remove('animate'); void heart.offsetWidth; heart.classList.add('animate'); }
  return;
}

// ضغطة واحدة = تشغيل/إيقاف
const video = el.querySelector('video.reel-video');
if(!video) return;
if(video.paused){
  video.play().catch(()=>{});
  if(picon) picon.querySelector('i').className='fas fa-play';
  cicons.classList.add('show');
  setTimeout(()=>cicons.classList.remove('show'), 800);
} else {
  video.pause();
  if(picon) picon.querySelector('i').className='fas fa-pause';
  cicons.classList.add('show'); // تبقى ظاهرة عند الإيقاف
}
```

});
}

window.toggleReelMute = (reelId, btn) => {
const videos = document.querySelectorAll(’#reels-list video.reel-video’);
_reelMuted = !_reelMuted;
videos.forEach(v => v.muted = _reelMuted);
// تحديث كل أيقونات الكتم
document.querySelectorAll(’[id^=“micon-”]’).forEach(m=>{
m.querySelector(‘i’).className = _reelMuted ? ‘fas fa-volume-mute’ : ‘fas fa-volume-up’;
});
};

// تشغيل الفيديو الظاهر تلقائياً مثل إنستغرام
function setupReelAutoplay(){
const list = document.getElementById(‘reels-list’);
if(!list) return;
if(G._reelObserver) G._reelObserver.disconnect();
G._reelObserver = new IntersectionObserver((entries) => {
entries.forEach(entry => {
const item   = entry.target;
const video  = item.querySelector(‘video.reel-video’);
const cicons = item.querySelector(’[id^=“cicons-”]’);
const micon  = item.querySelector(’[id^=“micon-”]’);
const picon  = item.querySelector(’[id^=“picon-”]’);
if(!video) return;
if(entry.isIntersecting && entry.intersectionRatio > 0.6){
video.muted = _reelMuted; // استخدم الحالة الحالية
video.play().catch(()=>{
// إذا رفض المتصفح بسبب الصوت، شغّل بدون صوت
video.muted = true; _reelMuted = true;
video.play().catch(()=>{});
});
// أظهر أيقونتي الكتم والتشغيل ثم أخفِهما
if(picon) picon.querySelector(‘i’).className=‘fas fa-play’;
if(micon) micon.querySelector(‘i’).className = _reelMuted ? ‘fas fa-volume-mute’ : ‘fas fa-volume-up’;
if(cicons){ cicons.classList.add(‘show’); setTimeout(()=>cicons.classList.remove(‘show’),1200); }
} else {
video.pause();
video.currentTime = 0;
if(cicons) cicons.classList.remove(‘show’);
}
});
}, { threshold: 0.6 });
list.querySelectorAll(’.reel-item’).forEach(item => G._reelObserver.observe(item));
}

// New Reel
window.previewReel = (input) => {
G.nrVideoFile=input.files[0]; if(!G.nrVideoFile)return;
// Cloudinary يقبل حتى 100MB في الخطة المجانية
const sizeMB = G.nrVideoFile.size/1024/1024;
if(sizeMB > 100){
alert(`حجم الفيديو ${sizeMB.toFixed(0)}MB — الحد الأقصى 100MB\nجرب ضغط الفيديو أو اختر فيديو أقصر`);
G.nrVideoFile=null; return;
}
const url=URL.createObjectURL(G.nrVideoFile);
document.getElementById(‘nr-video-prev’).src=url;
document.getElementById(‘nr-video-wrap’).style.display=‘block’;
// عرض حجم الملف
const sizeEl=document.getElementById(‘nr-progress-size’);
if(sizeEl) sizeEl.textContent=`حجم الفيديو: ${sizeMB.toFixed(1)} MB`;
document.getElementById(‘nr-progress-wrap’).style.display=‘block’;
};

window.clearReelVideo = () => {
G.nrVideoFile = null;
document.getElementById(‘nr-video-wrap’).style.display = ‘none’;
document.getElementById(‘nr-video-prev’).src = ‘’;
document.getElementById(‘nr-video-input’).value = ‘’;
};

function setReelProgress(pct, label, sizeText=’’){
document.getElementById(‘nr-progress-wrap’).style.display = ‘block’;
document.getElementById(‘nr-progress-bar’).style.width = pct+’%’;
document.getElementById(‘nr-progress-pct’).textContent = pct+’%’;
document.getElementById(‘nr-progress-label’).textContent = label;
if(sizeText) document.getElementById(‘nr-progress-size’).textContent = sizeText;
}

function hideReelProgress(){
document.getElementById(‘nr-progress-wrap’).style.display = ‘none’;
document.getElementById(‘nr-progress-bar’).style.width = ‘0%’;
}

function uploadToCloudinaryXHR(file, cloudName, preset){
return new Promise((resolve, reject) => {
const formData = new FormData();
formData.append(‘file’, file);
formData.append(‘upload_preset’, preset);
const xhr = new XMLHttpRequest();
xhr.open(‘POST’, `https://api.cloudinary.com/v1_1/${cloudName}/video/upload`);
xhr.upload.onprogress = (e) => {
if(e.lengthComputable){
const pct = Math.round(e.loaded/e.total*100);
const loaded = (e.loaded/1024/1024).toFixed(1);
const total  = (e.total /1024/1024).toFixed(1);
setReelProgress(pct, ‘جاري رفع الفيديو…’, `${loaded} MB من ${total} MB`);
}
};
xhr.onload = () => {
if(xhr.status===200){
const data = JSON.parse(xhr.responseText);
resolve(data);
} else {
try{
const err = JSON.parse(xhr.responseText);
reject(new Error(err.error?.message||‘فشل الرفع’));
}catch(e){ reject(new Error(‘فشل الرفع’)); }
}
};
xhr.onerror = () => reject(new Error(‘خطأ في الشبكة’));
xhr.send(formData);
});
}

window.submitReel = async () => {
const caption = document.getElementById(‘nr-caption’).value.trim();
if(!G.nrVideoFile && !caption){ alert(‘اختر فيديو أو أضف وصفاً’); return; }
const btn = document.getElementById(‘nr-submit’);
btn.disabled = true;
btn.textContent = ‘جاري…’;

let videoUrl = ‘’;
let thumbnailUrl = ‘’;

if(G.nrVideoFile){
try{
setReelProgress(0, ‘جاري التحضير…’, `حجم الفيديو: ${(G.nrVideoFile.size/1024/1024).toFixed(1)} MB`);
const data = await uploadToCloudinaryXHR(G.nrVideoFile, ‘dooaagbr8’, ‘ml_default’);
videoUrl = data.secure_url;
// Thumbnail من Cloudinary تلقائياً
thumbnailUrl = data.secure_url
.replace(’/upload/’, ‘/upload/so_1,w_600,h_800,c_fill/’)
.replace(/.[^.]+$/, ‘.jpg’);
setReelProgress(100, ‘تم الرفع! ✅’);
} catch(e){
hideReelProgress();
btn.textContent = ‘نشر 🎬’; btn.disabled = false;
alert(’خطأ في رفع الفيديو: ’ + e.message);
return;
}
}

try{
btn.textContent = ‘جاري النشر…’;
await addDoc(collection(db,‘wb_reels’),{
caption, videoUrl, thumbnailUrl,
authorId:G.user.uid, authorName:G.userData.name,
authorUsername:G.userData.username||’’,
authorAvatar:G.userData.avatar||’’,
authorVerified:G.userData.isVerified||false,
authorIsAdmin:G.userData.isAdmin||false,
likes:0, likedBy:[], comments:0,
createdAt:serverTimestamp()
});
// ntfy إشعار ريل جديد
sendNtfy(‘🎬 ريل جديد — Webook’, `${G.userData.name} (@${G.userData.username||''})\n${caption.substring(0,100)||'(بدون وصف)'}`, ‘clapper’, ‘wepost’);
document.getElementById(‘nr-caption’).value = ‘’;
G.nrVideoFile = null;
document.getElementById(‘nr-video-wrap’).style.display = ‘none’;
document.getElementById(‘nr-video-prev’).src = ‘’;
hideReelProgress();
closeOverlay(‘new-reel-overlay’);
goPage(‘reels-page’);
} catch(e){ alert(’خطأ في النشر: ’ + e.message); }
finally{ btn.textContent = ‘نشر 🎬’; btn.disabled = false; }
};

// ══════════════════════════════
// EXPLORE
// ══════════════════════════════
function loadExplore(){
const grid=document.getElementById(‘explore-grid’);
const tagsWrap=document.getElementById(‘tags-wrap’);
grid.innerHTML=’’;tagsWrap.innerHTML=’’;
getDocs(collection(db,‘wb_posts’)).then(snap=>{
const posts=[]; snap.forEach(d=>posts.push({id:d.id,…d.data()}));
posts.sort((a,b)=>(b.likes||0)-(a.likes||0));
// Tags
const tagCount={};
posts.forEach(p=>(p.tags||[]).forEach(t=>tagCount[t]=(tagCount[t]||0)+1));
Object.entries(tagCount).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([tag])=>{
const b=document.createElement(‘button’); b.className=‘tag-chip’; b.textContent=tag;
b.onclick=()=>{document.getElementById(‘search-inp’).value=tag;goPage(‘search-page’);doSearch(tag);};
tagsWrap.appendChild(b);
});
// Grid
posts.filter(p=>p.imageUrl).forEach(p=>{
const d=document.createElement(‘div’); d.className=‘explore-item’;
d.innerHTML=`<img src="${p.imageUrl}" loading="lazy"><div class="explore-hover"><span><i class="fas fa-heart"></i> ${p.likes||0}</span><span><i class="fas fa-comment"></i> ${p.comments||0}</span></div>`;
d.onclick=()=>openComments(p.id);
grid.appendChild(d);
});
if(!posts.filter(p=>p.imageUrl).length) grid.innerHTML=’<div class="empty" style="grid-column:1/-1"><i class="fas fa-image"></i><p>لا توجد صور</p></div>’;
});
}

// ══════════════════════════════
// MESSAGES & CHAT
// ══════════════════════════════
function loadChats(){
const list=document.getElementById(‘chats-list’);
list.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
if(!G.user)return;
if(G.unsubs.chatsList) G.unsubs.chatsList();
if(G.unsubs.groupsList) G.unsubs.groupsList();

let privateChats=[], groupChats=[];
let loaded=0;

const renderAll=()=>{
list.innerHTML=’’;
const all=[
…privateChats.map(c=>({…c,_type:‘private’})),
…groupChats.map(c=>({…c,_type:‘group’}))
].sort((a,b)=>(b.lastMessageAt?.seconds||0)-(a.lastMessageAt?.seconds||0));

```
if(!all.length){ list.innerHTML='<div class="empty"><i class="fas fa-comment-dots"></i><p>لا توجد محادثات بعد</p><p style="font-size:.78rem;color:#6b7a5a;margin-top:6px">ابدأ محادثة جديدة أو أنشئ مجموعة</p></div>'; return; }

all.forEach(item=>{
  const el=document.createElement('button');
  el.className='msg-item';
  if(item._type==='group'){
    el.onclick=()=>openGroupChat(item.id,item);
    el.innerHTML=`
      <div class="msg-av" style="background:#5c7a4e;font-size:1.1rem">
        ${item.avatar?`<img src="${item.avatar}">`:'👥'}
      </div>
      <div style="flex:1;min-width:0;text-align:right">
        <div style="font-weight:800;font-size:.9rem;display:flex;align-items:center;gap:4px">${item.name||'مجموعة'} <span style="background:rgba(92,122,78,.15);color:#5c7a4e;border-radius:8px;padding:1px 6px;font-size:.6rem">مجموعة</span></div>
        <div style="font-size:.76rem;color:#6b7a5a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${item.lastMessage||'لا توجد رسائل'}</div>
      </div>`;
  } else {
    el.onclick=()=>{}; // سيُملأ لاحقاً
    el.innerHTML=`
      <div class="msg-av"><i class="fas fa-circle-notch fa-spin" style="font-size:.8rem;color:#8aab7a"></i></div>
      <div style="flex:1;text-align:right"><div style="font-weight:800;font-size:.9rem">جاري التحميل...</div></div>`;
    // جلب بيانات المستخدم الآخر
    const otherId=item.participants?.find(p=>p!==G.user.uid)||'';
    getDoc(doc(db,'wb_users',otherId)).then(uSnap=>{
      const other=uSnap.exists()?{uid:otherId,...uSnap.data()}:{uid:otherId,name:'مستخدم',avatar:''};
      el.onclick=()=>openChat(item.id,otherId,other);
      el.innerHTML=`
        <div class="msg-av">${other.avatar?`<img src="${other.avatar}">`:(other.name?.[0]||'م')}${other.isOnline?'<span class="online-dot"></span>':''}</div>
        <div style="flex:1;min-width:0;text-align:right">
          <div style="font-weight:800;font-size:.92rem;display:flex;align-items:center;gap:4px">${other.name||'مستخدم'}${vbadge(other.isVerified)}</div>
          <div style="font-size:.78rem;color:#6b7a5a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">${item.lastMessage||'ابدأ المحادثة'}</div>
        </div>
        ${item.unreadCount>0?`<div class="unread-badge">${item.unreadCount}</div>`:''}`;
    });
  }
  list.appendChild(el);
});
```

};

// محادثات خاصة
const q1=query(collection(db,‘wb_chats’),where(‘participants’,‘array-contains’,G.user.uid));
G.unsubs.chatsList=onSnapshot(q1,snap=>{
privateChats=[];
snap.forEach(d=>privateChats.push({id:d.id,…d.data()}));
renderAll();
},()=>{});

// مجموعات
const q2=query(collection(db,‘wb_groups’),where(‘members’,‘array-contains’,G.user.uid));
G.unsubs.groupsList=onSnapshot(q2,snap=>{
groupChats=[];
snap.forEach(d=>groupChats.push({id:d.id,…d.data()}));
renderAll();
},()=>{});
}

function openChat(chatId, otherId, otherUser){
G.currentChatId=chatId; G.currentChatOtherUid=otherId;
G._chatOtherUser=otherUser;
document.getElementById(‘chat-other-name’).innerHTML=(otherUser.name||‘مستخدم’)+vbadge(otherUser.isVerified);
document.getElementById(‘chat-other-status’).textContent=otherUser.isOnline?‘متصل الآن’:’’;
const av=document.getElementById(‘chat-other-av’);
av.innerHTML=otherUser.avatar?`<img src="${otherUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(otherUser.name?.[0]||‘م’);
document.getElementById(‘chat-screen’).classList.add(‘open’);
loadChatMessages(chatId);
if(chatId) updateDoc(doc(db,‘wb_chats’,chatId),{unreadCount:0}).catch(()=>{});
}
window.closeChatScreen=()=>{ document.getElementById(‘chat-screen’).classList.remove(‘open’); if(G.unsubs.chat){G.unsubs.chat();G.unsubs.chat=null;} };

window.openChatSettings=async()=>{
// إذا لم تكن البيانات محفوظة، اجلبها من Firestore
let u=G._chatOtherUser||null;
if(!u && G.currentChatOtherUid){
try{
const snap=await getDoc(doc(db,‘wb_users’,G.currentChatOtherUid));
if(snap.exists()) u=snap.data();
G._chatOtherUser=u;
}catch(e){}
}
if(!u){alert(‘تعذر تحميل بيانات المستخدم’);return;}
document.getElementById(‘cs-av’).innerHTML=u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(u.name?.[0]||‘م’);
document.getElementById(‘cs-name’).innerHTML=(u.name||‘مستخدم’)+vbadge(u.isVerified);
document.getElementById(‘cs-username’).textContent=’@’+(u.username||’’);
const mutedChats=G.userData?.mutedChats||[];
document.getElementById(‘cs-mute-label’).textContent=mutedChats.includes(G.currentChatId)?‘تشغيل’:‘إيقاف’;
openOverlay(‘chat-settings-overlay’);
};
window.csViewProfile=()=>{ closeOverlay(‘chat-settings-overlay’); openPubProfile(G.currentChatOtherUid); };
window.csMuteNotifs=async()=>{
const mutedChats=[…(G.userData?.mutedChats||[])];
const idx=mutedChats.indexOf(G.currentChatId);
if(idx>=0){mutedChats.splice(idx,1);document.getElementById(‘cs-mute-label’).textContent=‘إيقاف’;}
else{mutedChats.push(G.currentChatId);document.getElementById(‘cs-mute-label’).textContent=‘تشغيل’;}
await updateDoc(doc(db,‘wb_users’,G.user.uid),{mutedChats});
G.userData={…G.userData,mutedChats};
};
window.csMuteUser=async()=>{ closeOverlay(‘chat-settings-overlay’); await muteUser(G.currentChatOtherUid); };
window.csBlockUser=async()=>{ closeOverlay(‘chat-settings-overlay’); closeChatScreen(); await blockUser(G.currentChatOtherUid); };
window.csDeleteChat=async()=>{
if(!confirm(‘حذف المحادثة وجميع رسائلها؟’))return;
try{
const msgs=await getDocs(query(collection(db,‘wb_messages’),where(‘chatId’,’==’,G.currentChatId)));
for(const d of msgs.docs) await deleteDoc(d.ref);
await deleteDoc(doc(db,‘wb_chats’,G.currentChatId));
closeOverlay(‘chat-settings-overlay’);
closeChatScreen();
}catch(e){alert(’خطأ: ’+e.message);}
};

function loadChatMessages(chatId){
const msgs=document.getElementById(‘chat-msgs’);
msgs.innerHTML=’’;
if(G.unsubs.chat) G.unsubs.chat();
const q=query(collection(db,‘wb_messages’),where(‘chatId’,’==’,chatId));
G.unsubs.chat=onSnapshot(q,snap=>{
const arr=[];
snap.forEach(d=>arr.push({id:d.id,…d.data()}));
arr.sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
msgs.innerHTML=’’;
if(!arr.length){msgs.innerHTML=’<div style="text-align:center;color:#6b7a5a;padding:30px;font-size:.85rem">ابدأ المحادثة 👋</div>’;return;}
arr.forEach(m=>{
const isMe=m.senderId===G.user?.uid;
const t=m.createdAt?.toDate?m.createdAt.toDate().toLocaleTimeString(‘ar’,{hour:‘2-digit’,minute:‘2-digit’}):’’;
const el=document.createElement(‘div’);
el.style.cssText=`display:flex;flex-direction:column;align-items:${isMe?'flex-start':'flex-end'}`;
el.innerHTML=` <div class="chat-bubble ${isMe?'me':'them'}">${m.text} <div class="chat-time" style="text-align:${isMe?'left':'right'}">${t}</div> </div>`;
msgs.appendChild(el);
if(!isMe&&!m.read) updateDoc(doc(db,‘wb_messages’,m.id),{read:true}).catch(()=>{});
});
msgs.scrollTop=msgs.scrollHeight;
}, err=>console.error(‘Chat error:’,err));
}

window.sendChatMsg=async()=>{
const inp=document.getElementById(‘chat-inp’);
const text=inp.value.trim(); if(!text||!G.currentChatId)return;
inp.value=’’;
try{
await addDoc(collection(db,‘wb_messages’),{
chatId:G.currentChatId, senderId:G.user.uid,
senderName:G.userData?.name||’’, senderAvatar:G.userData?.avatar||’’,
text, read:false, createdAt:serverTimestamp()
});
await updateDoc(doc(db,‘wb_chats’,G.currentChatId),{
lastMessage:text, lastMessageAt:serverTimestamp(), unreadCount:increment(1)
});
// Notification
if(G.currentChatOtherUid){
await addDoc(collection(db,‘wb_notifications’),{
userId:G.currentChatOtherUid, type:‘message’,
actorId:G.user.uid, actorName:G.userData?.name||’’,
read:false, createdAt:serverTimestamp()
});
}
}catch(e){console.error(e);}
};

// Start chat from profile
async function startChatWith(otherUid){
const chatId=[G.user.uid,otherUid].sort().join(’_’);
const ref=doc(db,‘wb_chats’,chatId);
const snap=await getDoc(ref);
if(!snap.exists()){
await setDoc(ref,{participants:[G.user.uid,otherUid],lastMessage:’’,lastMessageAt:serverTimestamp(),unreadCount:0,createdAt:serverTimestamp()});
}
const uSnap=await getDoc(doc(db,‘wb_users’,otherUid));
const other=uSnap.exists()?{uid:otherUid,…uSnap.data()}:{uid:otherUid,name:‘مستخدم’,avatar:’’};
closeOverlay(‘pub-profile-overlay’);
openChat(chatId,otherUid,other);
}
window.openChatWithPub=()=>{ if(G.pubProfileUid) startChatWith(G.pubProfileUid); };

// Message badge
function listenMsgBadge(){
if(!G.user)return;
const q=query(collection(db,‘wb_chats’),where(‘participants’,‘array-contains’,G.user.uid));
if(G.unsubs.msgBadge) G.unsubs.msgBadge();
G.unsubs.msgBadge=onSnapshot(q,snap=>{
let total=0; snap.forEach(d=>{total+=(d.data().unreadCount||0);});
const b=document.getElementById(‘msg-badge-hdr’);
if(b){ b.style.display=total>0?‘flex’:‘none’; b.textContent=total>9?‘9+’:total; }
});
}

// ══════════════════════════════
// NOTIFICATIONS
// ══════════════════════════════
function listenNotifs(){
if(!G.user)return;
// بدون orderBy لتجنب مشكلة الـ Index
const q=query(collection(db,‘wb_notifications’),where(‘userId’,’==’,G.user.uid));
if(G.unsubs.notifs) G.unsubs.notifs();
G.unsubs.notifs=onSnapshot(q,snap=>{
const arr=[];
snap.forEach(d=>arr.push({id:d.id,…d.data()}));
arr.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
// إشعارات الدردشة لا تظهر في لوحة الإشعارات — فقط badge
const chatTypes=[‘message’,‘group_message’];
const nonChatArr=arr.filter(n=>!chatTypes.includes(n.type));
const recent=nonChatArr.slice(0,50);
const unread=recent.filter(n=>!n.read).length;
const badge=document.getElementById(‘notif-badge’);
badge.style.display=unread>0?‘flex’:‘none’;
badge.textContent=unread>9?‘9+’:unread;
const list=document.getElementById(‘notif-list’);
list.innerHTML=’’;
if(!recent.length){list.innerHTML=’<div class="empty"><i class="fas fa-bell-slash"></i><p>لا توجد إشعارات</p></div>’;return;}
recent.forEach(n=>{
const {icon,color}=notifMeta(n.type);
const el=document.createElement(‘div’);
el.className=‘notif-item’+(n.read?’’:’ unread’);
el.onclick=()=>{
if(!n.read) updateDoc(doc(db,‘wb_notifications’,n.id),{read:true}).catch(()=>{});
if(n.type===‘message’) goPage(‘messages-page’);
else if(n.type===‘follow’||n.type===‘follow_request’) openPubProfile(n.actorId);
else if(n.postId) openComments(n.postId);
};
el.innerHTML=` <div class="notif-icon" style="background:${color}22;color:${color}">${icon}</div> <div style="flex:1"> <div style="font-size:.88rem"><span style="font-weight:800">${n.actorName||''}</span> ${notifText(n.type)}</div> <div style="font-size:.72rem;color:#6b7a5a;margin-top:3px">${n.createdAt?.toDate?timeAgo(n.createdAt.toDate()):''}</div> </div> ${!n.read?'<div style="width:9px;height:9px;border-radius:50%;background:#5c7a4e;flex-shrink:0"></div>':''}`;
list.appendChild(el);
});
}, err=>console.error(‘Notifs error:’,err));
}
function markNotifsRead(){
if(!G.user)return;
getDocs(query(collection(db,‘wb_notifications’),where(‘userId’,’==’,G.user.uid),where(‘read’,’==’,false))).then(snap=>{
snap.forEach(d=>updateDoc(d.ref,{read:true}));
});
}
function notifMeta(type){
return {
like:{icon:‘❤️’,color:’#e74c3c’},follow:{icon:‘👥’,color:’#2ecc71’},
comment:{icon:‘💬’,color:’#3498db’},mention:{icon:‘💙’,color:’#8e44ad’},
message:{icon:‘✉️’,color:’#f39c12’},follow_request:{icon:‘⏳’,color:’#e67e22’}
}[type]||{icon:‘🔔’,color:’#5c7a4e’};
}
function notifText(type){
return {like:‘أعجب بمنشورك’,follow:‘بدأ بمتابعتك’,comment:‘علّق على منشورك’,mention:‘أشار إليك’,message:‘أرسل لك رسالة’,follow_request:‘طلب متابعتك’}[type]||’’;
}

// ══════════════════════════════
// PROFILE (My Profile)
// ══════════════════════════════
async function loadMyProfile(){
if(!G.user)return;
if(G.unsubs.myProfile) G.unsubs.myProfile();
G.unsubs.myProfile=onSnapshot(doc(db,‘wb_users’,G.user.uid),snap=>{
if(!snap.exists())return;
const ud=snap.data(); G.userData=ud;
document.getElementById(‘prof-name’).innerHTML=(ud.name||’—’)+vbadge(ud.isVerified,‘lg’);
document.getElementById(‘prof-handle’).textContent=’@’+(ud.username||’—’);
document.getElementById(‘prof-bio’).textContent=ud.bio||’’;
document.getElementById(‘prof-av’).innerHTML=ud.avatar?`<img src="${ud.avatar}" style="width:100%;height:100%;object-fit:cover">`:(ud.name?.[0]||‘م’);
document.getElementById(‘prof-followers-n’).textContent=ud.followers||0;
document.getElementById(‘prof-following-n’).textContent=ud.following||0;
if(ud.link){document.getElementById(‘prof-link’).style.display=‘inline-flex’;document.getElementById(‘prof-link-text’).textContent=ud.link;document.getElementById(‘prof-link’).href=ud.link;}
else{document.getElementById(‘prof-link’).style.display=‘none’;}
document.getElementById(‘private-toggle’)?.classList.toggle(‘on’,!!ud.isPrivate);

```
// صورة الغلاف — للموثّقين فقط
const coverImg=document.getElementById('prof-cover-img');
const coverOverlay=document.getElementById('prof-cover-overlay');
const coverBtn=document.getElementById('prof-cover-btn');
if(ud.isVerified){
  if(coverBtn) coverBtn.style.display='flex';
  if(ud.coverImage && coverImg){
    coverImg.src=ud.coverImage; coverImg.style.display='block';
    if(coverOverlay) coverOverlay.style.display='block';
  }
} else {
  if(coverBtn) coverBtn.style.display='none';
  if(coverImg) coverImg.style.display='none';
  if(coverOverlay) coverOverlay.style.display='none';
}
// تبويب المحفوظات — للمالك فقط (دائماً هنا)
const savedTab=document.getElementById('tab-saved');
if(savedTab) savedTab.style.display='flex';
```

});
loadProfilePosts();
G.profileTab=G.profileTab||‘posts’;
switchProfileTab(G.profileTab);
}

window.uploadCoverImage=async(input)=>{
const file=input.files[0]; if(!file) return;
if(!G.userData?.isVerified){ alert(‘❌ صورة الغلاف للحسابات الموثّقة فقط’); return; }
const data=await compressImg(file,1200,.85);
try{
await updateDoc(doc(db,‘wb_users’,G.user.uid),{coverImage:data});
G.userData={…G.userData,coverImage:data};
const coverImg=document.getElementById(‘prof-cover-img’);
if(coverImg){ coverImg.src=data; coverImg.style.display=‘block’; }
const coverOverlay=document.getElementById(‘prof-cover-overlay’);
if(coverOverlay) coverOverlay.style.display=‘block’;
}catch(e){ alert(’خطأ: ’+e.message); }
};

function loadProfilePosts(){
if(G.unsubs.myPosts) G.unsubs.myPosts();
// بدون orderBy لتجنب Firestore Index
const q=query(collection(db,‘wb_posts’),where(‘authorId’,’==’,G.user.uid));
G.unsubs.myPosts=onSnapshot(q,snap=>{
G.allMyPosts=[];
snap.forEach(d=>G.allMyPosts.push({id:d.id,…d.data()}));
G.allMyPosts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
document.getElementById(‘prof-posts-n’).textContent=G.allMyPosts.length;
renderProfileGrid();
},err=>console.error(‘Profile posts:’,err));
if(G.unsubs.mySaved) G.unsubs.mySaved();
const q2=query(collection(db,‘wb_posts’),where(‘savedBy’,‘array-contains’,G.user.uid));
G.unsubs.mySaved=onSnapshot(q2,snap=>{
G.allMySaved=[];
snap.forEach(d=>G.allMySaved.push({id:d.id,…d.data()}));
G.allMySaved.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
if(G.profileTab===‘saved’) renderProfileGrid();
},err=>console.error(‘Saved posts:’,err));
}

window.switchProfileTab=(tab)=>{
G.profileTab=tab;
[‘posts’,‘reels’,‘saved’].forEach(t=>{
const btn=document.getElementById(‘tab-’+t);
if(!btn) return;
btn.style.borderBottom=t===tab?‘2.5px solid #5c7a4e’:‘none’;
btn.style.color=t===tab?’#3d5236’:’#6b7a5a’;
btn.style.fontWeight=t===tab?‘800’:‘600’;
});
// إظهار المحتوى الصحيح
const grid=document.getElementById(‘prof-grid’);
const reelsGrid=document.getElementById(‘prof-reels-grid’);
if(grid) grid.style.display=tab===‘posts’||tab===‘saved’?’’:‘none’;
if(reelsGrid) reelsGrid.style.display=tab===‘reels’?‘block’:‘none’;
document.getElementById(‘prof-empty’).style.display=‘none’;
document.getElementById(‘prof-reels-empty’).style.display=‘none’;

if(tab===‘reels’) loadMyReels();
else renderProfileGrid();
};

function loadMyReels(){
const grid=document.getElementById(‘prof-reels-grid’);
const empty=document.getElementById(‘prof-reels-empty’);
grid.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
empty.style.display=‘none’;
getDocs(query(collection(db,‘wb_reels’),where(‘authorId’,’==’,G.user.uid))).then(snap=>{
grid.innerHTML=’’;
if(snap.empty){empty.style.display=‘block’;return;}
const reels=[]; snap.forEach(d=>reels.push({id:d.id,…d.data()}));
reels.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
// grid 3×N مثل المنشورات
grid.style.cssText=‘display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:2px’;
reels.forEach(r=>{
const el=document.createElement(‘div’);
el.style.cssText=‘aspect-ratio:9/16;overflow:hidden;cursor:pointer;position:relative;background:#000’;
el.innerHTML=` ${r.thumbnailUrl?`<img src="${r.thumbnailUrl}" style="width:100%;height:100%;object-fit:cover">` :`<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#1a1a2e;color:rgba(255,255,255,.4)"><i class="fas fa-clapperboard"></i></div>`} <div style="position:absolute;bottom:4px;right:5px;color:#fff;font-size:.62rem;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.8);display:flex;align-items:center;gap:3px"><i class="fas fa-heart" style="font-size:.6rem"></i>${r.likes||0}</div> <div style="position:absolute;top:4px;right:5px"><i class="fas fa-clapperboard" style="color:rgba(255,255,255,.8);font-size:.65rem"></i></div>`;
el.onclick=()=>openReelModal(r);
grid.appendChild(el);
});
}).catch(()=>{ grid.innerHTML=’’; empty.style.display=‘block’; });
}

// ── قائمة المتابعين / المتابَعين ──
window.openFollowersList = async (type) => {
document.getElementById(‘followers-modal’)?.remove();

const modal = document.createElement(‘div’);
modal.id = ‘followers-modal’;
modal.className = ‘overlay’;
modal.onclick = (e) => { if(e.target===modal) modal.classList.remove(‘open’); };

const isDark = document.body.classList.contains(‘dark’);
modal.innerHTML = ` <div class="sheet" onclick="event.stopPropagation()" style="max-height:88vh;overflow-y:auto;${isDark?'background:#161d12':''}"> <div class="sheet-handle"></div> <div style="font-weight:900;font-size:1rem;margin-bottom:14px;display:flex;align-items:center;gap:8px"> ${type==='followers'?'👥 المتابعون':'💚 المتابَعون'} </div> <div id="fl-search-wrap" style="position:relative;margin-bottom:12px"> <i class="fas fa-search" style="position:absolute;right:14px;top:50%;transform:translateY(-50%);color:#5c7a4e;font-size:.85rem"></i> <input id="fl-search-inp" placeholder="ابحث..." oninput="filterFollowersList(this.value)" style="width:100%;padding:10px 38px 10px 14px;border:1.5px solid rgba(92,122,78,.2);border-radius:14px;background:${isDark?'#1e2a1a':'#f5f0e8'};font-family:Cairo,sans-serif;font-size:.88rem;color:${isDark?'#f0ede8':'#2c3a1e'};outline:none;text-align:right;box-sizing:border-box;"> </div> <div id="fl-list"><div class="spin"><i class="fas fa-circle-notch"></i></div></div> </div>`;

document.body.appendChild(modal);
modal.classList.add(‘open’);

try{
let users = [];
if(type === ‘followers’){
// من يتابعني
const snap = await getDocs(query(collection(db,‘wb_follows’), where(‘followingId’,’==’,G.user.uid)));
const ids = []; snap.forEach(d=>ids.push(d.data().followerId));
for(const uid of ids){
const s = await getDoc(doc(db,‘wb_users’,uid));
if(s.exists()) users.push({uid,…s.data()});
}
} else {
// من أتابعه
const snap = await getDocs(query(collection(db,‘wb_follows’), where(‘followerId’,’==’,G.user.uid)));
const ids = []; snap.forEach(d=>ids.push(d.data().followingId));
for(const uid of ids){
const s = await getDoc(doc(db,‘wb_users’,uid));
if(s.exists()) users.push({uid,…s.data()});
}
}
window._flUsers = users;
window._flType = type;
renderFollowersList(users, type);
}catch(e){
document.getElementById(‘fl-list’).innerHTML=`<div class="empty"><p>خطأ: ${e.message}</p></div>`;
}
};

window.filterFollowersList = (q) => {
if(!window._flUsers) return;
const filtered = !q ? window._flUsers : window._flUsers.filter(u =>
u.name?.toLowerCase().includes(q.toLowerCase()) ||
u.username?.toLowerCase().includes(q.toLowerCase())
);
renderFollowersList(filtered, window._flType);
};

function renderFollowersList(users, type){
const list = document.getElementById(‘fl-list’);
if(!list) return;
if(!users.length){
list.innerHTML=’<div class="empty"><i class="fas fa-users"></i><p>لا يوجد أحد هنا</p></div>’;
return;
}
list.innerHTML=’’;
users.forEach(u=>{
const el = document.createElement(‘div’);
el.style.cssText = ‘display:flex;align-items:center;gap:12px;padding:12px 4px;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML = ` <div onclick="document.getElementById('followers-modal').classList.remove('open');openPubProfile('${u.uid}')" style="width:48px;height:48px;border-radius:50%;background:#8aab7a;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:1.1rem;cursor:pointer"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:(u.name?.[0]||'م')} </div> <div style="flex:1;min-width:0;cursor:pointer" onclick="document.getElementById('followers-modal').classList.remove('open');openPubProfile('${u.uid}')"> <div style="font-weight:800;font-size:.9rem;display:flex;align-items:center;gap:4px">${u.name||'مستخدم'}${vbadge(u.isVerified)}</div> <div style="font-size:.74rem;color:#6b7a5a;margin-top:2px">@${u.username||''} · ${u.followers||0} متابع</div> </div> <div style="position:relative"> <button onclick="toggleFlMenu('${u.uid}')" style="background:rgba(92,122,78,.1);border:none;color:#5c7a4e;width:34px;height:34px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:.9rem"> <i class="fas fa-ellipsis-v"></i> </button> <div id="fl-menu-${u.uid}" style="display:none;position:absolute;left:0;top:40px;background:#fff;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.15);z-index:100;min-width:160px;overflow:hidden;${document.body.classList.contains('dark')?'background:#1e2a1a':''}"> <button onclick="document.getElementById('followers-modal').classList.remove('open');openPubProfile('${u.uid}')" style="width:100%;padding:12px 16px;border:none;background:none;font-family:Cairo,sans-serif;font-size:.85rem;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px;color:inherit"> <i class="fas fa-user" style="color:#5c7a4e"></i> عرض الملف </button> ${type==='followers'?`
<button onclick="removeFollower('${u.uid}','${(u.name||'').replace(/'/g,'')}')" 
style="width:100%;padding:12px 16px;border:none;background:none;font-family:Cairo,sans-serif;font-size:.85rem;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px;color:#e67e22">
<i class="fas fa-user-minus" style="color:#e67e22"></i> إزالة من المتابعين
</button>`:`
<button onclick="flUnfollow('${u.uid}','${(u.name||'').replace(/'/g,'')}')"
style="width:100%;padding:12px 16px;border:none;background:none;font-family:Cairo,sans-serif;font-size:.85rem;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px;color:#e67e22">
<i class="fas fa-user-minus" style="color:#e67e22"></i> إلغاء المتابعة
</button>`} <button onclick="flMuteUser('${u.uid}','${(u.name||'').replace(/'/g,'')}')" style="width:100%;padding:12px 16px;border:none;background:none;font-family:Cairo,sans-serif;font-size:.85rem;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px;color:#f39c12"> <i class="fas fa-volume-mute" style="color:#f39c12"></i> كتم المستخدم </button> <button onclick="flBlockUser('${u.uid}','${(u.name||'').replace(/'/g,'')}')" style="width:100%;padding:12px 16px;border:none;background:none;font-family:Cairo,sans-serif;font-size:.85rem;cursor:pointer;text-align:right;display:flex;align-items:center;gap:8px;color:#e74c3c"> <i class="fas fa-ban" style="color:#e74c3c"></i> حظر المستخدم </button> </div> </div>`;
list.appendChild(el);
});
// إغلاق القوائم عند النقر خارجها
document.addEventListener(‘click’, ()=>{
document.querySelectorAll(’[id^=“fl-menu-”]’).forEach(m=>m.style.display=‘none’);
}, {once:true});
}

window.toggleFlMenu = (uid) => {
const menu = document.getElementById(`fl-menu-${uid}`);
document.querySelectorAll(’[id^=“fl-menu-”]’).forEach(m=>{ if(m.id!==`fl-menu-${uid}`) m.style.display=‘none’; });
menu.style.display = menu.style.display===‘none’ ? ‘block’ : ‘none’;
event.stopPropagation();
};

// إزالة متابع
window.removeFollower = async (uid, name) => {
if(!confirm(`إزالة ${name} من متابعيك؟`)) return;
try{
await deleteDoc(doc(db,‘wb_follows’,`${uid}_${G.user.uid}`));
await updateDoc(doc(db,‘wb_users’,G.user.uid),{followers:increment(-1)});
await updateDoc(doc(db,‘wb_users’,uid),{following:increment(-1)});
window._flUsers = window._flUsers.filter(u=>u.uid!==uid);
renderFollowersList(window._flUsers, ‘followers’);
document.getElementById(‘prof-followers-n’).textContent = Math.max(0,(parseInt(document.getElementById(‘prof-followers-n’).textContent)||1)-1);
}catch(e){ alert(’خطأ: ’+e.message); }
};

// إلغاء متابعة
window.flUnfollow = async (uid, name) => {
if(!confirm(`إلغاء متابعة ${name}؟`)) return;
try{
await deleteDoc(doc(db,‘wb_follows’,`${G.user.uid}_${uid}`));
await updateDoc(doc(db,‘wb_users’,uid),{followers:increment(-1)});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{following:increment(-1)});
window._flUsers = window._flUsers.filter(u=>u.uid!==uid);
renderFollowersList(window._flUsers, ‘following’);
document.getElementById(‘prof-following-n’).textContent = Math.max(0,(parseInt(document.getElementById(‘prof-following-n’).textContent)||1)-1);
}catch(e){ alert(’خطأ: ’+e.message); }
};

// كتم من قائمة المتابعين
window.flMuteUser = async (uid, name) => {
document.querySelectorAll(’[id^=“fl-menu-”]’).forEach(m=>m.style.display=‘none’);
await muteUser(uid);
};

// حظر من قائمة المتابعين
window.flBlockUser = async (uid, name) => {
document.querySelectorAll(’[id^=“fl-menu-”]’).forEach(m=>m.style.display=‘none’);
if(!confirm(`حظر ${name}؟ لن يتمكن من رؤية ملفك أو التفاعل معك.`)) return;
const blocked=[…(G.userData?.blockedUsers||[])];
if(!blocked.includes(uid)){
blocked.push(uid);
await updateDoc(doc(db,‘wb_users’,G.user.uid),{blockedUsers:blocked});
G.userData={…G.userData,blockedUsers:blocked};
}
// إزالته من القائمة
window._flUsers = window._flUsers.filter(u=>u.uid!==uid);
renderFollowersList(window._flUsers, window._flType);
alert(‘✅ تم الحظر’);
};
window.openReelModal = (r) => {
document.getElementById(‘reel-modal-overlay’)?.remove();
const overlay = document.createElement(‘div’);
overlay.id = ‘reel-modal-overlay’;
overlay.style.cssText = ‘position:fixed;inset:0;background:#000;z-index:5000;display:flex;flex-direction:column;’;

const liked = (r.likedBy||[]).includes(G.user?.uid||’’);
overlay.innerHTML = ` <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;position:absolute;top:0;left:0;right:0;z-index:10;background:linear-gradient(to bottom,rgba(0,0,0,.7),transparent);"> <button onclick="document.getElementById('reel-modal-overlay').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:1.1rem;display:flex;align-items:center;justify-content:center;"><i class="fas fa-times"></i></button> <div style="flex:1;color:#fff;font-weight:700;font-size:.9rem">${r.authorName||'ريل'}</div> </div> <video id="reel-modal-video" src="${r.videoUrl||''}" style="width:100%;height:100%;object-fit:contain;" autoplay loop playsinline controls></video> <div style="position:absolute;bottom:0;left:0;right:0;padding:20px 16px 36px;background:linear-gradient(to top,rgba(0,0,0,.8),transparent);z-index:10;"> <div style="color:rgba(255,255,255,.9);font-size:.88rem;margin-bottom:14px">${r.caption||''}</div> <div style="display:flex;gap:20px;align-items:center;"> <button id="reel-modal-like" onclick="toggleReelLike('${r.id}',this)" class="reel-act ${liked?'liked':''}" style="flex-direction:row;gap:8px;padding:0;"> <i class="${liked?'fas':'far'} fa-heart" style="font-size:1.6rem;${liked?'color:#e74c3c':'color:#fff'}"></i> <span id="reel-modal-likes" style="color:#fff;font-size:.9rem;font-weight:700">${r.likes||0}</span> </button> <button onclick="openComments('${r.id}')" style="background:none;border:none;color:#fff;display:flex;align-items:center;gap:8px;cursor:pointer;"> <i class="far fa-comment" style="font-size:1.6rem"></i> <span style="font-size:.9rem;font-weight:700">${r.comments||0}</span> </button> <button onclick="sharePost('${r.id}','')" style="background:none;border:none;color:#fff;display:flex;align-items:center;gap:8px;cursor:pointer;"> <i class="fas fa-share-alt" style="font-size:1.5rem"></i> </button> </div> </div>`;

document.body.appendChild(overlay);
};

// ── Post Modal (عرض المنشور كاملاً من الملف الشخصي) ──
window.openPostModal = (post) => {
// أزل أي modal قديم
document.getElementById(‘post-modal-overlay’)?.remove();

const overlay = document.createElement(‘div’);
overlay.id = ‘post-modal-overlay’;
overlay.style.cssText = ‘position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:5000;display:flex;align-items:flex-end;backdrop-filter:blur(4px);’;
overlay.onclick = (e) => { if(e.target===overlay) overlay.remove(); if(G.unsubs.comments){G.unsubs.comments();G.unsubs.comments=null;} };

const sheet = document.createElement(‘div’);
sheet.style.cssText = ‘background:#faf7f0;width:100%;max-height:92vh;border-radius:24px 24px 0 0;overflow-y:auto;padding-bottom:24px;’;
if(document.body.classList.contains(‘dark’)) sheet.style.background=’#161d12’;

sheet.innerHTML = ` <div style="width:40px;height:4px;background:#d4c9a8;border-radius:2px;margin:14px auto 10px;"></div> <div id="post-modal-body"></div> <div style="padding:14px 16px 6px;font-weight:800;font-size:.9rem;border-top:1px solid rgba(92,122,78,.12);margin-top:6px">💬 التعليقات</div> <div id="post-modal-comments" style="padding:0 16px;min-height:60px"></div> <div style="display:flex;gap:8px;padding:12px 16px;"> <input id="post-modal-inp" class="chat-inp" placeholder="اكتب تعليقاً..." style="flex:1" onkeydown="if(event.key==='Enter')submitModalComment('${post.id}')"> <button onclick="submitModalComment('${post.id}')" class="chat-send"><i class="fas fa-paper-plane"></i></button> </div>`;

overlay.appendChild(sheet);
document.body.appendChild(overlay);

// بناء كارت المنشور
const body = sheet.querySelector(’#post-modal-body’);
const card = buildPostCard(post, true);
// إخفاء زر التعليق من الكارت لأنه موجود أسفل
body.appendChild(card);

// تحميل التعليقات
const commList = sheet.querySelector(’#post-modal-comments’);
commList.innerHTML = ‘<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
G.currentPostId = post.id;
if(G.unsubs.comments) G.unsubs.comments();
const q = query(collection(db,‘wb_comments’), where(‘postId’,’==’,post.id));
G.unsubs.comments = onSnapshot(q, snap => {
const arr = []; snap.forEach(d=>arr.push({id:d.id,…d.data()}));
arr.sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
commList.innerHTML = ‘’;
if(!arr.length){ commList.innerHTML=’<div style="text-align:center;padding:16px;color:#6b7a5a;font-size:.82rem">لا توجد تعليقات — كن الأول!</div>’; return; }
arr.forEach(c=>{
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(92,122,78,.08)’;
const t=c.createdAt?.toDate?timeAgo(c.createdAt.toDate()):’’;
el.innerHTML=` <div style="width:34px;height:34px;border-radius:50%;background:#8aab7a;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:.85rem"> ${c.authorAvatar?`<img src="${c.authorAvatar}" style="width:100%;height:100%;object-fit:cover">`:(c.authorName?.[0]||'م')} </div> <div style="flex:1"> <div style="font-weight:700;font-size:.8rem">${c.authorName||'مستخدم'}${vbadge(c.authorVerified)}</div> <div style="font-size:.85rem;line-height:1.5;margin-top:2px">${c.text}</div> <div style="font-size:.68rem;color:#6b7a5a;margin-top:3px">${t}</div> </div>`;
commList.appendChild(el);
});
});
};

window.submitModalComment = async (postId) => {
const inp = document.getElementById(‘post-modal-inp’);
const text = inp?.value.trim(); if(!text||!postId) return;
inp.value = ‘’;
try{
await addDoc(collection(db,‘wb_comments’),{postId,text,authorId:G.user.uid,authorName:G.userData?.name||’’,authorAvatar:G.userData?.avatar||’’,authorVerified:G.userData?.isVerified||false,authorIsAdmin:G.userData?.isAdmin||false,createdAt:serverTimestamp()});
await updateDoc(doc(db,‘wb_posts’,postId),{comments:increment(1)});
const pSnap=await getDoc(doc(db,‘wb_posts’,postId));
if(pSnap.exists()&&pSnap.data().authorId!==G.user.uid){
await addDoc(collection(db,‘wb_notifications’),{userId:pSnap.data().authorId,type:‘comment’,actorId:G.user.uid,actorName:G.userData?.name||’’,postId,read:false,createdAt:serverTimestamp()});
sendNtfy(‘💬 تعليق جديد — Webook’,`${G.userData?.name||'مستخدم'} علّق\n"${text.substring(0,80)}"`, ‘speech_balloon’, ‘welikecomm’);
}
}catch(e){ inp.value=text; }
};
function renderProfileGrid(){
const posts=G.profileTab===‘posts’?G.allMyPosts:G.allMySaved;
const grid=document.getElementById(‘prof-grid’);
const empty=document.getElementById(‘prof-empty’);
grid.innerHTML=’’;
if(!posts.length){empty.style.display=‘block’;return;}
empty.style.display=‘none’;
posts.forEach(p=>{
const d=document.createElement(‘div’); d.className=‘profile-grid-item’;
d.style.cssText=‘aspect-ratio:1;overflow:hidden;cursor:pointer;position:relative;background:#ede6d5;’;
if(p.imageUrl){
const img=document.createElement(‘img’);
img.src=p.imageUrl; img.loading=‘lazy’;
img.style.cssText=‘width:100%;height:100%;object-fit:cover;’;
d.appendChild(img);
} else {
const inner=document.createElement(‘div’);
inner.style.cssText=‘width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:8px;background:linear-gradient(135deg,#5c7a4e,#3d5236);’;
const txt=document.createElement(‘div’);
txt.style.cssText=‘color:#fff;font-size:.72rem;font-weight:600;text-align:center;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;’;
txt.textContent=p.text||’’;
inner.appendChild(txt);
d.appendChild(inner);
}
// عرض المنشور كاملاً في نافذة منبثقة
d.onclick=()=>openPostModal(p);
grid.appendChild(d);
});
}

// Edit Profile
window.openEditProfile=()=>{
const ud=G.userData||{};
document.getElementById(‘ep-name’).value=ud.name||’’;
document.getElementById(‘ep-username’).value=ud.username||’’;
document.getElementById(‘ep-bio’).value=ud.bio||’’;
document.getElementById(‘ep-link’).value=ud.link||’’;
G.epAvData=null;
const prev=document.getElementById(‘ep-av-prev’);
prev.innerHTML=ud.avatar?`<img src="${ud.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(ud.name?.[0]||‘م’);

// عرض معلومات الانتظار
const infoEl=document.getElementById(‘ep-username-info’);
if(infoEl){
const isVerified=ud.isVerified||false;
const cooldown=isVerified?2:5;
const lastChange=ud.lastUsernameChange;
if(lastChange){
const lastMs=lastChange.toDate?lastChange.toDate().getTime():lastChange;
const daysSince=(Date.now()-lastMs)/(1000*60*60*24);
if(daysSince<cooldown){
const remaining=Math.ceil(cooldown-daysSince);
infoEl.style.display=‘block’;
infoEl.style.color=’#e67e22’;
infoEl.innerHTML=`⏳ يمكنك تغيير اليوزر بعد ${remaining} يوم${remaining===1?'':''}${isVerified?' (حساب موثّق)':''}`;
} else {
infoEl.style.display=‘block’;
infoEl.style.color=’#27ae60’;
infoEl.innerHTML=isVerified?‘✅ يمكنك تغيير اليوزر (موثّق — مرة كل يومين)’:‘✅ يمكنك تغيير اليوزر (مرة كل 5 أيام)’;
}
} else {
infoEl.style.display=‘block’;
infoEl.style.color=’#6b7a5a’;
infoEl.innerHTML=isVerified?‘ℹ️ يمكنك تغيير اليوزر مرة كل يومين (موثّق)’:‘ℹ️ يمكنك تغيير اليوزر مرة كل 5 أيام’;
}
}

openOverlay(‘edit-profile-overlay’);
};
window.previewEditAvatar=async input=>{
const file=input.files[0];if(!file)return;
G.epAvData=await compressImg(file,400,.85);
document.getElementById(‘ep-av-prev’).innerHTML=`<img src="${G.epAvData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
};
window.saveProfile=async()=>{
const name=document.getElementById(‘ep-name’).value.trim();
const username=document.getElementById(‘ep-username’).value.trim().replace(’@’,’’).toLowerCase();
const bio=document.getElementById(‘ep-bio’).value.trim();
const link=document.getElementById(‘ep-link’).value.trim();
const avatar=G.epAvData||G.userData?.avatar||’’;
const isVerified=G.userData?.isVerified||false;

if(!name){ alert(‘❌ أدخل الاسم الكامل’); return; }
if(!username){ alert(‘❌ أدخل اسم المستخدم’); return; }

// قواعد اليوزر حسب التوثيق
if(isVerified){
// الموثّق: حرف واحد على الأقل، أي أحرف وأرقام وشرطة سفلية
if(!/^[a-z0-9_]+$/.test(username)){
alert(‘❌ اسم المستخدم يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط’);
return;
}
if(username.length < 1){ alert(‘❌ اسم المستخدم حرف واحد على الأقل’); return; }
} else {
// غير الموثّق: 3 أحرف على الأقل
if(!/^[a-z0-9_]+$/.test(username)){
alert(‘❌ اسم المستخدم يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطة سفلية فقط’);
return;
}
if(username.length < 3){ alert(‘❌ اسم المستخدم يجب أن يكون 3 أحرف على الأقل’); return; }
}

// فحص تغيير اليوزر فقط إذا تغيّر
if(username !== G.userData?.username){

```
// فحص مدة الانتظار
const lastChange=G.userData?.lastUsernameChange;
if(lastChange){
  const lastMs = lastChange.toDate ? lastChange.toDate().getTime() : lastChange;
  const daysSince=(Date.now()-lastMs)/(1000*60*60*24);
  const cooldown=isVerified?2:5; // موثّق: يومان، عادي: 5 أيام
  if(daysSince<cooldown){
    const remaining=Math.ceil(cooldown-daysSince);
    alert(`⏳ يمكنك تغيير اسم المستخدم مرة كل ${cooldown} أيام\nالوقت المتبقي: ${remaining} يوم${remaining===1?'':''}${isVerified?' (حساب موثّق)':''}`);
    return;
  }
}

// فحص تكرار اليوزر
const check=await getDocs(query(collection(db,'wb_users'),where('username','==',username)));
if(!check.empty){
  alert(`❌ اسم المستخدم @${username} مأخوذ — اختر اسماً آخر`);
  return;
}
```

}

try{
const updateData={name,username,bio,link,avatar};
// حفظ وقت تغيير اليوزر فقط إذا تغيّر
if(username !== G.userData?.username) updateData.lastUsernameChange=serverTimestamp();

```
await updateDoc(doc(db,'wb_users',G.user.uid),updateData);
G.userData={...G.userData,...updateData};
G.epAvData=null;
closeOverlay('edit-profile-overlay');
loadMyProfile();
alert('✅ تم الحفظ');
```

}catch(e){alert(’خطأ: ’+e.message);}
};

// ── Settings Functions ──
window.toggleHideFollowers=async()=>{
const v=!G.userData?.hideFollowers;
await updateDoc(doc(db,‘wb_users’,G.user.uid),{hideFollowers:v});
G.userData={…G.userData,hideFollowers:v};
document.getElementById(‘hide-followers-toggle’).classList.toggle(‘on’,v);
};
window.saveDmPerm=async(val)=>{
await updateDoc(doc(db,‘wb_users’,G.user.uid),{dmPerm:val});
G.userData={…G.userData,dmPerm:val};
};
window.toggleNotifPref=async(type,btn)=>{
const prefs=G.userData?.notifPrefs||{likes:true,comments:true,follows:true};
prefs[type]=!prefs[type];
btn.classList.toggle(‘on’,prefs[type]);
await updateDoc(doc(db,‘wb_users’,G.user.uid),{notifPrefs:prefs});
G.userData={…G.userData,notifPrefs:prefs};
};

// تحميل إعدادات الصفحة
function loadSettingsPage(){
const ud=G.userData||{};
document.getElementById(‘private-toggle’)?.classList.toggle(‘on’,!!ud.isPrivate);
document.getElementById(‘hide-followers-toggle’)?.classList.toggle(‘on’,!!ud.hideFollowers);
const dmSel=document.getElementById(‘dm-perm’);
if(dmSel) dmSel.value=ud.dmPerm||‘all’;
const prefs=ud.notifPrefs||{likes:true,comments:true,follows:true};
[‘likes’,‘comments’,‘follows’].forEach(t=>{
document.getElementById(`notif-${t}-toggle`)?.classList.toggle(‘on’,prefs[t]!==false);
});
// عدد الطلبات المعلقة
getDocs(query(collection(db,‘wb_follow_requests’),where(‘toUserId’,’==’,G.user.uid),where(‘status’,’==’,‘pending’))).then(s=>{
const el=document.getElementById(‘follow-req-count’);
if(el) el.textContent=s.size;
});
// عدد المحظورين والمكتومين
const blocked=ud.blockedUsers||[];
const muted=ud.mutedUsers||[];
const bc=document.getElementById(‘blocked-count’);const mc=document.getElementById(‘muted-count’);
if(bc) bc.textContent=blocked.length;
if(mc) mc.textContent=muted.length;
}

// طلبات المتابعة
window.openFollowRequests=()=>{
let modal=document.getElementById(‘follow-req-modal’);
if(modal) modal.remove();
modal=document.createElement(‘div’);
modal.id=‘follow-req-modal’;
modal.className=‘overlay’;
modal.innerHTML=` <div class="sheet" onclick="event.stopPropagation()" style="max-height:80vh;overflow-y:auto"> <div class="sheet-handle"></div> <div class="sheet-title">⏳ طلبات المتابعة</div> <div id="follow-req-list"><div class="spin"><i class="fas fa-circle-notch"></i></div></div> </div>`;
modal.onclick=()=>modal.classList.remove(‘open’);
document.body.appendChild(modal);
modal.classList.add(‘open’);
getDocs(query(collection(db,‘wb_follow_requests’),where(‘toUserId’,’==’,G.user.uid),where(‘status’,’==’,‘pending’))).then(snap=>{
const list=document.getElementById(‘follow-req-list’);
if(snap.empty){list.innerHTML=’<div class="empty"><i class="fas fa-user-check"></i><p>لا توجد طلبات معلقة</p></div>’;return;}
list.innerHTML=’’;
snap.forEach(d=>{
const r={id:d.id,…d.data()};
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML=` <div style="width:44px;height:44px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0"> ${r.fromUserAvatar?`<img src="${r.fromUserAvatar}" style="width:100%;height:100%;object-fit:cover">`:r.fromUserName?.[0]||'م'} </div> <div style="flex:1"><div style="font-weight:700;font-size:.88rem">${r.fromUserName}</div></div> <button onclick="acceptFollowReq('${r.id}','${r.fromUserId}',this.closest('div[style]'))" class="btn-primary" style="padding:7px 12px;font-size:.78rem">قبول</button> <button onclick="rejectFollowReq('${r.id}',this.closest('div[style]'))" class="btn-secondary" style="padding:7px 12px;font-size:.78rem">رفض</button>`;
list.appendChild(el);
});
});
};

// المحظورون
window.openBlockedList=()=>{
const blocked=G.userData?.blockedUsers||[];
let modal=document.getElementById(‘blocked-modal’);
if(modal) modal.remove();
modal=document.createElement(‘div’);
modal.id=‘blocked-modal’;
modal.className=‘overlay’;
modal.innerHTML=` <div class="sheet" onclick="event.stopPropagation()" style="max-height:80vh;overflow-y:auto"> <div class="sheet-handle"></div> <div class="sheet-title">🚫 المستخدمون المحظورون</div> <div id="blocked-list"></div> </div>`;
modal.onclick=()=>modal.classList.remove(‘open’);
document.body.appendChild(modal);
modal.classList.add(‘open’);
const list=document.getElementById(‘blocked-list’);
if(!blocked.length){list.innerHTML=’<div class="empty"><i class="fas fa-ban"></i><p>لا يوجد مستخدمون محظورون</p></div>’;return;}
list.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
Promise.all(blocked.map(uid=>getDoc(doc(db,‘wb_users’,uid)))).then(snaps=>{
list.innerHTML=’’;
snaps.forEach((s,i)=>{
const u=s.data()||{name:‘مستخدم’,avatar:’’};
const uid=blocked[i];
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML=` <div style="width:44px;height:44px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:u.name?.[0]||'م'} </div> <div style="flex:1"><div style="font-weight:700;font-size:.88rem">${u.name}</div><div style="font-size:.73rem;color:#6b7a5a">@${u.username||''}</div></div> <button onclick="unblockUser('${uid}',this.closest('div[style]'))" style="padding:7px 12px;border-radius:10px;border:1.5px solid #5c7a4e;background:transparent;color:#5c7a4e;font-family:Cairo,sans-serif;font-weight:700;font-size:.78rem;cursor:pointer">إلغاء الحظر</button>`;
list.appendChild(el);
});
});
};

// المكتومون
window.openMutedList=()=>{
const muted=G.userData?.mutedUsers||[];
let modal=document.getElementById(‘muted-modal’);
if(modal) modal.remove();
modal=document.createElement(‘div’);
modal.id=‘muted-modal’;
modal.className=‘overlay’;
modal.innerHTML=` <div class="sheet" onclick="event.stopPropagation()" style="max-height:80vh;overflow-y:auto"> <div class="sheet-handle"></div> <div class="sheet-title">🔇 المستخدمون المكتومون</div> <div id="muted-list"></div> </div>`;
modal.onclick=()=>modal.classList.remove(‘open’);
document.body.appendChild(modal);
modal.classList.add(‘open’);
const list=document.getElementById(‘muted-list’);
if(!muted.length){list.innerHTML=’<div class="empty"><i class="fas fa-volume-mute"></i><p>لا يوجد مستخدمون مكتومون</p></div>’;return;}
list.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
Promise.all(muted.map(uid=>getDoc(doc(db,‘wb_users’,uid)))).then(snaps=>{
list.innerHTML=’’;
snaps.forEach((s,i)=>{
const u=s.data()||{name:‘مستخدم’,avatar:’’};
const uid=muted[i];
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML=` <div style="width:44px;height:44px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:u.name?.[0]||'م'} </div> <div style="flex:1"><div style="font-weight:700;font-size:.88rem">${u.name}</div><div style="font-size:.73rem;color:#6b7a5a">@${u.username||''}</div></div> <button onclick="unmuteUser('${uid}',this.closest('div[style]'))" style="padding:7px 12px;border-radius:10px;border:1.5px solid #5c7a4e;background:transparent;color:#5c7a4e;font-family:Cairo,sans-serif;font-weight:700;font-size:.78rem;cursor:pointer">إلغاء الكتم</button>`;
list.appendChild(el);
});
});
};

// حظر/كتم/إلغاء
window.blockUser=async(uid)=>{
if(!uid||uid===G.user.uid)return;
const blocked=[…(G.userData?.blockedUsers||[])];
if(blocked.includes(uid)){alert(‘هذا المستخدم محظور بالفعل’);return;}
if(!confirm(‘هل تريد حظر هذا المستخدم؟’))return;
blocked.push(uid);
await updateDoc(doc(db,‘wb_users’,G.user.uid),{blockedUsers:blocked});
G.userData={…G.userData,blockedUsers:blocked};
alert(‘✅ تم الحظر’);
closeOverlay(‘pub-profile-overlay’);
};
window.unblockUser=async(uid,el)=>{
const blocked=(G.userData?.blockedUsers||[]).filter(u=>u!==uid);
await updateDoc(doc(db,‘wb_users’,G.user.uid),{blockedUsers:blocked});
G.userData={…G.userData,blockedUsers:blocked};
el.style.opacity=’.3’;setTimeout(()=>{el.remove();loadSettingsPage();},300);
};
window.muteUser=async(uid)=>{
if(!uid||uid===G.user.uid)return;
const muted=[…(G.userData?.mutedUsers||[])];
if(muted.includes(uid)){alert(‘هذا المستخدم مكتوم بالفعل’);return;}
if(!confirm(‘هل تريد كتم هذا المستخدم؟ (لن تظهر منشوراته في فيدك)’))return;
muted.push(uid);
await updateDoc(doc(db,‘wb_users’,G.user.uid),{mutedUsers:muted});
G.userData={…G.userData,mutedUsers:muted};
alert(‘✅ تم الكتم’);
};
window.unmuteUser=async(uid,el)=>{
const muted=(G.userData?.mutedUsers||[]).filter(u=>u!==uid);
await updateDoc(doc(db,‘wb_users’,G.user.uid),{mutedUsers:muted});
G.userData={…G.userData,mutedUsers:muted};
el.style.opacity=’.3’;setTimeout(()=>{el.remove();loadSettingsPage();},300);
};
window.deleteMyAccount=async()=>{
try{
await deleteDoc(doc(db,‘wb_users’,G.user.uid));
await G.user.delete();
alert(‘تم حذف حسابك’);
}catch(e){alert(‘خطأ: ‘+e.message+’\nقد تحتاج إعادة تسجيل الدخول أولاً’);}
};

// ══════════════════════════════
// PUBLIC PROFILE
// ══════════════════════════════
window.openPubProfile=async(uid)=>{
if(!uid||uid===G.user?.uid){goPage(‘profile-page’);return;}
G.pubProfileUid=uid;

// افتح الـ overlay فوراً ببيانات بسيطة
openOverlay(‘pub-profile-overlay’);
document.getElementById(‘pub-name’).innerHTML=’…’;
document.getElementById(‘pub-handle’).textContent=’’;
document.getElementById(‘pub-bio-t’).textContent=’’;
document.getElementById(‘pub-posts-n’).textContent=‘0’;
document.getElementById(‘pub-followers-n’).textContent=‘0’;
document.getElementById(‘pub-av’).innerHTML=‘م’;
document.getElementById(‘pub-posts-list’).innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;

try{
const snap=await getDoc(doc(db,‘wb_users’,uid));
if(!snap.exists())return;
const u=snap.data();
document.getElementById(‘pub-name’).innerHTML=(u.name||‘مستخدم’)+vbadge(u.isVerified,‘lg’);
document.getElementById(‘pub-handle’).textContent=’@’+(u.username||’—’);
document.getElementById(‘pub-bio-t’).textContent=u.bio||’’;
document.getElementById(‘pub-posts-n’).textContent=u.posts||0;
document.getElementById(‘pub-followers-n’).textContent=u.followers||0;
document.getElementById(‘pub-av’).innerHTML=u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:(u.name?.[0]||‘م’);
// حالة المتابعة
const fSnap=await getDoc(doc(db,‘wb_follows’,`${G.user.uid}_${uid}`));
const isFollowing=fSnap.exists();
const fbtn=document.getElementById(‘pub-follow-btn’);
fbtn.className=‘follow-btn ‘+(isFollowing?‘following’:‘not-following’);
fbtn.textContent=isFollowing?‘إلغاء المتابعة’:‘متابعة’;
// المنشورات بدون orderBy
const list=document.getElementById(‘pub-posts-list’);
const pSnap=await getDocs(query(collection(db,‘wb_posts’),where(‘authorId’,’==’,uid)));
const posts=[]; pSnap.forEach(d=>posts.push({id:d.id,…d.data()}));
posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
list.innerHTML=’’;
if(!posts.length){list.innerHTML=’<div class="empty"><i class="fas fa-camera"></i><p>لا توجد منشورات</p></div>’;return;}
posts.forEach(p=>list.appendChild(buildPostCard({id:p.id,…p})));
}catch(e){
document.getElementById(‘pub-posts-list’).innerHTML=`<div class="empty"><p>خطأ: ${e.message}</p></div>`;
}
};

window.toggleFollowPub=async()=>{
const uid=G.pubProfileUid; if(!uid||!G.user)return;
const ud=G.userData;
const followId=`${G.user.uid}_${uid}`;
const fbtn=document.getElementById(‘pub-follow-btn’);

// تحقق فوري من الحالة الحالية للزر بدلاً من Firestore
const isCurrentlyFollowing=fbtn.classList.contains(‘following’) && fbtn.textContent!==‘تم إرسال الطلب’;

// تحديث الزر فوراً (optimistic)
if(isCurrentlyFollowing){
fbtn.className=‘follow-btn not-following’;
fbtn.textContent=‘متابعة’;
fbtn.disabled=true;
try{
await deleteDoc(doc(db,‘wb_follows’,followId));
await updateDoc(doc(db,‘wb_users’,uid),{followers:increment(-1)});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{following:increment(-1)});
// تحديث عداد المتابعين في الواجهة
const fc=document.getElementById(‘pub-followers-n’);
if(fc) fc.textContent=Math.max(0,(parseInt(fc.textContent)||1)-1);
}catch(e){ fbtn.className=‘follow-btn following’; fbtn.textContent=‘إلغاء المتابعة’; }
fbtn.disabled=false;
} else {
fbtn.disabled=true;
try{
// هل الحساب خاص؟
const uSnap=await getDoc(doc(db,‘wb_users’,uid));
const targetUser=uSnap.data();
if(targetUser?.isPrivate){
// تحقق إذا أرسل طلب مسبقاً
const existingReq=await getDocs(query(collection(db,‘wb_follow_requests’),where(‘fromUserId’,’==’,G.user.uid),where(‘toUserId’,’==’,uid),where(‘status’,’==’,‘pending’)));
if(!existingReq.empty){
fbtn.className=‘follow-btn following’;
fbtn.textContent=‘تم إرسال الطلب’;
fbtn.disabled=false;
return;
}
await addDoc(collection(db,‘wb_follow_requests’),{fromUserId:G.user.uid,fromUserName:ud?.name||’’,fromUserAvatar:ud?.avatar||’’,toUserId:uid,status:‘pending’,createdAt:serverTimestamp()});
await addDoc(collection(db,‘wb_notifications’),{userId:uid,type:‘follow_request’,actorId:G.user.uid,actorName:ud?.name||’’,read:false,createdAt:serverTimestamp()});
// ntfy طلب متابعة
sendNtfy(‘👥 طلب متابعة — Webook’, `${ud?.name||'مستخدم'} (@${ud?.username||''}) أرسل طلب متابعة`, ‘handshake’, ‘wefrinds’);
fbtn.className=‘follow-btn following’;
fbtn.textContent=‘⏳ تم إرسال الطلب’;
fbtn.disabled=false;
return;
}
// متابعة عادية
fbtn.className=‘follow-btn following’;
fbtn.textContent=‘إلغاء المتابعة’;
await setDoc(doc(db,‘wb_follows’,followId),{followerId:G.user.uid,followingId:uid,createdAt:serverTimestamp()});
await updateDoc(doc(db,‘wb_users’,uid),{followers:increment(1)});
await updateDoc(doc(db,‘wb_users’,G.user.uid),{following:increment(1)});
await addDoc(collection(db,‘wb_notifications’),{userId:uid,type:‘follow’,actorId:G.user.uid,actorName:ud?.name||’’,read:false,createdAt:serverTimestamp()});
// ntfy متابعة جديدة
sendNtfy(‘💚 متابعة جديدة — Webook’, `${ud?.name||'مستخدم'} (@${ud?.username||''}) بدأ بمتابعتك`, ‘green_heart’, ‘wefrinds’);
// تحديث عداد المتابعين
const fc=document.getElementById(‘pub-followers-n’);
if(fc) fc.textContent=(parseInt(fc.textContent)||0)+1;
}catch(e){ fbtn.className=‘follow-btn not-following’; fbtn.textContent=‘متابعة’; }
fbtn.disabled=false;
}
};

// ══════════════════════════════
// COMMENTS
// ══════════════════════════════
window.openComments=async(postId)=>{
G.currentPostId=postId;
openOverlay(‘comments-overlay’);
const list=document.getElementById(‘comments-list’);
list.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;
if(G.unsubs.comments) G.unsubs.comments();
const q=query(collection(db,‘wb_comments’),where(‘postId’,’==’,postId));
G.unsubs.comments=onSnapshot(q,snap=>{
const arr=[];
snap.forEach(d=>arr.push({id:d.id,…d.data()}));
arr.sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
list.innerHTML=’’;
if(!arr.length){list.innerHTML=’<div style="text-align:center;padding:20px;color:#6b7a5a;font-size:.85rem">لا توجد تعليقات — كن الأول!</div>’;return;}
arr.forEach(c=>{
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(92,122,78,.1)’;
el.innerHTML=` <div onclick="openPubProfile('${c.authorId}')" style="width:36px;height:36px;border-radius:50%;background:#8aab7a;flex-shrink:0;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:.9rem;cursor:pointer"> ${c.authorAvatar?`<img src="${c.authorAvatar}" style="width:100%;height:100%;object-fit:cover">`:(c.authorName?.[0]||'م')} </div> <div style="flex:1"> <div style="font-weight:700;font-size:.8rem;display:flex;align-items:center;gap:4px"> ${c.authorName||'مستخدم'}${vbadge(c.authorVerified)}${c.authorIsAdmin?'<span style="background:#e74c3c;color:#fff;border-radius:6px;padding:1px 5px;font-size:.55rem;font-weight:700">أدمن</span>':''} </div> <div style="font-size:.85rem;line-height:1.5;margin-top:2px">${c.text}</div> <div style="font-size:.7rem;color:#6b7a5a;margin-top:3px">${c.createdAt?.toDate?timeAgo(c.createdAt.toDate()):''}</div> </div>`;
list.appendChild(el);
});
list.scrollTop=list.scrollHeight;
});
};
window.submitComment=async()=>{
const inp=document.getElementById(‘comment-inp’);
const text=inp.value.trim(); if(!text||!G.currentPostId)return;
inp.value=’’;
try{
await addDoc(collection(db,‘wb_comments’),{postId:G.currentPostId,text,authorId:G.user.uid,authorName:G.userData?.name||’’,authorAvatar:G.userData?.avatar||’’,authorVerified:G.userData?.isVerified||false,authorIsAdmin:G.userData?.isAdmin||false,createdAt:serverTimestamp()});
await updateDoc(doc(db,‘wb_posts’,G.currentPostId),{comments:increment(1)});
// Notification
const pSnap=await getDoc(doc(db,‘wb_posts’,G.currentPostId));
if(pSnap.exists()&&pSnap.data().authorId!==G.user.uid){
await addDoc(collection(db,‘wb_notifications’),{userId:pSnap.data().authorId,type:‘comment’,actorId:G.user.uid,actorName:G.userData?.name||’’,postId:G.currentPostId,read:false,createdAt:serverTimestamp()});
// ntfy إشعار تعليق
sendNtfy(‘💬 تعليق جديد — Webook’,`${G.userData?.name||'مستخدم'} علّق على منشور ${pSnap.data().authorName||''}\n"${text.substring(0,80)}"`, ‘speech_balloon’, ‘welikecomm’);
}
}catch(e){alert(’خطأ: ’+e.message);}
};

// ══════════════════════════════
// SEARCH
// ══════════════════════════════
window.doSearch=async(q)=>{
const res=document.getElementById(‘search-res’);
const trimmed=q.trim().toLowerCase().replace(/^@/,’’);
if(!trimmed){
res.innerHTML=’<div class="empty"><i class="fas fa-search"></i><p>ابحث عن أشخاص أو منشورات</p></div>’;
return;
}
res.innerHTML=’<div class="spin"><i class="fas fa-circle-notch"></i></div>’;

try{
const [usersSnap,postsSnap]=await Promise.all([
getDocs(collection(db,‘wb_users’)),
getDocs(collection(db,‘wb_posts’))
]);

```
const users=[], posts=[];
const blocked=G.userData?.blockedUsers||[];

usersSnap.forEach(d=>{
  const u=d.data();
  if(blocked.includes(u.uid)) return;
  if(u.uid===G.user?.uid) return; // أخفِ نفسك
  const nameMatch=u.name?.toLowerCase().includes(trimmed);
  const userMatch=u.username?.toLowerCase().includes(trimmed);
  if(nameMatch||userMatch) users.push({...u, _exactUsername: u.username?.toLowerCase()===trimmed});
});

// رتّب: المطابقة التامة أولاً ثم الجزئية
users.sort((a,b)=>{
  if(a._exactUsername && !b._exactUsername) return -1;
  if(!a._exactUsername && b._exactUsername) return 1;
  return (b.followers||0)-(a.followers||0);
});

postsSnap.forEach(d=>{
  const p={id:d.id,...d.data()};
  if(blocked.includes(p.authorId)) return;
  if(p.text?.toLowerCase().includes(trimmed)||(p.tags||[]).some(t=>t.toLowerCase().includes(trimmed)))
    posts.push(p);
});

res.innerHTML='';
if(!users.length&&!posts.length){
  res.innerHTML=`<div class="empty"><i class="fas fa-search"></i><p>لا نتائج لـ "${q}"</p></div>`;
  return;
}

if(users.length){
  const h=document.createElement('div');
  h.style.cssText='padding:12px 16px 6px;font-weight:800;font-size:.82rem;color:#6b7a5a;letter-spacing:.5px;text-transform:uppercase';
  h.textContent=`👤 أشخاص (${users.length})`;
  res.appendChild(h);

  users.forEach(u=>{
    const el=document.createElement('div');
    el.style.cssText='display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid rgba(92,122,78,.08);cursor:pointer;transition:background .15s;';
    el.onmouseenter=()=>el.style.background='rgba(92,122,78,.05)';
    el.onmouseleave=()=>el.style.background='transparent';
    el.onclick=()=>openPubProfile(u.uid);

    // إبراز النص المطابق
    const highlightName=u.name?.replace(new RegExp(trimmed,'gi'),m=>`<mark style="background:#5c7a4e22;border-radius:3px;padding:0 2px">${m}</mark>`)||u.name||'';
    const highlightUser=u.username?.replace(new RegExp(trimmed,'gi'),m=>`<mark style="background:#5c7a4e22;border-radius:3px;padding:0 2px">${m}</mark>`)||u.username||'';

    el.innerHTML=`
      <div style="position:relative;flex-shrink:0">
        <div style="width:50px;height:50px;border-radius:50%;background:#8aab7a;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:1.1rem">
          ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:(u.name?.[0]||'م')}
        </div>
        ${u._exactUsername?'<div style="position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#2ecc71;border:2px solid #fff"></div>':''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;font-size:.92rem;display:flex;align-items:center;gap:4px;flex-wrap:wrap">
          ${highlightName}${vbadge(u.isVerified)}
          ${u.isAdmin?'<span style="background:#e74c3c;color:#fff;border-radius:6px;padding:1px 5px;font-size:.6rem">أدمن</span>':''}
        </div>
        <div style="font-size:.76rem;color:#6b7a5a;margin-top:2px">@${highlightUser}</div>
        <div style="font-size:.7rem;color:#8aab7a;margin-top:1px">${u.followers||0} متابع · ${u.following||0} متابَع</div>
      </div>
      <i class="fas fa-chevron-left" style="color:#c0c8b8;font-size:.75rem"></i>`;
    res.appendChild(el);
  });
}

if(posts.length){
  const h=document.createElement('div');
  h.style.cssText='padding:12px 16px 6px;font-weight:800;font-size:.82rem;color:#6b7a5a;margin-top:8px';
  h.textContent=`📝 منشورات (${posts.length})`;
  res.appendChild(h);
  posts.slice(0,10).forEach(p=>res.appendChild(buildPostCard(p)));
}
```

}catch(e){
res.innerHTML=`<div class="empty"><i class="fas fa-exclamation-triangle"></i><p>خطأ في البحث: ${e.message}</p></div>`;
}
};

// ══════════════════════════════
// ADMIN DASHBOARD (Professional)
// ══════════════════════════════
let _isAdmin=false;
let _adminCode=’’;
window.checkAdmin=async()=>{
const code=prompt(‘رمز الإدارة:’);
if(!code) return;
const isSuperAdmin = code === ‘1999@’;
const isUserAdmin = G.userData?.isAdmin && G.userData?.adminCode && code === G.userData.adminCode;
if(isSuperAdmin || isUserAdmin){
_isAdmin=true; _adminCode=code;
document.getElementById(‘admin-hbtn’).style.display=‘flex’;
openAdmin();
} else {
if(G.user){
try{
const snap=await getDoc(doc(db,‘wb_users’,G.user.uid));
const data=snap.data();
if(data?.isAdmin && data?.adminCode && code===data.adminCode){
_isAdmin=true; _adminCode=code;
G.isAdmin=true;
document.getElementById(‘admin-hbtn’).style.display=‘flex’;
openAdmin();
return;
}
}catch(e){}
}
alert(‘❌ رمز خاطئ’);
}
};
window.openAdmin=()=>{
document.getElementById(‘admin-screen’).classList.add(‘open’);
document.getElementById(‘admin-fab-logout’).style.display=‘flex’;

// تطبيق الصلاحيات — إخفاء التبويبات غير المسموحة للأدمن العادي
const isSuperAdmin = _adminCode === ‘1999@’;
const perms = G.userData?.adminPerms || [];

// التبويبات المتاحة دائماً للجميع
const alwaysVisible = [‘dashboard’, ‘settings’];
// التبويبات التي تحتاج صلاحية
const permTabs = {
users:‘users’, posts:‘posts’, reels:‘reels’,
comments:‘comments’, stories:‘stories’, chats:‘chats’, reports:‘reports’
};

document.querySelectorAll(’.admin-tab’).forEach(btn=>{
const tab=btn.dataset.tab;
if(!tab) return;
if(alwaysVisible.includes(tab)){
btn.style.display=‘flex’;
} else if(isSuperAdmin){
btn.style.display=‘flex’; // المدير الرئيسي يرى كل شيء
} else {
// الأدمن العادي يرى فقط ما مُنح له
btn.style.display = perms.includes(tab) ? ‘flex’ : ‘none’;
}
});

// افتح أول تبويب متاح
const firstVisible = isSuperAdmin ? ‘dashboard’ :
(alwaysVisible[0] in permTabs ? perms[0] : ‘dashboard’);
adminTab(document.querySelector(’.admin-tab[data-tab=“dashboard”]’),‘dashboard’);
};
window.adminGoTab=(tab)=>{
const btn=document.querySelector(`.admin-tab[data-tab="${tab}"]`);
if(btn) adminTab(btn,tab);
};
window.closeAdmin=()=>{
document.getElementById(‘admin-screen’).classList.remove(‘open’);
document.getElementById(‘admin-fab-logout’).style.display=‘none’;
document.getElementById(‘admin-hbtn’).style.display=‘none’;
G.isAdmin=false; _isAdmin=false; _adminCode=’’;
};
window.adminLogout=()=>closeAdmin();

window.adminTab=async(btn,tab)=>{
document.querySelectorAll(’.admin-tab’).forEach(b=>b.classList.remove(‘active’));
if(btn) btn.classList.add(‘active’);
const content=document.getElementById(‘admin-content’);
content.innerHTML=’<div style="text-align:center;padding:40px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:2rem"></i></div>’;
await adminLoadStats();
if(tab===‘dashboard’) await adminDashboard();
else if(tab===‘users’) await adminUsers();
else if(tab===‘posts’) await adminPosts();
else if(tab===‘reels’) await adminReels();
else if(tab===‘comments’) await adminComments();
else if(tab===‘stories’) await adminStories();
else if(tab===‘chats’) await adminChats();
else if(tab===‘reports’) await adminReports();
else if(tab===‘newsbot’) await adminNewsBot();
else if(tab===‘settings’) adminSettings();
};

// ══════════════════════════════
// NEWS BOT — مصادر موثوقة 100%
// ══════════════════════════════
const NEWS_SOURCES=[
{id:‘bbc_main’,  name:‘BBC عربي - عام’,    icon:‘🌍’, url:‘https://feeds.bbci.co.uk/arabic/rss.xml’,                   color:’#bb1919’},
{id:‘bbc_mid’,   name:‘BBC الشرق الأوسط’,  icon:‘🗺️’, url:‘https://feeds.bbci.co.uk/arabic/middleeast/rss.xml’,        color:’#c0392b’},
{id:‘bbc_sport’, name:‘BBC رياضة’,          icon:‘⚽’, url:‘https://feeds.bbci.co.uk/arabic/sport/rss.xml’,             color:’#27ae60’},
{id:‘bbc_tech’,  name:‘BBC تقنية وعلوم’,   icon:‘💻’, url:‘https://feeds.bbci.co.uk/arabic/science_and_tech/rss.xml’,  color:’#8e44ad’},
{id:‘bbc_biz’,   name:‘BBC اقتصاد’,        icon:‘💰’, url:‘https://feeds.bbci.co.uk/arabic/business/rss.xml’,          color:’#d4ac0d’},
{id:‘alj’,       name:‘الجزيرة’,            icon:‘📺’, url:‘https://www.aljazeera.net/xml/rss/all.xml’,                 color:’#005a7e’},
{id:‘rt’,        name:‘RT عربي’,            icon:‘📡’, url:‘https://arabic.rt.com/rss/’,                                color:’#c0392b’},
];

let _botInterval=null, _botRunning=false;
window._botInterval_hours=1;

// جلب RSS — 3 proxies احتياطية
async function fetchRSS(url){
const tries=[
()=>fetch(‘https://corsproxy.io/?’+encodeURIComponent(url),{signal:AbortSignal.timeout(9000)}).then(r=>r.text()),
()=>fetch(‘https://api.allorigins.win/get?url=’+encodeURIComponent(url),{signal:AbortSignal.timeout(9000)}).then(r=>r.json()).then(d=>d.contents||’’),
()=>fetch(‘https://api.codetabs.com/v1/proxy?quest=’+encodeURIComponent(url),{signal:AbortSignal.timeout(9000)}).then(r=>r.text()),
];
for(const t of tries){
try{ const txt=await t(); if(txt&&txt.includes(’<item>’)) return txt; }
catch(e){ console.log(‘RSS proxy failed:’,e.message); }
}
throw new Error(‘تعذّر جلب الأخبار من هذا المصدر’);
}

async function adminNewsBot(){
const content=document.getElementById(‘admin-content’);
let cfg={enabled:false,sources:[‘bbc_main’,‘bbc_sport’,‘alj’],intervalHours:1};
try{ const s=await getDoc(doc(db,‘wb_settings’,‘newsbot’)); if(s.exists()) cfg={…cfg,…s.data()}; }catch(e){}
window._botInterval_hours=cfg.intervalHours||1;
const lastRun=cfg.lastRun?’آخر نشر: ’+new Date(cfg.lastRun.seconds*1000).toLocaleString(‘ar’):‘لم ينشر بعد’;

content.innerHTML=`<div style="padding:16px;color:#fff;font-family:Cairo,sans-serif">

```
<div style="background:linear-gradient(135deg,#1e3a5f,#2d5a8e);border-radius:16px;padding:18px;margin-bottom:16px;display:flex;align-items:center;gap:14px">
  <div style="font-size:2rem">🤖</div>
  <div style="flex:1">
    <div style="font-weight:900;font-size:1rem">بوت الأخبار التلقائي</div>
    <div id="bot-status-text" style="font-size:.75rem;color:rgba(255,255,255,.6);margin-top:3px">${lastRun}</div>
  </div>
  <div id="bot-status-badge" style="padding:6px 14px;border-radius:20px;font-size:.78rem;font-weight:700;${cfg.enabled?'background:rgba(46,204,113,.2);color:#2ecc71;border:1px solid rgba(46,204,113,.3)':'background:rgba(231,76,60,.15);color:#e74c3c;border:1px solid rgba(231,76,60,.3)'}">
    ${cfg.enabled?'● نشط':'● متوقف'}
  </div>
</div>

<div style="display:flex;gap:10px;margin-bottom:16px">
  <button onclick="toggleNewsBot()" id="bot-toggle-btn" style="flex:1;padding:13px;border-radius:14px;border:none;font-family:Cairo,sans-serif;font-weight:800;font-size:.88rem;cursor:pointer;${cfg.enabled?'background:#e74c3c;color:#fff':'background:#2ecc71;color:#fff'}">
    ${cfg.enabled?'⏹ إيقاف البوت':'▶ تشغيل البوت'}
  </button>
  <button onclick="runNewsBotNow()" id="bot-run-btn" style="flex:1;padding:13px;border-radius:14px;border:none;background:#3498db;color:#fff;font-family:Cairo,sans-serif;font-weight:800;font-size:.88rem;cursor:pointer">
    ⚡ نشر الآن
  </button>
</div>

<div style="background:#1a1a2e;border-radius:14px;padding:14px;margin-bottom:14px">
  <div style="font-weight:800;font-size:.88rem;margin-bottom:12px">📡 مصادر الأخبار</div>
  ${NEWS_SOURCES.map(s=>`
    <label style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer">
      <input type="checkbox" id="src-${s.id}" ${(cfg.sources||[]).includes(s.id)?'checked':''} onchange="saveBotSettings()" style="width:18px;height:18px;accent-color:${s.color};cursor:pointer">
      <span style="font-size:1.05rem">${s.icon}</span>
      <span style="font-weight:700;font-size:.84rem">${s.name}</span>
      <span style="margin-right:auto;background:rgba(46,204,113,.1);color:#2ecc71;border-radius:8px;padding:2px 7px;font-size:.65rem;font-weight:700">✅ موثوق</span>
    </label>`).join('')}
</div>

<div style="background:#1a1a2e;border-radius:14px;padding:14px;margin-bottom:14px">
  <div style="font-weight:800;font-size:.88rem;margin-bottom:10px">⏱ فاصل النشر</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    ${[1,2,3,6,12,24].map(h=>`
      <button onclick="setBotInterval(${h})" id="int-${h}" style="padding:8px 16px;border-radius:20px;border:1.5px solid ${(cfg.intervalHours||1)===h?'#3498db':'rgba(255,255,255,.15)'};background:${(cfg.intervalHours||1)===h?'rgba(52,152,219,.2)':'transparent'};color:${(cfg.intervalHours||1)===h?'#3498db':'rgba(255,255,255,.5)'};font-family:Cairo,sans-serif;font-weight:700;font-size:.8rem;cursor:pointer">
        كل ${h===1?'ساعة':h+' ساعات'}
      </button>`).join('')}
  </div>
</div>

<div style="background:#1a1a2e;border-radius:14px;padding:14px">
  <div style="font-weight:800;font-size:.88rem;margin-bottom:10px">📋 آخر الأخبار المنشورة</div>
  <div id="bot-log"><div style="color:rgba(255,255,255,.3);text-align:center;padding:20px;font-size:.8rem">⏳ جاري التحميل...</div></div>
</div>
```

  </div>`;

loadBotLog();
if(cfg.enabled&&!_botRunning) startBotSchedule(cfg.intervalHours||1);
}

window.saveBotSettings=async()=>{
const sources=NEWS_SOURCES.filter(s=>document.getElementById(‘src-’+s.id)?.checked).map(s=>s.id);
await setDoc(doc(db,‘wb_settings’,‘newsbot’),{sources,intervalHours:window._botInterval_hours},{merge:true}).catch(()=>{});
};

window.setBotInterval=(h)=>{
window._botInterval_hours=h;
[1,2,3,6,12,24].forEach(n=>{
const b=document.getElementById(‘int-’+n); if(!b) return;
b.style.borderColor=n===h?’#3498db’:‘rgba(255,255,255,.15)’;
b.style.background=n===h?‘rgba(52,152,219,.2)’:‘transparent’;
b.style.color=n===h?’#3498db’:‘rgba(255,255,255,.5)’;
});
saveBotSettings();
if(_botRunning){ stopBotSchedule(); startBotSchedule(h); }
};

window.toggleNewsBot=async()=>{
const s=await getDoc(doc(db,‘wb_settings’,‘newsbot’));
const on=!(s.exists()&&s.data().enabled);
await setDoc(doc(db,‘wb_settings’,‘newsbot’),{enabled:on},{merge:true});
const badge=document.getElementById(‘bot-status-badge’);
const btn=document.getElementById(‘bot-toggle-btn’);
if(badge){ badge.style.cssText=on?‘padding:6px 14px;border-radius:20px;font-size:.78rem;font-weight:700;background:rgba(46,204,113,.2);color:#2ecc71;border:1px solid rgba(46,204,113,.3)’:‘padding:6px 14px;border-radius:20px;font-size:.78rem;font-weight:700;background:rgba(231,76,60,.15);color:#e74c3c;border:1px solid rgba(231,76,60,.3)’; badge.textContent=on?‘● نشط’:‘● متوقف’; }
if(btn){ btn.style.background=on?’#e74c3c’:’#2ecc71’; btn.textContent=on?‘⏹ إيقاف البوت’:‘▶ تشغيل البوت’; }
if(on){ startBotSchedule(window._botInterval_hours||1); runNewsBotNow(); }
else stopBotSchedule();
};

function startBotSchedule(h){ stopBotSchedule(); _botRunning=true; _botInterval=setInterval(runNewsBotNow,h*60*60*1000); }
function stopBotSchedule(){ _botRunning=false; clearInterval(_botInterval); _botInterval=null; }

window.runNewsBotNow=async()=>{
const statusEl=document.getElementById(‘bot-status-text’);
const btn=document.getElementById(‘bot-run-btn’);
if(btn){btn.disabled=true;btn.textContent=‘⏳ جاري…’;}
if(statusEl) statusEl.textContent=‘⏳ جاري جلب الأخبار…’;
try{
const s=await getDoc(doc(db,‘wb_settings’,‘newsbot’));
const cfg=s.exists()?s.data():{sources:[‘bbc_main’,‘bbc_sport’,‘alj’]};
const active=NEWS_SOURCES.filter(x=>(cfg.sources||[]).includes(x.id));
if(!active.length){ if(statusEl) statusEl.textContent=‘⚠️ اختر مصدراً واحداً على الأقل’; return; }

```
let posted=false;
const shuffled=[...active].sort(()=>Math.random()-.5);

for(const src of shuffled){
  if(posted) break;
  try{
    if(statusEl) statusEl.textContent=`📡 جاري جلب ${src.name}...`;
    const xml=await fetchRSS(src.url);
    const parser=new DOMParser();
    const xmlDoc=parser.parseFromString(xml,'text/xml');
    const items=Array.from(xmlDoc.querySelectorAll('item')).slice(0,20);
    if(!items.length) continue;

    for(const item of items.sort(()=>Math.random()-.5)){
      const title=(item.querySelector('title')?.textContent||'').replace('<![CDATA[','').replace(']]>','').trim();
      const desc=(item.querySelector('description')?.textContent||'').replace(/<[^>]+>/g,'').replace('<![CDATA[','').replace(']]>','').trim().substring(0,500);
      const link=(item.querySelector('link')?.textContent||'').trim();
      if(!title||title.length<10) continue;

      // تجنب التكرار
      const newsId='bot_'+btoa(unescape(encodeURIComponent(title.substring(0,50)))).replace(/[^a-zA-Z0-9]/g,'').substring(0,28);
      const dup=await getDoc(doc(db,'wb_posts',newsId));
      if(dup.exists()) continue;

      const text=`${src.icon} **${src.name}**\n\n📌 ${title}\n\n${desc}${desc.length>=500?'...':''}`;
      await setDoc(doc(db,'wb_posts',newsId),{
        text, authorId:'bot_news', authorName:src.name, authorAvatar:'',
        authorVerified:true, authorIsAdmin:false,
        isBot:true, sourceId:src.id, sourceName:src.name, sourceLink:link,
        likes:0, likedBy:[], comments:0, savedBy:[],
        createdAt:serverTimestamp()
      });
      await setDoc(doc(db,'wb_settings','newsbot'),{lastRun:serverTimestamp()},{merge:true});
      await addDoc(collection(db,'wb_bot_log'),{title,source:src.name,link,postedAt:serverTimestamp()});
      if(statusEl) statusEl.textContent=`✅ ${title.substring(0,55)}${title.length>55?'...':''}`;
      loadBotLog(); posted=true; break;
    }
  }catch(e){ console.log('Source failed:',src.name,e.message); continue; }
}
if(!posted&&statusEl) statusEl.textContent='⚠️ جميع الأخبار منشورة مسبقاً أو المصادر غير متاحة';
```

}catch(e){
if(statusEl) statusEl.textContent=’❌ خطأ: ’+e.message;
}finally{
if(btn){btn.disabled=false;btn.textContent=‘⚡ نشر الآن’;}
}
};

async function loadBotLog(){
const el=document.getElementById(‘bot-log’); if(!el) return;
try{
const s=await getDocs(collection(db,‘wb_bot_log’));
const logs=[]; s.forEach(d=>logs.push({id:d.id,…d.data()}));
logs.sort((a,b)=>(b.postedAt?.seconds||0)-(a.postedAt?.seconds||0));
const top=logs.slice(0,10);
if(!top.length){ el.innerHTML=’<div style="color:rgba(255,255,255,.3);text-align:center;padding:20px;font-size:.8rem">لا توجد منشورات بعد</div>’; return; }
el.innerHTML=top.map(l=>` <div style="padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);display:flex;gap:10px;align-items:flex-start"> <div style="flex:1;min-width:0"> <div style="font-weight:700;font-size:.78rem;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.title||'—'}</div> <div style="font-size:.68rem;color:rgba(255,255,255,.35);margin-top:2px">${l.source||''} · ${l.postedAt?.toDate?l.postedAt.toDate().toLocaleString('ar'):''}</div> </div> ${l.link?`<a href="${l.link}" target="_blank" style="color:#3498db;font-size:.7rem;flex-shrink:0;text-decoration:none">رابط ↗</a>`:''} </div>`).join(’’);
}catch(e){ el.innerHTML=’<div style="color:#e74c3c;font-size:.78rem;text-align:center;padding:10px">خطأ</div>’; }
}

async function adminLoadStats(){
try{
const [u,p,r,c]=await Promise.all([getDocs(collection(db,‘wb_users’)),getDocs(collection(db,‘wb_posts’)),getDocs(collection(db,‘wb_reels’)),getDocs(collection(db,‘wb_comments’))]);
const stats=[{n:u.size,l:‘مستخدم’,icon:‘👤’,color:’#3498db’},{n:p.size,l:‘منشور’,icon:‘📝’,color:’#2ecc71’},{n:r.size,l:‘ريل’,icon:‘🎬’,color:’#e74c3c’},{n:c.size,l:‘تعليق’,icon:‘💬’,color:’#f39c12’}];
const bar=document.getElementById(‘admin-stats-bar’);
if(bar) bar.innerHTML=stats.map(s=>`<div class="admin-stat-card"><div style="font-size:1.1rem;margin-bottom:2px">${s.icon}</div><div class="admin-stat-n" style="color:${s.color}">${s.n}</div><div class="admin-stat-l">${s.l}</div></div>`).join(’’);
const oc=document.getElementById(‘admin-online-count’);
if(oc) oc.textContent=`${u.size} مستخدم`;
}catch(e){}
}

async function adminDashboard(){
const content=document.getElementById(‘admin-content’);
try{
const [u,p,r,c,s,ch]=await Promise.all([getDocs(collection(db,‘wb_users’)),getDocs(collection(db,‘wb_posts’)),getDocs(collection(db,‘wb_reels’)),getDocs(collection(db,‘wb_comments’)),getDocs(collection(db,‘wb_stories’)),getDocs(collection(db,‘wb_chats’))]);
const posts=[];p.forEach(d=>posts.push({id:d.id,…d.data()}));
posts.sort((a,b)=>(b.likes||0)-(a.likes||0));
const top3=posts.slice(0,3),maxL=top3[0]?.likes||1;
const users=[];u.forEach(d=>users.push({id:d.id,…d.data()}));
users.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
const recent5=users.slice(0,5);
const statItems=[
{icon:‘fas fa-users’,l:‘المستخدمون’,v:u.size,color:’#3498db’},
{icon:‘fas fa-newspaper’,l:‘المنشورات’,v:p.size,color:’#2ecc71’},
{icon:‘fas fa-clapperboard’,l:‘الريلز’,v:r.size,color:’#e74c3c’},
{icon:‘fas fa-comments’,l:‘التعليقات’,v:c.size,color:’#f39c12’},
{icon:‘fas fa-circle-dot’,l:‘القصص’,v:s.size,color:’#8e44ad’},
{icon:‘fas fa-comment-dots’,l:‘المحادثات’,v:ch.size,color:’#1abc9c’}
];
content.innerHTML=`<div style="padding:14px"> <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">${statItems.map(st=>`<div class="admin-card" style="padding:14px;margin:0"><div style="display:flex;align-items:center;gap:10px"><div style="width:38px;height:38px;border-radius:10px;background:${st.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0"><i class="${st.icon}" style="color:${st.color};font-size:.9rem"></i></div><div><div style="color:#fff;font-size:1.4rem;font-weight:900;line-height:1">${st.v}</div><div style="color:rgba(255,255,255,.4);font-size:.65rem;margin-top:2px">${st.l}</div></div></div></div>`).join('')}</div> <div class="admin-card"><div class="admin-card-title"><i class="fas fa-fire" style="color:#e74c3c"></i> أكثر المنشورات تفاعلاً</div>${top3.length?top3.map(pp=>`<div class="admin-row"><div class="admin-av">${pp.authorAvatar?`<img src="${pp.authorAvatar}">`:(pp.authorName?.[0]||‘م’)}</div><div style="flex:1;min-width:0"><div style="color:#fff;font-size:.82rem;font-weight:700">${pp.authorName||’—’}</div><div style="color:rgba(255,255,255,.4);font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pp.text||’(صورة)’}</div><div style="margin-top:6px"><div class="admin-chart-bar" style="width:${Math.round((pp.likes||0)/maxL*100)}%"></div></div></div><div style="color:#e74c3c;font-weight:900;font-size:.85rem;flex-shrink:0">❤️ ${pp.likes||0}</div></div>`).join(''):'<div style="color:rgba(255,255,255,.3);text-align:center;padding:16px">لا منشورات</div>'}</div> <div class="admin-card"><div class="admin-card-title"><i class="fas fa-user-plus" style="color:#3498db"></i> أحدث المستخدمين</div>${recent5.map(uu=>`<div class="admin-row"><div class="admin-av">${uu.avatar?`<img src="${uu.avatar}">`:(uu.name?.[0]||‘م’)}</div><div style="flex:1"><div style="color:#fff;font-size:.85rem;font-weight:700">${uu.name||’—’} ${uu.isVerified?‘✅’:’’}</div><div style="color:rgba(255,255,255,.4);font-size:.72rem">@${uu.username||’—’}</div></div>${uu.isAdmin?’<span class="admin-badge red">🛡️</span>’:’’}</div>`).join('')}</div> <div class="admin-card"><div class="admin-card-title"><i class="fas fa-bolt" style="color:#f1c40f"></i> إجراءات سريعة</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${[{tab:'users',icon:'fas fa-users',l:'المستخدمون'},{tab:'posts',icon:'fas fa-newspaper',l:'المنشورات'},{tab:'reels',icon:'fas fa-clapperboard',l:'الريلز'},{tab:'settings',icon:'fas fa-cog',l:'الإعدادات'}].map(a=>`<button onclick="adminGoTab('${a.tab}')" class="admin-btn-primary" style="padding:12px;border-radius:12px;font-size:.82rem"><i class="${a.icon}"></i> ${a.l}</button>`).join('')}</div></div> </div>`;
}catch(e){content.innerHTML=`<div style="padding:20px;color:#e74c3c">خطأ: ${e.message}</div>`;}
}

async function adminUsers(){
const content=document.getElementById(‘admin-content’);
content.innerHTML=’<div style="padding:14px"><input class="admin-search" id="admin-user-search" placeholder="🔍 بحث عن مستخدم..." oninput="adminFilterUsers(this.value)"><div id="admin-users-list"><div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem"></i></div></div></div>’;
try{
const snap=await getDocs(collection(db,‘wb_users’));
const users=[];snap.forEach(d=>users.push({id:d.id,…d.data()}));
users.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
window._adminUsers=users;adminRenderUsers(users);
}catch(e){document.getElementById(‘admin-users-list’).innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;}
}
window.adminFilterUsers=q=>{if(!window._adminUsers)return;adminRenderUsers(!q?window._adminUsers:window._adminUsers.filter(u=>u.name?.includes(q)||u.username?.includes(q)||u.email?.includes(q)));};
function adminRenderUsers(users){
const list=document.getElementById(‘admin-users-list’);
if(!list) return;
if(!users.length){list.innerHTML=’<div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)">لا نتائج</div>’;return;}
list.innerHTML=users.map(u=>`<div class="admin-card" style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><div class="admin-av" style="width:48px;height:48px">${u.avatar?`<img src="${u.avatar}">`:(u.name?.[0]||'م')}</div><div style="flex:1"><div style="color:#fff;font-weight:800;font-size:.9rem">${u.name||'—'} ${u.isVerified?'✅':''}</div><div style="color:rgba(255,255,255,.4);font-size:.72rem">@${u.username||'—'} · ${u.email||''}</div><div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap"><span class="admin-badge blue">👥 ${u.followers||0}</span><span class="admin-badge green">📝 ${u.posts||0}</span>${u.isAdmin?`<span class="admin-badge red">🛡️ أدمن</span>`:''}</div>${u.isAdmin&&u.adminCode?`<div style="margin-top:6px;background:rgba(255,255,255,.06);border-radius:8px;padding:5px 10px;display:inline-flex;align-items:center;gap:8px"><span style="color:rgba(255,255,255,.4);font-size:.68rem">رمز الإدارة:</span><span style="color:#f39c12;font-weight:700;font-size:.78rem;font-family:monospace">${u.adminCode}</span></div>`:''}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap"><button onclick="adminVerifyUser('${u.id}','${(u.name||'').replace(/'/g,'')}')" class="admin-btn-primary">${u.isVerified?'❌ إزالة التوثيق':'✅ توثيق'}</button><button onclick="adminToggleAdmin('${u.id}',${!!u.isAdmin})" class="admin-btn-${u.isAdmin?'danger':'success'}">${u.isAdmin?'🛡️ إزالة الأدمن':'🛡️ تعيين أدمن'}</button>${u.isAdmin?`<button onclick="adminChangeCode('${u.id}')" class="admin-btn-primary">🔑 تغيير الرمز</button>`:''}<button onclick="adminDeleteUser('${u.id}')" class="admin-btn-danger">🗑️ حذف</button><button onclick="adminViewUserPosts('${u.id}','${(u.name||'').replace(/'/g,'')}')" class="admin-btn-primary">📝 منشوراته</button></div></div>`).join(’’);
}
window.adminVerifyUser=async(uid,name)=>{
const snap=await getDoc(doc(db,‘wb_users’,uid));
const v=snap.data()?.isVerified;
if(!confirm(`${v?'إزالة توثيق':'توثيق'} ${name}؟`))return;
await updateDoc(doc(db,‘wb_users’,uid),{isVerified:!v});
adminUsers();
};

window.adminChangeCode=async(uid)=>{
adminShowPermsDialog(uid);
};

window.adminToggleAdmin=async(uid,isCurrentlyAdmin)=>{
if(isCurrentlyAdmin){
if(!confirm(‘هل تريد إزالة صلاحيات الأدمن من هذا المستخدم؟’))return;
await updateDoc(doc(db,‘wb_users’,uid),{isAdmin:false,adminCode:’’,adminPerms:[]});
adminUsers();
} else {
// فتح نافذة تعيين الصلاحيات
adminShowPermsDialog(uid);
}
};

// نافذة اختيار الصلاحيات
window.adminShowPermsDialog=async(uid)=>{
// احضر بيانات المستخدم الحالية
const snap=await getDoc(doc(db,‘wb_users’,uid));
const userData=snap.data()||{};
const currentPerms=userData.adminPerms||[];

// أنشئ نافذة
let modal=document.getElementById(‘perms-modal’);
if(modal) modal.remove();
modal=document.createElement(‘div’);
modal.id=‘perms-modal’;
modal.style.cssText=‘position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Cairo,sans-serif;’;

const allPerms=[
{key:‘posts’,   icon:‘📝’, label:‘المنشورات’,  desc:‘عرض وحذف المنشورات’},
{key:‘reels’,   icon:‘🎬’, label:‘الريلز’,      desc:‘عرض وحذف الريلز’},
{key:‘comments’,icon:‘💬’, label:‘التعليقات’,   desc:‘عرض وحذف التعليقات’},
{key:‘stories’, icon:‘⭕’, label:‘القصص’,       desc:‘عرض وحذف القصص’},
{key:‘users’,   icon:‘👥’, label:‘المستخدمون’,  desc:‘عرض بيانات المستخدمين’},
{key:‘chats’,   icon:‘💬’, label:‘الدردشات’,    desc:‘معاينة وحذف الرسائل’},
{key:‘reports’, icon:‘🚩’, label:‘البلاغات’,    desc:‘إدارة البلاغات’},
];

modal.innerHTML=`
<div style="background:#1a1a2e;border-radius:20px;padding:24px;width:100%;max-width:380px;border:1px solid rgba(255,255,255,.1)">
<div style="color:#fff;font-weight:900;font-size:1rem;margin-bottom:6px">🛡️ تعيين أدمن جديد</div>
<div style="color:rgba(255,255,255,.4);font-size:.78rem;margin-bottom:16px">${userData.name||‘المستخدم’}</div>

```
  <div style="margin-bottom:14px">
    <div style="color:rgba(255,255,255,.6);font-size:.78rem;font-weight:700;margin-bottom:10px">الصلاحيات الممنوحة:</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="perms-list">
      ${allPerms.map(p=>`
        <label style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.05);border-radius:10px;padding:10px;cursor:pointer;border:1px solid ${currentPerms.includes(p.key)?'rgba(92,122,78,.5)':'rgba(255,255,255,.08)'}">
          <input type="checkbox" value="${p.key}" ${currentPerms.includes(p.key)?'checked':''} style="width:16px;height:16px;accent-color:#5c7a4e;cursor:pointer">
          <div>
            <div style="color:#fff;font-size:.8rem;font-weight:700">${p.icon} ${p.label}</div>
            <div style="color:rgba(255,255,255,.35);font-size:.65rem">${p.desc}</div>
          </div>
        </label>`).join('')}
    </div>
  </div>

  <div style="margin-bottom:14px">
    <div style="color:rgba(255,255,255,.6);font-size:.78rem;font-weight:700;margin-bottom:8px">🔑 رمز الإدارة الخاص:</div>
    <input id="perm-code-inp" type="text" placeholder="أدخل رمزاً (4 أحرف+)" value="${userData.adminCode||''}"
      style="width:100%;padding:11px 14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:12px;color:#fff;font-family:Cairo,sans-serif;font-size:.88rem;outline:none;text-align:right;box-sizing:border-box;">
  </div>

  <div style="display:flex;gap:10px">
    <button onclick="document.getElementById('perms-modal').remove()" style="flex:1;padding:12px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);border:none;border-radius:12px;font-family:Cairo,sans-serif;font-weight:700;cursor:pointer">إلغاء</button>
    <button onclick="adminSavePerms('${uid}')" style="flex:2;padding:12px;background:#5c7a4e;color:#fff;border:none;border-radius:12px;font-family:Cairo,sans-serif;font-weight:700;cursor:pointer">✅ حفظ وتعيين</button>
  </div>
</div>`;
```

document.body.appendChild(modal);
};

window.adminSavePerms=async(uid)=>{
const code=document.getElementById(‘perm-code-inp’)?.value.trim();
if(!code||code.length<4){ alert(‘❌ الرمز يجب أن يكون 4 أحرف على الأقل’); return; }
const checks=document.querySelectorAll(’#perms-list input[type=checkbox]:checked’);
const perms=[…checks].map(c=>c.value);
if(!perms.length){ alert(‘❌ اختر صلاحية واحدة على الأقل’); return; }
try{
await updateDoc(doc(db,‘wb_users’,uid),{isAdmin:true,adminCode:code,adminPerms:perms});
document.getElementById(‘perms-modal’)?.remove();
alert(`✅ تم تعيين الأدمن\nالرمز: ${code}\nالصلاحيات: ${perms.join('، ')}`);
adminUsers();
}catch(e){ alert(‘خطأ: ‘+e.message); }
};
window.adminDeleteUser=async(uid)=>{if(!confirm(‘حذف هذا الحساب نهائياً؟’))return;await deleteDoc(doc(db,‘wb_users’,uid));adminUsers();};
window.adminViewUserPosts=async(uid,name)=>{
const content=document.getElementById(‘admin-content’);
content.innerHTML=`<div style="padding:14px"><button onclick="adminUsers()" style="background:rgba(255,255,255,.1);border:none;color:#fff;padding:8px 14px;border-radius:8px;font-family:'Cairo',sans-serif;cursor:pointer;margin-bottom:12px"><i class="fas fa-arrow-right"></i> رجوع</button><div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:12px">منشورات: ${name}</div><div id="user-posts-admin"></div></div>`;
const snap=await getDocs(query(collection(db,‘wb_posts’),where(‘authorId’,’==’,uid)));
const posts=[];snap.forEach(d=>posts.push({id:d.id,…d.data()}));
posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
const list=document.getElementById(‘user-posts-admin’);
if(!posts.length){list.innerHTML=’<div style="color:rgba(255,255,255,.3);text-align:center;padding:30px">لا منشورات</div>’;return;}
list.innerHTML=posts.map(pp=>`<div class="admin-card" style="margin-bottom:10px">${pp.imageUrl?`<img src="${pp.imageUrl}" style="width:100%;border-radius:10px;max-height:180px;object-fit:cover;margin-bottom:10px">`:''}<div style="color:#fff;font-size:.85rem;line-height:1.5">${pp.text||'(بدون نص)'}</div><div style="display:flex;gap:10px;margin-top:8px;align-items:center"><span style="color:rgba(255,255,255,.4);font-size:.72rem">❤️ ${pp.likes||0} · 💬 ${pp.comments||0}</span><button onclick="adminDeletePost('${pp.id}')" class="admin-btn-danger" style="margin-right:auto">🗑️</button></div></div>`).join(’’);
};

async function adminPosts(){
const content=document.getElementById(‘admin-content’);
const wrap=document.createElement(‘div’);wrap.style.padding=‘14px’;
wrap.innerHTML=`<input class="admin-search" id="admin-post-search" placeholder="🔍 بحث في المنشورات..." oninput="adminFilterPosts(this.value)">

<div style="display:flex;gap:8px;margin-bottom:12px">
  <button onclick="adminPostsSort('likes')" class="admin-btn-primary" style="font-size:.75rem">🔥 إعجاباً</button>
  <button onclick="adminPostsSort('recent')" class="admin-btn-primary" style="font-size:.75rem">🕐 أحدث</button>
  <button onclick="adminPostsSort('comments')" class="admin-btn-primary" style="font-size:.75rem">💬 تعليقاً</button>
</div>
<div id="admin-posts-list"><div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem"></i></div></div>`;
  content.innerHTML='';content.appendChild(wrap);
  try{
    const snap=await getDocs(collection(db,'wb_posts'));
    const posts=[];snap.forEach(d=>posts.push({id:d.id,...d.data()}));
    posts.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    window._adminPosts=posts;adminRenderPosts(posts);
  }catch(e){document.getElementById('admin-posts-list').innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;}
}
window.adminFilterPosts=q=>{if(!window._adminPosts)return;adminRenderPosts(!q?window._adminPosts:window._adminPosts.filter(p=>p.text?.includes(q)||p.authorName?.includes(q)));};
window.adminPostsSort=by=>{if(!window._adminPosts)return;adminRenderPosts([...window._adminPosts].sort((a,b)=>by==='likes'?(b.likes||0)-(a.likes||0):by==='comments'?(b.comments||0)-(a.comments||0):(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)));};
function adminRenderPosts(posts){
  const list=document.getElementById('admin-posts-list');if(!list)return;
  if(!posts.length){list.innerHTML='<div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)">لا منشورات</div>';return;}
  list.innerHTML=posts.map(p=>`<div class="admin-card" style="margin-bottom:10px"><div style="display:flex;gap:10px;margin-bottom:8px"><div class="admin-av" style="width:36px;height:36px">${p.authorAvatar?`<img src="${p.authorAvatar}">`:(p.authorName?.[0]||'م')}</div><div style="flex:1"><div style="color:#fff;font-size:.82rem;font-weight:700">${p.authorName||'—'}</div><div style="color:rgba(255,255,255,.3);font-size:.7rem">${p.createdAt?.toDate?timeAgo(p.createdAt.toDate()):''}</div></div><button onclick="adminDeletePost('${p.id}')" class="admin-btn-danger">🗑️</button></div>${p.imageUrl?`<img src="${p.imageUrl}" style="width:100%;border-radius:8px;max-height:160px;object-fit:cover;margin-bottom:8px">`:''}<div style="color:rgba(255,255,255,.75);font-size:.82rem;line-height:1.5;margin-bottom:8px">${(p.text||'').substring(0,120)}</div><div style="display:flex;gap:12px"><span style="color:rgba(255,255,255,.4);font-size:.72rem">❤️ ${p.likes||0}</span><span style="color:rgba(255,255,255,.4);font-size:.72rem">💬 ${p.comments||0}</span><span style="color:rgba(255,255,255,.4);font-size:.72rem">🔖 ${(p.savedBy||[]).length}</span></div></div>`).join('');
}
window.adminDeletePost=async(id)=>{if(!confirm('حذف؟'))return;await deleteDoc(doc(db,'wb_posts',id));adminPosts();};

async function adminReels(){
const content=document.getElementById(‘admin-content’);
content.innerHTML=’<div style="padding:14px"><div id="admin-reels-list"><div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem"></i></div></div></div>’;
try{
const snap=await getDocs(collection(db,‘wb_reels’));const reels=[];snap.forEach(d=>reels.push({id:d.id,…d.data()}));reels.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
const list=document.getElementById(‘admin-reels-list’);
if(!reels.length){list.innerHTML=’<div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)">لا ريلز</div>’;return;}
list.innerHTML=reels.map(r=>`<div class="admin-card" style="margin-bottom:10px"><div style="display:flex;gap:10px;margin-bottom:8px"><div class="admin-av" style="width:36px;height:36px">${r.authorAvatar?`<img src="${r.authorAvatar}">`:(r.authorName?.[0]||'م')}</div><div style="flex:1"><div style="color:#fff;font-size:.82rem;font-weight:700">${r.authorName||'—'}</div><div style="color:rgba(255,255,255,.3);font-size:.7rem">@${r.authorUsername||''}</div></div><button onclick="adminDeleteReel('${r.id}')" class="admin-btn-danger">🗑️</button></div>${r.thumbnailUrl?`<img src="${r.thumbnailUrl}" style="width:100%;border-radius:8px;max-height:140px;object-fit:cover;margin-bottom:8px">`:''}<div style="color:rgba(255,255,255,.7);font-size:.82rem;margin-bottom:6px">${r.caption||'(بدون وصف)'}</div><div style="display:flex;gap:12px"><span style="color:rgba(255,255,255,.4);font-size:.72rem">❤️ ${r.likes||0}</span><span style="color:rgba(255,255,255,.4);font-size:.72rem">💬 ${r.comments||0}</span></div></div>`).join(’’);
}catch(e){document.getElementById(‘admin-reels-list’).innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;}
}
window.adminDeleteReel=async(id)=>{if(!confirm(‘حذف الريل؟’))return;await deleteDoc(doc(db,‘wb_reels’,id));adminReels();};

async function adminComments(){
const content=document.getElementById(‘admin-content’);
content.innerHTML=’<div style="padding:14px"><div id="admin-comments-list"><div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem"></i></div></div></div>’;
try{
const snap=await getDocs(collection(db,‘wb_comments’));const comments=[];snap.forEach(d=>comments.push({id:d.id,…d.data()}));comments.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
const list=document.getElementById(‘admin-comments-list’);
if(!comments.length){list.innerHTML=’<div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)">لا تعليقات</div>’;return;}
list.innerHTML=comments.map(c=>`<div class="admin-card" style="margin-bottom:8px"><div style="display:flex;gap:10px"><div class="admin-av" style="width:34px;height:34px">${c.authorAvatar?`<img src="${c.authorAvatar}">`:(c.authorName?.[0]||'م')}</div><div style="flex:1"><div style="color:#fff;font-size:.82rem;font-weight:700">${c.authorName||'—'}</div><div style="color:rgba(255,255,255,.7);font-size:.82rem;margin-top:3px;line-height:1.5">${c.text}</div><div style="color:rgba(255,255,255,.3);font-size:.68rem;margin-top:4px">${c.createdAt?.toDate?timeAgo(c.createdAt.toDate()):''}</div></div><button onclick="adminDeleteComment('${c.id}','${c.postId||''}')" class="admin-btn-danger">🗑️</button></div></div>`).join(’’);
}catch(e){document.getElementById(‘admin-comments-list’).innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;}
}
window.adminDeleteComment=async(id,postId)=>{if(!confirm(‘حذف؟’))return;await deleteDoc(doc(db,‘wb_comments’,id));if(postId)await updateDoc(doc(db,‘wb_posts’,postId),{comments:increment(-1)}).catch(()=>{});adminComments();};

async function adminReports(){
const content=document.getElementById(‘admin-content’);
content.innerHTML=’<div style="padding:14px"><div class="admin-card"><div class="admin-card-title"><i class="fas fa-flag" style="color:#e74c3c"></i> البلاغات</div><div id="admin-reports-list"><div style="text-align:center;padding:20px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin"></i></div></div></div></div>’;
try{
const snap=await getDocs(collection(db,‘wb_reports’));
const list=document.getElementById(‘admin-reports-list’);
if(snap.empty){list.innerHTML=’<div style="text-align:center;padding:20px;color:rgba(255,255,255,.3)">✅ لا توجد بلاغات</div>’;return;}
const reports=[];snap.forEach(d=>reports.push({id:d.id,…d.data()}));
list.innerHTML=reports.map(r=>`<div class="admin-row"><div style="flex:1"><div style="color:#fff;font-size:.82rem;font-weight:700">${r.reason||'—'}</div><div style="color:rgba(255,255,255,.4);font-size:.72rem">من: ${r.reporterName||'—'}</div></div><button onclick="adminDeleteReport('${r.id}')" class="admin-btn-danger">🗑️</button></div>`).join(’’);
}catch(e){document.getElementById(‘admin-reports-list’).innerHTML=’<div style="color:rgba(255,255,255,.3);text-align:center;padding:20px">لا بلاغات بعد</div>’;}
}
window.adminDeleteReport=async(id)=>{await deleteDoc(doc(db,‘wb_reports’,id));adminReports();};

function adminSettings(){
const content=document.getElementById(‘admin-content’);
content.innerHTML=`<div style="padding:14px">
<div class="admin-card">
<div class="admin-card-title"><i class="fas fa-shield-alt" style="color:#5c7a4e"></i> إعدادات الأمان</div>
<div class="admin-row"><div style="flex:1"><div style="color:#fff;font-size:.85rem;font-weight:700">السماح بالتسجيل</div><div style="color:rgba(255,255,255,.35);font-size:.72rem">فتح/إغلاق تسجيل المستخدمين الجدد</div></div><button class="admin-toggle on" onclick="this.classList.toggle('on')"></button></div>
<div class="admin-row"><div style="flex:1"><div style="color:#fff;font-size:.85rem;font-weight:700">وضع الصيانة</div><div style="color:rgba(255,255,255,.35);font-size:.72rem">إيقاف التطبيق مؤقتاً</div></div><button class="admin-toggle" onclick="this.classList.toggle('on')"></button></div>
<div class="admin-row"><div style="flex:1"><div style="color:#fff;font-size:.85rem;font-weight:700">تحقق البريد عند التسجيل</div><div style="color:rgba(255,255,255,.35);font-size:.72rem">إرسال بريد تحقق</div></div><button class="admin-toggle on" onclick="this.classList.toggle('on')"></button></div>
</div>
<div class="admin-card">
<div class="admin-card-title"><i class="fas fa-database" style="color:#3498db"></i> إدارة البيانات</div>
<div style="display:flex;flex-direction:column;gap:8px">
<button onclick="adminCleanStories()" class="admin-btn-danger" style="padding:11px;border-radius:10px;font-size:.82rem;text-align:right"><i class="fas fa-clock"></i> حذف القصص المنتهية (+24 ساعة)</button>
<button onclick="adminCleanNotifs()" class="admin-btn-primary" style="padding:11px;border-radius:10px;font-size:.82rem;text-align:right"><i class="fas fa-bell-slash"></i> حذف الإشعارات القديمة (+30 يوم)</button>
<button onclick="adminExportData()" class="admin-btn-success" style="padding:11px;border-radius:10px;font-size:.82rem;text-align:right"><i class="fas fa-download"></i> تصدير الإحصائيات JSON</button>
</div>
</div>
<div class="admin-card">
<div class="admin-card-title"><i class="fas fa-info-circle" style="color:#f39c12"></i> معلومات التطبيق</div>
<div class="admin-row"><div style="flex:1;color:rgba(255,255,255,.5);font-size:.82rem">اسم التطبيق</div><div style="color:#fff;font-size:.82rem;font-weight:700">Webook</div></div>
<div class="admin-row"><div style="flex:1;color:rgba(255,255,255,.5);font-size:.82rem">Firebase</div><div style="color:#fff;font-size:.75rem;font-family:monospace">webook-c6485</div></div>
<div class="admin-row"><div style="flex:1;color:rgba(255,255,255,.5);font-size:.82rem">Cloudinary</div><div style="color:#fff;font-size:.75rem;font-family:monospace">dooaagbr8</div></div>
<div class="admin-row"><div style="flex:1;color:rgba(255,255,255,.5);font-size:.82rem">الإصدار</div><div style="color:#2ecc71;font-size:.82rem;font-weight:700">v2.0.0</div></div>
</div>
<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">
<button onclick="closeAdmin()" style="width:100%;padding:13px;border-radius:12px;border:none;background:rgba(255,255,255,.08);color:rgba(255,255,255,.7);font-family:'Cairo',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer"><i class="fas fa-times"></i> إغلاق لوحة الإدارة</button>
<button onclick="if(confirm('هل تريد تسجيل الخروج من الحساب؟')){closeAdmin();doLogout()}" style="width:100%;padding:13px;border-radius:12px;border:none;background:rgba(231,76,60,.15);color:#e74c3c;font-family:'Cairo',sans-serif;font-weight:700;font-size:.9rem;cursor:pointer"><i class="fas fa-sign-out-alt"></i> تسجيل الخروج من الحساب</button>
</div>

  </div>`;
}
window.adminCleanStories=async()=>{const cut=new Date(Date.now()-24*60*60*1000);const snap=await getDocs(collection(db,'wb_stories'));let n=0;for(const d of snap.docs){if((d.data().createdAt?.toDate?.()||new Date(0))<cut){await deleteDoc(d.ref);n++;}}alert(`✅ تم حذف ${n} قصة`);};
window.adminCleanNotifs=async()=>{const cut=new Date(Date.now()-30*24*60*60*1000);const snap=await getDocs(collection(db,'wb_notifications'));let n=0;for(const d of snap.docs){if((d.data().createdAt?.toDate?.()||new Date(0))<cut){await deleteDoc(d.ref);n++;}}alert(`✅ تم حذف ${n} إشعار`);};
window.adminExportData=async()=>{try{const [u,p,r,c]=await Promise.all([getDocs(collection(db,'wb_users')),getDocs(collection(db,'wb_posts')),getDocs(collection(db,'wb_reels')),getDocs(collection(db,'wb_comments'))]);const data={exportDate:new Date().toISOString(),stats:{users:u.size,posts:p.size,reels:r.size,comments:c.size}};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='webook-stats.json';a.click();}catch(e){alert('خطأ: '+e.message);}};
async function adminStories(){
  const content=document.getElementById('admin-content');
  content.innerHTML='<div style="padding:14px"><div id="admin-stories-list"><div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem"></i></div></div></div>';
  try{
    const snap=await getDocs(collection(db,'wb_stories'));
    const stories=[];snap.forEach(d=>stories.push({id:d.id,...d.data()}));
    stories.sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    const list=document.getElementById('admin-stories-list');
    if(!stories.length){list.innerHTML='<div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)">لا توجد قصص</div>';return;}
    stories.forEach(s=>{
      const el=document.createElement('div');
      el.className='admin-card';
      el.style.marginBottom='10px';
      const t=s.createdAt?.toDate?timeAgo(s.createdAt.toDate()):'';
      const expired=(Date.now()-(s.createdAt?.seconds||0)*1000)>86400000;
      el.innerHTML=`
        <div class="admin-row">
          <div class="admin-av">${s.authorAvatar?`<img src="${s.authorAvatar}">`:(s.authorName?.[0]||'م')}</div>
          <div style="flex:1">
            <div style="color:#fff;font-size:.85rem;font-weight:700">${s.authorName||'مستخدم'}</div>
            <div style="color:rgba(255,255,255,.4);font-size:.72rem">${t} ${expired?'· <span style="color:#e74c3c">منتهية</span>':''}</div>
          </div>
          <span class="admin-badge ${expired?'red':'green'}">${expired?'منتهية':'نشطة'}</span>
          <button onclick="adminDeleteStory('${s.id}',this.closest('.admin-card'))" class="admin-btn-danger" style="margin-right:8px"><i class="fas fa-trash"></i></button>
        </div>
        ${s.imageUrl?`<img src="${s.imageUrl}" style="width:100%;border-radius:10px;max-height:200px;object-fit:cover;margin-top:10px">`:''}
        ${s.text?`<div style="color:rgba(255,255,255,.8);font-size:.85rem;margin-top:10px;line-height:1.5;padding:10px;background:rgba(255,255,255,.05);border-radius:8px">${s.text}</div>`:''}`;
      list.appendChild(el);
    });
  }catch(e){document.getElementById('admin-stories-list').innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;}
}
window.adminDeleteStory=async(id,el)=>{
  if(!confirm('حذف هذه القصة؟'))return;
  await deleteDoc(doc(db,'wb_stories',id));
  el.style.opacity='.3';setTimeout(()=>el.remove(),300);
};

async function adminChats(){
const content=document.getElementById(‘admin-content’);
const wrap=document.createElement(‘div’);
wrap.style.cssText=‘display:flex;flex-direction:column;height:100%;’;

// القائمة اليسرى + معاينة اليمين
wrap.innerHTML=` <div style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:center;justify-content:space-between;flex-shrink:0"> <div style="color:rgba(255,255,255,.5);font-size:.78rem">اضغط على محادثة لمعاينتها</div> <div id="admin-chats-count" style="color:rgba(255,255,255,.3);font-size:.72rem"></div> </div> <div style="display:flex;flex:1;overflow:hidden"> <!-- قائمة المحادثات --> <div id="admin-chats-list" style="width:100%;overflow-y:auto;border-left:1px solid rgba(255,255,255,.07)"> <div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin" style="font-size:1.5rem"></i></div> </div> <!-- معاينة المحادثة --> <div id="admin-chat-preview" style="display:none;flex-direction:column;width:100%;overflow:hidden"> <div id="admin-chat-preview-hdr" style="padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.07);flex-shrink:0;display:flex;align-items:center;gap:10px"> <button onclick="adminShowChatsList()" style="background:rgba(255,255,255,.1);border:none;color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer"><i class="fas fa-arrow-right"></i></button> <div id="admin-preview-name" style="color:#fff;font-weight:700;font-size:.88rem;flex:1"></div> <button onclick="adminDeleteChatFull()" class="admin-btn-danger" style="font-size:.72rem"><i class="fas fa-trash"></i> حذف الكل</button> </div> <div id="admin-chat-preview-msgs" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px"></div> </div> </div>`;
content.innerHTML=’’;
content.appendChild(wrap);

try{
const snap=await getDocs(collection(db,‘wb_chats’));
const chats=[];
snap.forEach(d=>chats.push({id:d.id,…d.data()}));
chats.sort((a,b)=>(b.lastMessageAt?.seconds||0)-(a.lastMessageAt?.seconds||0));
const list=document.getElementById(‘admin-chats-list’);
const countEl=document.getElementById(‘admin-chats-count’);
if(countEl) countEl.textContent=`${chats.length} محادثة`;

```
if(!chats.length){
  list.innerHTML='<div style="color:rgba(255,255,255,.3);text-align:center;padding:30px">لا توجد دردشات</div>';
  return;
}

list.innerHTML='';
// جلب بيانات المستخدمين لكل محادثة
for(const chat of chats){
  const [uid1,uid2]=chat.participants||[];
  const [u1snap,u2snap]=await Promise.all([
    uid1?getDoc(doc(db,'wb_users',uid1)):Promise.resolve(null),
    uid2?getDoc(doc(db,'wb_users',uid2)):Promise.resolve(null)
  ]);
  const u1=u1snap?.data()||{name:'مستخدم',avatar:''};
  const u2=u2snap?.data()||{name:'مستخدم',avatar:''};
  const msgCount=chat.msgCount||'—';
  const lastTime=chat.lastMessageAt?.toDate?timeAgo(chat.lastMessageAt.toDate()):'';

  const el=document.createElement('div');
  el.style.cssText='display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:background .15s;';
  el.onmouseenter=()=>el.style.background='rgba(255,255,255,.04)';
  el.onmouseleave=()=>el.style.background='transparent';
  el.innerHTML=`
    <div style="position:relative;flex-shrink:0">
      <div class="admin-av" style="width:40px;height:40px">${u1.avatar?`<img src="${u1.avatar}">`:(u1.name?.[0]||'م')}</div>
      <div class="admin-av" style="width:24px;height:24px;position:absolute;bottom:-4px;left:-4px;border:2px solid #1a1a2e;font-size:.6rem">${u2.avatar?`<img src="${u2.avatar}">`:(u2.name?.[0]||'م')}</div>
    </div>
    <div style="flex:1;min-width:0">
      <div style="color:#fff;font-size:.82rem;font-weight:700;margin-bottom:2px">${u1.name} ↔ ${u2.name}</div>
      <div style="color:rgba(255,255,255,.35);font-size:.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${chat.lastMessage||'لا رسائل'}</div>
    </div>
    <div style="flex-shrink:0;text-align:left">
      <div style="color:rgba(255,255,255,.3);font-size:.65rem">${lastTime}</div>
      <button onclick="event.stopPropagation();adminDeleteChat('${chat.id}',this.closest('div[style]'))" style="background:rgba(231,76,60,.15);border:none;color:#e74c3c;border-radius:6px;padding:3px 7px;font-size:.65rem;cursor:pointer;margin-top:4px"><i class="fas fa-trash"></i></button>
    </div>`;
  el.onclick=()=>adminOpenChatPreview(chat.id,`${u1.name} ↔ ${u2.name}`,uid1);
  list.appendChild(el);
}
```

}catch(e){
document.getElementById(‘admin-chats-list’).innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;
}
}

let _adminActiveChatId=null;

window.adminShowChatsList=()=>{
document.getElementById(‘admin-chats-list’).style.display=‘block’;
document.getElementById(‘admin-chat-preview’).style.display=‘none’;
};

window.adminOpenChatPreview=async(chatId,title,uid1)=>{
_adminActiveChatId=chatId;
const listEl=document.getElementById(‘admin-chats-list’);
const preview=document.getElementById(‘admin-chat-preview’);
const nameEl=document.getElementById(‘admin-preview-name’);
const msgsEl=document.getElementById(‘admin-chat-preview-msgs’);
if(!preview||!msgsEl)return;

listEl.style.display=‘none’;
preview.style.display=‘flex’;
nameEl.textContent=title;
msgsEl.innerHTML=’<div style="text-align:center;padding:20px;color:rgba(255,255,255,.3)"><i class="fas fa-circle-notch fa-spin"></i></div>’;

try{
const snap=await getDocs(query(collection(db,‘wb_messages’),where(‘chatId’,’==’,chatId)));
const msgs=[];
snap.forEach(d=>msgs.push({id:d.id,…d.data()}));
msgs.sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
msgsEl.innerHTML=’’;
if(!msgs.length){
msgsEl.innerHTML=’<div style="text-align:center;padding:30px;color:rgba(255,255,255,.3)">لا توجد رسائل</div>’;
return;
}
msgs.forEach(m=>{
const isLeft=m.senderId===uid1;
const t=m.createdAt?.toDate?m.createdAt.toDate().toLocaleTimeString(‘ar’,{hour:‘2-digit’,minute:‘2-digit’}):’’;
const el=document.createElement(‘div’);
el.id=‘admin-msg-’+m.id;
el.style.cssText=`display:flex;flex-direction:column;align-items:${isLeft?'flex-start':'flex-end'};gap:2px;`;
el.innerHTML=` <div style="color:rgba(255,255,255,.3);font-size:.6rem;margin:0 4px">${m.senderName||''} · ${t}</div> <div style="display:flex;align-items:center;gap:6px;${isLeft?'':'flex-direction:row-reverse'}"> <div style="max-width:75%;background:${isLeft?'rgba(92,122,78,.35)':'rgba(52,152,219,.25)'};padding:8px 12px;border-radius:${isLeft?'4px 14px 14px 14px':'14px 4px 14px 14px'};font-size:.82rem;color:rgba(255,255,255,.85);line-height:1.5;word-break:break-word">${m.text}</div> <button onclick="adminDeleteMsg('${m.id}','${chatId}','admin-msg-${m.id}')" style="background:rgba(231,76,60,.15);border:none;color:#e74c3c;width:26px;height:26px;border-radius:50%;cursor:pointer;flex-shrink:0;font-size:.7rem" title="حذف الرسالة"><i class="fas fa-times"></i></button> </div>`;
msgsEl.appendChild(el);
});
msgsEl.scrollTop=msgsEl.scrollHeight;
}catch(e){
msgsEl.innerHTML=`<div style="color:#e74c3c;padding:20px">خطأ: ${e.message}</div>`;
}
};

window.adminDeleteMsg=async(msgId,chatId,elId)=>{
if(!confirm(‘حذف هذه الرسالة؟’))return;
try{
await deleteDoc(doc(db,‘wb_messages’,msgId));
const el=document.getElementById(elId);
if(el){el.style.opacity=’.2’;setTimeout(()=>el.remove(),300);}
}catch(e){alert(’خطأ: ’+e.message);}
};

window.adminDeleteChatFull=async()=>{
if(!_adminActiveChatId||!confirm(‘حذف المحادثة وجميع رسائلها نهائياً؟’))return;
try{
const msgs=await getDocs(query(collection(db,‘wb_messages’),where(‘chatId’,’==’,_adminActiveChatId)));
for(const d of msgs.docs) await deleteDoc(d.ref);
await deleteDoc(doc(db,‘wb_chats’,_adminActiveChatId));
_adminActiveChatId=null;
adminChats(); // إعادة التحميل
}catch(e){alert(’خطأ: ’+e.message);}
};

window.adminDeleteChat=async(chatId,el)=>{
if(!confirm(‘حذف هذه المحادثة وجميع رسائلها؟’))return;
try{
const msgs=await getDocs(query(collection(db,‘wb_messages’),where(‘chatId’,’==’,chatId)));
for(const d of msgs.docs) await deleteDoc(d.ref);
await deleteDoc(doc(db,‘wb_chats’,chatId));
el.style.opacity=’.3’;setTimeout(()=>el.remove(),300);
}catch(e){alert(’خطأ: ’+e.message);}
};

window.adminLoad=async(type)=>{const m={posts:‘posts’,comments:‘comments’,users:‘users’};adminTab(document.querySelector(`.admin-tab[data-tab=${m[type]}]`),m[type]);};
window.adminDelete=async(type,id,el)=>{if(!confirm(‘حذف؟’))return;try{await deleteDoc(doc(db,type===‘posts’?‘wb_posts’:type===‘comments’?‘wb_comments’:‘wb_users’,id));el.style.opacity=’.3’;setTimeout(()=>el.remove(),300);}catch(e){alert(e.message);}};
window.fixFirestoreRules=()=>{alert(`Firebase Console → Firestore → Rules

الصق هذا النص:

rules_version = ‘2’;
service cloud.firestore {
match /databases/{database}/documents {
match /{document=**} {
allow read, write: if request.auth != null;
}
}
}

ثم اضغط Publish`);};

// ══════════════════════════════
// OVERLAYS
// ══════════════════════════════
window.openOverlay=id=>document.getElementById(id).classList.add(‘open’);
window.closeOverlay=id=>{
document.getElementById(id).classList.remove(‘open’);
if(id===‘comments-overlay’&&G.unsubs.comments){G.unsubs.comments();G.unsubs.comments=null;}
};

// ══════════════════════════════
// UTILS
// ══════════════════════════════
// علامة التوثيق الزرقاء
function vbadge(isVerified, size=’’){
if(!isVerified) return ‘’;
return `<span class="vbadge ${size}" title="حساب موثق"><i class="fas fa-check"></i></span>`;
}

function timeAgo(date){
const s=Math.floor((Date.now()-date)/1000);
if(s<60)return ‘الآن’;if(s<3600)return Math.floor(s/60)+’ د’;
if(s<86400)return Math.floor(s/3600)+’ س’;return Math.floor(s/86400)+’ يوم’;
}

// ══════════════════════════════
// CALL SYSTEM — Daily.co (مجاني 10,000 دقيقة/شهر)
// ══════════════════════════════
// ══════════════════════════════
// GROUP CHAT SYSTEM
// ══════════════════════════════
const GC = { groupId:null, groupData:null, selectedMembers:[], avatarData:null, unsub:null };

// فتح نافذة إنشاء مجموعة
window.openCreateGroup=()=>{
GC.selectedMembers=[];
GC.avatarData=null;
document.getElementById(‘cg-name’).value=’’;
document.getElementById(‘cg-desc’).value=’’;
document.getElementById(‘cg-search’).value=’’;
document.getElementById(‘cg-search-results’).innerHTML=’’;
document.getElementById(‘cg-selected-list’).innerHTML=’’;
document.getElementById(‘cg-selected-wrap’).style.display=‘none’;
document.getElementById(‘cg-avatar-prev’).innerHTML=’<i class="fas fa-camera" style="color:#fff;font-size:1.5rem"></i>’;
openOverlay(‘create-group-overlay’);
};

window.previewGroupAvatar=async(input)=>{
const file=input.files[0]; if(!file) return;
GC.avatarData=await compressImg(file,300,.85);
document.getElementById(‘cg-avatar-prev’).innerHTML=`<img src="${GC.avatarData}" style="width:100%;height:100%;object-fit:cover">`;
};

// بحث الأعضاء
window.searchGroupMembers=async(q)=>{
const res=document.getElementById(‘cg-search-results’);
if(!q.trim()){ res.innerHTML=’’; return; }
res.innerHTML=’<div style="padding:8px;color:#6b7a5a;font-size:.8rem">جاري البحث…</div>’;
try{
const snap=await getDocs(collection(db,‘wb_users’));
const users=[]; snap.forEach(d=>{
const u=d.data();
if(u.uid===G.user?.uid) return;
if(GC.selectedMembers.find(m=>m.uid===u.uid)) return;
if(u.name?.toLowerCase().includes(q.toLowerCase())||u.username?.toLowerCase().includes(q.toLowerCase()))
users.push(u);
});
res.innerHTML=’’;
if(!users.length){ res.innerHTML=’<div style="padding:8px;color:#6b7a5a;font-size:.8rem">لا نتائج</div>’; return; }
users.slice(0,6).forEach(u=>{
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:10px;padding:8px 4px;border-bottom:1px solid rgba(92,122,78,.08);cursor:pointer’;
el.onclick=()=>addGroupMember(u);
el.innerHTML=` <div style="width:36px;height:36px;border-radius:50%;background:#8aab7a;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:(u.name?.[0]||'م')} </div> <div style="flex:1"><div style="font-weight:700;font-size:.85rem">${u.name}${vbadge(u.isVerified)}</div><div style="font-size:.72rem;color:#6b7a5a">@${u.username}</div></div> <i class="fas fa-plus-circle" style="color:#5c7a4e;font-size:1.1rem"></i>`;
res.appendChild(el);
});
}catch(e){ res.innerHTML=’’; }
};

function addGroupMember(u){
if(GC.selectedMembers.find(m=>m.uid===u.uid)) return;
GC.selectedMembers.push(u);
document.getElementById(‘cg-search’).value=’’;
document.getElementById(‘cg-search-results’).innerHTML=’’;
renderSelectedMembers();
}

function renderSelectedMembers(){
const wrap=document.getElementById(‘cg-selected-wrap’);
const list=document.getElementById(‘cg-selected-list’);
wrap.style.display=GC.selectedMembers.length?‘block’:‘none’;
list.innerHTML=’’;
GC.selectedMembers.forEach(u=>{
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:6px;background:rgba(92,122,78,.1);border-radius:20px;padding:4px 10px 4px 6px;’;
el.innerHTML=` <div style="width:24px;height:24px;border-radius:50%;background:#8aab7a;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700;color:#fff"> ${u.avatar?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:(u.name?.[0]||'م')} </div> <span style="font-size:.78rem;font-weight:700">${u.name}</span> <button onclick="removeGroupMember('${u.uid}')" style="background:none;border:none;color:#e74c3c;cursor:pointer;padding:0;font-size:.8rem;margin-right:2px"><i class="fas fa-times"></i></button>`;
list.appendChild(el);
});
}

window.removeGroupMember=(uid)=>{
GC.selectedMembers=GC.selectedMembers.filter(m=>m.uid!==uid);
renderSelectedMembers();
};

// إنشاء المجموعة
window.createGroup=async()=>{
const name=document.getElementById(‘cg-name’).value.trim();
const desc=document.getElementById(‘cg-desc’).value.trim();
if(!name){ alert(‘❌ أدخل اسم المجموعة’); return; }
if(GC.selectedMembers.length<1){ alert(‘❌ أضف عضواً واحداً على الأقل’); return; }

try{
const members=[G.user.uid,…GC.selectedMembers.map(m=>m.uid)];
const memberNames={};
memberNames[G.user.uid]={name:G.userData?.name||’’,avatar:G.userData?.avatar||’’};
GC.selectedMembers.forEach(m=>{ memberNames[m.uid]={name:m.name||’’,avatar:m.avatar||’’}; });

```
const groupRef=await addDoc(collection(db,'wb_groups'),{
  name, desc, avatar:GC.avatarData||'',
  members, memberNames,
  adminId:G.user.uid,
  mutedMembers:[],
  createdAt:serverTimestamp(),
  lastMessage:'', lastMessageAt:serverTimestamp()
});

// إشعار للأعضاء
for(const uid of GC.selectedMembers.map(m=>m.uid)){
  await addDoc(collection(db,'wb_notifications'),{
    userId:uid, type:'group_added',
    actorId:G.user.uid, actorName:G.userData?.name||'',
    groupId:groupRef.id, groupName:name,
    read:false, createdAt:serverTimestamp()
  }).catch(()=>{});
}

closeOverlay('create-group-overlay');
openGroupChat(groupRef.id,{id:groupRef.id,name,desc,avatar:GC.avatarData||'',adminId:G.user.uid,members,memberNames,mutedMembers:[]});
```

}catch(e){ alert(’خطأ: ’+e.message); }
};

// فتح محادثة المجموعة
window.openGroupChat=async(groupId,groupData)=>{
GC.groupId=groupId; GC.groupData=groupData;

const screen=document.getElementById(‘group-chat-screen’);
screen.style.display=‘flex’;

// الهيدر
const avEl=document.getElementById(‘gc-avatar’);
avEl.innerHTML=groupData.avatar?`<img src="${groupData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:groupData.name?.[0]||‘م’;
document.getElementById(‘gc-name’).textContent=groupData.name||‘مجموعة’;
document.getElementById(‘gc-members-count’).textContent=`${groupData.members?.length||0} عضو`;

// تحميل الرسائل
const msgs=document.getElementById(‘gc-msgs’);
msgs.innerHTML=’’;
if(GC.unsub) GC.unsub();
const q=query(collection(db,‘wb_groups’,groupId,‘messages’));
GC.unsub=onSnapshot(q,snap=>{
const arr=[]; snap.forEach(d=>arr.push({id:d.id,…d.data()}));
arr.sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
msgs.innerHTML=’’;
arr.forEach(m=>{
const isMe=m.senderId===G.user?.uid;
const t=m.createdAt?.toDate?m.createdAt.toDate().toLocaleTimeString(‘ar’,{hour:‘2-digit’,minute:‘2-digit’}):’’;
const el=document.createElement(‘div’);
el.style.cssText=`display:flex;flex-direction:column;align-items:${isMe?'flex-start':'flex-end'};gap:2px;margin-bottom:2px`;
if(!isMe){
el.innerHTML=` <div style="font-size:.65rem;color:#6b7a5a;padding:0 8px">${m.senderName||''}</div> <div class="chat-bubble them">${m.text}<div class="chat-time">${t}</div></div>`;
} else {
el.innerHTML=`<div class="chat-bubble me">${m.text}<div class="chat-time">${t}</div></div>`;
}
msgs.appendChild(el);
});
msgs.scrollTop=msgs.scrollHeight;
// تحديث آخر قراءة
updateDoc(doc(db,‘wb_groups’,groupId),{[`lastRead.${G.user?.uid}`]:serverTimestamp()}).catch(()=>{});
},err=>console.error(err));
};

window.closeGroupChat=()=>{
document.getElementById(‘group-chat-screen’).style.display=‘none’;
if(GC.unsub){ GC.unsub(); GC.unsub=null; }
GC.groupId=null; GC.groupData=null;
};

// إرسال رسالة للمجموعة
window.sendGroupMsg=async()=>{
const inp=document.getElementById(‘gc-inp’);
const text=inp.value.trim(); if(!text||!GC.groupId) return;
inp.value=’’;
// تحقق أن المستخدم ليس مكتوماً
if((GC.groupData?.mutedMembers||[]).includes(G.user?.uid)){
alert(‘⚠️ أنت مكتوم في هذه المجموعة’); inp.value=text; return;
}
try{
await addDoc(collection(db,‘wb_groups’,GC.groupId,‘messages’),{
text, senderId:G.user.uid, senderName:G.userData?.name||’’,
senderAvatar:G.userData?.avatar||’’, createdAt:serverTimestamp()
});
await updateDoc(doc(db,‘wb_groups’,GC.groupId),{
lastMessage:`${G.userData?.name||''}: ${text.substring(0,40)}`,
lastMessageAt:serverTimestamp()
});
}catch(e){ inp.value=text; }
};

// إعدادات المجموعة
window.openGroupSettings=async()=>{
if(!GC.groupData) return;
const g=GC.groupData;
const isAdmin=g.adminId===G.user?.uid;

document.getElementById(‘gs-avatar’).innerHTML=g.avatar?`<img src="${g.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:g.name?.[0]||‘م’;
document.getElementById(‘gs-name’).textContent=g.name||‘مجموعة’;
document.getElementById(‘gs-desc’).textContent=g.desc||‘لا يوجد وصف’;
document.getElementById(‘gs-admin-add’).style.display=isAdmin?‘block’:‘none’;
document.getElementById(‘gs-delete-btn’).style.display=isAdmin?‘flex’:‘none’;

// قائمة الأعضاء
const membersList=document.getElementById(‘gs-members-list’);
membersList.innerHTML=’’;
(g.members||[]).forEach(uid=>{
const info=g.memberNames?.[uid]||{name:‘مستخدم’,avatar:’’};
const isAdminUser=uid===g.adminId;
const isMuted=(g.mutedMembers||[]).includes(uid);
const isMe=uid===G.user?.uid;
const el=document.createElement(‘div’);
el.style.cssText=‘display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(92,122,78,.08)’;
el.innerHTML=` <div style="width:40px;height:40px;border-radius:50%;background:#8aab7a;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff"> ${info.avatar?`<img src="${info.avatar}" style="width:100%;height:100%;object-fit:cover">`:info.name?.[0]||'م'} </div> <div style="flex:1"> <div style="font-weight:700;font-size:.85rem">${info.name||'مستخدم'}${isAdminUser?' 👑':''} ${isMuted?'<span style="color:#e67e22;font-size:.7rem">(مكتوم)</span>':''}</div> ${isMe?'<div style="font-size:.7rem;color:#5c7a4e">أنت</div>':''} </div> ${isAdmin&&!isMe?`
<div style="display:flex;gap:6px">
<button onclick="toggleMuteMember('${uid}','${info.name}')" style="padding:5px 10px;border-radius:12px;border:1px solid rgba(230,126,34,.4);background:rgba(230,126,34,.1);color:#e67e22;font-family:Cairo,sans-serif;font-size:.7rem;cursor:pointer">${isMuted?‘رفع الكتم’:‘كتم’}</button>
<button onclick="kickMember('${uid}','${info.name}')" style="padding:5px 10px;border-radius:12px;border:1px solid rgba(231,76,60,.4);background:rgba(231,76,60,.1);color:#e74c3c;font-family:Cairo,sans-serif;font-size:.7rem;cursor:pointer">طرد</button>
</div>`:'' }`;
membersList.appendChild(el);
});

openOverlay(‘group-settings-overlay’);
};

// كتم/رفع كتم عضو
window.toggleMuteMember=async(uid,name)=>{
if(!GC.groupId||!GC.groupData) return;
const muted=[…(GC.groupData.mutedMembers||[])];
const isMuted=muted.includes(uid);
if(!confirm(`${isMuted?'رفع كتم':'كتم'} ${name}؟`)) return;
if(isMuted) muted.splice(muted.indexOf(uid),1);
else muted.push(uid);
await updateDoc(doc(db,‘wb_groups’,GC.groupId),{mutedMembers:muted});
GC.groupData={…GC.groupData,mutedMembers:muted};
openGroupSettings();
};

// طرد عضو
window.kickMember=async(uid,name)=>{
if(!GC.groupId||!GC.groupData) return;
if(!confirm(`هل تريد طرد ${name} من المجموعة؟`)) return;
const members=GC.groupData.members.filter(m=>m!==uid);
const memberNames={…GC.groupData.memberNames};
delete memberNames[uid];
await updateDoc(doc(db,‘wb_groups’,GC.groupId),{members,memberNames});
GC.groupData={…GC.groupData,members,memberNames};
document.getElementById(‘gc-members-count’).textContent=`${members.length} عضو`;
openGroupSettings();
};

// مغادرة المجموعة
window.leaveGroup=async()=>{
if(!GC.groupId||!confirm(‘هل تريد مغادرة المجموعة؟’)) return;
const members=GC.groupData.members.filter(m=>m!==G.user?.uid);
const memberNames={…GC.groupData.memberNames};
delete memberNames[G.user?.uid];
await updateDoc(doc(db,‘wb_groups’,GC.groupId),{members,memberNames});
closeOverlay(‘group-settings-overlay’);
closeGroupChat();
};

// حذف المجموعة (المدير فقط)
window.deleteGroup=async()=>{
if(!GC.groupId||!confirm(‘هل تريد حذف المجموعة نهائياً؟’)) return;
await deleteDoc(doc(db,‘wb_groups’,GC.groupId));
closeOverlay(‘group-settings-overlay’);
closeGroupChat();
};

// إضافة عضو جديد (من إعدادات المجموعة)
window.openAddGroupMember=async()=>{
closeOverlay(‘group-settings-overlay’);
const q=prompt(‘ابحث عن اسم المستخدم:’);
if(!q) return;
const snap=await getDocs(collection(db,‘wb_users’));
const found=[]; snap.forEach(d=>{
const u=d.data();
if((GC.groupData?.members||[]).includes(u.uid)) return;
if(u.name?.toLowerCase().includes(q.toLowerCase())||u.username?.toLowerCase().includes(q.toLowerCase()))
found.push(u);
});
if(!found.length){ alert(‘لا نتائج’); openGroupSettings(); return; }
const names=found.slice(0,5).map((u,i)=>`${i+1}. ${u.name} (@${u.username})`).join(’\n’);
const choice=prompt(`اختر رقم المستخدم:\n${names}`);
const idx=parseInt(choice)-1;
if(isNaN(idx)||idx<0||idx>=found.length){ openGroupSettings(); return; }
const u=found[idx];
const members=[…(GC.groupData?.members||[]),u.uid];
const memberNames={…(GC.groupData?.memberNames||{}),[u.uid]:{name:u.name||’’,avatar:u.avatar||’’}};
await updateDoc(doc(db,‘wb_groups’,GC.groupId),{members,memberNames});
GC.groupData={…GC.groupData,members,memberNames};
document.getElementById(‘gc-members-count’).textContent=`${members.length} عضو`;
openGroupSettings();
};
// ══════════════════════════════
const CALL = {
pc: null, localStream: null,
type: ‘voice’, roomId: null,
isMuted: false, isCamOff: false,
timer: null, seconds: 0,
unsubAnswer: null, unsubIce: null,
};

const ICE = { iceServers:[
{urls:‘stun:stun.l.google.com:19302’},
{urls:‘stun:stun2.l.google.com:19302’},
{urls:‘stun:stun4.l.google.com:19302’},
{urls:‘stun:stun.relay.metered.ca:80’},
{
urls:‘turn:a.relay.metered.ca:80’,
username:‘83e9d1f7bc64e0f09a8d3b91’,
credential:‘mtk/hGtjTMrFDmXJ’
},
{
urls:‘turn:a.relay.metered.ca:80?transport=tcp’,
username:‘83e9d1f7bc64e0f09a8d3b91’,
credential:‘mtk/hGtjTMrFDmXJ’
},
{
urls:‘turn:a.relay.metered.ca:443’,
username:‘83e9d1f7bc64e0f09a8d3b91’,
credential:‘mtk/hGtjTMrFDmXJ’
},
{
urls:‘turn:a.relay.metered.ca:443?transport=tcp’,
username:‘83e9d1f7bc64e0f09a8d3b91’,
credential:‘mtk/hGtjTMrFDmXJ’
},
]};

function genRoomId(a,b){ return ‘call_’+[a,b].sort().join(’_’); }

// ── بدء مكالمة ──
window.startCall=async(type)=>{
if(!G.user||!G.currentChatOtherUid){alert(‘افتح محادثة أولاً’);return;}
CALL.type=type;
CALL.roomId=genRoomId(G.user.uid,G.currentChatOtherUid);
// احذف أي مكالمة قديمة
await deleteDoc(doc(db,‘wb_calls’,CALL.roomId)).catch(()=>{});
// أنشئ سجل المكالمة
await setDoc(doc(db,‘wb_calls’,CALL.roomId),{
callerId:G.user.uid, callerName:G.userData?.name||’’,
callerAvatar:G.userData?.avatar||’’,
calleeId:G.currentChatOtherUid,
type, status:‘ringing’, roomId:CALL.roomId,
createdAt:serverTimestamp()
});
openCallScreen(type,false);
await initWebRTC(true,type);
};

// ── شاشة المكالمة ──
function openCallScreen(type,isIncoming){
const u=G._chatOtherUser||{};
document.getElementById(‘call-screen’).style.display=‘flex’;
document.getElementById(‘call-other-av-big’).innerHTML=u.avatar
?`<img src="${u.avatar}" style="width:100%;height:100%;object-fit:cover">`:(u.name?.[0]||‘م’);
document.getElementById(‘call-other-name-big’).textContent=u.name||‘مكالمة’;
document.getElementById(‘call-status-text’).textContent=‘جاري الاتصال…’;
document.getElementById(‘call-timer’).style.display=‘none’;
document.getElementById(‘call-local-video’).style.display=type===‘video’?‘block’:‘none’;
document.getElementById(‘call-remote-video’).innerHTML=’’;
}

// ── WebRTC ──
async function initWebRTC(isCaller,type){
CALL.pc=new RTCPeerConnection(ICE);

// الحصول على الميديا
try{
CALL.localStream=await navigator.mediaDevices.getUserMedia({
audio:true, video:type===‘video’
});
}catch(e){
try{ CALL.localStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); }
catch(e2){ alert(’لا يمكن الوصول للميكروفون: ’+e2.message); endCall(); return; }
}

// إظهار الفيديو المحلي
if(type===‘video’&&CALL.localStream.getVideoTracks().length){
const lv=document.getElementById(‘call-local-video’);
lv.innerHTML=’<video autoplay muted playsinline style="width:100%;height:100%;object-fit:cover;border-radius:12px"></video>’;
lv.querySelector(‘video’).srcObject=CALL.localStream;
}

// إضافة tracks
CALL.localStream.getTracks().forEach(t=>CALL.pc.addTrack(t,CALL.localStream));

// متابعة حالة الاتصال
CALL.pc.onconnectionstatechange=()=>{
const state=CALL.pc.connectionState;
const statusEl=document.getElementById(‘call-status-text’);
if(state===‘connected’){ if(statusEl) statusEl.textContent=‘متصل ✓’; startCallTimer(); }
else if(state===‘connecting’){ if(statusEl) statusEl.textContent=‘جاري الربط…’; }
else if(state===‘failed’){ if(statusEl) statusEl.textContent=‘فشل الاتصال ❌’; setTimeout(endCall,2000); }
else if(state===‘disconnected’){ if(statusEl) statusEl.textContent=‘انقطع الاتصال…’; }
};

// استقبال stream الطرف الآخر
CALL.pc.ontrack=e=>{
if(!e.streams[0]) return;
const rv=document.getElementById(‘call-remote-video’);
if(type===‘video’){
rv.innerHTML=’<video autoplay playsinline style="width:100%;height:100%;object-fit:cover"></video>’;
rv.querySelector(‘video’).srcObject=e.streams[0];
} else {
let audio=rv.querySelector(‘audio’);
if(!audio){ rv.innerHTML=’<audio autoplay></audio>’; audio=rv.querySelector(‘audio’); }
audio.srcObject=e.streams[0];
}
};

// ICE candidates
CALL.pc.onicecandidate=async ev=>{
if(!ev.candidate) return;
const col=isCaller?‘callerIce’:‘calleeIce’;
await addDoc(collection(db,‘wb_calls’,CALL.roomId,col),ev.candidate.toJSON());
};

CALL.pc.onicegatheringstatechange=()=>{
console.log(‘ICE gathering:’,CALL.pc.iceGatheringState);
};

const callRef=doc(db,‘wb_calls’,CALL.roomId);

if(isCaller){
const offer=await CALL.pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:type===‘video’});
await CALL.pc.setLocalDescription(offer);
await updateDoc(callRef,{offer:{type:offer.type,sdp:offer.sdp}});

```
CALL.unsubAnswer=onSnapshot(callRef,async snap=>{
  const d=snap.data(); if(!d) return;
  if(d.answer&&!CALL.pc.currentRemoteDescription){
    try{ await CALL.pc.setRemoteDescription(new RTCSessionDescription(d.answer)); }catch(e){}
  }
  if(d.status==='rejected'||d.status==='ended') endCall();
});

CALL.unsubIce=onSnapshot(collection(db,'wb_calls',CALL.roomId,'calleeIce'),snap=>{
  snap.docChanges().forEach(async c=>{
    if(c.type==='added'){
      try{ await CALL.pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); }catch(e){}
    }
  });
});
```

} else {
// المستقبل — انتظر قليلاً حتى يصل الـ offer
let d = (await getDoc(callRef)).data();
if(!d?.offer){
await new Promise(r=>setTimeout(r,2000));
d = (await getDoc(callRef)).data();
}
if(!d?.offer){ endCall(); return; }

```
try{
  await CALL.pc.setRemoteDescription(new RTCSessionDescription(d.offer));
  const answer=await CALL.pc.createAnswer();
  await CALL.pc.setLocalDescription(answer);
  await updateDoc(callRef,{answer:{type:answer.type,sdp:answer.sdp},status:'accepted'});
}catch(e){ console.error('Answer error:',e); endCall(); return; }

CALL.unsubIce=onSnapshot(collection(db,'wb_calls',CALL.roomId,'callerIce'),snap=>{
  snap.docChanges().forEach(async c=>{
    if(c.type==='added'){
      try{ await CALL.pc.addIceCandidate(new RTCIceCandidate(c.doc.data())); }catch(e){}
    }
  });
});

CALL.unsubAnswer=onSnapshot(callRef,snap=>{
  const d=snap.data();
  if(d?.status==='ended') endCall();
});
```

}
}

function startCallTimer(){
CALL.seconds=0; clearInterval(CALL.timer);
CALL.timer=setInterval(()=>{
CALL.seconds++;
const m=String(Math.floor(CALL.seconds/60)).padStart(2,‘0’);
const s=String(CALL.seconds%60).padStart(2,‘0’);
const el=document.getElementById(‘call-timer’);
if(el){el.style.display=‘block’;el.textContent=`${m}:${s}`;}
},1000);
}

window.endCall=async()=>{
clearInterval(CALL.timer);
CALL.unsubAnswer?.(); CALL.unsubIce?.();
CALL.localStream?.getTracks().forEach(t=>t.stop());
try{CALL.pc?.close();}catch(e){}
CALL.pc=null; CALL.localStream=null;
document.getElementById(‘call-screen’).style.display=‘none’;
document.getElementById(‘call-remote-video’).innerHTML=’’;
document.getElementById(‘call-local-video’).innerHTML=’’;
if(CALL.roomId){
await updateDoc(doc(db,‘wb_calls’,CALL.roomId),{status:‘ended’}).catch(()=>{});
CALL.roomId=null;
}
};

window.toggleCallMute=()=>{
CALL.isMuted=!CALL.isMuted;
CALL.localStream?.getAudioTracks().forEach(t=>t.enabled=!CALL.isMuted);
const btn=document.getElementById(‘call-mute-btn’);
btn.style.background=CALL.isMuted?‘rgba(231,76,60,.5)’:‘rgba(255,255,255,.15)’;
btn.querySelector(‘i’).className=CALL.isMuted?‘fas fa-microphone-slash’:‘fas fa-microphone’;
};

window.toggleCallCamera=()=>{
CALL.isCamOff=!CALL.isCamOff;
CALL.localStream?.getVideoTracks().forEach(t=>t.enabled=!CALL.isCamOff);
const btn=document.getElementById(‘call-cam-btn’);
btn.style.background=CALL.isCamOff?‘rgba(231,76,60,.5)’:‘rgba(255,255,255,.15)’;
btn.querySelector(‘i’).className=CALL.isCamOff?‘fas fa-video-slash’:‘fas fa-video’;
};

// ── الاستماع للمكالمات الواردة ──
function listenIncomingCalls(){
if(!G.user)return;
if(G.unsubs.calls) G.unsubs.calls();
const q=query(collection(db,‘wb_calls’),where(‘calleeId’,’==’,G.user.uid),where(‘status’,’==’,‘ringing’));
G.unsubs.calls=onSnapshot(q,snap=>{
if(snap.empty){document.getElementById(‘incoming-call’).style.display=‘none’;return;}
snap.forEach(d=>{
const call={id:d.id,…d.data()};
const age=Date.now()-(call.createdAt?.seconds||0)*1000;
if(age>45000) return;
CALL.roomId=call.roomId;
CALL.type=call.type;
document.getElementById(‘inc-caller-av’).innerHTML=call.callerAvatar
?`<img src="${call.callerAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:(call.callerName?.[0]||‘م’);
document.getElementById(‘inc-caller-name’).textContent=call.callerName||‘مجهول’;
document.getElementById(‘inc-call-type’).textContent=call.type===‘video’?‘📹 مكالمة فيديو’:‘📞 مكالمة صوتية’;
document.getElementById(‘incoming-call’).style.display=‘block’;
G._chatOtherUser={name:call.callerName,avatar:call.callerAvatar,isVerified:false};
G.currentChatOtherUid=call.callerId;
});
});
}

window.acceptIncomingCall=async()=>{
document.getElementById(‘incoming-call’).style.display=‘none’;
await updateDoc(doc(db,‘wb_calls’,CALL.roomId),{status:‘accepted’});
openCallScreen(CALL.type,true);
await initWebRTC(false,CALL.type);
};

window.rejectIncomingCall=async()=>{
document.getElementById(‘incoming-call’).style.display=‘none’;
if(CALL.roomId) await updateDoc(doc(db,‘wb_calls’,CALL.roomId),{status:‘rejected’}).catch(()=>{});
CALL.roomId=null;
};

// Close menus on click outside
document.addEventListener(‘click’,()=>document.querySelectorAll(’.pmenu-dd’).forEach(d=>d.style.display=‘none’));
