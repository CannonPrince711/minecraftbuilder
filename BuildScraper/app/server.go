// Build Scraper app: the local server behind the window. It serves the website (scraper, 3D viewer
// and build library in one page), downloads web pages for it (no browser CORS limits; robots.txt
// is honoured and each site gets at most one request a second), and reads and writes the build
// library: one folder per category under Documents\Minecraft Builds (or a folder the user picks).
// Only listens on 127.0.0.1, and every /api call needs a random per-run token.
package main

import (
	"bufio"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

//go:embed site/index.html
var pageHTML string

const (
	userAgent = "BuildScraper/2.0 (+local schematic converter; one request at a time)"
	minGap    = 1100 * time.Millisecond // per host
	maxBytes  = 300 << 20
)

var (
	appDir  = filepath.Join(userConfigDir(), "BuildScraper")
	logPath = filepath.Join(appDir, "BuildScraper-errors.txt")
	logMu   sync.Mutex
)

func userConfigDir() string {
	if d := os.Getenv("LOCALAPPDATA"); d != "" {
		return d
	}
	if d, err := os.UserConfigDir(); err == nil {
		return d
	}
	return os.TempDir()
}

// appendLog adds one entry to the error log (kept under about 1 MB).
func appendLog(what, detail string) {
	logMu.Lock()
	defer logMu.Unlock()
	os.MkdirAll(appDir, 0o755)
	if st, err := os.Stat(logPath); err == nil && st.Size() > 1<<20 {
		os.Rename(logPath, logPath+".old")
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	text := strings.TrimSpace(what)
	if detail != "" {
		text += ": " + strings.TrimSpace(detail)
	}
	fmt.Fprintf(f, "%s  %s\r\n", time.Now().Format("2006-01-02 15:04:05"), strings.ReplaceAll(text, "\n", "\r\n    "))
}

// ---------------- server ----------------

func newServer() (http.Handler, error) {
	tok := make([]byte, 16)
	if _, err := rand.Read(tok); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(tok)
	api, _ := json.Marshal(map[string]string{"token": token})
	page := strings.Replace(pageHTML, "<script>window.MCBS_SAMPLE", "<script>window.MCBS_API="+string(api)+";</script>\n<script>window.MCBS_SAMPLE", 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, page)
	})
	// The 3D viewer's own hooks (it runs inside the page, same origin).
	mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, "ok") })
	mux.HandleFunc("/__log", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			b, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
			appendLog("3D viewer", string(b))
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/__openlog", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			if _, err := os.Stat(logPath); err != nil {
				appendLog("Log file opened from the Problems panel", "")
			}
			reveal(logPath, true)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("t") != token {
			writeJSON(w, 403, map[string]any{"error": "Bad token. Close Build Scraper and open it again."})
			return
		}
		switch {
		case r.URL.Path == "/api/ping":
			writeJSON(w, 200, map[string]any{"ok": true})
		case r.URL.Path == "/api/fetch":
			handleFetch(w, r)
		case r.URL.Path == "/api/log" && r.Method == http.MethodPost:
			b, _ := io.ReadAll(io.LimitReader(r.Body, 100000))
			appendLog("Problem", string(b))
			writeJSON(w, 200, map[string]any{"ok": true, "file": logPath})
		case strings.HasPrefix(r.URL.Path, "/api/library"):
			handleLibrary(w, r)
		default:
			http.NotFound(w, r)
		}
	})
	return mux, nil
}

func listen() (net.Listener, error) {
	// A fixed port keeps the page's saved settings (last tab, library folder in the browser) between runs.
	if ln, err := net.Listen("tcp", "127.0.0.1:8765"); err == nil {
		return ln, nil
	}
	return net.Listen("tcp", "127.0.0.1:0")
}

