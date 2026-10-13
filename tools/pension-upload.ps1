# 스페이스 커뮤니티 · 국민연금 통계 올리기
# 국민연금공단 API는 해외(클라우드) 서버의 요청을 받지 않으므로, 이 PC(국내)가 자료를 받아 사이트에 올립니다.
#
#   처음 한 번:  powershell -ExecutionPolicy Bypass -File .\tools\pension-upload.ps1 -Setup
#                → 작은 입력 창이 두 번 뜹니다. 각각 수급현황·가입현황 인증키를 Ctrl+V 로 붙여 넣고 [확인].
#                → 키를 이 PC에 암호화해 저장하고, 매주 월요일 09:00 자동 실행을 등록하고, 바로 한 번 올립니다.
#   지금 올리기: powershell -ExecutionPolicy Bypass -File .\tools\pension-upload.ps1
param([switch]$Setup)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$site = 'https://withpluces.com'
$conf = Join-Path $env:USERPROFILE '.space-pension.json'
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms

function Protect([string]$text) { ConvertTo-SecureString $text -AsPlainText -Force | ConvertFrom-SecureString }
function Unprotect([string]$saved) {
  $secure = ConvertTo-SecureString $saved
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
function Ask([string]$title, [string]$label) {
  $value = [Microsoft.VisualBasic.Interaction]::InputBox($label, $title, '')
  $match = [regex]::Match([string]$value, '[A-Za-z0-9%+/=]{30,}')
  if (-not $match.Success) {
    [System.Windows.Forms.MessageBox]::Show('인증키가 입력되지 않았습니다. 다시 실행해 주세요.', $title) | Out-Null
    exit 1
  }
  return $match.Value
}
function Sha256([string]$text) {
  $bytes = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($text))
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

if ($Setup -or -not (Test-Path $conf)) {
  $recipt = Ask '국민연금 수급현황 인증키' "공공데이터포털에서 복사한 [수급현황] 인증키(Decoding)를`n아래 칸에 Ctrl+V 로 붙여 넣고 [확인]을 누르세요."
  $sbscrb = Ask '국민연금 가입현황 인증키' "공공데이터포털에서 복사한 [가입현황] 인증키(Decoding)를`n아래 칸에 Ctrl+V 로 붙여 넣고 [확인]을 누르세요."
  @{ recipt = (Protect $recipt); sbscrb = (Protect $sbscrb) } | ConvertTo-Json | Set-Content -Encoding UTF8 $conf
  Write-Host '인증키를 이 PC에 암호화해 저장했습니다.' -ForegroundColor Green
  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    $trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 9am
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName 'SpaceCommunityPensionUpload' -Action $action -Trigger $trigger -Settings $settings -Description '스페이스 커뮤니티 국민연금 통계 올리기' -Force | Out-Null
    Write-Host '자동 실행 등록: 매주 월요일 09:00 (PC가 꺼져 있었으면 켜질 때)' -ForegroundColor Green
  } catch { Write-Host "자동 실행 등록은 건너뛰었습니다: $($_.Exception.Message)" -ForegroundColor Yellow }
}

$c = Get-Content $conf -Raw | ConvertFrom-Json
$keys = @{ recipt = (Unprotect $c.recipt); sbscrb = (Unprotect $c.sbscrb) }
Write-Host '국민연금공단에서 자료를 받는 중입니다…'
$plan = Invoke-RestMethod "$site/api/portal/pension/plan"
$results = @()
$ok = 0
foreach ($p in $plan.requests) {
  $u = "$($p.url)&serviceKey=$([uri]::EscapeDataString($keys[[string]$p.op]))"
  $xml = ''
  try { $xml = [string](Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 30).Content } catch { $xml = '' }
  if ($xml -match '<totPrsnCnt>|<jnngBrkdSgmntPrsnCnt>') { $ok++ }
  $results += @{ url = $p.url; xml = $xml }
}
Write-Host "받은 자료: $ok / $($plan.requests.Count)"
$body = @{ results = $results } | ConvertTo-Json -Depth 4 -Compress
try {
  $res = Invoke-RestMethod -Method Post -Uri "$site/api/portal/pension/upload" -Headers @{ 'X-Upload-Proof' = (Sha256 $keys.recipt) } `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
  Write-Host "완료: $($res.message)" -ForegroundColor Green
} catch {
  $detail = $_.ErrorDetails.Message
  Write-Host "올리기 실패: $detail $($_.Exception.Message)" -ForegroundColor Red
}
