<template>
  <text
    class="audio-icon"
    :class="'audio-icon--' + props.name"
    :style="{ color: props.color, fontSize: props.size }"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
type AudioIconName =
  | 'previous'
  | 'next'
  | 'play-circle'
  | 'play-circle-filled'
  | 'pause'
  | 'sound'
  | 'chart-bar'

const props = withDefaults(defineProps<{
  name: AudioIconName
  size?: string
  color?: string
}>(), {
  size: '1em',
  color: 'currentColor',
})
</script>

<style scoped>
@font-face {
  font-family: 'happyhome-audio-icons';
  src: url('../static/audio/audio-icons.ttf') format('truetype');
  font-style: normal;
  font-weight: normal;
  font-display: block;
}

.audio-icon {
  display: inline-block;
  font-family: 'happyhome-audio-icons' !important;
  font-style: normal;
  font-weight: normal;
  line-height: 1;
  text-align: center;
  text-rendering: auto;
  vertical-align: middle;
}

.audio-icon--previous::before { content: "\e6cd"; }
.audio-icon--next::before { content: "\e6ca"; }
.audio-icon--play-circle::before { content: "\e70e"; }
.audio-icon--play-circle-filled::before { content: "\e703"; }
.audio-icon--pause::before { content: "\e716"; }
.audio-icon--sound::before { content: "\e680"; }
.audio-icon--chart-bar::before { content: "\e6b5"; }
</style>
