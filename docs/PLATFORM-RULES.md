# Product rules that are not negotiable

- SawaLearn is a separate product. Never overwrite or merge the University of Juba portal without explicit authorization.
- A platform operator manually approves institution onboarding and the first institution administrator.
- Institutional administrator invitation tokens must be random, single-use, hashed at rest, time-limited and auditable.
- Payments are physical cash, recorded and confirmed by an authorized platform operator. Never activate an account based on an unconfirmed receipt.
- Notify institution administrators seven days before subscription expiry.
- Preserve service during the seven-day grace period. At the end, alert the platform owner for a manual extension or termination decision; never auto-terminate.
- No data deletion on expiry. A terminated institution's data remains retained under the agreed retention/export policy.
- Late renewals are anchored to the original expiry date unless the platform owner explicitly records an extension; grace days are not free subscription days.
- Capacity alerts at 80%, 90%, and 100%. Existing users and content remain accessible. At capacity, block only new activations or uploads that exceed the allowance.
- Deactivation/archive frees active-user capacity but preserves grades, transcripts, attendance, audit history and other academic records.
- Tenant authorization must be enforced in server code and database RLS. Hiding navigation is not authorization.
- Plan entitlements must be checked centrally on the server; never scatter plan conditions across the UI.
- Every owner approval, receipt confirmation, extension, termination, role change and capacity exception must create an immutable audit event.