func writeJSON(w http.ResponseWriter, code int, v map[string]any) {
	if e, ok := v["error"].(string); ok && code >= 400 {
		appendLog("Request failed", e)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// ---------------- web fetching ----------------

var (
	httpClient  = &http.Client{Timeout: 60 * time.Second}
	robotsMu    sync.Mutex
	robotsCache = map[string][]robotsRule{}
	hitsMu      sync.Mutex
	lastHit     = map[string]time.Time{}
)

type robotsRule struct {
	allow bool
	path  string
}

func robotsAllows(u *url.URL) bool {
	if u.Hostname() == "api.github.com" || u.Hostname() == "raw.githubusercontent.com" {
		return true // APIs meant for programs
	}
	origin := u.Scheme + "://" + u.Host
	robotsMu.Lock()
	rules, ok := robotsCache[origin]
	robotsMu.Unlock()
	if !ok {
		rules = []robotsRule{}
		req, _ := http.NewRequest("GET", origin+"/robots.txt", nil)
		req.Header.Set("User-Agent", userAgent)
		c := &http.Client{Timeout: 8 * time.Second}
		if res, err := c.Do(req); err == nil {
			if res.StatusCode == 200 {
				applies := false
				sc := bufio.NewScanner(io.LimitReader(res.Body, 512<<10))
				for sc.Scan() {
					line := strings.TrimSpace(strings.SplitN(sc.Text(), "#", 2)[0])
					k, v, found := strings.Cut(line, ":")
					if !found {
						continue
					}
					k, v = strings.ToLower(strings.TrimSpace(k)), strings.TrimSpace(v)
					switch k {
					case "user-agent":
						applies = v == "*" || strings.Contains(strings.ToLower(v), "buildscraper")
					case "allow", "disallow":
						if applies && v != "" {
							rules = append(rules, robotsRule{allow: k == "allow", path: v})
						}
					}
				}
			}
			res.Body.Close()
		}
		robotsMu.Lock()
		robotsCache[origin] = rules
		robotsMu.Unlock()
	}
	path := u.EscapedPath()
	if u.RawQuery != "" {
		path += "?" + u.RawQuery
	}
	best, bestLen := true, -1
	for _, r := range rules {
		pat := regexp.QuoteMeta(r.path)
		pat = strings.ReplaceAll(pat, `\*`, ".*")
		if strings.HasSuffix(pat, `\$`) {
			pat = strings.TrimSuffix(pat, `\$`) + "$"
		}
		if re, err := regexp.Compile("^" + pat); err == nil && re.MatchString(path) && len(r.path) > bestLen {
			best, bestLen = r.allow, len(r.path)
		}
	}
	return best
}

func politeWait(host string) {
	hitsMu.Lock()
	now := time.Now()
	next := lastHit[host].Add(minGap)
	if next.Before(now) {
		next = now
	}
	lastHit[host] = next
	hitsMu.Unlock()
	time.Sleep(time.Until(next))
}

var privateHost = regexp.MustCompile(`^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)`)

func isPrivateHost(h string) bool {
	if os.Getenv("MCBS_ALLOW_LOCAL") == "1" {
		return false // tests only
	}
	h = strings.ToLower(h)
	return h == "localhost" || strings.HasSuffix(h, ".local") || h == "::1" || privateHost.MatchString(h)
}

func handleFetch(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	u, err := url.Parse(q.Get("url"))
	if err != nil || u.Host == "" {
		writeJSON(w, 400, map[string]any{"error": "That is not a valid web address."})
		return
	}
	if (u.Scheme != "http" && u.Scheme != "https") || isPrivateHost(u.Hostname()) {
		writeJSON(w, 400, map[string]any{"error": "Only public http(s) addresses can be fetched."})
		return
	}
	if !robotsAllows(u) {
		writeJSON(w, 403, map[string]any{"error": u.Hostname() + " asks tools not to download this page (robots.txt)."})
		return
	}
	politeWait(u.Hostname())
	req, _ := http.NewRequest("GET", u.String(), nil)
	req.Header.Set("User-Agent", userAgent)
	accept := q.Get("accept")
	if accept == "" {
		accept = "*/*"
	}
	req.Header.Set("Accept", accept)
	res, err := httpClient.Do(req)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": "Could not reach " + u.Hostname() + ": " + err.Error()})
		return
	}
	defer res.Body.Close()
	if res.ContentLength > maxBytes {
		writeJSON(w, 413, map[string]any{"error": "That file is too large."})
		return
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": "Download from " + u.Hostname() + " was cut off: " + err.Error()})
		return
	}
	if len(body) > maxBytes {
		writeJSON(w, 413, map[string]any{"error": "That file is too large."})
		return
	}
	code := 200
	if res.StatusCode >= 400 {
		code = 502
		appendLog("Download "+u.String(), fmt.Sprintf("site answered %d", res.StatusCode))
	}
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("X-Status", fmt.Sprint(res.StatusCode))
	h.Set("X-Final-Url", res.Request.URL.String())
	h.Set("X-Content-Type", res.Header.Get("Content-Type"))
	h.Set("X-Disposition", res.Header.Get("Content-Disposition"))
	h.Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	w.Write(body)
}

// ---------------- build library ----------------

var (
	schemFile   = regexp.MustCompile(`(?i)\.(schem|schematic|litematic|nbt)$`)
	badChars    = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]+`)
	reserved    = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com\d|lpt\d)(\.|$)`)
	spaces      = regexp.MustCompile(`\s+`)
	libMu       sync.Mutex
	libRoot     string
	settingsLoc = filepath.Join(appDir, "settings.json")
)

