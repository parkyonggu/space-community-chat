# 스페이스 커뮤니티 · 국민연금 통계 올리기
# 국민연금공단 API는 해외(클라우드) 서버의 요청을 받지 않으므로, 이 PC(국내)가 자료를 받아 사이트에 올립니다.
#
#  처음 한 번:   powershell -ExecutionPolicy Bypass -File pension-upload.ps1 -Setup
#  자동 실행 등록: powershell -ExecutionPolicy Bypass -File pension-upload.ps1 -Install   (매주 월요일 09:00, 꺼져 있었으면 켜질 때)
#  지금 바로 올리기: powershell -ExecutionPolicy Bypass -File pension-upload.ps1
param([switch]$Setup, [switch]$Install)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$site = 'https://withpluces.com'
$conf = Join-Path $env:USERPROFILE '.space-pension.json'

function Protect([string]$text) { ConvertTo-SecureString $text -AsPlainText -Force | ConvertFrom-SecureString }
function Unprotect([string]$saved) {
  $secure = ConvertTo-SecureString $saved
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
function FromClipboard([string]$what) {
  Read-Host "$what 을(를) 복사(Ctrl+C)한 뒤 여기서 Enter 를 누르세요" | Out-Null
  $value = (Get-Clipboard | Out-String).Trim()
  if ($value.Length -lt 10) { throw "$what 이(가) 복사되지 않았습니다. 다시 실행해 주세요." }
  return $value
}

if ($Setup -or -not (Test-Path $conf)) {
  Write-Host '== 처음 설정 ==' -ForegroundColor Cyan
  $recipt = FromClipboard '수급현황 인증키(Decoding)'
  $sbscrb = FromClipboard '가입현황 인증키(Decoding)'
  $token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  @{ recipt = (Protect $recipt); sbscrb = (Protect $sbscrb); token = (Protect $token) } | ConvertTo-Json | Set-Content -Encoding UTF8 $conf
  Set-Clipboard -Value $token
  Write-Host ''
  Write-Host '인증키를 이 PC에 암호화해 저장했습니다.' -ForegroundColor Green
  Write-Host '업로드 암호를 만들어 클립보드에 복사해 두었습니다.' -ForegroundColor Yellow
  Write-Host '프로젝트 폴더에서 아래 명령을 "직접 타이핑"해 실행하고(복사하면 클립보드의 암호가 지워집니다), 값을 물으면 Ctrl+V 로 붙여 넣으세요:' -ForegroundColor Yellow
  Write-Host '   npx wrangler secret put PENSION_UPLOAD_TOKEN'
  Write-Host "(혹시 클립보드가 지워졌다면 이 암호를 넣으세요: $token)"
  Write-Host '그다음 이 스크립트를 -Install 로 한 번 더 실행하면 매주 자동으로 올립니다.'
  return
}

if ($Install) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9am
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'SpaceCommunityPensionUpload' -Action $action -Trigger $trigger -Settings $settings -Description '스페이스 커뮤니티 국민연금 통계 올리기' -Force | Out-Null
  Write-Host '자동 실행을 등록했습니다: 매주 월요일 09:00 (그 시각에 PC가 꺼져 있었으면 켜질 때 실행)' -ForegroundColor Green
  return
}

$c = Get-Content $conf -Raw | ConvertFrom-Json
$keys = @{ recipt = (Unprotect $c.recipt); sbscrb = (Unprotect $c.sbscrb) }
$plan = Invoke-RestMethod "$site/api/portal/pension/plan"
$results = @()
$ok = 0
foreach ($p in $plan.requests) {
  $u = "$($p.url)&serviceKey=$([uri]::EscapeDataString($keys[$p.op]))"
  $xml = ''
  try { $xml = [string](Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 30).Content } catch { $xml = '' }
  if ($xml -match '<totPrsnCnt>|<jnngBrkdSgmntPrsnCnt>') { $ok++ }
  $results += @{ url = $p.url; xml = $xml }
}
Write-Host "받은 자료: $ok / $($plan.requests.Count)"
$body = @{ results = $results } | ConvertTo-Json -Depth 4 -Compress
$res = Invoke-RestMethod -Method Post -Uri "$site/api/portal/pension/upload" -Headers @{ 'X-Upload-Token' = (Unprotect $c.token) } `
  -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
Write-Host "완료: $($res.message)" -ForegroundColor Green
