<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import {
  createEnvironment,
  normalizeVariableName,
  type TestEnvironment,
} from '../../../shared/types';
import Icon from './Icon.vue';

const props = defineProps<{
  environments: TestEnvironment[];
  activeEnvironmentId: string | null;
  disabled: boolean;
}>();

const emit = defineEmits<{
  select: [environmentId: string | null];
  save: [environments: TestEnvironment[], activeEnvironmentId: string | null];
  export: [];
  import: [];
}>();

const dialogOpen = ref(false);
const draft = ref<TestEnvironment[]>([]);
const selectedId = ref<string | null>(null);
const activeId = ref<string | null>(null);
const error = ref('');

const selected = computed(() =>
  draft.value.find((env) => env.id === selectedId.value) ?? null,
);

watch(
  () => props.activeEnvironmentId,
  (id) => {
    if (!dialogOpen.value) activeId.value = id;
  },
);

function openDialog(): void {
  draft.value = props.environments.map((env) => ({
    ...env,
    variables: env.variables.map((variable) => ({ ...variable })),
  }));
  activeId.value = props.activeEnvironmentId;
  selectedId.value =
    props.activeEnvironmentId ?? draft.value[0]?.id ?? null;
  error.value = '';
  dialogOpen.value = true;
}

function closeDialog(): void {
  dialogOpen.value = false;
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === event.currentTarget) closeDialog();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDialog();
}

function addEnvironment(): void {
  const env = createEnvironment(`Environment ${draft.value.length + 1}`);
  draft.value = [...draft.value, env];
  selectedId.value = env.id;
  if (!activeId.value) activeId.value = env.id;
  error.value = '';
}

function removeEnvironment(): void {
  const current = selected.value;
  if (!current) return;
  draft.value = draft.value.filter((env) => env.id !== current.id);
  if (activeId.value === current.id) {
    activeId.value = draft.value[0]?.id ?? null;
  }
  selectedId.value = draft.value[0]?.id ?? null;
  error.value = '';
}

function addVariable(): void {
  const current = selected.value;
  if (!current) return;
  current.variables.push({ name: '', value: '' });
}

function removeVariable(index: number): void {
  selected.value?.variables.splice(index, 1);
}

function onSave(): void {
  const cleaned: TestEnvironment[] = [];
  for (const env of draft.value) {
    const name = env.name.trim();
    if (!name) {
      error.value = 'Every environment needs a name.';
      selectedId.value = env.id;
      return;
    }
    const variables: TestEnvironment['variables'] = [];
    const seen = new Set<string>();
    for (const variable of env.variables) {
      const varName = normalizeVariableName(variable.name);
      if (!variable.name.trim() && !variable.value) continue;
      if (!varName) {
        error.value = `Variable names in ${name} must start with a letter or underscore.`;
        selectedId.value = env.id;
        return;
      }
      if (seen.has(varName)) {
        error.value = `${name} has more than one ${varName} variable.`;
        selectedId.value = env.id;
        return;
      }
      seen.add(varName);
      variables.push({ name: varName, value: variable.value });
    }
    cleaned.push({
      id: env.id,
      name: name.slice(0, 64),
      variables,
    });
  }

  const nextActive =
    activeId.value && cleaned.some((env) => env.id === activeId.value)
      ? activeId.value
      : null;
  emit('save', cleaned, nextActive);
  closeDialog();
}

function onSelectChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  emit('select', value || null);
}
</script>

