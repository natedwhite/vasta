// OpenID Connect (OIDC) authentication for Vasta.
// Handles discovery, PKCE authorization code flow, user resolution, and account linking.
import { createHash, randomBytes } from 'node:crypto'
import type { User } from '@vasta/core'
import type { NodeStore } from '@vasta/core/node'
import { type Context, Hono, type MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { AccountService, Auth } from './accounts.ts'

export interface OidcOptions {
  issuer: string
  clientId: string
  clientSecret?: string
  displayName?: string
  autoSignup?: boolean
  webUrl?: string
  accounts: AccountService
  store: NodeStore
  setSessionCookie: (c: Context, secret: string, expiresAt: string) => void
  appAuth: MiddlewareHandler
  identify: (c: Context) => Auth | undefined
  now?: () => string
}

interface DiscoveryDoc {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint?: string
}

interface OidcRow {
  issuer: string
  sub: string
  user_id: string
  email?: string
  created_at: string
}

interface OidcStateCookie {
  state: string
  verifier: string
  linkUserId?: string
  next?: string
}

type Env = { Variables: { auth: Auth } }

const STATE_COOKIE = 'vasta_oidc'
let discoveryCache: { doc: DiscoveryDoc; expiresAt: number } | undefined

const isHttps = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https'

function getCallbackUrl(c: Context, configuredWebUrl?: string): string {
  const host = c.req.header('x-forwarded-host') || c.req.header('host')
  if (host) {
    const proto = c.req.header('x-forwarded-proto') || (isHttps(c) ? 'https' : 'http')
    return `${proto}://${host}/api/auth/oidc/callback`
  }
  if (configuredWebUrl) {
    return `${configuredWebUrl.replace(/\/+$/, '')}/api/auth/oidc/callback`
  }
  return 'http://127.0.0.1:5174/api/auth/oidc/callback'
}

async function getDiscovery(issuerUrl: string): Promise<DiscoveryDoc> {
  const now = Date.now()
  if (discoveryCache && discoveryCache.expiresAt > now) return discoveryCache.doc

  const url = `${issuerUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch OIDC discovery from ${url}: HTTP ${res.status}`)
  const doc = (await res.json()) as DiscoveryDoc
  discoveryCache = { doc, expiresAt: now + 3600_000 } // cache 1 hour
  return doc
}

function sanitizeUsername(input: string): string {
  const cleaned = input.normalize('NFKC').replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/_+/g, '_').slice(0, 38)
  return cleaned.length >= 2 ? cleaned : `u_${cleaned}`
}

