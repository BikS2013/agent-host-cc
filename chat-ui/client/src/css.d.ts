/**
 * Ambient module declarations for side-effect CSS imports.
 *
 * TypeScript 6.x became strict about side-effect imports of non-code
 * assets (TS2882). Vite handles the actual loading; this declaration
 * just tells the type-checker that importing a `.css` file is valid.
 */
declare module "*.css";
