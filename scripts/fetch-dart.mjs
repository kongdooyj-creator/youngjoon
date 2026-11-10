// 2026-11-10: DART 공시 중계 — GitHub Actions에서 30분마다 실행한다.
// Cloudflare Worker에서는 OpenDART가 응답하지 않아(시간 초과), Cloudflare 밖(GitHub)에서 받아 data/disclosures.json에 저장하고
// 핑거 IR 대시보드 Worker가 이 파일을 읽는다. 담는 것은 이미 공개된 공시의 접수번호·날짜·제목·제출인뿐이다.
// DART 키는 GitHub 저장소 비밀값(DART_API_KEY)에만 둔다. 화면·로그에 키를 찍지 않는다.
// 원본: finger-ir-dashboard/dart-relay/ (PC 저장소). GitHub youngjoon 저장소에는 같은 파일을 올린다.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export const COMPANIES=[
 {co:'finger',stock:'163730',corp:'01142075',name:'핑거'},
 {co:'sungho',stock:'043260',corp:'00317210',name:'성호전자'}];
export const DAYS=100;            // Worker가 90일로 다시 자른다
export const HEARTBEAT_MS=3*3600000; // 내용이 같아도 3시간이 지났으면 확인 시각(at)을 새로 저장
const API='https://opendart.fss.or.kr/api/list.json';
const OUT='data/disclosures.json';

const kstDate=(ms)=>new Date(ms+9*3600000).toISOString().slice(0,10).replaceAll('-','');

// 회사 하나의 최근 공시 목록(여러 쪽이면 최대 5쪽). status 013 = 공시 없음.
export async function fetchCompany(fetchFn,key,c,now=Date.now()){
 const rows=[];
 for(let page=1;page<=5;page++){
  const q=new URLSearchParams({crtfc_key:key,corp_code:c.corp,bgn_de:kstDate(now-DAYS*86400000),end_de:kstDate(now),page_no:String(page),page_count:'100'});
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
 let old=null;try{old=JSON.parse(await readFile(OUT,'utf8'));}catch{}
 const out=buildOutput(old,companies);
 if(!out){console.log('변경 없음');return;}
 await mkdir('data',{recursive:true});
 await writeFile(OUT,JSON.stringify(out,null,1)+'\n');
 console.log('저장: '+OUT);
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{console.error(String(e.message||e).replaceAll(process.env.DART_API_KEY||'\u0000','***'));process.exit(1);});