export function createOidcRouter(options: OidcOptions): Hono<Env> {
  const router = new Hono<Env>()
  const { store, accounts, now = () => new Date().toISOString() } = options

  // Ensure database table exists in store.db
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS oidc_users (
      issuer TEXT NOT NULL,
      sub TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (issuer, sub)
    );
    CREATE INDEX IF NOT EXISTS oidc_users_user ON oidc_users(user_id);
  `)

  const findOidcUser = (issuer: string, sub: string): OidcRow | undefined => {
    return store.db.prepare('SELECT * FROM oidc_users WHERE issuer = ? AND sub = ?').get(issuer, sub) as OidcRow | undefined
  }

  const findUserOidc = (userId: string): OidcRow | undefined => {
    return store.db.prepare('SELECT * FROM oidc_users WHERE user_id = ?').get(userId) as OidcRow | undefined
  }

  const linkUser = (userId: string, issuer: string, sub: string, email?: string) => {
    store.db
      .prepare('INSERT OR REPLACE INTO oidc_users (issuer, sub, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(issuer, sub, userId, email ?? null, now())
  }

  const unlinkUser = (userId: string) => {
    store.db.prepare('DELETE FROM oidc_users WHERE user_id = ?').run(userId)
  }

  // Status & configuration info for login page and settings page
  router.get('/status', (c) => {
    const auth = options.identify(c)
    const oidcRecord = auth?.user ? findUserOidc(auth.user.id) : undefined

    return c.json({
      enabled: true,
      displayName: options.displayName || 'SSO',
      issuer: options.issuer,
      callbackUrl: getCallbackUrl(c, options.webUrl),
      autoSignup: options.autoSignup !== false,
      loginUrl: '/api/auth/oidc/login',
      linked: !!oidcRecord,
      identity: oidcRecord ? { sub: oidcRecord.sub, email: oidcRecord.email } : null,
    })
  })

  // Start OIDC Authorization Code Flow with PKCE
  router.get('/login', async (c) => {
    const discovery = await getDiscovery(options.issuer)
    const auth = options.identify(c)
    const isLink = c.req.query('link') === '1' || c.req.query('link') === 'true'

    const state = randomBytes(16).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')

    const nextPath = c.req.query('next') || (isLink ? '/settings#oidc' : '/')
    const cookieData: OidcStateCookie = {
      state,
      verifier,
      linkUserId: isLink && auth?.user ? auth.user.id : undefined,
      next: nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/',
    }

    setCookie(c, STATE_COOKIE, JSON.stringify(cookieData), {
      path: '/api/auth/oidc',
      httpOnly: true,
      sameSite: 'Lax',
      secure: isHttps(c),
      maxAge: 600, // 10 minutes
    })

    const callbackUrl = getCallbackUrl(c, options.webUrl)
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: callbackUrl,
      scope: 'openid profile email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })

    return c.redirect(`${discovery.authorization_endpoint}?${params.toString()}`)
  })

  // OIDC Callback from IdP
  router.get('/callback', async (c) => {
    const errorParam = c.req.query('error')
    if (errorParam) {
      const desc = c.req.query('error_description') || errorParam
      return c.redirect(`/?loginError=${encodeURIComponent(desc)}`)
    }

    const code = c.req.query('code')
    const state = c.req.query('state')
    const rawCookie = getCookie(c, STATE_COOKIE)
    deleteCookie(c, STATE_COOKIE, { path: '/api/auth/oidc' })

    if (!code || !state || !rawCookie) {
      return c.redirect(`/?loginError=${encodeURIComponent('Missing OIDC state or code')}`)
    }

    let cookieData: OidcStateCookie
    try {
      cookieData = JSON.parse(rawCookie)
    } catch {
      return c.redirect(`/?loginError=${encodeURIComponent('Invalid OIDC state cookie')}`)
    }

    if (cookieData.state !== state) {
      return c.redirect(`/?loginError=${encodeURIComponent('OIDC state verification failed')}`)
    }

    const discovery = await getDiscovery(options.issuer)
    const callbackUrl = getCallbackUrl(c, options.webUrl)

    // Token exchange
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: options.clientId,
      code_verifier: cookieData.verifier,
    })
    if (options.clientSecret) {
      tokenParams.set('client_secret', options.clientSecret)
    }

    const tokenRes = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: tokenParams.toString(),
    })

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '')
      console.error('OIDC token exchange failed:', tokenRes.status, errText)
      return c.redirect(`/?loginError=${encodeURIComponent('Token exchange failed')}`)
    }

    const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string }

    // Read claims from id_token payload
    let claims: Record<string, unknown> = {}
    if (tokens.id_token) {
      try {
        const payloadB64 = tokens.id_token.split('.')[1]
        if (payloadB64) claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
      } catch (e) {
        console.warn('Failed to parse ID token payload:', e)
      }
    }

    // Also fetch userinfo if available and token present
    if (discovery.userinfo_endpoint && tokens.access_token) {
      try {
        const userInfoRes = await fetch(discovery.userinfo_endpoint, {
          headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
        })
        if (userInfoRes.ok) {
          const info = (await userInfoRes.json()) as Record<string, unknown>
          claims = { ...claims, ...info }
        }
      } catch (e) {
        console.warn('Failed to fetch userinfo:', e)
      }
    }

    const sub = typeof claims.sub === 'string' ? claims.sub : undefined
    if (!sub) {
      return c.redirect(`/?loginError=${encodeURIComponent('No sub claim returned from IdP')}`)
    }

    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : undefined
    const preferredUsername =
      typeof claims.preferred_username === 'string'
        ? claims.preferred_username.trim()
        : typeof claims.nickname === 'string'
          ? claims.nickname.trim()
          : undefined
    const displayName =
      typeof claims.name === 'string'
        ? claims.name.trim()
        : typeof claims.display_name === 'string'
          ? claims.display_name.trim()
          : preferredUsername || (email ? email.split('@')[0] : 'User')

    // 1. Linking an existing logged-in account
    if (cookieData.linkUserId) {
      const targetUser = store.getUser(cookieData.linkUserId)
      if (targetUser) {
        linkUser(targetUser.id, discovery.issuer, sub, email)
        return c.redirect(cookieData.next || '/settings#oidc')
      }
    }

    // 2. Normal login: check existing OIDC link
    const existingLink = findOidcUser(discovery.issuer, sub)
    let user: User | undefined = existingLink ? store.getUser(existingLink.user_id) : undefined

    // 3. Fallback: match by username or email if not linked yet
    if (!user) {
      const candidateName = preferredUsername || (email ? email.split('@')[0] : '')
      if (candidateName) {
        user = store.findUserByUsername(candidateName)
      }
      if (!user && email) {
        user = store.listUsers().find((u) => u.username.toLowerCase() === email.toLowerCase())
      }
      if (user) {
        // Automatically link this existing user for future logins
        linkUser(user.id, discovery.issuer, sub, email)
      }
    }

    // 4. Auto-provision new user if allowed
    if (!user) {
      if (options.autoSignup === false) {
        return c.redirect(`/?loginError=${encodeURIComponent(`No Vasta account linked to ${email || preferredUsername || sub}. Ask an administrator for an invite.`)}`)
      }

      const fallback = (email ? email.split('@')[0] : '') || 'user'
      const baseUsername = sanitizeUsername(preferredUsername || fallback)
      let chosenUsername = baseUsername
      let counter = 1
      while (store.findUserByUsername(chosenUsername)) {
        counter++
        chosenUsername = `${baseUsername}${counter}`
      }

      try {
        user = await accounts.createUser({
          username: chosenUsername,
          name: displayName || chosenUsername,
          password: randomBytes(24).toString('base64url'),
        })
        linkUser(user.id, discovery.issuer, sub, email)
      } catch (err) {
        console.error('Failed to auto-create OIDC user:', err)
        return c.redirect(`/?loginError=${encodeURIComponent((err as Error).message)}`)
      }
    }

    // 5. Issue session cookie and redirect
    const { secret, expiresAt } = accounts.startSession(user.id, c.req.header('user-agent'))
    options.setSessionCookie(c, secret, expiresAt)
    return c.redirect(cookieData.next || '/')
  })

  // Account linking & unlinking API for authenticated users
  router.post('/unlink', options.appAuth, (c) => {
    const auth = c.get('auth') as Auth
    unlinkUser(auth.user.id)
    return c.json({ ok: true })
  })

  return router
}
