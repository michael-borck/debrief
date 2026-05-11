# Search

DeepDebrief has three ways to find things: the Library search box for a single transcript list, the Search & Filter page for global search, and the Cross-transcript Search tab inside a project.

## Library search

The search box at the top of the Library page does a fast literal match against transcript titles and full text. It's good for:

- Finding a transcript whose title you partially remember
- Quickly locating a word or phrase you know appears in a recording
- Filtering the Library while you browse

Combine with the filter dropdown (status, project, tag, starred, rated, date range) to narrow further.

## Search & Filter page

The global search page (sidebar → **Search & Filter**) is the main search tool. It queries across every transcript in your library at once.

### Search modes

| Mode | What it does | Best for |
|---|---|---|
| **Keyword** | Fast literal matching | Finding exact phrases and proper nouns |
| **Semantic** | Vector similarity search using embeddings | Finding concepts regardless of exact wording |
| **Hybrid** | Runs both and merges ranked results | Default — covers both needs |

Keyword is instant. Semantic and Hybrid need the chat search index to be built (it's built automatically when you first chat with a transcript, or you can pre-build from **Settings → General → Chat Search Index**).

### Results

Each result shows:

- The **transcript title** and date
- A **snippet** from the matching region with your query highlighted
- The **speaker** who said it (if diarised)
- A **timestamp** and jump link that opens the transcript at that point

Click a result to open the transcript scrolled to the match, with the audio player queued to the right moment.

### Filters

The filter panel on the right lets you scope a search:

- **Date range** — only recordings from a specific period
- **Speakers** — only transcripts featuring specific named speakers
- **Projects** — limit to member transcripts of selected projects
- **Tags** — match on your free-form tags
- **Starred / rated** — only favourites or rated recordings

## Cross-transcript search in a project

When you're working inside a project, the **Cross-transcript Search** tab on the project detail page gives you the same three search modes scoped to that project's members. It's how you answer "which interviews in this study mentioned X?" without leaving the project context.

Results have a slightly different layout — they're grouped by transcript so you can see how many hits each recording contributed.

## Under the hood: the vector store

Semantic and Hybrid modes depend on DeepDebrief's local vector store. Here's how it works:

1. When you first chat with a transcript (or run **Reset Search Index** in Settings), DeepDebrief chunks the transcript into speaker-based or time-based pieces
2. Each chunk is embedded using a local embedding model (no network calls)
3. Embeddings go into a local vector database alongside your SQLite store
4. At query time, your search is embedded the same way and matched by cosine similarity

No data leaves your machine during semantic search — the embedding model is bundled with DeepDebrief and runs in the main process.

### Managing the index

**Settings → General → Chat Search Index** (collapsed by default):

- **View Statistics** — see index size and chunk counts per transcript
- **Reset Search Index** — clear all embeddings; they rebuild automatically the next time you chat or search

Reset only if you're seeing strange chat/search behaviour. Most users never need this.

## Tips

- **Start with Hybrid.** It's the default for a reason — it catches both literal matches and conceptual similarity.
- **Use keyword for names and jargon.** Specific terms work better with literal matching.
- **Use semantic for ideas.** Questions like "anything about customer frustration?" work better semantically.
- **Scope with filters before searching broadly.** A 500-result search is less useful than a 20-result search on the right subset.
- **Rebuild the index after major transcript edits** if semantic results feel stale. The index doesn't auto-update when you correct a transcript — a Reset re-indexes everything on next use.

## Next steps

- [AI Chat](ai-chat.md) — conversational search over a transcript or project
- [Projects → Cross-transcript Search](../user-guide/projects.md#cross-transcript-search)
- [Settings → Chat](../user-guide/settings.md#chat) — chunking and chat settings
