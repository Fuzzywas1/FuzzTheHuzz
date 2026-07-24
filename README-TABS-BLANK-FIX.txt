FUZZ TABS BLANK-PAGE FIX
=========================

Cause
-----
The Tabs overhaul correctly created the Scramjet/Ultraviolet iframe, but then
replaced the iframe host's entire className while changing page state.

That removed the required "is-active" class. Since inactive hosts use
display:none, the page was loaded but hidden, leaving a blank dark viewport.

Install
-------
1. Upload this ZIP beside index.js.
2. Extract it:

   unzip -o Fuzz-Control-tabs-blank-page-fix.zip

3. Check the JavaScript:

   node --check static/assets/js/t3.js

4. Restart:

   npm start

5. Open /d and hard-refresh:

   Ctrl + Shift + R

No database changes are required.
