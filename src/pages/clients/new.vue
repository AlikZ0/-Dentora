<script setup lang="ts">
import { ref } from 'vue'
import { clientRepository, type ClientDraft } from '~/database/repositories/clients'
import { useToasts } from '~/composables/useToasts'
import { useAppStore } from '~/stores/app'
import ClientForm from '~/components/ClientForm.vue'

useHead({ title: 'Новый клиент — Dentora' })

const toasts = useToasts()
const app = useAppStore()
const saving = ref(false)

async function save(draft: ClientDraft): Promise<void> {
  saving.value = true
  try {
    const client = await clientRepository().create(draft)
    await app.refreshCounts()
    toasts.success('Клиент добавлен')
    await navigateTo(`/clients/${client.id}`)
  } catch (error) {
    toasts.error(error, 'clients.create')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page page-narrow">
    <header class="page-header">
      <div class="page-title">
        <NuxtLink to="/clients" class="back-link">&lsaquo; Клиенты</NuxtLink>
        <h1>Новый клиент</h1>
      </div>
    </header>

    <div class="card">
      <ClientForm :saving="saving" @submit="save" @cancel="navigateTo('/clients')" />
    </div>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }

</style>
