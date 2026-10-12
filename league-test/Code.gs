/**
 * 5개 중학교 스포츠스태킹 리그 기록 DB
 * 설치: Google Apps Script에 전체 붙여넣기 → 스크립트 속성 TEACHER_PIN(8자리 이상) 등록 →
 * 웹 앱으로 배포(실행 사용자: 나, 접근: 모든 사용자) → /exec URL을 index.html의 GAS_URL에 입력
 * SpreadsheetID는 이 프로젝트의 실제 시트 ID입니다. 시트는 비공개로 유지하세요.
 * 학생 실명·학번·생년월일을 수집하지 않습니다.
 */
const DB_ID = '1qV7r-nRYBGSCv1FBYiUjQ0UIqatIpa0Cvd1YIopcZIY';
const SCHOOL_NAMES = ['신월중','경원중','감계중','반림중','진영중'];
const EVENT_NAMES = ['3-3-3','3-6-3','3-6-3C','6-6','1-10-1'];
const CACHE_TTL = 1200;
const SESSION_TTL = 21600;

function sheet_(name){return SpreadsheetApp.openById(DB_ID).getSheetByName(name);}
function rows_(name){const v=sheet_(name).getDataRange().getValues();return v.slice(1).filter(r=>r[0]!==''&&r[0]!=null);}
function text_(v,n){return String(v==null?'':v).trim().slice(0,n||250);}
function uuid_(){return Utilities.getUuid();}
function cache_(){return CacheService.getScriptCache();}
function pepper_(){const p=PropertiesService.getScriptProperties();let pepper=p.getProperty('PIN_PEPPER');if(!pepper){pepper=uuid_()+uuid_();p.setProperty('PIN_PEPPER',pepper);}return pepper;}
function hash_(pin,salt){const raw=String(salt)+'|'+String(pin)+'|'+pepper_();return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,raw).map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function safeReceipt_(p){const id=text_(p.requestId,90);if(!/^[\w-]{20,90}$/.test(id))throw Error('요청 번호가 잘못되었습니다.');return id;}
function userRow_(r){return {uid:String(r[0]),school:String(r[1]),grade:Number(r[2]),nick:String(r[3])};}
function recordRow_(r){return {id:String(r[0]),uid:String(r[1]),event:String(r[2]),sec:Number(r[3]),at:String(r[4]),source:String(r[5]),valid:r[6]===true||String(r[6]).toLowerCase()==='true'};}
function readAll_(){const schools=rows_('Schools'),pop={};schools.forEach(r=>pop[String(r[0])]=Number(r[1]));return {ok:true,users:rows_('Users').map(userRow_),records:rows_('Records').map(recordRow_),schoolPop:pop,serverTime:new Date().toISOString()};}
function session_(token,role){const id=text_(token,120);if(!/^[\w-]{20,120}$/.test(id))throw Error('다시 로그인해 주세요.');const raw=cache_().get('session_'+id);if(!raw)throw Error('로그인 시간이 만료되었습니다. 다시 로그인해 주세요.');const s=JSON.parse(raw);if(s.role!==role)throw Error('접근 권한이 없습니다.');return s;}
function createSession_(uid,role,school){const t=uuid_()+'-'+uuid_();cache_().put('session_'+t,JSON.stringify({uid,role,school}),SESSION_TTL);return t;}
function findUser_(list,school,nick){return list.find(r=>String(r[1])===school&&String(r[3]).toLowerCase()===nick.toLowerCase());}
function jsonp_(data,cb){if(!/^[A-Za-z_$][A-Za-z0-9_$]{0,70}$/.test(cb))return ContentService.createTextOutput('invalid callback');return ContentService.createTextOutput(cb+'('+JSON.stringify(data)+');').setMimeType(ContentService.MimeType.JAVASCRIPT);}
function doGet(e){
 const p=e.parameter||{},cb=String(p.callback||'');
 try{
  if(p.action==='snapshot')return jsonp_(readAll_(),cb);
  if(p.action==='receipt'){const id=text_(p.id,90);if(!/^[\w-]{20,90}$/.test(id))throw Error('잘못된 요청 번호');return jsonp_(JSON.parse(cache_().get('receipt_'+id)||'{"ok":false,"pending":true}'),cb);}
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
 if(action==='join'||action==='login'){
  const school=text_(p.school,30),nick=text_(p.nick,20),grade=Number(p.grade),pin=text_(p.pin,8);
  if(!SCHOOL_NAMES.includes(school)||![1,2,3].includes(grade)||!/^.{2,16}$/.test(nick)||!/^\d{4}$/.test(pin))throw Error('학교·학년·닉네임·4자리 PIN을 확인해 주세요.');
  const users=rows_('Users'),found=findUser_(users,school,nick);
  if(action==='join'){
   if(found)throw Error('해당 학교에서 이미 사용 중인 닉네임입니다.');
   const u=uuid_(),salt=uuid_();sheet_('Users').appendRow([u,school,grade,nick,salt,hash_(pin,salt),new Date().toISOString()]);
   return {uid:u,token:createSession_(u,'student',school)};
  }
  const bucket='tries_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,school+'|'+nick)).slice(0,32);
  const attempts=Number(cache_().get(bucket)||0);if(attempts>=6)throw Error('로그인 시도가 많습니다. 10분 후 다시 시도해 주세요.');
  if(!found||Number(found[2])!==grade||hash_(pin,String(found[4]))!==String(found[5])){
   cache_().put(bucket,String(attempts+1),600);throw Error('로그인 정보가 일치하지 않습니다.');
  }
  cache_().remove(bucket);const u=String(found[0]);return {uid:u,token:createSession_(u,'student',school)};
 }
 if(action==='teacherLogin'){
  const admin=PropertiesService.getScriptProperties().getProperty('TEACHER_PIN')||'',code=text_(p.code,100),school=text_(p.school,30);
  if(!SCHOOL_NAMES.includes(school)||admin.length<8||code!==admin)throw Error('교사 관리번호가 일치하지 않거나 서버에 설정되지 않았습니다.');
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
  const valid=!isTest; const id=uuid_(),at=new Date().toISOString();
  sheet_('Records').appendRow([id,u.uid,ev,Math.round(sec*1000)/1000,at,source,valid]);
  return {record:{id,uid:u.uid,event:ev,sec:Math.round(sec*1000)/1000,at,source,valid}};
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
