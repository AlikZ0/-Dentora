import { AppError } from '~/utils/errors'
import { logger } from '~/utils/logger'
import type { GoogleEventBody } from './events'

/**
 * Talks to Google straight from the browser: Google Identity Services for the
 * OAuth token, the Calendar REST API for events. There is no Dentora server,
 * so the token never leaves this device and lives only for its ~1 hour.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const API = 'https://www.googleapis.com/calendar/v3'
const SCOPES = 'https://www.googleapis.com/auth/calendar.events email'
const TOKEN_KEY = 'dentora.google.token'

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void
}

interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    login_hint?: string
    callback: (response: TokenResponse) => void
    error_callback?: (error: { type?: string; message?: string }) => void
  }): TokenClient
  revoke(token: string, done?: () => void): void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOauth2 } }
  }
}

export class GoogleCalendarError extends AppError {
  readonly status?: number
  constructor(message: string, code = 'google_calendar', technical?: string, status?: number) {
    super(message, code, technical)
    this.name = 'GoogleCalendarError'
    this.status = status
  }
}

interface StoredToken {
  token: string
  expiresAt: number
  email: string
}

let current: StoredToken | null = null
let loader: Promise<GoogleOauth2> | null = null

function readStored(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    return raw ? (JSON.parse(raw) as StoredToken) : null
  } catch {
    return null
  }
}

function writeStored(value: StoredToken | null): void {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // Private mode: the token simply stays in memory.
  }
}

/** A token that is still good for at least another minute, if any. */
export function validToken(email: string): string | null {
  current ??= readStored()
  if (!current) return null
  if (current.email.toLowerCase() !== email.trim().toLowerCase()) return null
  if (current.expiresAt - 60_000 <= Date.now()) return null
  return current.token
}

export function isConnected(email: string): boolean {
  return validToken(email) !== null
}

function loadIdentityServices(): Promise<GoogleOauth2> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2)
  loader ??= new Promise<GoogleOauth2>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2
      if (oauth2) resolve(oauth2)
      else reject(new GoogleCalendarError('Не удалось загрузить вход Google.', 'google_gis'))
    }
    script.onerror = () => {
      loader = null
      reject(
        new GoogleCalendarError(
          'Нет связи с Google. Проверьте интернет и повторите.',
          'google_offline',
        ),
      )
    }
    document.head.appendChild(script)
  })
  return loader
}

interface Prepared {
  key: string
  client: TokenClient
}

let prepared: Prepared | null = null
let pending: { resolve: (r: TokenResponse) => void; reject: (e: Error) => void } | null = null

const preparedKey = (clientId: string, email: string) =>
  `${clientId.trim()}|${email.trim().toLowerCase()}`

function popupError(type?: string): GoogleCalendarError {
  if (type === 'popup_closed') {
    return new GoogleCalendarError('Окно входа Google было закрыто.', 'google_popup', type)
  }
  return new GoogleCalendarError(
    'Браузер заблокировал окно входа Google. Разрешите всплывающие окна для этого сайта ' +
      '(на iPhone: Настройки → Safari → «Блокировка всплывающих окон» выключить) и нажмите «Подключить» ещё раз.',
    'google_popup',
    type,
  )
}

/**
 * Loads Google's script and builds the token client ahead of time.
 *
 * Safari (and every browser on iOS) only lets a click open a popup if the
 * popup is opened synchronously inside that click. Loading a script or
 * writing IndexedDB first uses the gesture up, and the sign-in window is
 * silently blocked. So all the async work happens here, before the click.
 */
export async function prepareConnect(clientId: string, email: string): Promise<void> {
  if (!clientId.trim()) {
    throw new GoogleCalendarError('Укажите OAuth Client ID из Google Cloud Console.', 'google_no_client')
  }
  const key = preparedKey(clientId, email)
  if (prepared?.key === key) return
  const oauth2 = await loadIdentityServices()
  const client = oauth2.initTokenClient({
    client_id: clientId.trim(),
    scope: SCOPES,
    login_hint: email.trim(),
    callback: (response) => {
      pending?.resolve(response)
      pending = null
    },
    error_callback: (error) => {
      pending?.reject(popupError(error.type))
      pending = null
    },
  })
  prepared = { key, client }
}

export function isConnectPrepared(clientId: string, email: string): boolean {
  return prepared?.key === preparedKey(clientId, email)
}

/**
 * Opens the Google sign-in window. Call it straight from the click handler,
 * with nothing awaited before it, after `prepareConnect` has finished.
 */
