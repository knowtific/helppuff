import DefaultTheme from 'vitepress/theme';
import { type Theme } from 'vitepress';
import { h } from 'vue';
import DashboardTour from './components/DashboardTour.vue';
import Landing from './components/Landing.vue';
import Lightbox from './components/Lightbox.vue';
import Zoom from './components/Zoom.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  // One lightbox for every page; any `Zoom` screenshot opens in it.
  Layout: () => h(DefaultTheme.Layout, null, { 'layout-bottom': () => h(Lightbox) }),
  enhanceApp({ app }) {
    app.component('Landing', Landing);
    app.component('DashboardTour', DashboardTour);
    app.component('Zoom', Zoom);
  },
} satisfies Theme;