func libraryRoot() string {
	libMu.Lock()
	defer libMu.Unlock()
	if libRoot != "" {
		return libRoot
	}
	if d := os.Getenv("MCBS_LIBRARY"); d != "" {
		libRoot = d
		return libRoot
	}
	var s struct{ Library string }
	if b, err := os.ReadFile(settingsLoc); err == nil && json.Unmarshal(b, &s) == nil && s.Library != "" {
		libRoot = s.Library
		return libRoot
	}
	home, _ := os.UserHomeDir()
	docs := documentsDir()
	if docs == "" {
		docs = filepath.Join(home, "Documents")
		if _, err := os.Stat(docs); err != nil {
			docs = home
		}
	}
	libRoot = filepath.Join(docs, "Minecraft Builds")
	return libRoot
}

func setLibraryRoot(dir string) (string, error) {
	dir = strings.Trim(strings.TrimSpace(dir), `"`)
	if dir == "" || !filepath.IsAbs(dir) {
		return "", errors.New(`Type the full path of a folder, for example C:\Users\you\Documents\Minecraft Builds.`)
	}
	dir = filepath.Clean(dir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("Could not use that folder: %v", err)
	}
	libMu.Lock()
	libRoot = dir
	libMu.Unlock()
	os.MkdirAll(appDir, 0o755)
	b, _ := json.MarshalIndent(map[string]string{"library": dir}, "", "  ")
	os.WriteFile(settingsLoc, b, 0o644)
	return dir, nil
}

func cleanPart(s string) string {
	c := strings.TrimSpace(spaces.ReplaceAllString(badChars.ReplaceAllString(s, " "), " "))
	c = strings.Trim(c, ". ")
	if reserved.MatchString(c) {
		c = "_" + c
	}
	if len(c) > 120 {
		c = c[:120]
	}
	return c
}

// resolveRel turns "Category/file.schem" into a path inside the library, or fails.
func resolveRel(rel string, file bool) (string, error) {
	var parts []string
	for _, p := range strings.FieldsFunc(rel, func(r rune) bool { return r == '/' || r == '\\' }) {
		if c := cleanPart(p); c != "" {
			parts = append(parts, c)
		}
	}
	if len(parts) == 0 || len(parts) > 2 {
		return "", errors.New("Bad library path.")
	}
	if file && !schemFile.MatchString(parts[len(parts)-1]) {
		return "", errors.New("Only .schem, .schematic, .litematic and .nbt files go in the library.")
	}
	root := libraryRoot()
	abs := filepath.Join(append([]string{root}, parts...)...)
	back, err := filepath.Rel(root, abs)
	if err != nil || back == "." || strings.HasPrefix(back, "..") || filepath.IsAbs(back) {
		return "", errors.New("Bad library path.")
	}
	return abs, nil
}

func relOf(abs string) string {
	r, _ := filepath.Rel(libraryRoot(), abs)
	return filepath.ToSlash(r)
}

func unique(abs string) string {
	if _, err := os.Stat(abs); errors.Is(err, fs.ErrNotExist) {
		return abs
	}
	ext := filepath.Ext(abs)
	base := strings.TrimSuffix(abs, ext)
	for i := 2; ; i++ {
		p := fmt.Sprintf("%s-%d%s", base, i, ext)
		if _, err := os.Stat(p); errors.Is(err, fs.ErrNotExist) {
			return p
		}
	}
}

type libItem struct {
	Path  string  `json:"path"`
	Size  int64   `json:"size"`
	Mtime float64 `json:"mtime"`
}

