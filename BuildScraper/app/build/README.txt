Schematic Viewer for Windows
============================

Double-click SchematicViewer.exe. It opens in its own window. Nothing to install.

Open builds by:
  - clicking "Open files" in the app,
  - dragging .schem / .schematic / .litematic / .nbt files into the window,
  - dragging files onto SchematicViewer.exe, or
  - right-clicking a schematic file > Open with > Choose another app > SchematicViewer.exe
    (tick "Always use this app" to make it the default).

Supported: Sponge .schem (v1-v3), MCEdit/Schematica .schematic (1.12.2 and older),
Litematica .litematic and structure-block .nbt files, Minecraft 1.12.2 to latest.

First start: Windows may say "Windows protected your PC" because the app is new and
not code-signed. Click "More info" and then "Run anyway".

Needs Windows 10 or 11 (64-bit). It uses the Microsoft Edge WebView2 Runtime that ships
with Windows. If that is missing, the viewer opens in your web browser instead.

Your files stay on your computer. The app does not use the internet.

If something goes wrong
  - Problems are listed in the app's "Problems" panel with what to try. "Copy details"
    copies them as text so you can send them along.
  - The app also keeps a log file at %LOCALAPPDATA%\SchematicViewer\viewer-log.txt
    (the "Log file" button in the Problems panel opens its folder).
