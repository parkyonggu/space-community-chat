# withpluces.com 배포 및 도메인 연결

## 현재 운영 상태 (2026-10-06 12:30 갱신)

- withpluces.com → Cloudflare Worker `space-community-service` (Custom Domain). 회원·댓글·구독·채팅·메일 운영 중.
- 배포: `space-community-chat` 폴더에서 `npx wrangler deploy` (상위 폴더에서 실행하면 엉뚱한 새 Worker 생성 마법사가 뜨므로 Ctrl+C 후 폴더 이동).
- workers.dev 주소는 꺼짐(`workers_dev: false`). Google 세이프 브라우징이 workers.dev 시험 주소를 위험으로 표시했던 이력이 있음.
- 메일: Cloudflare Email Service (Workers Paid), 발신 no-reply@withpluces.com.
- 복구: 문제가 생기면 Pages 프로젝트 `space`(space-815.pages.dev, 삭제하지 말 것)의 사용자 설정 도메인에 withpluces.com을 다시 연결.
- 아래 "확인된 상태 (2026-10-06)"는 전환 이전 기록입니다.

## 확인된 상태 (2026-10-06)

- Cloudflare Pages 기존 `space` 프로젝트에 무료 화면 미리보기 배포를 완료했습니다.
- `https://withpluces.com/`과 `https://space-815.pages.dev/`에서 HTTPS 200,
  최신 커뮤니티 제목, 무료 미리보기 안내 및 `Cache-Control: no-store`를 확인했습니다.
- 운영 도메인에서 메뉴 전환 및 회원·채팅 등록 비활성화를 브라우저로 검증했습니다.
- 기존 프로젝트와 도메인 연결을 재사용했으며 네임서버 변경이나 유료 서비스
  생성은 수행하지 않았습니다.
- 네임서버는 `ridge.ns.cloudflare.com`, `yolanda.ns.cloudflare.com`입니다.
- A 레코드의 `104.21.59.191`, `172.67.182.235`는 Cloudflare 프록시 주소입니다.
  이 주소를 실제 원본 서버 IP로 사용하지 마세요.
- `www.withpluces.com`은 확인 시 DNS 응답이 없었습니다.
- 현재 호스팅은 Cloudflare Pages이며 프로젝트 관리 이름은 `space`,
  기본 공개 주소는 `space-815.pages.dev`입니다.
- 이후 로컬 편집 내용은 자동 업로드되지 않습니다. `npm run build:pages`로
  다시 빌드한 뒤 기존 프로젝트에 새 프로덕션 배포를 업로드해야 반영됩니다.

## 최신 커뮤니티 화면을 첫 화면으로 표시하기

- `/`와 `/index.html`은 최신 [public/index.html](./public/index.html)을 표시합니다.
- 기존 `/community.html` 주소도 동일한 커뮤니티 화면을 표시하며 메뉴 해시 링크를 유지합니다.
- 예전 디자인 아티클은 `/article.html`에서 확인할 수 있습니다. 커뮤니티 상단의
  **기존 아티클 보기** 링크로 이동합니다.
- 최신 화면의 편집 대상은 [public/index.html](./public/index.html)입니다.
  워크스페이스 최상위의 [index.html](../index.html)은 로컬 서버로 이동하는
  실행 안내이며, [public/article.html](./public/article.html)은 별도 보존한 기존 아티클입니다.
  최상위 실행 안내 파일을 운영 사이트에 배포하지 마세요.
- 로컬 확인: 워크스페이스 최상위 또는 `space-community-chat` 디렉터리에서
  `npm run dev`를 실행하고 `http://localhost:3000/`을 엽니다.
  VS Code의 **F5 → 스페이스 커뮤니티 최신 화면**으로 서버 실행 및 브라우저
  열기를 함께 수행할 수도 있습니다. 이미 3000 포트에 서버가 실행 중이면
  중복 실행하지 않고 해당 주소를 엽니다.
- 운영 사이트 확인: 아래 Node.js 서버 배포 설정으로 수정본을 **실제 운영
  호스팅에 재배포**해야 합니다. 기존 정적 사이트가 계속 연결되어 있다면
  도메인 연결도 수정해야 합니다. Cloudflare에 HTML 캐시 규칙이 있다면
  HTML 캐시를 우회하고 기존 캐시를 제거한 뒤 확인하세요.

## 뉴스레터 (2026-10-06 추가)

