<script lang="ts" setup>
import type { ExtensionStatus } from '../../../shared/types';

defineProps<{
  status: ExtensionStatus;
  error: string | null;
  stepCount: number;
  currentStepIndex: number | null;
}>();
</script>

<template>
  <div class="status" :data-status="status">
    <div class="row">
      <span class="label">Status:</span>
      <strong>{{ status }}</strong>
      <span class="meta">{{ stepCount }} step{{ stepCount === 1 ? '' : 's' }}</span>
      <span v-if="currentStepIndex != null" class="meta">
        Playing step {{ currentStepIndex + 1 }}
      </span>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.status {
  border: 1px solid var(--border);
  background: #fafbfc;
  border-radius: 8px;
  padding: 0.45rem 0.6rem;
  font-size: 0.8rem;
}

.status[data-status='Recording'] {
  border-color: #fdb022;
  background: #fffaeb;
}

.status[data-status='Playing'] {
  border-color: #6ce9a6;
  background: var(--active-bg);
}

.status[data-status='Failed'] {
  border-color: #fda29b;
  background: var(--failed-bg);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  align-items: baseline;
}

.label,
.meta {
  color: var(--muted);
}

.error {
  margin: 0.4rem 0 0;
  color: var(--danger);
}
</style>
