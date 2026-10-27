# Run from an Administrator PowerShell. Restricts this port to the requested LAN.
$ErrorActionPreference = 'Stop'
$ruleName = 'SkoolAutomationPrivateSubnet5174'
$rule = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
if ($rule) {
  Set-NetFirewallRule -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Profile Any
  $rule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -LocalAddress '192.168.138.206' -RemoteAddress '192.168.138.0/24'
  $rule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 5174
} else {
  New-NetFirewallRule -Name $ruleName -DisplayName 'Skool Automation private subnet HTTPS' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5174 -LocalAddress '192.168.138.206' -RemoteAddress '192.168.138.0/24' -Profile Any | Out-Null
}
Write-Output 'Enabled HTTPS access from 192.168.138.0/24 to 192.168.138.206:5174.'
