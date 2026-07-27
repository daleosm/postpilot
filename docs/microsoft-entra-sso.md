# Microsoft Entra SSO configuration

PostPilot keeps email/password sign-in as its default. Microsoft Entra SSO is
an opt-in addition that maps a verified Entra identity to an existing global
PostPilot user. It never creates organisation membership, person records, or
episode access merely because an Entra account exists.

Leave SSO disabled until each participating facility has configured its Entra
connection. When enabled, FastAPI validates the Entra API access token before
creating a PostPilot session.

## Entra app-registration contract

Use an Entra application registration with a **Single-page application**
platform. The browser uses authorization-code flow with PKCE and requests an
access token for FastAPI; it does not use implicit flow or resource-owner
password credentials.

Configure the following in Entra:

| Entra setting | Required value |
| --- | --- |
| Supported account type | The organisation’s intended directory scope; use a specific directory for a single-facility deployment. |
| SPA redirect URI | Each exact public sign-in URL, for example `https://postpilot.example.com/sign-in`; add `http://localhost:5000/sign-in` only for local development. |
| Post-logout redirect URI | Register the same exact PostPilot sign-in URL so an explicit Microsoft logout can safely return to the app. |
| Expose an API | Define a delegated scope such as `access_as_user`. |
| Delegated API permission | Grant the SPA access to that scope, for example `api://<api-app-client-id>/access_as_user`. |
| Browser scope request | The browser requests only the PostPilot delegated API scope. The signed access token must be configured to include the `email` claim. |
| Access-token email claim | Configure the signed `email` claim on **Access** tokens. PostPilot only links an existing user through an exact work-email match; it does not create accounts. |

The SPA and API may use the same Entra application registration for a simple
deployment, or separate registrations for a larger estate. In either case,
the FastAPI API audience and delegated scope must identify the API resource,
not merely the SPA client.

Do **not** create or configure an Azure client secret for this flow. A SPA
cannot keep one confidential, and browser PKCE plus FastAPI token validation
does not need one. The Entra application/client IDs, authority, audience,
scope, tenant IDs, and redirect URIs are configuration identifiers—not
secrets.

## Runtime values

Keep SSO disabled by default:

~~~dotenv
POSTPILOT_MICROSOFT_SSO_ENABLED=false
~~~

When SSO is enabled, configure FastAPI with:

| Variable | Example | Purpose |
| --- | --- | --- |
| `POSTPILOT_MICROSOFT_SSO_ENABLED` | `true` | Enables the completed SSO exchange only after validation is deployed. |
| `POSTPILOT_MICROSOFT_SSO_SPA_CLIENT_ID` | `<spa-client-id>` | Authorized SPA client ID FastAPI expects in the v2 access token `azp` claim. |
| `POSTPILOT_MICROSOFT_SSO_AUTHORITY` | `https://login.microsoftonline.com/<directory-tenant-id>` | Entra authority expected by the facility. |
| `POSTPILOT_MICROSOFT_SSO_API_AUDIENCE` | `<api-app-client-id>` | API audience FastAPI validates. Entra v2 tokens use the API client ID; the matching `api://` form is also accepted for a v1 resource URI. |
| `POSTPILOT_MICROSOFT_SSO_ALLOWED_TENANT_IDS` | `<tenant-guid>,<second-tenant-guid>` | Comma-separated Entra directory IDs that the backend may trust. |
| `POSTPILOT_MICROSOFT_SSO_REDIRECT_URIS` | `https://postpilot.example.com/sign-in` | Comma-separated exact redirect URIs allowed by the registration. |
| `POSTPILOT_MICROSOFT_SSO_REQUIRED_SCOPE` | `api://<api-app-client-id>/access_as_user` | Delegated scope required on the access token. |

