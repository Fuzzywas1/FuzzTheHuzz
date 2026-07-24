SCRAMJET CLIENT FILE FIX
=========================

Problem fixed
-------------
The pages were requesting:

  /scram/scramjet.bundle.js

The installed Scramjet build exposes:

  /scram/scramjet.all.js

That prevented $scramjetLoadController from being created and caused:
"Scramjet client files did not load."

Install
-------
1. Upload this ZIP beside index.js.
2. Extract it from the project root:

   unzip -o Fuzz-Control-scramjet-client-fix.zip

3. Confirm dependencies are installed:

   npm install

4. Check JavaScript:

   node --check static/assets/js/proxy-engine.js

5. Restart:

   npm start

6. Open these URLs directly and confirm they show JavaScript instead of 404:

   /scram/scramjet.all.js
   /baremux/index.js

7. Clear the old service worker/site data once, then hard-refresh.

The updated proxy-engine.js also dynamically reloads the Scramjet and BareMux
client scripts if a page forgets to include them.
