// 2026-11-10: DART 공시 중계 — GitHub Actions에서 30분마다 실행한다.
// Cloudflare Worker에서는 OpenDART가 응답하지 않아(시간 초과), Cloudflare 밖(GitHub)에서 받아 data/disclosures.json에 저장하고
// 핑거 IR 대시보드 Worker가 이 파일을 읽는다. 담는 것은 이미 공개된 공시의 접수번호·날짜·제목·제출인뿐이다.
// DART 키는 GitHub 저장소 비밀값(DART_API_KEY)에만 둔다. 화면·로그에 키를 찍지 않는다.
// 원본: finger-ir-dashboard/dart-relay/ (PC 저장소). GitHub youngjoon 저장소에는 같은 파일을 올린다.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {inflateRawSync} from 'node:zlib';

export const COMPANIES=[
 {co:'finger',stock:'163730',corp:'01142075',name:'핑거'},
 {co:'sungho',stock:'043260',corp:'00317210',name:'성호전자'}];
export const DAYS=100;            // Worker가 90일로 다시 자른다
export const HEARTBEAT_MS=3*3600000; // 내용이 같아도 3시간이 지났으면 확인 시각(at)을 새로 저장
// 2026-11-20 평판 지수용 이력 파일: 2026-05-01부터의 공시 전체. 6시간에 한 번만 다시 받는다(하루 3~4회).
export const HISTORY_FROM='20260501';
export const HISTORY_OUT='data/disclosures-history.json';
export const HISTORY_EVERY_MS=6*3600000;
// 2026-11-25 평판 2차 1단계: 상장사 이름 목록(기사 관련도 '다른 상장사 3곳 이상이면 단순 언급' 규칙용). 7일에 한 번.
// OpenDART 고유번호 파일(corpCode.xml, zip)에서 종목코드가 있는 회사 이름만 뽑는다. 담는 것은 공개된 회사 이름뿐이다(개인 정보 없음).
export const LISTED_OUT='data/listed-companies.json';
export const LISTED_EVERY_MS=7*86400000;
const CORP_API='https://opendart.fss.or.kr/api/corpCode.xml';
export function needListed(old,now=Date.now()){return !old||!Array.isArray(old.names)||!(now-Date.parse(old.at||0)<LISTED_EVERY_MS);}
// zip(중앙 디렉터리 기준)에서 첫 파일을 꺼낸다(저장 0 또는 deflate 8).
export function unzipFirst(buf){
 const b=Buffer.from(buf);let e=-1;for(let i=b.length-22;i>=Math.max(0,b.length-70000);i--)if(b.readUInt32LE(i)===0x06054b50){e=i;break;}
 if(e<0)throw Error('zip 끝 표시 없음');
 const cd=b.readUInt32LE(e+16);if(b.readUInt32LE(cd)!==0x02014b50)throw Error('zip 목록 없음');
 const method=b.readUInt16LE(cd+10),size=b.readUInt32LE(cd+20),off=b.readUInt32LE(cd+42);
 if(b.readUInt32LE(off)!==0x04034b50)throw Error('zip 파일 머리 없음');
 const start=off+30+b.readUInt16LE(off+26)+b.readUInt16LE(off+28),data=b.subarray(start,start+size);
 if(method===0)return data;if(method===8)return inflateRawSync(data);throw Error('zip 압축 방식 '+method);
}
export function listedNames(xml){
 const out=new Set();
 for(const m of String(xml).matchAll(/<list>([\s\S]*?)<\/list>/g)){
  const name=(m[1].match(/<corp_name>([^<]*)<\/corp_name>/)||[])[1],code=((m[1].match(/<stock_code>([^<]*)<\/stock_code>/)||[])[1]||'').trim();
  if(name&&/^[0-9A-Z]{6}$/.test(code))out.add(name.trim().replace(/&amp;/g,'&'));
 }
 return [...out].sort();
}
export async function fetchListed(fetchFn,key,now=Date.now()){
 let res,err;
 for(let t=0;t<2&&!res;t++){try{res=await fetchFn(CORP_API+'?'+new URLSearchParams({crtfc_key:key}),{signal:AbortSignal.timeout(60000)});if(!res.ok){err=Error('corpCode HTTP '+res.status);res=null;}}catch(e){err=e;}}
 if(!res)throw err;
 const names=listedNames(unzipFirst(await res.arrayBuffer()).toString('utf8'));
 if(names.length<1000)throw Error('상장사 목록이 너무 적음('+names.length+')');
 return {at:new Date(now).toISOString(),source:'OpenDART corpCode(종목코드 있는 회사)',n:names.length,names};
}
const API='https://opendart.fss.or.kr/api/list.json';
const OUT='data/disclosures.json';

const kstDate=(ms)=>new Date(ms+9*3600000).toISOString().slice(0,10).replaceAll('-','');