The public browser build needs the matching MSAL values:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_POSTPILOT_MSAL_ENABLED` | Set to `true` only after the backend exchange is ready. |
| `NEXT_PUBLIC_POSTPILOT_MSAL_CLIENT_ID` | Entra SPA application (client) ID. |
| `NEXT_PUBLIC_POSTPILOT_MSAL_AUTHORITY` | Same authority used by the expected Entra registration. |
| `NEXT_PUBLIC_POSTPILOT_MSAL_API_SCOPE` | Same delegated API scope required by FastAPI. |
| `NEXT_PUBLIC_POSTPILOT_MSAL_REDIRECT_URI` | Exact registered `/sign-in` URI. |

`NEXT_PUBLIC_*` values are embedded into the Next.js browser bundle during
`pnpm build`. They are intentionally public, but changing them requires a new
frontend image/build; setting them only on an already-running Kubernetes Pod
will not change the browser bundle.

For the supplied AWS/EKS path, place FastAPI configuration in the existing
`postpilot/application` AWS Secrets Manager record only when SSO is being
enabled, and extend the Secrets Store mapping to expose those keys to the API
Pod. Keep the browser values in build/deployment configuration, not a secret.
Never put a client secret in GitHub variables, Kubernetes Secrets, or the
browser build for this PKCE flow.

## Tenant and account safety

The runtime tenant allow-list is a deployment-wide safety boundary. The
per-organisation `sso_connections` record is the facility-level configuration
boundary. On a first sign-in, PostPilot links an Entra identity only when the
verified token email has one case-normalized exact match in the global user
directory and that user belongs to an organisation with a matching enabled SSO
connection. It rejects missing email, multiple matches, unknown Entra tenants,
disabled connections, and users without a matching tenant membership. It never
creates a user, person, membership, or access grant.

After the first link, the immutable Entra issuer, tenant ID, object ID, and
subject resolve the account; the email is retained only as a verified snapshot.

## Recommended rollout

Email/password stays enabled throughout this rollout. Microsoft SSO is an
additional sign-in method, not a replacement for the existing opaque
PostPilot session or tenant-membership model.

1. **Prepare one post house.** Register the Entra SPA/API contract, deploy the
   backend tenant allow-list and validation settings, and rebuild the frontend
   with the matching public MSAL identifiers. Keep
   `POSTPILOT_MICROSOFT_SSO_ENABLED=false` until the configuration has been
   reviewed.
2. **Configure the facility boundary.** Create or configure that
   organisation's `sso_connections` record with its Entra directory tenant ID,
   optional work-email domains, and an initially disabled state. This is a
   per-post-house setting: enabling SSO for one organisation must not enable
   it for another.
3. **Prepare the people who may use SSO.** Create normal PostPilot users and
   their organisation memberships first. Once the review is complete, deploy
   the validated backend and matching browser build with both SSO runtime flags
   enabled. On the first Microsoft sign-in, PostPilot links the immutable
   Entra identity only when its verified work email exactly matches one
   existing user and that user has a membership in the enabled post house. A
   successful sign-in never creates a user, person, membership, role,
   capability, or episode assignment.
4. **Pilot with a small group.** Enable the organisation connection, test a
   linked user, an unknown email, a removed membership, and password fallback.
   Confirm that the active organisation is still resolved solely from live
   PostPilot memberships.
5. **Expand deliberately.** Enable further post houses one at a time after
   their own Entra directory and user records are ready. If a facility needs a
   rollback, disable its `sso_connections` record; password sign-in remains
   available and existing PostPilot sessions continue to follow the normal
   session lifecycle.

## Deliberately deferred enterprise features

This release provides authentication and safe first-login linking only. It
does **not** implement any of the following:

- SCIM user or group provisioning/deprovisioning;
- Entra group-to-PostPilot-role or capability mapping;
- automatic user creation or tenant membership grants;
- mandatory-SSO or password-login disablement;
- just-in-time roles, show access, or episode-team assignments.

These are separate enterprise lifecycle decisions. SCIM is the standard next
step when a customer needs its identity provider to create, update, and
deactivate application accounts; it should be designed around PostPilot's
tenant membership and role-policy model rather than bolted onto sign-in.
Microsoft describes SCIM as its user-and-group provisioning interface and
documents the required lifecycle endpoints in its [SCIM provisioning
guidance](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups).

## Sign-out behaviour

**PostPilot Sign out** revokes only the opaque PostPilot API session cookie. It
does not sign the browser out of Microsoft. The optional **Sign out of
Microsoft** control uses MSAL logout redirect to end the Entra browser session
and returns to the registered sign-in URL; it deliberately leaves the current
PostPilot session, active tenant, debug context, and show selection unchanged.
