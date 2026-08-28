---
name: binary-analysis
description: Analyze PE, ELF, Mach-O, firmware, and other binaries using HackerAI tools and the Dr.Binary MCP backend.
---

# Binary Analysis

Use the Dr.Binary MCP tool for specialist static and dynamic analysis. Prefer evidence from tools over assumptions.

## Workflow

1. For a local sample, call prepare_upload and execute the returned one-time upload command with HackerAI's terminal tool.
2. Start with inspect_binary to collect file metadata, architecture, sections, imports/exports, symbols, strings, and entrypoints.
3. Use run_sandbox for targeted Rizin or reverse-engineering commands when the initial triage is insufficient.
4. Use dump_data when deeper decompilation or disassembly artifacts are needed.
5. Use list_files and read_file to inspect generated artifacts.
6. Correlate multiple observations before concluding and separate observed facts from hypotheses.

The Dr.Binary MCP integration is exposed through the HackerAI tool named drbinary.