func listLibrary() []libItem {
	root := libraryRoot()
	items := []libItem{}
	add := func(p string, info fs.FileInfo) {
		items = append(items, libItem{relOf(p), info.Size(), float64(info.ModTime().UnixMilli())})
	}
	top, _ := os.ReadDir(root)
	for _, e := range top {
		p := filepath.Join(root, e.Name())
		if e.Type().IsRegular() && schemFile.MatchString(e.Name()) {
			if info, err := e.Info(); err == nil {
				add(p, info)
			}
		} else if e.IsDir() {
			sub, _ := os.ReadDir(p)
			for _, f := range sub {
				if f.Type().IsRegular() && schemFile.MatchString(f.Name()) {
					if info, err := f.Info(); err == nil {
						add(filepath.Join(p, f.Name()), info)
					}
				}
			}
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Path < items[j].Path })
	return items
}

func handleLibrary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	post := r.Method == http.MethodPost
	fail := func(err error) {
		if errors.Is(err, fs.ErrNotExist) {
			writeJSON(w, 404, map[string]any{"error": "That build is no longer in the folder. Press Refresh."})
			return
		}
		writeJSON(w, 400, map[string]any{"error": err.Error()})
	}
	switch {
	case r.URL.Path == "/api/library":
		if q.Get("only") == "root" {
			writeJSON(w, 200, map[string]any{"root": libraryRoot()})
		} else {
			writeJSON(w, 200, map[string]any{"root": libraryRoot(), "items": listLibrary()})
		}
	case r.URL.Path == "/api/library/file":
		abs, err := resolveRel(q.Get("path"), true)
		if err != nil {
			fail(err)
			return
		}
		b, err := os.ReadFile(abs)
		if err != nil {
			fail(err)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(b)
	case r.URL.Path == "/api/library/save" && post:
		abs, err := resolveRel(q.Get("path"), true)
		if err != nil {
			fail(err)
			return
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
		if err != nil || len(b) > maxBytes {
			writeJSON(w, 413, map[string]any{"error": "That file is too large."})
			return
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			fail(fmt.Errorf("Could not make the folder %s: %v", filepath.Dir(abs), err))
			return
		}
		libMu.Lock()
		out := unique(abs)
		f, err := os.OpenFile(out, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_, err = f.Write(b)
			if cerr := f.Close(); err == nil {
				err = cerr
			}
		}
		libMu.Unlock()
		if err != nil {
			fail(fmt.Errorf("Could not save %s: %v", out, err))
			return
		}
		writeJSON(w, 200, map[string]any{"path": relOf(out)})
	case r.URL.Path == "/api/library/move" && post:
		abs, err := resolveRel(q.Get("path"), true)
		if err != nil {
			fail(err)
			return
		}
		dest, err := resolveRel(q.Get("to")+"/"+filepath.Base(abs), true)
		if err != nil {
			fail(err)
			return
		}
		if dest == abs {
			writeJSON(w, 200, map[string]any{"path": relOf(abs)})
			return
		}
		if _, err := os.Stat(abs); err != nil {
			fail(err)
			return
		}
		os.MkdirAll(filepath.Dir(dest), 0o755)
		libMu.Lock()
		out := unique(dest)
		err = os.Rename(abs, out)
		libMu.Unlock()
		if err != nil {
			fail(fmt.Errorf("Could not move the file: %v", err))
			return
		}
		writeJSON(w, 200, map[string]any{"path": relOf(out)})
	case r.URL.Path == "/api/library/root" && post:
		d, err := setLibraryRoot(q.Get("dir"))
		if err != nil {
			fail(err)
			return
		}
		writeJSON(w, 200, map[string]any{"root": d})
	case r.URL.Path == "/api/library/open" && post:
		root := libraryRoot()
		os.MkdirAll(root, 0o755)
		if p := q.Get("path"); p != "" {
			abs, err := resolveRel(p, true)
			if err != nil {
				fail(err)
				return
			}
			reveal(abs, true)
		} else {
			reveal(root, false)
		}
		writeJSON(w, 200, map[string]any{"ok": true})
	default:
		writeJSON(w, 404, map[string]any{"error": "Unknown library request."})
	}
}

// reveal opens a folder, or the folder holding a file with the file selected.
func reveal(p string, isFile bool) {
	switch runtime.GOOS {
	case "windows":
		if isFile {
			exec.Command("explorer", "/select,", p).Start()
		} else {
			exec.Command("explorer", p).Start()
		}
	case "darwin":
		if isFile {
			exec.Command("open", "-R", p).Start()
		} else {
			exec.Command("open", p).Start()
		}
	default:
		if isFile {
			p = filepath.Dir(p)
		}
		exec.Command("xdg-open", p).Start()
	}
}
