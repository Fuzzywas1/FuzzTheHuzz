FUZZ AI CLIENT FIX

Cause:
static/assets/js/ai.js was overwritten by an admin analytics module.
The /ai page then loaded code that expected an admin dashboard container,
so the chat form, saved chats, and /api/ai/chat request never initialized.

Install from the project root:

unzip -o Fuzz-AI-fix.zip
node --check static/assets/js/ai.js
npm start

Then open /ai and hard refresh with Ctrl + Shift + R.