- `newsletter-api.js`: 구독 이중 확인(확인 메일의 버튼을 눌러야 구독), 토큰 수신거부, 운영자 발송·시험 발송·미리보기, 열람(이미지)·클릭(리디렉션) 통계, 기존 신청자 재확인, 2년 수신동의 안내.
- 운영자 화면: `https://withpluces.com/newsletter-admin` (운영자 로그인 시 상단에 "뉴스레터 관리" 버튼). 구독 확인·수신거부 페이지: `/newsletter`.
- 발송은 Durable Object 알람으로 1분에 20통씩, 하루 `NEWSLETTER_DAILY_LIMIT`(기본 300)통까지 나누어 보내고 남은 분량은 다음 날 이어서 보냅니다. Cloudflare 계정의 발송 한도가 늘면 이 값을 올리세요.
- 메일 하단에 발신자(`NEWSLETTER_SENDER`), 문의(`CONTACT_EMAIL`), 수신거부 링크가 자동으로 들어갑니다. 광고 체크 시 제목에 "(광고)"와 수신동의일이 붙습니다.
- 주간 브리핑: 매주 일요일 18:00 KST(cron `0 9 * * SUN`)에 `weekly-brief.js`가 한국은행 ECOS 지표(KOSPI·KOSDAQ·원/달러·국고채3년·기준금리·소비자물가)와 지난 7일 커뮤니티 인기 글로 초안을 만들고 운영자(ADMIN_EMAILS)에게 알림 메일을 보냅니다.
  운영자는 초안을 불러와 "[직접 작성]" 칸을 채우고 "월요일 07:00 예약 발송"을 누릅니다. "[직접 작성]"이 남아 있으면 발송이 거부됩니다.
  ECOS 정식 인증키: https://ecos.bok.or.kr → Open API → 인증키 신청(무료) 후 `npx wrangler secret put ECOS_API_KEY`. 키가 없으면 시험용 키(sample)로 조회합니다.
  정책브리핑(korea.kr)은 2026-07-01 RSS 제공을 중단(저작권 보호)했으므로 자동 수집 대상에서 제외했습니다. 기사·보도자료는 제목+직접 쓴 요약+원문 링크로만 작성합니다.
- 기존 구독 신청 목록(이중 확인 이전)은 첫 실행 때 "기존 신청"으로 옮겨지며, 운영자 화면에서 구독 확인 메일을 보내 확인한 사람만 구독자가 됩니다.

## 게시판·권한 (2026-10-06 추가)

- 게시판 글(소통·나눔, 시민의 소리, 정책 제안, 학술)은 Durable Object `board` 저장소에 저장됩니다(`board-api.js`).
- 읽기: 학술·논문·소고·이야기는 로그인 회원만, 나머지는 누구나. 쓰기(게시판·댓글·채팅): 로그인 + 이메일 인증 회원(메일 미설정 환경에서는 로그인만).
- 삭제: 작성자 직접 삭제 없음. 회원 신고 3건 이상 → 자동 숨김(임시조치) → 운영자 삭제/복구.
- 운영자: `wrangler.jsonc`의 `ADMIN_EMAILS`(현재 dragon600120@gmail.com)로 가입하고 이메일 인증을 마친 계정. 운영자에게는 각 글에 신고 건수·사유와 복구/삭제 버튼이 보입니다.
- 회원 탈퇴 시 작성 글·댓글은 '탈퇴한 회원'으로 익명화되고 추천·신고 기록은 삭제됩니다.
- 로컬 Worker 시험: `npm run dev:worker` (route가 있어 `--local-upstream localhost:3003`, 메일 끔 `--var MAIL_FROM:` 포함) 후 `npm run test:worker`.
  같은 로컬 저장소로 15분 내 반복 실행하면 가입 요청 제한(429)에 걸리므로 `.wrangler` 폴더를 지우고 다시 실행하세요.

## 개인정보·탈퇴·메일 (2026-10-06 추가)

- 운영 주체: (주)위드플러시아, 문의·보호책임자 연락처: dragon600120@gmail.com
- [public/privacy.html](./public/privacy.html): 개인정보처리방침 (위탁·국외이전: Cloudflare, Inc. / 광고 쿠키: Google AdSense)
  - Worker 배포에서는 `/privacy` 주소로 제공됩니다(`/privacy.html` 요청은 자동 이동).
- 회원 탈퇴: `POST /api/auth/account/delete` (로그인 + CSRF + 현재 비밀번호). 계정·모든 세션·메일 링크를 즉시 삭제합니다.
  공개 댓글은 계정과 연결되지 않으므로 남으며, 삭제 요청은 이메일로 받습니다.
- 구독 해지: `POST /api/newsletter/unsubscribe` (이메일). 존재 여부와 관계없이 같은 응답을 반환해 구독 여부가 노출되지 않습니다.
- 메일: Worker는 `EMAIL`(send_email) 바인딩과 `MAIL_FROM` 변수가 모두 있을 때만 메일을 보냅니다.
  1. Cloudflare 대시보드에서 Workers Paid 요금제(월 $5, 메일 월 3,000통 포함)를 계정 소유자가 직접 가입
  2. Email Service에서 withpluces.com 발신 도메인 등록 및 안내된 DNS 레코드 추가 후 인증 완료 확인
  3. [wrangler.jsonc](./wrangler.jsonc)의 `send_email`, `MAIL_FROM` 주석 해제 후 재배포
  4. 회원가입 후 인증 메일 수신, 비밀번호 재설정 메일 수신·변경을 실제로 확인

## 진행 중: Cloudflare 무료 서버 기능 전환

현재 공개 도메인은 아래 Pages 미리보기 배포를 유지합니다. 회원·채팅·댓글·
구독 접수를 운영하기 위해 무료 Workers와 **SQLite-backed Durable Objects**를
구현했습니다. **로컬 검증과 실제 운영 배포는 별개**입니다. 무료 Worker를
시험 배포하고 운영 도메인 검증을 마칠 때까지 공개 사이트가 기능 제공을
완료했다고 안내하지 않습니다. 유료 요금제로 자동 변경하지 않습니다.

### 구성 및 확인 범위

- [cloudflare/worker.js](./cloudflare/worker.js)가 기존 회원·댓글·구독 API를
  재사용하며 JSON 파일 대신 비공개 Durable Object SQLite에 저장합니다.
