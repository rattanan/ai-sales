# Chat display artifacts

Agentic bots can render three governed visual artifacts beside an assistant
message:

- `display_qr` creates a QR code from an exact payload already present in the
  user message or a prior tool result.
- `display_chart` creates a static bar, line, pie, or doughnut SVG from labels
  and numeric facts already present in the model's masked context.
- `display_image` imports a JPEG, PNG, or WebP from an exact HTTPS URL already
  present in that context.

The tools are disabled by default for new bots and the migration adds them to
`disabledTools` for existing bots. An administrator enables them under the
bot's Agent tools settings. They remain subject to the bot's normal agentic
mode and tool-step budget, with an additional limit of three visual artifacts
per turn.

## Runtime and storage boundary

`ChatArtifact` is the single interface used by internal chat, conversation
history, streaming, and the embedded widget. QR and chart tools create
server-authored SVG; model-authored SVG or HTML is never rendered. Chart series
must have exactly one value per label—missing values are rejected rather than
zero-filled.

Image imports use a DNS-pinned server request. They require credential-free
HTTPS, deny private addresses and cross-origin redirects, disable compression,
time out after eight seconds, and accept at most 1 MiB. The response type is
verified from file bytes and must match any declared content type. The source
URL and its query string are not persisted or sent to the browser.

Artifacts are stored under the owning `ChatMessage`. Image bytes are served by
`/api/chat-artifacts/[id]` only after either:

1. the signed-in user passes `chat.use` and owns the tenant-scoped
   conversation, or
2. an embedded bearer session is bound to the exact bot, organization, and
   conversation.

The route returns private, non-sniffable, same-origin media. QR payloads, chart
arguments, and image URLs are omitted from persisted tool traces; audit rows
record only artifact count and kinds.

## Presentation

The chat card provides visible full-size and download controls, descriptive
image alternatives, a native dismissible dialog, and an accessible data table
for every chart. Internal chat receives small QR/chart artifacts as SSE events;
image bytes wait for the final persisted response to avoid large data URLs in
the normal stream. The embedded widget loads stored images with its scoped
bearer token and renders the same three artifact kinds.
