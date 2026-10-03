/// <reference types="vite/client" />
interface ImportMetaEnv {
 readonly VITE_SITE_BASE?: string;
 readonly VITE_PRODUCT_URL?: string;
 readonly VITE_PRODUCT_VIDEO_URL?: string;
 readonly VITE_PRODUCT_VIDEO_POSTER?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
