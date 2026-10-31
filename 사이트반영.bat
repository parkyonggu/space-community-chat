@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [스페이스 커뮤니티] 사이트에 반영합니다 (npm run deploy:worker)...
call npm run deploy:worker > 배포기록.txt 2>&1
type 배포기록.txt
echo.
echo 끝났습니다. 위에 오류가 없으면 반영된 것입니다. 아무 키나 누르면 창이 닫힙니다.
pause >nul
