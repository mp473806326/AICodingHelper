<script setup lang="ts">
</script>

<template>
  <div class="app-shell">
    <nav class="nav">
      <RouterLink to="/" class="nav-link">AI 聊天</RouterLink>
      <RouterLink to="/werewolf" class="nav-link">狼人杀</RouterLink>
    </nav>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100svh;
  display: flex;
  flex-direction: column;
}

.nav {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 20;
}

.nav-link {
  text-decoration: none;
  color: var(--text);
  font-size: 14px;
  padding: 6px 12px;
  border-radius: 8px;
  transition: background 0.2s, color 0.2s;
}

.nav-link:hover {
  color: var(--text-h);
  background: var(--social-bg);
}

.nav-link.router-link-active {
  color: var(--accent);
  background: var(--accent-bg);
}

.main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.main > * {
  flex: 1;
  min-height: 0;
}
</style>
