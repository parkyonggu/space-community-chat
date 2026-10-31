# 브리핑 커넥터 비밀값(BRIEFING_MCP_SECRET)을 새로 만들어 사이트에 저장하고 배포한 뒤,
# claude.ai에 등록할 커넥터 주소를 클립보드에 복사한다.
# 실행: powershell -ExecutionPolicy Bypass -File .\tools\briefing-secret.ps1
Set-Location (Split-Path -Parent $PSScriptRoot)
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$secret = ([Convert]::ToBase64String($bytes)).Replace('+', '-').Replace('/', '_').TrimEnd('=')
Write-Host "비밀값을 만들었습니다. 사이트에 저장합니다..." -ForegroundColor Cyan
$secret | npx wrangler secret put BRIEFING_MCP_SECRET
if ($LASTEXITCODE -ne 0) { Write-Host "저장하지 못했습니다. 위 메시지를 Claude에게 보여 주세요." -ForegroundColor Red; exit 1 }
Write-Host "저장 완료. 이어서 배포합니다..." -ForegroundColor Cyan
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Write-Host "배포하지 못했습니다. 위 메시지를 Claude에게 보여 주세요." -ForegroundColor Red; exit 1 }
$url = "https://withpluces.com/api/mcp/$secret"
Set-Clipboard -Value $url
Write-Host ""
Write-Host "끝났습니다. 커넥터 주소를 클립보드에 복사했습니다." -ForegroundColor Green
Write-Host "claude.ai 설정 > 커넥터 > 사용자 지정 커넥터 추가 에서 주소 칸에 붙여 넣으세요(Ctrl+V)." -ForegroundColor Green
Write-Host "이 주소는 비밀번호와 같습니다. 다른 사람에게 보내지 마세요. 새로 바꾸려면 이 파일을 다시 실행하면 됩니다." -ForegroundColor Yellow