<template>
  <div class="env-bar">
    <label class="env-select">
      <span>Environment</span>
      <select
        :value="activeEnvironmentId ?? ''"
        :disabled="disabled"
        aria-label="Active environment"
        @change="onSelectChange"
      >
        <option value="">None</option>
        <option v-for="env in environments" :key="env.id" :value="env.id">
          {{ env.name }}
        </option>
      </select>
    </label>
    <button
      class="btn-sm"
      type="button"
      :disabled="disabled"
      @click="openDialog"
    >
      <Icon name="fi-rr-settings" />
      Variables
    </button>
    <button
      class="btn-sm"
      type="button"
      title="Export environments"
      :disabled="disabled"
      @click="emit('export')"
    >
      <Icon name="fi-rr-file-export" />
    </button>
    <button
      class="btn-sm"
      type="button"
      title="Import environments"
      :disabled="disabled"
      @click="emit('import')"
    >
      <Icon name="fi-rr-file-import" />
    </button>
  </div>

  <div
    v-if="dialogOpen"
    class="dialog-backdrop"
    role="presentation"
    @click="onBackdropClick"
    @keydown="onKeydown"
  >
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Environments"
    >
      <header class="dialog-head">
        <h3>Environments</h3>
        <button type="button" class="icon-btn" aria-label="Close" @click="closeDialog">
          <i class="fi fi-rr-cross-small" aria-hidden="true"></i>
        </button>
      </header>

      <form class="dialog-body" @submit.prevent="onSave">
        <p class="hint">
          The same test can target another server. Use &#123;&#123;baseUrl&#125;&#125; in a navigate URL, input value, or script.
        </p>

        <div class="env-tools">
          <label class="field grow">
            <span>Edit</span>
            <select v-model="selectedId">
              <option v-if="draft.length === 0" value="" disabled>
                No environments yet
              </option>
              <option v-for="env in draft" :key="env.id" :value="env.id">
                {{ env.name || 'Untitled' }}
              </option>
            </select>
          </label>
          <button class="btn-sm" type="button" @click="addEnvironment">
            <Icon name="fi-rr-plus" />
            Add
          </button>
          <button
            class="btn-sm danger"
            type="button"
            :disabled="!selected"
            @click="removeEnvironment"
          >
            <Icon name="fi-rr-trash" />
          </button>
        </div>

        <template v-if="selected">
          <label class="field">
            <span>Name</span>
            <input v-model="selected.name" type="text" maxlength="64" required />
          </label>

          <label class="use-active">
            <input
              type="radio"
              name="active-environment"
              :checked="activeId === selected.id"
              @change="activeId = selected.id"
            />
            Use this environment when playing tests
          </label>

          <div class="var-head">
            <span>Variables</span>
            <button class="btn-sm" type="button" @click="addVariable">
              <Icon name="fi-rr-plus" />
              Add variable
            </button>
          </div>

          <p v-if="selected.variables.length === 0" class="hint">
            No variables yet. Example: baseUrl = https://staging.example.com
          </p>

          <div v-else class="var-list">
            <div
              v-for="(variable, index) in selected.variables"
              :key="index"
              class="var-row"
            >
              <input
                v-model="variable.name"
                type="text"
                placeholder="baseUrl"
                aria-label="Variable name"
                spellcheck="false"
              />
              <input
                v-model="variable.value"
                type="text"
                placeholder="https://staging.example.com"
                aria-label="Variable value"
                spellcheck="false"
              />
              <button
                class="btn-icon danger"
                type="button"
                title="Remove variable"
                @click="removeVariable(index)"
              >
                <Icon name="fi-rr-trash" />
              </button>
            </div>
          </div>
        </template>

        <p v-if="error" class="error">{{ error }}</p>

        <footer class="dialog-actions">
          <button type="button" @click="closeDialog">Cancel</button>
          <button class="primary" type="submit">
            <Icon name="fi-rr-check" />
            Save
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.env-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.4rem;
}

.env-select {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
  font-size: 0.72rem;
  color: var(--muted);
}

.env-select select {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  background: #fff;
  color: var(--text);
  font: inherit;
  font-size: 0.8rem;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 55;
  background: rgba(28, 35, 48, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.dialog {
  width: min(100%, 460px);
  max-height: min(100%, 640px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(28, 35, 48, 0.18);
  display: flex;
  flex-direction: column;
}

.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.7rem 0.85rem;
  border-bottom: 1px solid var(--border);
}

.dialog-head h3 {
  margin: 0;
  font-size: 0.95rem;
}

.icon-btn {
  border: 0;
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
  padding: 0.15rem 0.4rem;
  color: var(--muted);
}

.dialog-body {
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow: auto;
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--muted);
}

.env-tools {
  display: flex;
  align-items: flex-end;
  gap: 0.35rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
}

.field.grow {
  flex: 1;
  min-width: 0;
}

.field input,
.field select,
.var-row input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.55rem;
  color: var(--text);
  background: #fff;
  font: inherit;
}

.use-active {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
}

.var-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--muted);
}

.var-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.var-row {
  display: grid;
  grid-template-columns: minmax(5rem, 0.7fr) minmax(0, 1.4fr) auto;
  gap: 0.35rem;
  align-items: center;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8rem;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
  margin-top: 0.2rem;
}
</style>
