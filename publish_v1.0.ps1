# 发布 筑衡 v1.0 GitHub Release 脚本
# 用法：在能正常访问 GitHub 的网络环境（或代理开启）下运行：
#   powershell -ExecutionPolicy Bypass -File publish_v1.0.ps1
$ErrorActionPreference = "Stop"

$repo        = "TianX7/zjcost"
$tag         = "v1.0"
$releaseName = "v1.0"
$zipPath     = "c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\packaging\dist\筑衡_便携版.zip"
$notes = @"
# 筑衡（zjcost）v1.0 发行版

辅助驱动的全过程工程造价协同管控平台便携发行版。

- 离线便携：双击 筑衡.exe 即可启动，无需安装依赖
- 内置 CAD 看图工具：独立 cad_viewer.exe 入口
- IFC 三维查看、图纸识别、清单定额、计价分析、报表、设施运维
- 数据本地化存储，自动备份（保留最近 5 份）
"@

# 1) 复用 git 已保存的 GitHub 凭据作为 token
$cred  = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($cred -split "`n" | Where-Object { $_ -like "password=*" }).Substring(9)
$headers = @{
    Authorization = "Bearer $token"
    "User-Agent"  = "publish-script"
    Accept        = "application/vnd.github+json"
}
$base = "https://api.github.com/repos/$repo"

# 2) 推送 v1.0 标签
Write-Host "[1/3] 推送标签 $tag ..."
git push origin $tag
if ($LASTEXITCODE -ne 0) { throw "git push 失败，请确认网络可达 GitHub" }

# 3) 创建 Release（已存在则复用）
Write-Host "[2/3] 创建 Release $releaseName ..."
$relBody = @{ tag_name = $tag; name = $releaseName; body = $notes; draft = $false; prerelease = $false } | ConvertTo-Json
try {
    $rel = Invoke-RestMethod -Method Post -Uri "$base/releases" -Headers $headers -Body $relBody -ContentType "application/json"
    Write-Host "  Release 创建成功 id=$($rel.id)"
} catch {
    $rel = Invoke-RestMethod -Method Get -Uri "$base/releases/tags/$tag" -Headers $headers
    Write-Host "  Release 已存在，复用 id=$($rel.id)"
}

# 4) 上传 zip 附件
Write-Host "[3/3] 上传附件 $zipPath ..."
$assetName = [System.IO.Path]::GetFileName($zipPath)
$uploadUrl = "https://uploads.github.com/repos/$repo/releases/$($rel.id)/assets?name=$assetName"
& curl.exe -sS -X POST $uploadUrl -H "Authorization: Bearer $token" -H "Content-Type: application/zip" --data-binary "@$zipPath"
Write-Host "`n发布完成：https://github.com/$repo/releases/tag/$tag"
