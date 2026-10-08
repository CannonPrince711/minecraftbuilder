// Schematic Viewer for Windows: runs the web viewer in its own window (Microsoft Edge WebView2).
// The viewer files are embedded in the .exe and served from a private local address.
// Usage: SchematicViewer.exe [file.schem ...]  (also works with "Open with" and drag-onto-exe)
package main

import (
	"embed"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
)

//go:embed site
var siteFS embed.FS

var (
	logMu   sync.Mutex
	logPath = filepath.Join(os.Getenv("LOCALAPPDATA"), "SchematicViewer", "viewer-log.txt")
)

// appendLog writes one entry to %LOCALAPPDATA%\SchematicViewer\viewer-log.txt (kept under about 1 MB).
func appendLog(text string) {
	logMu.Lock()
	defer logMu.Unlock()
	os.MkdirAll(filepath.Dir(logPath), 0o755)
	if st, err := os.Stat(logPath); err == nil && st.Size() > 1<<20 {
		os.Rename(logPath, logPath+".old")
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s  %s\r\n", time.Now().Format("2006-01-02 15:04:05"), strings.ReplaceAll(strings.TrimSpace(text), "\n", "\r\n    "))
}

func main() {
	defer func() {
		if r := recover(); r != nil {
			appendLog(fmt.Sprintf("CRASH: %v", r))
			messageBox("Schematic Viewer", fmt.Sprintf("The viewer stopped because of an unexpected error:\n\n%v\n\nDetails were saved to:\n%s", r, logPath), 0x10)
		}
	}()
	site, _ := fs.Sub(siteFS, "site")
	args := os.Args[1:]
	for _, a := range args {
		if _, err := os.Stat(a); err != nil {
			appendLog("ERROR opening " + a + ": " + err.Error())
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("/__log", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		b, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
		appendLog(string(b))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__openlog", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		if _, err := os.Stat(logPath); err != nil {
			appendLog("Log file opened from the Problems panel.")
		}
		exec.Command("explorer", "/select,", logPath).Start()
		w.WriteHeader(http.StatusNoContent)
	})
	mux.Handle("/", http.FileServer(http.FS(site)))
	// Files passed on the command line are served at /open/<n>/<name>.
	mux.HandleFunc("/open/", func(w http.ResponseWriter, r *http.Request) {
		parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/open/"), "/", 2)
		var n int
		if _, err := fmt.Sscan(parts[0], &n); err != nil || n < 0 || n >= len(args) {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(args[n])
		if err != nil {
			appendLog("ERROR reading " + args[n] + ": " + err.Error())
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		defer f.Close()
		st, _ := f.Stat()
		w.Header().Set("Cache-Control", "no-store")
		http.ServeContent(w, r, filepath.Base(args[n]), st.ModTime(), f)
	})

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		appendLog("ERROR starting local server: " + err.Error())
		messageBox("Schematic Viewer", "The viewer could not start:\n\n"+err.Error()+"\n\nA firewall or security program may be blocking it. Details were saved to:\n"+logPath, 0x10)
		return
	}
	go http.Serve(ln, mux)
	base := "http://" + ln.Addr().String() + "/"

	start := base
	if len(args) > 0 {
		q := []string{}
		for i, a := range args {
			q = append(q, "url="+url.QueryEscape(fmt.Sprintf("/open/%d/%s", i, url.PathEscape(filepath.Base(a)))))
		}
		start = base + "?" + strings.Join(q, "&")
	}

	dataPath := filepath.Join(os.Getenv("LOCALAPPDATA"), "SchematicViewer")
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  dataPath,
		WindowOptions: webview2.WindowOptions{
			Title:  "Schematic Viewer",
			Width:  1280,
			Height: 820,
			IconId: 2,
			Center: true,
		},
	})
	if w == nil {
		appendLog("WebView2 runtime not available; opening in the default browser instead.")
		// WebView2 is missing (rare on Windows 10/11): use the default browser instead.
		exec.Command("rundll32", "url.dll,FileProtocolHandler", start).Start()
		messageBox("Schematic Viewer",
			"The viewer has opened in your web browser.\n\nKeep this box open while you use it. Click OK to close the viewer.\n\n"+
				"Tip: install the free Microsoft Edge WebView2 Runtime to use the viewer in its own window.", 0x40)
		return
	}
	defer w.Destroy()
	w.Navigate(start)
	w.Run()
}

func messageBox(title, text string, flags uintptr) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
}
