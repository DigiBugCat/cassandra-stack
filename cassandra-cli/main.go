package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/cassandrasedge/cassandra-cli/client"
	"github.com/cassandrasedge/cassandra-cli/tui"
)

func main() {
	urlFlag := flag.String("url", "", "Runner orchestrator URL")
	keyFlag := flag.String("key", "", "API key")
	sessionFlag := flag.String("session", "", "Session ID to connect to directly")
	modelFlag := flag.String("model", "", "Model (haiku, sonnet, opus, etc.)")
	vaultFlag := flag.String("vault", "", "Vault name (empty = no vault)")
	noVaultFlag := flag.Bool("no-vault", false, "Don't use vault even if configured")
	continueFlag := flag.Bool("continue", false, "Continue most recent session")
	cFlag := flag.Bool("c", false, "Continue most recent session (short)")
	listFlag := flag.Bool("list", false, "List sessions and exit")
	printFlag := flag.Bool("print", false, "Print mode: send prompt from args and exit (like claude -p)")
	pFlag := flag.Bool("p", false, "Print mode (short)")
	attachFlag := flag.Bool("attach", false, "Attach to a session's PTY (native Claude Code TUI)")


	flag.Parse()

	// Load config from ~/.cmux/agent.json
	cfg := LoadConfig()

	// CLI flags override config
	if *urlFlag != "" {
		cfg.RunnerURL = *urlFlag
	}
	if *keyFlag != "" {
		cfg.APIKey = *keyFlag
	}
	if *modelFlag != "" {
		cfg.Model = *modelFlag
	}
	if *vaultFlag != "" {
		cfg.VaultName = *vaultFlag
	}
	if *noVaultFlag {
		cfg.VaultName = ""
	}

	if cfg.RunnerURL == "" {
		fmt.Fprintln(os.Stderr, "Error: --url or runnerURL in ~/.cmux/agent.json is required")
		os.Exit(1)
	}
	if cfg.APIKey == "" {
		fmt.Fprintln(os.Stderr, "Error: --key or apiKey in ~/.cmux/agent.json is required")
		os.Exit(1)
	}

	initDebug()
	debugLog("config: url=%s model=%s vault=%s", cfg.RunnerURL, cfg.Model, cfg.VaultName)

	// Handle --list
	if *listFlag {
		rest := client.NewRestClient(cfg.RunnerURL, cfg.APIKey)
		sessions, err := rest.ListSessions()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		if len(sessions) == 0 {
			fmt.Println("No sessions.")
		} else {
			for _, s := range sessions {
				name := s.SessionID[:8]
				if s.Name != nil && *s.Name != "" {
					name = *s.Name
				}
				fmt.Printf("  %s  %s  %s  %d msgs\n", string(s.Status), name, s.Model, s.MessageCount)
			}
		}
		return
	}

	// Handle --continue / -c: find most recent session
	if (*continueFlag || *cFlag) && *sessionFlag == "" {
		rest := client.NewRestClient(cfg.RunnerURL, cfg.APIKey)
		sessions, err := rest.ListSessions()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error listing sessions: %v\n", err)
			os.Exit(1)
		}
		if len(sessions) > 0 {
			*sessionFlag = sessions[0].SessionID
			fmt.Fprintf(os.Stderr, "Continuing session %s\n", *sessionFlag)
		}
	}

	// Handle --attach: connect to PTY bridge for native Claude Code TUI
	if *attachFlag {
		if *sessionFlag == "" {
			fmt.Fprintln(os.Stderr, "Error: --session is required with --attach")
			os.Exit(1)
		}
		wsURL := strings.Replace(strings.Replace(cfg.RunnerURL, "https://", "wss://", 1), "http://", "ws://", 1)
		if err := tui.RunPtyAttach(wsURL, cfg.APIKey, *sessionFlag); err != nil {
			fmt.Fprintf(os.Stderr, "\r\nError: %v\n", err)
			os.Exit(1)
		}
		return
	}

	// Handle --print / -p mode: send remaining args as prompt, print result, exit
	if *printFlag || *pFlag {
		prompt := strings.Join(flag.Args(), " ")
		if prompt == "" {
			// Read from stdin
			scanner := bufio.NewScanner(os.Stdin)
			var lines []string
			for scanner.Scan() {
				lines = append(lines, scanner.Text())
			}
			prompt = strings.Join(lines, "\n")
		}
		if prompt == "" {
			fmt.Fprintln(os.Stderr, "Error: no prompt provided")
			os.Exit(1)
		}
		if err := runPrint(cfg, *sessionFlag, prompt); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	// TUI is the only interactive mode
	appCfg := tui.AppConfig{
		RunnerURL:     cfg.RunnerURL,
		APIKey:        cfg.APIKey,
		Model:         cfg.Model,
		Thinking:      cfg.Thinking,
		SessionID:     *sessionFlag,
		Vault:         cfg.VaultName,
		PermMode:      cfg.PermissionMode,
		SysPrompt:     cfg.SystemPrompt,
		CompactInstr:  cfg.CompactInstructions,
		AgentName:     cfg.AgentName,
		InitialPrompt: strings.Join(flag.Args(), " "),
	}

	if err := tui.RunProgram(appCfg); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
