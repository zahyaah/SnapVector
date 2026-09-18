import { createThemeController } from './ui/theme.js';

const themeToggle = document.querySelector<HTMLButtonElement>('#theme-toggle');

if (themeToggle) {
  createThemeController(document.documentElement, themeToggle);
}