// 회사 하나의 최근 공시 목록(여러 쪽이면 최대 5쪽). status 013 = 공시 없음.
export async function fetchCompany(fetchFn,key,c,now=Date.now(),{from='',maxPages=5}={}){
 const rows=[];
 for(let page=1;page<=maxPages;page++){
  const q=new URLSearchParams({crtfc_key:key,corp_code:c.corp,bgn_de:from||kstDate(now-DAYS*86400000),end_de:kstDate(now),page_no:String(page),page_count:'100'});
  let res,err;
  for(let t=0;t<2&&!res;t++){try{res=await fetchFn(API+'?'+q,{signal:AbortSignal.timeout(15000)});if(!res.ok){err=Error(c.name+' HTTP '+res.status);res=null;}}catch(e){err=e;}}
  if(!res)throw err;
  const j=await res.json();
  if(j.status==='013')break;
  if(j.status!=='000')throw Error(`${c.name} DART status ${j.status} ${j.message||''}`.trim());
  for(const r of j.list||[])rows.push({rcept_no:String(r.rcept_no||''),rcept_dt:String(r.rcept_dt||''),report_nm:String(r.report_nm||'').replace(/\s+/g,' ').trim(),flr_nm:String(r.flr_nm||'').trim(),rm:String(r.rm||'').trim()});
  if(page>=Number(j.total_page||1))break;
 }
 return rows.sort((a,b)=>b.rcept_no.localeCompare(a.rcept_no));
}

// 내용이 같고 마지막 확인이 3시간 안이면 null(저장·커밋 안 함). 그 외에는 새 파일 내용.
export function buildOutput(old,companies,now=Date.now()){
 if(old&&JSON.stringify(old.companies)===JSON.stringify(companies)&&now-Date.parse(old.at)<HEARTBEAT_MS)return null;
 return {at:new Date(now).toISOString(),source:'OpenDART list.json',days:DAYS,companies};
}

// 이력 파일을 다시 받을 때인지: 파일이 없거나, 시작일이 바뀌었거나, 마지막 확인이 6시간을 넘었을 때.
export function needHistory(old,now=Date.now()){
 return !old||old.from!==HISTORY_FROM||!Date.parse(old.at)||now-Date.parse(old.at)>=HISTORY_EVERY_MS;
}
export async function fetchHistory(fetchFn,key,now=Date.now()){
 const companies={};
 for(const c of COMPANIES){
  const rows=await fetchCompany(fetchFn,key,c,now,{from:HISTORY_FROM,maxPages:20});
  companies[c.stock]={co:c.co,name:c.name,corp_code:c.corp,rows};
 }
 return {at:new Date(now).toISOString(),source:'OpenDART list.json',from:HISTORY_FROM,companies};
}

async function main(){
 const key=process.env.DART_API_KEY;
 // 키를 넣기 전에는 실패 메일이 30분마다 쌓이지 않게 경고만 남기고 끝낸다.
 if(!key){console.log('::warning::DART_API_KEY 비밀값이 없습니다(저장소 Settings → Secrets and variables → Actions). 넣은 뒤 Run workflow로 실행하세요.');return;}
 const companies={};
 for(const c of COMPANIES){
  const rows=await fetchCompany(fetch,key,c);
  companies[c.stock]={co:c.co,name:c.name,corp_code:c.corp,rows};
  console.log(`${c.name}: ${rows.length}건`);
 }
 // 이력 파일(평판 지수용): 실패해도 '최근 공시' 파일 갱신은 그대로 한다.
 try{
  let oldH=null;try{oldH=JSON.parse(await readFile(HISTORY_OUT,'utf8'));}catch{}
  if(needHistory(oldH)){
   const h=await fetchHistory(fetch,key);
   await mkdir('data',{recursive:true});
   await writeFile(HISTORY_OUT,JSON.stringify(h,null,1)+'\n');
   console.log('이력 저장: '+HISTORY_OUT+' ('+Object.values(h.companies).map(c=>c.name+' '+c.rows.length+'건').join(', ')+')');
  }
 }catch(e){console.log('::warning::이력 파일을 만들지 못했습니다: '+String(e.message||e).replaceAll(key,'***'));}
 // 상장사 이름 목록(7일에 한 번). 실패해도 공시 파일 갱신은 그대로 한다.
 try{
  let oldL=null;try{oldL=JSON.parse(await readFile(LISTED_OUT,'utf8'));}catch{}
  if(needListed(oldL)){const l=await fetchListed(fetch,key);await mkdir('data',{recursive:true});await writeFile(LISTED_OUT,JSON.stringify(l)+'\n');console.log('상장사 목록 저장: '+l.n+'곳');}
 }catch(e){console.log('::warning::상장사 목록을 만들지 못했습니다: '+String(e.message||e).replaceAll(key,'***'));}
 let old=null;try{old=JSON.parse(await readFile(OUT,'utf8'));}catch{}
 const out=buildOutput(old,companies);
 if(!out){console.log('변경 없음');return;}
 await mkdir('data',{recursive:true});
 await writeFile(OUT,JSON.stringify(out,null,1)+'\n');
 console.log('저장: '+OUT);
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{console.error(String(e.message||e).replaceAll(process.env.DART_API_KEY||'\u0000','***'));process.exit(1);});
