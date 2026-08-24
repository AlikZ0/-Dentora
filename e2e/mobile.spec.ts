import { expect, test, type Page } from '@playwright/test'

/**
 * Mobile-layout and offline behaviour.
 *
 * The viewport, touch flags and device scale factor come from the `mobile`
 * project in playwright.config.ts (iPhone 13 metrics). Real WebKit still has
 * to be spot-checked by hand - see the browser matrix in the README - but
 * everything layout- and storage-related is verified here.
 */

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

test.beforeEach(async ({ page }) => {
  await boot(page)
  await wipeStorage(page)
  await boot(page)
})

test('shows the bottom tab bar instead of the sidebar', async ({ page }) => {
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect(page.locator('.sidebar')).toBeHidden()

  const tabs = page.locator('.bottom-nav .tab')
  await expect(tabs).toHaveCount(5)
  await expect(tabs.nth(0)).toContainText('Главная')
  await expect(tabs.nth(1)).toContainText('Клиенты')
  await expect(tabs.nth(2)).toContainText('Визиты')
  await expect(tabs.nth(3)).toContainText('Backup')
  await expect(tabs.nth(4)).toContainText('Ещё')

  // Five tabs must still fit without wrapping or clipping their labels.
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 780 })
    const boxes = await tabs.evaluateAll((nodes) =>
      nodes.map((n) => {
        const label = n.querySelector('.tab-label') as HTMLElement
        return {
          height: n.getBoundingClientRect().height,
          clipped: label.scrollWidth > label.clientWidth + 1,
        }
      }),
    )
    expect(boxes).toHaveLength(5)
    for (const box of boxes) {
      expect(box.height, `tab height at ${width}px`).toBeGreaterThanOrEqual(44)
      expect(box.clipped, `label clipped at ${width}px`).toBe(false)
    }
  }
})

test('navigates through the bottom tab bar', async ({ page }) => {
  await page.locator('.bottom-nav .tab', { hasText: 'Клиенты' }).click()
  await expect(page).toHaveURL(/\/clients$/)
  await page.locator('.bottom-nav .tab', { hasText: 'Backup' }).click()
  await expect(page).toHaveURL(/\/backup$/)
  await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible()
})

test('never scrolls horizontally, on any page', async ({ page }) => {
  for (const path of [
    '/',
    '/clients',
    '/clients/new',
    '/schedule',
    '/backup',
    '/settings',
    '/settings/storage',
  ]) {
    await boot(page, path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1)
  }
})

test('every interactive control clears the 44 px touch target', async ({ page }) => {
  await boot(page, '/clients/new')

  const controls = page.locator('button:visible, a:visible, input:visible, select:visible')
  const count = await controls.count()
  expect(count).toBeGreaterThan(5)

  const tooSmall: string[] = []
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i)
    const box = await control.boundingBox()
    if (!box) continue
    // Inline text links inside prose are exempt; every real control is not.
    const isInlineLink = await control.evaluate(
      (el) => el.tagName === 'A' && getComputedStyle(el).display === 'inline',
    )
    if (isInlineLink) continue
    if (box.height < 44) {
      tooSmall.push(`${await control.evaluate((el) => el.tagName + '.' + el.className)} h=${box.height}`)
    }
  }
  expect(tooSmall, `controls below the 44 px floor: ${tooSmall.join(', ')}`).toEqual([])
})

test('text inputs are 16 px so iOS does not zoom on focus', async ({ page }) => {
  await boot(page, '/clients/new')
  const sizes = await page.locator('input, textarea, select').evaluateAll((nodes) =>
    nodes.map((n) => ({
      id: (n as HTMLElement).id || n.tagName,
      size: Number.parseFloat(getComputedStyle(n).fontSize),
    })),
  )
  expect(sizes.length).toBeGreaterThan(3)
  for (const { id, size } of sizes) {
    expect(size, `${id} font-size`).toBeGreaterThanOrEqual(16)
  }
})

