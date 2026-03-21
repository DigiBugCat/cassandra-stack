package tui

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/gorilla/websocket"
	"golang.org/x/sys/unix"
)

// PtyFrame is a message from the orchestrator's PTY bridge.
type PtyFrame struct {
	Type     string `json:"type"`
	Data     string `json:"data,omitempty"`
	Stderr   bool   `json:"stderr,omitempty"`
	ExitCode *int   `json:"exit_code,omitempty"`
	Signal   string `json:"signal,omitempty"`
}

// RunPtyAttach connects to the orchestrator's PTY bridge and relays raw
// terminal bytes between the local terminal and a remote Claude Code TUI.
// The remote process runs interactively — all rendering is done by Claude
// Code's own Ink TUI. This client is just a byte pipe.
func RunPtyAttach(orchestratorURL, apiKey, sessionID string) error {
	// Build WebSocket URL
	wsURL := fmt.Sprintf("%s/pty/sessions/%s/attach?key=%s", orchestratorURL, sessionID, apiKey)

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("connect to PTY bridge: %w", err)
	}
	defer conn.Close()

	// Put local terminal in raw mode
	fd := int(os.Stdin.Fd())
	oldState, err := makeRaw(fd)
	if err != nil {
		return fmt.Errorf("set raw mode: %w", err)
	}
	defer restoreTerminal(fd, oldState)

	// Send initial terminal size
	cols, rows := getTermSize(fd)
	sendResize(conn, cols, rows)

	// Handle SIGWINCH (terminal resize)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGWINCH)
	go func() {
		for range sigCh {
			c, r := getTermSize(fd)
			sendResize(conn, c, r)
		}
	}()
	defer signal.Stop(sigCh)

	errCh := make(chan error, 2)

	// Remote → local: read PTY frames from WS, write raw bytes to stdout
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				errCh <- fmt.Errorf("ws read: %w", err)
				return
			}

			var frame PtyFrame
			if err := json.Unmarshal(msg, &frame); err != nil {
				continue
			}

			switch frame.Type {
			case "pty_data":
				raw, err := base64.StdEncoding.DecodeString(frame.Data)
				if err != nil {
					continue
				}
				os.Stdout.Write(raw)

			case "pty_exit":
				errCh <- nil
				return
			}
		}
	}()

	// Local → remote: read stdin bytes, send as binary WS frames
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := os.Stdin.Read(buf)
			if n > 0 {
				// Send as JSON with base64 data (matching the orchestrator's expected format)
				payload, _ := json.Marshal(map[string]string{
					"type": "input",
					"data": base64.StdEncoding.EncodeToString(buf[:n]),
				})
				if wErr := conn.WriteMessage(websocket.TextMessage, payload); wErr != nil {
					errCh <- fmt.Errorf("ws write: %w", wErr)
					return
				}
			}
			if err != nil {
				errCh <- nil
				return
			}
		}
	}()

	return <-errCh
}

func makeRaw(fd int) (*unix.Termios, error) {
	old, err := unix.IoctlGetTermios(fd, unix.TIOCGETA)
	if err != nil {
		return nil, err
	}

	raw := *old
	raw.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP |
		unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	raw.Oflag &^= unix.OPOST
	raw.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	raw.Cflag &^= unix.CSIZE | unix.PARENB
	raw.Cflag |= unix.CS8
	raw.Cc[unix.VMIN] = 1
	raw.Cc[unix.VTIME] = 0

	if err := unix.IoctlSetTermios(fd, unix.TIOCSETA, &raw); err != nil {
		return nil, err
	}
	return old, nil
}

func restoreTerminal(fd int, state *unix.Termios) {
	unix.IoctlSetTermios(fd, unix.TIOCSETA, state)
}

func getTermSize(fd int) (cols, rows uint16) {
	ws, err := unix.IoctlGetWinsize(fd, unix.TIOCGWINSZ)
	if err != nil {
		return 80, 24
	}
	return ws.Col, ws.Row
}

func sendResize(conn *websocket.Conn, cols, rows uint16) {
	msg, _ := json.Marshal(map[string]any{
		"type": "resize",
		"cols": cols,
		"rows": rows,
	})
	conn.WriteMessage(websocket.TextMessage, msg)
}
