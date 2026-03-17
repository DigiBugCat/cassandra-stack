package tui

import (
	"fmt"
	"strings"

	"github.com/cassandrasedge/cassandra-cli/client"
	"github.com/charmbracelet/lipgloss"
)

type StatusBar struct {
	Connected     bool
	SessionStatus client.SessionStatus
	Model         string
	Thinking      bool
	ContextTokens int
	Width         int
}

// View renders Claude Code style: Model: X | Ctx: Xk | ...
func (s StatusBar) View() string {
	barStyle := lipgloss.NewStyle().
		Foreground(lipgloss.Color("245")).
		Width(s.Width)

	sep := lipgloss.NewStyle().Foreground(lipgloss.Color("238")).Render(" | ")

	// Model
	parts := []string{
		lipgloss.NewStyle().Bold(true).Render("Model: " + modelDisplayName(s.Model)),
	}

	// Context
	if s.ContextTokens > 0 {
		k := float64(s.ContextTokens) / 1000
		if k >= 1000 {
			parts = append(parts, fmt.Sprintf("Ctx: %.0fk", k))
		} else {
			parts = append(parts, fmt.Sprintf("Ctx: %.1fk", k))
		}
	} else {
		parts = append(parts, "Ctx: 0")
	}

	// Connection
	if !s.Connected {
		parts = append(parts, lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Render("disconnected"))
	}

	// Thinking/effort
	if s.Thinking {
		parts = append(parts, "◐ thinking")
	}

	// Session status indicator
	yellowStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("3"))
	switch {
	case s.SessionStatus == client.StatusStarting:
		parts = append(parts, yellowStyle.Render("starting…"))
	case s.SessionStatus == client.StatusCloning:
		parts = append(parts, yellowStyle.Render("cloning…"))
	case s.SessionStatus == client.StatusSyncing || strings.HasPrefix(string(s.SessionStatus), "syncing"):
		parts = append(parts, yellowStyle.Render(string(s.SessionStatus)+"…"))
	case s.SessionStatus == client.StatusBusy:
		parts = append(parts, yellowStyle.Render("working…"))
	}

	content := "  " + joinWith(parts, sep)

	return barStyle.Render(content)
}

func joinWith(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}

func modelDisplayName(m string) string {
	switch m {
	case "haiku":
		return "Haiku"
	case "sonnet":
		return "Sonnet"
	case "sonnet[1m]":
		return "Sonnet (1M)"
	case "opus":
		return "Opus"
	case "opus[1m]":
		return "Opus (1M)"
	default:
		return m
	}
}