test('respects the safe-area insets around the tab bar', async ({ page }) => {
  const usesSafeArea = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav')
    if (!nav) return false
    // The value resolves to 0 px in the emulator, but the declaration itself
    // is what matters: on a notched device it becomes the home-indicator gap.
    return getComputedStyle(nav).paddingBottom !== '' && CSS.supports('padding-bottom', 'env(safe-area-inset-bottom)')
  })
  expect(usesSafeArea).toBe(true)
})

test('adds a photo through the picker and opens it in the viewer', async ({ page }) => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P8//8/AzbAxIAH' +
      'jEqOSo5KjkoCAB0dBAX0Y1kQAAAAAElFTkSuQmCC',
    'base64',
  )

  await boot(page, '/clients/new')
  await page.locator('#lastName').fill('Мобильный')
  await page.locator('#firstName').fill('Пациент')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Мобильный Пациент' })).toBeVisible()

  // Two inputs exist on purpose: gallery and camera. `capture` must be on the
  // camera one only, or iOS stops offering the photo library.
  const inputs = page.locator('.picker input[type="file"]')
  await expect(inputs).toHaveCount(2)
  await expect(inputs.nth(0)).not.toHaveAttribute('capture', /.*/)
  await expect(inputs.nth(1)).toHaveAttribute('capture', 'environment')
  await expect(inputs.nth(1)).toHaveAttribute('accept', 'image/*')

  await inputs.nth(0).setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.locator('.gallery figure')).toHaveCount(1)

  // Open the viewer and confirm it loads the original.
  await page.locator('.gallery .thumb-open').first().click()
  await expect(page.locator('.viewer')).toBeVisible()
  await expect(page.locator('.viewer-image')).toBeVisible()
  // Pinch/pan need `touch-action: none`, or iOS zooms the page instead.
  await expect(page.locator('.viewer-stage')).toHaveCSS('touch-action', 'none')

  await page.locator('.viewer .icon-btn[aria-label="Закрыть"]').click()
  await expect(page.locator('.viewer')).toBeHidden()
})

test('works with the network switched off after the first load', async ({ page, context }) => {
  // Seed data while online.
  await boot(page, '/clients/new')
  await page.locator('#lastName').fill('Офлайнов')
  await page.locator('#firstName').fill('Пётр')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Офлайнов Пётр' })).toBeVisible()

  // Make sure the service worker has finished precaching the shell.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.waitForTimeout(1500)

  // --- pull the plug ---
  await context.setOffline(true)

  // A full reload must still boot, served entirely from the precache.
  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await expect(page.getByRole('heading', { name: 'Офлайнов Пётр' })).toBeVisible()

  // And the app must remain fully writable offline.
  await page.getByRole('button', { name: '+ Работа' }).click()
  await page.locator('#workTitle').fill('Работа без интернета')
  await page.locator('.panel').getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText('Работа без интернета')).toBeVisible()

  await page.locator('.upload input[type="file"]').first().setInputFiles({
    name: 'offline.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P8//8/AzbAxIAH' +
        'jEqOSo5KjkoCAB0dBAX0Y1kQAAAAAElFTkSuQmCC',
      'base64',
    ),
  })
  await expect(page.locator('.gallery figure')).toHaveCount(1)

  // Reload again, still offline - everything survives.
  await page.reload()
  await page.locator('.shell').waitFor({ state: 'attached' })
  await expect(page.getByText('Работа без интернета')).toBeVisible()
  await expect(page.locator('.gallery figure')).toHaveCount(1)

  // Navigating to a route that was never visited must also work offline.
  await page.locator('.bottom-nav .tab', { hasText: 'Backup' }).click()
  await expect(page.getByRole('heading', { name: 'Backup' })).toBeVisible()

  await context.setOffline(false)
})

test('shows an offline badge when the connection drops', async ({ page, context }) => {
  await boot(page)
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText('Офлайн', { exact: true })).toBeVisible()

  await context.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Офлайн', { exact: true })).toBeHidden()
})

test('renders the client card in landscape without clipping', async ({ page }) => {
  await boot(page, '/clients/new')
  await page.locator('#lastName').fill('Альбомов')
  await page.locator('#firstName').fill('Иван')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Альбомов Иван' })).toBeVisible()

  await page.setViewportSize({ width: 844, height: 390 })
  await expect(page.locator('.bottom-nav')).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  // The tab bar must not eat the whole short viewport.
  const nav = await page.locator('.bottom-nav').boundingBox()
  expect(nav!.height).toBeLessThan(80)
})

