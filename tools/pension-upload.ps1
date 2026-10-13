# 스페이스 커뮤니티 · 국민연금 통계 올리기
# 국민연금공단 API는 해외(클라우드) 서버의 요청을 받지 않으므로, 이 PC(국내)가 자료를 받아 사이트에 올립니다.
#
#  처음 한 번:   powershell -ExecutionPolicy Bypass -File pension-upload.ps1 -Setup   (메모장이 열리면 두 인증키를 붙여 넣고 저장 → 한 번 더 실행)
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
$keyFile = Join-Path ([Environment]::GetFolderPath('Desktop')) 'pension-keys.txt'

if ($Setup -or -not (Test-Path $conf)) {
  Write-Host '== 처음 설정 ==' -ForegroundColor Cyan
  # 인증키는 PowerShell 창이 아니라 '메모장'에 붙여 넣습니다(창에 붙여 넣으면 명령으로 실행돼 오류가 납니다).
  # 메모장 파일 어디에 붙여 넣었든, 인증키처럼 생긴 긴 글자(영문·숫자 30자 이상)를 순서대로 두 개 찾는다.
  $found = @()
  if (Test-Path $keyFile) {
    $text = Get-Content $keyFile -Raw -Encoding UTF8
    if ($text) { $found = @([regex]::Matches($text, '[A-Za-z0-9%+/=]{30,}') | ForEach-Object { $_.Value }) }
  } else {
    Set-Content -Encoding UTF8 $keyFile ''
  }
  Write-Host "메모장 파일: $keyFile  (찾은 인증키 $($found.Count)개)"
  if ($found.Count -lt 2) {
    Start-Process notepad.exe $keyFile
    Write-Host ''
    Write-Host '메모장이 열렸습니다.' -ForegroundColor Yellow
    Write-Host ' 1) 첫 줄에 [수급현황 인증키]를 붙여 넣고 Enter'
    Write-Host ' 2) 둘째 줄에 [가입현황 인증키]를 붙여 넣기'
    Write-Host ' 3) Ctrl+S 로 저장하고 메모장 닫기'
    Write-Host ' 4) 이 창에서 같은 명령을 한 번 더 실행 (키보드 위쪽 화살표 ↑ 를 누른 뒤 Enter)'
    return
  }
  $recipt = $found[0]
  $sbscrb = $found[1]
  $token = -join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
  @{ recipt = (Protect $recipt); sbscrb = (Protect $sbscrb); token = (Protect $token) } | ConvertTo-Json | Set-Content -Encoding UTF8 $conf
  Remove-Item $keyFile -Force   # 메모장 파일은 지운다(키는 위에서 암호화해 저장)
  Set-Clipboard -Value $token
  Write-Host ''
  Write-Host '인증키를 이 PC에 암호화해 저장했고, 메모장 파일은 지웠습니다.' -ForegroundColor Green
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
