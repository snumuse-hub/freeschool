# 5개 중학교 스피드스태킹 리그전 — Google Sheets 연결 안내

## 현재 상태
- GitHub Pages 홈페이지: https://snumuse-hub.github.io/freeschool/league-test/
- 기록 데이터용 Google Sheets: https://docs.google.com/spreadsheets/d/1qV7r-nRYBGSCv1FBYiUjQ0UIqatIpa0Cvd1YIopcZIY/edit
- Apps Script 서버 전체 코드: 이 폴더의 `Code.gs`
- 홈페이지 `index.html`에는 `GAS_URL=''` 로 배포 URL 연결이 아직 비어 있습니다. 배포 전에는 테스트 모드(브라우저 단독 저장)입니다.

## 최초 1회 설정
1. 위 구글 시트를 엽니다. 확장 프로그램 → Apps Script 를 선택합니다.
2. 편집기의 `Code.gs` 기존 내용을 지우고 [이 저장소의 Code.gs](https://github.com/snumuse-hub/freeschool/blob/main/league-test/Code.gs) 전체 코드를 붙여넣고 저장합니다.
3. Apps Script 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성에 이름 `TEACHER_PIN`, 값은 본인만 아는 **8자리 이상의 관리번호**로 추가합니다. 비밀번호를 GitHub 코드에 쓰지 마세요.
4. 배포 → 새 배포 → 종류: 웹 앱 → 실행 사용자: **나** / 액세스 권한: **모든 사용자** → 배포. 구글 계정 승인 화면에 동의합니다.
5. 생성된 **웹 앱 URL (끝부분 /exec)**을 복사합니다.
6. GitHub 저장소의 `league-test/index.html` 안에서 `const GAS_URL='';`를 `const GAS_URL='https://script.google.com/macros/s/.../exec';`로 바꿉니다.
7. 변경사항 커밋 후 기존 GitHub Pages URL을 새로고침합니다. 노란 안내줄에 **'✅ 구글 시트 기록 연동'** 이 표시되는지 확인합니다.
8. 테스트 학생 한 명을 새로 가입 → 3-3-3 테스트 기록 입력 → Google Sheets의 Users/Records 시트에 행이 추가되는지 확인합니다.

## 운영 안전
- 구글 시트의 보기/수정 공유 설정은 비공개로 유지하세요. Apps Script는 배포 주체의 권한으로 시트를 기록합니다.
- 공개 데이터에는 학생 실명을 적지 않도록 안내하세요. 4자리 PIN은 저강도 자격 증명이므로 중요 개인정보를 저장하는 실서비스 인증으로는 부적절합니다.
- AI 카메라는 컵 배열, 규칙 위반을 판정하지 못합니다. 임시 측정·연습 용도로 사용하세요.
- `test` 출처의 임시 기록은 서버 순위에 반영되지 않게 저장됩니다.
- 관리번호는 꼭 정기적으로 변경하고, Apps Script 배포 접근권한을 확인하세요.
- 실제 운영 전 담당 교사의 승인, 학교 개인정보 처리 절차, 데이터 공개 범위를 점검하세요.

## 변경 파일
- `index.html`: 1~3위 학교 종합, 1~5위 개인·종목 순위 및 나머지 스크롤, 내 등수 별도, 종목별 누적 그래프 + BEST 5, 코칭 복사/이동 개선, 원격 저장 연동 경로
- `Code.gs`: 구글 시트 읽기/쓰기, 학생 계정 및 PIN 확인, 측정 기록 누적 및 조회, 교사 관리번호와 학교별 학생 수 저장

## 기술적 메모
GitHub Pages 자체는 서버나 데이터베이스가 아닙니다. 데이터 저장은 Apps Script 웹 앱이 수행합니다. 브라우저에서 Apps Script로 저장한 뒤 JSONP 상태 조회로 처리 결과를 확인합니다. Apps Script 배포 및 URL 입력이 완료되기 전에는 실제 공동 기록 저장이 불가능합니다.
