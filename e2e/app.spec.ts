import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * End-to-end coverage of the scenario the spec calls out:
 * create -> attach an x-ray -> export -> wipe -> import -> everything back.
 *
 * These run against the generated static build, so IndexedDB, the service
 * worker, Blob handling and the file picker are all the real thing.
 */

const XRAY_PNG = Buffer.from(
  // 4x4 grey PNG - small, but a genuine decodable image so thumbnails run.
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P8//8/AzbAxIAH' +
    'jEqOSo5KjkoCAB0dBAX0Y1kQAAAAAElFTkSuQmCC',
  'base64',
)

/**
 * `networkidle` never settles once the service worker is registered, so we
 * wait for the app shell to actually mount instead.
 */
async function gotoFresh(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await page.locator('.shell').waitFor({ state: 'attached' })
}

/**
 * Removes `showSaveFilePicker` so `saveBlob` falls through to the
 * `<a download>` path. Headless Chromium exposes the API but never resolves
 * the picker, and the download path is what Firefox, Safari and every mobile
 * browser actually use - so this is the branch worth asserting on here.
 * The picker branch has its own test below.
 */
async function useDownloadFallback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker')
  })
}

async function wipeStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const names = await indexedDB.databases?.()
    for (const { name } of names ?? []) {
      if (name) await new Promise((r) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = r; q.onerror = r; q.onblocked = r })
    }
  })
}

test.beforeEach(async ({ page }) => {
  await gotoFresh(page)
  await wipeStorage(page)
  await gotoFresh(page)
})

test('boots, shows the dashboard and reports an empty database', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible()
  await expect(page.locator('.stat', { hasText: 'Клиентов' }).locator('.stat-value')).toHaveText('0')
  await expect(page.getByText('Пока нет ни одной работы')).toBeVisible()
})

test('registers a service worker and a valid manifest', async ({ page }) => {
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false
    const reg = await navigator.serviceWorker.getRegistration()
    return Boolean(reg ?? (await navigator.serviceWorker.ready.catch(() => null)))
  })
  expect(registered).toBe(true)

  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()

  const manifest = await page.evaluate(async (url) => (await fetch(url!)).json(), href)
  expect(manifest.name).toContain('Dentora')
  expect(manifest.display).toBe('standalone')
  expect(manifest.start_url).toBeTruthy()
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true)
})

test('creates a client, a work and an x-ray, and keeps them across a reload', async ({ page }) => {
  // --- create the client ---
  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Петрова')
  await page.locator('#firstName').fill('Анна')
  await page.locator('#arrivalDate').fill('2026-08-01')
  await page.locator('#phone').fill('+79001112233')
  await page.locator('#notes').fill('Аллергия на лидокаин')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByRole('heading', { name: 'Петрова Анна' })).toBeVisible()
  await expect(page.getByText('Аллергия на лидокаин')).toBeVisible()

  // --- add a work ---
  await page.getByRole('button', { name: '+ Работа' }).click()
  await page.locator('#workTitle').fill('Лечение кариеса')
  await page.locator('#workDescription').fill('Зуб 36')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Лечение кариеса')).toBeVisible()

  // --- attach an x-ray ---
  await page.locator('.upload input[type="file"]').first().setInputFiles({
    name: 'xray-36.png',
    mimeType: 'image/png',
    buffer: XRAY_PNG,
  })
  await expect(page.locator('.gallery figure')).toHaveCount(1)
  // The name marks it as an x-ray, so it should be classified automatically.
  await expect(page.locator('.gallery .thumb-kind')).toHaveText('Рентген')

  // --- survive a full reload ---
  const url = page.url()
  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await expect(page).toHaveURL(url)
  await expect(page.getByRole('heading', { name: 'Петрова Анна' })).toBeVisible()
  await expect(page.getByText('Лечение кариеса')).toBeVisible()
  await expect(page.locator('.gallery figure')).toHaveCount(1)

  // --- and the dashboard counts them ---
  await page.goto('/')
  await expect(page.locator('.stat', { hasText: 'Клиентов' }).locator('.stat-value')).toHaveText('1')
  await expect(page.locator('.stat', { hasText: 'Работ' }).locator('.stat-value')).toHaveText('1')
  await expect(page.locator('.stat', { hasText: 'Файлов' }).locator('.stat-value')).toHaveText('1')
})

