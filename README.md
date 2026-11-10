# DART 공시 중계 (핑거 IR 대시보드용)

핑거 IR 대시보드의 '최근 공시' 칸에 DART 공시(지분공시·주요사항보고서·정기보고서 포함)를 보여주려고 만든 자동 실행입니다.
Cloudflare에서는 OpenDART가 응답하지 않아서, GitHub가 대신 받아 `data/disclosures.json`에 저장하고 대시보드가 이 파일을 읽습니다.

- 대상: 핑거(163730), 성호전자(043260) · 최근 100일
- 실행: 평일 07~19시 30분마다, 매일 22:17 (한국 시간)
- 담는 것: 이미 공개된 공시의 접수번호·날짜·제목·제출인뿐
- DART 키: 저장소 **Settings → Secrets and variables → Actions → `DART_API_KEY`** (화면·기록에 보이지 않음)

## 바로 한 번 실행
**Actions → DART 공시 받기 → Run workflow**

## 원본
이 폴더의 원본은 PC의 IR 대시보드 저장소 `dart-relay/`입니다. 고칠 때는 두 곳을 같이 맞춥니다.
