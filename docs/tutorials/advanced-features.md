# Tutorial: Advanced Features

Power-user features for people who've already done the basic workflow. We'll cover prompt customisation, diarisation tuning, semantic search, chat modes, and scripting via JSON exports.

## Customising AI prompts

**Settings → AI Prompts** is where you tell DeepDebrief how to talk to the LLM for each task. Each built-in task has a default prompt and a restore button.

### Why bother

Default prompts are generic. If you always work with a specific kind of content — sales calls, academic lectures, therapy sessions, technical interviews — you can bias the AI toward what matters in that domain.

### Editing a prompt

Click any prompt in the list. You'll see its text with `{transcript}`, `{title}`, and similar variables that get filled in at runtime. Edit the prose, save.

Example — default summary prompt:

> Summarise the following transcript. Focus on the main points and key takeaways.

Custom prompt for a research use case:

> You are analysing a qualitative research interview. Produce a summary that:
> 1. Identifies the participant's role and background if mentioned
> 2. Highlights explicit user needs and pain points
> 3. Flags any suggested solutions the participant proposed
> 4. Ends with a one-line "main takeaway" for the researcher
>
> Transcript:
> {transcript}

Prompts are stored per-task in the database. You can reset any individual prompt to default without touching the others.

### Testing changes

After editing, open a transcript and click **Re-analyse**. The new analysis uses your updated prompt. Compare results and iterate.

## Diarisation tuning

**Settings → Processing → Advanced diarisation tuning** (expand the collapsible under "Detect speakers from audio").

The defaults are empirically validated across clean, noisy, and multi-speaker recordings — don't touch them unless the pipeline is misbehaving on a specific file. When it is, these knobs let you rescue it.

| Knob | What it does | When to change |
|---|---|---|
| **Cluster similarity threshold** | Cosine similarity threshold for merging voice embeddings | Lower if the same person is split into multiple speakers. Raise if distinct people are merging. |
| **Median filter frames** | Window size for smoothing frame-level jitter | Raise for very noisy audio that over-segments. Lower for rapid turn-taking you want to preserve. |
| **Min turn duration** | Turns shorter than this are absorbed into neighbours | Raise to kill micro-fragments. Lower to keep brief interjections. |
| **Min gap to split** | Gaps shorter than this are merged across | Raise to smooth choppy speech. Lower to preserve intentional pauses. |
| **Noise cluster minimum** | Clusters with less total speech than this get reassigned | Raise to aggressively suppress one-off noise. Lower to preserve brief speakers. |

Settings apply to the next diarisation run. Re-upload or re-process the affected file to see the effect. Click **Reset to defaults** if you break something.

## Semantic search strategies

Semantic search finds matches by meaning, not literal words. It's powerful but needs different phrasing than keyword search to shine.

### When semantic beats keyword

- **Conceptual queries** — "anything about customer frustration" catches "fed up", "annoyed", "couldn't get it to work" without those exact words
- **Paraphrased content** — the AI corrected a sentence, so your memory of the wording doesn't match the stored text
- **Cross-lingual ideas** — synonyms and related concepts

### When keyword beats semantic

- **Proper nouns** — names of people, products, companies
- **Exact quotes** — you remember a specific phrase
- **Jargon and technical terms** — domain-specific vocabulary the embedding model may not handle well

**Hybrid mode** runs both and merges the ranked results. Use it as the default unless you have a reason to prefer one mode.

### Rebuilding the index

If semantic search feels stale after a lot of transcript corrections, go to **Settings → General → Chat Search Index → Reset Search Index**. Embeddings rebuild automatically on the next chat or search.

## Chat conversation modes

**Settings → Chat → Conversation Mode**:

| Mode | Speed | Accuracy | Context size | Best for |
|---|---|---|---|---|
| **Quote Lookup** | Fastest | Literal | Small | Finding exact passages; auditing what someone said |
| **Smart Search** | Balanced | High | Medium | Default. Retrieves relevant chunks and lets the AI interpret them. |
| **Full Transcript** | Slowest | Highest for long context | Whole transcript | Deep synthesis questions that need full context |

Quote Lookup doesn't call the LLM at all — it just returns relevant chunks. Smart Search sends retrieved chunks + your question. Full Transcript sends the entire transcript + your question.

**Advanced chat settings** (collapsible) let you tune chunk size, overlap, and context count. Most users never need these.

## Session token usage

**Settings → Processing → Session token usage** shows how many tokens you've spent on AI calls since the app launched, broken down by provider.

Useful for:

- Monitoring spend on paid providers
- Benchmarking how chatty a workflow is
- Spotting runaway analysis loops

Totals reset on restart. Click **Reset** to zero them without restarting.

Local providers (Ollama) report tokens but no cost — they're free to run.

## Scripting with JSON exports

The JSON export format gives you the full transcript, analysis, and metadata in a machine-readable shape. Good use cases:

- **Feeding into other tools** — analytics platforms, document generators, research coding software
- **Longitudinal analysis** — comparing how themes evolve across studies
- **Custom reports** — rendering your own PDF templates from the structured data

Export → JSON → save. Parse with whatever you like. See the [Export reference](../features/export.md#json-export-schema) for the schema.

## Encrypted API keys

DeepDebrief stores cloud provider API keys encrypted via your OS keychain (macOS Keychain, Windows DPAPI, libsecret on Linux). Nothing to configure — it just works.

On Linux without a running keyring service, DeepDebrief falls back to plain text and logs a warning. If you're on a shared machine, install a keyring service or use Ollama.

## Moving the database

**Settings → General → Storage & Backup → Database location** lets you move the SQLite database to an external drive, a sync folder, or a different partition. Click **Change Location**, pick a new folder, and the app moves the file for you.

Useful for:

- Freeing up space on your main disk
- Syncing across machines via Dropbox/iCloud (close DeepDebrief before syncing to avoid conflicts)
- Keeping work and personal libraries separate

## Where to go from here

- [Settings](../user-guide/settings.md) — full settings reference
- [Projects](../user-guide/projects.md) — cross-transcript workflows
- [Features → Search](../features/search.md) — search modes in depth
- [Features → Analysis](../features/analysis.md) — the analysis tasks explained
