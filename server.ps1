# ============================================================================
# server.ps1 — Mini servidor estático para probar VoidMedia Studio en local
# (Windows PowerShell, sin dependencias). Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1
# Sirve la carpeta del script en http://localhost:8123/
# ============================================================================

$port = 8123
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch {
  Write-Error "No se pudo abrir el puerto $port (¿ya está en uso?): $_"
  exit 1
}
Write-Host "VoidMedia Studio → http://localhost:$port/  (Ctrl+C para detener)"

$mime = @{
  '.html'  = 'text/html; charset=utf-8'
  '.htm'   = 'text/html; charset=utf-8'
  '.css'   = 'text/css; charset=utf-8'
  '.js'    = 'text/javascript; charset=utf-8'
  '.mjs'   = 'text/javascript; charset=utf-8'
  '.json'  = 'application/json; charset=utf-8'
  '.svg'   = 'image/svg+xml'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.jpeg'  = 'image/jpeg'
  '.gif'   = 'image/gif'
  '.webp'  = 'image/webp'
  '.avif'  = 'image/avif'
  '.ico'   = 'image/x-icon'
  '.md'    = 'text/markdown; charset=utf-8'
  '.txt'   = 'text/plain; charset=utf-8'
  '.woff'  = 'font/woff'
  '.woff2' = 'font/woff2'
  '.mp3'   = 'audio/mpeg'
  '.wav'   = 'audio/wav'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = $ctx.Request.Url.AbsolutePath
    if ($path -eq '/') { $path = '/index.html' }
    $candidate = Join-Path $root ($path -replace '/', '\')
    $full = [System.IO.Path]::GetFullPath($candidate)

    if (-not $full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'forbidden' }
    if (-not (Test-Path $full -PathType Leaf)) { throw 'notfound' }

    $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    $ctype = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }

    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ctx.Response.ContentType = $ctype
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.StatusCode = 200
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    try {
      $ctx.Response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes('404 — recurso no encontrado')
      $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    } catch { }
  } finally {
    try { $ctx.Response.OutputStream.Close() } catch { }
  }
}