- 기존 scrypt(N=32768, r=8, p=3), 세션 토큰 해시, Secure/HttpOnly 쿠키,
  Origin 및 CSRF 확인을 유지합니다. 회원 API는 CPU 제한이 짧은 일반 Worker
  대신 Durable Object에서 처리하고, 해시 동시 처리 수를 1개로 제한합니다.
- 서버 재시작과 객체 재생성 후에도 회원·세션·댓글·구독 및 API 요청 제한
  상태가 유지됩니다. SQL 기록은 공개 정적 자산에 포함되지 않습니다.
- 채팅은 별도 Durable Object의 WebSocket Hibernation API를 사용합니다.
  Socket.IO 대신 표준 WebSocket을 사용하므로
  [public/worker-chat.js](./public/worker-chat.js)가 연결·오류·재연결을 처리합니다.
  채팅은 현재 접속자끼리 공유하며 영구 기록으로 저장하지 않습니다.
- 무료 시범 채팅은 최대 100개 동시 연결, 메시지 1~2,000자,
  연결별 분당 30회 제한입니다. 예전 Node.js 채팅 동작은 변경하지 않습니다.
- 구독 **신청 접수**만 제공하며 뉴스레터 발송은 별도 메일 서비스가 필요합니다.
  이 무료 Worker 구성에서는 인증·비밀번호 재설정 메일이 아직 연결되지 않았고
  해당 요청은 명시적으로 오류를 반환합니다.
- API는 초기 소규모 시범 운영을 위해 기존 전체 목록 읽기 방식을 재사용합니다.
  사용자·댓글이 증가하면 SQL 조회/페이지네이션을 최적화하고 무료 할당량을
  모니터링해야 합니다. 무제한 운영을 보장하지 않습니다.

### 빌드·시험·배포

`space-community-chat` 디렉터리 기준:

1. `npm install`로 선언된 Wrangler 개발 도구를 준비합니다.
2. `npm test`로 기존 Node.js API를 검증합니다.
3. `npm run dev:worker`로 `http://localhost:3003/`에서 Cloudflare 실행 환경을
   시작합니다. 이 명령은 로컬 `SITE_URL`을 지정하며 운영 설정을 바꾸지 않습니다.
4. 다른 터미널에서 `npm run test:worker`로 회원·세션·CSRF·댓글·구독 API를
   검증합니다. 테스트용 `example.test` 계정/댓글이 로컬 저장소에 생성됩니다.
5. `npx wrangler deploy --dry-run`으로 번들과 바인딩을 확인합니다.
6. 계정 소유자가 Wrangler OAuth 권한을 확인하고 승인합니다. 토큰·비밀번호는
   채팅이나 저장소에 복사하지 않습니다.
7. 먼저 **실제로 발급된** `workers.dev` 주소를 `SITE_URL`로 지정하여 시험
   배포합니다. `WORKER_TEST_URL`을 해당 주소로 지정해 API 테스트를 수행하고,
   두 브라우저의 채팅 공유와 런타임 재시작 후 데이터 유지를 확인합니다.
   시험 계정은 테스트용 이메일을 사용하며 실제 사용자 정보는 넣지 않습니다.
8. 개인정보 수집을 시작하기 전 실제 운영자 연락처, 처리방침, 회원 탈퇴·정보
   삭제·구독 철회 처리 절차를 정합니다. 설정 완료 전 운영 도메인을 전환하지 않습니다.
9. 검증 후 `SITE_URL=https://withpluces.com`으로 배포하고 기존 Pages의
   custom domain/DNS 연결을 기록합니다. Worker Custom Domain으로 전환할
   때는 기존 Pages 연결의 충돌을 해소하고 HTTPS·쿠키·API·WebSocket을
   **운영 도메인에서** 다시 검증합니다. 실패하면 기존 Pages로 복원합니다.

### 무료 제한

확인한 공식 문서 기준 Workers는 하루 100,000 요청, Durable Objects는 하루
100,000 요청/13,000 GB-s, SQLite 저장은 계정 합계 5 GB, 하루 행 읽기
500만/쓰기 10만 범위입니다. 실제 계정의 다른 서비스 사용량도 영향을 줍니다.
한도를 넘으면 요청·저장이 실패할 수 있으며 사용자에게 오류를 표시합니다.
운영 데이터 백업 및 사용량 확인은 별도로 수행해야 합니다.

