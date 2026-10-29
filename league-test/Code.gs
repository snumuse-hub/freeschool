/**
 * 5개 중학교 스포츠스태킹 리그 기록 DB
 * 설치: Google Apps Script에 전체 붙여넣기 → 스크립트 속성 TEACHER_PIN(8자리 이상) 등록 →
 * 웹 앱으로 배포(실행 사용자: 나, 접근: 모든 사용자) → /exec URL을 index.html의 GAS_URL에 입력
 * SpreadsheetID는 이 프로젝트의 실제 시트 ID입니다. 시트는 비공개로 유지하세요.
 * 학생 실명·학번·생년월일을 수집하지 않습니다.
 */
const DB_ID = '1qV7r-nRYBGSCv1FBYiUjQ0UIqatIpa0Cvd1YIopcZIY';
const SCHOOL_NAMES = ['신월중','경원중','감계중','반림중','진영중','자유학교'];
const EVENT_NAMES = ['3-3-3','3-6-3','3-6-3C','6-6','1-10-1'];
const OFFICIAL_EVENT_NAMES = EVENT_NAMES.slice(0,3);
const CACHE_TTL = 1200;
const SESSION_TTL = 21600;

function sheet_(name){return SpreadsheetApp.openById(DB_ID).getSheetByName(name);}
function rows_(name){const v=sheet_(name).getDataRange().getValues();return v.slice(1).filter(r=>r[0]!==''&&r[0]!=null);}
function text_(v,n){return String(v==null?'':v).trim().slice(0,n||250);}
function uuid_(){return Utilities.getUuid();}
function cache_(){return CacheService.getScriptCache();}
function pepper_(){const p=PropertiesService.getScriptProperties();let pepper=p.getProperty('PIN_PEPPER');if(!pepper){pepper=uuid_()+uuid_();p.setProperty('PIN_PEPPER',pepper);}return pepper;}
function hash_(pin,salt){const raw=String(salt)+'|'+String(pin)+'|'+pepper_();return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function safeReceipt_(p){const id=text_(p.requestId,90);if(!/^[A-Za-z0-9_-]{20,90}$/.test(id))throw Error('요청 번호가 잘못되었습니다.');return id;}
function userRow_(r){return {uid:String(r[0]),school:String(r[1]),grade:Number(r[2]),nick:String(r[3])};}
function eventText_(v){if(v instanceof Date)return String(v.getFullYear()%10)+'-'+(v.getMonth()+1)+'-'+v.getDate();return String(v);}
function recordRow_(r){return {id:String(r[0]),uid:String(r[1]),event:eventText_(r[2]),sec:Number(r[3]),at:String(r[4]),source:String(r[5]),valid:r[6]===true||String(r[6]).toLowerCase()==='true'};}
function readAll_(){const schools=rows_('Schools'),pop={};schools.forEach(r=>pop[String(r[0])]=Number(r[1]));return {ok:true,users:rows_('Users').map(userRow_),records:rows_('Records').map(recordRow_),schoolPop:pop,leagueConfig:readLeagueConfig_(),serverTime:new Date().toISOString()};}
function session_(token,role){const id=text_(token,120);if(!/^[A-Za-z0-9_-]{20,120}$/.test(id))throw Error('다시 로그인해 주세요.');const raw=cache_().get('session_'+id);if(!raw)throw Error('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');const s=JSON.parse(raw);if(s.role!==role)throw Error('접근 권한이 없습니다.');return s;}
function createSession_(uid,role,school){const t=uuid_()+'-'+uuid_();cache_().put('session_'+t,JSON.stringify({uid,role,school}),SESSION_TTL);return t;}
function findUser_(list,school,nick){return list.find(r=>String(r[1])===school&&String(r[3]).toLowerCase()===nick.toLowerCase());}
function jsonp_(data,cb){if(!/^[A-Za-z_$][A-Za-z0-9_$]{0,70}$/.test(cb))return ContentService.createTextOutput('invalid callback');return ContentService.createTextOutput(cb+'('+JSON.stringify(data)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);}
function doGet(e){
 const p=e.parameter||{},cb=String(p.callback||'');
 try{
  if(p.action==='snapshot')return jsonp_(readAll_(),cb);
  if(p.action==='receipt'){const id=text_(p.id,90);if(!/^[A-Za-z0-9_-]{20,90}$/.test(id))throw Error('잘못된 요청 번호');return jsonp_(JSON.parse(cache_().get('receipt_'+id)||'{"ok":false,"pending":true}'),cb);}
  return jsonp_({ok:false,error:'지원하지 않는 요청입니다.'},cb);
 }catch(err){return jsonp_({ok:false,error:String(err.message||err)},cb);}
}
function doPost(e){
 let p={};
 try{p=JSON.parse((e.postData&&e.postData.contents)||'{}'); const req=safeReceipt_(p);
 const lock=LockService.getScriptLock();lock.waitLock(18000);
 try{
  const cached=cache_().get('receipt_'+req);
  if(!cached){const result=handle_(p);cache_().put('receipt_'+req,JSON.stringify({ok:true,...result}),CACHE_TTL);}
 }finally{lock.releaseLock();}
 }catch(err){try{const req=safeReceipt_(p);cache_().put('receipt_'+req,JSON.stringify({ok:false,error:String(err.message||err)}),CACHE_TTL);}catch(ignore){}}
 return ContentService.createTextOutput('ACK').setMimeType(ContentService.MimeType.TEXT);
}
function handle_(p){
 const action=text_(p.action,40);
 if(['teacherStudents','saveLeagueConfig','teacherStudent','teacherNotes','teacherRecord','teacherEditRecord','teacherDeleteRecord','teacherSaveNote','teacherDrafts','teacherSaveDraft','teacherClaimDraft'].includes(action))return teacherAdmin_(p);
 if(action==='join'||action==='login'){
  const school=text_(p.school,30),nick=text_(p.nick,20),grade=Number(p.grade),pin=text_(p.pin,8);
  if(!SCHOOL_NAMES.includes(school)||!/^.{2,16}$/.test(nick)||!/^[0-9]{4}$/.test(pin))throw Error('학교·닉네임·4자리 PIN을 확인해 주세요.');
  const users=rows_('Users'),found=findUser_(users,school,nick);
  const registeringTeacher=action==='join'&&p.teacherToken?session_(p.teacherToken,'teacher'):null;
  if(registeringTeacher&&registeringTeacher.school!==school)throw Error('담당 학교가 아닙니다.');
  if(action==='join'){
   if(![1,2,3].includes(grade))throw Error('학년을 확인해 주세요.');
   if(found)throw Error('해당 학교에서 이미 사용 중인 닉네임입니다.');
   const u=uuid_(),salt=uuid_();sheet_('Users').appendRow([u,school,grade,nick,salt,hash_(pin,salt),new Date().toISOString()]);
   let linked=0,linkFailed=0;
   if(registeringTeacher){try{const pending=teacherDraftSheet_().getDataRange().getValues().slice(1).filter(r=>String(r[1])===school&&String(r[2]).trim().toLowerCase()===nick.toLowerCase()&&Number(r[11])===grade&&String(r[7])==='pending');for(const r of pending){try{teacherDraftAction_(registeringTeacher,{action:'teacherClaimDraft',draftId:String(r[0]),uid:u});linked++;}catch(err){linkFailed++;}}}catch(err){linkFailed++;}}
   return {uid:u,grade,token:createSession_(u,'student',school),linkedDrafts:linked,failedDrafts:linkFailed};
  }
  const bucket='tries_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,school+'|'+nick)).slice(0,32);
  const attempts=Number(cache_().get(bucket)||0);if(attempts>=6)throw Error('로그인 시도가 많습니다. 10분 후 다시 시도해 주세요.');
  if(!found||hash_(pin,String(found[4]))!==String(found[5])){
   cache_().put(bucket,String(attempts+1),600);throw Error('로그인 정보가 일치하지 않습니다.');
  }
  cache_().remove(bucket);const u=String(found[0]);return {uid:u,grade:Number(found[2]),token:createSession_(u,'student',school)};
 }
 if(action==='teacherLogin'){
  const admin=PropertiesService.getScriptProperties().getProperty('TEACHER_PIN')||'',code=text_(p.code,100),school=text_(p.school,30);
  if(!SCHOOL_NAMES.includes(school))throw Error('학생 계정으로 먼저 로그인한 뒤 교사 인증을 해 주세요.');
  if(admin.length<8)throw Error('서버에 실제 교사 관리번호가 설정되지 않았습니다. Apps Script 스크립트 속성의 TEACHER_PIN을 확인해 주세요.');
  if(code!==admin)throw Error('입력한 교사 관리번호가 Apps Script에 등록된 번호와 일치하지 않습니다.');
  return {teacherToken:createSession_('teacher','teacher',school)};
 }
 if(action==='record'){
  const u=session_(p.token,'student'),ev=text_(p.event,20),sec=Number(p.sec),from=text_(p.source,40);
  if(!EVENT_NAMES.includes(ev)||!Number.isFinite(sec)||sec<1||sec>300)throw Error('종목 또는 기록 범위가 올바르지 않습니다.');
  const isTeacher=!!p.teacherToken;
  if(isTeacher){const teacher=session_(p.teacherToken,'teacher');if(teacher.school!==u.school)throw Error('담당 학교가 아닙니다.');}
  else if(from.toLowerCase().includes('교사'))throw Error('교사 기록에는 교사 인증이 필요합니다.');
  const isTest=from==='test'||from.toLowerCase().includes('테스트');
  const source=isTeacher?'교사 타이머':isTest?'테스트':'AI 자동 측정';
  const valid=!isTest&&OFFICIAL_EVENT_NAMES.includes(ev)&&!(p.confirmSave===true&&!isTeacher); const id=uuid_(),at=new Date().toISOString();
  const sh=sheet_('Records'),row=sh.getLastRow()+1;
  sh.getRange(row,3).setNumberFormat('@');
  sh.getRange(row,1,1,7).setValues([[id,u.uid,ev,Math.round(sec*1000)/1000,at,source,valid]]);
  return {record:{id,uid:u.uid,event:ev,sec:Math.round(sec*1000)/1000,at,source,valid}};
 }
 if(action==='deleteRecord'){
  const u=session_(p.token,'student'),id=text_(p.recordId,90);
  if(!/^[0-9a-fA-F-]{36}$/.test(id))throw Error('삭제할 기록을 다시 선택해 주세요.');
  if(p.teacherToken){const teacher=session_(p.teacherToken,'teacher');if(teacher.school!==u.school)throw Error('담당 학교가 아닙니다.');}
  const sh=sheet_('Records'),data=sh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
   if(String(data[i][0])!==id)continue;
   if(String(data[i][1])!==u.uid)throw Error('본인의 기록만 삭제할 수 있습니다.');
   sh.deleteRow(i+1);
   return {deletedId:id};
  }
  throw Error('기록을 찾지 못했습니다. 목록을 새로고침해 주세요.');
 }
 if(action==='registerRecord'){
  const u=session_(p.token,'student'),id=text_(p.recordId,90);
  if(!/^[0-9a-fA-F-]{36}$/.test(id))throw Error('등록할 기록을 다시 선택해 주세요.');
  const sh=sheet_('Records'),data=sh.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
   if(String(data[i][0])!==id)continue;
   if(String(data[i][1])!==u.uid)throw Error('본인의 기록만 등록할 수 있습니다.');
   if(!OFFICIAL_EVENT_NAMES.includes(String(data[i][2]))||String(data[i][5])!=='AI 자동 측정')throw Error('AI 리그 종목 기록만 공식 등록할 수 있습니다.');
   if(data[i][6]===true)return {registeredId:id};
   sh.getRange(i+1,7).setValue(true);
   return {registeredId:id};
  }
  throw Error('기록을 찾지 못했습니다. 목록을 새로고침해 주세요.');
 }
 if(action==='population'){
  const teacher=session_(p.teacherToken,'teacher');const counts=p.counts||{};
  const sh=sheet_('Schools'),data=sh.getDataRange().getValues();
  // 학교별 전체 학생 수는 해당 학교 교사만 변경할 수 있습니다.
  const v=Number(counts[teacher.school]);if(!Number.isInteger(v)||v<1||v>20000)throw Error('학생 수를 확인해 주세요.');
  for(let i=1;i<data.length;i++)if(data[i][0]===teacher.school){sh.getRange(i+1,2).setValue(v);break;}
  return {schoolPop:{[teacher.school]:v}};
 }
 throw Error('지원하지 않는 작업입니다.');
}



