$ErrorActionPreference = 'Stop'
$kit = $PSScriptRoot
# Folder bundle avoids the old timer's repeated one-file extraction and _MEI
# cleanup scripts. The helper runs only when the pet opens its private pipe.
python -m PyInstaller --noconfirm --clean --onedir --console --collect-submodules numpy --name baijie-kaqiu --distpath "$kit/bin" --workpath "$kit/build" --specpath "$kit/build" --add-data "$kit/assets;assets" "$kit/worker.py"
if ($LASTEXITCODE -ne 0) { throw 'Kaqiu helper build failed' }