test('export -> wipe -> import restores clients, works and file bytes', async ({ page }) => {
  await useDownloadFallback(page)

  // Seed one client with a work and a file.
  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Смирнова')
  await page.locator('#firstName').fill('Мария')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Смирнова Мария' })).toBeVisible()

  await page.getByRole('button', { name: '+ Работа' }).click()
  await page.locator('#workTitle').fill('Профгигиена')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Профгигиена')).toBeVisible()

  await page.locator('.upload input[type="file"]').first().setInputFiles({
    name: 'xray-11.png',
    mimeType: 'image/png',
    buffer: XRAY_PNG,
  })
  await expect(page.locator('.gallery figure')).toHaveCount(1)

  // --- export ---
  await page.goto('/backup')
  await page.getByRole('button', { name: 'Экспортировать данные' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.panel').getByRole('button', { name: 'Экспортировать' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/)
  const archivePath = await download.path()
  const archive = readFileSync(archivePath!)
  expect(archive.length).toBeGreaterThan(300)

  await expect(page.locator('.toast-message', { hasText: /Backup готов/ })).toBeVisible()

  // --- wipe everything ---
  await wipeStorage(page)
  await gotoFresh(page, '/clients')
  await expect(page.getByText('Пока нет клиентов')).toBeVisible()

  // --- import it back ---
  await page.goto('/backup')
  await page.locator('input[type="file"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: archive,
  })

  // Preview must appear before anything is written.
  await expect(page.getByText('Backup создан')).toBeVisible()
  const preview = page.locator('.preview-grid')
  await expect(preview.locator('div', { hasText: 'Клиентов' }).locator('dd')).toHaveText('1')
  await expect(preview.locator('div', { hasText: 'Работ' }).locator('dd')).toHaveText('1')
  await expect(preview.locator('div', { hasText: 'Файлов' }).locator('dd')).toHaveText('1')

  await page.locator('.mode-danger').click()
  await page.locator('.panel-footer').getByRole('button', { name: 'Заменить' }).click()
  await expect(page.locator('.toast-message', { hasText: /База заменена/ })).toBeVisible()

  // --- verify everything came back, bytes included ---
  await page.goto('/clients')
  await page.getByText('Смирнова Мария').click()
  await expect(page.getByRole('heading', { name: 'Смирнова Мария' })).toBeVisible()
  await expect(page.getByText('Профгигиена')).toBeVisible()
  await expect(page.locator('.gallery figure')).toHaveCount(1)

  const restoredSize = await page.evaluate(async () => {
    const open = indexedDB.open('dentora')
    const db: IDBDatabase = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    })
    const blob: Blob = await new Promise((res, rej) => {
      const req = db.transaction('fileBlobs').objectStore('fileBlobs').getAll()
      req.onsuccess = () => res(req.result[0]?.blob)
      req.onerror = () => rej(req.error)
    })
    db.close()
    return blob?.size ?? 0
  })
  expect(restoredSize).toBe(XRAY_PNG.length)
})

test('merge does not duplicate when the same backup is imported twice', async ({ page }) => {
  await useDownloadFallback(page)
  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Иванов')
  await page.locator('#firstName').fill('Иван')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Иванов Иван' })).toBeVisible()

  await page.goto('/backup')
  await page.getByRole('button', { name: 'Экспортировать данные' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.panel').getByRole('button', { name: 'Экспортировать' }).click()
  const archive = readFileSync((await (await downloadPromise).path())!)

  for (let round = 0; round < 2; round++) {
    await page.goto('/backup')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'backup.zip',
      mimeType: 'application/zip',
      buffer: archive,
    })
    await expect(page.getByText('Backup создан')).toBeVisible()
    await page.locator('.mode:not(.mode-danger)').click()
    await expect(page.locator('.toast-message', { hasText: /Объединено/ })).toBeVisible()
  }

  await page.goto('/clients')
  await expect(page.locator('.list > li')).toHaveCount(1)
})

