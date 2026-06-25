# 고객사 CS 응대 기록 서비스

고객사별 CS(문의·장애) 응대 내역을 기록·관리하는 사내용 웹 서비스입니다.
로그인 없이 사내망에서 사용하며, Docker로 간단히 실행합니다.

- **백엔드**: Node.js + Express
- **DB**: PostgreSQL
- **프론트엔드**: 정적 HTML/CSS/JS (빌드 불필요)
- **배포**: docker compose (앱 + DB 컨테이너)

---

## 빠른 시작 (WSL Ubuntu + Docker)

```bash
cp .env.example .env       # POSTGRES_PASSWORD 등 변경
docker compose up -d --build

# 접속
#  - 같은 PC:      http://localhost:8080
#  - 사내망 다른 PC: http://<서버 PC의 IP>:8080
```

운영 명령:

```bash
docker compose ps          # 상태 확인
docker compose logs -f app # 로그 보기
docker compose restart     # 재시작
docker compose down        # 중지 (데이터는 보존)
```

> 포트는 `.env`의 `APP_PORT`로 바꿉니다. 브라우저가 차단하는 포트(6000 등)는 피하고 8080·8000·3000 등을 쓰세요.
> 사내망 다른 PC 접속 시 서버 PC 방화벽에서 해당 포트를 열어야 합니다.

---

## 기록 항목

| 항목 | 설명 | 비고 |
|------|------|------|
| 고객사 | 어느 고객사인지 | **필수** |
| 문의자 | 고객 측 담당자 | |
| 제목 / 요약 | 한 줄 요약 | |
| 접수 경로 | 전화 / 이메일 / 채팅 / 방문 / 기타 | |
| 유형 | 장애 / 문의 / 기능요청 등 (자유 입력 + 자동완성) | |
| 중요도 | 높음 / 보통 / 낮음 | |
| 처리 상태 | 접수 / 처리중 / 완료 / 보류 | |
| 담당자 | 응대한 내부 담당자 | |
| 발생 / 접수 일시 | 문제가 발생하거나 접수된 시각 | |
| 해결 일시 | 해결된 시각 | 소요시간 자동 계산 |
| 문의 내용 | 고객이 문의/접수한 내용 | |
| 해결 내용 | 어떻게 처리/해결했는지 | |
| 등록일 / 수정일 | 자동 기록 | 자동 |

## 기능

- 응대 기록 등록 / 수정 / 삭제
- **목록 뷰 / 보드(칸반) 뷰** 전환 — 보드에서 카드를 드래그해 처리 상태 변경
  (완료로 옮기면 해결 일시가 비어 있을 경우 현재 시각으로 자동 기록)
- **소요시간 자동 계산** — 발생~해결 시간을 '2일 3시간' 형태로 표시
- **장기 미해결 강조** — 완료가 아니고 발생 후 72시간이 지난 건은 빨간색으로 강조 + 경과 시간 표시
- 고객사·제목·문의/해결 내용·담당자 통합 검색
- 고객사 / 중요도 / 접수경로 / 담당자별 필터, 다양한 정렬(미해결 우선 포함)
- 고객사·유형·담당자 입력 자동완성
- 상단 현황 요약(접수/처리중/완료/보류) — 클릭 시 상태 필터
- **CSV 내보내기** — 소요시간 포함, 엑셀에서 한글 정상 표시

---

## 데이터 보관 / 백업

데이터는 PostgreSQL 컨테이너의 `csdata` 도커 볼륨에 저장됩니다.
`docker compose down` 으로는 지워지지 않습니다. (볼륨까지 지우려면 `down -v`)

```bash
# 백업
docker compose exec -T db pg_dump -U csuser csdb > cs_backup_$(date +%Y%m%d).sql
# 복원
cat cs_backup_20260624.sql | docker compose exec -T db psql -U csuser -d csdb
```

---

## API 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/tickets` | 전체 목록 |
| POST | `/api/tickets` | 등록 |
| PUT | `/api/tickets/:id` | 수정 |
| PATCH | `/api/tickets/:id/status` | 상태만 변경 (보드 드래그용) |
| DELETE | `/api/tickets/:id` | 삭제 |
| GET | `/api/tickets/export.csv` | CSV 내보내기 |
| GET | `/api/health` | 헬스 체크 |

---

## 폴더 구조

```
cs-service/
├─ server.js            # Express 서버 / 라우팅
├─ db.js                # PostgreSQL 연결 · 스키마 · 쿼리
├─ public/              # 프론트엔드 (정적)
│  ├─ index.html
│  ├─ style.css
│  └─ app.js
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
└─ package.json
```
