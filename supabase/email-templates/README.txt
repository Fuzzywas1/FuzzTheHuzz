FUZZ CONFIRMATION EMAIL TEMPLATE

Suggested subject:
  Confirm your Fuzz account

Hosted Supabase:
1. Open Authentication -> Email Templates.
2. Select Confirm sign up.
3. Set the subject to "Confirm your Fuzz account".
4. Copy all contents of confirm-signup-template.txt into the HTML editor.
5. Save.

The template uses {{ .ConfirmationURL }}. Do not remove it.

For production, configure custom SMTP under Authentication -> SMTP Settings.
Suggested sender:
  Novaris <no-reply@yourdomain.com>

Disable link tracking in your SMTP provider because rewritten authentication
links can fail.
