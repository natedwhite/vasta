import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createBuiltinTypes } from '@vasta/core'
import { NodeMediaStore } from '@vasta/core/media-node'
import { NodeStore } from '@vasta/core/node'
import { AccountService } from '../src/accounts.ts'
import { createApp } from '../src/app.ts'
import { CaptureService } from '../src/capture.ts'
import { ChangeFeed, DesktopListeners } from '../src/events.ts'

const start = '2026-10-18T12:00:00.000Z'

function setup() {
  process.env.OIDC_ISSUER = 'https://auth.example.com'
  process.env.OIDC_CLIENT_ID = 'vasta-test'
  process.env.OIDC_CLIENT_SECRET = 'vst_testsecret123'
  process.env.OIDC_DISPLAY_NAME = 'Test SSO'
  process.env.OIDC_AUTO_SIGNUP = 'true'

  const store = new NodeStore(':memory:')
  store.putSpace({ id: 's1', name: 'Main Space', sidebar: [], createdAt: start })
  for (const type of createBuiltinTypes('s1', start)) store.putType(type)
  const media = new NodeMediaStore(mkdtempSync(path.join(tmpdir(), 'vasta-oidc-')))
  const clock = { at: start }
  const now = () => clock.at
  const feed = new ChangeFeed()
  const capture = new CaptureService({ store, media, feed, now, timeZone: 'UTC' })
  const accounts = new AccountService({ store, now, capture })
  const desktop = new DesktopListeners()
  const app = createApp({ store, media, feed, capture, accounts, now, desktop, webUrl: 'https://vasta.example.com' })
  return { store, accounts, app }
}

describe('OIDC authentication', () => {
  it('reports SSO status and configuration', async () => {
    const { app } = setup()

    const res = await app.request('/api/auth/oidc/status')
    expect(res.status).toBe(200)
    const json = (await res.json()) as { enabled: boolean; displayName: string; issuer: string; callbackUrl: string }
    expect(json.enabled).toBe(true)
    expect(json.displayName).toBe('Test SSO')
    expect(json.issuer).toBe('https://auth.example.com')
    expect(json.callbackUrl).toBe('https://vasta.example.com/api/auth/oidc/callback')
  })

  it('redirects to the IdP authorization endpoint with PKCE and state cookie', async () => {
    const { app } = setup()

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            userinfo_endpoint: 'https://auth.example.com/userinfo',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('Not found', { status: 404 })
    })

    const res = await app.request('/api/auth/oidc/login', {
      headers: { host: 'vasta.example.com' },
    })

    expect(res.status).toBe(302)
    const location = res.headers.get('location') || ''
    expect(location).toContain('https://auth.example.com/authorize?')
    expect(location).toContain('client_id=vasta-test')
    expect(location).toContain('code_challenge_method=S256')
    expect(location).toContain('code_challenge=')
    expect(location).toContain('state=')

    const setCookie = res.headers.get('set-cookie') || ''
    expect(setCookie).toContain('vasta_oidc=')

    fetchMock.mockRestore()
  })

  it('handles callback, auto-provisions user, and sets session cookie', async () => {
    const { app, store } = setup()

    // 1. Initiate login to get state & verifier in cookie
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('.well-known/openid-configuration')) {
        return new Response(
          JSON.stringify({
            issuer: 'https://auth.example.com',
            authorization_endpoint: 'https://auth.example.com/authorize',
            token_endpoint: 'https://auth.example.com/token',
            userinfo_endpoint: 'https://auth.example.com/userinfo',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      if (url.includes('https://auth.example.com/token')) {
        const idTokenPayload = Buffer.from(
          JSON.stringify({
            sub: 'pocketid-user-123',
            email: 'alice@example.com',
            preferred_username: 'alice',
            name: 'Alice Wonder',
          })
        ).toString('base64url')

        return new Response(
          JSON.stringify({
            access_token: 'fake-access-token',
            id_token: `header.${idTokenPayload}.signature`,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('Not found', { status: 404 })
    })

    const loginRes = await app.request('/api/auth/oidc/login', {
      headers: { host: 'vasta.example.com' },
    })
    const cookieHeader = loginRes.headers.get('set-cookie') || ''
    const cookieVal = cookieHeader.split(';')[0]!
    const location = new URL(loginRes.headers.get('location')!)
    const state = location.searchParams.get('state')!

    // 2. Simulate IdP callback redirect with code & state
    const callbackRes = await app.request(`/api/auth/oidc/callback?code=fake_auth_code&state=${state}`, {
      headers: {
        host: 'vasta.example.com',
        cookie: cookieVal,
      },
    })

    expect(callbackRes.status).toBe(302)
    expect(callbackRes.headers.get('location')).toBe('/')
    const cookies = callbackRes.headers.getSetCookie()
    const sessionCookie = cookies.find((c) => c.startsWith('vasta_session='))
    expect(sessionCookie).toBeDefined()

    // 3. User was auto-created in store
    const user = store.findUserByUsername('alice')
    expect(user).toBeDefined()
    expect(user?.name).toBe('Alice Wonder')

    // 4. Verification that status endpoint recognizes user is linked
    const statusRes = await app.request('/api/auth/oidc/status', {
      headers: {
        host: 'vasta.example.com',
        cookie: sessionCookie!.split(';')[0]!,
      },
    })
    const statusJson = (await statusRes.json()) as { linked: boolean; identity: { sub: string; email: string } }
    expect(statusJson.linked).toBe(true)
    expect(statusJson.identity.sub).toBe('pocketid-user-123')
    expect(statusJson.identity.email).toBe('alice@example.com')

    fetchMock.mockRestore()
  })
})
