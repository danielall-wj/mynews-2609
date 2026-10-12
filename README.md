# mynews-2609

RSS 뉴스를 2시간마다 수집해 대시보드로 보여주고, 매일 오전 9시(KST)에 Discord로 요약을 보내는 GitHub Actions 기반 자동화입니다.

## 구성

- `scripts/feeds.mjs` — 수집할 RSS 피드 목록 (이름 / URL / 카테고리)
- `scripts/collect.mjs` — 피드를 수집해 `docs/data/latest.json`(최근 3일)과 `docs/data/archive/YYYY-MM.json`(월별 히스토리, 이번 달 포함 최근 12개월만 보관)에 저장
  - 수집 시 기사 제목 키워드를 직전 7일과 비교한 급상승 키워드를 `docs/data/trends.json`에 저장
- `scripts/search-keywords.mjs` — 구글뉴스 키워드 검색 그룹(예: AI 에이전트·업무 자동화)과 기사 태그 규칙. 여기만 고치면 수집·태깅에 반영
- `scripts/keywords.mjs` — 제목 키워드 추출·급상승 키워드 계산 (2개 이상 피드에서 언급된 키워드만 인정)
- `scripts/digest.mjs` — 최근 24시간 뉴스를 카테고리별로 정리해 Discord 웹훅으로 발송 (날씨 제외)
- `scripts/weekly.mjs` — 지난 7일 카테고리 증감·급상승 키워드·구글 인기 검색어·GitHub 트렌딩을 Discord로 발송
- `docs/` — GitHub Pages로 서비스되는 정적 대시보드 (최신 뉴스 + 히스토리 검색)
- `.github/workflows/collect.yml` — 2시간마다 수집 후 데이터 커밋/푸시
- `.github/workflows/digest.yml` — 매일 00:00 UTC(=09:00 KST)에 Discord 요약 발송
- `.github/workflows/weekly.yml` — 매주 월요일 09:00 KST에 주간 트렌드 리포트 발송

## 로컬 실행

```bash
npm install
npm run collect          # RSS 수집 → docs/data/*.json 갱신
DISCORD_WEBHOOK_URL=... npm run digest   # Discord로 요약 발송 테스트
DISCORD_WEBHOOK_URL=... npm run weekly   # 주간 트렌드 리포트 발송 테스트
```

## 대시보드 배포

저장소가 Private이라 GitHub Pages 대신 Vercel에 정적 사이트로 배포합니다
(`vercel.json`에서 `outputDirectory: docs`로 설정). 저장소가 Vercel 프로젝트와
Git 연동되어 있어서, `collect.yml`이 `docs/data`를 커밋·푸시할 때마다 Vercel이
자동으로 새 프로덕션 배포를 실행합니다 (별도의 Vercel 토큰/CI 설정 불필요).

대시보드 URL: https://mynews-2609.vercel.app

## Discord 웹훅

저장소 Settings → Secrets and variables → Actions에 `DISCORD_WEBHOOK_URL` 시크릿이 등록되어 있어야 합니다.

## 피드 추가/변경

`scripts/feeds.mjs`의 `FEEDS` 배열에 `{ id, name, url, category }` 형식으로 추가하면 됩니다.
