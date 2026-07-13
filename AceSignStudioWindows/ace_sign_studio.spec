# PyInstaller build spec for Ace Sign Studio (one-file, windowed).
# Build with:  pyinstaller --noconfirm ace_sign_studio.spec
# (or just run build-exe.bat, which sets up a venv and calls this)

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    # Bundle the brand logo + Roboto fonts into <bundle>/assets, where
    # render.py looks for them via sys._MEIPASS.
    datas=[('ace_sign_studio/assets', 'assets')],
    hiddenimports=[
        'win32print', 'win32ui', 'PIL.ImageWin', 'PIL.ImageGrab',
        'selenium', 'reportlab.graphics.barcode',
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=['numpy', 'scipy', 'matplotlib', 'PyQt5', 'PySide6'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='AceSignStudio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # windowed GUI app (no console window)
    disable_windowed_traceback=False,
    icon='app.ico',
)
