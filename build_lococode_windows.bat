@echo off
setlocal
title Build LocoCode Windows EXE

echo.
echo ========================================
echo   LocoCode - Build Windows EXE
echo ========================================
echo.

cd /d "%~dp0"

if not exist "main.py" (
    echo ERRORE: main.py non trovato.
    echo Devi mettere questo file nella cartella principale di LocoCode.
    pause
    exit /b 1
)

if not exist "lococode" (
    echo ERRORE: cartella lococode non trovata.
    echo Devi mettere questo file nella cartella principale di LocoCode.
    pause
    exit /b 1
)

echo [1/4] Installo/aggiorno PyInstaller...
python -m pip install --upgrade pyinstaller

if errorlevel 1 (
    echo ERRORE durante installazione PyInstaller.
    pause
    exit /b 1
)

echo.
echo [2/4] Pulizia vecchie build...
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"

echo.
echo [3/4] Genero eseguibile...
python -m PyInstaller --noconfirm --clean LocoCode.spec

if errorlevel 1 (
    echo.
    echo ERRORE durante la build.
    pause
    exit /b 1
)

echo.
echo [4/4] Build completata.
echo.
echo EXE creato qui:
echo %cd%\dist\LocoCode\LocoCode.exe
echo.
echo Puoi zippare tutta la cartella:
echo %cd%\dist\LocoCode
echo.
exit /b 0
