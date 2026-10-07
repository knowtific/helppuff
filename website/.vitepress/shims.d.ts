// `tsc` reads only the TypeScript here; Vite compiles the Vue components.
declare module '*.vue' {
  import { type DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
