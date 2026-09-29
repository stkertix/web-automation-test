<script lang="ts" setup>
import Icon from './Icon.vue';

defineProps<{
  disabled: boolean;
  isRecording: boolean;
  isPlaying: boolean;
  canRecord: boolean;
  hasSteps: boolean;
}>();

defineEmits<{
  record: [];
  stop: [];
  play: [];
  clear: [];
  export: [];
  import: [];
}>();
</script>

<template>
  <div class="toolbar">
    <div class="group primary-group">
      <button
        class="primary"
        type="button"
        :disabled="disabled || isRecording || isPlaying || !canRecord"
        @click="$emit('record')"
      >
        <Icon name="fi-rr-circle" />
        Record
      </button>
      <button
        type="button"
        :disabled="disabled || (!isRecording && !isPlaying)"
        @click="$emit('stop')"
      >
        <Icon name="fi-rr-stop" />
        Stop
      </button>
      <button
        class="primary"
        type="button"
        :disabled="disabled || isRecording || isPlaying || !hasSteps"
        @click="$emit('play')"
      >
        <Icon name="fi-rr-play" />
        Play
      </button>
    </div>

    <div class="group secondary-group">
      <button
        class="btn-sm danger"
        type="button"
        :disabled="disabled || isRecording || isPlaying || !hasSteps"
        @click="$emit('clear')"
      >
        <Icon name="fi-rr-broom" />
        Clear
      </button>
      <button
        class="btn-sm"
        type="button"
        :disabled="disabled || isRecording || isPlaying || !hasSteps"
        @click="$emit('export')"
      >
        <Icon name="fi-rr-file-export" />
        Export
      </button>
      <button
        class="btn-sm"
        type="button"
        :disabled="disabled || isRecording || isPlaying"
        @click="$emit('import')"
      >
        <Icon name="fi-rr-file-import" />
        Import
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.group {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}
</style>
