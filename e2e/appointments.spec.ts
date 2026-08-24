import { expect, test, type Page } from '@playwright/test'

/**
 * Visit scheduling and reminders, plus the modal-stacking fixes.
 *
 * `showNotification` is intercepted so the assertions can check what would
 * have been delivered; permission itself is granted through the browser
 * context, so the real permission path still runs.
 */

test.use({ permissions: ['notifications'] })

async function boot(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await page.locator('.shell').waitFor({ state: 'attached' })
}

async function wipeStorage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.()
    for (const { name } of dbs ?? []) {
      if (name) {
        await new Promise((r) => {
          const q = indexedDB.deleteDatabase(name)
          q.onsuccess = r
          q.onerror = r
          q.onblocked = r
        })
      }
    }
  })
}

/** Records notifications instead of showing them. */
async function captureNotifications(page: Page): Promise<void> {
  await page.addInitScript(() => {
    ;(window as unknown as { __notes: unknown[] }).__notes = []
    ServiceWorkerRegistration.prototype.showNotification = function (
      title: string,
      options?: NotificationOptions,
    ) {
      ;(window as unknown as { __notes: unknown[] }).__notes.push({
        title,
        body: options?.body,
        tag: options?.tag,
      })
      return Promise.resolve()
    }
  })
}

function notes(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __notes: { title: string; body: string; tag: string }[] }).__notes,
  )
}

/** A local `<input type=date>` / `<input type=time>` pair `minutes` from now. */
function fieldsFor(page: Page, minutes: number) {
  return page.evaluate((offset) => {
    const d = new Date(Date.now() + offset * 60_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    }
  }, minutes)
}

async function addClient(page: Page, lastName: string, firstName = 'Пациент'): Promise<void> {
  await boot(page, '/clients/new')
  await page.locator('#lastName').fill(lastName)
  await page.locator('#firstName').fill(firstName)
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: `${lastName} ${firstName}` })).toBeVisible()
}

async function enableNotifications(page: Page): Promise<void> {
  await boot(page, '/settings')
  await page.locator('.toggle', { hasText: 'Напоминать о визитах' }).locator('input').check()
  await expect(page.locator('.status-ok')).toContainText('Уведомления разрешены')
}

test.beforeEach(async ({ page }) => {
  await captureNotifications(page)
  await boot(page)
  await wipeStorage(page)
  await boot(page)
})

test('books a visit for tomorrow and shows it everywhere', async ({ page }) => {
  await addClient(page, 'Завтрашний')

  await expect(page.getByText('Визитов пока нет')).toBeVisible()
  await page.getByRole('button', { name: '+ Визит' }).click()

  // New visits default to tomorrow, which is the common case.
  const tomorrow = await fieldsFor(page, 24 * 60)
  await expect(page.locator('#visitDay')).toHaveValue(tomorrow.day)

  await page.locator('#visitTime').fill('10:30')
  await page.locator('#visitTitle').fill('Осмотр после лечения')
  await page.locator('#visitRemind').selectOption('60')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()

  // On the client card.
  await expect(page.locator('.visits .visit')).toHaveCount(1)
  await expect(page.locator('.visit .time')).toHaveText('10:30')

  // On the schedule, grouped under "Завтра".
  await boot(page, '/schedule')
  await expect(page.locator('.day-title').first()).toContainText('Завтра')
  await expect(page.locator('.visit .who')).toHaveText('Завтрашний Пациент')

  // And on the dashboard.
  await boot(page, '/')
  await expect(page.locator('.agenda-day')).toHaveText(['Завтра'])
  await expect(
    page.locator('.stat', { hasText: 'Визитов сегодня' }).locator('.stat-value'),
  ).toHaveText('0')
})

test('the settings toggle turns reminders on and off', async ({ page }) => {
  await addClient(page, 'Настроечный')

  // Off by default: nothing is silently enabled behind the user's back.
  await boot(page, '/settings')
  const toggle = page.locator('.toggle', { hasText: 'Напоминать о визитах' }).locator('input')
  await expect(toggle).not.toBeChecked()
  await expect(page.locator('#leadTime')).toBeHidden()

  await toggle.check()
  await expect(page.locator('.toast-message', { hasText: 'включены' })).toBeVisible()
  await expect(page.locator('#leadTime')).toBeVisible()
  await expect(page.locator('.status-ok')).toBeVisible()

  // The choice survives a reload.
  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await expect(page.locator('.toggle', { hasText: 'Напоминать о визитах' }).locator('input')).toBeChecked()

  // Turning it back off hides the sub-settings again.
  await page.locator('.toggle', { hasText: 'Напоминать о визитах' }).locator('input').uncheck()
  await expect(page.locator('.toast-message', { hasText: 'выключены' })).toBeVisible()
  await expect(page.locator('#leadTime')).toBeHidden()
})

test('warns that reminders are off while notifications are disabled', async ({ page }) => {
  await addClient(page, 'Предупреждённый')
  await page.getByRole('button', { name: '+ Визит' }).click()
  // The form says plainly that the visit will be saved but no reminder arrives.
  await expect(page.locator('.hint-warn')).toContainText('Уведомления сейчас выключены')
  await page.locator('.panel').getByRole('button', { name: 'Отмена' }).click()

  await boot(page, '/schedule')
  await expect(page.locator('.notice')).toContainText('выключены')
})

