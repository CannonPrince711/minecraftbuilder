// Build Scraper for Windows: the whole app (pull builds from worlds, convert, search the web,
// save into category folders, view in 3D) in its own window using Microsoft Edge WebView2.
package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"syscall"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

func main() {
	defer func() {
		if r := recover(); r != nil {
			appendLog("CRASH", fmt.Sprint(r))
			messageBox("Build Scraper", fmt.Sprintf("Build Scraper stopped because of an unexpected error:\n\n%v\n\nDetails were saved to:\n%s", r, logPath), 0x10)
		}
	}()
	h, err := newServer()
	if err != nil {
		fail("Build Scraper could not start:\n\n" + err.Error())
		return
	}
	ln, err := listen()
	if err != nil {
		appendLog("Could not start the local server", err.Error())
		fail("Build Scraper could not start:\n\n" + err.Error() + "\n\nA firewall or security program may be blocking it.")
		return
	}
	go http.Serve(ln, h)
	start := "http://" + ln.Addr().String() + "/"

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  appDir,
		WindowOptions: webview2.WindowOptions{
			Title:  "Build Scraper",
			Width:  1360,
			Height: 900,
			IconId: 2,
			Center: true,
		},
	})
	if w == nil {
		appendLog("WebView2 runtime not available", "opening in the default browser instead")
		exec.Command("rundll32", "url.dll,FileProtocolHandler", start).Start()
		messageBox("Build Scraper",
			"Build Scraper has opened in your web browser.\n\nKeep this box open while you use it. Click OK to close Build Scraper.\n\n"+
				"Tip: install the free Microsoft Edge WebView2 Runtime to use it in its own window.", 0x40)
		return
	}
	defer w.Destroy()
	w.Navigate(start)
	w.Run()
}

// documentsDir is the user's real Documents folder (it may have been moved, e.g. into OneDrive).
func documentsDir() string {
	p, err := windows.KnownFolderPath(windows.FOLDERID_Documents, 0)
	if err != nil {
		return ""
	}
	return p
}

func fail(text string) {
	messageBox("Build Scraper", text+"\n\nDetails were saved to:\n"+logPath, 0x10)
	os.Exit(1)
}

func messageBox(title, text string, flags uintptr) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
}
