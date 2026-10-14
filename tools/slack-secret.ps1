# 슬랙 알림 주소(SLACK_WEBHOOK_URL)를 사이트에 저장하고 배포한다.
# 실행: powershell -ExecutionPolicy Bypass -File .\tools\slack-secret.ps1
# 1) 이 창이 기다리는 동안 슬랙 페이지의 Copy 버튼을 누른다  2) 이 창에서 Enter
Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host ""
Write-Host "1. 지금 슬랙 페이지에서 Copy 버튼을 누르세요. (Claude가 눌러 드릴 수도 있습니다)" -ForegroundColor Yellow
Write-Host "2. Copy를 누른 다음, 이 창을 클릭하고 Enter를 누르세요." -ForegroundColor Yellow
[void](Read-Host "준비되면 Enter")
$u = ""
try { $u = (Get-Clipboard -Raw) } catch { $u = "" }
if ($null -eq $u) { $u = "" }
$u = $u.Trim().Trim('"').Trim("'").Trim()
if (-not $u.StartsWith("https://hooks.slack.com/services/")) {
  Write-Host "클립보드에 슬랙 주소가 없습니다. Copy 버튼을 다시 누르고 이 파일을 다시 실행하세요." -ForegroundColor Red
  exit 1
}
Write-Host "슬랙 주소를 확인했습니다. 사이트에 저장합니다..." -ForegroundColor Cyan
$u | npx wrangler secret put SLACK_WEBHOOK_URL
if ($LASTEXITCODE -ne 0) { Write-Host "저장하지 못했습니다. 위 메시지를 Claude에게 보여 주세요." -ForegroundColor Red; exit 1 }
Set-Clipboard -Value " "
Write-Host "저장 완료. 이어서 배포합니다..." -ForegroundColor Cyan
npx wrangler deploy
Write-Host ""
Write-Host "끝났습니다. Claude에게 '완료'라고 알려 주세요." -ForegroundColor Green