test('delivers a due reminder exactly once', async ({ page }) => {
  await addClient(page, 'Напоминаев')
  await enableNotifications(page)

  await boot(page, '/schedule')
  await page.getByRole('button', { name: '+ Визит' }).click()
  // 20 minutes out with an hour of lead time, so the reminder is already due.
  const soon = await fieldsFor(page, 20)
  await page.locator('#visitDay').fill(soon.day)
  await page.locator('#visitTime').fill(soon.time)
  await page.locator('#visitTitle').fill('Лечение кариеса')
  await page.locator('#visitRemind').selectOption('60')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.visit')).toHaveCount(1)

  // The loop runs its first check on startup.
  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await expect
    .poll(async () => (await notes(page)).filter((n) => n.tag?.startsWith('appointment-')).length)
    .toBe(1)

  const [reminder] = (await notes(page)).filter((n) => n.tag?.startsWith('appointment-'))
  expect(reminder!.title).toContain('Напоминаев Пациент')
  expect(reminder!.body).toContain('Лечение кариеса')

  // A second run must not repeat it.
  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await page.waitForTimeout(1500)
  expect((await notes(page)).filter((n) => n.tag?.startsWith('appointment-'))).toHaveLength(0)
})

test('does not remind about a visit that is still far away', async ({ page }) => {
  await addClient(page, 'Далёкий')
  await enableNotifications(page)

  await boot(page, '/schedule')
  await page.getByRole('button', { name: '+ Визит' }).click()
  const later = await fieldsFor(page, 24 * 60)
  await page.locator('#visitDay').fill(later.day)
  await page.locator('#visitTime').fill(later.time)
  await page.locator('#visitRemind').selectOption('15')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.visit')).toHaveCount(1)

  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await page.waitForTimeout(1500)
  expect((await notes(page)).filter((n) => n.tag?.startsWith('appointment-'))).toHaveLength(0)
})

test('completes and deletes a visit', async ({ page }) => {
  await addClient(page, 'Завершаев')
  await page.getByRole('button', { name: '+ Визит' }).click()
  await page.locator('#visitTitle').fill('Профгигиена')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.visits .visit')).toHaveCount(1)

  // Mark it as done: it moves out of the upcoming list into the history.
  await page.locator('.visit .act[aria-label="Отметить как состоявшийся"]').click()
  await expect(page.locator('.history summary')).toContainText('История визитов (1)')

  await page.locator('.history').click()
  await page.locator('.history .visit .act[aria-label="Удалить визит"]').click()
  await expect(page.getByText('Удалить визит?')).toBeVisible()
  await page.locator('.panel-footer').getByRole('button', { name: 'Удалить' }).click()
  await expect(page.locator('.toast-message', { hasText: 'Визит удалён' })).toBeVisible()
  await expect(page.getByText('Визитов пока нет')).toBeVisible()
})

test('visits survive export and import', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker')
  })
  await boot(page)

  await addClient(page, 'Переносов')
  await page.getByRole('button', { name: '+ Визит' }).click()
  await page.locator('#visitTime').fill('09:45')
  await page.locator('#visitTitle').fill('Контрольный приём')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.locator('.visits .visit')).toHaveCount(1)

  await boot(page, '/backup')
  await page.getByRole('button', { name: 'Экспортировать данные' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.panel').getByRole('button', { name: 'Экспортировать' }).click()
  const download = await downloadPromise
  const { readFileSync } = await import('node:fs')
  const archive = readFileSync((await download.path())!)

  await wipeStorage(page)
  await boot(page, '/backup')
  await page.locator('input[type="file"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: archive,
  })
  await expect(page.getByText('Backup создан')).toBeVisible()
  await page.locator('.mode-danger').click()
  await page.locator('.panel-footer').getByRole('button', { name: 'Заменить' }).click()
  await expect(page.locator('.toast-message', { hasText: 'База заменена' })).toBeVisible()

  await boot(page, '/schedule')
  await expect(page.locator('.visit .who')).toHaveText('Переносов Пациент')
  await expect(page.locator('.visit .time')).toHaveText('09:45')
})

test('a stray tap beside a destructive confirmation does not abandon it', async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker')
  })
  await boot(page)
  await addClient(page, 'Модальный')

  await boot(page, '/backup')
  await page.getByRole('button', { name: 'Экспортировать данные' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('.panel').getByRole('button', { name: 'Экспортировать' }).click()
  const { readFileSync } = await import('node:fs')
  const archive = readFileSync((await (await downloadPromise).path())!)

  await boot(page, '/backup')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'backup.zip',
    mimeType: 'application/zip',
    buffer: archive,
  })
  await expect(page.getByText('Backup создан')).toBeVisible()
  await page.locator('.mode-danger').click()
  await expect(page.getByText('Заменить текущие данные?')).toBeVisible()

  // Two dialogs are open; the confirmation must paint above the sheet.
  const layers = await page.locator('.backdrop').evaluateAll((nodes) =>
    nodes.map((n) => Number((n as HTMLElement).style.zIndex)),
  )
  expect(layers).toHaveLength(2)
  expect(layers[1]).toBeGreaterThan(layers[0]!)

  // Tapping the dim area used to silently cancel the whole action.
  await page.mouse.click(30, 60)
  await page.waitForTimeout(400)
  await expect(page.getByText('Заменить текущие данные?')).toBeVisible()

  // Escape closes only the topmost dialog, and the sheet stays scroll-locked.
  await page.keyboard.press('Escape')
  await expect(page.getByText('Заменить текущие данные?')).toBeHidden()
  await expect(page.getByText('Backup создан')).toBeVisible()
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  // Going through with it closes both and restores scrolling.
  await page.locator('.mode-danger').click()
  await page.locator('.panel-footer').getByRole('button', { name: 'Заменить' }).click()
  await expect(page.locator('.toast-message', { hasText: 'База заменена' })).toBeVisible()
  await expect(page.locator('.panel')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('')
})
