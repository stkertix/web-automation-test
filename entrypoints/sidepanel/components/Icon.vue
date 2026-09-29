<script lang="ts" setup>
defineProps<{
  /** Flaticon Uicons class, e.g. `fi-rr-play` */
  name: string;
}>();
</script>

<template>
  <i class="fi" :class="name" aria-hidden="true"></i>
</template>
