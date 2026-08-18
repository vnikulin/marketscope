# Open questions

## Secure session cookies and the LAN HTTP fallback

- Question: Should LAN-only HTTP expose authenticated PWA and administration routes, or only non-authenticated desktop access?
- Why this is load bearing: The required `Secure` session cookie does not travel over ordinary LAN HTTP. The architecture also describes LAN HTTP as a degraded desktop fallback.
- Assumption: M3 follows the explicit authentication requirement and always sets `Secure` on the session cookie.
- What breaks if the assumption is wrong: Supporting authenticated administration over LAN HTTP would require a different transport or cookie policy and would weaken the current security boundary.
