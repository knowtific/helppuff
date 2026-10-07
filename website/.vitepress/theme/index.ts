import DefaultTheme from 'vitepress/theme';
import { type Theme } from 'vitepress';
import DashboardTour from './components/DashboardTour.vue';
import Landing from './components/Landing.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('Landing', Landing);
    app.component('DashboardTour', DashboardTour);
  },
} satisfies Theme;
