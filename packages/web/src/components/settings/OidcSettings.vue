<script setup lang="ts">
// Single Sign-On (OIDC) settings: provider status, callback URL, account linking and auto-provisioning.
import { onMounted, ref } from 'vue'
import { authApi, type OidcStatus } from '../../lib/api.ts'
import { confirmDialog } from '../../lib/overlays.ts'
import AppIcon from '../AppIcon.vue'
import SettingsSection from './SettingsSection.vue'
import { errorText, primary, secondary } from './styles.ts'

const status = ref<OidcStatus | null>(null)
const error = ref('')
const copied = ref(false)
const busy = ref(false)

async function load() {
  try {
    status.value = await authApi.oidcStatus()
  } catch (failure) {
    error.value = (failure as Error).message
  }
}
onMounted(load)

async function copyCallback() {
  if (!status.value?.callbackUrl) return
  try {
    await navigator.clipboard.writeText(status.value.callbackUrl)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    // Clipboard permission denied fallback
  }
}

async function unlink() {
  const ok = await confirmDialog({
    title: 'Unlink SSO Identity?',
    message: 'You will need your password to log in directly, or link your account again later.',
    confirmLabel: 'Unlink',
    danger: true,
  })
  if (!ok) return

  busy.value = true
  error.value = ''
  try {
    await authApi.oidcUnlink()
    await load()
  } catch (failure) {
    error.value = (failure as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <SettingsSection
    id="oidc"
    title="Single Sign-On"
    description="Authenticate and manage access with your OpenID Connect identity provider."
  >
    <template v-if="status">
      <!-- Status & Provider Overview -->
      <div class="rounded-xl border border-line bg-surface p-4 text-sm shadow-xs">
        <div class="flex items-center justify-between pb-3 border-b border-line">
          <div class="flex items-center gap-2">
            <AppIcon fallback="ph:shield-check" :size="20" class="text-ink" />
            <span class="font-semibold text-ink">{{ status.displayName }}</span>
          </div>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            Connected
          </span>
        </div>

        <div class="mt-3 space-y-2.5 text-xs">
          <div v-if="status.issuer" class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
            <span class="text-ink-soft font-medium">Issuer:</span>
            <code class="text-ink truncate font-mono">{{ status.issuer }}</code>
          </div>

          <div v-if="status.callbackUrl" class="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pt-1">
            <span class="text-ink-soft font-medium">Redirect URI:</span>
            <div class="flex items-center gap-2">
              <code class="text-ink font-mono select-all truncate max-w-xs">{{ status.callbackUrl }}</code>
              <button
                type="button"
                :class="secondary"
                class="!py-0.5 !px-2 text-xs shrink-0 flex items-center gap-1"
                @click="copyCallback"
              >
                <AppIcon :fallback="copied ? 'ph:check' : 'ph:copy'" :size="14" />
                {{ copied ? 'Copied' : 'Copy' }}
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between gap-1 pt-1">
            <span class="text-ink-soft font-medium">Auto-Signup:</span>
            <span class="text-ink">{{ status.autoSignup ? 'Enabled (automatic account creation)' : 'Disabled (invite-only)' }}</span>
          </div>
        </div>
      </div>

      <!-- User Account Linking -->
      <div class="mt-4 rounded-xl border border-line bg-surface p-4 text-sm shadow-xs">
        <h4 class="font-medium text-ink mb-1">Your Account Link</h4>
        <p class="text-xs text-ink-soft mb-3">
          Link your Vasta login with {{ status.displayName }} to sign in with one click without entering a password.
        </p>

        <div v-if="status.linked" class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div class="flex items-center gap-2">
            <AppIcon fallback="ph:check-circle-fill" class="text-emerald-600 dark:text-emerald-400" :size="18" />
            <span class="text-ink">
              Linked as <strong class="font-semibold">{{ status.identity?.email || status.identity?.sub }}</strong>
            </span>
          </div>
          <button :class="secondary" :disabled="busy" class="!text-red-600 dark:!text-red-400 hover:!bg-red-500/10" @click="unlink">
            {{ busy ? 'Unlinking…' : 'Unlink account' }}
          </button>
        </div>

        <div v-else class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <span class="text-ink-soft">Your account is not linked to {{ status.displayName }}.</span>
          <a :href="`/api/auth/oidc/login?link=1`" :class="primary" class="inline-flex items-center gap-1.5">
            <AppIcon fallback="ph:link" :size="16" />
            Link with {{ status.displayName }}
          </a>
        </div>
      </div>
    </template>

    <div v-else-if="!error" class="text-sm text-ink-soft py-2">
      Checking single sign-on status…
    </div>

    <p v-if="error" :class="errorText" class="mt-2">{{ error }}</p>
  </SettingsSection>
</template>
