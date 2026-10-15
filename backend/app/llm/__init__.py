"""Shared LLM plumbing: call accounting with a hard Claude cap (usage), a text-only JSON chain
(text: Groq -> Gemini -> Claude), a generic vision JSON call on top of the parser's providers
(vision), and a disk cache for results (cache)."""