function teacherUser_(teacher,uid){const row=rows_('Users').find(r=>String(r[0])===text_(uid,90));if(!row||String(row[1])!==teacher.school)throw Error('담당 학교의 학생을 다시 선택해 주세요.');return userRow_(row);}
function teacherNotesSheet_(){const db=SpreadsheetApp.openById(DB_ID);let sh=db.getSheetByName('TeacherNotes');if(!sh){sh=db.insertSheet('TeacherNotes');sh.appendRow(['id','uid','school','date','text','createdAt','updatedAt']);sh.getRange('D:D').setNumberFormat('@');}return sh;}
function teacherNotes_(teacher,uid){teacherUser_(teacher,uid);const data=teacherNotesSheet_().getDataRange().getValues();return data.slice(1).filter(r=>String(r[1])===uid&&String(r[2])===teacher.school).map(r=>({id:String(r[0]),uid:String(r[1]),date:String(r[3]),text:String(r[4]),createdAt:String(r[5]),updatedAt:String(r[6])})).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));}

/* 교사 전용 임시 측정: 기존 학생 로그인/공식기록 처리 함수와 분리 */
function teacherDraftSheet_(){
 const db=SpreadsheetApp.openById(DB_ID);let sh=db.getSheetByName('TeacherDrafts');
 if(!sh){sh=db.insertSheet('TeacherDrafts');sh.appendRow(['id','school','name','event','sec','measuredAt','method','status','uid','claimedAt','requestId','grade']);sh.getRange('C:D').setNumberFormat('@');sh.getRange('F:F').setNumberFormat('@');}
 return sh;
}
function teacherDraftRow_(r){return {id:String(r[0]),school:String(r[1]),name:String(r[2]),event:eventText_(r[3]),sec:Number(r[4]),at:String(r[5]),method:String(r[6]),status:String(r[7]),uid:String(r[8]||''),grade:Number(r[11])||null};}
function teacherDraftAction_(teacher,p){
 const sh=teacherDraftSheet_(),action=p.action,raw=sh.getDataRange().getValues();
 if(action==='teacherDrafts'){
  return {drafts:raw.slice(1).filter(r=>String(r[1])===teacher.school&&String(r[7])==='pending').map(teacherDraftRow_).sort((a,b)=>b.at.localeCompare(a.at))};
 }
 if(action==='teacherSaveDraft'){
  const name=text_(p.name,30),ev=text_(p.event,20),sec=Number(p.sec),method=text_(p.method,15),at=text_(p.at,35),grade=Number(p.grade)||null;
  if(!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9_ .-]{1,30}$/.test(name)||!name.trim())throw Error('임시 학생 이름은 1~30자로 입력해 주세요.');
  if(!EVENT_NAMES.includes(ev)||!Number.isFinite(sec)||sec<1||sec>300)throw Error('종목 또는 기록 범위가 올바르지 않습니다.');
  if(grade!==null&&![1,2,3].includes(grade))throw Error('학년을 확인해 주세요.');
  if(!['phone','tablet'].includes(method))throw Error('측정 방법을 확인해 주세요.');
  const date=new Date(at);
  if(!/^\d{4}-\d{2}-\d{2}T/.test(at)||!Number.isFinite(date.getTime())||date.getTime()>Date.now()+120000)throw Error('측정 일시를 확인해 주세요.');
  const requestId=safeReceipt_(p);
  for(let i=1;i<raw.length;i++)if(String(raw[i][10])===requestId){
   if(String(raw[i][1])!==teacher.school)throw Error('학교 정보가 일치하지 않습니다.');
   return {draft:teacherDraftRow_(raw[i])};
  }
  const id=uuid_(),draft=[id,teacher.school,name,ev,Math.round(sec*1000)/1000,date.toISOString(),method,'pending','','',requestId,grade||''];
  const row=sh.getLastRow()+1;sh.getRange(row,3,1,2).setNumberFormat('@');sh.getRange(row,6).setNumberFormat('@');sh.getRange(row,1,1,12).setValues([draft]);
  return {draft:teacherDraftRow_(draft)};
 }
 if(action==='teacherClaimDraft'){
  const id=text_(p.draftId,90),uid=text_(p.uid,90);
  if(!/^[0-9a-fA-F-]{36}$/.test(id))throw Error('임시기록을 다시 선택해 주세요.');
  const user=teacherUser_(teacher,uid);
  const i=raw.findIndex((r,j)=>j>0&&String(r[0])===id&&String(r[1])===teacher.school);
  if(i<1)throw Error('해당 학교의 임시기록을 찾지 못했습니다.');
  const draft=teacherDraftRow_(raw[i]);
  if(draft.status!=='pending'&&!(draft.status==='claimed'&&draft.uid===user.uid))throw Error('이미 다른 학생에게 연결된 임시기록입니다.');
  const recordSheet=sheet_('Records'),all=recordSheet.getDataRange().getValues();
  let saved=all.find((r,j)=>j>0&&String(r[0])===id);
  if(saved&&String(saved[1])!==user.uid)throw Error('다른 학생에게 등록된 기록입니다.');
  if(!saved){
   if(draft.status!=='pending')throw Error('연결된 공식기록을 찾지 못했습니다. 교사에게 확인해 주세요.');
   const r=[id,user.uid,draft.event,draft.sec,draft.at,'교사 타이머',OFFICIAL_EVENT_NAMES.includes(draft.event)];
   const next=recordSheet.getLastRow()+1;recordSheet.getRange(next,3).setNumberFormat('@');recordSheet.getRange(next,1,1,7).setValues([r]);saved=r;
  }
  if(draft.status!=='claimed')sh.getRange(i+1,8,1,3).setValues([['claimed',user.uid,new Date().toISOString()]]);
  return {claimedId:id,record:recordRow_(saved),user};
 }
 throw Error('지원하지 않는 임시기록 작업입니다.');
}

