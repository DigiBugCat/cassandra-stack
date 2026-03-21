package main

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	RunnerURL           string `json:"runnerURL"`
	APIKey              string `json:"apiKey"`
	Model               string `json:"model"`
	VaultName           string `json:"vaultName"`
	Thinking            bool   `json:"thinking"`
	PermissionMode      string `json:"permissionMode"`
	SystemPrompt        string `json:"systemPrompt"`
	CompactInstructions string `json:"compactInstructions"`
	AgentName           string `json:"agentName"`
}

// LoadConfig reads config from (in order of priority):
//  1. ~/.cassandra/config.json
//  2. ~/.cmux/agent.json (legacy, backwards compat)
func LoadConfig() Config {
	cfg := Config{
		Model:          "opus[1m]",
		Thinking:       false,
		PermissionMode: "bypassPermissions",
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return cfg
	}

	// Try primary path first
	paths := []string{
		filepath.Join(home, ".cassandra", "config.json"),
		filepath.Join(home, ".cmux", "agent.json"),
	}

	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		json.Unmarshal(data, &cfg)
		return cfg
	}

	return cfg
}
