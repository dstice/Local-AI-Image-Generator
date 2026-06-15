param([string]$Release = "b9631")

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$appDir = Join-Path $rootDir "app"
$toolsDir = Join-Path $appDir "tools"
$llmRoot = Join-Path $appDir "llm-backend\win"

function Enable-Tls12 {
    try {
        $tls12 = [Enum]::ToObject([Net.SecurityProtocolType], 3072)
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor $tls12
    } catch {
        throw "TLS 1.2 could not be enabled: $($_.Exception.Message)"
    }
}

function Format-Bytes {
    param([long]$b)
    if ($b -gt 1GB) { return "{0:N2} GB" -f ($b / 1GB) }
    if ($b -gt 1MB) { return "{0:N1} MB" -f ($b / 1MB) }
    return "{0:N0} KB" -f ($b / 1KB)
}

function Format-Speed {
    param([double]$bps)
    if ($bps -gt 1MB) { return "{0:N1} MB/s" -f ($bps / 1MB) }
    return "{0:N0} KB/s" -f ($bps / 1KB)
}

function Install-LlamaArchive {
    param([string]$Variant, [string]$AssetName)

    $dest = Join-Path $llmRoot $Variant
    $server = Join-Path $dest "llama-server.exe"
    if (Test-Path $server) {
        Write-Host "   OK  llama.cpp $Variant backend already ready."
        return
    }

    $archive = Join-Path $toolsDir $AssetName
    $extract = Join-Path $toolsDir "llama-$Variant-extract"
    $url = "https://github.com/ggml-org/llama.cpp/releases/download/$Release/$AssetName"

    New-Item -ItemType Directory -Force -Path $toolsDir, $dest | Out-Null
    Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host "   >>  Downloading llama.cpp $Variant backend ($Release)..."
    
    $barWidth  = 48
    $lastBytes = [long]0
    $lastTime  = [DateTime]::Now

    try {
        Enable-Tls12
        $req    = [System.Net.HttpWebRequest]::Create($url)
        $req.UserAgent = "Mozilla/5.0"
        $resp   = $req.GetResponse()
        $total  = [long]$resp.ContentLength
        $stream = $resp.GetResponseStream()
        $out    = [System.IO.File]::Create($archive)
        $buf    = New-Object byte[] 65536
        $done   = [long]0

        while ($true) {
            $read = $stream.Read($buf, 0, $buf.Length)
            if ($read -le 0) { break }
            $out.Write($buf, 0, $read)
            $done += $read

            $now     = [DateTime]::Now
            $elapsed = ($now - $lastTime).TotalSeconds
            if ($elapsed -ge 0.35) {
                $speed     = ($done - $lastBytes) / $elapsed
                $lastBytes = $done
                $lastTime  = $now
                $pct  = if ($total -gt 0) { [int](($done / $total) * 100) } else { 0 }
                $fill = [int](($pct / 100) * $barWidth)
                $bar  = ("#" * $fill) + ("-" * ($barWidth - $fill))

                $eta = ""
                if ($speed -gt 0 -and $total -gt 0) {
                    $rem = [int](($total - $done) / $speed)
                    $eta = "  ETA $([int]($rem/60))m$($rem%60)s"
                }

                $dl  = Format-Bytes $done
                $tot = if ($total -gt 0) { " / " + (Format-Bytes $total) } else { "" }
                $spd = Format-Speed $speed
                Write-Host -NoNewline "`r      [$bar] $pct%  $dl$tot  $spd$eta   "
            }
        }

        $out.Close(); $stream.Close()
        Write-Host "`r      [$("#" * $barWidth)] 100%  $(Format-Bytes $done)  Done!                         " -ForegroundColor Green
        Write-Host ""
    } catch {
        Write-Host ""
        throw "Download failed: $_"
    }

    Write-Host "   >>  Extracting llama.cpp $Variant backend..."
    Expand-Archive -Path $archive -DestinationPath $extract -Force

    Get-ChildItem $extract -Recurse -File | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $dest $_.Name) -Force
    }
    Remove-Item $archive, $extract -Recurse -Force -ErrorAction SilentlyContinue

    if (-not (Test-Path $server)) {
        throw "llama-server.exe was not found after extracting $AssetName"
    }
    Write-Host "   OK  llama.cpp $Variant backend installed."
}

Install-LlamaArchive -Variant "vulkan" -AssetName "llama-$Release-bin-win-vulkan-x64.zip"
Install-LlamaArchive -Variant "cpu" -AssetName "llama-$Release-bin-win-cpu-x64.zip"