function teacherAdmin_(p){
 const teacher=session_(p.teacherToken,'teacher');
 if(['teacherDrafts','teacherSaveDraft','teacherClaimDraft'].includes(p.action))return teacherDraftAction_(teacher,p);
 if(p.action==='teacherStudents')return {users:rows_('Users').filter(r=>String(r[1])===teacher.school).map(userRow_).sort((a,b)=>a.nick.localeCompare(b.nick,'ko')||a.grade-b.grade)};
 if(p.action==='saveLeagueConfig'){const config=validateLeagueConfig(p.config);PropertiesService.getScriptProperties().setProperty('LEAGUE_CONFIG_V1',JSON.stringify(config));return {leagueConfig:config};}
 if(p.action==='teacherStudent'){
  let user;if(p.uid)user=teacherUser_(teacher,p.uid);else{const nick=text_(p.nick,20),row=findUser_(rows_('Users'),teacher.school,nick);if(!row)throw Error('해당 학교에 등록된 닉네임을 찾지 못했습니다.');user=userRow_(row);}
  return {user,notes:teacherNotes_(teacher,user.uid),records:rows_('Records').map(recordRow_).filter(r=>r.uid===user.uid)};
 }
 if(p.action==='teacherNotes')return {notes:teacherNotes_(teacher,text_(p.uid,90))};
 const user=teacherUser_(teacher,p.uid);
 if(p.action==='teacherRecord'){
  const ev=text_(p.event,20),sec=Number(p.sec);if(!EVENT_NAMES.includes(ev)||!Number.isFinite(sec)||sec<1||sec>300)throw Error('종목 또는 기록 범위가 올바르지 않습니다.');
  const record={id:uuid_(),uid:user.uid,event:ev,sec:Math.round(sec*1000)/1000,at:new Date().toISOString(),source:'교사 타이머',valid:OFFICIAL_EVENT_NAMES.includes(ev)};
  const sh=sheet_('Records'),row=sh.getLastRow()+1;sh.getRange(row,3).setNumberFormat('@');sh.getRange(row,1,1,7).setValues([[record.id,record.uid,record.event,record.sec,record.at,record.source,record.valid]]);return {record};
 }
 if(p.action==='teacherEditRecord'||p.action==='teacherDeleteRecord'){
  const sh=sheet_('Records'),data=sh.getDataRange().getValues(),id=text_(p.recordId,90);for(let i=1;i<data.length;i++){if(String(data[i][0])!==id)continue;if(String(data[i][1])!==user.uid)throw Error('선택한 학생의 기록만 수정할 수 있습니다.');
   if(p.action==='teacherDeleteRecord'){sh.deleteRow(i+1);return {deletedId:id};}
   const sec=Number(p.sec);if(!Number.isFinite(sec)||sec<1||sec>300)throw Error('기록은 1.000~300.000초로 입력해 주세요.');sh.getRange(i+1,4).setValue(Math.round(sec*1000)/1000);data[i][3]=Math.round(sec*1000)/1000;return {record:recordRow_(data[i])};
  }throw Error('기록을 찾지 못했습니다. 다시 조회해 주세요.');
 }
 if(p.action==='teacherSaveNote'){
  const body=text_(p.text,2000),date=text_(p.date,10);if(!body)throw Error('수업 특이사항을 입력해 주세요.');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw Error('날짜를 확인해 주세요.');
  const sh=teacherNotesSheet_(),data=sh.getDataRange().getValues(),id=text_(p.noteId,90),now=new Date().toISOString();
  if(id){const i=data.findIndex((r,i)=>i>0&&String(r[0])===id&&String(r[1])===user.uid&&String(r[2])===teacher.school);if(i<1)throw Error('특이사항을 찾지 못했습니다. 다시 조회해 주세요.');sh.getRange(i+1,4,1,4).setValues([[date,body.startsWith('=')?"'"+body:body,String(data[i][5]),now]]);}
  else sh.appendRow([uuid_(),user.uid,teacher.school,date,body.startsWith('=')?"'"+body:body,now,now]);return {notes:teacherNotes_(teacher,user.uid)};
 }
 throw Error('지원하지 않는 교사 작업입니다.');
}


function leagueDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value?d:null;}
function validateLeagueConfig(config){
 if(!config||!leagueDate(config.start)||!leagueDate(config.end)||config.start>config.end)throw Error('리그 시작일과 종료일을 확인해 주세요.');
 if(!Array.isArray(config.weeks)||!config.weeks.length||config.weeks.length>104)throw Error('주차는 1~104개로 설정해 주세요.');
 let previous='';const weeks=config.weeks.map((w,i)=>{if(!w||!leagueDate(w.start)||!leagueDate(w.end)||w.start>w.end)throw Error((i+1)+'주차의 날짜를 확인해 주세요.');if(w.start<config.start||w.end>config.end)throw Error((i+1)+'주차를 리그 전체 기간 안으로 설정해 주세요.');if(previous&&w.start<=previous)throw Error((i+1)+'주차가 앞 주차와 겹칩니다.');previous=w.end;return {start:w.start,end:w.end};});
 return {start:config.start,end:config.end,weeks};
}

function readLeagueConfig_(){const raw=PropertiesService.getScriptProperties().getProperty('LEAGUE_CONFIG_V1');return raw?validateLeagueConfig(JSON.parse(raw)):null;}
