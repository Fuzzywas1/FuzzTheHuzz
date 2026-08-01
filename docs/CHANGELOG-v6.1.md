# Fuzz 6.1 — Sidebar + Fuzz AI Refresh

## Shared interface

- Rebuilt the universal left sidebar using consistent inline SVG icons rather than mixed icon-font glyphs.
- Grouped navigation into Workspace, Browser, Control, and Management sections.
- Repaired collapsed mode so every icon stays centered, active states remain visible, unread counts become compact dots, and controls retain labels through tooltips.
- Added stable account, notification, collapse, sign-out, mobile drawer, and keyboard controls.
- Preserved the saved expanded/collapsed preference and synchronized personalization settings.
- Removed old route-specific forced sidebar behavior.

## Page integration

- Corrected Home, Apps, Account, Status, Settings, Chat, Tabs, Proxy, and Fuzz AI spacing for the left sidebar.
- Updated fixed Tabs, Proxy, Chat, and Fuzz AI layouts so they resize when the sidebar expands or collapses.
- Added mobile menu clearance at the same breakpoint used by the shared sidebar.
- Removed large empty top gaps left behind by the former top navigation.

## Fuzz AI

- Rebuilt `/ai` as a full workspace with a conversation-history panel and focused chat area.
- Added searchable saved chats, chat counts, timestamps, rename/delete controls, and active-chat titles.
- Added prompt starters, image drag-and-drop, image paste, live status, stop generation, and improved mobile history controls.
- Repaired saved-chat creation, message persistence, chat loading, and partial-response saving after stopping generation.
- Added visible notices for image attachments in reopened conversations.
- Improved errors so an AI response can continue even when chat persistence is temporarily unavailable.

## Compatibility

- No new environment variables or Supabase migrations are required.
- Existing Fuzz 6.0 Chat, Feedback, customization, account, Apps, Tabs, proxy, and admin features remain in place.
