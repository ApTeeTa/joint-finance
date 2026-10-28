param(
  [int]$Port = 8778,
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "Serving $Root on http://127.0.0.1:$Port/"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $path = $context.Request.Url.LocalPath.TrimStart('/')
      if ([string]::IsNullOrWhiteSpace($path)) {
        $path = 'index.html'
      }

      $full = Join-Path $Root ($path -replace '/', [IO.Path]::DirectorySeparatorChar)
      if (Test-Path -LiteralPath $full -PathType Leaf) {
        $bytes = [IO.File]::ReadAllBytes($full)
        if ($full.EndsWith('.html')) {
          $context.Response.ContentType = 'text/html; charset=utf-8'
        } elseif ($full.EndsWith('.js')) {
          $context.Response.ContentType = 'text/javascript; charset=utf-8'
        } elseif ($full.EndsWith('.css')) {
          $context.Response.ContentType = 'text/css; charset=utf-8'
        } elseif ($full.EndsWith('.webmanifest')) {
          $context.Response.ContentType = 'application/manifest+json; charset=utf-8'
        } else {
          $context.Response.ContentType = 'application/octet-stream'
        }
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $context.Response.StatusCode = 404
      }
    } finally {
      $context.Response.Close()
    }
  }
} finally {
  $listener.Stop()
}
