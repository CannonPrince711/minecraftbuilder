# Building SchematicViewer.exe

The exe embeds the web viewer (copied into `site/`) and shows it in a WebView2 window.

```sh
cp -r ../schematic-viewer/{index.html,css,js,vendor} site/   # refresh the embedded viewer
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -H windowsgui" -o build/SchematicViewer.exe .
```

Icon/manifest changes: `go install github.com/akavel/rsrc@latest` then
`rsrc -manifest build/app.manifest -ico build/icon.ico -arch amd64 -o rsrc_windows_amd64.syso`.
