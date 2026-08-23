<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Client } from '~/types/models'
import { clientRepository, type ClientDraft } from '~/database/repositories/clients'
import { useToasts } from '~/composables/useToasts'
import { fullName } from '~/utils/format'
import AppButton from '~/components/AppButton.vue'
import ClientForm from '~/components/ClientForm.vue'
import EmptyState from '~/components/EmptyState.vue'

const route = useRoute()
const toasts = useToasts()

const clientId = String(route.params.id)
const client = ref<Client | null>(null)
const loading = ref(true)
const saving = ref(false)

useHead(() => ({ title: client.value ? `${fullName(client.value)} — изменить` : 'Изменить клиента' }))

onMounted(async () => {
  try {
    client.value = (await clientRepository().getById(clientId)) ?? null
  } catch (error) {
    toasts.error(error, 'client.load')
  } finally {
    loading.value = false
  }
})

async function save(draft: ClientDraft): Promise<void> {
  saving.value = true
  try {
    await clientRepository().update(clientId, draft)
    toasts.success('Изменения сохранены')
    await navigateTo(`/clients/${clientId}`)
  } catch (error) {
    toasts.error(error, 'client.update')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="page page-narrow">
    <p v-if="loading" class="muted small">Загружаем…</p>

    <EmptyState v-else-if="!client" icon="&#129300;" title="Клиент не найден">
      <AppButton variant="primary" @click="navigateTo('/clients')">К списку клиентов</AppButton>
    </EmptyState>

    <template v-else>
      <header class="page-header">
        <div class="page-title">
          <NuxtLink :to="`/clients/${clientId}`" class="back-link">&lsaquo; Карточка клиента</NuxtLink>
          <h1>Изменить данные</h1>
        </div>
      </header>

      <div class="card">
        <ClientForm
          :client="client"
          :saving="saving"
          @submit="save"
          @cancel="navigateTo(`/clients/${clientId}`)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-narrow { max-width: 720px; }

</style>