export function connect(clientId: string, email: string): Promise<string> {
  if (!prepared || prepared.key !== preparedKey(clientId, email)) {
    return Promise.reject(
      new GoogleCalendarError('Вход Google ещё загружается. Подождите секунду и нажмите снова.', 'google_not_ready'),
    )
  }
  pending?.reject(popupError('popup_closed'))
  const response = new Promise<TokenResponse>((resolve, reject) => {
    pending = { resolve, reject }
  })
  // An empty prompt shows consent only the first time; afterwards Google
  // hands the token back with a popup that closes by itself.
  prepared.client.requestAccessToken({ prompt: '' })
  return response.then((r) => finishConnect(r, email))
}

async function finishConnect(response: TokenResponse, email: string): Promise<string> {
  if (!response.access_token) {
    throw new GoogleCalendarError(
      'Google не выдал доступ к календарю.',
      'google_denied',
      response.error ?? response.error_description,
    )
  }
  const actual = await accountEmail(response.access_token)
  if (actual && actual.toLowerCase() !== email.trim().toLowerCase()) {
    window.google?.accounts?.oauth2?.revoke(response.access_token)
    throw new GoogleCalendarError(
      `Вход выполнен в ${actual}, а в настройках указан ${email.trim()}. Исправьте адрес в поле «Gmail врача» или войдите в нужный аккаунт.`,
      'google_wrong_account',
    )
  }
  current = {
    token: response.access_token,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    email: email.trim(),
  }
  writeStored(current)
  logger.info('google', 'connected')
  return response.access_token
}

/** The Gmail the token actually belongs to; `null` if Google did not say. */
async function accountEmail(token: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return null
    const info = (await response.json()) as { email?: string }
    return typeof info.email === 'string' ? info.email : null
  } catch {
    return null
  }
}

export function disconnect(): void {
  const token = current?.token ?? readStored()?.token
  current = null
  writeStored(null)
  if (token) window.google?.accounts?.oauth2?.revoke(token)
}

async function request<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  let response: Response
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (error) {
    throw new GoogleCalendarError(
      'Нет связи с Google. Визит сохранён, в календарь он попадёт при следующей синхронизации.',
      'google_offline',
      (error as Error).message,
    )
  }

  if (response.status === 401) {
    current = null
    writeStored(null)
    throw new GoogleCalendarError(
      'Доступ к Google Календарю истёк. Подключите аккаунт заново.',
      'google_unauthorized',
      undefined,
      401,
    )
  }
  if (response.status === 403) {
    throw new GoogleCalendarError(
      'Google отказал в доступе к календарю. Проверьте, что вход выполнен в нужный Gmail.',
      'google_forbidden',
      await response.text().catch(() => ''),
      403,
    )
  }
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    throw new GoogleCalendarError(
      'Google Календарь ответил ошибкой. Попробуйте позже.',
      'google_http',
      `${response.status} ${await response.text().catch(() => '')}`.slice(0, 300),
      response.status,
    )
  }
  if (response.status === 204 || response.status === 404 || response.status === 410) {
    return undefined
  }
  return (await response.json()) as T
}

interface GoogleEvent {
  id: string
  status?: string
}

// The token is checked against the configured Gmail on connect, so the
// signed-in account's primary calendar *is* that Gmail's calendar.
const CALENDAR = '/calendars/primary'

/**
 * Creates or replaces the event. An id pointing at an event the doctor
 * deleted by hand in Google yields a fresh event instead of an error.
 */
export async function upsertEvent(
  token: string,
  body: GoogleEventBody,
  eventId: string | undefined,
  notifyAttendees: boolean,
): Promise<string> {
  const query = `?sendUpdates=${notifyAttendees ? 'all' : 'none'}`
  if (eventId) {
    const updated = await request<GoogleEvent>(
      token,
      'PUT',
      `${CALENDAR}/events/${encodeURIComponent(eventId)}${query}`,
      body,
    )
    if (updated && updated.status !== 'cancelled') return updated.id
  }
  const created = await request<GoogleEvent>(token, 'POST', `${CALENDAR}/events${query}`, body)
  if (!created) throw new GoogleCalendarError('Не удалось создать событие в Google Календаре.')
  return created.id
}

export async function deleteEvent(
  token: string,
  eventId: string,
  notifyAttendees: boolean,
): Promise<void> {
  await request(
    token,
    'DELETE',
    `${CALENDAR}/events/${encodeURIComponent(eventId)}?sendUpdates=${notifyAttendees ? 'all' : 'none'}`,
  )
}
