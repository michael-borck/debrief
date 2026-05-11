# AI Chat

Talk to your transcripts. Ask questions, get summaries, find specific moments, request analysis. The chat feature works on individual transcripts and across whole projects.

## Where to find it

- **Per-transcript chat**: open any transcript → Chat tab (or the message-circle icon on the toolbar)
- **Per-project chat**: open any project → Chat with project
- **Chat History**: sidebar → Chat History to see past conversations

## How it works

DeepDebrief uses your configured AI provider (Settings → Processing → AI Analysis Service) for chat. The same provider/model that produces summaries also handles chat — there's only one AI to configure.

When you ask a question, DeepDebrief:

1. Embeds your question into a vector
2. Searches the local vector index for relevant transcript chunks
3. Sends the chunks plus your question to the AI
4. Streams the response back to you

The vector index is built incrementally as you transcribe. There's no separate "index this transcript" step — it just happens.

## Conversation modes

Settings → Chat lets you choose how the chat works. Three options:

### Quote Lookup

Returns relevant transcript excerpts directly, with no AI rewriting.

- **Fastest** — no LLM call needed
- **Most factual** — what you see is what someone actually said
- **Best for**: finding specific information, hunting for quotes, "did anyone mention X"

You'll see exact excerpts with timestamps and a relevance score. No interpretation, no synthesis.

### Smart Search (Recommended, default)

Retrieves the most relevant chunks and sends them to the AI for interpretation.

- **Balanced** — speed and quality
- **Best for**: general questions, analysis, follow-up conversation
- **Trade-off**: the AI might paraphrase or summarise rather than quote

Most users should leave it on this setting.

### Full Transcript

Sends the entire transcript to the AI in one shot.

- **Most thorough** — the AI sees everything
- **Slowest** — long transcripts use a lot of tokens
- **Best for**: questions that need full context ("what's the overall arc of this conversation?")

This mode has a configurable context limit (default 8,000 characters) for transcripts that exceed the LLM's window.

## What you can ask

Some examples that work well:

- **Summary requests**: "Give me a one-paragraph summary." "What are the three main points?"
- **Specific information**: "What did Sarah say about the budget?" "When does the topic change to scheduling?"
- **Analysis**: "What's the overall sentiment here?" "Are there any disagreements?"
- **Action items**: "List every action item with the person responsible."
- **Follow-up questions**: "Tell me more about the second point." "Why did they decide that?"
- **Cross-reference**: "Did anyone mention deadlines?" "Find every mention of the new product."

## Project chat

When you chat with a project, the AI sees context from every transcript in the project, not just one. This is useful for:

- **Cross-recording analysis**: "Across all five interviews, what themes came up most?"
- **Comparison**: "How did participant A's answers compare to participant B's?"
- **Longitudinal tracking**: "How did the discussion evolve from week 1 to week 4?"

The context is retrieved using the same vector search, just over a wider pool of chunks.

## Conversation memory

DeepDebrief remembers the last 20 messages in a conversation by default. After that, older messages get summarised to keep the context window manageable. You can adjust the memory limit in Settings → Chat → Advanced Chat Settings → Conversation Memory Limit.

## Saved conversations

Every chat conversation is saved automatically to the local database. Open **Chat History** in the sidebar to:

- Resume a previous conversation
- Search past conversations by content
- Delete conversations you don't need

Conversations are scoped to either a transcript or a project — they show which one in the chat history list.

## Tips

- **Be specific.** "Summarise this" works, but "Give me a 3-bullet summary focused on action items" works better.
- **Reference time.** If you remember roughly when something was said, mention it ("around 12 minutes in"). The AI can use timestamps in the chunks.
- **Use Quote Lookup for evidence.** When you need exact wording for a report or paper, switch to Quote Lookup mode for verbatim excerpts.
- **Switch providers per task.** A small local Ollama model is fine for "find me X" questions but might struggle with deep analysis. Switching to a cloud provider in Settings affects all subsequent chat — no per-conversation override.
- **Privacy reminder.** When you're using a cloud AI provider, your chat questions AND the retrieved transcript chunks are sent to that provider. Check the privacy banner in Settings to confirm which mode you're in.

## Troubleshooting

- **"No model selected"** — pick a model in Settings → Processing → AI Analysis Service after clicking Refresh Models
- **"AI service error"** — usually means the provider is down, the API key is wrong, or you've hit a rate limit. Test the connection in Settings.
- **Slow first response** — Ollama loads the model into RAM on first request. Subsequent questions in the same session are faster.
- **Empty or weird responses** — try a better/larger model. Small local models (3B params) sometimes produce flat, generic answers. Llama 3.1 8B or larger usually does much better.
- **Chat search returns nothing** — the vector index for that transcript may not have built yet. Try going to the transcript page first, then come back to chat.

For more, see [Common Issues](../troubleshooting/common-issues.md).