공식 참고:
[Durable Objects 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[Durable Objects 제한](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Workers 제한](https://developers.cloudflare.com/workers/platform/limits/),
[Node crypto 호환](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/).

## 현재 공개 상태: Cloudflare Pages 무료 화면 배포

현재는 유료 Node.js 호스팅을 신청하지 않고 Cloudflare Pages에 **화면 미리보기**를
배포합니다. 유료 서비스 생성을 유도하지 않도록 기존 Render Blueprint를 제거했습니다.
이 모드에는 Node.js 서버가 없으므로 회원가입·로그인·실시간 채팅·게시글 등록·공유
댓글·구독 접수는 **준비 중**이며, 개인정보나 신청 정보를 저장하지 않습니다.
메뉴 전환과 화면 탐색은 유지합니다. 로컬 Node.js 실행 및 기존 서버 기능은 변경하지 않습니다.

### 무료 배포 파일 만들기

워크스페이스 최상위에서 `npm run build:pages`를 실행합니다.
[build-pages.js](./build-pages.js)가 최신 [public/index.html](./public/index.html)을
기준으로 `pages-dist/`를 생성하고, 서버 스크립트를 제외하며 입력·등록을 비활성화합니다.
이 폴더만 업로드하세요. 최상위 실행 안내나 프로젝트 전체, `data/`, `.env`,
`node_modules/`는 업로드하지 않습니다. 파일을 편집할 때마다 다시 빌드·배포합니다.

### Cloudflare에서 배포 및 확인

1. Cloudflare에 로그인한 관리 페이지를 공유합니다. 로그인 페이지만 공유되어
   있으면 계정의 프로젝트나 배포 결과를 확인할 수 없습니다.
2. **Workers & Pages**에서 현재 도메인에 연결된 프로젝트가 있는지 먼저 확인합니다.
   Direct Upload 프로젝트라면 기존 프로젝트에 새 배포를 업로드합니다.
   새 프로젝트가 필요하면 **Create application → Pages → Direct Upload**를 선택합니다.
3. 생성한 `pages-dist/` 폴더 또는 그 내용물을 최상위에 담은 ZIP을 업로드합니다.
   Direct Upload로 만든 프로젝트는 나중에 Git 연동으로 전환할 수 없습니다.
   Git 자동 배포를 원하면 처음부터 Git 연동을 선택하고 빌드 명령
   `npm run build:pages`, 출력 폴더 `pages-dist`를 설정합니다.
   이 값은 `space-community-chat` Git 저장소 루트 기준입니다.
4. 배포 성공 후 실제로 발급된 `https://…pages.dev` 주소에서 최신 화면·메뉴·준비 중
   표시를 확인합니다. 성공 상태나 URL을 추측하지 않습니다.
5. 프로젝트 **Custom domains**에 `withpluces.com`을 연결합니다.
   기존 DNS/Workers Route/다른 프로젝트 도메인 연결과 충돌하는지 확인하고
   기존 설정을 기록한 뒤 변경합니다. 검증 전 기존 사이트를 삭제하지 않습니다.
6. 도메인에서 최신 화면을 확인한 뒤 기존 HTML 캐시가 남아 있으면 제거합니다.

참고: [Pages Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).
아래 Node.js 호스팅 안내는 **추후 서버 기능을 운영할 때** 적용합니다.

## 먼저 실제 호스팅을 찾기

Cloudflare 대시보드에서 **withpluces.com → DNS → Records**를 확인합니다.
`@` 또는 `withpluces.com`의 실제 A/CNAME 대상을 확인하세요. 프록시가 켜져
있으면 외부 DNS 조회에서는 원본 대상이 보이지 않습니다.

**Workers & Pages**에 사이트 프로젝트가 있는지도 확인합니다. Pages의 Custom
domains에 도메인이 등록되어 있다면 현재 정적 배포일 수 있습니다.
기존 레코드를 삭제하거나 변경하기 전에 값을 기록하세요.

## 이 프로젝트에 필요한 호스팅

이 앱은 Next.js 커스텀 Node.js 서버와 Socket.IO를 사용합니다. HTML만 올리는
정적 호스팅으로는 실시간 채팅, 댓글 저장, 구독 신청이 작동하지 않습니다.
Node.js와 WebSocket을 계속 실행할 수 있는 VPS 또는 Render 등의 Web Service가
필요합니다. 기존 정적 Pages에 파일만 업로드하는 방법은 이 서버를 배포하지 못합니다.

### 배포할 파일 배치

서버의 작업 디렉터리 및 Git 저장소 루트는 `space-community-chat`입니다.
최신 커뮤니티 첫 화면은 [public/index.html](./public/index.html), 기존 아티클은
[public/article.html](./public/article.html), 아이콘은
[public/favicon.svg](./public/favicon.svg)에서 제공합니다. 이제 상위 폴더의
파일에 의존하지 않으므로 이 저장소만 배포합니다. `data/`와 `.env` 파일은
업로드하지 않습니다.

### 추후 선택 가능: Render Web Service + Cloudflare 도메인

현재 Node.js 커스텀 서버와 Socket.IO를 변경하지 않고 운영할 수 있는 Render
Web Service를 사용합니다. 계정·댓글 저장은 유료 서비스의 영구 디스크를 사용합니다.
무료 서비스의 임시 파일시스템은 재배포 시 데이터가 사라지므로 사용하지 않습니다.
Railway도 호환되지만 사용량 과금이며, VPS는 서버 보안·TLS·프로세스 운영을
직접 관리해야 합니다. 현재 무료 화면 배포에는 Render 가입·결제가 필요하지 않습니다.

1. Render 계정을 생성하고 GitHub 계정의 `parkyonggu/space-community-chat`
   저장소 접근을 허용합니다. 가입 및 유료 서비스 결제 승인은 계정 소유자가
   직접 수행합니다.
2. 유료 운영을 결정한 뒤 **New → Web Service**에서 저장소를 선택합니다.
   Node.js 22, Singapore 리전, 유료 인스턴스 및 1 GB 영구 디스크
   (`/var/data/space`)를 설정합니다. 아래 빌드 및 시작 명령을 사용하며,
   적용 전 화면에 표시되는 요금을 확인하세요.
3. `SITE_URL`에는 실제 접속 주소를 입력합니다. 임시 Render 주소로 기능을
   검증할 때는 해당 `https://…onrender.com` 주소를 사용하고, 도메인 연결을
   완료한 뒤 `https://withpluces.com`으로 변경하여 재시작합니다. 잘못된 주소를
   사용하면 Origin 검사 때문에 가입·로그인 등의 요청이 차단됩니다.
4. **Events**에서 빌드 성공 및 **Live** 상태를 확인하고, 임시 URL에서 최신 홈,
   메뉴, 댓글 API, 로그인, 채팅 연결을 검증합니다. SMTP 환경 변수는 이메일
   발송 서비스를 마련한 후 Render의 비공개 환경 변수에 직접 등록합니다.
5. 서비스 **Settings → Custom Domains**에 `withpluces.com`을 추가합니다.
   Cloudflare의 기존 Pages 도메인 연결 및 DNS 값을 기록한 뒤, Render가 지시한
   DNS 레코드로 교체합니다. 검증 완료 전 기존 사이트를 삭제하지 마세요.
6. Render 도메인 검증 및 TLS 발급을 완료한 뒤 Cloudflare를 **Full (strict)**로
   설정합니다. 기존 Pages의 도메인 연결이 충돌하면 해당 연결만 해제합니다.
   Workers Route가 같은 도메인의 요청을 가로채고 있는지도 확인합니다.
7. 도메인에서 최신 홈과 기능을 다시 검증합니다. HTML 캐시를 우회하고 기존
   Cloudflare HTML 캐시를 삭제합니다. Render의 `main` 자동 배포가 활성화되어
   있는지 확인하면 이후 GitHub에 반영한 수정도 재배포됩니다.

참고: [Render WebSocket](https://render.com/docs/websocket),
[영구 디스크](https://render.com/docs/disks),
[요금](https://render.com/pricing).

### 서버 빌드 및 실행 설정

- 현재 지원되는 Node.js LTS 버전 사용 (권장: Node.js 22).
- 빌드 명령: `npm ci` 후 `npm run build`
- 시작 명령: `npm start`
- 환경 변수:
  - `NODE_ENV=production`
  - `SITE_URL=https://withpluces.com`
  - `PORT`: 호스팅에서 제공하는 포트. 없으면 3000.
  - `DATA_DIR`: 계정·세션·댓글·구독 신청을 저장할 **비공개 영구 디스크의 절대 경로**.
    예: 호스팅에서 `/var/data/space`를 영구 디스크로 마운트했다면 해당 경로 사용.
- 재배포 시 사라지는 임시 디스크에는 신청 정보를 저장하지 마세요.
- 현재 파일 저장 방식은 **단일 Node.js 프로세스/단일 인스턴스**에서 사용합니다.
  여러 인스턴스로 확장할 때는 데이터베이스와 Socket.IO 공유 어댑터로 전환해야 합니다.

VPS에서는 Node 서버 앞에 HTTPS 역방향 프록시를 두고 WebSocket Upgrade를
전달해야 합니다. 호스팅 관리 화면에서 HTTPS와 WebSocket 지원을 확인하세요.
로컬 PC의 `localhost:3000`을 DNS에 입력해도 외부에서는 접속할 수 없습니다.

## 도메인 연결

1. 먼저 새 호스팅의 임시 URL에서 홈, `/community.html`, 댓글, 채팅을 확인합니다.
2. 호스팅의 Custom domains에 `withpluces.com`을 추가합니다.
3. Cloudflare DNS에서 기존 루트 도메인 레코드를 호스팅이 지시한 대상으로
   변경합니다. VPS라면 A 레코드 `@ → 서버 공인 IPv4`, 관리형 호스팅이라면
   제공된 A 또는 CNAME 값을 사용합니다. 값을 임의로 추측하지 마세요.
4. 호스팅이 DNS-only를 요구하면 프록시를 잠시 끄고 검증합니다. 루트 CNAME은
   Cloudflare의 CNAME flattening을 사용할 수 있습니다.
5. `www`도 사용할 경우 호스팅에 `www.withpluces.com`을 등록하고 지시된
   CNAME을 추가합니다. 한 주소로의 리디렉션도 호스팅 또는 Cloudflare에서 설정합니다.
6. 호스팅의 TLS 인증서 발급을 완료합니다. Cloudflare 프록시 사용 시
   SSL/TLS는 원본 인증서를 검증하는 **Full (strict)**로 설정합니다.
   Flexible은 사용하지 마세요.
7. DNS 전파 후 `https://withpluces.com/community.html`에서 기능을 다시 확인합니다.

## 댓글 및 구독 신청 운영

- [community-api.js](./community-api.js)가 `/api/comments`, `/api/newsletter`를
  제공합니다. 데이터는 `DATA_DIR/community.json`에 저장되며 공개 정적 파일이 아닙니다.
- 댓글은 닉네임과 함께 공개됩니다. 회원 로그인은 제공하지만 이메일/휴대전화
  본인인증은 아직 없습니다. 기존 비회원 댓글과 게시판 사용은 그대로 유지합니다.
- 구독 이메일 목록을 반환하는 공개 API는 없습니다.
- 이메일은 구독 **신청 접수**만 저장합니다. 발송 서비스, 이메일 소유 확인
  (double opt-in), 발송자 정보, 구독 해지 링크는 아직 연결되지 않았습니다.
- 개인정보를 수집하기 전 실제 운영자의 연락처와 정식 개인정보처리방침을
  마련하세요. 철회 요청을 받으면 구독 정보를 삭제하고 백업의 보관 정책도 적용하세요.
- 신청 명단을 외부 발송 서비스로 옮기기 전 위탁/국외 이전 등의 해당 안내와
  동의 요건을 확인하세요. 데이터 파일을 Git이나 공개 웹 폴더에 넣지 마세요.
- 역방향 프록시 환경의 기본 제한은 원본 접속 IP를 기준으로 합니다. 공유
  프록시 IP에 사용자가 묶일 수 있으므로 공개 운영 시 Cloudflare/호스팅에서
  사용자별 요청 제한과 봇 방어를 설정하세요.
- 공개 운영에는 댓글 신고/삭제·스팸 방어와 저장소 백업 정책도 필요합니다.

## 검증

`npm test`로 입력 검증, 동시 저장, 재시작 후 데이터 유지, 중복 구독 방지,
구독 정보 비공개를 검사합니다. `/`, `/index.html`, `/community.html`에서 최신
커뮤니티 화면을, `/article.html`에서 기존 아티클을 확인하세요. HTML 응답은
`Cache-Control: no-store`로 제공됩니다. 검색용 canonical 도메인은 `SITE_URL`을
사용하고 커뮤니티의 대표 주소는 `/`입니다.

## 회원가입 및 로그인

- [auth-api.js](./auth-api.js)가 `/api/auth/session`(GET), `/api/auth/register`,
  `/api/auth/login`, `/api/auth/logout`(POST)을 제공합니다.
- `DATA_DIR/auth.json`에 계정과 세션을 저장합니다. 단일 프로세스 전용입니다.
  반드시 서버 계정만 접근 가능한 폴더와 비공개 백업을 사용하세요. Windows에서는
  파일 모드만으로 권한을 보장하지 않으므로 폴더 ACL도 확인하세요.
- 비밀번호는 사용자별 무작위 salt와 scrypt(N=32768, r=8, p=3)로 해시합니다.
  세션 쿠키의 원문은 저장하지 않고 SHA-256 해시로만 식별합니다.
- 공개 도메인에서는 `__Host-space_session`, Secure, HttpOnly, SameSite=Lax,
  Path=/ 쿠키를 사용합니다. 로컬 loopback HTTP 개발 환경만 Secure 없는
  `space_session` 쿠키를 사용합니다. 외부 공개는 HTTPS를 강제하고 원본 서버의
  HTTP 직접 접근도 차단하세요. `SITE_URL`은 정확한 공개 HTTPS 주소여야 합니다.
- 변경 요청은 Origin과 세션별 CSRF 토큰을 확인합니다. CSRF 토큰은 브라우저
  메모리에만 보관합니다. 로그인 시 세션을 교체하고 로그아웃 시 서버에서 폐기합니다.
- 로그인 유지 선택 시 쿠키와 서버 세션이 30일 후 만료됩니다. 미선택 시 세션
  쿠키를 사용하되 서버에서 최대 12시간 후 만료됩니다. 브라우저의 '이전 세션 복원'
  기능이 세션 쿠키를 복원할 수 있으므로 공용 기기에서는 반드시 로그아웃하세요.
- 새로고침·다른 페이지·서버 재시작 후에도 영구 디스크의 유효한 세션을 확인합니다.
  같은 출처의 탭 사이에는 계정 상태 변경을 알리고 활성화 및 주기적 확인도 합니다.
- 재시도 제한은 메모리 기반 IP/이메일 요청 제한입니다. 프록시 IP에 사용자가
  묶일 수 있습니다. 외부 운영에는 신뢰할 수 있는 프록시의 사용자별 제한,
  봇 방어와 모니터링을 추가하고 여러 인스턴스에서는 공유 저장소를 사용하세요.
- 이메일 인증, 비밀번호 재설정, 회원 탈퇴 화면, 인증회원 권한/게시판 접근 제한은
  아직 없습니다. 이를 구현하기 전 사용자에게 제공한다고 안내하지 마세요.
- 실제 개인정보가 저장됩니다. 공개 서비스에 배포하기 전에 운영자 연락처,
  정식 약관·개인정보처리방침·탈퇴/정보 삭제 처리 절차를 마련해야 합니다.
- 테스트는 해시/쿠키 속성, CSRF/출처 차단, 중복 가입, 로그인 상태 저장, 정확한
  만료 기간, 로그아웃 세션 재사용 차단 및 요청 제한을 포함합니다.

공식 참고:
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Cloudflare DNS records](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)

## 스페이스 톡 (단체 대화방 · 1:1 대화 · 웹 알림) — 2026-10-06

- 주소: `https://withpluces.com/chat` (홈 메뉴 "스페이스 톡"). 이메일 인증을 마친 회원만 이용합니다.
- 서버: Durable Object `ChatService` (바인딩 `TALK`, 마이그레이션 `v2`). `npx wrangler deploy` 한 번이면 새 저장소가 자동으로 만들어집니다. 추가 시크릿·키 등록은 필요 없습니다.
- 웹 알림 키(VAPID)는 첫 사용 때 서버가 스스로 만들어 저장합니다. 푸시에는 메시지 내용을 싣지 않고, 기기가 `/api/chat/unread`에서 직접 읽어 알림을 띄웁니다(`public/sw.js`).
- 보관: 메시지·사진·신고 기록은 90일 뒤 매일 자동 삭제(`chat-core.js` `RETENTION_DAYS`). 방 최대 인원 100명(`MAX_ROOM_MEMBERS`).
- 신고된 메시지: 운영자 계정으로 스페이스 톡 → 메뉴 → "신고된 메시지 관리".
- 아이폰 알림: Safari 공유 → "홈 화면에 추가"로 설치한 뒤 앱 안에서 "알림 켜기" (iOS 16.4 이상).
- 로컬 테스트: `npm run dev:worker` 실행 후 `npm run test:worker` (스페이스 톡 종단 테스트 포함).


## 오늘의 부동산 동향 (국토교통부 실거래가)

- 공공데이터포털에서 '국토교통부_아파트 매매 실거래가 자료', '국토교통부_상업업무용 부동산 매매 실거래가 자료', '국토교통부_토지 매매 실거래가 자료'를 활용신청합니다.
- API마다 인증키가 다르면 종류별로 등록합니다: `npx wrangler secret put MOLIT_APT_KEY`(아파트), `MOLIT_BLDG_KEY`(상업업무용), `MOLIT_LAND_KEY`(토지). 따로 등록하지 않은 종류는 `MOLIT_API_KEY`를 씁니다. 키를 바꾸면 다음 조회 때 바로 다시 받아 옵니다.
- 주요 14개 시군구 × 3종 × 2개월 = 84개 단위를 몇 분에 걸쳐 나눠 받아 저장하고, 이번 달 자료는 6시간, 지난달 자료는 24시간마다 새로 받습니다(하루 API별 약 100회 이하).
- 키 오류는 `/api/portal` 응답의 `realestate.problems`에서 확인할 수 있습니다.


## 스페이스 레터: 이번 주 정부 정책 (정책브리핑)

- 공공데이터포털에서 '문화체육관광부_정책브리핑_정책뉴스_API'(15095335, 공공누리 제1유형)를 활용신청합니다.
- 그 API 화면의 인증키를 `npx wrangler secret put POLICY_NEWS_KEY`로 등록합니다.
- 같은 키로 첫 화면 '오늘의 정책브리핑'(최근 이틀, 30분마다 갱신)도 채워집니다.
- 주간 초안을 만들 때 지난 7일의 경제·금융·부동산 관련 정책뉴스(공공누리 제1유형만) 제목·부제목·원문 링크를 최대 8건 넣습니다. 본문은 옮기지 않습니다. 발송 전 운영자가 검토합니다.


## 스페이스 톡 '📰 오늘의 정책브리핑' 채널

- 매일 18:00(KST, cron `0 9 * * *`)에 그날 정책뉴스(공공누리 제1유형, 경제 분야 우선 최대 6건)를 채널에 올리고 구독자에게 알림을 보냅니다. `POLICY_NEWS_KEY`가 필요합니다.
- 회원·손님은 스페이스 톡 목록 맨 위 '받아 보기'로 구독하고, 대화방 메뉴의 '구독 그만하기'로 해지합니다. 채널은 읽기 전용입니다.
- 운영자는 `POST /api/chat/admin/channel {text}`로 채널에 직접 글을 올릴 수 있습니다.

## 우리 동네 신청 혜택 (GOV_BENEFIT_KEY)

- 자료: 행정안전부 「대한민국 공공서비스(혜택) 정보」(공공데이터포털 15113968, 정부24 보조금24), `api.odcloud.kr/api/gov24/v3/serviceList`.
- 인증키: `npx wrangler secret put GOV_BENEFIT_KEY`. 넣지 않으면 `POLICY_NEWS_KEY`를 함께 씁니다(공공데이터포털 일반 인증키는 계정마다 하나).
- 첫 화면 「우리 동네 신청 혜택」(`#benefit-panel`): 양산시·김해시·의령군과 경상남도 혜택, 읍·면·동에서 접수하는 중앙부처 농림축산어업 혜택을 마감 순으로 보여 줍니다. 12시간마다 새로 받습니다.
- `/?동네=의령#benefit-panel` 주소로 지역을 골라 열 수 있고, '카톡으로 알리기'가 이 주소를 공유합니다.
- 고시·공고로만 알리는 사업(예: 다음 해 산림사업 신청)은 관리자 계정으로 로그인하면 상자 아래 '관리자' 칸에서 직접 추가·삭제할 수 있습니다(`POST /api/portal/benefits/manual`).

## Google Play 앱 (TWA)

- 패키지 이름: `com.withpluces.community` (바꾸려면 `ANDROID_PACKAGE` 변수).
- 앱 연결 확인 파일: `/.well-known/assetlinks.json`을 Worker가 만들어 줍니다. Play Console 앱 서명 키와 업로드 키의 SHA-256 지문을 쉼표로 이어 `wrangler.jsonc`의 `ANDROID_CERT_SHA256` 변수에 넣고 배포합니다(공개 값). 비어 있으면 `[]`를 돌려줍니다.
- 앱 파일(.aab)은 PWABuilder(https://www.pwabuilder.com)로 만듭니다. 서명 키(signing.keystore)는 잃어버리면 업데이트할 수 없으니 따로 보관합니다.
- 아이콘: `public/icons/icon-192.png`, `icon-512.png`(any), `maskable-192.png`, `maskable-512.png`(maskable).

## 오늘의 날씨 (WEATHER_API_KEY)

- 자료: 기상청 단기예보 조회서비스(공공데이터포털 15084084) — 초단기실황(지금 기온)과 단기예보(오늘~모레 최저/최고·하늘·강수확률).
- 인증키: `npx wrangler secret put WEATHER_API_KEY`. 넣지 않으면 `POLICY_NEWS_KEY`를 함께 씁니다.
- 지역: 양산·김해·의령·진주·창원·부산·서울(`weather.js`의 REGIONS, 시·군청 위경도 → 기상청 격자 자동 변환).
- 지금 기온 20분, 예보 1시간, 오늘 최저·최고 3시간마다 새로 받습니다(`/api/portal/weather`).

## 우리 동네 국민연금 (PENSION_API_KEY)

- 자료: 국민연금공단 수급현황 V2(15010381)·가입현황 V2(15005710), 공공데이터포털 · 이용허락범위 제한 없음.
- 인증키: `npx wrangler secret put PENSION_API_KEY`. 넣지 않으면 `POLICY_NEWS_KEY`를 함께 씁니다.
- 양산시(48330)·김해시(48250)·의령군(48720) 연령대별(수급 60·70·80대, 가입 20~50대) 통계를 하루 한 번 받습니다(`/api/portal/pension`).
- 점검용: `/api/portal/pension/raw?op=recipt|sbscrb&age=60&sggu=48720` 로 원자료 한 건을 볼 수 있습니다(공개 통계).

## 오늘의 이슈 (매일경제 헤드라인 자동 선별 + 회원 평론)

- 첫 화면 '오늘의 정책브리핑' 바로 아래(메뉴: 🗞️ 오늘의 이슈)에 정치·경제·국방·국제·사회·문화 6개 분야 기사 1건씩.
- 매일경제 RSS(헤드라인 30000001, 전체 40300001, 정치 30200030, 경제 30100041, 사회 50400012, 국제 30300018, 문화·연예 30000023)를 모아
  '가장 많이 보도된 주제'를 고른다: 제목 낱말이 여러 기사에 겹칠수록, [속보]·[단독]일수록, 최근일수록 점수가 높고
  '…이유?', '누구길래', 연예 근황 같은 가벼운 기사는 깎는다. 같은 주제는 두 분야에 겹쳐 고르지 않는다.
  (매일경제 헤드라인 RSS는 편집 순서가 아니라 최신순이어서 순서만으로는 가벼운 기사가 뽑혔다.)
- 국방은 정치·국제·사회 기사 중 국방·안보 낱말이 든 기사끼리 견주고, 북한·합참·DMZ 등 우리 안보 기사를 앞세운다(최근 7일).
  정치는 최근 3일, 우리 정치 기사를 외국 정상 소식보다 앞세운다.
- 매일경제는 '무단 전재·재배포 금지'이므로 **제목·원문 링크·시각만** 보여 주고 본문·요약·사진은 쓰지 않는다.
- 이슈 날짜는 오전 6시에 바뀌고, 낮 12시까지 1시간마다 다시 고른 뒤 그날 이슈를 고정한다. 지난 날짜는 목록에서 다시 볼 수 있다.
- 관리자: 패널 아래 '관리자: 오늘의 이슈 바꾸기'에서 분야별로 다른 기사로 바꾸기·숨기기·자동으로 되돌리기.
- 평론: 로그인(이메일 인증)한 회원과 관리자가 이슈마다 평론을 쓴다(게시판 이름 `issue`, 공감·신고·/post/번호 페이지 지원).
- 별도 키·설정 없음. `npx wrangler deploy`만 하면 된다.

## 시민의 소리 → 시·군청 전달

- 글마다 「📮 공식 민원으로 보내기」: 국민신문고·안전신문고용 문안을 복사하고 접수 화면을 연다(글쓴이·이웃이 본인 이름으로 접수).
- 글쓴이가 「🏛️ 커뮤니티가 대신 전달」에 동의하면, 운영자가 「🏛️ 운영자: 시청 전달 대기함」(시민의 소리 위, 관리자만 보임)에서
  한 건씩 또는 같은 지역 여러 건을 묶어 기관 명의 문안을 복사 → 국민신문고(법인 회원)로 접수 → 접수번호·답변을 기록한다.
  기록하면 글에 「스페이스 커뮤니티가 ○○시에 전달했습니다」와 처리 경과가 표시되고 글쓴이에게 메일이 간다.
- 미리 할 일: 국민신문고에 (주)위드플러시아 법인(사업자) 회원 가입.
- 「🙋 저도 겪어요」(공감) 수가 전달 문안에 함께 들어간다.


## 우리 동네 농사정보 (KAMIS_CERT_KEY, KAMIS_CERT_ID, NONGSARO_API_KEY)

- 첫 화면 '🌾 우리 동네 농사정보' 칸. 키가 하나도 없으면 칸이 숨겨지고, 넣은 쪽만 보입니다.
- 농산물 가격: 한국농수산식품유통공사 KAMIS Open-API(www.kamis.or.kr → 고객센터 → Open-API)에서 신청합니다.
  - `npx wrangler secret put KAMIS_CERT_KEY` — 발급받은 인증키
  - `npx wrangler secret put KAMIS_CERT_ID` — KAMIS 가입 아이디(요청자 ID)
  - 「최근일자 도·소매가격정보(상품 기준)」(action=dailySalesList), 전국 평균, 3시간마다 갱신.
- 농사정보: 농촌진흥청 농사로(www.nongsaro.go.kr → 공공데이터 → Open API 신청) 「주간농사정보」.
  - `npx wrangler secret put NONGSARO_API_KEY`
  - 12시간마다 갱신.
- 점검(운영자 로그인 상태에서 주소창에 입력):
  - `/api/portal/farm` — 화면에 쓰는 자료와 오류(problems)
  - `/api/portal/farm/raw?source=kamis` — KAMIS 실제 응답 앞부분
  - `/api/portal/farm/raw?source=nongsaro&service=weekFarmInfo&operation=weekFarmInfoList` — 농사로 실제 응답 앞부분
