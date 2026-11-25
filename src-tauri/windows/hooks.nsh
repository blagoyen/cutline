; Cutline NSIS hooks — install yt-dlp, FFmpeg, and FFprobe from their official GitHub releases
; into $INSTDIR\bin so Cutline works out of the box without manual PATH setup.

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Setting up Cutline media tools (yt-dlp, FFmpeg, FFprobe)..."
  CreateDirectory "$INSTDIR\bin"

  ; Run a hidden PowerShell installer script that downloads only missing tools from official GitHub repos:
  ; - yt-dlp:  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
  ; - FFmpeg:  https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$$ErrorActionPreference=''Stop''; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $$bin=''$INSTDIR\bin''; New-Item -ItemType Directory -Force -Path $$bin | Out-Null; if (-not (Test-Path (Join-Path $$bin ''yt-dlp.exe''))) { Write-Output ''Downloading yt-dlp from github.com/yt-dlp/yt-dlp...''; Invoke-WebRequest -UseBasicParsing -Uri ''https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'' -OutFile (Join-Path $$bin ''yt-dlp.exe'') }; if (-not (Test-Path (Join-Path $$bin ''ffmpeg.exe'')) -or -not (Test-Path (Join-Path $$bin ''ffprobe.exe''))) { Write-Output ''Downloading FFmpeg & FFprobe from github.com/yt-dlp/FFmpeg-Builds...''; $$zip=Join-Path $$env:TEMP ''cutline-ffmpeg.zip''; $$tmp=Join-Path $$env:TEMP ''cutline-ffmpeg-extract''; try { Invoke-WebRequest -UseBasicParsing -Uri ''https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'' -OutFile $$zip; if (Test-Path $$tmp) { Remove-Item -Recurse -Force $$tmp }; Expand-Archive -Path $$zip -DestinationPath $$tmp -Force; Get-ChildItem -Path $$tmp -Recurse -Include ''ffmpeg.exe'',''ffprobe.exe'' | ForEach-Object { Copy-Item -Force $$_.FullName (Join-Path $$bin $$_.Name) } } finally { Remove-Item -Force -ErrorAction SilentlyContinue $$zip; Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $$tmp } }"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Automatic tool download could not finish (offline or blocked). You can install them inside Cutline."
  ${Else}
    DetailPrint "yt-dlp, FFmpeg, and FFprobe installed to $INSTDIR\bin."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\bin"
!macroend