test('an encrypted backup requires the right password', async ({ page }) => {
  await useDownloadFallback(page)
  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Секретов')
  await page.locator('#firstName').fill('Пётр')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Секретов Пётр' })).toBeVisible()

  await page.goto('/backup')
  await page.getByRole('button', { name: 'Экспортировать данные' }).click()
  await page.getByText('Защитить паролем').click()
  await page.locator('#exportPassword').fill('очень-длинный-пароль')
  await page.locator('#exportPasswordRepeat').fill('очень-длинный-пароль')

  const downloadPromise = page.waitForEvent('download')
  await page.locator('.panel').getByRole('button', { name: 'Экспортировать' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.zip\.enc$/)
  const archive = readFileSync((await download.path())!)

  await wipeStorage(page)
  await gotoFresh(page, '/backup')
  await page.locator('input[type="file"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/octet-stream',
    buffer: archive,
  })

  // Wrong password first.
  await expect(page.getByText('Этот backup защищён паролем.')).toBeVisible()
  await page.locator('#importPassword').fill('не-тот-пароль')
  await page.getByRole('button', { name: 'Расшифровать' }).click()
  await expect(page.getByText('Неверный пароль или повреждённый backup.')).toBeVisible()

  // Then the right one.
  await page.locator('#importPassword').fill('очень-длинный-пароль')
  await page.getByRole('button', { name: 'Расшифровать' }).click()
  await expect(page.getByText('Backup создан')).toBeVisible()
  await page.locator('.mode-danger').click()
  await page.locator('.panel-footer').getByRole('button', { name: 'Заменить' }).click()
  await expect(page.locator('.toast-message', { hasText: /База заменена/ })).toBeVisible()

  await page.goto('/clients')
  await expect(page.getByText('Секретов Пётр')).toBeVisible()
})

test('rejects a file that is not one of our backups', async ({ page }) => {
  await page.goto('/backup')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'holiday.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('this is definitely not a backup archive'),
  })
  // A plain-language error, never a DOMException name.
  await expect(page.locator('.toast-error')).toBeVisible()
  const message = await page.locator('.toast-error .toast-message').textContent()
  expect(message).not.toMatch(/DOMException|QuotaExceeded|DataClone|Error:/)
  expect(message).toMatch(/архив|backup/i)
})

test('deleting a client asks for confirmation and can be undone', async ({ page }) => {
  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Удаляев')
  await page.locator('#firstName').fill('Тест')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Удаляев Тест' })).toBeVisible()

  await page.getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Удалить клиента?')).toBeVisible()
  await expect(page.getByText(/Вместе с ним скроются работы/)).toBeVisible()

  await page.locator('.panel').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.getByText('Клиент перемещён в корзину')).toBeVisible()
  await expect(page.getByText('Пока нет клиентов')).toBeVisible()

  // Restorable from the trash.
  await page.goto('/settings/trash')
  await expect(page.getByText('Удаляев Тест')).toBeVisible()
  await page.getByRole('button', { name: 'Восстановить' }).click()
  await expect(page.getByText('Клиент восстановлен')).toBeVisible()
  await page.goto('/clients')
  await expect(page.getByText('Удаляев Тест')).toBeVisible()
})

test('clearing the cache does not touch user data', async ({ page }) => {
  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Кэшев')
  await page.locator('#firstName').fill('Иван')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Кэшев Иван' })).toBeVisible()

  await page.goto('/settings/storage')
  await page.getByRole('button', { name: 'Очистить' }).click()
  await page.locator('.panel').getByRole('button', { name: 'Очистить кэш' }).click()
  await expect(page.locator('.toast-success')).toBeVisible()

  await page.goto('/clients')
  await expect(page.getByText('Кэшев Иван')).toBeVisible()
})

test('uses the File System Access API to stream the backup when available', async ({ page }) => {
  // Chrome and Edge on the desktop write straight to the chosen file, so a
  // multi-gigabyte backup never has to be held as a Blob. Stub the picker and
  // assert we really pipe into the writable it hands back.
  await page.addInitScript(() => {
    Object.assign(window, {
      __picked: null as null | { name: string; bytes: number },
      showSaveFilePicker: async (options: { suggestedName?: string }) => ({
        // The real `createWritable()` returns a FileSystemWritableFileStream,
        // which is a WritableStream - `blob.stream().pipeTo()` needs that, not
        // a duck-typed object.
        createWritable: async () => {
          let bytes = 0
          return new WritableStream<Uint8Array>({
            write(chunk) {
              bytes += chunk.length
            },
            close() {
              Object.assign(window, {
                __picked: { name: options.suggestedName, bytes },
              })
            },
          })
        },
      }),
    })
  })

  await page.goto('/clients/new')
  await page.locator('#lastName').fill('Потоков')
  await page.locator('#firstName').fill('Пётр')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Потоков Пётр' })).toBeVisible()

  await page.goto('/backup')
  await page.getByRole('button', { name: 'Экспортировать данные' }).click()
  await page.locator('.panel').getByRole('button', { name: 'Экспортировать' }).click()
  await expect(page.locator('.toast-message', { hasText: /Backup готов/ })).toBeVisible()

  const picked = await page.evaluate(() => (window as unknown as {
    __picked: { name: string; bytes: number } | null
  }).__picked)

  expect(picked).not.toBeNull()
  expect(picked!.name).toMatch(/^backup_.*\.zip$/)
  expect(picked!.bytes).toBeGreaterThan(300)
})
