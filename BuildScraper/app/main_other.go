//go:build !windows

// Outside Windows there is no app window: serve the page and print its address (used for testing).
package main

import (
	"fmt"
	"net/http"
	"os"
)

func documentsDir() string { return "" }

func main() {
	h, err := newServer()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	ln, err := listen()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("Build Scraper is running at http://%s/\n", ln.Addr())
	http.Serve(ln, h)
}