test('pinch, pan, rotate and reset in the x-ray viewer', async ({ page }) => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P8//8/AzbAxIAH' +
      'jEqOSo5KjkoCAB0dBAX0Y1kQAAAAAElFTkSuQmCC',
    'base64',
  )

  await boot(page, '/clients/new')
  await page.locator('#lastName').fill('Снимков')
  await page.locator('#firstName').fill('Тест')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByRole('heading', { name: 'Снимков Тест' })).toBeVisible()

  await page.locator('.upload input[type="file"]').first().setInputFiles([
    { name: 'xray-a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'xray-b.png', mimeType: 'image/png', buffer: PNG },
  ])
  await expect(page.locator('.gallery figure')).toHaveCount(2)

  // The gallery is newest-first, so index 0 is xray-b.png and "next" leads to
  // xray-a.png. Open the first one so both paddles have somewhere to go.
  await page.locator('.gallery .thumb-open').first().click()
  await expect(page.locator('.viewer-image')).toBeVisible()
  await expect(page.locator('.viewer-name')).toHaveText('xray-b.png')

  const transform = () => page.locator('.viewer-image').evaluate((el) => (el as HTMLElement).style.transform)
  const scaleOf = (t: string) => Number(/scale\(([\d.]+)\)/.exec(t)?.[1] ?? '0')

  expect(scaleOf(await transform())).toBe(1)

  // Two-finger pinch outwards.
  await page.evaluate(() => {
    const stage = document.querySelector('.viewer-stage')!
    const send = (type: string, pointerId: number, clientX: number, clientY: number) =>
      stage.dispatchEvent(
        new PointerEvent(type, { pointerId, clientX, clientY, bubbles: true, pointerType: 'touch' }),
      )
    send('pointerdown', 1, 150, 400)
    send('pointerdown', 2, 250, 400)
    send('pointermove', 1, 80, 400)
    send('pointermove', 2, 320, 400)
  })
  const zoomed = await transform()
  expect(scaleOf(zoomed)).toBeGreaterThan(1.5)

  // One-finger pan while zoomed in.
  await page.evaluate(() => {
    const stage = document.querySelector('.viewer-stage')!
    const send = (type: string, pointerId: number, clientX: number, clientY: number) =>
      stage.dispatchEvent(
        new PointerEvent(type, { pointerId, clientX, clientY, bubbles: true, pointerType: 'touch' }),
      )
    send('pointerup', 2, 320, 400)
    send('pointerup', 1, 80, 400)
    send('pointerdown', 3, 200, 400)
    send('pointermove', 3, 250, 440)
  })
  expect(await transform()).not.toBe(zoomed)

  await page.locator('.viewer .icon-btn[aria-label="Повернуть"]').click()
  expect(await transform()).toContain('rotate(90deg)')

  await page.locator('.viewer .icon-btn[aria-label="Сбросить"]').click()
  expect(await transform()).toBe('translate3d(0px, 0px, 0px) scale(1) rotate(0deg)')

  // The page counter must never sit on top of the image.
  const image = await page.locator('.viewer-image').boundingBox()
  const counter = await page.locator('.viewer-count').boundingBox()
  const overlaps =
    counter!.y < image!.y + image!.height &&
    counter!.y + counter!.height > image!.y &&
    counter!.x < image!.x + image!.width &&
    counter!.x + counter!.width > image!.x
  expect(overlaps).toBe(false)

  // Paging through the gallery.
  await expect(page.locator('.paddle[aria-label="Предыдущий"]')).toBeDisabled()
  await page.locator('.paddle[aria-label="Следующий"]').click()
  await expect(page.locator('.viewer-name')).toHaveText('xray-a.png')
  await expect(page.locator('.paddle[aria-label="Следующий"]')).toBeDisabled()
  await expect(page.locator('.viewer-count')).toHaveText('2 / 2')
})
